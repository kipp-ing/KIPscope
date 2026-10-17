import {
  CATEGORY_TEXT,
  type DiagEvent,
  EVENT_CATEGORIES,
  type EventCategory,
} from "@kipscope/shared";
import type { Range } from "../chart/zoom.ts";
import { formatDate } from "../time/axis.ts";

// Pure helpers of the events list in the sidebar (design V8 of add-events; P2 of improve-events).

/** Rows the list shows at most; the rest is `<k> more — narrow the filter`. */
export const MAX_LIST_ROWS = 500;

/** The first `max` events and how many are left out. */
export function listRows(
  events: readonly DiagEvent[],
  max = MAX_LIST_ROWS,
): { rows: DiagEvent[]; more: number } {
  return { rows: events.slice(0, max), more: Math.max(0, events.length - max) };
}

/** A DTC row is a fault memory read: its time is when the memory was read, not when the fault occurred (data fact: smart451's 55 DTCs share one time). */
export function isRead(e: DiagEvent): boolean {
  return e.kind === "dtc";
}

export type ListItem =
  | { kind: "event"; event: DiagEvent }
  | { kind: "read"; t: string; source: string; events: DiagEvent[] };

/** Events in time order → items; consecutive DTCs of one source at one t (≥ 2) join one read item. Pure. */
export function listItems(events: readonly DiagEvent[]): ListItem[] {
  const items: ListItem[] = [];
  let i = 0;
  while (i < events.length) {
    const e = events[i] as DiagEvent;
    let j = i + 1;
    if (isRead(e)) {
      while (j < events.length) {
        const n = events[j] as DiagEvent;
        if (!isRead(n) || n.source !== e.source || n.t !== e.t) break;
        j++;
      }
    }
    if (j - i >= 2) {
      items.push({ kind: "read", t: e.t, source: e.source, events: events.slice(i, j) });
    } else {
      items.push({ kind: "event", event: e });
    }
    i = j;
  }
  return items;
}

const itemT = (item: ListItem) => (item.kind === "read" ? item.t : item.event.t);

/** Consecutive items of one local date (formatDate of time/axis.ts), in item order. */
export function dayBands(items: readonly ListItem[]): { day: string; items: ListItem[] }[] {
  const bands: { day: string; items: ListItem[] }[] = [];
  for (const item of items) {
    const day = formatDate(BigInt(itemT(item)));
    const last = bands.at(-1);
    if (last?.day === day) last.items.push(item);
    else bands.push({ day, items: [item] });
  }
  return bands;
}

/** Events with range.from ≤ t < range.to. */
export function inView(events: readonly DiagEvent[], range: Range): DiagEvent[] {
  return events.filter((e) => {
    const t = BigInt(e.t);
    return range.from <= t && t < range.to;
  });
}

/** Counts of the events before the range and from its end on, and the nearest one of each side. */
export function outside(
  events: readonly DiagEvent[],
  range: Range,
): { earlier: number; later: number; before?: DiagEvent; after?: DiagEvent } {
  let earlier = 0;
  let later = 0;
  let before: DiagEvent | undefined;
  let after: DiagEvent | undefined;
  for (const e of events) {
    const t = BigInt(e.t);
    if (t < range.from) {
      earlier++;
      if (!before || t >= BigInt(before.t)) before = e;
    } else if (t >= range.to) {
      later++;
      if (!after || t < BigInt(after.t)) after = e;
    }
  }
  return { earlier, later, ...(before && { before }), ...(after && { after }) };
}

/**
 * E-2: from a (when range.from ≤ a < range.to) the first event with t > a (dir 1) or the last with
 * t < a (dir −1); without such an a, the first with t ≥ range.from (1) or the last with t < range.to
 * (−1). Strict comparisons make events at one time one stop. Pure; events in time order.
 */
export function stepEvent(
  events: readonly DiagEvent[],
  range: Range,
  a: bigint | undefined,
  dir: 1 | -1,
): DiagEvent | undefined {
  const from = a !== undefined && range.from <= a && a < range.to ? a : undefined;
  if (dir === 1) {
    return events.find((e) => {
      const t = BigInt(e.t);
      return from === undefined ? t >= range.from : t > from;
    });
  }
  return events.findLast((e) => BigInt(e.t) < (from ?? range.to));
}

/** Row name: kind `signal` → source (the shown name); name starting with `<source>.` → name; else `<source> <name>`. */
export function rowName(e: DiagEvent): string {
  if (e.kind === "signal") return e.source;
  if (e.name.startsWith(`${e.source}.`)) return e.name;
  return `${e.source} ${e.name}`;
}

/**
 * Read item line 2: `<source> · <per category of item.events, most severe first: "<n> <one|many>",
 * joined ", "> · <k> DTCs read`, k = DTCs of the same source and t in `all` (the unfiltered list).
 */
export function readSummary(
  item: Extract<ListItem, { kind: "read" }>,
  all: readonly DiagEvent[],
): string {
  const counts = new Map<EventCategory, number>();
  for (const e of item.events) counts.set(e.category, (counts.get(e.category) ?? 0) + 1);
  const parts = EVENT_CATEGORIES.flatMap((c) => {
    const n = counts.get(c);
    return n ? [`${n} ${n === 1 ? CATEGORY_TEXT[c].one : CATEGORY_TEXT[c].many}`] : [];
  });
  const read = all.filter((e) => isRead(e) && e.source === item.source && e.t === item.t).length;
  return `${item.source} · ${parts.join(", ")} · ${read} DTCs read`;
}
