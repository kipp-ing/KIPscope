import type { EventRow, StateRow, Timestamp } from "@kipscope/shared";

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
  /** A text signal (state names in the row text, design N2): raw, before and after also read `text`. */
  text?: boolean;
}

export interface RawPoint {
  t: Timestamp;
  /** null: the point is SNA. */
  v: number | null;
  /** The row's text, only for a `SeriesRef` marked `text` (design E4). */
  text?: string;
}

/** How `stateChanges` detects a change (design E7): by row text, or into or out of a named value. */
export type StateChangeRule =
  | { kind: "text" }
  | { kind: "labels"; values: number[]; tolerance: number };

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
  /** All rows of the data ref, with or without a timestamp; cheap from part metadata (design G9 (b)). */
  refCount(dataRef: string, abort?: AbortSignal): Promise<number>;
  /** Non-empty buckets of all the data ref's rows on the grid k * width, any order. */
  refBuckets(
    dataRef: string,
    width: bigint,
    abort?: AbortSignal,
  ): Promise<{ start: Timestamp; count: number }[]>;
  /**
   * Consecutive timestamped rows of the data ref at least `minGap` apart, exact, time order, found
   * on the floor grid `grid` (≤ minGap / 2) (design G2); `last`: the data ref's last row time,
   * undefined without rows.
   */
  loggerGaps(
    dataRef: string,
    grid: bigint,
    minGap: bigint,
    abort?: AbortSignal,
  ): Promise<{ gaps: { from: Timestamp; to: Timestamp }[]; last?: Timestamp }>;
  /**
   * Up to `rows` timestamps of each named signal of the data ref, any order (design G3); signals
   * without rows are absent; no query for [].
   */
  firstTimes(
    dataRef: string,
    names: readonly string[],
    rows: number,
    abort?: AbortSignal,
  ): Promise<Map<string, Timestamp[]>>;
  /**
   * The data ref's event rows with a time, time order (ties kind, source, name), at most `limit`;
   * undefined when the events table does not exist (design E4).
   */
  events(dataRef: string, limit: number, abort?: AbortSignal): Promise<EventRow[] | undefined>;
  /** Rows of one signal (SNA left out) where the state changes, plus its first row; at most `limit` rows (E7). */
  stateChanges(
    ref: SeriesRef,
    by: StateChangeRule,
    limit: number,
    abort?: AbortSignal,
  ): Promise<StateRow[]>;
  /** Signals with non-empty text (one query); [] when the text column does not exist. */
  textSignals(abort?: AbortSignal): Promise<SignalRef[]>;
  /** Qualified events table name for log messages, e.g. `sdlog.events`; absent: "the events table". */
  readonly eventsTable?: string;
}
