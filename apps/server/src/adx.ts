import type { EventRow, StateRow, Timestamp } from "@kipscope/shared";
import { DEFAULT_EVENT_MAPPING, type EventMapping, type TableMapping } from "./config.ts";
import type {
  Bucket,
  LoggerGaps,
  RawPoint,
  RefBucket,
  Scope,
  SeriesAnswer,
  SeriesRef,
  SignalRef,
  SourceAdapter,
  SourceInfo,
  SourceSignal,
  StateChangeRule,
} from "./datasource.ts";
import { type KustoClient, KustoError, type KustoParam, real } from "./kusto.ts";

/** A configured name as a KQL identifier, so keywords such as `kind` or `time` work. */
const q = (name: string) => `['${name.replace(/[\\']/g, "\\$&")}']`;

/** Nanoseconds since 1970 as an exact long (`/ 1tick` would give a real, design C6). */
const ns = (x: string) => `tolong(${x} - datetime(1970-01-01)) * 100`;

/** Floor grid k * w, also before 1970 (`%` keeps the dividend's sign). */
const grid = (x: string, w: string) => `${x} - ((${x} % ${w}) + ${w}) % ${w}`;

/** A number the adapter writes into the query itself (SNA ranges, labels, tolerance). */
function realLiteral(n: number): string {
  if (Number.isNaN(n)) return "real(nan)";
  if (n === Number.POSITIVE_INFINITY) return "real(+inf)";
  if (n === Number.NEGATIVE_INFINITY) return "real(-inf)";
  return `real(${n.toString()})`;
}

/** `true` when the value `v_` lies in one of the ref's closed SNA ranges; `false` without ranges. */
function isSna(ref: SeriesRef): string {
  if (ref.sna.length === 0) return "false";
  return ref.sna
    .map((r) => `(v_ >= ${realLiteral(r.lo)} and v_ <= ${realLiteral(r.hi)})`)
    .join(" or ");
}

/**
 * Semantic error SEM0100 (unknown table, column or function) naming `name`; Kusto quotes a
 * bracket-quoted name as `'["name"]'`, a bare one as `'name'`.
 */
const isMissing = (error: unknown, name: string) =>
  error instanceof KustoError &&
  error.message.includes("SEM0100") &&
  (error.message.includes(`'["${name}"]'`) || error.message.includes(`'${name}'`));

const str = (value: string): KustoParam => ({ type: "string", value });
const time = (value: Timestamp): KustoParam => ({ type: "datetime", value });
const long = (value: bigint | number): KustoParam => ({ type: "long", value });

type Params = Record<string, KustoParam>;

/**
 * Azure Data Explorer adapter (design C6) over the Kusto REST client. The configured signals and
 * events names may be tables or stored functions without parameters; all values go in as query
 * parameters; times come back as exact ns strings and bounds go out rounded up to the next tick.
 * Native fast paths only where the measured fallback costs more than twice (design C2).
 */
export class AdxSource implements SourceAdapter {
  readonly info: SourceInfo;
  private readonly client: KustoClient;
  private readonly c: TableMapping;
  private readonly e: EventMapping;
  private readonly table: string;

  constructor(
    client: KustoClient,
    mapping: TableMapping,
    events: EventMapping = DEFAULT_EVENT_MAPPING,
  ) {
    this.client = client;
    this.c = mapping;
    this.e = events;
    this.table = q(mapping.table);
    this.info = {
      kind: "adx",
      database: mapping.database,
      table: mapping.table,
      eventsTable: `${mapping.database}.${events.table}`,
    };
  }

  ping(abort: AbortSignal): Promise<void> {
    return this.client.ping(abort);
  }

  /**
   * `table` (signals or events) reduced to the rows of a scope (design Z3): the data-ref and both
   * time filters come before any other operator, as parameters `sref`, `sfrom` and `sto` (bounds
   * rounded up to the tick like every time parameter); the bare table without a scope.
   */
  private scoped(table: string, scope: Scope | undefined): { src: string; params: Params } {
    if (!scope) return { src: table, params: {} };
    const t = q(this.c.time);
    return {
      src: `${table} | where ${q(this.c.dataRef)} == sref and ${t} >= sfrom and ${t} < sto`,
      params: { sref: str(scope.dataRef), sfrom: time(scope.from), sto: time(scope.to) },
    };
  }

