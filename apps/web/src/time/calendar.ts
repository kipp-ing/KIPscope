import {
  CALENDAR_HOUR_NS,
  type CalendarDensity,
  type Density,
  type Drive,
  floorDiv,
  NS_PER_MS,
  parseTime,
} from "@kipscope/shared";
import { localDate, rangeParts, startDuration, weekdayOf } from "./rangeLine.ts";
import { rowsText } from "./stripGeometry.ts";

// Pure model of the range picker's calendar: months, day bars, draft and presets (design R5, R7–R9
// of add-range-picker).

export interface CalendarDay {
  /** "2026-10-13", local */
  date: string;
  /** "Tue" */
  weekday: string;
  /** 13 */
  day: number;
  /** Local midnight. */
  from: bigint;
  /** Next local midnight. */
  to: bigint;
}

export const DAY_BARS = 12;
export const DAY_BAR_MAX_PX = 12;
export const DAY_BAR_MIN_PX = 2;
export const DAY_BAR_DECADES = 4;

/** Workspace scope as the picker names it: none, plain scope, linked catalog, unlinked (object scope). */
export type ScopeKind = "none" | "scope" | "session" | "object";

type Month = { year: number; month: number };

const H = CALENDAR_HOUR_NS;
const BAR_NS = 2n * H;

/** Local midnight of the given local date (day may overflow into the next month). */
const midnight = (year: number, month: number, day: number): bigint =>
  BigInt(new Date(year, month - 1, day).getTime()) * NS_PER_MS;

const overlaps = (from: bigint, to: bigint, r: { from: string; to: string }) =>
  BigInt(r.from) < to && BigInt(r.to) > from;

/** Local month (1–12): its first local midnight and the next month's. */
export function localMonth(year: number, month: number): { from: bigint; to: bigint } {
  return { from: midnight(year, month, 1), to: midnight(year, month + 1, 1) };
}

/** 42 cells, Monday first; null outside the month. */
export function monthCells(year: number, month: number): (CalendarDay | null)[] {
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const days = new Date(year, month, 0).getDate();
  return Array.from({ length: 42 }, (_, i) => {
    const day = i - lead + 1;
    if (day < 1 || day > days) return null;
    const d = new Date(year, month - 1, day);
    return {
      date: localDate(d),
      weekday: weekdayOf(d),
      day,
      from: midnight(year, month, day),
      to: midnight(year, month, day + 1),
    };
  });
}

/** Bar k covers [day.from + 2k h, day.from + (2k+2) h), the last one up to day.to (1 h or 3 h on DST days).
 *  count = sum of answer.hours whose slot start lies in the bar; drive = a drive overlaps the bar (half-open). */
export function dayBars(
  answer: CalendarDensity,
  day: CalendarDay,
): { count: number; drive: boolean }[] {
  const start = BigInt(answer.from);
  // First slot whose start lies at or after t: ceil((t − start) / 1 h).
  const slot = (t: bigint) => Number(-floorDiv(start - t, H));
  return Array.from({ length: DAY_BARS }, (_, k) => {
    const from = day.from + BigInt(k) * BAR_NS;
    const to = k === DAY_BARS - 1 ? day.to : from + BAR_NS;
    let count = 0;
    const end = Math.min(answer.hours.length, slot(to));
    for (let i = Math.max(0, slot(from)); i < end; i++) count += answer.hours[i] ?? 0;
    return { count, drive: answer.drives.some((d) => overlaps(from, to, d)) };
  });
}

/** 0 → 0; else clamp(round(12 × (1 + log10(count / max) / 4)), 2, 12). */
export function dayBarHeight(count: number, max: number): number {
  if (count <= 0 || max <= 0) return 0;
  const px = Math.round(DAY_BAR_MAX_PX * (1 + Math.log10(count / max) / DAY_BAR_DECADES));
  return Math.min(DAY_BAR_MAX_PX, Math.max(DAY_BAR_MIN_PX, px));
}

const dayDriveList = (answer: CalendarDensity, day: CalendarDay): Drive[] =>
  answer.drives.filter((d) => overlaps(day.from, day.to, d));

