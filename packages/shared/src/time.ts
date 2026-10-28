/**
 * Timestamps are nanoseconds since the Unix epoch (UTC) as bigint, so any source precision down
 * to nanoseconds survives. In JSON they travel as decimal strings (design D3).
 */
export type Timestamp = bigint;

export const NS_PER_US = 1_000n;
export const NS_PER_MS = 1_000_000n;
export const NS_PER_S = 1_000_000_000n;

/** Inclusive bounds for every timestamp in commands and series requests (int64 ns and ClickHouse DateTime64 safe). */
export const TIME_MIN: Timestamp = -2_208_988_800_000_000_000n; // 1900-01-01T00:00:00Z
export const TIME_MAX: Timestamp = 9_223_286_400_000_000_000n; // 2262-04-11T00:00:00Z

const DECIMAL = /^-?\d+$/;
const ISO =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/;

/** Floor division, also correct for timestamps before 1970. */
export function floorDiv(a: bigint, b: bigint): bigint {
  const q = a / b;
  return a % b !== 0n && a < 0n !== b < 0n ? q - 1n : q;
}

export const MAX_DENSITY_BARS = 120;

const NS_PER_MIN = 60n * NS_PER_S;
const NS_PER_H = 60n * NS_PER_MIN;
const NS_PER_D = 24n * NS_PER_H;
const NS_PER_Y = 365n * NS_PER_D;

/** ns, ascending: 1 2 5 10 20 50 100 200 500 ms; 1 2 5 10 15 30 s; 1 2 5 10 15 30 min; 1 2 3 6 12 h; 1 2 7 14 30 90 180 d; 1 2 5 10 20 50 100 × 365 d. */
export const DENSITY_WIDTHS: readonly bigint[] = [
  ...[1n, 2n, 5n, 10n, 20n, 50n, 100n, 200n, 500n].map((n) => n * NS_PER_MS),
  ...[1n, 2n, 5n, 10n, 15n, 30n].map((n) => n * NS_PER_S),
  ...[1n, 2n, 5n, 10n, 15n, 30n].map((n) => n * NS_PER_MIN),
  ...[1n, 2n, 3n, 6n, 12n].map((n) => n * NS_PER_H),
  ...[1n, 2n, 7n, 14n, 30n, 90n, 180n].map((n) => n * NS_PER_D),
  ...[1n, 2n, 5n, 10n, 20n, 50n, 100n].map((n) => n * NS_PER_Y),
];

/** Smallest width with floor(last/w) − floor(first/w) + 1 ≤ MAX_DENSITY_BARS (floor toward −∞). */
export function densityWidth(first: bigint, last: bigint): bigint {
  const max = BigInt(MAX_DENSITY_BARS);
  for (const w of DENSITY_WIDTHS) {
    if (floorDiv(last, w) - floorDiv(first, w) + 1n <= max) return w;
  }
  // Unreachable within [TIME_MIN, TIME_MAX]: 100 × 365 d covers it in 4 buckets.
  return DENSITY_WIDTHS[DENSITY_WIDTHS.length - 1] as bigint;
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

const SPAN_UNITS: { unit: string; ns: bigint }[] = [
  { unit: "y", ns: NS_PER_Y },
  { unit: "d", ns: NS_PER_D },
  { unit: "h", ns: NS_PER_H },
  { unit: "min", ns: NS_PER_MIN },
  { unit: "s", ns: NS_PER_S },
  { unit: "ms", ns: NS_PER_MS },
];

/** Largest of y (365 d), d, h, min, s, ms that ns reaches (else ms); Math.round(x * 10) / 10, no ".0". 0 → "0 ms". */
export function formatSpan(ns: bigint): string {
  const { unit, ns: size } = SPAN_UNITS.find((u) => ns >= u.ns) ?? { unit: "ms", ns: NS_PER_MS };
  return `${Math.round((Number(ns) / Number(size)) * 10) / 10} ${unit}`;
}