  /** Rows of one signal with a time; binds `ref` and `sig`. */
  private get signalFilter(): string {
    return `${q(this.c.dataRef)} == ref and ${q(this.c.signal)} == sig and isnotnull(${q(this.c.time)})`;
  }

  /** Time, value (null where SNA) and, for a text signal, the text; after `extend v_ = …`. */
  private pointProjection(ref: SeriesRef): string {
    const t = q(this.c.time);
    const text = ref.text ? `, x_ = tostring(${q(this.c.text)})` : "";
    return `project t_ = tostring(${ns(t)}), v_ = iff(${isSna(ref)}, real(null), v_)${text}`;
  }

  private point = (row: unknown[]): RawPoint => {
    const p: RawPoint = { t: BigInt(row[0] as string), v: real(row[1]) };
    if (row.length > 2) p.text = row[2] as string;
    return p;
  };

  async listSignals(scope?: Scope, abort?: AbortSignal): Promise<SourceSignal[]> {
    const { src, params } = this.scoped(this.table, scope);
    const ref = q(this.c.dataRef);
    const sig = q(this.c.signal);
    const order = `order by ${ref} asc, ${sig} asc`;
    let rows: unknown[][];
    try {
      rows = await this.client.query(
        `${src} | summarize n_ = countif(isnotempty(${q(this.c.text)})) by ${ref}, ${sig}
         | project ${ref}, ${sig}, x_ = n_ > 0 | ${order}`,
        params,
        abort,
      );
    } catch (error) {
      // A missing text column means no text signals (design C6).
      if (!isMissing(error, this.c.text)) throw error;
      rows = await this.client.query(`${src} | distinct ${ref}, ${sig} | ${order}`, params, abort);
    }
    return rows.map(([dataRef, name, text]): SourceSignal => {
      const s: SourceSignal = { dataRef: dataRef as string, name: name as string };
      if (text === true) s.text = true;
      return s;
    });
  }

  async raw(
    ref: SeriesRef,
    from: Timestamp,
    to: Timestamp,
    limit?: number,
    abort?: AbortSignal,
  ): Promise<RawPoint[]> {
    const t = q(this.c.time);
    const order = limit === undefined ? `order by ${t} asc` : `top lim by ${t} asc`;
    const rows = await this.client.query(
      `${this.table} | where ${this.signalFilter} and ${t} >= t0 and ${t} < t1
       | extend v_ = todouble(${q(this.c.value)}) | ${order} | ${this.pointProjection(ref)}`,
      {
        ref: str(ref.dataRef),
        sig: str(ref.name),
        t0: time(from),
        t1: time(to),
        ...(limit === undefined ? {} : { lim: long(limit) }),
      },
      abort,
    );
    return rows.map(this.point);
  }

  private async edge(
    ref: SeriesRef,
    at: Timestamp,
    side: "before" | "after",
    scope?: Scope,
    abort?: AbortSignal,
  ) {
    const t = q(this.c.time);
    const [cond, dir] = side === "before" ? ["<", "desc"] : [">=", "asc"];
    const { src, params } = this.scoped(this.table, scope);
    const [row] = await this.client.query(
      `${src} | where ${this.signalFilter} and ${t} ${cond} at_
       | extend v_ = todouble(${q(this.c.value)}) | top 1 by ${t} ${dir} | ${this.pointProjection(ref)}`,
      { ref: str(ref.dataRef), sig: str(ref.name), at_: time(at), ...params },
      abort,
    );
    return row && this.point(row);
  }

  before(ref: SeriesRef, t: Timestamp, scope?: Scope, abort?: AbortSignal) {
    return this.edge(ref, t, "before", scope, abort);
  }

  after(ref: SeriesRef, t: Timestamp, scope?: Scope, abort?: AbortSignal) {
    return this.edge(ref, t, "after", scope, abort);
  }

