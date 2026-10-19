import {
  type DiagEvent,
  deriveEvents,
  labelTolerance,
  MAX_EVENTS,
  MAX_SIGNAL_CHANGES,
  type SignalInfo,
  type SkipReason,
  signalEvents,
  valueLabels,
} from "@kipscope/shared";
import type { Catalog } from "./catalog.ts";
import type { DataSource, Scope, StateChangeRule } from "./datasource.ts";
import { scopeCacheKey } from "./density.ts";
import { ScanLimitError, STATE_SCAN_MAX } from "./fallbacks.ts";
import { currentPriority, Priority, withPriority } from "./priority.ts";

/** Table events of one data ref (design E3). */
export interface TableEvents {
  events: DiagEvent[];
  /** The table held more than MAX_EVENTS rows with a time; the first MAX_EVENTS are kept. */
  truncated: boolean;
  /** Names of the `state` rows, for `in_events_table`. */
  names: Set<string>;
}

interface Entry<T> {
  loadedAt: Date | undefined;
  /** Class of the load's queries: the starting caller's, raised by each joining one. */
  priority: Priority;
  promise: Promise<T>;
}

type EventsSource = Pick<DataSource, "events" | "stateChanges" | "info">;
type EventsCatalog = Pick<Catalog, "loadedAt" | "get" | "snaRanges">;

/**
 * Events of the data refs and of the events-line signals, each loaded at most once per catalog
 * load (spec events, design E3), like the density: concurrent requests share one load, a failed one
 * is dropped, and a new `loadedAt` makes the next request load again. Loads ignore client aborts,
 * since they are shared, and run in the class of the caller that started them, raised to that of
 * any caller that joins (series-query design P4). Warnings (missing table, waiting or stateless signals) go to `warn` once
 * per catalog load. With a scope (add-scope Z9) every query carries it, loads are cached per scope
 * key and follow that scope's catalog (`catalogOf`, else the full one).
 */
export class EventsCache {
  private readonly source: EventsSource;
  private readonly catalog: EventsCatalog;
  private readonly warn: (message: string) => void;
  private readonly tables = new Map<string, Entry<TableEvents>>();
  private readonly signals = new Map<string, Entry<DiagEvent[] | SkipReason>>();
  private readonly catalogOf: (scope: Scope) => EventsCatalog | undefined;
  private warned = { loadedAt: undefined as Date | undefined, keys: new Set<string>() };

  constructor(
    source: EventsSource,
    catalog: EventsCatalog,
    warn: (message: string) => void = () => {},
    catalogOf: (scope: Scope) => EventsCatalog | undefined = () => undefined,
  ) {
    this.source = source;
    this.catalog = catalog;
    this.warn = warn;
    this.catalogOf = catalogOf;
  }

  /** The catalog the events of `scope` (or of whole data refs) are loaded against. */
  private catalogFor(scope?: Scope): EventsCatalog {
    return (scope && this.catalogOf(scope)) ?? this.catalog;
  }

  /** The data ref's table events (within `scope`, of that data ref); none without an events table. */
  table(dataRef: string, scope?: Scope): Promise<TableEvents> {
    const key = scope ? scopeCacheKey(scope) : dataRef;
    return this.cached(this.tables, key, scope, () => this.loadTable(dataRef, scope));
  }

  /** The events of one events-line signal (within `scope`), or why it is skipped. */
  signal(signalId: string, scope?: Scope): Promise<DiagEvent[] | SkipReason> {
    const key = scope ? `${scopeCacheKey(scope)}\n${signalId}` : signalId;
    return this.cached(this.signals, key, scope, () => this.loadSignal(signalId, scope));
  }

