import {
  type Density,
  densityWidth,
  driveGrid,
  findDrives,
  floorDiv,
  type GridBucket,
} from "@kipscope/shared";
import type { DataSource } from "./datasource.ts";

interface Entry {
  loadedAt: Date | undefined;
  promise: Promise<Density | undefined>;
}

/**
 * Density of a data ref, computed at most once per catalog load (spec time-strip, design T7):
 * concurrent requests share one computation, a failed one is dropped, and a new `loadedAt` makes
 * the next request compute again. The computation ignores client aborts, since it is shared.
 */
export class DensityCache {
  private readonly source: Pick<DataSource, "refExtent" | "refBuckets">;
  private readonly loadedAt: () => Date | undefined;
  private readonly entries = new Map<string, Entry>();

  constructor(
    source: Pick<DataSource, "refExtent" | "refBuckets">,
    loadedAt: () => Date | undefined,
  ) {
    this.source = source;
    this.loadedAt = loadedAt;
  }

  get(dataRef: string): Promise<Density | undefined> {
    const loadedAt = this.loadedAt();
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
   * Computes the density of each data ref in turn, not in parallel (design Q4 (b)), so the first
   * request finds it cached or in flight. A failure is reported through `warn` and, like in `get`,
   * not cached; a newer catalog load stops this run, since its own prefetch takes over.
   */
  async prefetch(dataRefs: Iterable<string>, warn: (message: string) => void): Promise<void> {
    const loadedAt = this.loadedAt();
    for (const dataRef of dataRefs) {
      if (this.loadedAt() !== loadedAt) return;
      try {
        await this.get(dataRef);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`density prefetch for ${dataRef} failed: ${message}`);
      }
    }
  }

  private async compute(dataRef: string): Promise<Density | undefined> {
    const extent = await this.source.refExtent(dataRef);
    if (!extent) return undefined;
    const width = densityWidth(extent.first, extent.last);
    const start = floorDiv(extent.first, width) * width;
    const length = Number(floorDiv(extent.last, width) - floorDiv(extent.first, width) + 1n);
    const end = start + BigInt(length) * width;
    // One query on the drive grid gives both the bars and the drives (design S3 of add-strip-navigation).
    const grid = driveGrid(width);
    const counts = new Array<number>(length).fill(0);
    const kept: GridBucket[] = [];
    for (const bucket of await this.source.refBuckets(dataRef, grid)) {
      // Rows written between the two queries may fall outside the extent; they are left out.
      if (bucket.start < start || bucket.start >= end) continue;
      kept.push(bucket);
      const i = Number((bucket.start - start) / width);
      counts[i] = (counts[i] ?? 0) + bucket.count;
    }
    const drives = findDrives(kept, grid).map((d) => ({
      from: d.from.toString(),
      to: d.to.toString(),
      rows: d.rows,
    }));
    return {
      dataRef,
      first: extent.first.toString(),
      last: extent.last.toString(),
      width: width.toString(),
      start: start.toString(),
      counts,
      grid: grid.toString(),
      drives,
    };
  }
}
