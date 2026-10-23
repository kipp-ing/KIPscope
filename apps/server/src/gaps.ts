import {
  computedInputIds,
  computedRef,
  type GapInfo,
  LOGGER_GAP_GRID,
  LOGGER_GAP_MIN,
  type LoggerGapJson,
  measurePeriod,
  PERIOD_SAMPLE_ROWS,
  type SignalInfo,
  type SignalPeriod,
  staticPeriod,
  type Workspace,
} from "@kipscope/shared";
import type { DataSource, Scope } from "./datasource.ts";
import { type CacheScope, plainScope, scopeCacheKey } from "./density.ts";
import { currentPriority, Priority, withPriority } from "./priority.ts";

type GapSource = Pick<DataSource, "refCount" | "loggerGaps" | "firstTimes">;

interface GapCatalog {
  readonly loadedAt: Date | undefined;
  all(): readonly SignalInfo[];
}

/** Logger gaps and `through` of a data ref. */
interface LoggerPart {
  logger: LoggerGapJson[];
  through?: string;
}

interface LoggerEntry {
  /** Class of the computation's queries: the starting caller's, raised by each joining one (P4). */
  priority: Priority;
  promise: Promise<LoggerPart>;
  /** The data ref's row count taken before the computation; set once it succeeded (design G9 (b)). */
  count?: number;
}

/** One `firstTimes` for several names of a data ref (design P6). */
interface Batch {
  priority: Priority;
  /** Name → measured period (undefined: not measurable). */
  promise: Promise<Map<string, bigint | undefined>>;
  /** Set once the batch succeeded. */
  done?: true;
}

/** What the cache holds of one data ref for one catalog load. */
interface RefState {
  loadedAt: Date | undefined;
  /** DBC and diag periods of the data ref's catalog signals; no query needed. */
  statics: Record<string, SignalPeriod>;
  /** Signal ID → name of the data ref's catalog signals without a static period. */
  unknown: Map<string, string>;
  logger?: LoggerEntry;
  /** Name → the batch that measured it or is measuring it. */
  measured: Map<string, Batch>;
  /** Object scope only: the work window every query of this state carries, and its scope (K11). */
  window?: Scope;
  parent?: CacheScope;
}

/** Work windows whose gap info is kept (add-case-open K11); least recently used dropped. */
export const MAX_GAP_WINDOWS = 8;

/**
 * Gap info of a data ref (spec data-gaps, design G6, P6): the logger part (logger gaps, `through`)
 * once per data ref and catalog load, the measured periods per signal, only for signals a request
 * names or the workspace holds (`wanted`). Like the `DensityCache`, concurrent requests share each
 * computation, a failed one is dropped, and a new `loadedAt` makes the next request compute again.
 * Computations ignore client aborts, since they are shared; their queries run in the class of the
 * caller that started them, raised to that of any caller that joins (design P4). `refresh`
 * recomputes a data ref whose row count changed since (design G9 (b)). With a scope (add-scope Z9)
 * every query carries it, the state is kept per scope key and follows that scope's catalog
 * (`catalogOf`, else the full one). In an object scope (add-case-open K11) a work window takes the
 * scope's place in every query; its state is kept per (scope key, window), at most
 * MAX_GAP_WINDOWS, and the poll recounts only the held windows (`refreshWindows`).
 */
export class GapCache {
  private readonly source: GapSource;
  private readonly catalog: GapCatalog;
  private readonly wanted: () => Iterable<string>;
  private readonly catalogOf: (scope: CacheScope) => GapCatalog | undefined;
  private readonly refs = new Map<string, RefState>();

  constructor(
    source: GapSource,
    catalog: GapCatalog,
    wanted: () => Iterable<string> = () => [],
    catalogOf: (scope: CacheScope) => GapCatalog | undefined = () => undefined,
  ) {
    this.source = source;
    this.catalog = catalog;
    this.wanted = wanted;
    this.catalogOf = catalogOf;
  }

