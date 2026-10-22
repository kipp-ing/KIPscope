import { randomUUID } from "node:crypto";
import {
  type ClickHouseClient,
  ClickHouseError,
  ClickHouseLogLevel,
  createClient,
} from "@clickhouse/client";
import type { EventRow, StateRow, Timestamp } from "@kipscope/shared";
import {
  type ClickHouseConfig,
  DEFAULT_EVENT_MAPPING,
  type EventMapping,
  type TableMapping,
} from "./config.ts";
import type {
  Bucket,
  DataSource,
  RawPoint,
  RefBucket,
  Scope,
  SeriesRef,
  SignalRef,
  SourceInfo,
  SourceSignal,
  StateChangeRule,
} from "./datasource.ts";

/**
 * Progress headers (design D7) pile up until the first body byte; Node's 16 KiB header limit
 * failed a 10.7 s query on carserver (105 headers of 161 bytes). The client takes up to 1 MiB, and
 * the interval grows with the timeout so that twice the timeout at twice the measured header size
 * still fits: 100 ms, so cancelling within 100 ms, up to a 160 s timeout.
 */
const MAX_RESPONSE_HEADER_BYTES = 1024 * 1024;
const PROGRESS_HEADER_BYTES = 2 * 161;
const progressHeaders = (MAX_RESPONSE_HEADER_BYTES - 16 * 1024) / PROGRESS_HEADER_BYTES;
const progressIntervalMs = (timeoutSeconds: number) =>
  Math.max(100, Math.ceil((2 * timeoutSeconds * 1000) / progressHeaders));

/** Client logging is off: aborted queries would log as errors; the server reports failures itself. */
export function createClickHouseClient(
  config: Pick<ClickHouseConfig, "url" | "username" | "password">,
): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    log: { level: ClickHouseLogLevel.OFF },
    max_response_headers_size: MAX_RESPONSE_HEADER_BYTES,
  });
}

type Params = Record<string, unknown>;

/** ClickHouse error codes the adapter answers with "none" instead of failing (design E4). */
const UNKNOWN_TABLE = "60";
const MISSING_COLUMN = new Set(["16", "47"]); // NO_SUCH_COLUMN_IN_TABLE, UNKNOWN_IDENTIFIER

const hasCode = (error: unknown, codes: ReadonlySet<string>) =>
  error instanceof ClickHouseError && codes.has(error.code);

/** Float64 NaN and infinities arrive as JSON null. */
const num = (v: number | null) => v ?? Number.NaN;

/**
 * ClickHouse adapter for a long-format table (design D5). Identifiers come from validated config;
 * all values go through query parameters. Every query excludes rows without a timestamp.
 */
export class ClickHouseSource implements Omit<DataSource, "series"> {
  private readonly client: ClickHouseClient;
  private readonly table: string;
  private readonly c: TableMapping;
  private readonly timeoutSeconds: number;
  private readonly e: EventMapping;
  private readonly eventsTable: string;
  readonly info: SourceInfo;

  constructor(
    client: ClickHouseClient,
    mapping: TableMapping,
    timeoutSeconds: number,
    events: EventMapping = DEFAULT_EVENT_MAPPING,
  ) {
    this.client = client;
    this.c = mapping;
    this.timeoutSeconds = timeoutSeconds;
    this.table = `${mapping.database}.${mapping.table}`;
    this.e = events;
    this.eventsTable = `${mapping.database}.${events.table}`;
    this.info = {
      kind: "clickhouse",
      database: mapping.database,
      table: mapping.table,
      eventsTable: this.eventsTable,
    };
  }

  // Outside the query queue (C3), so a busy queue does not read as an unreachable source.
  async ping(abort: AbortSignal): Promise<void> {
    abort.throwIfAborted();
    const result = await this.client.ping({ select: false, abort_signal: abort });
    if (!result.success) throw result.error;
  }

  private async rows<T extends unknown[]>(
    query: string,
    params: Params,
    abort?: AbortSignal,
  ): Promise<T[]> {
    // An already aborted call rejects with its reason; the client would report its own error.
    abort?.throwIfAborted();
    const result = await this.client.query({
      query,
      query_params: params,
      format: "JSONCompactEachRow",
      query_id: `kipscope-${randomUUID()}`,
      ...(abort ? { abort_signal: abort } : {}),
      clickhouse_settings: {
        max_execution_time: this.timeoutSeconds,
        // An aborted request closes the connection. ClickHouse only notices that while writing,
        // so progress headers make it cancel the query promptly (design D7); interval see above.
        cancel_http_readonly_queries_on_client_close: 1,
        send_progress_in_http_headers: 1,
        http_headers_progress_interval_ms: String(progressIntervalMs(this.timeoutSeconds)),
      },
    });
    return result.json<T>();
  }

