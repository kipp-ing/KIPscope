import { formatCursorNumber } from "./cursor.ts";
import { type SignalInfo, shownName } from "./signals.ts";
import { stateLabel } from "./states.ts";

/**
 * Severity order (most severe first): cluster colour, tooltip order, describe order (D-058,
 * design E2).
 */
export const EVENT_CATEGORIES = [
  "active",
  "pending",
  "stored",
  "change",
  "refused",
  "transport",
  "untested",
  "passed",
  "snapshot",
  "other",
] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** Chip and tooltip label, singular and plural noun (describe, tooltips). */
export const CATEGORY_TEXT: Record<EventCategory, { label: string; one: string; many: string }> = {
  active: { label: "Active fault", one: "active fault", many: "active faults" },
  pending: { label: "Pending fault", one: "pending fault", many: "pending faults" },
  stored: { label: "Stored fault", one: "stored fault", many: "stored faults" },
  change: { label: "State change", one: "state change", many: "state changes" },
  refused: { label: "Request refused", one: "refused request", many: "refused requests" },
  transport: { label: "Transport error", one: "transport error", many: "transport errors" },
  untested: { label: "Not tested", one: "untested DTC", many: "untested DTCs" },
  passed: { label: "Passed", one: "passed DTC", many: "passed DTCs" },
  snapshot: { label: "Snapshot", one: "state snapshot", many: "state snapshots" },
  other: { label: "Other", one: "other event", many: "other events" },
};

/** One event as the UI and CLI see it. Times decimal ns. */
export interface DiagEvent {
  t: string;
  category: EventCategory;
  /** Source kind as stored (`dtc`, `state`, `nrc`, `isotp`, …), or `signal` for an events-line signal. */
  kind: string;
  /** ECU as stored; for kind `signal` the signal's shown name. */
  source: string;
  /** DTC code, state name, `SID 22`, …; for kind `signal` the signal name. */
  name: string;
  /** Description, state (name), NRC name; "" when none. */
  text: string;
  /** As stored; "" when none. */
  detail: string;
  value: number;
  /** kind `dtc` with a status byte: dtcStatusText(value). */
  status?: string;
  /** category `change`: the previous state and the time it was last seen. */
  from?: { text: string; t: string };
  /** category `change` seen after a gap (E6, E7; D-058 Q6). */
  inferred?: true;
  /** kind `signal`. */
  signalId?: string;
}

export type SkipReason = "not_in_catalog" | "no_states" | "too_many_changes" | "in_events_table";

/** Body of GET /api/events (D-058). */
export interface EventList {
  dataRef: string;
  /** Events in [from, to) (all when no range) before the filter. */
  total: number;
  counts: Partial<Record<EventCategory, number>>;
  /** By count descending, then name. */
  sources: { source: string; count: number }[];
  /** Normal form of the applied filter; absent when none was given. */
  filter?: string;
  /** Passing events, time order (ties: kind, source, name). */
  events: DiagEvent[];
  skipped: { signalId: string; reason: SkipReason }[];
  /** The data ref held more than MAX_EVENTS table events. */
  truncated?: true;
}

/** Table events kept per data ref (design E3). */
export const MAX_EVENTS = 100_000;
/** Changes of one events-line signal above which it is skipped (design E7, D-059). */
export const MAX_SIGNAL_CHANGES = 2_000;
/** A change after more than this without rows is inferred (E7), ns: 5 min. */
export const STATE_GAP = 300_000_000_000n;

/** Input row of deriveEvents (from the source, times decimal ns). */
export interface EventRow {
  t: string;
  source: string;
  kind: string;
  name: string;
  value: number;
  text: string;
  detail: string;
}

/** One changed row of a signal (E7); `prev` absent on its first row. Times decimal ns. */
export interface StateRow {
  t: string;
  value: number;
  text: string;
  prev?: { t: string; value: number; text: string };
}

/** ISO 14229-1 DTC status bits, bit order (design E5). */
const STATUS_BITS = [
  "failing now",
  "failed this cycle",
  "pending",
  "confirmed",
  "not tested since clear",
  "failed since clear",
  "not tested this cycle",
  "warning lamp",
];

