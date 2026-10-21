/**
 * Calendar density of the range picker (spec range-picker "Calendar density", design R2 of
 * add-range-picker): rows per hour and the drives of one window of at most 32 days.
 */
import type { Drive } from "./series.ts";

/** Grid of the calendar's bucket query and drive search (R3). */
export const CALENDAR_GRID_NS = 60_000_000_000n;
/** Resolution of `hours`. */
export const CALENDAR_HOUR_NS = 3_600_000_000_000n;
/** Widest window of one request: WORK_SPAN_MAX_NS (32 d, D-089). */
export const CALENDAR_SPAN_MAX_NS = 32n * 86_400_000_000_000n;
/** Windows the server keeps per cache (LRU). */
export const MAX_CALENDAR_WINDOWS = 12;

/** GET /api/calendar answer (spec range-picker "Calendar density"). Decimal ns strings. */
export interface CalendarDensity {
  dataRef: string;
  /** The asked `from` and `to`, unchanged (not cut to the scope). */
  from: string;
  to: string;
  /** hours[i] = rows in [from + i h, min(from + (i+1) h, to)); length ceil((to − from) / 1 h). */
  hours: number[];
  /** Drives in [from, to) ∩ scope on the 60 s grid (time-strip rule), edges cut to the scope; [] when none. */
  drives: Drive[];
  /** Present while the workspace has a scope (object scopes too): where rows may lie. */
  scope?: { from: string; to: string };
}