  /** WHERE clause selecting one signal; `{ref}` and `{sig}` are bound per query. */
  private get signalFilter(): string {
    const { dataRef, signal, time } = this.c;
    return `${dataRef} = {ref:String} AND ${signal} = {sig:String} AND ${time} IS NOT NULL`;
  }

  private ns(param: string): string {
    return `fromUnixTimestamp64Nano({${param}:Int64}, 'UTC')`;
  }

  /**
   * Both time bounds of a scoped call (design Z3), appended to a WHERE that already selects the
   * data ref; empty without a scope, so unscoped query texts stay as they were.
   */
  private inScope(scope: Scope | undefined): { sql: string; params: Params } {
    if (!scope) return { sql: "", params: {} };
    const { time } = this.c;
    return {
      sql: ` AND ${time} >= ${this.ns("from")} AND ${time} < ${this.ns("to")}`,
      params: { from: scope.from, to: scope.to },
    };
  }

  /**
   * SNA predicate on the value column (design S3) with its parameters: true when the value lies in
   * one of the ref's closed SNA ranges; the constant 0 with no parameters when it has none.
   */
  private isSna(ref: SeriesRef): { expr: string; params: Params } {
    if (ref.sna.length === 0) return { expr: "0", params: {} };
    return {
      expr: `arrayExists((lo, hi) -> ${this.c.value} >= lo AND ${this.c.value} <= hi,
                         {snaLo:Array(Float64)}, {snaHi:Array(Float64)})`,
      params: { snaLo: ref.sna.map((r) => r.lo), snaHi: ref.sna.map((r) => r.hi) },
    };
  }

  /** Time and value of a point, the value NULL where it is SNA; then the text for a text signal. */
  private pointColumns(ref: SeriesRef): { columns: string; params: Params } {
    const { time, value, text } = this.c;
    const sna = this.isSna(ref);
    return {
      columns: `toString(toUnixTimestamp64Nano(${time})), if(${sna.expr}, NULL, ${value})${ref.text ? `, ${text}` : ""}`,
      params: sna.params,
    };
  }

  private point = ([t, v, text]: PointRow): RawPoint =>
    text === undefined ? { t: BigInt(t), v } : { t: BigInt(t), v, text };

  // The signal list, then the signals with text (state names, design N2); a missing text column
  // means none has text. A scope's list is one grouped query with the text flag (design Z3).
  async listSignals(scope?: Scope, abort?: AbortSignal): Promise<SourceSignal[]> {
    if (scope) return this.scopeSignals(scope, abort);
    const { dataRef, signal, text } = this.c;
    const rows = await this.rows<[string, string]>(
      `SELECT DISTINCT ${dataRef}, ${signal} FROM ${this.table} ORDER BY ${dataRef}, ${signal}`,
      {},
      abort,
    );
    let textRows: [string, string][];
    try {
      textRows = await this.rows<[string, string]>(
        `SELECT DISTINCT ${dataRef}, ${signal} FROM ${this.table} WHERE ${text} != ''`,
        {},
        abort,
      );
    } catch (error) {
      if (!hasCode(error, MISSING_COLUMN)) throw error;
      textRows = [];
    }
    const key = (ref: string, name: string) => JSON.stringify([ref, name]);
    const withText = new Set(textRows.map(([ref, name]) => key(ref, name)));
    return rows.map(([ref, name]) =>
      withText.has(key(ref, name)) ? { dataRef: ref, name, text: true } : { dataRef: ref, name },
    );
  }

  private async scopeSignals(scope: Scope, abort?: AbortSignal): Promise<SourceSignal[]> {
    const { dataRef, signal, text } = this.c;
    const filter = this.inScope(scope);
    const where = `WHERE ${dataRef} = {ref:String}${filter.sql}`;
    const params = { ref: scope.dataRef, ...filter.params };
    let rows: [string, string?][];
    try {
      rows = await this.rows<[string, string]>(
        `SELECT ${signal}, countIf(${text} != '') FROM ${this.table} ${where}
         GROUP BY ${signal} ORDER BY ${signal}`,
        params,
        abort,
      );
    } catch (error) {
      if (!hasCode(error, MISSING_COLUMN)) throw error;
      rows = await this.rows<[string]>(
        `SELECT ${signal} FROM ${this.table} ${where} GROUP BY ${signal} ORDER BY ${signal}`,
        params,
        abort,
      );
    }
    return rows.map(([name, withText]) =>
      Number(withText ?? 0) > 0
        ? { dataRef: scope.dataRef, name, text: true }
        : { dataRef: scope.dataRef, name },
    );
  }

