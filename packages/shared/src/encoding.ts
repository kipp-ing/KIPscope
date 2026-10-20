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

/** Runs `bytes` through a (de)compression stream; rejects once the output exceeds `limit`. */
async function transform(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
  limit: number,
  what: string,
): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new RangeError(`${what} inflates to more than ${limit} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/** base64url (no padding) of deflate-raw of the UTF-8 text: the code of `#view=` and `#cases=` links. */
export async function packCode(text: string): Promise<string> {
  const packed = await transform(
    new TextEncoder().encode(text),
    new CompressionStream("deflate-raw"),
    Number.POSITIVE_INFINITY,
    "text",
  );
  let binary = "";
  for (let i = 0; i < packed.length; i += 0x8000) {
    binary += String.fromCharCode(...packed.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Inverse of packCode; rejects bad base64url and bad deflate (SyntaxError, TypeError) and more
 * than `limit` bytes inflated (RangeError, after inflating no more than the limit). `what` names
 * the code in messages.
 */
export async function unpackCode(code: string, limit: number, what: string): Promise<string> {
  if (!/^[A-Za-z0-9_-]+$/.test(code) || code.length % 4 === 1) {
    throw new SyntaxError(`not a ${what} code`);
  }
  const binary = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const text = await transform(bytes, new DecompressionStream("deflate-raw"), limit, what);
  return new TextDecoder("utf-8", { fatal: true }).decode(text);
}
