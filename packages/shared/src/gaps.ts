import type { SignalInfo } from "./signals.ts";

/** D-062: a split needs more than this many periods between two points. */
export const GAP_PERIODS = 3;
/** Shortest logger gap: 2 s (design G2). */
export const LOGGER_GAP_MIN = 2_000_000_000n;
/** Grid of the logger-gap query; must be ≤ LOGGER_GAP_MIN / 2 so every gap is found exactly (G2). */
export const LOGGER_GAP_GRID = LOGGER_GAP_MIN / 2n;
/** Rows read per signal to measure a period (G3). */
export const PERIOD_SAMPLE_ROWS = 1001;
/** A measured period needs at least this many spacings. */
export const PERIOD_MIN_SPACINGS = 100;
/** …and at most this share of spacings longer than GAP_PERIODS medians. */
export const PERIOD_MAX_LONG_SHARE = 0.05;

export type PeriodSource = "dbc" | "diag" | "measured";
/** Decimal ns. */
export interface SignalPeriod {
  ns: string;
  source: PeriodSource;
}
/** From the earlier row's time to the later row's time, decimal ns. */
export interface LoggerGapJson {
  from: string;
  to: string;
}
/** Body of GET /api/gaps (design G6). */
export interface GapInfo {
  dataRef: string;
  /** The data ref's last row time when computed; absent without rows. Later rows have no known logger gaps. */
  through?: string;
  /** Time order, not overlapping. */
  logger: LoggerGapJson[];
  /** Signal ID → period, for every catalog signal of the data ref that has one. */
  periods: Record<string, SignalPeriod>;
}

export interface LoggerGap {
  from: bigint;
  to: bigint;
}
/** What the gap rule needs for one signal; `logger` sorted by `from`. */
export interface SignalGaps {
  period?: bigint;
  logger: readonly LoggerGap[];
}
export const NO_GAPS: SignalGaps = Object.freeze({ logger: Object.freeze([]) });
/** A split pair (G4): the kind for the reason, and how long the earlier value may be held. */
export interface Split {
  kind: "logger" | "period";
  holdEnd: bigint;
}

const NS_PER_MS = 1_000_000n;
const msToNs = (ms: number) => BigInt(Math.round(ms)) * NS_PER_MS;

/** dbc.cycleMs, else diag.intervalMs, in ns; undefined when neither (G3). Pure. */
export function staticPeriod(info: SignalInfo): { ns: bigint; source: "dbc" | "diag" } | undefined {
  const cycle = info.dbc?.cycleMs;
  if (cycle !== undefined && cycle > 0) return { ns: msToNs(cycle), source: "dbc" };
  const interval = info.diag?.intervalMs;
  if (interval !== undefined && interval > 0) return { ns: msToNs(interval), source: "diag" };
  return undefined;
}

const ascending = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * G3: the median of the positive spacings between the sorted times, accepted with at least
 * PERIOD_MIN_SPACINGS spacings of which at most PERIOD_MAX_LONG_SHARE are longer than
 * GAP_PERIODS medians (duplicates count as spacings, not long ones). Sorts a copy; undefined when
 * not measurable. Pure.
 */
export function measurePeriod(times: readonly bigint[]): bigint | undefined {
  const sorted = [...times].sort(ascending);
  const spacings: bigint[] = [];
  for (let i = 1; i < sorted.length; i++)
    spacings.push((sorted[i] as bigint) - (sorted[i - 1] as bigint));
  if (spacings.length < PERIOD_MIN_SPACINGS) return undefined;
  const positive = spacings.filter((d) => d > 0n).sort(ascending);
  const median = positive[Math.floor(positive.length / 2)];
  if (median === undefined) return undefined;
  const limit = BigInt(GAP_PERIODS) * median;
  const long = spacings.filter((d) => d > limit).length;
  return long <= PERIOD_MAX_LONG_SHARE * spacings.length ? median : undefined;
}

/** Index of the first gap with to > t (gaps sorted and not overlapping, so `to` ascends too). */
function firstEndingAfter(t: bigint, logger: readonly LoggerGap[]): number {
  let lo = 0;
  let hi = logger.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((logger[mid] as LoggerGap).to > t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** The earliest logger gap with from < q and to > p; binary search. Pure. */
export function loggerGapBetween(
  p: bigint,
  q: bigint,
  logger: readonly LoggerGap[],
): LoggerGap | undefined {
  const gap = logger[firstEndingAfter(p, logger)];
  return gap !== undefined && gap.from < q ? gap : undefined;
}

/** The logger gap with from < t < to. Pure. */
export function loggerGapAt(t: bigint, logger: readonly LoggerGap[]): LoggerGap | undefined {
  const gap = logger[firstEndingAfter(t, logger)];
  return gap !== undefined && gap.from < t ? gap : undefined;
}

/**
 * G4: consecutive points p < q are split by a logger gap between them, or by more than
 * GAP_PERIODS periods; the earlier value holds up to min(p + period, the gap's start). Pure.
 */
export function splitPoints(p: bigint, q: bigint, gaps: SignalGaps): Split | undefined {
  const gap = loggerGapBetween(p, q, gaps.logger);
  const { period } = gaps;
  const periodSplit = period !== undefined && q - p > BigInt(GAP_PERIODS) * period;
  if (!gap && !periodSplit) return undefined;
  let holdEnd: bigint | undefined = gap?.from;
  if (periodSplit) {
    const end = p + (period as bigint);
    if (holdEnd === undefined || end < holdEnd) holdEnd = end;
  }
  return { kind: gap ? "logger" : "period", holdEnd: holdEnd as bigint };
}

/**
 * G5, consecutive non-empty buckets starting at s1 < s2 of width w: split only where a gap is
 * certain (an empty stretch of more than GAP_PERIODS periods, or a logger gap between the bucket
 * centres). Pure.
 */
export function splitBuckets(
  s1: bigint,
  s2: bigint,
  width: bigint,
  gaps: SignalGaps,
): Split["kind"] | undefined {
  const { period } = gaps;
  if (period !== undefined && s2 - (s1 + width) > BigInt(GAP_PERIODS) * period) return "period";
  const half = width / 2n;
  if (loggerGapBetween(s1 + half, s2 + half, gaps.logger)) return "logger";
  return undefined;
}

interface Decoded {
  logger: readonly LoggerGap[];
  bySignal: Map<string, SignalGaps>;
}
const decoded = new WeakMap<GapInfo, Decoded>();

/** The SignalGaps of one signal from a GapInfo (decoded once per GapInfo); NO_GAPS for undefined. */
export function signalGaps(info: GapInfo | undefined, signalId: string): SignalGaps {
  if (!info) return NO_GAPS;
  let d = decoded.get(info);
  if (!d) {
    const logger = info.logger.map((g) => ({ from: BigInt(g.from), to: BigInt(g.to) }));
    d = { logger, bySignal: new Map() };
    decoded.set(info, d);
  }
  let gaps = d.bySignal.get(signalId);
  if (!gaps) {
    const period = info.periods[signalId];
    gaps = period ? { period: BigInt(period.ns), logger: d.logger } : { logger: d.logger };
    d.bySignal.set(signalId, gaps);
  }
  return gaps;
}