/** Rows and drives of the day, or the reason it has no rows (no data, outside the session or scope). */
function dayFacts(
  answer: CalendarDensity,
  day: CalendarDay,
  scope: ScopeKind,
): { rows: number; drives: number } | { reason: string } {
  const rows = dayBars(answer, day).reduce((sum, b) => sum + b.count, 0);
  if (rows === 0) {
    const outside = answer.scope !== undefined && !overlaps(day.from, day.to, answer.scope);
    if (outside && scope === "session") return { reason: "outside the session" };
    if (outside && scope === "scope") return { reason: "outside the scope" };
    return { reason: "no data" };
  }
  return { rows, drives: dayDriveList(answer, day).length };
}

const drivesText = (n: number) => `${n} ${n === 1 ? "drive" : "drives"}`;

/** Rows of the day (sum of its bars) and the drives overlapping it, for the tooltip. */
export function dayTip(
  answer: CalendarDensity | undefined,
  day: CalendarDay,
  scope: ScopeKind,
): string {
  const head = `${day.weekday} ${day.date.slice(2)}`;
  if (!answer) return head;
  const f = dayFacts(answer, day, scope);
  if ("reason" in f) return `${head} · ${f.reason}`;
  return `${head} · ${rowsText(f.rows)}${f.drives === 0 ? "" : ` · ${drivesText(f.drives)}`}`;
}

/** "Tue 13, 2 drives" | "1 drive" | "no drives" (rows, no drive) | "no data" | "outside the session" | "outside the scope"; "Tue 13" without an answer. */
export function dayLabel(
  answer: CalendarDensity | undefined,
  day: CalendarDay,
  scope: ScopeKind,
): string {
  const head = `${day.weekday} ${day.day}`;
  if (!answer) return head;
  const f = dayFacts(answer, day, scope);
  if ("reason" in f) return `${head}, ${f.reason}`;
  return `${head}, ${f.drives === 0 ? "no drives" : drivesText(f.drives)}`;
}

export interface PickerDraft {
  /** Local date "2026-10-13". */
  start: string;
  end: string;
  /** Time text as typed or filled ("15:06:03"). */
  from: string;
  /** May be "24:00:00". */
  to: string;
  phase: "start" | "end";
}

/** The draft of a shown range, exact (an end at local midnight is 24:00:00 of the date before). */
export function draftOf(range: { from: bigint; to: bigint }): PickerDraft {
  const p = rangeParts(range.from, range.to);
  return {
    start: localDate(p.start),
    end: localDate(p.end),
    from: p.from,
    to: p.to,
    phase: "start",
  };
}

/** Phase start, or a date before `start`: start and end on that date, waiting for the end; else the end. Times kept. */
export function pickDay(d: PickerDraft, date: string): PickerDraft {
  if (d.phase === "start" || date < d.start) return { ...d, start: date, end: date, phase: "end" };
  return { ...d, end: date, phase: "start" };
}

const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/;
const BAD_TIME = "Time as hh:mm";

/** A filled time as its field shows it: cut to "HH:MM" ("15:06:03" → "15:06", "24:00:00" → "24:00"). */
export function fieldText(time: string): string {
  return /^\d{1,2}:\d{2}/.exec(time)?.[0] ?? time;
}

