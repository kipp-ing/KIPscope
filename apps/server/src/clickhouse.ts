import { randomUUID } from "node:crypto";
import {
  type ClickHouseClient,
  ClickHouseError,
  ClickHouseLogLevel,
  createClient,
} from "@clickhouse/client";
import type { EventRow, FormulaNode, StateRow, Timestamp } from "@kipscope/shared";
import {
  type ClickHouseConfig,
  DEFAULT_EVENT_MAPPING,
  type EventMapping,
  type TableMapping,
} from "./config.ts";
import type {
  Bucket,
  ComputedAnswer,
  ComputedInputRef,
  ComputedRef,
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
import type { QueryRunner } from "./queue.ts";

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

/** Hold limit of an input without one (design C9): large enough never to bite. */
const NO_HOLD = 2n ** 63n - 1n;

/**
 * At most this many chunk scans per computed bucket answer (speed-up-computed C-1): a query below
 * `interactive` takes at most `limit - kept` = 3 of the 4 queue slots.
 */
const COMPUTED_CHUNKS = 3;

/**
 * SQL of a parsed formula (design C9, F9): `column(name)` gives each signal name's column alias,
 * each constant becomes a query parameter `{k<i>:Float64}` in `params`; no text of the formula
 * reaches the query. n-ary `min`/`max` compile to `least`/`greatest` that carry NaN (design S-4):
 * each argument appears once, under a fresh alias `_kf<n>`, and any NaN argument gives NaN.
 */
export function formulaSql(
  ast: FormulaNode,
  column: (name: string) => string,
  params: Params,
): string {
  let k = 0;
  let kf = 0;
  const extreme = (fn: string, args: FormulaNode[]) => {
    const aliases = args.map(() => `_kf${kf++}`);
    const nan = aliases.map((a) => `isNaN(${a})`).join(" OR ");
    const list = args.map((arg, i) => `(${walk(arg)}) AS ${aliases[i]}`).join(", ");
    return `if(${nan}, nan, ${fn}(${list}))`;
  };
  const walk = (node: FormulaNode): string => {
    switch (node.op) {
      case "num": {
        const name = `k${k++}`;
        params[name] = node.value;
        return `{${name}:Float64}`;
      }
      case "sig":
        return column(node.name);
      case "neg":
        return `(-${walk(node.arg)})`;
      case "abs":
        return `abs(${walk(node.arg)})`;
      case "min":
        return extreme("least", node.args);
      case "max":
        return extreme("greatest", node.args);
      default:
        return `(${walk(node.left)} ${node.op} ${walk(node.right)})`;
    }
  };
  return walk(ast);
}

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
  /** Input rows above which a computed bucket answer is split into chunks (C-1). */
  private readonly computedChunkRows: number;
  /** Runs each query of `computedSeries`; the query queue once `useQueue` was called (C-4). */
  private run: QueryRunner = (task, abort) => task(abort);
  readonly info: SourceInfo;

  constructor(
    client: ClickHouseClient,
    mapping: TableMapping,
    timeoutSeconds: number,
    events: EventMapping = DEFAULT_EVENT_MAPPING,
    options: { computedChunkRows?: number } = {},
  ) {
    this.client = client;
    this.computedChunkRows = options.computedChunkRows ?? 1_000_000;
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

  /** Queues each query of `computedSeries` itself (speed-up-computed C-4). */
  useQueue(run: QueryRunner): void {
    this.run = run;
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
  private isSna(ref: SeriesRef, p = "sna"): { expr: string; params: Params } {
    if (ref.sna.length === 0) return { expr: "0", params: {} };
    return {
      expr: `arrayExists((lo, hi) -> ${this.c.value} >= lo AND ${this.c.value} <= hi,
                         {${p}Lo:Array(Float64)}, {${p}Hi:Array(Float64)})`,
      params: { [`${p}Lo`]: ref.sna.map((r) => r.lo), [`${p}Hi`]: ref.sna.map((r) => r.hi) },
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

  /**
   * A computed series (design C9, F9): one count() of the inputs' rows, then one scan that computes
   * the rows from the parsed formula. Several inputs (design S-1..S-6): a window over all with a
   * ROWS frame; each input's last value `IGNORE NULLS` with SNA folded in as NaN and its last time
   * as a running max, its seed when it has no row yet, its hold limit; one row per time, the last
   * row at that time (`leadInFrame` over a second window of the same order), so its frame holds
   * every row at that time. One input: the formula per row, one row per time. Signal names are
   * parameters `{s<i>:String}` in `formulaInputs` order. The raw answer orders the rows; buckets
   * group them. Every query goes through `this.run`, so each takes its own queue slot.
   *
   * A bucket answer over several inputs with more than `computedChunkRows` rows and a finite hold
   * limit on every input is split into up to COMPUTED_CHUNKS chunks at bucket starts (D-110, C-1,
   * C-2), scanned in parallel with one linked abort (C-4); their buckets, in order, are the answer.
   * Every chunk carries the request's seeds; a later chunk also reads a lookback of the largest
   * hold limit before its start, clamped to `from`, so no scan leaves the request (C-3). All
   * chunks keep only rows at `{cs:Int64}` (the chunk start, `from` for chunk 0 and unchunked) or
   * later, so they share one SQL text.
   */
  async computedSeries(
    ref: ComputedRef,
    from: Timestamp,
    to: Timestamp,
    target: number,
    width: bigint,
    abort?: AbortSignal,
  ): Promise<ComputedAnswer> {
    const { dataRef: refColumn, signal, time, value } = this.c;
    const { inputs } = ref;
    const params: Params = { ref: ref.dataRef, from, to };
    inputs.forEach((input, i) => {
      params[`s${i}`] = input.name;
    });
    const names = inputs.map((_, i) => `{s${i}:String}`).join(", ");
    const range = `${refColumn} = {ref:String} AND ${signal} IN (${names})
       AND ${time} >= ${this.ns("from")} AND ${time} < ${this.ns("to")} AND ${time} IS NOT NULL`;
    const [counted] = await this.run(
      (a) => this.rows<[string]>(`SELECT count() FROM ${this.table} WHERE ${range}`, params, a),
      abort,
    );
    const count = Number(counted?.[0] ?? 0);
    const raw = count <= target;

    let rows: string;
    const only = inputs.length === 1 ? inputs[0] : undefined;
    if (only) {
      const sna = this.isSna(only, "sna0");
      Object.assign(params, sna.params);
      const formula = formulaSql(ref.ast, () => value, params);
      rows = `SELECT x, if(s OR NOT isFinite(v0), NULL, v0) AS v FROM (
         SELECT toUnixTimestamp64Nano(${time}) AS x, ${sna.expr} AS s, ${formula} AS v0
         FROM ${this.table} WHERE ${range})
       ORDER BY x LIMIT 1 BY x`;
    } else {
      const index = new Map(inputs.map((input, i) => [input.name, i]));
      const column = (input: ComputedInputRef, i: number) => {
        const sna = this.isSna(input, `sna${i}`);
        Object.assign(params, sna.params, {
          [`sv${i}`]: input.seed ? input.seed.v : null,
          [`ss${i}`]: input.seed ? Number(input.seed.v === null) : null,
          [`st${i}`]: input.seed ? input.seed.t : null,
          [`h${i}`]: input.holdNs ?? NO_HOLD,
        });
        const mine = `${signal} = {s${i}:String}`;
        return `ifNull(last_value(if(${mine}, if(${sna.expr}, nan, ${value}), NULL)) IGNORE NULLS OVER w,
                  if({ss${i}:Nullable(UInt8)} = 1, nan, {sv${i}:Nullable(Float64)})) AS i${i}_v,
           ifNull(max(if(${mine}, x, NULL)) OVER w, {st${i}:Nullable(Int64)}) AS i${i}_t`;
      };
      const columns = inputs.map(column).join(",\n           ");
      const formula = formulaSql(ref.ast, (name) => `i${index.get(name)}_v`, params);
      const held = inputs
        .map((_, i) => `i${i}_t IS NOT NULL AND x - i${i}_t <= {h${i}:Int64}`)
        .join("\n           AND ");
      params.cs = from;
      rows = `SELECT x, if(NOT isFinite(v0), NULL, v0) AS v FROM (
         SELECT x, ${formula} AS v0 FROM (
           SELECT toUnixTimestamp64Nano(${time}) AS x,
           ${columns},
           leadInFrame(x, 1, x + 1) OVER w2 AS nx
           FROM ${this.table} WHERE ${range}
           WINDOW w AS (ORDER BY ${time} ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW),
                  w2 AS (ORDER BY ${time} ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING))
         WHERE nx != x AND ${held} AND x >= {cs:Int64})`;
    }

    if (raw) {
      const points = await this.run(
        (a) =>
          this.rows<[string, number | null]>(
            `SELECT toString(x), v FROM (${rows}) ORDER BY x`,
            params,
            a,
          ),
        abort,
      );
      return { kind: "raw", points: points.map(([t, v]) => ({ t: BigInt(t), v })) };
    }
    const bucketSql = `SELECT toString(x - positiveModulo(x, {w:Int64})) AS b,
              countIf(v IS NOT NULL), countIf(v IS NULL), avg(v), min(v), max(v)
       FROM (${rows}) GROUP BY b ORDER BY toInt64(b)`;
    type BucketRow = [string, string, string, number | null, number | null, number | null];
    const scan = (chunkParams: Params, signal?: AbortSignal) =>
      this.run((a) => this.rows<BucketRow>(bucketSql, chunkParams, a), signal);

    let buckets: BucketRow[];
    const holds = inputs.map((input) => input.holdNs);
    const finite = holds.every((h) => h !== undefined && h !== NO_HOLD);
    // C-2: chunk starts on the bucket grid; k lowered to the number of buckets.
    const g0 = from - (((from % width) + width) % width);
    const nb = (to - g0 + width - 1n) / width;
    let k = Math.min(COMPUTED_CHUNKS, Math.ceil(count / this.computedChunkRows));
    if (nb < BigInt(k)) k = Number(nb);
    if (inputs.length > 1 && finite && count > this.computedChunkRows && k > 1) {
      const lookback = (holds as bigint[]).reduce((a, b) => (b > a ? b : a));
      const starts = [from];
      for (let j = 1; j < k; j++) starts.push(g0 + ((BigInt(j) * nb) / BigInt(k)) * width);
      // C-4: one abort for all chunks, on the caller's abort or the first failing chunk.
      const local = new AbortController();
      const signal = abort ? AbortSignal.any([abort, local.signal]) : local.signal;
      const parts = await Promise.all(
        starts.map((cs, j) => {
          const chunkParams: Params = { ...params, w: width, cs, to: starts[j + 1] ?? to };
          // C-3: a lookback of the largest hold limit, never before `from`; the request's seeds.
          if (j > 0) chunkParams.from = cs - lookback > from ? cs - lookback : from;
          return scan(chunkParams, signal).catch((error: unknown) => {
            local.abort();
            throw error;
          });
        }),
      );
      buckets = parts.flat();
    } else buckets = await scan({ ...params, w: width }, abort);
    return {
      kind: "buckets",
      buckets: buckets.map(([start, count, sna, mean, min, max]) => ({
        start: BigInt(start),
        count: Number(count),
        sna: Number(sna),
        mean,
        min,
        max,
      })),
    };
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
