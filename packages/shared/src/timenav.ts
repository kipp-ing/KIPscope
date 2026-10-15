import { formatLocal, parseDuration, parseTime } from "./localtime.ts";
import { NS_PER_S, TIME_MAX, TIME_MIN } from "./time.ts";

/** Half-open range [from, to) in ns since the epoch. */
export interface NavRange {
  from: bigint;
  to: bigint;
}

export interface NavContext {
  view: NavRange;
  cursors: { a?: bigint; b?: bigint };
}

/** Smallest span a navigation may produce (timeseries-window "Minimum zoom span"). */
export const MIN_SPAN_NS = 100n;

const NS_PER_MIN = 60n * NS_PER_S;
const NS_PER_DAY = 86_400n * NS_PER_S;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_OF_DAY = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;
/** Last time-of-day fields of a date-time text, for the period its last digit names. */
const TIME_FIELDS = /\d{2}:\d{2}(:\d{2}(?:\.(\d{1,9}))?)?(?:Z|[+-]\d{2}:\d{2})?$/;
const DUR = String.raw`(?:\d+(?:\.\d+)?|\.\d+)(?:ns|us|µs|ms|s|min|h|d)`;
const PAN = new RegExp(`^([+-])(${DUR})$`);
const WITH_DURATION = new RegExp(String.raw`^(.+?)\s*(\+-|±|\+|-)\s*(${DUR})$`);
const DAYS = /^(\d+(?:\.\d+)?|\.\d+)d$/;

/** A if inside [view.from, view.to), else the view's centre. */
export function navAnchor(view: NavRange, a?: bigint): bigint {
  return a !== undefined && a >= view.from && a < view.to
    ? a
    : view.from + (view.to - view.from) / 2n;
}

/** Moves a range into TIME_MIN … TIME_MAX keeping its span; a span beyond the bounds becomes them. */
function clamp(range: NavRange): NavRange {
  const span = range.to - range.from;
  if (span >= TIME_MAX - TIME_MIN) return { from: TIME_MIN, to: TIME_MAX };
  if (range.from < TIME_MIN) return { from: TIME_MIN, to: TIME_MIN + span };
  if (range.to > TIME_MAX) return { from: TIME_MAX - span, to: TIME_MAX };
  return range;
}

/** factor 0.5 halves, 2 doubles; the anchor keeps its relative position; clamped. */
export function zoomAround(view: NavRange, factor: number, anchor: bigint): NavRange {
  const span = view.to - view.from;
  let next = BigInt(Math.round(Number(span) * factor));
  if (next < MIN_SPAN_NS) next = MIN_SPAN_NS;
  if (next > TIME_MAX - TIME_MIN) next = TIME_MAX - TIME_MIN;
  const from = span > 0n ? anchor - ((anchor - view.from) * next) / span : anchor - next / 2n;
  return clamp({ from, to: from + next });
}

/** fraction of the span, negative = earlier; clamped. */
export function panBy(view: NavRange, fraction: number): NavRange {
  const shift = BigInt(Math.round(Number(view.to - view.from) * fraction));
  return clamp({ from: view.from + shift, to: view.to + shift });
}

/** Span centred on the anchor (presets, bare durations); clamped. */
export function spanAround(span: bigint, anchor: bigint): NavRange {
  const from = anchor - span / 2n;
  return clamp({ from, to: from + span });
}

/** The CLI's durations (parseDuration) plus `<decimal>d`, d = 24 h. */
function navDuration(text: string): bigint {
  const days = DAYS.exec(text);
  if (!days) return parseDuration(text);
  const [whole = "", frac = ""] = (days[1] as string).split(".");
  const scale = 10n ** BigInt(frac.length);
  const scaled = BigInt(whole + frac || "0") * NS_PER_DAY;
  if (scaled % scale !== 0n) throw new RangeError(`duration finer than 1 ns: ${text}`);
  return scaled / scale;
}

/** Local date "YYYY-MM-DD" of an instant. */
const localDate = (t: bigint): string => formatLocal(t).slice(0, 10);

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const ms = new Date(0).setUTCFullYear(y, m - 1, d + days);
  return new Date(ms).toISOString().slice(0, 10);
}

/** A typed instant: a period [start, end), or a point (decimal ns, cursor) without end. */
interface Instant {
  start: bigint;
  end?: bigint;
}

/** Length of the period the last given digit of a time text names: 1 min, 1 s or 10^−k s. */
function periodOf(text: string): bigint | undefined {
  const m = TIME_FIELDS.exec(text);
  if (!m) return undefined;
  const [, seconds, frac] = m;
  if (frac !== undefined) return 10n ** BigInt(9 - frac.length);
  return seconds !== undefined ? NS_PER_S : NS_PER_MIN;
}

/**
 * Time of day without date: `pick` chooses among the occurrences on candidate local dates; the
 * chosen date is then parsed by parseTime, so DST refusals carry its messages.
 */
