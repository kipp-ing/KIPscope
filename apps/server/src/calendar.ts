import {
  CALENDAR_GRID_NS,
  CALENDAR_HOUR_NS,
  type CalendarDensity,
  findDrives,
  type GridBucket,
  MAX_CALENDAR_WINDOWS,
} from "@kipscope/shared";
import type { CalendarDays } from "./calendarDays.ts";
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
 * modelled on `DensityCache`. A plain scope takes one bucket query (the route checked the scan
 * bound first): computed at most once per
 * catalog load (`loadedAt(scope)`), concurrent requests share one computation, a failed one is
 * dropped, and at most MAX_CALENDAR_WINDOWS are kept, least recently used dropped. The query runs
 * in the class of the caller that started it, raised to that of any caller that joins. An object
 * scope, or full mode without a scope, answers at once from the counted vehicle-days with the
 * days not counted yet as `pending`, and never raises their `idle` counting (design B6, D-118).
 */
export class CalendarCache {
  private readonly source: Pick<DataSource, "refBuckets">;
  private readonly loadedAt: (scope?: CacheScope) => Date | undefined;
  private readonly days: Pick<CalendarDays, "window">;
  /** Least recently used first. */
  private readonly entries = new Map<string, Entry>();

  constructor(
    source: Pick<DataSource, "refBuckets">,
    loadedAt: (scope?: CacheScope) => Date | undefined,
    days: Pick<CalendarDays, "window">,
  ) {
    this.source = source;
    this.loadedAt = loadedAt;
    this.days = days;
  }

  /**
   * The calendar of `dataRef` over `[from, to)`, cut to `scope` (whose data ref the caller made
   * sure is `dataRef`). An empty cut answers zeros without a source call.
   */
  get(dataRef: string, from: bigint, to: bigint, scope?: CacheScope): Promise<CalendarDensity> {
    const window = cut({ dataRef, from, to }, scope && plainScope(scope));
    if (!window) return Promise.resolve(calendar(dataRef, from, to, [], scope));
    if (!scope || scope.object) {
      const days = this.days.window(dataRef, window.from, window.to);
      const body = calendar(dataRef, from, to, days.buckets, scope, window);
      if (days.pending.length > 0)
        body.pending = days.pending.map((p) => ({ from: p.from.toString(), to: p.to.toString() }));
      return Promise.resolve(body);
    }
    const loadedAt = this.loadedAt(scope);
    const key = `${scopeCacheKey(scope)}\n${from} ${to}`;
    const map = this.entries;
    const cached = map.get(key);
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
    scope: CacheScope,
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
