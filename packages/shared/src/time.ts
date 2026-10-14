/**
 * Timestamps are nanoseconds since the Unix epoch (UTC) as bigint, so any source precision down
 * to nanoseconds survives. In JSON they travel as decimal strings (design D3).
 */
export type Timestamp = bigint;

export const NS_PER_US = 1_000n;
export const NS_PER_MS = 1_000_000n;
export const NS_PER_S = 1_000_000_000n;

const DECIMAL = /^-?\d+$/;
const ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

/** Floor division, also correct for timestamps before 1970. */
export function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

export function parseTimestamp(text: string): Timestamp {
  if (!DECIMAL.test(text)) throw new RangeError(`not a decimal nanosecond timestamp: ${text}`);
  return BigInt(text);
}

export function formatTimestamp(t: Timestamp): string {
  return t.toString();
}

/** Parses ISO-8601 with up to nine fractional digits and `Z` or a `±HH:MM` offset. */
export function fromIso(text: string): Timestamp {
  const m = ISO.exec(text);
  if (!m) throw new RangeError(`not an ISO-8601 timestamp: ${text}`);
  const [, y, mo, d, h, mi, s, frac = "", zone, sign, oh, om] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  const check = new Date(ms).toISOString();
  if (check.slice(0, 19) !== `${y}-${mo}-${d}T${h}:${mi}:${s}`) {
    throw new RangeError(`invalid date or time: ${text}`);
  }
  let t = BigInt(ms) * NS_PER_MS + BigInt(frac.padEnd(9, "0") || "0");
  if (zone !== "Z") {
    const offset = BigInt(Number(oh) * 60 + Number(om)) * 60n * NS_PER_S;
    t = sign === "+" ? t - offset : t + offset;
  }
  return t;
}

/**
 * Formats as UTC ISO-8601. The fraction uses as many 3-digit groups as needed (ms, µs, ns), so
 * values parsed by `fromIso` from 3, 6 or 9 digits round-trip exactly.
 */
export function toIso(t: Timestamp): string {
  const seconds = floorDiv(t, NS_PER_S);
  const nanos = t - seconds * NS_PER_S;
  const base = new Date(Number(seconds) * 1000).toISOString().slice(0, 19);
  if (nanos === 0n) return `${base}Z`;
  let frac = nanos.toString().padStart(9, "0");
  while (frac.endsWith("000")) frac = frac.slice(0, -3);
  return `${base}.${frac}Z`;
}
