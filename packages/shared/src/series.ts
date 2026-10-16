import type { EncodedTimes } from "./encoding.ts";

/** A raw point just outside the requested range, as decimal-ns timestamp and value. */
export interface EdgePoint {
  t: string;
  /** null: the neighbor is an SNA point. */
  v: number | null;
  /** Text signals: the point's row text (design N3). */
  label?: string;
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
  /** Text signals: the row text, one per point (design N3). */
  text?: string[];
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

/** One drive of a recording (spec time-strip "Drives of a recording"). Decimal ns. */
export interface Drive {
  from: string;
  to: string;
  /** All rows of the data ref in [from, to), active grid buckets or not. */
  rows: number;
}

/** Rows per bucket of one data ref over its whole extent (spec time-strip). Decimal ns strings. */
export interface Density {
  dataRef: string;
  first: string;
  last: string;
  /** One of DENSITY_WIDTHS. */
  width: string;
  /** floor(first / width) * width. */
  start: string;
  /** counts[i]: rows in [start + i*width, start + (i+1)*width); length floor(last/w) − floor(first/w) + 1 ≤ MAX_DENSITY_BARS. */
  counts: number[];
  /** Drive grid in ns: width / DRIVE_GRID_PER_BAR (design S2 of add-strip-navigation). */
  grid: string;
  /** In time order, not overlapping; [] when none. */
  drives: Drive[];
}

export interface ApiError {
  error: {
    code: string;
    message: string;
    signalId?: string;
    from?: string;
    to?: string;
    /** 503 `catalog_unavailable`: still loading vs. source unreachable. */
    reason?: string;
  };
}
