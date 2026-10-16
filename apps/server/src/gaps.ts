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

type GapSource = Pick<DataSource, "loggerGaps" | "firstTimes">;

interface GapCatalog {
  readonly loadedAt: Date | undefined;
  all(): readonly SignalInfo[];
}

interface Entry {
  loadedAt: Date | undefined;
  promise: Promise<GapInfo>;
}

/**
 * Gap info of a data ref (logger gaps, periods, `through`), computed at most once per catalog load
 * (spec data-gaps, design G6), like the `DensityCache`: concurrent requests share one computation,
 * a failed one is dropped, and a new `loadedAt` makes the next request compute again. The
 * computation ignores client aborts, since it is shared.
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
    const entry: Entry = { loadedAt, promise: this.compute(dataRef) };
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

  private async compute(dataRef: string): Promise<GapInfo> {
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
    return info;
  }
}
