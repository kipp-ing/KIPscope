import { floorDiv, NS_PER_MS } from "@kipscope/shared";
import { formatSpan } from "./strip.ts";

// The range in one readable line: range button, picker result line and an unlinked window's own
// range (range-picker "Range line", design R6 of add-range-picker).

const MS = NS_PER_MS;
const S = 1_000n * MS;
const MIN = 60n * S;
const H = 60n * MIN;
const D = 24n * H;
const MS_PER_DAY = 86_400_000;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Local date of `d`: "2026-10-13". */
export const localDate = (d: Date): string =>
  `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local weekday of `d`: "Tue". */
export const weekdayOf = (d: Date): string => WEEKDAYS[d.getDay()] as string;

const dayText = (d: Date) => `${weekdayOf(d)} ${localDate(d)}`;

const clock = (h: number, d: Date, withMs: boolean) =>
  `${pad(h)}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${withMs ? `.${pad(d.getMilliseconds(), 3)}` : ""}`;

/** Local dates since the epoch of `d`'s local date (DST-proof). */
const dayNumber = (d: Date) =>
  Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY);

/**
 * Both ends cut to ms in local time by the range line's rules: `start` and `end` are the local
 * dates shown (an end exactly at a local midnight is `24:00:00` of the date before), `days` the
 * dates between them; times with milliseconds when either end has a nonzero ms part.
 */
export function rangeParts(
  from: bigint,
  to: bigint,
): { start: Date; end: Date; from: string; to: string; days: number } {
  const fromMs = Number(floorDiv(from, MS));
  const toMs = Number(floorDiv(to, MS));
  const withMs = fromMs % 1000 !== 0 || toMs % 1000 !== 0;
  const start = new Date(fromMs);
  const at = new Date(toMs);
  const midnight =
    to % MS === 0n &&
    at.getHours() === 0 &&
    at.getMinutes() === 0 &&
    at.getSeconds() === 0 &&
    at.getMilliseconds() === 0;
  const end = midnight ? new Date(at.getFullYear(), at.getMonth(), at.getDate() - 1) : at;
  return {
    start,
    end,
    from: clock(start.getHours(), start, withMs),
    to: clock(midnight ? 24 : at.getHours(), at, withMs),
    days: dayNumber(end) - dayNumber(start),
  };
}

export interface RangeLine {
  /** "Tue 2026-10-13" */
  date: string;
  /** "15:06:03" or "15:08:00.093" */
  from: string;
  /** "15:18:33", "24:00:00", "01:52:43" */
  to: string;
  /** End on the next local date (not at its midnight). */
  plusOne: boolean;
  /** "Thu 2026-10-15" when the end lies ≥ 2 dates later. */
  endDate?: string;
  /** "Tue 2026-10-13 15:06:03 – 15:18:33" ("⁺¹" appended when plusOne; endDate before `to`). */
  text: string;
  /** Long: "12 min 30 s". */
  duration: string;
  /** formatSpan: "12.5 min". */
  short: string;
}

export function rangeLine(from: bigint, to: bigint): RangeLine {
  const p = rangeParts(from, to);
  const date = dayText(p.start);
  const plusOne = p.days === 1;
  const endDate = p.days >= 2 ? dayText(p.end) : undefined;
  const line: RangeLine = {
    date,
    from: p.from,
    to: p.to,
    plusOne,
    text: `${date} ${p.from} – ${endDate ? `${endDate} ` : ""}${p.to}${plusOne ? "⁺¹" : ""}`,
    duration: formatDuration(to - from),
    short: formatSpan(to - from),
  };
  if (endDate) line.endDate = endDate;
  return line;
}

/** "<big> <unit>[ <small> <unit>]", both parts cut; a zero lower part dropped. */
function twoParts(ns: bigint, big: bigint, bigUnit: string, small: bigint, smallUnit: string) {
  const lower = (ns % big) / small;
  return lower === 0n ? `${ns / big} ${bigUnit}` : `${ns / big} ${bigUnit} ${lower} ${smallUnit}`;
}

/** < 1 s: formatSpan; < 1 min: seconds cut to ms, zeros dropped ("1.5 s"); < 1 h: "M min S s"; < 1 d: "H h M min"; else "D d H h"; a zero lower part dropped; parts cut, never rounded up. */
export function formatDuration(ns: bigint): string {
  if (ns < S) return formatSpan(ns);
  if (ns < MIN) {
    const ms = ns / MS;
    const frac = pad(Number(ms % 1000n), 3).replace(/0+$/, "");
    return `${ms / 1000n}${frac ? `.${frac}` : ""} s`;
  }
  if (ns < H) return twoParts(ns, MIN, "min", S, "s");
  if (ns < D) return twoParts(ns, H, "h", MIN, "min");
  return twoParts(ns, D, "d", H, "h");
}

/** A window's own range in its header: only while unlinked (timeseries-window "Own range"). */
export function ownRangeText(
  range: { from: bigint; to: bigint },
  linkTime: boolean,
): string | undefined {
  return linkTime ? undefined : rangeLine(range.from, range.to).text;
}

/** The button's text without a range: "No time window" (no timeseries window) or "…" (state not loaded yet). */
export function rangeButtonEmpty(loaded: boolean): string {
  return loaded ? "No time window" : "…";
}
