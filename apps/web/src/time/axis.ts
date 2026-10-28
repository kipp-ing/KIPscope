import { floorDiv, NS_PER_MS, NS_PER_S, type Timestamp } from "@kipscope/shared";

const MIN = 60n * NS_PER_S;
const HOUR = 60n * MIN;
const DAY = 24n * HOUR;

/** Tick steps in ns: 1-2-5 below one second, then clock-friendly steps. */
export const TICK_STEPS: bigint[] = [
  ...Array.from({ length: 9 }, (_, exp) => [1n, 2n, 5n].map((m) => m * 10n ** BigInt(exp))).flat(),
  NS_PER_S,
  2n * NS_PER_S,
  5n * NS_PER_S,
  10n * NS_PER_S,
  15n * NS_PER_S,
  30n * NS_PER_S,
  MIN,
  2n * MIN,
  5n * MIN,
  10n * MIN,
  15n * MIN,
  30n * MIN,
  HOUR,
  2n * HOUR,
  3n * HOUR,
  6n * HOUR,
  12n * HOUR,
  DAY,
  2n * DAY,
  7n * DAY,
];

/** Offset of local time from UTC at instant `t`, in ns. */
export function localOffset(t: Timestamp): bigint {
  const minutes = new Date(Number(floorDiv(t, NS_PER_MS))).getTimezoneOffset();
  return -BigInt(minutes) * MIN;
}

/** Smallest step that yields at most `maxTicks` ticks over [from, to]. */
export function tickStep(from: Timestamp, to: Timestamp, maxTicks: number): bigint {
  const span = to - from;
  const limit = BigInt(Math.max(1, Math.floor(maxTicks)));
  return TICK_STEPS.find((s) => span / s <= limit) ?? (TICK_STEPS.at(-1) as bigint);
}

/** Characters of a "YYYY-MM-DD" date label. */
const DATE_CHARS = 10;

/**
 * Approximate label width in px at ~6.5 px per character: "YYYY-MM-DD" for day steps (every
 * label is a date), else "HH:MM" or "HH:MM:SS" plus fraction digits. Below day steps two date
 * lines are never neighbours (see `tickLabels`), so the time line sets the width.
 */
export function labelWidth(step: bigint): number {
  const digits = fractionDigits(step);
  const chars =
    step >= DAY
      ? DATE_CHARS
      : step >= MIN && step % MIN === 0n
        ? 5
        : 8 + (digits > 0 ? digits + 1 : 0);
  return chars * 6.5 + 16;
}

/** Smallest step whose labels fit side by side into `widthPx`. */
export function tickStepForWidth(from: Timestamp, to: Timestamp, widthPx: number): bigint {
  const span = to - from;
  for (const step of TICK_STEPS) {
    const count = Number(span / step) + 1;
    if (count * labelWidth(step) <= widthPx) return step;
  }
  return TICK_STEPS.at(-1) as bigint;
}

/** Ticks on multiples of `step` in local time (days and hours align to local midnight). */
export function ticks(from: Timestamp, to: Timestamp, step: bigint): Timestamp[] {
  const offset = step >= HOUR ? localOffset(from) : 0n;
  const first = -floorDiv(-(from + offset), step) * step - offset;
  const result: Timestamp[] = [];
  for (let t = first; t <= to && result.length < 1000; t += step) result.push(t);
  return result;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Width reserved per calendar tick label ("YYYY-MM" or "YYYY") in CSS px. */
export const CALENDAR_LABEL_PX = 80;
const WEEK = 7n * DAY;
/** Mean Gregorian month (30.436875 days), only to estimate tick counts. */
const MONTH = 2_629_746_000_000_000n;
/** Calendar tick steps in months. */
const MONTH_STEPS = [1, 2, 3, 6, 12, 24, 60, 120, 240, 600, 1200];

export interface CalendarTicks {
  ticks: Timestamp[];
  labels: string[];
}

/**
 * x ticks for spans too wide for weekly date labels (up to the full 1900 … 2262 range): local
 * month starts every n months, n the smallest step whose labels fit into `widthPx`. Labels are
 * "YYYY-MM", or "YYYY" for steps of a year or more. Undefined when weekly date labels still fit,
 * i.e. the clock-based steps of `tickStepForWidth` apply.
 */
export function calendarTicks(
  from: Timestamp,
  to: Timestamp,
  widthPx: number,
): CalendarTicks | undefined {
  const span = to - from;
  if (Number(span / WEEK + 1n) * labelWidth(WEEK) <= widthPx) return undefined;
  const months = Number(span / MONTH) + 1;
  const step =
    MONTH_STEPS.find((n) => (months / n + 1) * CALENDAR_LABEL_PX <= widthPx) ??
    (MONTH_STEPS.at(-1) as number);
  const start = new Date(Number(from / NS_PER_MS));
  let index = Math.ceil((start.getFullYear() * 12 + start.getMonth()) / step) * step;
  const result: CalendarTicks = { ticks: [], labels: [] };
  for (;;) {
    const year = Math.floor(index / 12);
    const month = index % 12;
    const t = BigInt(new Date(year, month, 1).getTime()) * NS_PER_MS;
    if (t > to) break;
    if (t >= from) {
      result.ticks.push(t);
      result.labels.push(step >= 12 ? String(year) : `${year}-${pad(month + 1)}`);
    }
    index += step;
  }
  return result;
}

function localDate(t: Timestamp): Date {
  return new Date(Number(floorDiv(t, NS_PER_MS)));
}

export function formatDate(t: Timestamp): string {
  const d = localDate(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Fraction digits needed to tell ticks `step` apart (0 for steps of a second or more). */
export function fractionDigits(step: bigint): number {
  if (step >= NS_PER_S) return 0;
  return 9 - (step.toString().length - 1);
}

/**
 * Local clock time of `t` with `digits` fractional-second digits, computed from the bigint so
 * sub-millisecond digits are exact.
 */
export function formatTime(t: Timestamp, digits: number, withSeconds = true): string {
  const d = localDate(t);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (!withSeconds) return hm;
  const base = `${hm}:${pad(d.getSeconds())}`;
  if (digits <= 0) return base;
  const frac = (t - floorDiv(t, NS_PER_S) * NS_PER_S).toString().padStart(9, "0");
  return `${base}.${frac.slice(0, digits)}`;
}

/** Full local timestamp with nanoseconds trimmed to 3-digit groups. */
export function formatFull(t: Timestamp): string {
  const frac = (t - floorDiv(t, NS_PER_S) * NS_PER_S).toString().padStart(9, "0");
  let digits = 9;
  while (digits > 0 && frac.slice(digits - 3, digits) === "000") digits -= 3;
  return `${formatDate(t)} ${formatTime(t, digits)}`;
}

/**
 * Tick labels: clock time at the step's precision; the date is added on the first tick and
 * wherever the day changes. The first tick leaves its date out when the second tick already
 * starts a new day, so two date lines never stand side by side. Steps of a day or more show only
 * the date.
 */
export function tickLabels(values: Timestamp[], step: bigint): string[] {
  const digits = fractionDigits(step);
  const withSeconds = step < MIN || step % MIN !== 0n;
  const dates = values.map(formatDate);
  if (step >= DAY) return dates;
  return values.map((t, i) => {
    const date = dates[i];
    const time = formatTime(t, digits, withSeconds);
    const dated = i === 0 ? dates[1] === undefined || dates[1] === date : date !== dates[i - 1];
    return dated ? `${time}\n${date}` : time;
  });
}
