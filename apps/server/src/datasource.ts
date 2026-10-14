import type { Timestamp } from "@letsview/shared";

/** A signal as the source knows it, without metadata. */
export interface SignalRef {
  dataRef: string;
  name: string;
}

export interface RawPoint {
  t: Timestamp;
  v: number;
}

export interface Bucket {
  start: Timestamp;
  count: number;
  mean: number;
  min: number;
  max: number;
}

/**
 * Read-only access to one time-series source (ClickHouse now, ADX later). Ranges are half-open
 * [from, to). Points without a timestamp never appear in any result.
 */
export interface DataSource {
  listSignals(abort?: AbortSignal): Promise<SignalRef[]>;
  /** First and last timestamp of the signal's data, or undefined if it has none. */
  extent(
    ref: SignalRef,
    abort?: AbortSignal,
  ): Promise<{ first: Timestamp; last: Timestamp } | undefined>;
  count(ref: SignalRef, from: Timestamp, to: Timestamp, abort?: AbortSignal): Promise<number>;
  raw(ref: SignalRef, from: Timestamp, to: Timestamp, abort?: AbortSignal): Promise<RawPoint[]>;
  /** Last point strictly before `t`. */
  before(ref: SignalRef, t: Timestamp, abort?: AbortSignal): Promise<RawPoint | undefined>;
  /** First point at or after `t`. */
  after(ref: SignalRef, t: Timestamp, abort?: AbortSignal): Promise<RawPoint | undefined>;
  /** Non-empty buckets on the absolute grid `k * width`, ordered by start. */
  buckets(
    ref: SignalRef,
    from: Timestamp,
    to: Timestamp,
    width: bigint,
    abort?: AbortSignal,
  ): Promise<Bucket[]>;
}
