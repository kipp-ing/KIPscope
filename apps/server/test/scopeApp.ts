/**
 * The app of the scope tests (add-scope): wired like `main.ts` does it (a `CatalogStore` of the full
 * catalog and the scope lists, `guardScoped` in scoped mode, the scopes of open workspaces kept),
 * over an adapter that records every call it receives. This is the one place that mirrors main.ts's
 * wiring; if main.ts changes, change it here.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { computeRows, type Workspace } from "@kipscope/shared";
import { buildApp } from "../src/app.ts";
import { Catalog, keepCatalogLoaded } from "../src/catalog.ts";
import type { CatalogMode } from "../src/config.ts";
import type { DataSource, Scope, SourceAdapter, SourceSignal } from "../src/datasource.ts";
import { loadDbcFiles } from "../src/dbc.ts";
import { completeSource, coreOnly } from "../src/fallbacks.ts";
import { QueryQueue, queuedAdapter } from "../src/queue.ts";
import { CatalogStore, guardScoped } from "../src/scope.ts";
import { ViewStore } from "../src/views.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { testDbcFiles } from "./testdb.ts";

/** One call the adapter received. */
export interface Call {
  method: string;
  args: unknown[];
}

/** The adapter wrapped so that every method call is recorded in `calls`. */
export function recording(adapter: SourceAdapter): { adapter: SourceAdapter; calls: Call[] } {
  const calls: Call[] = [];
  const wrapped = new Proxy(adapter, {
    get(target, key, receiver) {
      const member = Reflect.get(target, key, receiver);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        calls.push({ method: String(key), args });
        return member.apply(target, args);
      };
    },
    // `completeSource` and `nativeMethods` look for optional methods by presence.
    has: (target, key) => Reflect.has(target, key),
  });
  return { adapter: wrapped, calls };
}

// biome-ignore lint/suspicious/noExplicitAny: tests read arbitrary fields of the JSON answers
export type Answer = { status: number; body: any; text: string };

export interface ScopeApp {
  app: ReturnType<typeof buildApp>;
  store: WorkspaceStore;
  catalogs: CatalogStore;
  /** The full catalog (never loaded in scoped mode). */
  catalog: Catalog;
  /** Everything the adapter received, in order. */
  calls: Call[];
  /** Lines the scoped-mode guard logged. */
  guardLog: string[];
  stateDir: string;
  views: ViewStore;
  get(url: string): Promise<Answer>;
  post(url: string, body: unknown): Promise<Answer>;
  command(body: unknown): Promise<Answer>;
  close(): Promise<void>;
}

export interface ScopeAppOptions {
  /** The adapter under test (default: nothing, the caller gives one). */
  adapter: SourceAdapter;
  /** `full` (default) or `scoped`. */
  mode?: CatalogMode;
  /** Reduce the adapter to the 7 required methods, like the conformance "core only" runs. */
  coreOnly?: boolean;
  /** `KIPSCOPE_SCOPE_PAD` in ns (default 1 h). */
  scopePad?: bigint;
  /** Workspace and revision the store starts with (a restored state file). */
  initial?: { revision: number; workspace: Workspace };
  /** Load the full catalog before the app starts (full mode only; default true there). */
  loadFullCatalog?: boolean;
  /** Read the test DBC files into the catalogs (state labels, units). */
  dbc?: boolean;
  /** Keep the full catalog in full mode loaded, like main.ts at start. */
  startup?: boolean;
  /** Wire the saved-view routes (default true). */
  views?: boolean;
  /** Put the adapter behind a query queue of this many slots, like main.ts does (default: none). */
  queue?: number;
}

