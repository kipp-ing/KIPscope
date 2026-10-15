import {
  floorDiv,
  NS_PER_MS,
  NS_PER_S,
  NS_PER_US,
  TIME_MAX,
  TIME_MIN,
  type Timestamp,
} from "./time.ts";

const DECIMAL = /^-?\d+$/;
const DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))?$/;
const DURATION = /^([+-]?)(\d+(?:\.\d+)?|\.\d+)(ns|us|µs|ms|s|min|h)$/;

const MS_PER_DAY = 86_400_000;

const UNITS: Record<string, bigint> = {
  ns: 1n,
  us: NS_PER_US,
  µs: NS_PER_US,
  ms: NS_PER_MS,
  s: NS_PER_S,
  min: 60n * NS_PER_S,
  h: 3_600n * NS_PER_S,
};

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

/** Milliseconds since the epoch of the given UTC fields; years 0–99 are taken literally. */
function utcMs(y: number, mo: number, d: number, h: number, mi: number, s: number): number {
  const date = new Date(0);
  date.setUTCFullYear(y, mo - 1, d);
  date.setUTCHours(h, mi, s, 0);
  return date.getTime();
}

/** Offset of the runtime's local time from UTC at instant `ms`, in ms (exact, from the fields). */
function offsetMs(ms: number): number {
  const d = new Date(ms);
  const wall = utcMs(
    d.getFullYear(),
    d.getMonth() + 1,
    d.getDate(),
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
  );
  return wall + d.getMilliseconds() - ms;
}

function formatOffset(ms: number): string {
  const minutes = Math.round(Math.abs(ms) / 60_000);
  return `${ms < 0 ? "-" : "+"}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

function checkBounds(t: Timestamp, text: string): Timestamp {
  if (t < TIME_MIN || t > TIME_MAX) {
    throw new RangeError(`time outside 1900-01-01T00:00:00Z … 2262-04-11T00:00:00Z: ${text}`);
  }
  return t;
}

/**
 * Local wall time as the UI shows it: "YYYY-MM-DD HH:MM:SS[.fff[fff[fff]]]", fraction trimmed in
 * 3-digit groups (same text as web formatFull). With offset: plus "+HH:MM"/"-HH:MM" (never "Z").
 * Time zone: the runtime's (process TZ in Node, the browser's in the UI).
 */
export function formatLocal(t: Timestamp, options?: { offset?: boolean }): string {
  const ms = Number(floorDiv(t, NS_PER_MS));
  const d = new Date(ms);
  const date = `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  let text = `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  let frac = (t - floorDiv(t, NS_PER_S) * NS_PER_S).toString().padStart(9, "0");
  while (frac.endsWith("000")) frac = frac.slice(0, -3);
  if (frac) text += `.${frac}`;
  return options?.offset ? text + formatOffset(offsetMs(ms)) : text;
}

/**
 * Absolute time: decimal ns; or "YYYY-MM-DD[T ]HH:MM[:SS[.f{1,9}]]" with "Z" or "±HH:MM";
 * or the same without zone as local wall time. Throws RangeError with a message for bad syntax,
 * an invalid date, a local time that does not exist or is ambiguous (message names both offsets),
 * and times outside TIME_MIN … TIME_MAX.
 */
export function parseTime(text: string): Timestamp {
  if (DECIMAL.test(text)) return checkBounds(BigInt(text), text);
  const m = DATE_TIME.exec(text);
  if (!m)
    throw new RangeError(`not a time (ns, ISO-8601 or local YYYY-MM-DD HH:MM[:SS[.f]]): ${text}`);
  const [, y, mo, d, h, mi, s = "00", frac = "", zone, sign, oh, om] = m;
  const fields = [y, mo, d, h, mi, s].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const wall = utcMs(...fields);
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== fields[0] ||
    check.getUTCMonth() + 1 !== fields[1] ||
    check.getUTCDate() !== fields[2] ||
    check.getUTCHours() !== fields[3] ||
    check.getUTCMinutes() !== fields[4] ||
    check.getUTCSeconds() !== fields[5] ||
    (zone !== undefined && zone !== "Z" && (Number(oh) > 23 || Number(om) > 59))
  ) {
    throw new RangeError(`invalid date or time: ${text}`);
  }
  let instant: number;
  if (zone === "Z") {
    instant = wall;
  } else if (zone !== undefined) {
    const offset = (Number(oh) * 60 + Number(om)) * 60_000;
    instant = sign === "+" ? wall - offset : wall + offset;
  } else {
    // Local wall time: the instants whose local offset maps back to this wall time.
    const offsets = new Set([wall - MS_PER_DAY, wall, wall + MS_PER_DAY].map(offsetMs));
    const instants = [...offsets]
      .map((o) => wall - o)
      .filter((i) => offsetMs(i) === wall - i)
      .sort((a, b) => a - b);
    if (instants.length === 0) {
      throw new RangeError(`does not exist in local time (DST change): ${text}`);
    }
    if (instants.length > 1) {
      const names = instants.map((i) => formatOffset(offsetMs(i))).join(" or ");
      throw new RangeError(`ambiguous local time ${text}: add ${names}`);
    }
    instant = instants[0] as number;
  }
  return checkBounds(BigInt(instant) * NS_PER_MS + BigInt(frac.padEnd(9, "0") || "0"), text);
}

/** "[+-]<decimal><unit>", unit ns|us|µs|ms|s|min|h, exact to 1 ns; throws RangeError otherwise. */
export function parseDuration(text: string): bigint {
  const m = DURATION.exec(text);
  if (!m)
    throw new RangeError(`not a duration (e.g. 500ms, -1.5s; units ns us µs ms s min h): ${text}`);
  const [, sign, number, unit] = m as unknown as [string, string, string, string];
  const [whole = "", frac = ""] = number.split(".");
  const scale = 10n ** BigInt(frac.length);
  const scaled = BigInt(whole + frac || "0") * (UNITS[unit] as bigint);
  if (scaled % scale !== 0n) throw new RangeError(`duration finer than 1 ns: ${text}`);
  const ns = scaled / scale;
  return sign === "-" ? -ns : ns;
}
