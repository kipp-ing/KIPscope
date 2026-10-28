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
import { type ScanBound, TooWideError } from "./scanBound.ts";

/** A scope as the caches take it: the source form, plus the object flag of an object scope (add-case-open K11). */
export type CacheScope = Scope & { object?: true };

/**
 * What part of a scope a density covers: a window inside it (K11). An object scope has no coarse
 * density over all of it (speed-up-whole-scans B5).
 */
export type DensityPart = { window: Scope };

/** Detail densities kept per cache (K11): least recently used dropped. */
export const MAX_DENSITY_WINDOWS = 8;

interface Entry {
  loadedAt: Date | undefined;
  /** Class of the computation's queries: the starting caller's, raised by each joining one. */
  priority: Priority;
  promise: Promise<Density | undefined>;
}

/** Cache key of a scope (add-scope Z9): `scopeKey` of its decimal-ns form, `|object` for an object scope. */
export function scopeCacheKey(scope: CacheScope): string {
  const key = { dataRef: scope.dataRef, from: scope.from.toString(), to: scope.to.toString() };
  return scopeKey(scope.object ? { ...key, object: true } : key);
}

/** The source form of a cache scope: no object flag goes to the source; a plain scope as it is. */
export const plainScope = (scope: CacheScope): Scope =>
  "object" in scope ? { dataRef: scope.dataRef, from: scope.from, to: scope.to } : scope;

/**
 * Density of a data ref, computed at most once per catalog load (spec time-strip, design T7):
 * concurrent requests share one computation, a failed one is dropped, and a new `loadedAt` makes
 * the next request compute again. The computation ignores client aborts, since it is shared. Its
 * queries run in the class of the caller that started it, raised to that of any caller that joins
 * (series-query design P4), so a request never waits behind the prefetch it joins. With a scope
 * (add-scope Z9) it covers the scope only, from one scoped `refBuckets`, cached by the scope's key
 * and dropped with that scope's catalog load (`loadedAt(scope)`). A window (`part`, add-case-open
 * K11) is kept per window, LRU 8. With `bound`, each computation checks its range first (the whole
 * data ref, the scope or the window) and sends no extent or bucket query when it is too wide
 * (speed-up-whole-scans B2); a TooWideError is not cached either.
 */
export class DensityCache {
  private readonly source: Pick<DataSource, "refExtent" | "refBuckets">;
  private readonly loadedAt: (scope?: CacheScope) => Date | undefined;
  private readonly bound: Pick<ScanBound, "check"> | undefined;
  private readonly entries = new Map<string, Entry>();
  /** Window densities, least recently used first. */
  private readonly windows = new Map<string, Entry>();

  constructor(
    source: Pick<DataSource, "refExtent" | "refBuckets">,
    loadedAt: (scope?: CacheScope) => Date | undefined,
    bound?: Pick<ScanBound, "check">,
  ) {
    this.source = source;
    this.loadedAt = loadedAt;
    this.bound = bound;
  }

  /**
   * The density of `dataRef`, or of `scope` (whose data ref the caller made sure is `dataRef`),
   * or of a window `part` the caller cut to the scope (K11).
   */
  get(dataRef: string, scope?: CacheScope, part?: DensityPart): Promise<Density | undefined> {
    const loadedAt = this.loadedAt(scope);
    const base = scope ? scopeCacheKey(scope) : dataRef;
    // Rows, not the signal list, make an object scope's density: one computed while the vehicle's
    // list still loads stays for that list's first load (K11, lazy list).
    const adopt = scope?.object === true;
    if (part) {
      const { window } = part;
      const key = `${base}\n${window.from} ${window.to}`;
      return this.cached(this.windows, key, loadedAt, adopt, () => this.computeScoped(window));
    }
    return this.cached(this.entries, base, loadedAt, adopt, () =>
      scope ? this.computeScoped(scope) : this.compute(dataRef),
    );
  }

  private cached(
    map: Map<string, Entry>,
    key: string,
    loadedAt: Date | undefined,
    adopt: boolean,
    compute: () => Promise<Density | undefined>,
  ): Promise<Density | undefined> {
    const cached = map.get(key);
    if (cached && adopt && cached.loadedAt === undefined) cached.loadedAt = loadedAt;
    if (cached && cached.loadedAt === loadedAt) {
      cached.priority.raise(currentPriority().cls);
      map.delete(key);
      map.set(key, cached);
      return cached.promise;
    }
    const priority = new Priority(currentPriority().cls);
    const entry: Entry = { loadedAt, priority, promise: withPriority(priority, compute) };
    map.delete(key);
    map.set(key, entry);
    entry.promise.catch(() => {
      if (map.get(key) === entry) map.delete(key);
    });
    if (map === this.windows) {
      for (const old of map.keys()) {
        if (map.size <= MAX_DENSITY_WINDOWS) break;
        map.delete(old);
      }
    }
    return entry.promise;
  }

  /**
   * Computes the density of each data ref in turn, not in parallel (design Q4 (b)), so the first
   * request finds it cached or in flight. A failure is reported through `warn` and, like in `get`,
   * not cached; a data ref over the bound is skipped silently, left to a request that answers
   * `too_wide`. A newer catalog load stops this run, since its own prefetch takes over.
   */
  async prefetch(dataRefs: Iterable<string>, warn: (message: string) => void): Promise<void> {
    const loadedAt = this.loadedAt();
    for (const dataRef of dataRefs) {
      if (this.loadedAt() !== loadedAt) return;
      try {
        await this.get(dataRef);
      } catch (error) {
        if (error instanceof TooWideError) continue;
        const message = error instanceof Error ? error.message : String(error);
        warn(`density prefetch for ${dataRef} failed: ${message}`);
      }
    }
  }

  private async compute(dataRef: string): Promise<Density | undefined> {
    await this.bound?.check(dataRef);
    const extent = await this.source.refExtent(dataRef);
    if (!extent) return undefined;
    // One query on the drive grid gives both the bars and the drives (design S3 of add-strip-navigation).
    const grid = driveGrid(densityWidth(extent.first, extent.last));
    const buckets = await this.source.refBuckets(dataRef, grid, false);
    return density(dataRef, extent.first, extent.last, buckets);
  }

  /** The scope's span, empty stretches included, from one scoped bucket query and no extent (Z9). */
  private async computeScoped(scope: Scope): Promise<Density> {
    await this.bound?.check(scope.dataRef, plainScope(scope));
    const last = scope.to - 1n;
    const grid = driveGrid(densityWidth(scope.from, last));
    const buckets = await this.source.refBuckets(scope.dataRef, grid, false, plainScope(scope));
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