/** Local instant of `date` and a time text; `24:00[:00]` (To only) is the next local midnight. */
function instantOf(date: string, time: string, isEnd: boolean): bigint | { error: string } {
  const m = TIME.exec(time.trim());
  if (!m) return { error: BAD_TIME };
  const [, h = "", mi = "", s = "00", frac] = m;
  const hours = Number(h);
  if (Number(mi) > 59 || Number(s) > 59) return { error: BAD_TIME };
  if (hours === 24 && isEnd && Number(mi) === 0 && Number(s) === 0 && !Number(frac ?? "0")) {
    const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
    return midnight(y, mo, d + 1);
  }
  if (hours > 23) return { error: BAD_TIME };
  try {
    return parseTime(`${date} ${h.padStart(2, "0")}:${mi}:${s}${frac ? `.${frac}` : ""}`);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** The draft as a range, or the reason it is none (bad time, To not after From, DST messages of parseTime). */
export function draftRange(d: PickerDraft): { from: bigint; to: bigint } | { error: string } {
  const from = instantOf(d.start, d.from, false);
  if (typeof from !== "bigint") return from;
  const to = instantOf(d.end, d.to, true);
  if (typeof to !== "bigint") return to;
  if (to <= from) return { error: "To lies before From" };
  return { from, to };
}

/** Drives overlapping the day, in time order, with chip labels `${time}  ${duration}` of startDuration(drive): "03:00  0:30 h",
 *  and the chip tooltip `tip`: "Fri 2026-10-02 03:00 · Duration 30 min". */
export function dayDrives(
  answer: CalendarDensity | undefined,
  day: CalendarDay,
): { drive: Drive; label: string; title: string }[] {
  if (!answer) return [];
  return dayDriveList(answer, day).map((drive) => {
    const sd = startDuration(BigInt(drive.from), BigInt(drive.to));
    return { drive, label: `${sd.time}  ${sd.duration}`, title: sd.tip };
  });
}

/** Label of the whole-span chip (design R8, Q-3). */
export function wholeLabel(kind: ScopeKind): "Whole recording" | "Whole scope" | "Whole session" {
  if (kind === "scope") return "Whole scope";
  if (kind === "session") return "Whole session";
  return "Whole recording";
}

const shift = (m: Month, by: number): Month => {
  const d = new Date(m.year, m.month - 1 + by, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
};

/** Left and right month shown when the picker opens: right = local month of `range.from`, left = the one before. */
export function openMonths(range: { from: bigint; to: bigint }): Month[] {
  const d = new Date(Number(floorDiv(range.from, NS_PER_MS)));
  const right = { year: d.getFullYear(), month: d.getMonth() + 1 };
  return [shift(right, -1), right];
}

/**
 * ‹: data before the right month (first < localMonth(right).from), so paging back never strands the
 * view past the data (scenario "Paging bounds": left October, first 2026-10-11 → on);
 * ›: data after the right month (last ≥ localMonth(right).to). Without a density both true.
 */
export function canPage(
  density: Density | undefined,
  left: Month,
): { prev: boolean; next: boolean } {
  if (!density) return { prev: true, next: true };
  const next = shift(left, 1);
  const right = localMonth(next.year, next.month);
  return { prev: BigInt(density.first) < right.from, next: BigInt(density.last) >= right.to };
}

const parseDate = (date: string) => date.split("-").map(Number) as [number, number, number];

const GRID_DAYS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  ArrowUp: -7,
  ArrowDown: 7,
};

/** ← → ±1 day, ↑ ↓ ±7 days, PageUp/PageDown ±1 month (same day number, cut to the month's length); undefined for any other key. Local date strings. */
export function gridStep(date: string, key: string): string | undefined {
  const [y, m, d] = parseDate(date);
  const days = GRID_DAYS[key];
  if (days !== undefined) return localDate(new Date(y, m - 1, d + days));
  const months = key === "PageUp" ? -1 : key === "PageDown" ? 1 : 0;
  if (months === 0) return undefined;
  const to = shift({ year: y, month: m }, months);
  const length = new Date(to.year, to.month, 0).getDate();
  return localDate(new Date(to.year, to.month - 1, Math.min(d, length)));
}

/** Left month after focus moved to `date`: unchanged when `date` lies in the shown pair; its month as left when earlier, as right when later, if `can` allows that direction; else undefined (focus stays). */
export function pageFor(
  date: string,
  left: Month,
  can: { prev: boolean; next: boolean },
): Month | undefined {
  const [year, month] = parseDate(date);
  const at = { year, month };
  const offset = year * 12 + month - (left.year * 12 + left.month);
  if (offset === 0 || offset === 1) return left;
  if (offset < 0) return can.prev ? at : undefined;
  return can.next ? shift(at, -1) : undefined;
}
