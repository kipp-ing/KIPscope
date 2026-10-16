import { type Density, densityWidth, floorDiv } from "@kipscope/shared";
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

  private async compute(dataRef: string): Promise<Density | undefined> {
    const extent = await this.source.refExtent(dataRef);
    if (!extent) return undefined;
    const width = densityWidth(extent.first, extent.last);
    const start = floorDiv(extent.first, width) * width;
    const length = Number(floorDiv(extent.last, width) - floorDiv(extent.first, width) + 1n);
    const counts = new Array<number>(length).fill(0);
    for (const bucket of await this.source.refBuckets(dataRef, width)) {
      const i = Number((bucket.start - start) / width);
      // Rows written between the two queries may fall outside the extent; they are left out.
      if (i >= 0 && i < length) counts[i] = (counts[i] ?? 0) + bucket.count;
    }
    return {
      dataRef,
      first: extent.first.toString(),
      last: extent.last.toString(),
      width: width.toString(),
      start: start.toString(),
      counts,
    };
  }
}
