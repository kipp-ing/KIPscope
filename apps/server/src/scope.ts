import { scopeKey, type WorkspaceScope } from "@kipscope/shared";
import type { FastifyRequest } from "fastify";
import type { Catalog } from "./catalog.ts";
import type { CatalogMode } from "./config.ts";
import type { DataSource, Scope, SignalRef } from "./datasource.ts";
import { sessionOf } from "./http.ts";
import type { Sessions } from "./sessions.ts";

/** Scope catalogs the store keeps besides the kept ones; the least recently used one is dropped (design Z10). */
export const MAX_SCOPE_CATALOGS = 4;

/** A workspace scope (decimal-ns strings) as the source takes it. */
export const sourceScope = (scope: WorkspaceScope): Scope => ({
  dataRef: scope.dataRef,
  from: BigInt(scope.from),
  to: BigInt(scope.to),
});

/** The scope of the session a request serves (design Z10, add-multiuser M5). */
export function scopeOf(request: FastifyRequest): WorkspaceScope | undefined {
  return sessionOf(request).store.workspace.scope;
}

/** The scopes of every session with a live client (add-multiuser M9): the lists a store keeps. */
export function openScopes(sessions: Pick<Sessions, "open">): WorkspaceScope[] {
  return sessions.open().flatMap((s) => (s.store.workspace.scope ? [s.store.workspace.scope] : []));
}

/** Waits for `promise`, or rejects with the abort reason once `abort` fires; the work goes on. */
function abortable<T>(promise: Promise<T>, abort: AbortSignal | undefined): Promise<T> {
  if (!abort) return promise;
  abort.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abort.reason);
    abort.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        abort.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        abort.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

type LoadedListener = (scope: WorkspaceScope, catalog: Catalog) => void;

/**
 * The signal lists the server holds (design Z10): the full catalog (full mode only) and one
 * catalog per scope. The catalogs of the scopes `keep` returns (those of the sessions with a live
 * client, add-multiuser M9) are never dropped; of the others at most MAX_SCOPE_CATALOGS stay, the
 * least recently used dropped first.
 */
export class CatalogStore {
  readonly mode: CatalogMode;
  /** The start-up catalog of full mode; undefined in scoped mode. */
  readonly full: Catalog | undefined;
  private readonly create: (scope: Scope) => Catalog;
  private readonly keep: () => Iterable<WorkspaceScope>;
  /** Scope catalogs by `scopeKey`, least recently used first. */
  private readonly scoped = new Map<string, { scope: WorkspaceScope; catalog: Catalog }>();
  private readonly listeners = new Set<LoadedListener>();

  constructor(options: {
    mode: CatalogMode;
    full?: Catalog;
    create: (scope: Scope) => Catalog;
    keep?: () => Iterable<WorkspaceScope>;
  }) {
    this.mode = options.mode;
    this.full = options.mode === "full" ? options.full : undefined;
    this.create = options.create;
    this.keep = options.keep ?? (() => []);
  }

  /** The scope's catalog, loaded or not, else without a scope the full catalog; if any. */
  get(scope?: WorkspaceScope): Catalog | undefined {
    if (!scope) return this.full;
    const key = scopeKey(scope);
    const entry = this.scoped.get(key);
    if (!entry) return undefined;
    this.scoped.delete(key);
    this.scoped.set(key, entry);
    return entry.catalog;
  }

  /** The scope's catalog, created (not loaded) when the store does not hold it yet. */
  entry(scope: WorkspaceScope): Catalog {
    const held = this.get(scope);
    if (held) return held;
    const own = { dataRef: scope.dataRef, from: scope.from, to: scope.to };
    const catalog = this.create(sourceScope(own));
    catalog.onLoaded(() => {
      for (const listener of this.listeners) listener(own, catalog);
    });
    this.scoped.set(scopeKey(own), { scope: own, catalog });
    const kept = new Set([...this.keep()].map(scopeKey));
    let others = [...this.scoped.keys()].filter((key) => !kept.has(key)).length;
    for (const key of this.scoped.keys()) {
      if (others <= MAX_SCOPE_CATALOGS) break;
      if (kept.has(key)) continue;
      this.scoped.delete(key);
      others--;
    }
    return catalog;
  }

