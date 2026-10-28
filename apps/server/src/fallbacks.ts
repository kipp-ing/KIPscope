import {
  COMPUTED_MAX_ROWS,
  type ComputedSeriesInput,
  computeRows,
  type StateRow,
  TIME_MAX,
  TIME_MIN,
  type Timestamp,
} from "@kipscope/shared";
import { inputSeries } from "./computed.ts";
import type {
  Bucket,
  ComputedAnswer,
  ComputedInputRef,
  ComputedRef,
  DataSource,
  LoggerGaps,
  RawPoint,
  Scope,
  SeriesAnswer,
  SeriesRef,
  SignalRef,
  SourceAdapter,
  StateChangeRule,
} from "./datasource.ts";
import { TooWideError } from "./scanBound.ts";
import { MAX_BUCKET_WIDTH } from "./series.ts";

/** Points per `raw` page of the state-change fallback (≈ 2.4 MB of JSON). */
export const STATE_SCAN_PAGE = 100_000;
/** Points the state-change fallback reads at most per signal. */
export const STATE_SCAN_MAX = 5_000_000;

/** Thrown by the stateChanges fallback beyond STATE_SCAN_MAX points. */
export class ScanLimitError extends Error {
  readonly ref: SignalRef;
  readonly scanned: number;

  constructor(ref: SignalRef, scanned: number) {
    super(
      `${ref.dataRef}/${ref.name}: more than ${STATE_SCAN_MAX.toLocaleString("en")} points to scan for state changes`,
    );
    this.name = "ScanLimitError";
    this.ref = ref;
    this.scanned = scanned;
  }
}

/**
 * Thrown by the computedSeries fallback when one input holds more than its share of
 * COMPUTED_MAX_ROWS (design F8, D-107): `share` = floor(COMPUTED_MAX_ROWS / n).
 */
export class ComputedTooLargeError extends Error {
  constructor(signal: string, share: number) {
    super(`more than ${share.toLocaleString("en")} rows of ${signal} in this range: zoom in`);
    this.name = "ComputedTooLargeError";
  }
}

/** The optional methods of design C1, in its order (start log, tests). */
const OPTIONAL = [
  "count",
  "extent",
  "series",
  "refExtent",
  "refCount",
  "loggerGaps",
  "firstTimes",
  "stateChanges",
  "computedSeries",
  "events",
] as const;

/** Names of the optional methods the adapter implements (start log, tests). */
export function nativeMethods(adapter: SourceAdapter): string[] {
  return OPTIONAL.filter((name) => typeof adapter[name] === "function");
}

/** The adapter reduced to `info` and the 7 required methods (conformance core-only runs). */
export function coreOnly(adapter: SourceAdapter): SourceAdapter {
  return {
    info: adapter.info,
    ping: adapter.ping.bind(adapter),
    listSignals: adapter.listSignals.bind(adapter),
    raw: adapter.raw.bind(adapter),
    before: adapter.before.bind(adapter),
    after: adapter.after.bind(adapter),
    buckets: adapter.buckets.bind(adapter),
    refBuckets: adapter.refBuckets.bind(adapter),
  };
}

/** Rejects with the signal's reason once aborted, before a fallback sends its next query. */
const checkAbort = (abort?: AbortSignal) => abort?.throwIfAborted();

/** The signal without SNA ranges: every timestamped row counts. */
const plain = (dataRef: string, name: string): SeriesRef => ({ dataRef, name, sna: [] });

/**
 * Every optional method the adapter lacks, computed from its required ones (design C2); native
 * ones kept as they are. Sits outside the query queue, so each inner query of a fallback takes its
 * own queue slot and carries the caller's abort (design C3). With `scanRows`, the `series`
 * fallback refuses a range of more rows with TooWideError before `raw` or `buckets`
 * (speed-up-whole-scans B9); a native `series` is not checked.
 */
