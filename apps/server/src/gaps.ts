import {
  type GapInfo,
  LOGGER_GAP_GRID,
  LOGGER_GAP_MIN,
  measurePeriod,
  PERIOD_SAMPLE_ROWS,
  type SignalInfo,
  type SignalPeriod,
  staticPeriod,
} from "@kipscope/shared";
import type { DataSource } from "./datasource.ts";

type GapSource = Pick<DataSource, "refCount" | "loggerGaps" | "firstTimes">;

interface GapCatalog {
  readonly loadedAt: Date | undefined;
  all(): readonly SignalInfo[];
}

interface Entry {
  loadedAt: Date | undefined;
  promise: Promise<GapInfo>;
  /** The data ref's row count taken before the computation; set once it succeeded (design G9 (b)). */
  count?: number;
}

/**
 * Gap info of a data ref (logger gaps, periods, `through`), computed at most once per catalog load
 * (spec data-gaps, design G6), like the `DensityCache`: concurrent requests share one computation,
 * a failed one is dropped, and a new `loadedAt` makes the next request compute again. The
 * computation ignores client aborts, since it is shared. `refresh` recomputes a data ref whose row
 * count changed since (design G9 (b)).
 */
export class GapCache {
  private readonly source: GapSource;
  private readonly catalog: GapCatalog;
  private readonly entries = new Map<string, Entry>();

  constructor(source: GapSource, catalog: GapCatalog) {
    this.source = source;
    this.catalog = catalog;
  }

  get(dataRef: string): Promise<GapInfo> {
    const loadedAt = this.catalog.loadedAt;
    const cached = this.entries.get(dataRef);
    if (cached && cached.loadedAt === loadedAt) return cached.promise;
    const entry = this.start(dataRef, loadedAt);
    this.entries.set(dataRef, entry);
    entry.promise.catch(() => {
      if (this.entries.get(dataRef) === entry) this.entries.delete(dataRef);
    });
    return entry.promise;
  }

  /**
   * Computes the gap info of each data ref in turn, not in parallel, so carserver sees one full
   * scan at a time. A failure is reported through `warn` and not cached; a newer catalog load
   * stops this run, since its own prefetch takes over.
   */
  async prefetch(dataRefs: Iterable<string>, warn: (message: string) => void): Promise<void> {
    const loadedAt = this.catalog.loadedAt;
    for (const dataRef of dataRefs) {
      if (this.catalog.loadedAt !== loadedAt) return;
      try {
        await this.get(dataRef);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`gap prefetch for ${dataRef} failed: ${message}`);
      }
    }
  }

  /**
   * One poll (design G9 (b)): for each data ref with gap info of the current catalog load, in turn:
   * refCount; when it differs from the count taken before that info was computed, compute anew.
   * The old info stays served until the new one is in; a failure goes to `warn` and keeps the old
   * info; a newer catalog load stops the run.
   */
  async refresh(dataRefs: Iterable<string>, warn: (message: string) => void): Promise<void> {
    const loadedAt = this.catalog.loadedAt;
    for (const dataRef of dataRefs) {
      if (this.catalog.loadedAt !== loadedAt) return;
      const old = this.entries.get(dataRef);
      if (!old || old.loadedAt !== loadedAt || old.count === undefined) continue;
      try {
        const count = await this.source.refCount(dataRef);
        if (count === old.count) continue;
        const next = this.start(dataRef, loadedAt, count);
        await next.promise;
        if (this.entries.get(dataRef) === old && this.catalog.loadedAt === loadedAt)
          this.entries.set(dataRef, next);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`gap refresh for ${dataRef} failed: ${message}`);
      }
    }
  }

  /** An entry whose `count` is set when its computation succeeds. */
  private start(dataRef: string, loadedAt: Date | undefined, count?: number): Entry {
    const entry = { loadedAt } as Entry;
    entry.promise = this.compute(dataRef, count).then((computed) => {
      entry.count = computed.count;
      return computed.info;
    });
    return entry;
  }

  /**
   * Takes the row count first (unless the caller just took it), so rows inserted during the
   * computation cause one more recompute at the next poll, never a missed one (design G9 (b)).
   */
  private async compute(
    dataRef: string,
    taken?: number,
  ): Promise<{ info: GapInfo; count: number }> {
    const count = taken ?? (await this.source.refCount(dataRef));
    const signals = this.catalog.all().filter((s) => s.dataRef === dataRef);
    const periods: Record<string, SignalPeriod> = {};
    const unknown: SignalInfo[] = [];
    for (const signal of signals) {
      const period = staticPeriod(signal);
      if (period) periods[signal.id] = { ns: period.ns.toString(), source: period.source };
      else unknown.push(signal);
    }
    // Both queries go through the query queue; firstTimes sends none for an empty list.
    const [logger, samples] = await Promise.all([
      this.source.loggerGaps(dataRef, LOGGER_GAP_GRID, LOGGER_GAP_MIN),
      this.source.firstTimes(
        dataRef,
        unknown.map((s) => s.name),
        PERIOD_SAMPLE_ROWS,
      ),
    ]);
    for (const signal of unknown) {
      const times = samples.get(signal.name);
      const ns = times && measurePeriod(times);
      if (ns !== undefined) periods[signal.id] = { ns: ns.toString(), source: "measured" };
    }
    const info: GapInfo = {
      dataRef,
      logger: logger.gaps.map((g) => ({ from: g.from.toString(), to: g.to.toString() })),
      periods,
    };
    if (logger.last !== undefined) info.through = logger.last.toString();
    return { info, count };
  }
}
