import type { SeriesResult } from "./series.ts";
import { parseTimestamp, type Timestamp } from "./time.ts";

/**
 * Timestamps on the wire: `t0` as decimal nanoseconds plus per-point offsets from `t0` in
 * nanoseconds (design D3, H1). An offset travels as a JSON number while it is exact as a float
 * (|offset| ≤ 2^53 − 1), else as a decimal string, so every span within the time bounds is exact.
 */
export interface EncodedTimes {
  t0: string;
  /** Offset from t0 in ns per point: a number when |offset| ≤ 2^53 − 1, else a decimal string. */
  dt: (number | string)[];
}

const MAX_OFFSET = BigInt(Number.MAX_SAFE_INTEGER);
const DECIMAL = /^-?\d+$/;

export function encodeTimes(times: readonly Timestamp[]): EncodedTimes {
  const t0 = times[0] ?? 0n;
  const dt = times.map((t) => {
    const offset = t - t0;
    return offset > MAX_OFFSET || offset < -MAX_OFFSET ? offset.toString() : Number(offset);
  });
  return { t0: t0.toString(), dt };
}

/** RangeError for a number that is not a safe integer and a string that is not decimal. */
export function decodeTimes(encoded: EncodedTimes): Timestamp[] {
  const t0 = parseTimestamp(encoded.t0);
  return encoded.dt.map((offset) => {
    if (typeof offset === "number" && Number.isSafeInteger(offset)) return t0 + BigInt(offset);
    if (typeof offset === "string" && DECIMAL.test(offset)) return t0 + BigInt(offset);
    throw new RangeError(`invalid time offset: ${String(offset)}`);
  });
}

const isDecimal = (value: unknown): boolean => typeof value === "string" && DECIMAL.test(value);

/**
 * RangeError unless `value` is a SeriesResult: kind raw|buckets, from/to (and width) decimal, t
 * decodes, v (raw) or count, sna, mean, min, max (buckets) are arrays of t.dt's length.
 */
export function assertSeries(value: unknown): asserts value is SeriesResult {
  const fail = (what: string): never => {
    throw new RangeError(`malformed series result: ${what}`);
  };
  if (typeof value !== "object" || value === null) fail("not an object");
  const s = value as Record<string, unknown>;
  if (s.kind !== "raw" && s.kind !== "buckets") fail(`kind ${String(s.kind)}`);
  if (!isDecimal(s.from) || !isDecimal(s.to)) fail("from/to");
  const t = s.t as Partial<EncodedTimes> | null | undefined;
  if (typeof t !== "object" || t === null || typeof t.t0 !== "string" || !Array.isArray(t.dt))
    fail("t");
  const length = decodeTimes(t as EncodedTimes).length;
  const fields = s.kind === "raw" ? ["v"] : ["count", "sna", "mean", "min", "max"];
  if (s.kind === "buckets" && !isDecimal(s.width)) fail("width");
  for (const field of fields) {
    const array = s[field];
    if (!Array.isArray(array) || array.length !== length) fail(`${field} length`);
  }
}