export function completeSource(
  adapter: SourceAdapter,
  options: { scanRows?: number } = {},
): DataSource {
  const { scanRows } = options;
  const source: DataSource = {
    info: adapter.info,
    ping: adapter.ping.bind(adapter),
    listSignals: adapter.listSignals.bind(adapter),
    raw: adapter.raw.bind(adapter),
    before: adapter.before.bind(adapter),
    after: adapter.after.bind(adapter),
    buckets: adapter.buckets.bind(adapter),
    refBuckets: adapter.refBuckets.bind(adapter),

    // A range touches at most 3 buckets of the widest grid (design H2).
    count:
      adapter.count?.bind(adapter) ??
      (async (ref, from, to, abort) => {
        const buckets = await adapter.buckets(
          plain(ref.dataRef, ref.name),
          from,
          to,
          MAX_BUCKET_WIDTH,
          abort,
        );
        return buckets.reduce((sum, b) => sum + b.count + b.sna, 0);
      }),

    extent:
      adapter.extent?.bind(adapter) ??
      (async (ref, scope, abort) => {
        const signal = plain(ref.dataRef, ref.name);
        const [first, last] = await Promise.all([
          adapter.after(signal, TIME_MIN, scope, abort),
          adapter.before(signal, TIME_MAX, scope, abort),
        ]);
        return first && last ? { first: first.t, last: last.t } : undefined;
      }),

    // The completed count first (native if the adapter has one), then today's calls (design A2).
    series:
      adapter.series?.bind(adapter) ??
      (async (ref, from, to, target, width, scope, abort) => {
        const n = await source.count(ref, from, to, abort);
        if (scanRows !== undefined && n > scanRows)
          throw new TooWideError({ rows: n, limit: scanRows });
        if (n <= target) {
          const [points, before, after] = await Promise.all([
            adapter.raw(ref, from, to, undefined, abort),
            adapter.before(ref, from, scope, abort),
            adapter.after(ref, to, scope, abort),
          ]);
          const answer: SeriesAnswer = { kind: "raw", points };
          if (before) answer.before = before;
          if (after) answer.after = after;
          return answer;
        }
        return { kind: "buckets", buckets: await adapter.buckets(ref, from, to, width, abort) };
      }),

    refExtent:
      adapter.refExtent?.bind(adapter) ??
      (async (dataRef, scope, abort) => {
        const buckets = await adapter.refBuckets(dataRef, MAX_BUCKET_WIDTH, true, scope, abort);
        let count = 0;
        let first: Timestamp | undefined;
        let last: Timestamp | undefined;
        for (const b of buckets) {
          count += b.count;
          if (b.first !== undefined && (first === undefined || b.first < first)) first = b.first;
          if (b.last !== undefined && (last === undefined || b.last > last)) last = b.last;
        }
        return count > 0 && first !== undefined && last !== undefined
          ? { count, first, last }
          : undefined;
      }),

    // The completed refExtent: native if the adapter has one.
    refCount:
      adapter.refCount?.bind(adapter) ??
      (async (dataRef, scope, abort) =>
        (await source.refExtent(dataRef, scope, abort))?.count ?? 0),

    loggerGaps:
      adapter.loggerGaps?.bind(adapter) ??
      (async (dataRef, grid, minGap, scope, abort) => {
        const buckets = (await adapter.refBuckets(dataRef, grid, true, scope, abort))
          .filter((b) => b.first !== undefined && b.last !== undefined)
          .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
        const result: LoggerGaps = { gaps: [] };
        let previous: Timestamp | undefined;
        for (const b of buckets) {
          const first = b.first as Timestamp;
          const last = b.last as Timestamp;
          if (previous !== undefined && first - previous >= minGap)
            result.gaps.push({ from: previous, to: first });
          previous = previous === undefined || last > previous ? last : previous;
        }
        if (previous !== undefined) result.last = previous;
        return result;
      }),

    // One `raw` per name; with a queued adapter at most `limit` of them run at once.
    firstTimes:
      adapter.firstTimes?.bind(adapter) ??
      (async (dataRef, names, rows, scope, abort) => {
        const times = new Map<string, Timestamp[]>();
        if (names.length === 0) return times;
        checkAbort(abort);
        const from = scope?.from ?? TIME_MIN;
        const to = scope?.to ?? TIME_MAX;
        const answers = await Promise.all(
          names.map((name) => adapter.raw(plain(dataRef, name), from, to, rows, abort)),
        );
        for (const [i, name] of names.entries()) {
          const points = answers[i] as RawPoint[];
          if (points.length > 0)
            times.set(
              name,
              points.map((p) => p.t),
            );
        }
        return times;
      }),

    stateChanges:
      adapter.stateChanges?.bind(adapter) ??
      ((ref, by, limit, scope, abort) => scanStateChanges(adapter, ref, by, limit, scope, abort)),

    computedSeries:
      adapter.computedSeries?.bind(adapter) ??
      ((ref, from, to, target, width, abort) =>
        computeFromRaw(adapter, ref, from, to, target, width, abort)),

    events: adapter.events?.bind(adapter) ?? (async () => undefined),
  };
  return source;
}

/**
 * The computedSeries fallback (design C8, F8): `raw` of all n inputs in one parallel wave, each with
 * one row more than its share floor(COMPUTED_MAX_ROWS / n), so the rows in memory never exceed the
 * cap (D-107); then `computeRows`; raw when the inputs hold at most `target` rows together, else
 * buckets of the exact rows.
 */
