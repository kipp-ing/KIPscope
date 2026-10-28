import { floorDiv, formatSpan, NS_PER_MS } from "@kipscope/shared";

// Start and duration of a range, the one format people read (range button, picker, an unlinked
// window's own range; range-picker "Start and duration", design R6 of add-range-picker, D-093, D-095).

const MS = NS_PER_MS;
const S = 1_000n * MS;
const MIN = 60n * S;
const H = 60n * MIN;
const D = 24n * H;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Local date of `d`: "2026-10-13". */
export const localDate = (d: Date): string =>
  `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local weekday of `d`: "Tue". */
export const weekdayOf = (d: Date): string => WEEKDAYS[d.getDay()] as string;

const clock = (h: number, d: Date, withMs: boolean) =>
  `${pad(h)}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${withMs ? `.${pad(d.getMilliseconds(), 3)}` : ""}`;

/**
 * Both ends cut to ms in local time, for the picker's draft: `start` and `end` are the local
 * dates shown (an end exactly at a local midnight is `24:00:00` of the date before); times with
 * milliseconds when either end has a nonzero ms part.
 */
export function rangeParts(
  from: bigint,
  to: bigint,
): { start: Date; end: Date; from: string; to: string } {
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
  };
}

export interface StartDuration {
  /** Local start date "26-10-13" (YY-MM-DD). */
  date: string;
  /** Local start "15:06", cut to the minute; under 1 min cut to the second: "15:06:03". */
  time: string;
  /** < 1 s formatSpan ("902 ms"); < 1 min whole seconds cut ("41 s"); < 48 h "H:MM h" cut ("0:12 h", "47:59 h");
   *  from 48 h "D d H h" cut ("2 d 0 h", "9 d 11 h"). */
  duration: string;
  /** `${date} ${time}  ${duration}`: "26-10-13 15:06  0:12 h" (two spaces before the duration). */
  text: string;
  /** fullTime(from, seconds = to − from < 1 min): "Tue 2026-10-13 15:06", "Tue 2026-10-13 15:06:03". */
  full: string;
  /** "Duration " + words: < 1 s "902 ms"; < 1 min "41 s"; else days (only from 48 h), hours, minutes, cut, zero
   *  parts left out: "Duration 12 min", "Duration 1 h 6 min", "Duration 24 h", "Duration 9 d 11 h 18 min", "Duration 2 d". */
  durationTip: string;
  /** `${full} · ${durationTip}`: one tooltip where start and duration share an element. */
  tip: string;
}

/** From here a duration counts days (design R6, D-095). */
const DAYS_FROM = 48n * H;

/** Local "Ddd YYYY-MM-DD HH:MM", with ":SS" (cut) when seconds: "Tue 2026-10-13 15:06:03". */
export function fullTime(t: bigint, seconds: boolean): string {
  const d = new Date(Number(floorDiv(t, MS)));
  const minute = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${weekdayOf(d)} ${localDate(d)} ${seconds ? `${minute}:${pad(d.getSeconds())}` : minute}`;
}

/** Duration words after "Duration ": days only from 48 h, hours, minutes, cut; zero parts left out. */
function durationWords(ns: bigint): string {
  if (ns < S) return formatSpan(ns);
  if (ns < MIN) return `${ns / S} s`;
  const days = ns >= DAYS_FROM ? ns / D : 0n;
  const rest = ns - days * D;
  const parts: [bigint, string][] = [
    [days, "d"],
    [rest / H, "h"],
    [(rest % H) / MIN, "min"],
  ];
  return parts
    .filter(([n]) => n > 0n)
    .map(([n, unit]) => `${n} ${unit}`)
    .join(" ");
}

/** The one formatter of a range people read (D-093, D-095): local start and duration, both cut, never rounded up. */
export function startDuration(from: bigint, to: bigint): StartDuration {
  const ns = to - from;
  const start = new Date(Number(floorDiv(from, MS)));
  const date = localDate(start).slice(2);
  const minute = `${pad(start.getHours())}:${pad(start.getMinutes())}`;
  const time = ns < MIN ? `${minute}:${pad(start.getSeconds())}` : minute;
  const duration =
    ns < S
      ? formatSpan(ns)
      : ns < MIN
        ? `${ns / S} s`
        : ns < DAYS_FROM
          ? `${ns / H}:${pad(Number((ns % H) / MIN))} h`
          : `${ns / D} d ${(ns % D) / H} h`;
  const full = fullTime(from, ns < MIN);
  const durationTip = `Duration ${durationWords(ns)}`;
  return {
    date,
    time,
    duration,
    text: `${date} ${time}  ${duration}`,
    full,
    durationTip,
    tip: `${full} · ${durationTip}`,
  };
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
): StartDuration | undefined {
  return linkTime ? undefined : startDuration(range.from, range.to);
}

/** The button's text without a range: "No time window" (no timeseries window) or "…" (state not loaded yet). */
export function rangeButtonEmpty(loaded: boolean): string {
  return loaded ? "No time window" : "…";
}
