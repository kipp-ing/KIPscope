import type { AdxSource } from "./adx.ts";
import type { ComputedRef, Scope, SourceAdapter, SourceInfo, SourceSignal } from "./datasource.ts";
import type { QueryRunner } from "./queue.ts";

/**
 * A data ref that names no configured database (add-adx-databases D1): 400 `unknown_database`.
 * The message names the form `<database>:<ref>` and the configured databases.
 */
export class UnknownDatabaseError extends Error {
  readonly code = "unknown_database";
  readonly statusCode = 400;
  readonly dataRef: string;

  constructor(dataRef: string, message: string) {
    super(message);
    this.name = "UnknownDatabaseError";
    this.dataRef = dataRef;
  }
}

/**
 * How a route answers a failed source call: 400 `unknown_database` (its message unchanged) for a
 * data ref of no configured database, else 502 `source_error`.
 */
export function sourceFailure(error: unknown): {
  status: 400 | 502;
  code: "unknown_database" | "source_error";
  message: string;
} {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof UnknownDatabaseError)
    return { status: error.statusCode, code: error.code, message };
  return { status: 502, code: "source_error", message };
}

/**
 * Why a route found no `dataRef`: 400 `unknown_database` when it names no database `info` lists
 * (design D1); undefined for any other ref, and with one database always.
 */
export function databaseRefusal(info: SourceInfo | undefined, dataRef: string | undefined) {
  const databases = info?.databases;
  if (dataRef === undefined || databases === undefined || databases.length < 2) return undefined;
  try {
    splitDataRef(dataRef, databases);
    return undefined;
  } catch (error) {
    return sourceFailure(error);
  }
}

/**
 * The database and the bare ref of a qualified data ref, split at the first `:` (a database name
 * holds none, the ref's own text may, design D1); a bare ref or one of an unconfigured database
 * throws `UnknownDatabaseError`.
 */
export function splitDataRef(
  ref: string,
  databases: readonly string[],
): { database: string; ref: string } {
  const at = ref.indexOf(":");
  const database = at < 0 ? undefined : ref.slice(0, at);
  const bare = at < 0 ? ref : ref.slice(at + 1);
  if (database !== undefined && databases.includes(database)) return { database, ref: bare };
  const reason =
    database === undefined ? "names no database" : `names an unknown database "${database}"`;
  const example = databases[0] === undefined ? "" : `, e.g. ${qualifyDataRef(databases[0], bare)}`;
  throw new UnknownDatabaseError(
    ref,
    `data ref "${ref}" ${reason}: write <database>:<ref>${example} (databases: ${databases.join(", ")})`,
  );
}

/** The data ref `ref` of `database` as the rest of the server sees it (design D1). */
export const qualifyDataRef = (database: string, ref: string) => `${database}:${ref}`;

/** `error` of `database`'s call, its message prefixed with the database; an abort passes unchanged. */
function inDatabase(database: string, error: unknown, abort: AbortSignal | undefined): unknown {
  if (abort?.aborted) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`database ${database}: ${message}`, { cause: error });
}

/**
 * One adapter over several databases of one cluster (add-adx-databases D2), each an `AdxSource`,
 * in configuration order. Every call goes to the database of its data ref with the bare ref;
 * listed signals come back with qualified refs. Optional methods exist only when every database's
 * source has them; `useQueue` reaches every source, so all databases share the server's one queue.
 */
export class MultiDatabaseSource implements SourceAdapter {
  readonly info: SourceInfo;
  private readonly sources: Map<string, AdxSource>;
  private readonly databases: string[];

  declare count?: Method<"count">;
  declare extent?: Method<"extent">;
  declare series?: Method<"series">;
  declare refExtent?: Method<"refExtent">;
  declare refCount?: Method<"refCount">;
  declare loggerGaps?: Method<"loggerGaps">;
  declare firstTimes?: Method<"firstTimes">;
  declare computedSeries?: Method<"computedSeries">;
  declare stateChanges?: Method<"stateChanges">;
  declare events?: Method<"events">;

