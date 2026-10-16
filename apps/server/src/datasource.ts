import type { Timestamp } from "@kipscope/shared";

/** A signal as the source knows it, without metadata. */
export interface SignalRef {
  dataRef: string;
  name: string;
}

/** Closed interval of stored values that mean SNA. */
export interface SnaRange {
  lo: number;
  hi: number;
}

/** A signal plus its SNA ranges, for value-returning queries. Empty `sna`: no SNA. */
export interface SeriesRef extends SignalRef {
  sna: readonly SnaRange[];
}

export interface RawPoint {
  t: Timestamp;
  /** null: the point is SNA. */
  v: number | null;
}

export interface Bucket {
  start: Timestamp;
  /** Valid (non-SNA) points. */
  count: number;
  /** SNA points. */
  sna: number;
  /** Over valid points only; null iff count === 0. */
  mean: number | null;
  min: number | null;
  max: number | null;
}

/**
 * Read-only access to one time-series source (ClickHouse now, ADX later). Ranges are half-open
 * [from, to). Points without a timestamp never appear in any result. Value-returning queries take a
 * `SeriesRef` and report values within its SNA ranges as SNA (design S3, S6).
 */
export interface DataSource {
  listSignals(abort?: AbortSignal): Promise<SignalRef[]>;
  /** First and last timestamp of the signal's data, or undefined if it has none. */
  extent(
    ref: SignalRef,
    abort?: AbortSignal,
  ): Promise<{ first: Timestamp; last: Timestamp } | undefined>;
  count(ref: SignalRef, from: Timestamp, to: Timestamp, abort?: AbortSignal): Promise<number>;
  raw(ref: SeriesRef, from: Timestamp, to: Timestamp, abort?: AbortSignal): Promise<RawPoint[]>;
  /** Last point strictly before `t`. */
  before(ref: SeriesRef, t: Timestamp, abort?: AbortSignal): Promise<RawPoint | undefined>;
  /** First point at or after `t`. */
  after(ref: SeriesRef, t: Timestamp, abort?: AbortSignal): Promise<RawPoint | undefined>;
  /** Non-empty buckets on the absolute grid `k * width`, ordered by start. */
  buckets(
    ref: SeriesRef,
    from: Timestamp,
    to: Timestamp,
    width: bigint,
    abort?: AbortSignal,
  ): Promise<Bucket[]>;
  /** Rows of the data ref with a timestamp: count, first and last; undefined if none. */
  refExtent(
    dataRef: string,
    abort?: AbortSignal,
  ): Promise<{ count: number; first: Timestamp; last: Timestamp } | undefined>;
  /** Non-empty buckets of all the data ref's rows on the grid k * width, any order. */
  refBuckets(
    dataRef: string,
    width: bigint,
    abort?: AbortSignal,
  ): Promise<{ start: Timestamp; count: number }[]>;
}
