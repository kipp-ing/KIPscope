import {
  type Density,
  densityWidth,
  driveGrid,
  findDrives,
  floorDiv,
  type GridBucket,
  scopeKey,
} from "@kipscope/shared";
import type { DataSource, RefBucket, Scope } from "./datasource.ts";
import { currentPriority, Priority, withPriority } from "./priority.ts";

interface Entry {
  loadedAt: Date | undefined;
  /** Class of the computation's queries: the starting caller's, raised by each joining one. */
  priority: Priority;
  promise: Promise<Density | undefined>;
}

/** Cache key of a scope (add-scope Z9): `scopeKey` of its decimal-ns form. */
export function scopeCacheKey(scope: Scope): string {
  return scopeKey({ dataRef: scope.dataRef, from: scope.from.toString(), to: scope.to.toString() });
}

/**
 * Density of a data ref, computed at most once per catalog load (spec time-strip, design T7):
 * concurrent requests share one computation, a failed one is dropped, and a new `loadedAt` makes
 * the next request compute again. The computation ignores client aborts, since it is shared. Its
 * queries run in the class of the caller that started it, raised to that of any caller that joins
 * (series-query design P4), so a request never waits behind the prefetch it joins. With a scope
 * (add-scope Z9) it covers the scope only, from one scoped `refBuckets`, cached by the scope's key
 * and dropped with that scope's catalog load (`loadedAt(scope)`).
 */
export class DensityCache {
  private readonly source: Pick<DataSource, "refExtent" | "refBuckets">;
  private readonly loadedAt: (scope?: Scope) => Date | undefined;
  private readonly entries = new Map<string, Entry>();

  constructor(
    source: Pick<DataSource, "refExtent" | "refBuckets">,
    loadedAt: (scope?: Scope) => Date | undefined,
  ) {
    this.source = source;
    this.loadedAt = loadedAt;
  }

  /** The density of `dataRef`, or of `scope` (whose data ref the caller made sure is `dataRef`). */
  get(dataRef: string, scope?: Scope): Promise<Density | undefined> {
    const loadedAt = this.loadedAt(scope);
    const key = scope ? scopeCacheKey(scope) : dataRef;
    const cached = this.entries.get(key);
    if (cached && cached.loadedAt === loadedAt) {
      cached.priority.raise(currentPriority().cls);
      return cached.promise;
    }
    const priority = new Priority(currentPriority().cls);
    const entry: Entry = {
      loadedAt,
      priority,
      promise: withPriority(priority, () =>
        scope ? this.computeScoped(scope) : this.compute(dataRef),
      ),
    };
    this.entries.set(key, entry);
    entry.promise.catch(() => {
      if (this.entries.get(key) === entry) this.entries.delete(key);
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
    // One query on the drive grid gives both the bars and the drives (design S3 of add-strip-navigation).
    const grid = driveGrid(densityWidth(extent.first, extent.last));
    const buckets = await this.source.refBuckets(dataRef, grid, false);
    return density(dataRef, extent.first, extent.last, buckets);
  }

  /** The scope's span, empty stretches included, from one scoped bucket query and no extent (Z9). */
  private async computeScoped(scope: Scope): Promise<Density> {
    const last = scope.to - 1n;
    const grid = driveGrid(densityWidth(scope.from, last));
    const buckets = await this.source.refBuckets(scope.dataRef, grid, false, scope);
    const body = density(scope.dataRef, scope.from, last, buckets);
    const from = scope.from.toString();
    const to = scope.to.toString();
    // A grid bucket cut by an edge starts before the scope or ends after it; its drive does not.
    for (const drive of body.drives) {
      if (BigInt(drive.from) < scope.from) drive.from = from;
      if (BigInt(drive.to) > scope.to) drive.to = to;
    }
    body.scope = { from, to };
    return body;
  }
}

/** Bars over [first, last] and drives from the drive-grid buckets of a data ref. */
function density(
  dataRef: string,
  first: bigint,
  last: bigint,
  buckets: readonly RefBucket[],
): Density {
  const width = densityWidth(first, last);
  const start = floorDiv(first, width) * width;
  const length = Number(floorDiv(last, width) - floorDiv(first, width) + 1n);
  const end = start + BigInt(length) * width;
  const grid = driveGrid(width);
  const counts = new Array<number>(length).fill(0);
  const kept: GridBucket[] = [];
  for (const bucket of buckets) {
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
    first: first.toString(),
    last: last.toString(),
    width: width.toString(),
    start: start.toString(),
    counts,
    grid: grid.toString(),
    drives,
  };
}
