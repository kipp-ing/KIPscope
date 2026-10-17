import type { EventRow, StateRow, Timestamp } from "@kipscope/shared";

/** A signal as the source knows it, without metadata. */
export interface SignalRef {
  dataRef: string;
  name: string;
}

/** A listed signal; `text`: some of its rows carry non-empty text (state names, add-events N1). */
export interface SourceSignal extends SignalRef {
  text?: boolean;
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

/** A bucket of all timestamped rows of a data ref; `first`/`last` (row times) only when asked for. */
export interface RefBucket {
  start: Timestamp;
  count: number;
  first?: Timestamp;
  last?: Timestamp;
}

/** Logger gaps of a data ref (design G2); `last`: its last row time, undefined without rows. */
export interface LoggerGaps {
  gaps: { from: Timestamp; to: Timestamp }[];
  last?: Timestamp;
}

/** Labels of a source for meta, footer and log messages; never a URL or a credential. */
export interface SourceInfo {
  /** `clickhouse`, `adx`, or a new adapter's own word; the footer labels the known ones. */
  kind: string;
  database: string;
  table: string;
  /** Events table for log lines, e.g. `sdlog.events`; absent: "the events table". */
  eventsTable?: string;
}

/**
 * What an adapter author implements (docs/data-sources.md, design C1): read-only access to one
 * time-series source. Ranges are half-open [from, to), points ascending by time, times `bigint`
 * ns; rows without a time never appear in any result. Value-returning queries take a `SeriesRef`
 * and report values within its SNA ranges as SNA (design S3, S6). `abort` is always the last
 * parameter; an aborted call rejects with the signal's reason and leaves no work running.
 */
export interface SourceAdapter {
  readonly info: SourceInfo;
  /** Resolves when the source answers; never through the query queue. */
  ping(abort: AbortSignal): Promise<void>;
  listSignals(abort?: AbortSignal): Promise<SourceSignal[]>;
  /** Points in [from, to), ascending; with `limit` the earliest `limit` of them. */
  raw(
    ref: SeriesRef,
    from: Timestamp,
    to: Timestamp,
    limit?: number,
    abort?: AbortSignal,
  ): Promise<RawPoint[]>;
  /** Last point strictly before `t`. */
  before(ref: SeriesRef, t: Timestamp, abort?: AbortSignal): Promise<RawPoint | undefined>;
  /** First point at or after `t`. */
  after(ref: SeriesRef, t: Timestamp, abort?: AbortSignal): Promise<RawPoint | undefined>;
  /** Non-empty buckets on the floor grid `k * width` (also before 1970), ordered by start. */
  buckets(
    ref: SeriesRef,
    from: Timestamp,
    to: Timestamp,
    width: bigint,
    abort?: AbortSignal,
  ): Promise<Bucket[]>;
  /** Non-empty buckets of all timestamped rows of the data ref on k * width, any order; `times`: with first/last. */
  refBuckets(
    dataRef: string,
    width: bigint,
    times: boolean,
    abort?: AbortSignal,
  ): Promise<RefBucket[]>;

  // Optional fast paths; the server computes a missing one from the methods above (C2).
  count?(ref: SignalRef, from: Timestamp, to: Timestamp, abort?: AbortSignal): Promise<number>;
  /** First and last timestamp of the signal's data, or undefined if it has none. */
  extent?(
    ref: SignalRef,
    abort?: AbortSignal,
  ): Promise<{ first: Timestamp; last: Timestamp } | undefined>;
  /** Rows of the data ref with a timestamp: count, first and last; undefined if none. */
  refExtent?(
    dataRef: string,
    abort?: AbortSignal,
  ): Promise<{ count: number; first: Timestamp; last: Timestamp } | undefined>;
  /** A row count that changes whenever rows are added; rows without time may count, consistently (design G9 (b)). */
  refCount?(dataRef: string, abort?: AbortSignal): Promise<number>;
  /**
   * Consecutive timestamped rows of the data ref at least `minGap` apart, exact, time order, found
   * on the floor grid `grid` (≤ minGap / 2) (design G2).
   */
  loggerGaps?(
    dataRef: string,
    grid: bigint,
    minGap: bigint,
    abort?: AbortSignal,
  ): Promise<LoggerGaps>;
  /**
   * Up to `rows` timestamps of each named signal of the data ref, any order (design G3); signals
   * without rows are absent; no query for [].
   */
  firstTimes?(
    dataRef: string,
    names: readonly string[],
    rows: number,
    abort?: AbortSignal,
  ): Promise<Map<string, Timestamp[]>>;
  /** Rows of one signal (SNA left out) where the state changes, plus its first row; at most `limit` rows (E7). */
  stateChanges?(
    ref: SeriesRef,
    by: StateChangeRule,
    limit: number,
    abort?: AbortSignal,
  ): Promise<StateRow[]>;

  // Capability without fallback: absent, or `undefined` from it, means "no events table".
  /** The data ref's event rows with a time, time order (ties kind, source, name), at most `limit` (design E4). */
  events?(dataRef: string, limit: number, abort?: AbortSignal): Promise<EventRow[] | undefined>;
}

/** What the server uses: every method present (`completeSource`, design C2). */
export type DataSource = Required<SourceAdapter>;
