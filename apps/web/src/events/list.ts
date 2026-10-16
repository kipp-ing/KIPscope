import type { DiagEvent } from "@kipscope/shared";
import { formatDate } from "../time/axis.ts";

// Pure helpers of the events list in the sidebar (design V8 of add-events).

/** Rows the list shows at most; the rest is `<k> more — narrow the filter`. */
export const MAX_LIST_ROWS = 500;

/** The first `max` events and how many are left out. */
export function listRows(
  events: readonly DiagEvent[],
  max = MAX_LIST_ROWS,
): { rows: DiagEvent[]; more: number } {
  return { rows: events.slice(0, max), more: Math.max(0, events.length - max) };
}

/** Consecutive rows of one local date (formatDate of time/axis.ts), in row order. */
export function dayBands(rows: readonly DiagEvent[]): { day: string; rows: DiagEvent[] }[] {
  const bands: { day: string; rows: DiagEvent[] }[] = [];
  for (const e of rows) {
    const day = formatDate(BigInt(e.t));
    const last = bands.at(-1);
    if (last?.day === day) last.rows.push(e);
    else bands.push({ day, rows: [e] });
  }
  return bands;
}