async function computeFromRaw(
  adapter: SourceAdapter,
  ref: ComputedRef,
  from: Timestamp,
  to: Timestamp,
  target: number,
  width: bigint,
  abort?: AbortSignal,
): Promise<ComputedAnswer> {
  checkAbort(abort);
  const share = Math.floor(COMPUTED_MAX_ROWS / ref.inputs.length);
  const read = async (input: ComputedInputRef) => {
    const points = await adapter.raw(inputSeries(input), from, to, share + 1, abort);
    if (points.length > share) throw new ComputedTooLargeError(input.name, share);
    return points;
  };
  const points = await Promise.all(ref.inputs.map(read));
  const inputs = ref.inputs.map((r, k): ComputedSeriesInput => {
    const i: ComputedSeriesInput = { points: points[k] as RawPoint[] };
    if (r.seed) i.seed = r.seed;
    if (r.holdNs !== undefined) i.holdNs = r.holdNs;
    return i;
  });
  const rows = computeRows(ref.ast, inputs);
  const n = inputs.reduce((sum, i) => sum + i.points.length, 0);
  if (n <= target) return { kind: "raw", points: rows };
  return { kind: "buckets", buckets: bucketRows(rows, width) };
}

/** Rows (ascending) on the floor grid `k * width`: valid and SNA counts, mean, min, max of the valid. */
function bucketRows(rows: readonly RawPoint[], width: bigint): Bucket[] {
  const buckets: Bucket[] = [];
  let bucket: Bucket | undefined;
  let sum = 0;
  const close = () => {
    if (bucket && bucket.count > 0) bucket.mean = sum / bucket.count;
  };
  for (const row of rows) {
    const start = row.t - (((row.t % width) + width) % width);
    if (bucket?.start !== start) {
      close();
      bucket = { start, count: 0, sna: 0, mean: null, min: null, max: null };
      buckets.push(bucket);
      sum = 0;
    }
    if (row.v === null) {
      bucket.sna++;
      continue;
    }
    bucket.count++;
    sum += row.v;
    if (bucket.min === null || row.v < bucket.min) bucket.min = row.v;
    if (bucket.max === null || row.v > bucket.max) bucket.max = row.v;
  }
  close();
  return buckets;
}

/** Whether `point` is a state change after `prev` (design E7, as the ClickHouse query). */
function changed(by: StateChangeRule, point: RawPoint, prev: RawPoint): boolean {
  if (by.kind === "text") return (point.text ?? "") !== (prev.text ?? "");
  const v = point.v as number;
  const pv = prev.v as number;
  const near = (x: number) => by.values.some((l) => Math.abs(x - l) <= by.tolerance);
  return Math.abs(v - pv) > by.tolerance && (near(v) || near(pv));
}

/**
 * The stateChanges fallback: reads the signal page by page in time order (within the scope, if
 * any), skips SNA points, and keeps the first valid point plus every change, up to `limit` rows. Beyond STATE_SCAN_MAX points
 * it throws ScanLimitError (the last page asks for one point more to tell).
 */
async function scanStateChanges(
  adapter: SourceAdapter,
  ref: SeriesRef,
  by: StateChangeRule,
  limit: number,
  scope?: Scope,
  abort?: AbortSignal,
): Promise<StateRow[]> {
  // A labels signal is named by its value, so it does not need the text (design E7).
  const { text: _, ...base } = ref;
  const signal: SeriesRef = by.kind === "text" ? { ...base, text: true } : base;
  const textOf = (p: RawPoint) => (by.kind === "text" ? (p.text ?? "") : "");
  const rows: StateRow[] = [];
  let prev: RawPoint | undefined;
  let from = scope?.from ?? TIME_MIN;
  const to = scope?.to ?? TIME_MAX;
  let scanned = 0;
  while (rows.length < limit) {
    checkAbort(abort);
    const want = Math.min(STATE_SCAN_PAGE, STATE_SCAN_MAX - scanned);
    const last = scanned + want === STATE_SCAN_MAX;
    const page = await adapter.raw(signal, from, to, last ? want + 1 : want, abort);
    for (const point of page.slice(0, want)) {
      if (point.v === null) continue;
      if (!prev || changed(by, point, prev)) {
        const row: StateRow = { t: point.t.toString(), value: point.v, text: textOf(point) };
        if (prev) row.prev = { t: prev.t.toString(), value: prev.v as number, text: textOf(prev) };
        rows.push(row);
        if (rows.length >= limit) return rows;
      }
      prev = point;
    }
    scanned += Math.min(page.length, want);
    if (page.length > want) throw new ScanLimitError(ref, scanned + page.length - want);
    // The last page is full at exactly STATE_SCAN_MAX points: the scan is complete.
    if (last || page.length < want) break;
    from = (page[page.length - 1] as RawPoint).t + 1n;
  }
  return rows;
}