  // Native: the fallback's two `top 1` scans cost 4–17 s per signal on a cluster (speed-up-adx A1).
  async extent(ref: SignalRef, scope?: Scope, abort?: AbortSignal) {
    const { src, params } = this.scoped(this.table, scope);
    const [row] = await this.client.query(
      `${src} | where ${this.signalFilter} | extend x_ = ${ns(q(this.c.time))}
       | summarize f_ = min(x_), l_ = max(x_) | project tostring(f_), tostring(l_)`,
      { ref: str(ref.dataRef), sig: str(ref.name), ...params },
      abort,
    );
    const [first, last] = (row ?? []) as (string | null | undefined)[];
    return first && last ? { first: BigInt(first), last: BigInt(last) } : undefined;
  }

  // Native: one round trip instead of `count`, then `raw` + edges or `buckets` (speed-up-adx A3).
  // Every leg answers the pinned columns k_, t_, v_, x_, c_, m_, lo_, hi_; the kind comes from the
  // `n` row alone.
  async series(
    ref: SeriesRef,
    from: Timestamp,
    to: Timestamp,
    target: number,
    width: bigint,
    scope?: Scope,
    abort?: AbortSignal,
  ): Promise<SeriesAnswer> {
    const t = q(this.c.time);
    const { src, params } = this.scoped(this.table, scope);
    const value = `extend v_ = todouble(${q(this.c.value)})`;
    const text = ref.text ? `tostring(${q(this.c.text)})` : `""`;
    const point = (k: string, c: string) =>
      `project k_ = "${k}", t_ = tostring(${ns(t)}), v_ = iff(${isSna(ref)}, real(null), v_),
           x_ = ${text}, c_ = ${c}, m_ = long(null), lo_ = real(null), hi_ = real(null)`;
    const rows = await this.client.query(
      `let src_ = ${src};
       let rows_ = src_ | where ${this.signalFilter} and ${t} >= t0 and ${t} < t1;
       let cnt_ = toscalar(rows_ | count);
       union
         (print k_ = "n", t_ = "", v_ = real(null), x_ = "", c_ = cnt_, m_ = long(null),
             lo_ = real(null), hi_ = real(null)),
         (rows_ | where cnt_ <= lim | ${value} | order by ${t} asc | extend r_ = row_number()
             | ${point("p", "r_")}),
         (src_ | where cnt_ <= lim and ${this.signalFilter} and ${t} < t0 | ${value}
             | top 1 by ${t} desc | ${point("b", "long(null)")}),
         (src_ | where cnt_ <= lim and ${this.signalFilter} and ${t} >= t1 | ${value}
             | top 1 by ${t} asc | ${point("a", "long(null)")}),
         (rows_ | where cnt_ > lim | extend x_ = ${ns(t)}, v_ = todouble(${q(this.c.value)})
             | extend z_ = ${isSna(ref)}
             | summarize c_ = countif(not(z_)), m_ = countif(z_), a_ = avgif(v_, not(z_)),
                 lo_ = minif(v_, not(z_)), hi_ = maxif(v_, not(z_)) by b_ = ${grid("x_", "w")}
             | project k_ = "k", t_ = tostring(b_), v_ = iff(c_ == 0, real(null), a_), x_ = "", c_, m_,
                 lo_ = iff(c_ == 0, real(null), lo_), hi_ = iff(c_ == 0, real(null), hi_))
       | project k_, t_, v_, x_, c_, m_, lo_, hi_`,
      {
        ref: str(ref.dataRef),
        sig: str(ref.name),
        t0: time(from),
        t1: time(to),
        lim: long(target),
        w: long(width),
        ...params,
      },
      abort,
    );
    const [count, extra] = rows.filter(([k]) => k === "n");
    if (!count || extra) throw new Error("the series query returned no count");
    if (Number(count[4]) > target) {
      const buckets = rows
        .filter(([k]) => k === "k")
        .map(([, b, mean, , count, sna, min, max]) => ({
          start: BigInt(b as string),
          count: Number(count),
          sna: Number(sna),
          mean: real(mean),
          min: real(min),
          max: real(max),
        }))
        .sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
      return { kind: "buckets", buckets };
    }
    const toPoint = ([, rt, v, x]: unknown[]): RawPoint => {
      const p: RawPoint = { t: BigInt(rt as string), v: real(v) };
      if (ref.text) p.text = x as string;
      return p;
    };
    const points = rows
      .filter(([k]) => k === "p")
      .sort((x, y) => Number(x[4]) - Number(y[4]))
      .map(toPoint);
    const answer: SeriesAnswer = { kind: "raw", points };
    const before = rows.find(([k]) => k === "b");
    const after = rows.find(([k]) => k === "a");
    if (before) answer.before = toPoint(before);
    if (after) answer.after = toPoint(after);
    return answer;
  }