  /** The catalog the gap info of `scope` (or of the whole data ref) is computed against. */
  private catalogFor(scope?: CacheScope): GapCatalog {
    return (scope && this.catalogOf(scope)) ?? this.catalog;
  }

  /**
   * Gap info with the measured periods of the named signals of `dataRef` (others are ignored).
   * Waits for the logger part and the named signals' periods only; workspace signals of the data
   * ref not measured yet go into the same sample query (design P6). With `scope`, whose data ref
   * the caller made sure is `dataRef`, the gap info of the scope's rows only (add-scope Z9); with
   * `window` (object scope, cut to it by the caller), of the window's rows only (K11).
   */
  async get(
    dataRef: string,
    signalIds: readonly string[] = [],
    scope?: CacheScope,
    window?: Scope,
  ): Promise<GapInfo> {
    const ref = this.state(dataRef, scope, window);
    const query = ref.window ?? (scope && plainScope(scope));
    const logger = this.logger(dataRef, ref, query);
    /** Name → signal ID of the named signals to measure. */
    const named = new Map<string, string>();
    for (const id of signalIds) {
      const name = ref.unknown.get(id);
      if (name !== undefined) named.set(name, id);
    }
    this.measure(dataRef, ref, [...named.keys(), ...this.names(ref, this.wanted())], query);
    const cls = currentPriority().cls;
    const [part, measured] = await Promise.all([
      logger.promise,
      Promise.all(
        [...named].map(([name, id]) => {
          const batch = ref.measured.get(name) as Batch;
          batch.priority.raise(cls);
          return batch.promise.then((periods) => [id, periods.get(name)] as const);
        }),
      ),
    ]);
    const periods = { ...ref.statics };
    for (const [id, ns] of measured)
      if (ns !== undefined) periods[id] = { ns: ns.toString(), source: "measured" };
    const info: GapInfo = { dataRef, logger: part.logger, periods };
    if (part.through !== undefined) info.through = part.through;
    return info;
  }

