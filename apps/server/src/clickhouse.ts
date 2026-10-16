import { randomUUID } from "node:crypto";
import { type ClickHouseClient, ClickHouseLogLevel, createClient } from "@clickhouse/client";
import type { Timestamp } from "@kipscope/shared";
import type { Config, TableMapping } from "./config.ts";
import type { Bucket, DataSource, RawPoint, SeriesRef, SignalRef } from "./datasource.ts";

/** Client logging is off: aborted queries would log as errors; the server reports failures itself. */
export function createClickHouseClient(config: Config["clickhouse"]): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    log: { level: ClickHouseLogLevel.OFF },
  });
}

type Params = Record<string, unknown>;

/**
 * ClickHouse adapter for a long-format table (design D5). Identifiers come from validated config;
 * all values go through query parameters. Every query excludes rows without a timestamp.
 */
export class ClickHouseSource implements DataSource {
  private readonly client: ClickHouseClient;
  private readonly table: string;
  private readonly c: TableMapping;
  private readonly timeoutSeconds: number;

  constructor(client: ClickHouseClient, mapping: TableMapping, timeoutSeconds: number) {
    this.client = client;
    this.c = mapping;
    this.timeoutSeconds = timeoutSeconds;
    this.table = `${mapping.database}.${mapping.table}`;
  }

  private async rows<T extends unknown[]>(
    query: string,
    params: Params,
    abort?: AbortSignal,
  ): Promise<T[]> {
    const result = await this.client.query({
      query,
      query_params: params,
      format: "JSONCompactEachRow",
      query_id: `kipscope-${randomUUID()}`,
      ...(abort ? { abort_signal: abort } : {}),
      clickhouse_settings: {
        max_execution_time: this.timeoutSeconds,
        // An aborted request closes the connection. ClickHouse only notices that while writing,
        // so progress headers every 100 ms make it cancel the query promptly (design D7).
        cancel_http_readonly_queries_on_client_close: 1,
        send_progress_in_http_headers: 1,
        http_headers_progress_interval_ms: "100",
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

  /** Time and value of a point, the value NULL where it is SNA. */
  private pointColumns(ref: SeriesRef): { columns: string; params: Params } {
    const { time, value } = this.c;
    const sna = this.isSna(ref);
    return {
      columns: `toString(toUnixTimestamp64Nano(${time})), if(${sna.expr}, NULL, ${value})`,
      params: sna.params,
    };
  }

  private point = ([t, v]: [string, number | null]): RawPoint => ({ t: BigInt(t), v });

  async listSignals(abort?: AbortSignal): Promise<SignalRef[]> {
    const { dataRef, signal } = this.c;
    const rows = await this.rows<[string, string]>(
      `SELECT DISTINCT ${dataRef}, ${signal} FROM ${this.table} ORDER BY ${dataRef}, ${signal}`,
      {},
      abort,
    );
    return rows.map(([ref, name]) => ({ dataRef: ref, name }));
  }

  async extent(ref: SignalRef, abort?: AbortSignal) {
    const { time } = this.c;
    const [row] = await this.rows<[string, string, string]>(
      `SELECT count(), toString(toUnixTimestamp64Nano(min(${time}))),
              toString(toUnixTimestamp64Nano(max(${time})))
       FROM ${this.table} WHERE ${this.signalFilter}`,
      { ref: ref.dataRef, sig: ref.name },
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

  async raw(ref: SeriesRef, from: Timestamp, to: Timestamp, abort?: AbortSignal) {
    const { time } = this.c;
    const { columns, params } = this.pointColumns(ref);
    const rows = await this.rows<[string, number | null]>(
      `SELECT ${columns} FROM ${this.table}
       WHERE ${this.signalFilter} AND ${time} >= ${this.ns("from")} AND ${time} < ${this.ns("to")}
       ORDER BY ${time}`,
      { ref: ref.dataRef, sig: ref.name, from, to, ...params },
      abort,
    );
    return rows.map(this.point);
  }

  async before(ref: SeriesRef, t: Timestamp, abort?: AbortSignal) {
    const { time } = this.c;
    const { columns, params } = this.pointColumns(ref);
    const [row] = await this.rows<[string, number | null]>(
      `SELECT ${columns} FROM ${this.table}
       WHERE ${this.signalFilter} AND ${time} < ${this.ns("t")}
       ORDER BY ${time} DESC LIMIT 1`,
      { ref: ref.dataRef, sig: ref.name, t, ...params },
      abort,
    );
    return row && this.point(row);
  }

  async after(ref: SeriesRef, t: Timestamp, abort?: AbortSignal) {
    const { time } = this.c;
    const { columns, params } = this.pointColumns(ref);
    const [row] = await this.rows<[string, number | null]>(
      `SELECT ${columns} FROM ${this.table}
       WHERE ${this.signalFilter} AND ${time} >= ${this.ns("t")}
       ORDER BY ${time} ASC LIMIT 1`,
      { ref: ref.dataRef, sig: ref.name, t, ...params },
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
}