  async extent(ref: SignalRef, scope?: Scope, abort?: AbortSignal) {
    const { time } = this.c;
    const filter = this.inScope(scope);
    const [row] = await this.rows<[string, string, string]>(
      `SELECT count(), toString(toUnixTimestamp64Nano(min(${time}))),
              toString(toUnixTimestamp64Nano(max(${time})))
       FROM ${this.table} WHERE ${this.signalFilter}${filter.sql}`,
      { ref: ref.dataRef, sig: ref.name, ...filter.params },
      abort,
    );
    if (!row || Number(row[0]) === 0) return undefined;
    return { first: BigInt(row[1]), last: BigInt(row[2]) };
  }

  async count(ref: SignalRef, from: Timestamp, to: Timestamp, abort?: AbortSignal) {
    const { time } = this.c;
    const [row] = await this.rows<[string]>(
      `SELECT count() FROM ${this.table}
       WHERE ${this.signalFilter} AND ${time} >= ${this.ns("from")} AND ${time} < ${this.ns("to")}`,
      { ref: ref.dataRef, sig: ref.name, from, to },
      abort,
    );
    return Number(row?.[0] ?? 0);
  }

  async raw(ref: SeriesRef, from: Timestamp, to: Timestamp, limit?: number, abort?: AbortSignal) {
    const { time } = this.c;
    const { columns, params } = this.pointColumns(ref);
    const rows = await this.rows<PointRow>(
      `SELECT ${columns} FROM ${this.table}
       WHERE ${this.signalFilter} AND ${time} >= ${this.ns("from")} AND ${time} < ${this.ns("to")}
       ORDER BY ${time}${limit === undefined ? "" : " LIMIT {limit:UInt32}"}`,
      {
        ref: ref.dataRef,
        sig: ref.name,
        from,
        to,
        ...params,
        ...(limit === undefined ? {} : { limit }),
      },
      abort,
    );
    return rows.map(this.point);
  }

  async before(ref: SeriesRef, t: Timestamp, scope?: Scope, abort?: AbortSignal) {
    const { time } = this.c;
    const { columns, params } = this.pointColumns(ref);
    const filter = this.inScope(scope);
    const [row] = await this.rows<PointRow>(
      `SELECT ${columns} FROM ${this.table}
       WHERE ${this.signalFilter} AND ${time} < ${this.ns("t")}${filter.sql}
       ORDER BY ${time} DESC LIMIT 1`,
      { ref: ref.dataRef, sig: ref.name, t, ...params, ...filter.params },
      abort,
    );
    return row && this.point(row);
  }

  async after(ref: SeriesRef, t: Timestamp, scope?: Scope, abort?: AbortSignal) {
    const { time } = this.c;
    const { columns, params } = this.pointColumns(ref);
    const filter = this.inScope(scope);
    const [row] = await this.rows<PointRow>(
      `SELECT ${columns} FROM ${this.table}
       WHERE ${this.signalFilter} AND ${time} >= ${this.ns("t")}${filter.sql}
       ORDER BY ${time} ASC LIMIT 1`,
      { ref: ref.dataRef, sig: ref.name, t, ...params, ...filter.params },
      abort,
    );
    return row && this.point(row);
  }

  async buckets(
    ref: SeriesRef,
    from: Timestamp,
    to: Timestamp,
    width: bigint,
    abort?: AbortSignal,
  ): Promise<Bucket[]> {
    const { time, value } = this.c;
    const sna = this.isSna(ref);
    // An all-SNA bucket has no valid point, so the -IfOrNull aggregates return NULL for it.
    // Starts lie on the floor grid k * w, also before 1970 (design H2).
    const rows = await this.rows<
      [string, string, string, number | null, number | null, number | null]
    >(
      `WITH ${sna.expr} AS s, toUnixTimestamp64Nano(${time}) AS x
       SELECT toString(x - positiveModulo(x, {w:Int64})) AS b,
              countIf(NOT s), countIf(s),
              avgIfOrNull(${value}, NOT s), minIfOrNull(${value}, NOT s), maxIfOrNull(${value}, NOT s)
       FROM ${this.table}
       WHERE ${this.signalFilter} AND ${time} >= ${this.ns("from")} AND ${time} < ${this.ns("to")}
       GROUP BY b ORDER BY toInt64(b)`,
      { ref: ref.dataRef, sig: ref.name, from, to, w: width, ...sna.params },
      abort,
    );
    return rows.map(([b, count, snaCount, mean, min, max]) => ({
      start: BigInt(b),
      count: Number(count),
      sna: Number(snaCount),
      mean,
      min,
      max,
    }));
  }