  /**
   * Computes the logger part of each data ref in turn, not in parallel, so carserver sees one full
   * scan at a time, and measures its workspace signals (one sample query per data ref). A failure
   * is reported through `warn` and not cached; a newer catalog load stops this run, since its own
   * prefetch takes over. With `scope`: the gap info of that scope (`dataRefs` its data ref).
   */
  async prefetch(
    dataRefs: Iterable<string>,
    warn: (message: string) => void,
    scope?: CacheScope,
  ): Promise<void> {
    const catalog = this.catalogFor(scope);
    const loadedAt = catalog.loadedAt;
    for (const dataRef of dataRefs) {
      if (catalog.loadedAt !== loadedAt) return;
      try {
        await this.get(dataRef, [...this.wanted()], scope);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`gap prefetch for ${dataRef} failed: ${message}`);
      }
    }
  }

  /**
   * One poll (design G9 (b), P6): for each data ref with a logger part of the current catalog load,
   * in turn: refCount; when it differs from the count taken before that part was computed, compute
   * it anew and re-measure the names measured so far in one sample query. The old values stay
   * served until both are in; a failure goes to `warn` and keeps them; a newer catalog load stops
   * the run. With `scope`: only that scope's gap info (`dataRefs` its data ref; add-scope Z9); an
   * object scope has none of its own, its work windows poll through `refreshWindows` (K11).
   */
  async refresh(
    dataRefs: Iterable<string>,
    warn: (message: string) => void,
    scope?: CacheScope,
  ): Promise<void> {
    if (scope?.object) return;
    const catalog = this.catalogFor(scope);
    const loadedAt = catalog.loadedAt;
    for (const dataRef of dataRefs) {
      if (catalog.loadedAt !== loadedAt) return;
      const key = scope ? scopeCacheKey(scope) : dataRef;
      await this.refreshOne(key, dataRef, loadedAt, catalog, warn, scope);
    }
  }

  /**
   * The poll of every held work window (K11, at most MAX_GAP_WINDOWS), in turn, as `refresh`
   * does for a scope: its row count, and when that changed its logger part and periods anew.
   */
  async refreshWindows(warn: (message: string) => void): Promise<void> {
    const held = [...this.refs].filter(([, ref]) => ref.window && ref.parent);
    for (const [key, ref] of held) {
      const scope = ref.parent as CacheScope;
      const catalog = this.catalogFor(scope);
      const window = ref.window as Scope;
      await this.refreshOne(key, window.dataRef, catalog.loadedAt, catalog, warn, scope);
    }
  }

  /** One state's poll step of `refresh`. */
  private async refreshOne(
    key: string,
    dataRef: string,
    loadedAt: Date | undefined,
    catalog: GapCatalog,
    warn: (message: string) => void,
    scope?: CacheScope,
  ): Promise<void> {
    let ref = this.refs.get(key);
    // A held work window follows its scope's current list (see `state`).
    if (ref?.window) ref = this.state(dataRef, scope, ref.window);
    const old = ref?.logger;
    if (!ref || ref.loadedAt !== loadedAt || !old || old.count === undefined) return;
    const query = ref.window ?? (scope && plainScope(scope));
    try {
      const count = await this.source.refCount(dataRef, query);
      if (count === old.count) return;
      const done = [...ref.measured].filter(([, batch]) => batch.done);
      const names = done.map(([name]) => name);
      const next = this.startLogger(dataRef, query, count);
      const [, samples] = await Promise.all([
        next.promise,
        this.source.firstTimes(dataRef, names, PERIOD_SAMPLE_ROWS, query),
      ]);
      if (this.refs.get(key) !== ref || catalog.loadedAt !== loadedAt) return;
      if (ref.logger === old) ref.logger = next;
      const batch: Batch = {
        priority: next.priority,
        promise: Promise.resolve(periodsOf(names, samples)),
        done: true,
      };
      for (const [name, was] of done)
        if (ref.measured.get(name) === was) ref.measured.set(name, batch);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warn(`gap refresh for ${dataRef} failed: ${message}`);
    }
  }

  /** The data ref's (or scope's, or work window's) state of the current catalog load, new after a load. */
  private state(dataRef: string, scope?: CacheScope, window?: Scope): RefState {
    const catalog = this.catalogFor(scope);
    const base = scope ? scopeCacheKey(scope) : dataRef;
    const key = window ? `${base}\n${window.from} ${window.to}` : base;
    const loadedAt = catalog.loadedAt;
    const cached = this.refs.get(key);
    // A work window keeps its logger part and measured periods across a new list of its object
    // scope (the vehicle's own list replacing the session's, K11): rows decide them; only the
    // list's periods are read again.
    if (cached && window && cached.loadedAt !== loadedAt) {
      Object.assign(cached, catalogPeriods(catalog, dataRef), { loadedAt });
    }
    if (cached && cached.loadedAt === loadedAt) {
      if (window) {
        this.refs.delete(key);
        this.refs.set(key, cached);
      }
      return cached;
    }
    const ref: RefState = { loadedAt, ...catalogPeriods(catalog, dataRef), measured: new Map() };
    if (window) {
      ref.window = plainScope(window);
      if (scope) ref.parent = scope;
    }
    this.refs.delete(key);
    this.refs.set(key, ref);
    if (window) {
      const windows = [...this.refs].filter(([, r]) => r.window).map(([k]) => k);
      for (const old of windows.slice(0, Math.max(0, windows.length - MAX_GAP_WINDOWS)))
        this.refs.delete(old);
    }
    return ref;
  }

  /** Names of the given signals that are catalog signals of the data ref without a static period. */
  private names(ref: RefState, signalIds: Iterable<string>): string[] {
    const names = new Set<string>();
    for (const id of signalIds) {
      const name = ref.unknown.get(id);
      if (name !== undefined) names.add(name);
    }
    return [...names];
  }

  /** The shared logger part, started in the caller's class or raised to it. */
  private logger(dataRef: string, ref: RefState, scope?: Scope): LoggerEntry {
    const cls = currentPriority().cls;
    if (ref.logger) {
      ref.logger.priority.raise(cls);
      return ref.logger;
    }
    const entry = this.startLogger(dataRef, scope);
    ref.logger = entry;
    entry.promise.catch(() => {
      if (ref.logger === entry) delete ref.logger;
    });
    return entry;
  }

  /**
   * Takes the row count first (unless the caller just took it), so rows inserted during the
   * computation cause one more recompute at the next poll, never a missed one (design G9 (b)).
   * `count` is set when the computation succeeds.
   */
  private startLogger(dataRef: string, scope?: Scope, taken?: number): LoggerEntry {
    const priority = new Priority(currentPriority().cls);
    const entry = { priority } as LoggerEntry;
    entry.promise = withPriority(priority, async () => {
      const count = taken ?? (await this.source.refCount(dataRef, scope));
      const gaps = await this.source.loggerGaps(dataRef, LOGGER_GAP_GRID, LOGGER_GAP_MIN, scope);
      entry.count = count;
      const part: LoggerPart = {
        logger: gaps.gaps.map((g) => ({ from: g.from.toString(), to: g.to.toString() })),
      };
      if (gaps.last !== undefined) part.through = gaps.last.toString();
      return part;
    });
    return entry;
  }

  /**
   * Starts one sample query for the names not measured or in flight yet, in the caller's class;
   * none when there are none. A failed batch drops its names.
   */
  private measure(dataRef: string, ref: RefState, names: readonly string[], scope?: Scope): void {
    const fresh = [...new Set(names)].filter((name) => !ref.measured.has(name));
    if (fresh.length === 0) return;
    const priority = new Priority(currentPriority().cls);
    const batch: Batch = {
      priority,
      promise: withPriority(priority, () =>
        this.source.firstTimes(dataRef, fresh, PERIOD_SAMPLE_ROWS, scope),
      ).then((samples) => {
        batch.done = true;
        return periodsOf(fresh, samples);
      }),
    };
    for (const name of fresh) ref.measured.set(name, batch);
    batch.promise.catch(() => {
      for (const name of fresh) if (ref.measured.get(name) === batch) ref.measured.delete(name);
    });
  }
}