/** The real app, wired like main.ts, on a temp state dir. */
export async function scopeApp(options: ScopeAppOptions): Promise<ScopeApp> {
  const mode = options.mode ?? "full";
  const base = options.coreOnly ? coreOnly(options.adapter) : options.adapter;
  const { adapter, calls } = recording(base);
  const completed = completeSource(
    options.queue === undefined ? adapter : queuedAdapter(adapter, new QueryQueue(options.queue)),
  );
  const guardLog: string[] = [];
  let catalogs: CatalogStore;
  const source: DataSource =
    mode === "scoped"
      ? guardScoped(completed, () => catalogs.scopes(), {
          error: (message) => guardLog.push(message),
        })
      : completed;

  const metadata = () => (options.dbc ? loadDbcFiles(testDbcFiles) : Promise.resolve(new Map()));
  const newCatalog = (scope?: Scope) =>
    new Catalog(source, metadata, undefined, undefined, undefined, scope);
  const catalog = newCatalog();
  catalogs = new CatalogStore({ mode, full: catalog, create: newCatalog });

  const stateDir = mkdtempSync(join(tmpdir(), "kipscope-scope-"));
  const viewsDir = join(stateDir, "views");
  mkdirSync(viewsDir, { recursive: true });
  const views = new ViewStore(viewsDir);

  const store = new WorkspaceStore(
    {
      signalExists: (id) => catalog.get(id) !== undefined,
      unitOf: (id) => catalog.get(id)?.unit,
      hasStates: (id) => catalog.get(id)?.states !== undefined,
      catalogReady: () => catalog.loadedAt !== undefined,
    },
    {
      ...(options.initial ? { initial: options.initial } : {}),
      beforeOpen: (previous: Workspace) => views.beforeOpen(previous),
    },
  );
  if (mode === "full" && options.loadFullCatalog !== false && !options.startup)
    await catalog.refresh();

  const app = buildApp({
    catalog,
    catalogs,
    source,
    workspace: store,
    ...(options.scopePad === undefined ? {} : { scopePad: options.scopePad }),
    ...(options.views === false ? {} : { views }),
    meta: {
      build: { commit: null, dirty: false, startedAt: new Date("2026-10-19T08:00:00Z") },
      source: source.info,
      ping: (signal: AbortSignal) => source.ping(signal),
    },
  } as Parameters<typeof buildApp>[0]);
  await app.ready();

  const stops: (() => void)[] = [];
  if (options.startup) {
    // As main.ts after listen: the full catalog in full mode, kept loading until it loads once
    // (signal-catalog H5). A scope's list loads when a live client connects to its workspace
    // (add-multiuser M9), not at start.
    if (catalogs.full) stops.push(keepCatalogLoaded(catalogs.full, { loaded() {}, failed() {} }));
  }

  const parse = (text: string) => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };
  const answer = (res: { statusCode: number; body: string }): Answer => ({
    status: res.statusCode,
    body: parse(res.body),
    text: res.body,
  });
  return {
    app,
    store,
    catalogs,
    catalog,
    calls,
    guardLog,
    stateDir,
    views,
    get: async (url) => answer(await app.inject({ method: "GET", url })),
    post: async (url, body) =>
      answer(await app.inject({ method: "POST", url, body: body as object })),
    command: async (body) =>
      answer(await app.inject({ method: "POST", url: "/api/commands", body: body as object })),
    async close() {
      for (const stop of stops) stop();
      await app.close();
      rmSync(stateDir, { recursive: true, force: true });
    },
  };
}

/** Error code of an answer, whether `{error:{code}}` (apiError) or a CommandResult `{code}`. */
// biome-ignore lint/suspicious/noExplicitAny: loose JSON
export const codeOf = (body: any): string | undefined => body?.error?.code ?? body?.code;

/** Listed signals of the in-memory adapter: name → rows [t, value] and whether it has text. */
export interface MemorySignal {
  dataRef: string;
  name: string;
  rows: [bigint, number][];
  text?: boolean;
}

/**
 * An in-memory adapter with every method but `series` (like ClickHouse: the server's fallback
 * makes it, speed-up-adx A2), answering as if it held only the scope's rows (design Z1).
 * Enough for the routes and background tasks to run against it without a database.
 */