  // The two density queries read only the data-ref column (partition and first sort key, so other
  // refs are pruned) and the time column; no per-row sort (design T7, D-007).
  async refExtent(dataRef: string, scope?: Scope, abort?: AbortSignal) {
    const { dataRef: refColumn, time } = this.c;
    const filter = this.inScope(scope);
    const [row] = await this.rows<[string, string, string]>(
      `SELECT count(), toString(toUnixTimestamp64Nano(min(${time}))),
              toString(toUnixTimestamp64Nano(max(${time})))
       FROM ${this.table} WHERE ${refColumn} = {ref:String} AND ${time} IS NOT NULL${filter.sql}`,
      { ref: dataRef, ...filter.params },
      abort,
    );
    if (!row || Number(row[0]) === 0) return undefined;
    return { count: Number(row[0]), first: BigInt(row[1]), last: BigInt(row[2]) };
  }

  // A plain count() with only the data-ref filter: ClickHouse answers it from part metadata, since
  // the data ref is the partition key (design G9 (b)). In a scope it counts the rows in scope.
  async refCount(dataRef: string, scope?: Scope, abort?: AbortSignal) {
    const filter = this.inScope(scope);
    const [row] = await this.rows<[string]>(
      `SELECT count() FROM ${this.table} WHERE ${this.c.dataRef} = {ref:String}${filter.sql}`,
      { ref: dataRef, ...filter.params },
      abort,
    );
    return Number(row?.[0] ?? 0);
  }

  // Without `times` the density query of today (counts only, design C4).
  async refBuckets(
    dataRef: string,
    width: bigint,
    times: boolean,
    scope?: Scope,
    abort?: AbortSignal,
  ): Promise<RefBucket[]> {
    const { dataRef: refColumn, time } = this.c;
    const filter = this.inScope(scope);
    const rows = await this.rows<[string, string, string?, string?]>(
      `WITH toUnixTimestamp64Nano(${time}) AS x
       SELECT toString(x - positiveModulo(x, {w:Int64})) AS b, count()${times ? ", toString(min(x)), toString(max(x))" : ""}
       FROM ${this.table} WHERE ${refColumn} = {ref:String} AND ${time} IS NOT NULL${filter.sql}
       GROUP BY b`,
      { ref: dataRef, w: width, ...filter.params },
      abort,
    );
    return rows.map(([b, count, first, last]) =>
      first === undefined || last === undefined
        ? { start: BigInt(b), count: Number(count) }
        : { start: BigInt(b), count: Number(count), first: BigInt(first), last: BigInt(last) },
    );
  }

  // One scan of the data-ref and time columns on a fixed floor grid: the bounding rows of every
  // silence of at least two grid widths are the `hi` and `lo` of consecutive non-empty buckets.
  // The first bucket's row only carries `last` and is never a gap (design G2).
  async loggerGaps(
    dataRef: string,
    grid: bigint,
    minGap: bigint,
    scope?: Scope,
    abort?: AbortSignal,
  ) {
    const { dataRef: refColumn, time } = this.c;
    const filter = this.inScope(scope);
    const rows = await this.rows<[string, string, string, string]>(
      `SELECT toString(prev_hi), toString(lo), toString(last), rn FROM (
         SELECT lo, lagInFrame(hi) OVER w AS prev_hi, row_number() OVER w AS rn, max(hi) OVER () AS last
         FROM (
           SELECT x - positiveModulo(x, {g:Int64}) AS b, min(x) AS lo, max(x) AS hi
           FROM (SELECT toUnixTimestamp64Nano(${time}) AS x FROM ${this.table}
                 WHERE ${refColumn} = {ref:String} AND ${time} IS NOT NULL${filter.sql})
           GROUP BY b)
         WINDOW w AS (ORDER BY b ROWS BETWEEN 1 PRECEDING AND CURRENT ROW))
       WHERE rn = 1 OR lo - prev_hi >= {min:Int64}
       ORDER BY lo`,
      { ref: dataRef, g: grid, min: minGap, ...filter.params },
      abort,
    );
    const gaps: { from: Timestamp; to: Timestamp }[] = [];
    let last: Timestamp | undefined;
    for (const [prevHi, lo, lastRow, rn] of rows) {
      last = BigInt(lastRow);
      if (Number(rn) !== 1) gaps.push({ from: BigInt(prevHi), to: BigInt(lo) });
    }
    return last === undefined ? { gaps } : { gaps, last };
  }