  /**
   * Loads each data ref's table events, then each signal's events, in turn (like the density
   * prefetch), so the first request finds them cached or in flight. A failure is reported through
   * `warn` and not cached; a newer catalog load stops this run, since its own prefetch takes over.
   * With `scope`: that scope's events (`dataRefs` its data ref, `signals` of it).
   */
  async prefetch(
    dataRefs: Iterable<string>,
    signals: Iterable<string>,
    warn: (message: string) => void,
    scope?: Scope,
  ): Promise<void> {
    const catalog = this.catalogFor(scope);
    const loadedAt = catalog.loadedAt;
    const jobs: [string, () => Promise<unknown>][] = [];
    for (const dataRef of dataRefs) jobs.push([dataRef, () => this.table(dataRef, scope)]);
    for (const id of signals) jobs.push([id, () => this.signal(id, scope)]);
    for (const [key, job] of jobs) {
      if (catalog.loadedAt !== loadedAt) return;
      try {
        await job();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`events prefetch for ${key} failed: ${message}`);
      }
    }
  }

  private cached<T>(
    map: Map<string, Entry<T>>,
    key: string,
    scope: Scope | undefined,
    load: () => Promise<T>,
  ): Promise<T> {
    const loadedAt = this.catalogFor(scope).loadedAt;
    const hit = map.get(key);
    if (hit && hit.loadedAt === loadedAt) {
      hit.priority.raise(currentPriority().cls);
      return hit.promise;
    }
    const priority = new Priority(currentPriority().cls);
    const entry: Entry<T> = { loadedAt, priority, promise: withPriority(priority, load) };
    map.set(key, entry);
    entry.promise.catch(() => {
      if (map.get(key) === entry) map.delete(key);
    });
    return entry.promise;
  }

  /** Warns once per catalog load per key; nothing before the first load. */
  private warnOnce(key: string, message: string, scope?: Scope) {
    const loadedAt = this.catalogFor(scope).loadedAt;
    if (!loadedAt) return;
    if (this.warned.loadedAt !== loadedAt) this.warned = { loadedAt, keys: new Set() };
    if (this.warned.keys.has(key)) return;
    this.warned.keys.add(key);
    this.warn(message);
  }

  private async loadTable(dataRef: string, scope?: Scope): Promise<TableEvents> {
    // One row more than the cap tells a full table from a truncated one (design E3).
    const rows = await this.source.events(dataRef, MAX_EVENTS + 1, scope);
    if (!rows) {
      const table = this.source.info.eventsTable ?? "the events table";
      this.warnOnce("table", `events: ${table} does not exist; no events`, scope);
      return { events: [], truncated: false, names: new Set() };
    }
    const truncated = rows.length > MAX_EVENTS;
    const kept = truncated ? rows.slice(0, MAX_EVENTS) : rows;
    const names = new Set(kept.filter((r) => r.kind === "state").map((r) => r.name));
    return { events: deriveEvents(kept), truncated, names };
  }

  private async loadSignal(signalId: string, scope?: Scope): Promise<DiagEvent[] | SkipReason> {
    const catalog = this.catalogFor(scope);
    const info = catalog.get(signalId);
    if (!info) {
      this.warnOnce(
        signalId,
        `events line: ${signalId} is not in the catalog yet; it shows once recorded`,
        scope,
      );
      return "not_in_catalog";
    }
    if (!info.states) {
      this.warnOnce(signalId, `events line: ${signalId} has no states; it is left out`, scope);
      return "no_states";
    }
    // A diag state of the same name already marks these changes (design E7).
    const table = await this.table(info.dataRef, scope);
    if (table.names.has(info.name)) return "in_events_table";
    // First row plus MAX_SIGNAL_CHANGES changes are allowed; one more row means too many.
    let rows: Awaited<ReturnType<EventsSource["stateChanges"]>>;
    try {
      rows = await this.source.stateChanges(
        { dataRef: info.dataRef, name: info.name, sna: catalog.snaRanges(signalId) },
        changeRule(info),
        MAX_SIGNAL_CHANGES + 2,
        scope,
      );
    } catch (error) {
      // The state-change fallback reads at most STATE_SCAN_MAX points (data-source "Scan cap").
      if (!(error instanceof ScanLimitError)) throw error;
      this.warnOnce(
        `${signalId}:scan`,
        `events line: ${signalId} has more than ${STATE_SCAN_MAX.toLocaleString("en")} points; the source's adapter should implement stateChanges`,
        scope,
      );
      return "too_many_changes";
    }
    if (rows.length > MAX_SIGNAL_CHANGES + 1) return "too_many_changes";
    return signalEvents(info, rows);
  }
}

/** Text signals change with their text; `VAL_` signals into or out of a named value (design E7). */
function changeRule(info: SignalInfo): StateChangeRule {
  if (info.states === "text") return { kind: "text" };
  return {
    kind: "labels",
    values: valueLabels(info).map((l) => l.value),
    tolerance: labelTolerance(info),
  };
}
