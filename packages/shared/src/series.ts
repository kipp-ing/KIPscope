import type { EncodedTimes } from "./encoding.ts";

/** A raw point just outside the requested range, as decimal-ns timestamp and value. */
export interface EdgePoint {
  t: string;
  /** null: the neighbor is an SNA point. */
  v: number | null;
}

/** Unmodified raw points inside [from, to) plus the nearest points outside each edge. */
export interface RawSeries {
  kind: "raw";
  signalId: string;
  from: string;
  to: string;
  t: EncodedTimes;
  /** One entry per timestamp in `t`; null where the point is SNA. */
  v: (number | null)[];
  before?: EdgePoint;
  after?: EdgePoint;
}

/**
 * Non-empty buckets on the absolute grid `k * width` (ns). Bucket i covers
 * [start_i, start_i + width) and aggregates only points inside [from, to).
 */
export interface BucketSeries {
  kind: "buckets";
  signalId: string;
  from: string;
  to: string;
  width: string;
  t: EncodedTimes;
  /** Valid (non-SNA) points per bucket. */
  count: number[];
  /** SNA points per bucket. count[i] + sna[i] ≥ 1 (buckets without points are omitted). */
  sna: number[];
  /** Over valid points only; null exactly when count[i] === 0. */
  mean: (number | null)[];
  min: (number | null)[];
  max: (number | null)[];
}

export type SeriesResult = RawSeries | BucketSeries;

/** First and last timestamp (decimal ns) of a signal's data. */
export interface Extent {
  signalId: string;
  first: string;
  last: string;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    signalId?: string;
    from?: string;
    to?: string;
  };
}