  // Reads the listed signals in key order, at most `rows` per signal (design G3).
  async firstTimes(
    dataRef: string,
    names: readonly string[],
    rows: number,
    scope?: Scope,
    abort?: AbortSignal,
  ) {
    const times = new Map<string, Timestamp[]>();
    if (names.length === 0) return times;
    const { dataRef: refColumn, signal, time } = this.c;
    const filter = this.inScope(scope);
    const result = await this.rows<[string, string[]]>(
      `SELECT ${signal}, groupArray(toString(toUnixTimestamp64Nano(${time}))) FROM (
         SELECT ${signal}, ${time} FROM ${this.table}
         WHERE ${refColumn} = {ref:String} AND ${signal} IN {names:Array(String)} AND ${time} IS NOT NULL${filter.sql}
         ORDER BY ${signal}, ${time} LIMIT {rows:UInt32} BY ${signal})
       GROUP BY ${signal}`,
      { ref: dataRef, names: [...names], rows, ...filter.params },
      abort,
    );
    for (const [name, ts] of result) times.set(name, ts.map(BigInt));
    return times;
  }

  async events(dataRef: string, limit: number, scope?: Scope, abort?: AbortSignal) {
    const { dataRef: refColumn, time } = this.c;
    const filter = this.inScope(scope);
    const { source, kind, name, value, text, detail } = this.e;
    try {
      const rows = await this.rows<[string, string, string, string, number | null, string, string]>(
        `SELECT toString(toUnixTimestamp64Nano(${time})), ${source}, ${kind}, ${name}, ${value},
                ${text}, ${detail}
         FROM ${this.eventsTable} WHERE ${refColumn} = {ref:String} AND ${time} IS NOT NULL${filter.sql}
         ORDER BY ${time}, ${kind}, ${source}, ${name} LIMIT {limit:UInt32}`,
        { ref: dataRef, limit, ...filter.params },
        abort,
      );
      return rows.map(
        ([t, src, k, n, v, x, d]): EventRow => ({
          t,
          source: src,
          kind: k,
          name: n,
          value: num(v),
          text: x,
          detail: d,
        }),
      );
    } catch (error) {
      if (hasCode(error, new Set([UNKNOWN_TABLE]))) return undefined;
      throw error;
    }
  }

  async stateChanges(
    ref: SeriesRef,
    by: StateChangeRule,
    limit: number,
    scope?: Scope,
    abort?: AbortSignal,
  ) {
    const { time, value, text } = this.c;
    const sna = this.isSna(ref);
    const filter = this.inScope(scope);
    // A labels signal is named by its value, so it does not need the text column (design E7).
    const textColumn = by.kind === "text" ? text : "''";
    const changed =
      by.kind === "text"
        ? "x_ != ptext"
        : `abs(v_ - pv) > {tol:Float64} AND (arrayExists(l -> abs(v_ - l) <= {tol:Float64}, {labels:Array(Float64)})
             OR arrayExists(l -> abs(pv - l) <= {tol:Float64}, {labels:Array(Float64)}))`;
    const ruleParams: Params = by.kind === "text" ? {} : { tol: by.tolerance, labels: by.values };
    // The table is ordered by (data ref, signal, time), so one signal is read in time order and
    // only the first row and the changed ones cross the wire.
    const rows = await this.rows<
      [string, number | null, string, string | null, number | null, string]
    >(
      `SELECT toString(toUnixTimestamp64Nano(t_)), v_, x_,
              if(rn = 1, '', toString(toUnixTimestamp64Nano(pt))), pv, ptext
       FROM (
         SELECT ${time} AS t_, ${value} AS v_, ${textColumn} AS x_,
                lagInFrame(t_) OVER w AS pt, lagInFrame(v_) OVER w AS pv,
                lagInFrame(x_) OVER w AS ptext, row_number() OVER w AS rn
         FROM ${this.table}
         WHERE ${this.signalFilter} AND NOT ${sna.expr}${filter.sql}
         WINDOW w AS (ORDER BY t_ ROWS BETWEEN 1 PRECEDING AND CURRENT ROW)
       )
       WHERE rn = 1 OR ${changed}
       ORDER BY t_ LIMIT {limit:UInt32}`,
      { ref: ref.dataRef, sig: ref.name, limit, ...sna.params, ...ruleParams, ...filter.params },
      abort,
    );
    return rows.map(([t, v, x, pt, pv, ptext]): StateRow => {
      const row: StateRow = { t, value: num(v), text: x };
      if (pt) row.prev = { t: pt, value: num(pv), text: ptext };
      return row;
    });
  }
}

/** Time (decimal ns), value (null: SNA) and, for a text signal, the text. */
type PointRow = [string, number | null, string?];
