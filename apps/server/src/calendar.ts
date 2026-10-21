import {
  CALENDAR_GRID_NS,
  CALENDAR_HOUR_NS,
  type CalendarDensity,
  findDrives,
  type GridBucket,
  MAX_CALENDAR_WINDOWS,
} from "@kipscope/shared";
import type { DataSource, Scope } from "./datasource.ts";
import { type CacheScope, plainScope, scopeCacheKey } from "./density.ts";
import { currentPriority, Priority, withPriority } from "./priority.ts";

interface Entry {
  loadedAt: Date | undefined;
  /** Class of the computation's query: the starting caller's, raised by each joining one. */
  priority: Priority;
  promise: Promise<CalendarDensity>;
}

/**
 * Calendar densities of the range picker (spec range-picker, design R3 of add-range-picker),
 * modelled on `DensityCache`: one per scope (or data ref) and window, computed at most once per
 * catalog load (`loadedAt(scope)`); concurrent requests share one computation, a failed one is
 * dropped, and at most MAX_CALENDAR_WINDOWS are kept, least recently used dropped. The query runs
 * in the class of the caller that started it, raised to that of any caller that joins.
 */
export class CalendarCache {
  private readonly source: Pick<DataSource, "refBuckets">;
  private readonly loadedAt: (scope?: CacheScope) => Date | undefined;
  /** Least recently used first. */
  private readonly entries = new Map<string, Entry>();

  constructor(
    source: Pick<DataSource, "refBuckets">,
    loadedAt: (scope?: CacheScope) => Date | undefined,
  ) {
    this.source = source;
    this.loadedAt = loadedAt;
  }

  /**
   * The calendar of `dataRef` over `[from, to)`, cut to `scope` (whose data ref the caller made
   * sure is `dataRef`). An empty cut answers zeros without a source call.
   */
  get(dataRef: string, from: bigint, to: bigint, scope?: CacheScope): Promise<CalendarDensity> {
    const window = cut({ dataRef, from, to }, scope && plainScope(scope));
    if (!window) return Promise.resolve(calendar(dataRef, from, to, [], scope));
    const loadedAt = this.loadedAt(scope);
    const key = `${scope ? scopeCacheKey(scope) : dataRef}\n${from} ${to}`;
    const map = this.entries;
    const cached = map.get(key);
    // An object scope's rows, not its signal list, make the calendar (as its density, K11).
    if (cached && scope?.object && cached.loadedAt === undefined) cached.loadedAt = loadedAt;
    if (cached && cached.loadedAt === loadedAt) {
      cached.priority.raise(currentPriority().cls);
      map.delete(key);
      map.set(key, cached);
      return cached.promise;
    }
    const priority = new Priority(currentPriority().cls);
    const entry: Entry = {
      loadedAt,
      priority,
      promise: withPriority(priority, () => this.compute(dataRef, from, to, window, scope)),
    };
    map.delete(key);
    map.set(key, entry);
    entry.promise.catch(() => {
      if (map.get(key) === entry) map.delete(key);
    });
    for (const old of map.keys()) {
      if (map.size <= MAX_CALENDAR_WINDOWS) break;
      map.delete(old);
    }
    return entry.promise;
  }

  /** One bucket query on the 60 s grid with the window as scope, never without one, no extent (R3). */
  private async compute(
    dataRef: string,
    from: bigint,
    to: bigint,
    window: Scope,
    scope: CacheScope | undefined,
  ): Promise<CalendarDensity> {
    const buckets = await this.source.refBuckets(dataRef, CALENDAR_GRID_NS, false, window);
    return calendar(dataRef, from, to, buckets, scope, window);
  }
}

/** A source scope cut to another one; undefined when they do not overlap. */
function cut(range: Scope, scope: Scope | undefined): Scope | undefined {
  if (!scope) return range;
  const from = range.from > scope.from ? range.from : scope.from;
  const to = range.to < scope.to ? range.to : scope.to;
  return to > from ? { dataRef: range.dataRef, from, to } : undefined;
}

/**
 * Rows per hour from `from` and the drives of the 60 s grid buckets, edges cut to the window.
 * `from` is a multiple of 60 s, so each grid bucket lies in one hour slot.
 */
function calendar(
  dataRef: string,
  from: bigint,
  to: bigint,
  buckets: readonly GridBucket[],
  scope: CacheScope | undefined,
  window?: Scope,
): CalendarDensity {
  const length = Number((to - from + CALENDAR_HOUR_NS - 1n) / CALENDAR_HOUR_NS);
  const hours = new Array<number>(length).fill(0);
  const kept: GridBucket[] = [];
  for (const bucket of buckets) {
    if (bucket.start < from || bucket.start >= to) continue;
    kept.push(bucket);
    const i = Number((bucket.start - from) / CALENDAR_HOUR_NS);
    hours[i] = (hours[i] ?? 0) + bucket.count;
  }
  const drives = findDrives(kept, CALENDAR_GRID_NS).map((d) => {
    // A drive's last grid bucket may end after the window; its drive does not.
    const start = window && d.from < window.from ? window.from : d.from;
    const end = window && d.to > window.to ? window.to : d.to;
    return { from: start.toString(), to: end.toString(), rows: d.rows };
  });
  const body: CalendarDensity = {
    dataRef,
    from: from.toString(),
    to: to.toString(),
    hours,
    drives,
  };
  if (scope) body.scope = { from: scope.from.toString(), to: scope.to.toString() };
  return body;
}