  constructor(sources: Map<string, AdxSource>) {
    const [first] = sources.values();
    if (!first) throw new RangeError("MultiDatabaseSource: no database");
    this.sources = sources;
    this.databases = [...sources.keys()];
    this.info = {
      kind: first.info.kind,
      database: this.databases.join(", "),
      databases: this.databases,
      table: first.info.table,
      ...(first.info.eventsTable === undefined ? {} : { eventsTable: first.info.eventsTable }),
    };
    const members: SourceAdapter[] = [...sources.values()];
    const every = (name: keyof SourceAdapter) =>
      members.every((source) => typeof source[name] === "function");
    // `as Required<SourceAdapter>`: `every` checked the method on the routed source.
    const at = (dataRef: string) => {
      const { source, ref } = this.route(dataRef);
      return { source: source as SourceAdapter as Required<SourceAdapter>, ref };
    };
    if (every("count"))
      this.count = (ref, from, to, abort) => {
        const r = at(ref.dataRef);
        return r.source.count({ ...ref, dataRef: r.ref }, from, to, abort);
      };
    if (every("extent"))
      this.extent = (ref, scope, abort) => {
        const r = at(ref.dataRef);
        return r.source.extent({ ...ref, dataRef: r.ref }, this.bareScope(scope), abort);
      };
    if (every("series"))
      this.series = (ref, from, to, target, width, scope, abort) => {
        const r = at(ref.dataRef);
        return r.source.series(
          { ...ref, dataRef: r.ref },
          from,
          to,
          target,
          width,
          this.bareScope(scope),
          abort,
        );
      };
    if (every("refExtent"))
      this.refExtent = (dataRef, scope, abort) => {
        const r = at(dataRef);
        return r.source.refExtent(r.ref, this.bareScope(scope), abort);
      };
    if (every("refCount"))
      this.refCount = (dataRef, scope, abort) => {
        const r = at(dataRef);
        return r.source.refCount(r.ref, this.bareScope(scope), abort);
      };
    if (every("loggerGaps"))
      this.loggerGaps = (dataRef, grid, minGap, scope, abort) => {
        const r = at(dataRef);
        return r.source.loggerGaps(r.ref, grid, minGap, this.bareScope(scope), abort);
      };
    if (every("firstTimes"))
      this.firstTimes = (dataRef, names, rows, scope, abort) => {
        const r = at(dataRef);
        return r.source.firstTimes(r.ref, names, rows, this.bareScope(scope), abort);
      };
    if (every("computedSeries"))
      this.computedSeries = (ref, from, to, target, width, abort) => {
        const r = at(ref.dataRef);
        return r.source.computedSeries(
          this.bareComputed(ref, r.ref),
          from,
          to,
          target,
          width,
          abort,
        );
      };
    if (every("stateChanges"))
      this.stateChanges = (ref, by, limit, scope, abort) => {
        const r = at(ref.dataRef);
        return r.source.stateChanges(
          { ...ref, dataRef: r.ref },
          by,
          limit,
          this.bareScope(scope),
          abort,
        );
      };
    if (every("events"))
      this.events = (dataRef, limit, scope, abort) => {
        const r = at(dataRef);
        return r.source.events(r.ref, limit, this.bareScope(scope), abort);
      };
  }

  /** The source of `dataRef`'s database and the bare ref; throws `UnknownDatabaseError`. */
  private route(dataRef: string): { source: AdxSource; ref: string } {
    const { database, ref } = splitDataRef(dataRef, this.databases);
    return { source: this.sources.get(database) as AdxSource, ref };
  }

  private bareScope(scope: Scope | undefined): Scope | undefined {
    return scope && { ...scope, dataRef: splitDataRef(scope.dataRef, this.databases).ref };
  }

  /** A computed signal's ref and its inputs with the bare ref (its inputs share its data ref). */
  private bareComputed(ref: ComputedRef, dataRef: string): ComputedRef {
    return {
      ...ref,
      dataRef,
      inputs: ref.inputs.map((input) => ({
        ...input,
        dataRef: splitDataRef(input.dataRef, this.databases).ref,
      })),
    };
  }

  useQueue(run: QueryRunner): void {
    for (const source of this.sources.values()) source.useQueue(run);
  }

  /** Pings every database at once; fails naming the first database (in configuration order) that failed. */
  async ping(abort: AbortSignal): Promise<void> {
    const results = await Promise.allSettled(
      [...this.sources.values()].map((source) => source.ping(abort)),
    );
    results.forEach((result, i) => {
      if (result.status === "rejected")
        throw inDatabase(this.databases[i] as string, result.reason, abort);
    });
  }

  /**
   * Scoped: the scope's database only. Unscoped (catalog mode `full`, design D4): every database
   * in parallel, merged in configuration order; one failing database fails the list, naming it.
   */
  async listSignals(scope?: Scope, abort?: AbortSignal): Promise<SourceSignal[]> {
    const qualify = (database: string, signals: SourceSignal[]) =>
      signals.map((signal) => ({ ...signal, dataRef: qualifyDataRef(database, signal.dataRef) }));
    if (scope) {
      const { database, ref } = splitDataRef(scope.dataRef, this.databases);
      const source = this.sources.get(database) as AdxSource;
      return qualify(database, await source.listSignals({ ...scope, dataRef: ref }, abort));
    }
    const lists = await Promise.all(
      [...this.sources].map(([database, source]) =>
        source.listSignals(undefined, abort).then(
          (signals) => qualify(database, signals),
          (error: unknown) => {
            throw inDatabase(database, error, abort);
          },
        ),
      ),
    );
    return lists.flat();
  }

  raw(...[ref, from, to, limit, abort]: Parameters<SourceAdapter["raw"]>) {
    const r = this.route(ref.dataRef);
    return r.source.raw({ ...ref, dataRef: r.ref }, from, to, limit, abort);
  }

  before(...[ref, t, scope, abort]: Parameters<SourceAdapter["before"]>) {
    const r = this.route(ref.dataRef);
    return r.source.before({ ...ref, dataRef: r.ref }, t, this.bareScope(scope), abort);
  }

  after(...[ref, t, scope, abort]: Parameters<SourceAdapter["after"]>) {
    const r = this.route(ref.dataRef);
    return r.source.after({ ...ref, dataRef: r.ref }, t, this.bareScope(scope), abort);
  }

  buckets(...[ref, from, to, width, abort]: Parameters<SourceAdapter["buckets"]>) {
    const r = this.route(ref.dataRef);
    return r.source.buckets({ ...ref, dataRef: r.ref }, from, to, width, abort);
  }

  refBuckets(...[dataRef, width, times, scope, abort]: Parameters<SourceAdapter["refBuckets"]>) {
    const r = this.route(dataRef);
    return r.source.refBuckets(r.ref, width, times, this.bareScope(scope), abort);
  }
}

/** An optional contract method, present. */
type Method<K extends keyof SourceAdapter> = NonNullable<SourceAdapter[K]>;