export function memoryAdapter(
  signals: MemorySignal[],
  options: { failListSignals?: (scope: Scope | undefined) => boolean } = {},
): Omit<DataSource, "series"> {
  const inScope = (t: bigint, scope?: Scope) => !scope || (t >= scope.from && t < scope.to);
  const rowsOf = (ref: { dataRef: string; name: string }, scope?: Scope) =>
    (signals.find((s) => s.dataRef === ref.dataRef && s.name === ref.name)?.rows ?? [])
      .filter(([t]) => inScope(t, scope))
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const dataRows = (dataRef: string, scope?: Scope) =>
    signals
      .filter((s) => s.dataRef === dataRef)
      .flatMap((s) => s.rows.map(([t]) => t))
      .filter((t) => inScope(t, scope))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const point = ([t, v]: [bigint, number]) => ({ t, v });
  return {
    info: { kind: "memory", database: "mem", table: "signals", eventsTable: "mem.events" },
    ping: async () => {},
    listSignals: async (scope) => {
      if (options.failListSignals?.(scope)) throw new Error("connect ECONNREFUSED");
      return signals
        .filter((s) => (!scope || s.dataRef === scope.dataRef) && rowsOf(s, scope).length > 0)
        .map(
          (s): SourceSignal => ({
            dataRef: s.dataRef,
            name: s.name,
            ...(s.text ? { text: true } : {}),
          }),
        );
    },
    raw: async (ref, from, to, limit) =>
      rowsOf(ref)
        .filter(([t]) => t >= from && t < to)
        .slice(0, limit)
        .map(point),
    before: async (ref, t, scope) => {
      const rows = rowsOf(ref, scope).filter(([x]) => x < t);
      const last = rows[rows.length - 1];
      return last && point(last);
    },
    after: async (ref, t, scope) => {
      const first = rowsOf(ref, scope).find(([x]) => x >= t);
      return first && point(first);
    },
    buckets: async (ref, from, to, width) => {
      const byStart = new Map<bigint, number[]>();
      for (const [t, v] of rowsOf(ref)) {
        if (t < from || t >= to) continue;
        const start = t - (((t % width) + width) % width);
        byStart.set(start, [...(byStart.get(start) ?? []), v]);
      }
      return [...byStart]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([start, values]) => ({
          start,
          count: values.length,
          sna: 0,
          mean: values.reduce((a, b) => a + b, 0) / values.length,
          min: Math.min(...values),
          max: Math.max(...values),
        }));
    },
    refBuckets: async (dataRef, width, times, scope) => {
      const byStart = new Map<bigint, bigint[]>();
      for (const t of dataRows(dataRef, scope)) {
        const start = t - (((t % width) + width) % width);
        byStart.set(start, [...(byStart.get(start) ?? []), t]);
      }
      return [...byStart].map(([start, list]) => ({
        start,
        count: list.length,
        ...(times ? { first: list[0] as bigint, last: list[list.length - 1] as bigint } : {}),
      }));
    },
    // Optional methods: present, so that "every method" runs the native paths.
    extent: async (ref, scope) => {
      const rows = rowsOf(ref, scope);
      const first = rows[0];
      const last = rows[rows.length - 1];
      return first && last ? { first: first[0], last: last[0] } : undefined;
    },
    refExtent: async (dataRef, scope) => {
      const times = dataRows(dataRef, scope);
      const first = times[0];
      const last = times[times.length - 1];
      return first !== undefined && last !== undefined
        ? { count: times.length, first, last }
        : undefined;
    },
    refCount: async (dataRef, scope) => dataRows(dataRef, scope).length,
    // add-computed-signals: raw rows of the inputs by the shared per-row rule, never buckets.
    computedSeries: async (ref, from, to) => {
      const input = (r: typeof ref.a) => ({
        points: rowsOf(r)
          .filter(([t]) => t >= from && t < to)
          .map(point),
        ...(r.seed && { seed: r.seed }),
        ...(r.holdNs !== undefined && { holdNs: r.holdNs }),
      });
      return { kind: "raw", points: computeRows(ref.ast, input(ref.a), ref.b && input(ref.b)) };
    },
    count: async (ref, from, to) => rowsOf(ref).filter(([t]) => t >= from && t < to).length,
    loggerGaps: async (dataRef, _grid, minGap, scope) => {
      const times = dataRows(dataRef, scope);
      const gaps: { from: bigint; to: bigint }[] = [];
      for (let i = 1; i < times.length; i++) {
        const a = times[i - 1] as bigint;
        const b = times[i] as bigint;
        if (b - a >= minGap) gaps.push({ from: a, to: b });
      }
      const last = times[times.length - 1];
      return last === undefined ? { gaps } : { gaps, last };
    },
    firstTimes: async (dataRef, names, rows, scope) => {
      const map = new Map<string, bigint[]>();
      for (const name of names) {
        const list = rowsOf({ dataRef, name }, scope).slice(0, rows);
        if (list.length > 0)
          map.set(
            name,
            list.map(([t]) => t),
          );
      }
      return map;
    },
    stateChanges: async () => [],
    events: async () => [],
  };
}