  /**
   * Resolves with the scope's catalog once it has loaded; rejects with the load's error. Single
   * flight per scope: concurrent loads share one `listSignals` (Catalog.refresh). `abort` ends
   * only this caller's wait.
   */
  async load(scope: WorkspaceScope, abort?: AbortSignal): Promise<Catalog> {
    const catalog = this.entry(scope);
    if (!catalog.loadedAt) await abortable(catalog.refresh(), abort);
    return catalog;
  }

  /** The scopes the store holds a catalog for, loaded or not, least recently used first. */
  scopes(): WorkspaceScope[] {
    return [...this.scoped.values()].map((e) => e.scope);
  }

  /** Calls `listener` after each successful load of a scope catalog; returns a function that removes it. */
  onLoaded(listener: LoadedListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

/** A data call that scoped mode refuses (design Z10 "Scoped-mode guard"); a server bug. */
export class ScopeGuardError extends Error {
  readonly method: string;

  constructor(method: string, message: string) {
    super(message);
    this.name = "ScopeGuardError";
    this.method = method;
  }
}

/** Position of the `scope` argument of each method that takes one (design Z1). */
const SCOPE_ARG = {
  listSignals: 0,
  extent: 1,
  refExtent: 1,
  refCount: 1,
  before: 2,
  after: 2,
  events: 2,
  refBuckets: 3,
  loggerGaps: 3,
  firstTimes: 3,
  stateChanges: 3,
} as const satisfies Partial<Record<keyof DataSource, number>>;

/** Methods without a scope whose range must lie inside a held scope of their data ref. */
const RANGED = ["raw", "buckets", "count"] as const satisfies readonly (keyof DataSource)[];

type Method = (...args: unknown[]) => Promise<unknown>;

/**
 * Scoped mode's guard around the completed source (design Z10): a data call without a scope, or
 * a `raw`, `buckets` or `count` whose range is not inside a scope `held` returns for that data
 * ref, rejects with ScopeGuardError before it reaches `source`; the first refusal of each method
 * is logged as a bug. `ping` and `info` pass.
 */
export function guardScoped(
  source: DataSource,
  held: () => Iterable<WorkspaceScope | Scope>,
  log: { error(message: string): void },
): DataSource {
  const logged = new Set<string>();
  const refuse = (method: string, why: string): never => {
    const error = new ScopeGuardError(method, `scoped mode: ${method} ${why}`);
    if (!logged.has(method)) {
      logged.add(method);
      log.error(`bug: ${error.message}; refused before the source`);
    }
    throw error;
  };
  const call = (method: keyof DataSource): Method => {
    const fn = source[method] as unknown as Method;
    return (...args) => fn.apply(source, args);
  };
  const guarded: Record<string, unknown> = {
    info: source.info,
    ping: (abort: AbortSignal) => source.ping(abort),
  };
  for (const [method, at] of Object.entries(SCOPE_ARG) as [keyof typeof SCOPE_ARG, number][]) {
    const inner = call(method);
    guarded[method] = async (...args: unknown[]) => {
      if (args[at] === undefined) refuse(method, "called without a scope");
      return inner(...args);
    };
  }
  for (const method of RANGED) {
    const inner = call(method);
    guarded[method] = async (...args: unknown[]) => {
      const [ref, from, to] = args as [SignalRef, bigint, bigint];
      const inside = [...held()].some(
        (s) => s.dataRef === ref.dataRef && BigInt(s.from) <= from && to <= BigInt(s.to),
      );
      if (!inside)
        refuse(method, `range [${from}, ${to}) of ${ref.dataRef} is not inside a held scope`);
      return inner(...args);
    };
  }
  return guarded as unknown as DataSource;
}
