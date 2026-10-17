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
import type { DataSource, StateChangeRule } from "./datasource.ts";
import { ScanLimitError, STATE_SCAN_MAX } from "./fallbacks.ts";

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
  promise: Promise<T>;
}

type EventsSource = Pick<DataSource, "events" | "stateChanges" | "info">;
type EventsCatalog = Pick<Catalog, "loadedAt" | "get" | "snaRanges">;

/**
 * Events of the data refs and of the events-line signals, each loaded at most once per catalog
 * load (spec events, design E3), like the density: concurrent requests share one load, a failed one
 * is dropped, and a new `loadedAt` makes the next request load again. Loads ignore client aborts,
 * since they are shared. Warnings (missing table, waiting or stateless signals) go to `warn` once
 * per catalog load.
 */
export class EventsCache {
  private readonly source: EventsSource;
  private readonly catalog: EventsCatalog;
  private readonly warn: (message: string) => void;
  private readonly tables = new Map<string, Entry<TableEvents>>();
  private readonly signals = new Map<string, Entry<DiagEvent[] | SkipReason>>();
  private warned = { loadedAt: undefined as Date | undefined, keys: new Set<string>() };

  constructor(
    source: EventsSource,
    catalog: EventsCatalog,
    warn: (message: string) => void = () => {},
  ) {
    this.source = source;
    this.catalog = catalog;
    this.warn = warn;
  }

  /** The data ref's table events; none when the events table does not exist. */
  table(dataRef: string): Promise<TableEvents> {
    return this.cached(this.tables, dataRef, () => this.loadTable(dataRef));
  }

  /** The events of one events-line signal, or why it is skipped. */
  signal(signalId: string): Promise<DiagEvent[] | SkipReason> {
    return this.cached(this.signals, signalId, () => this.loadSignal(signalId));
  }

  /**
   * Loads each data ref's table events, then each signal's events, in turn (like the density
   * prefetch), so the first request finds them cached or in flight. A failure is reported through
   * `warn` and not cached; a newer catalog load stops this run, since its own prefetch takes over.
   */
  async prefetch(
    dataRefs: Iterable<string>,
    signals: Iterable<string>,
    warn: (message: string) => void,
  ): Promise<void> {
    const loadedAt = this.catalog.loadedAt;
    const jobs: [string, () => Promise<unknown>][] = [];
    for (const dataRef of dataRefs) jobs.push([dataRef, () => this.table(dataRef)]);
    for (const id of signals) jobs.push([id, () => this.signal(id)]);
    for (const [key, job] of jobs) {
      if (this.catalog.loadedAt !== loadedAt) return;
      try {
        await job();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        warn(`events prefetch for ${key} failed: ${message}`);
      }
    }
  }

  private cached<T>(map: Map<string, Entry<T>>, key: string, load: () => Promise<T>): Promise<T> {
    const loadedAt = this.catalog.loadedAt;
    const hit = map.get(key);
    if (hit && hit.loadedAt === loadedAt) return hit.promise;
    const entry: Entry<T> = { loadedAt, promise: load() };
    map.set(key, entry);
    entry.promise.catch(() => {
      if (map.get(key) === entry) map.delete(key);
    });
    return entry.promise;
  }

  /** Warns once per catalog load per key; nothing before the first load. */
  private warnOnce(key: string, message: string) {
    const loadedAt = this.catalog.loadedAt;
    if (!loadedAt) return;
    if (this.warned.loadedAt !== loadedAt) this.warned = { loadedAt, keys: new Set() };
    if (this.warned.keys.has(key)) return;
    this.warned.keys.add(key);
    this.warn(message);
  }

  private async loadTable(dataRef: string): Promise<TableEvents> {
    // One row more than the cap tells a full table from a truncated one (design E3).
    const rows = await this.source.events(dataRef, MAX_EVENTS + 1);
    if (!rows) {
      const table = this.source.info.eventsTable ?? "the events table";
      this.warnOnce("table", `events: ${table} does not exist; no events`);
      return { events: [], truncated: false, names: new Set() };
    }
    const truncated = rows.length > MAX_EVENTS;
    const kept = truncated ? rows.slice(0, MAX_EVENTS) : rows;
    const names = new Set(kept.filter((r) => r.kind === "state").map((r) => r.name));
    return { events: deriveEvents(kept), truncated, names };
  }

  private async loadSignal(signalId: string): Promise<DiagEvent[] | SkipReason> {
    const info = this.catalog.get(signalId);
    if (!info) {
      this.warnOnce(
        signalId,
        `events line: ${signalId} is not in the catalog yet; it shows once recorded`,
      );
      return "not_in_catalog";
    }
    if (!info.states) {
      this.warnOnce(signalId, `events line: ${signalId} has no states; it is left out`);
      return "no_states";
    }
    // A diag state of the same name already marks these changes (design E7).
    const table = await this.table(info.dataRef);
    if (table.names.has(info.name)) return "in_events_table";
    // First row plus MAX_SIGNAL_CHANGES changes are allowed; one more row means too many.
    let rows: Awaited<ReturnType<EventsSource["stateChanges"]>>;
    try {
      rows = await this.source.stateChanges(
        { dataRef: info.dataRef, name: info.name, sna: this.catalog.snaRanges(signalId) },
        changeRule(info),
        MAX_SIGNAL_CHANGES + 2,
      );
    } catch (error) {
      // The state-change fallback reads at most STATE_SCAN_MAX points (data-source "Scan cap").
      if (!(error instanceof ScanLimitError)) throw error;
      this.warnOnce(
        `${signalId}:scan`,
        `events line: ${signalId} has more than ${STATE_SCAN_MAX.toLocaleString("en")} points; the source's adapter should implement stateChanges`,
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