/** The static periods of a data ref's catalog signals, and the names of those without one. */
function catalogPeriods(
  catalog: GapCatalog,
  dataRef: string,
): Pick<RefState, "statics" | "unknown"> {
  const statics: Record<string, SignalPeriod> = {};
  const unknown = new Map<string, string>();
  for (const signal of catalog.all()) {
    if (signal.dataRef !== dataRef) continue;
    const period = staticPeriod(signal);
    if (period) statics[signal.id] = { ns: period.ns.toString(), source: period.source };
    else unknown.set(signal.id, signal.name);
  }
  return { statics, unknown };
}

/** Measured period per name from its first rows. */
function periodsOf(
  names: readonly string[],
  samples: ReadonlyMap<string, readonly bigint[]>,
): Map<string, bigint | undefined> {
  const periods = new Map<string, bigint | undefined>();
  for (const name of names) {
    const times = samples.get(name);
    periods.set(name, times && measurePeriod(times));
  }
  return periods;
}

/**
 * Signal IDs of every window plus the events line (design P6); a computed signal contributes its
 * used inputs on its data ref, not itself (add-computed-signals C8), none without a definition.
 */
export function workspaceSignals(workspace: Workspace): string[] {
  const ids = new Set<string>();
  for (const w of workspace.windows)
    for (const s of w.signals) {
      const computed = computedRef(s.signalId);
      if (!computed) {
        ids.add(s.signalId);
        continue;
      }
      const def = workspace.computed?.find((d) => d.id === computed.id);
      if (def) for (const id of computedInputIds(def, computed.dataRef)) ids.add(id);
    }
  for (const id of workspace.eventSignals ?? []) ids.add(id);
  return [...ids];
}