const isStatusByte = (v: number) => Number.isInteger(v) && v >= 0 && v <= 255;

/**
 * Category of a DTC status byte (design E5): "failing now" beats everything, pending before
 * stored (the fresher news), 0x80 without 0x08 counts as stored, "not tested" only when nothing
 * failed; not a byte → `other`.
 */
export function dtcCategory(value: number): EventCategory {
  if (!isStatusByte(value)) return "other";
  if (value & 0x01) return "active";
  if (value & 0x06) return "pending";
  if (value & 0xa8) return "stored";
  if (value & 0x50) return "untested";
  return "passed";
}

/** `0x29 failing now · confirmed · failed since clear`; `0x00` without bits; undefined outside 0…255. */
export function dtcStatusText(value: number): string | undefined {
  if (!isStatusByte(value)) return undefined;
  const hex = `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
  const names = STATUS_BITS.filter((_, bit) => value & (1 << bit));
  return names.length > 0 ? `${hex} ${names.join(" · ")}` : hex;
}

/**
 * Rows in time order → events (design E5, E6); pure. A state row is a change when its detail
 * reads `from <state>`, or (inferred) when its text differs from the last row of the same source
 * and name (D-058 Q6); else a snapshot.
 */
export function deriveEvents(rows: readonly EventRow[]): DiagEvent[] {
  const last = new Map<string, { text: string; t: string }>();
  return rows.map((row) => {
    const event: DiagEvent = {
      t: row.t,
      category: "other",
      kind: row.kind,
      source: row.source,
      name: row.name,
      text: row.text,
      detail: row.detail,
      value: row.value,
    };
    if (row.kind === "state") {
      const key = `${row.source}\u0000${row.name}`;
      const previous = last.get(key);
      if (row.detail.startsWith("from ")) {
        event.category = "change";
        event.from = { text: row.detail.slice(5), t: previous?.t ?? row.t };
      } else if (previous && previous.text !== row.text) {
        event.category = "change";
        event.from = previous;
        event.inferred = true;
      } else event.category = "snapshot";
      last.set(key, { text: row.text, t: row.t });
    } else if (row.kind === "dtc") {
      event.category = dtcCategory(row.value);
      const status = dtcStatusText(row.value);
      if (status !== undefined) event.status = status;
    } else if (row.kind === "nrc") event.category = "refused";
    else if (row.kind === "isotp") event.category = "transport";
    return event;
  });
}

/** State name of a signal value: the row text of a text signal, else the label or the number. */
function stateText(info: SignalInfo, value: number, text: string): string {
  if (info.states === "text") return text;
  return stateLabel(info, value) ?? formatCursorNumber(value);
}

/**
 * One events-line signal's changed rows (design E7, D-059) → events; pure. The first row is a
 * snapshot, each other a change from its previous row, inferred after more than STATE_GAP.
 */
export function signalEvents(info: SignalInfo, rows: readonly StateRow[]): DiagEvent[] {
  return rows.map((row) => {
    const event: DiagEvent = {
      t: row.t,
      category: row.prev ? "change" : "snapshot",
      kind: "signal",
      source: shownName(info),
      name: info.name,
      text: stateText(info, row.value, row.text),
      detail: "",
      value: row.value,
    };
    if (row.prev) {
      event.from = { text: stateText(info, row.prev.value, row.prev.text), t: row.prev.t };
      if (BigInt(row.t) - BigInt(row.prev.t) > STATE_GAP) event.inferred = true;
    }
    event.signalId = info.id;
    return event;
  });
}

/** Time order; ties by kind, source, name (as the events query, design E4). */
function compareEvents(a: DiagEvent, b: DiagEvent): number {
  const ta = BigInt(a.t);
  const tb = BigInt(b.t);
  if (ta !== tb) return ta < tb ? -1 : 1;
  for (const key of ["kind", "source", "name"] as const) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  return 0;
}

/** Merge in time order with the tie rule; pure (stable for equal events). */
export function mergeEvents(...lists: readonly DiagEvent[][]): DiagEvent[] {
  return lists.flat().sort(compareEvents);
}