  async buckets(
    ref: SeriesRef,
    from: Timestamp,
    to: Timestamp,
    width: bigint,
    abort?: AbortSignal,
  ): Promise<Bucket[]> {
    const t = q(this.c.time);
    // `avgif` over no row is "NaN" and the min/max of none is not null everywhere, hence the iffs.
    const rows = await this.client.query(
      `${this.table} | where ${this.signalFilter} and ${t} >= t0 and ${t} < t1
       | extend x_ = ${ns(t)}, v_ = todouble(${q(this.c.value)})
       | extend s_ = ${isSna(ref)}
       | summarize c_ = countif(not(s_)), n_ = countif(s_), a_ = avgif(v_, not(s_)),
           lo_ = minif(v_, not(s_)), hi_ = maxif(v_, not(s_)) by b_ = ${grid("x_", "w")}
       | order by b_ asc
       | project tostring(b_), c_, n_, iff(c_ == 0, real(null), a_), iff(c_ == 0, real(null), lo_),
           iff(c_ == 0, real(null), hi_)`,
      { ref: str(ref.dataRef), sig: str(ref.name), t0: time(from), t1: time(to), w: long(width) },
      abort,
    );
    return rows.map(([b, count, sna, mean, min, max]) => ({
      start: BigInt(b as string),
      count: Number(count),
      sna: Number(sna),
      mean: real(mean),
      min: real(min),
      max: real(max),
    }));
  }

  async refBuckets(
    dataRef: string,
    width: bigint,
    times: boolean,
    scope?: Scope,
    abort?: AbortSignal,
  ): Promise<RefBucket[]> {
    const t = q(this.c.time);
    const { src, params } = this.scoped(this.table, scope);
    const rows = await this.client.query(
      `${src} | where ${q(this.c.dataRef)} == ref and isnotnull(${t}) | extend x_ = ${ns(t)}
       | summarize c_ = count()${times ? ", f_ = min(x_), l_ = max(x_)" : ""} by b_ = ${grid("x_", "w")}
       | project tostring(b_), c_${times ? ", tostring(f_), tostring(l_)" : ""}`,
      { ref: str(dataRef), w: long(width), ...params },
      abort,
    );
    return rows.map(([b, count, first, last]) => {
      const bucket: RefBucket = { start: BigInt(b as string), count: Number(count) };
      if (times) {
        bucket.first = BigInt(first as string);
        bucket.last = BigInt(last as string);
      }
      return bucket;
    });
  }

  // Native: the fallback would scan the time column every gap refresh (design C2).
  async refCount(dataRef: string, scope?: Scope, abort?: AbortSignal): Promise<number> {
    const { src, params } = this.scoped(this.table, scope);
    const [row] = await this.client.query(
      `${src} | where ${q(this.c.dataRef)} == ref | count`,
      { ref: str(dataRef), ...params },
      abort,
    );
    return Number(row?.[0] ?? 0);
  }