function timeOfDay(
  text: string,
  dates: string[],
  pick: (occurrences: { date: string; t: bigint }[]) => string | undefined,
): Instant {
  const m = TIME_OF_DAY.exec(text) as RegExpExecArray;
  const clock = `${(m[1] as string).padStart(2, "0")}${text.slice((m[1] as string).length)}`;
  const offset =
    BigInt(Number(m[1])) * 60n * NS_PER_MIN +
    BigInt(Number(m[2])) * NS_PER_MIN +
    BigInt(Number(m[3] ?? 0)) * NS_PER_S +
    BigInt((m[4] ?? "").padEnd(9, "0"));
  const occurrences: { date: string; t: bigint }[] = [];
  for (const date of new Set(dates)) {
    try {
      occurrences.push({ date, t: parseTime(`${date} ${clock}`) });
    } catch {
      // Nonexistent or ambiguous here: place it approximately (from local noon) for the choice.
      try {
        occurrences.push({ date, t: parseTime(`${date} 12:00`) + offset - 12n * 60n * NS_PER_MIN });
      } catch {
        // Date outside the bounds: no occurrence.
      }
    }
  }
  const date = pick(occurrences);
  if (date === undefined) throw new RangeError(`no occurrence of ${text} within the bounds`);
  const start = parseTime(`${date} ${clock}`);
  return { start, end: start + (periodOf(clock) as bigint) };
}

/** Occurrence nearest to `t`; earlier on ties. */
function nearest(occurrences: { date: string; t: bigint }[], t: bigint): string | undefined {
  const dist = (o: { t: bigint }) => (o.t > t ? o.t - t : t - o.t);
  return occurrences.reduce<{ date: string; t: bigint } | undefined>(
    (best, o) => (best === undefined || dist(o) < dist(best) ? o : best),
    undefined,
  )?.date;
}

/**
 * One instant. `after`: a range's end, whose time of day is its first occurrence after `after`;
 * otherwise a time of day takes its latest occurrence inside the view, else the one nearest the
 * view's centre.
 */
function instant(text: string, ctx: NavContext, after?: bigint): Instant {
  if (text === "a" || text === "b") {
    const t = ctx.cursors[text];
    if (t === undefined) throw new RangeError(`cursor ${text.toUpperCase()} is off`);
    return { start: t };
  }
  if (DATE.test(text)) {
    return { start: parseTime(`${text} 00:00`), end: parseTime(`${addDays(text, 1)} 00:00`) };
  }
  if (TIME_OF_DAY.test(text)) {
    if (after !== undefined) {
      const day = localDate(after);
      return timeOfDay(text, [day, addDays(day, 1), addDays(day, 2)], (occurrences) => {
        const later = occurrences.filter((o) => o.t > after);
        return later.reduce<(typeof later)[number] | undefined>(
          (first, o) => (first === undefined || o.t < first.t ? o : first),
          undefined,
        )?.date;
      });
    }
    const { from, to } = ctx.view;
    const centre = from + (to - from) / 2n;
    const last = localDate(to - 1n);
    const mid = localDate(centre);
    const dates = [last, addDays(last, -1), addDays(mid, -1), mid, addDays(mid, 1)];
    return timeOfDay(text, dates, (occurrences) => {
      const inside = occurrences.filter((o) => o.t >= from && o.t < to);
      if (inside.length === 0) return nearest(occurrences, centre);
      return inside.reduce((latest, o) => (o.t > latest.t ? o : latest)).date;
    });
  }
  const start = parseTime(text);
  const period = periodOf(text);
  return period === undefined ? { start } : { start, end: start + period };
}

/** Rejects reversed, empty and too short ranges; clamps the rest. */
function checked(from: bigint, to: bigint): NavRange {
  if (to < from) throw new RangeError("reversed range: the end is before the start");
  if (to === from) throw new RangeError("empty range");
  if (to - from < MIN_SPAN_NS) throw new RangeError(`span below ${MIN_SPAN_NS} ns`);
  return clamp({ from, to });
}

/** N2; result clamped to TIME_MIN … TIME_MAX; throws RangeError with a readable message. */
export function resolveTimeNav(text: string, ctx: NavContext): NavRange {
  const input = text.trim();
  if (input === "") throw new RangeError("enter a time, range or duration");
  const { view } = ctx;

  const range = /\s*(?:\.\.|–)\s*/.exec(input);
  if (range) {
    const left = input.slice(0, range.index);
    const right = input.slice(range.index + range[0].length);
    if (left === "" || right === "")
      throw new RangeError(`range needs a start and an end: ${input}`);
    const start = instant(left, ctx).start;
    return checked(start, instant(right, ctx, start).start);
  }

  const pan = PAN.exec(input);
  if (pan) {
    const shift = navDuration(pan[2] as string);
    const signed = pan[1] === "-" ? -shift : shift;
    return checked(view.from + signed, view.to + signed);
  }

  if (new RegExp(`^${DUR}$`).test(input)) {
    const span = navDuration(input);
    const around = spanAround(span, navAnchor(view, ctx.cursors.a));
    return checked(around.from, around.to);
  }

  const relative = WITH_DURATION.exec(input);
  if (relative) {
    const [, base, op, dur] = relative as unknown as [string, string, string, string];
    const t = instant(base, ctx).start;
    const d = navDuration(dur);
    if (op === "+") return checked(t, t + d);
    if (op === "-") return checked(t - d, t);
    return checked(t - d, t + d);
  }

  const single = instant(input, ctx);
  if (single.end === undefined) {
    const around = spanAround(view.to - view.from, single.start);
    return checked(around.from, around.to);
  }
  return checked(single.start, single.end);
}