  // One scan on a fixed floor grid; the bounding rows of every silence of at least `minGap` are the
  // `hi_` and `lo_` of consecutive non-empty buckets (design G2 of add-gap-display, C6).
  async loggerGaps(
    dataRef: string,
    gridWidth: bigint,
    minGap: bigint,
    scope?: Scope,
    abort?: AbortSignal,
  ): Promise<LoggerGaps> {
    const t = q(this.c.time);
    const { src, params } = this.scoped(this.table, scope);
    const rows = await this.client.query(
      `let g_ = ${src} | where ${q(this.c.dataRef)} == ref and isnotnull(${t})
         | extend x_ = ${ns(t)} | summarize lo_ = min(x_), hi_ = max(x_) by b_ = ${grid("x_", "g")};
       union
         (g_ | order by b_ asc | extend p_ = prev(hi_) | where isnotnull(p_) and lo_ - p_ >= m
             | project k_ = "gap", a_ = tostring(p_), z_ = tostring(lo_)),
         (g_ | summarize l_ = max(hi_) | where isnotnull(l_) | project k_ = "last", a_ = tostring(l_), z_ = "")`,
      { ref: str(dataRef), g: long(gridWidth), m: long(minGap), ...params },
      abort,
    );
    const gaps: { from: Timestamp; to: Timestamp }[] = [];
    let last: Timestamp | undefined;
    for (const [kind, a, z] of rows) {
      if (kind === "last") last = BigInt(a as string);
      else gaps.push({ from: BigInt(a as string), to: BigInt(z as string) });
    }
    gaps.sort((x, y) => (x.from < y.from ? -1 : x.from > y.from ? 1 : 0));
    return last === undefined ? { gaps } : { gaps, last };
  }

  // Native: only the first row and the changed ones cross the wire (design C2, E7 of add-events).
  async stateChanges(
    ref: SeriesRef,
    by: StateChangeRule,
    limit: number,
    scope?: Scope,
    abort?: AbortSignal,
  ): Promise<StateRow[]> {
    const t = q(this.c.time);
    const { src, params } = this.scoped(this.table, scope);
    // A labels signal is named by its value, so it does not need the text column (design E7).
    const text = by.kind === "text" ? `tostring(${q(this.c.text)})` : `""`;
    let changed = "x_ != px_";
    if (by.kind === "labels") {
      const tol = realLiteral(by.tolerance);
      const near = (v: string) =>
        by.values.map((l) => `abs(${v} - ${realLiteral(l)}) <= ${tol}`).join(" or ") || "false";
      changed = `abs(v_ - pv_) > ${tol} and (${near("v_")} or ${near("pv_")})`;
    }
    const rows = await this.client.query(
      `${src} | where ${this.signalFilter} | extend v_ = todouble(${q(this.c.value)})
       | where not(${isSna(ref)}) | order by ${t} asc
       | extend t_ = ${t}, x_ = ${text}
       | extend pt_ = prev(t_), pv_ = prev(v_), px_ = prev(x_), rn_ = row_number()
       | where rn_ == 1 or ${changed} | take lim
       | project tostring(${ns("t_")}), v_, x_, iff(rn_ == 1, "", tostring(${ns("pt_")})), pv_, px_`,
      { ref: str(ref.dataRef), sig: str(ref.name), lim: long(limit), ...params },
      abort,
    );
    return rows.map(([rt, v, x, pt, pv, px]): StateRow => {
      const row: StateRow = { t: rt as string, value: real(v) ?? Number.NaN, text: x as string };
      if (pt) row.prev = { t: pt as string, value: real(pv) ?? Number.NaN, text: px as string };
      return row;
    });
  }

  async events(dataRef: string, limit: number, scope?: Scope, abort?: AbortSignal) {
    const t = q(this.c.time);
    const { table, source, kind, name, value, text, detail } = this.e;
    const { src, params } = this.scoped(q(table), scope);
    try {
      const rows = await this.client.query(
        `${src} | where ${q(this.c.dataRef)} == ref and isnotnull(${t})
         | order by ${t} asc, ${q(kind)} asc, ${q(source)} asc, ${q(name)} asc | take lim
         | project tostring(${ns(t)}), tostring(${q(source)}), tostring(${q(kind)}),
             tostring(${q(name)}), todouble(${q(value)}), tostring(${q(text)}), tostring(${q(detail)})`,
        { ref: str(dataRef), lim: long(limit), ...params },
        abort,
      );
      return rows.map(
        ([rt, src, k, n, v, x, d]): EventRow => ({
          t: rt as string,
          source: src as string,
          kind: k as string,
          name: n as string,
          value: real(v) ?? Number.NaN,
          text: x as string,
          detail: d as string,
        }),
      );
    } catch (error) {
      // A missing events table means no events (design C6, E4 of add-events).
      if (isMissing(error, table)) return undefined;
      throw error;
    }
  }
}
