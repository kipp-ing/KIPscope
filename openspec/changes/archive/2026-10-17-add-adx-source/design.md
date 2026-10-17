# Design

## Context

- **Inputs:** Jan's words and answers in proposal.md (Why). D-005 (the server holds the adapters and credentials), D-006 („ADX follows behind the same adapter interface"), D-007 (ClickHouse test DB with synthetic data), D-011 (int64 ns times; D7: ≤ 4 concurrent queries, aborts cancel server-side). Concept §2/§3 (ADX and ClickHouse, original time precision), §5 (resolution-aware queries), §10 (one data adapter translates selection, range and resolution).
- **Code today:** `apps/server/src/datasource.ts` `DataSource` has 15 members, all required; `clickhouse.ts` implements them; `queue.ts` wraps every method in the query queue; `main.ts` builds the client, the source and a ClickHouse-only `ping`; `config.ts` requires `CLICKHOUSE_URL`. Consumers: `series.ts` and `routes/series.ts` (count, raw, before, after, buckets, extent), `density.ts` (refExtent, refBuckets), `gaps.ts` (refCount, loggerGaps, firstTimes), `events.ts` (events, stateChanges, eventsTable), `catalog.ts` (listSignals, then textSignals). `ServerMeta.source.kind` is the literal `"clickhouse"`; the footer already falls back to the kind when it has no label (`apps/web/src/footer/items.ts:98`).
- **smart451 costs on carserver (from earlier designs):** 128–131 M rows, 93,220 non-empty seconds. listSignals 0.35 s, textSignals 0.8 s; density bar query 5.7 s; logger gaps 7.2 s, 14 MB, 24 gaps; firstTimes 0.17 s for 115 names (3.8 M rows read, 2.1 MB answer); refCount 3.4 ms (from part metadata); events 25 ms, 40 KB; state changes 0.05–0.19 s, ~17 rows for a 10 Hz signal over 5 days.
- **Measured for this change (2026-10-17):** ClickHouse test DB (read-only queries, `X-ClickHouse-Summary`) and the Kusto emulator with 21.6 M synthetic rows; tables in C2, emulator facts in C8.
- **The machine:** `uname -m` arm64 (Apple M3 Max), Docker Desktop 27.4.0 (linux/arm64, 14 CPUs, 7.65 GiB). `which az`: not found.

## Goals / Non-Goals

**Goals:** an adapter author writes 7 methods and passes one suite; ClickHouse sends the same queries as today; ADX works against the emulator with the user's Azure CLI login and no secret in KIPscope; every fallback has a measured cost; one guide explains it all.

**Non-goals:** see proposal "Out of scope". In particular no routing of several sources, no UI beyond the footer label, no real-cluster check in this change.

## Decisions

### C1: The contract (pinned, `apps/server/src/datasource.ts`)

Rule for every method: **`abort` is the last parameter**; an aborted call rejects with the signal's reason and leaves no work running. Ranges are half-open `[from, to)`; points ascending by time; times are `bigint` ns; no row without a time is ever returned; the adapter never writes.

```ts
import type { EventRow, StateRow, Timestamp } from "@kipscope/shared";

export interface SignalRef { dataRef: string; name: string }
/** A listed signal; `text`: some of its rows carry non-empty text (state names, add-events N1). */
export interface SourceSignal extends SignalRef { text?: boolean }
/** Closed interval of stored values that mean SNA. */
export interface SnaRange { lo: number; hi: number }
/** A signal plus its SNA ranges; `text`: raw/before/after also return each point's text. */
export interface SeriesRef extends SignalRef { sna: readonly SnaRange[]; text?: boolean }
export interface RawPoint { t: Timestamp; /** null: SNA */ v: number | null; text?: string }
export interface Bucket {
  start: Timestamp;
  count: number; // valid points
  sna: number; // SNA points
  mean: number | null; min: number | null; max: number | null; // over valid points; null iff count === 0
}
/** A bucket of all timestamped rows of a data ref; `first`/`last` (row times) only when asked for. */
export interface RefBucket { start: Timestamp; count: number; first?: Timestamp; last?: Timestamp }
export type StateChangeRule =
  | { kind: "text" }
  | { kind: "labels"; values: number[]; tolerance: number };
export interface LoggerGaps { gaps: { from: Timestamp; to: Timestamp }[]; last?: Timestamp }

export interface SourceInfo {
  /** `clickhouse`, `adx`, or a new adapter's own word; the footer labels the known ones. */
  kind: string;
  database: string;
  table: string;
  /** Events table for log lines, e.g. `sdlog.events`; absent: "the events table". */
  eventsTable?: string;
}

/** What an adapter author implements (docs/data-sources.md). */
export interface SourceAdapter {
  readonly info: SourceInfo;
  /** Resolves when the source answers; never through the query queue. */
  ping(abort: AbortSignal): Promise<void>;
  listSignals(abort?: AbortSignal): Promise<SourceSignal[]>;
  /** Points in [from, to), ascending; with `limit` the earliest `limit` of them. */
  raw(ref: SeriesRef, from: Timestamp, to: Timestamp, limit?: number, abort?: AbortSignal): Promise<RawPoint[]>;
  /** Last point strictly before t. */
  before(ref: SeriesRef, t: Timestamp, abort?: AbortSignal): Promise<RawPoint | undefined>;
  /** First point at or after t. */
  after(ref: SeriesRef, t: Timestamp, abort?: AbortSignal): Promise<RawPoint | undefined>;
  /** Non-empty buckets on the floor grid k * width (also before 1970), ordered by start. */
  buckets(ref: SeriesRef, from: Timestamp, to: Timestamp, width: bigint, abort?: AbortSignal): Promise<Bucket[]>;
  /** Non-empty buckets of all timestamped rows of the data ref on k * width, any order; `times`: with first/last. */
  refBuckets(dataRef: string, width: bigint, times: boolean, abort?: AbortSignal): Promise<RefBucket[]>;

  // Optional fast paths; the server computes a missing one from the methods above (C2).
  count?(ref: SignalRef, from: Timestamp, to: Timestamp, abort?: AbortSignal): Promise<number>;
  extent?(ref: SignalRef, abort?: AbortSignal): Promise<{ first: Timestamp; last: Timestamp } | undefined>;
  refExtent?(dataRef: string, abort?: AbortSignal): Promise<{ count: number; first: Timestamp; last: Timestamp } | undefined>;
  /** A row count that changes whenever rows are added; rows without time may count, consistently. */
  refCount?(dataRef: string, abort?: AbortSignal): Promise<number>;
  loggerGaps?(dataRef: string, grid: bigint, minGap: bigint, abort?: AbortSignal): Promise<LoggerGaps>;
  firstTimes?(dataRef: string, names: readonly string[], rows: number, abort?: AbortSignal): Promise<Map<string, Timestamp[]>>;
  stateChanges?(ref: SeriesRef, by: StateChangeRule, limit: number, abort?: AbortSignal): Promise<StateRow[]>;

  // Capability without fallback: absent, or `undefined` from it, means "no events table".
  events?(dataRef: string, limit: number, abort?: AbortSignal): Promise<EventRow[] | undefined>;
}

/** What the server uses: every method present (`completeSource`, C2). */
export type DataSource = Required<SourceAdapter>;
```

Changes against today, for every caller: `raw` gains `limit` before `abort` (`series.ts` passes `undefined`); `refBuckets` gains `times` (`density.ts` passes `false`); `textSignals` is gone (`listSignals` carries `text`); `eventsTable` moves into `info`; `ping` and `info` are new. Semantics of the remaining members are today's (the comments in `datasource.ts` move along).

**Why this core:** `raw`/`before`/`after`/`buckets` are what a view needs and cannot be derived cheaply from each other (`buckets` from `raw` would move 7.2 M points for a 10 h overview); `refBuckets` with row times is the only data-ref-wide primitive, and density, extent, row count and logger gaps all follow from it; `listSignals` and `ping` cannot be derived. **Alternatives:** (a) keep 15 required methods — rejected, that is today's problem; (b) a 5-method core without `refBuckets`, with the strip and gaps as capabilities — rejected, an ADX user would lose the time strip and logger gaps for one `summarize`; (c) a generic "run this query" method — rejected, it leaks the query language into the server.

### C2: Fallbacks (pinned, new `apps/server/src/fallbacks.ts`)

```ts
export const STATE_SCAN_PAGE = 100_000;
export const STATE_SCAN_MAX = 5_000_000;
/** Thrown by the stateChanges fallback beyond STATE_SCAN_MAX points. */
export class ScanLimitError extends Error { constructor(readonly ref: SignalRef, readonly scanned: number) }
/** Every optional method the adapter lacks, computed from its required ones; native ones kept as they are. */
export function completeSource(adapter: SourceAdapter): DataSource;
/** The adapter reduced to `info` and the 7 required methods (conformance core-only runs). */
export function coreOnly(adapter: SourceAdapter): SourceAdapter;
/** Names of the optional methods the adapter implements (start log, tests). */
export function nativeMethods(adapter: SourceAdapter): string[];
```

| Method | Fallback (`all` = `TIME_MIN`…`TIME_MAX`, `ref0` = the signal with `sna: []`) |
|---|---|
| `count(ref, from, to)` | `buckets(ref0, from, to, MAX_BUCKET_WIDTH)`, sum of `count + sna` (a range touches ≤ 3 buckets) |
| `extent(ref)` | `after(ref0, TIME_MIN)` and `before(ref0, TIME_MAX)` in parallel; none → undefined |
| `refExtent(d)` | `refBuckets(d, MAX_BUCKET_WIDTH, true)`: sum of counts, min `first`, max `last`; none → undefined |
| `refCount(d)` | `refExtent(d)?.count ?? 0` (the completed one, native if present) |
| `loggerGaps(d, grid, min)` | `refBuckets(d, grid, true)` sorted by start; a gap wherever `next.first − prev.last ≥ min`; `last` = max `last` |
| `firstTimes(d, names, rows)` | `[]` → empty map, no query; else per name `raw({d, name, sna: []}, all, rows)`, all through the queue; names without points absent |
| `stateChanges(ref, by, limit)` | `raw(ref, from, all.to, STATE_SCAN_PAGE)` page by page (`from` = last `t` + 1 ns); SNA points skipped; first valid point, then changes by the rule of add-events E7; stops at `limit` rows; beyond `STATE_SCAN_MAX` points throws `ScanLimitError` |
| `events` | `undefined` (no events table) |

`EventsCache.loadSignal` catches `ScanLimitError`: reason `too_many_changes`, `warnOnce("<id>:scan", "events line: <id> has more than 5,000,000 points; the source's adapter should implement stateChanges")`.

**Measured cost of each fallback** (warm medians of 3 runs; ClickHouse test DB 21.7 M rows on 8124; emulator 21.6 M rows, `Fast_100h.SIG_A/B/C` 5 ms × 10 h):

| Method | ClickHouse native → fallback | Emulator native → fallback | smart451 estimate | Fallback ≤ 2×? |
|---|---|---|---|---|
| count, 10 h of SIG_A | 5.2 ms → 64 ms (primary index vs. aggregate) | 20 → 32 ms | overview counts like the 10 h case | CH no (keeps native); ADX yes |
| count, 1 min | 2.1 → 2.9 ms | 15 → 15 ms | — | yes |
| extent, SIG_A | 22 → 4 + 32 ms (parallel ≈ 32) | 20 → ≈ 30 ms (28, 29 in parallel) | — | yes (1.5×) |
| refExtent, testcar | 38 → 75 ms | 23 → 31 ms | one scan either way | yes (≤ 2.0×) |
| refCount, testcar | 1.3 → 38 ms | 12 → 31 ms | 3.4 ms → a full time-column scan (≈ seconds) every 5 min | no: native on both |
| loggerGaps, testcar | 98 ms / 58 B → 99 ms / 2.8 MB | 41 ms → 91 ms / 2.6 MB | 7.2 s → ≈ 7.2 s + ≈ 7 MB (93 k seconds × 75 B) | CH ≈ 1.1×; ADX 2.2× + transfer → native on ADX |
| firstTimes | 52 ms (1,015 names, 1 query) → 1,015 × 2–4 ms / 4 | partition query 0.51 s for 2 names, `LowMemoryCondition` with 3 × 7.2 M rows → per name `top 1001` 38 ms | 0.17 s → 116 × ~20 ms / 4 ≈ 0.6 s | CH no; ADX: the fallback beats native |
| stateChanges, Ign MODE (63 k rows) | 8 ms / 225 B → 6 ms / 1.7 MB | 44 ms / 3 rows → reads all 63 k rows | 0.05–0.19 s / 17 rows → ≈ 5 MB | no: native on both |
| refBuckets 9 s with row times (density) | 72 → 90 ms | 30 ms (counts only) | 5.7 s → ≈ +25 % | CH density keeps `times: false` |

**Consequence:** ClickHouse keeps all 15 natively. ADX implements `refCount`, `loggerGaps`, `stateChanges` and `events` (fallback > 2× or a transfer of MBs), and uses the fallbacks for `count`, `extent`, `refExtent` and `firstTimes` (≤ 1.6×, or better than the native query). That is 11 methods for ADX instead of 15, and the four it skips are proven by the core-only run.

### C3: Composition and the queue (pinned, `queue.ts`, new `sources.ts`, `main.ts`)

```ts
// queue.ts: replaces queuedSource
/** Wraps every method the adapter has in the queue; `ping` and `info` pass through unqueued. */
export function queuedAdapter(adapter: SourceAdapter, queue: QueryQueue): SourceAdapter;
// sources.ts
export function createAdapter(config: Config): SourceAdapter; // ClickHouseSource or AdxSource by config.source.kind
// main.ts
const adapter = createAdapter(config);
const source = completeSource(queuedAdapter(adapter, new QueryQueue(config.queryConcurrency)));
app.log.info(`source ${info.kind} ${info.database}: native ${nativeMethods(adapter).join(", ")}`);
```

Order matters: the fallbacks sit **outside** the queue, so each inner query of a fallback takes its own queue slot (a `firstTimes` fan-out of 116 names never runs 116 queries at once) and carries the caller's abort. `meta` gets `source.info` (kind, database, table) and `ping: (signal) => source.ping(signal)`.

### C4: ClickHouse to the contract (`clickhouse.ts`)

- `info`: `{kind: "clickhouse", database, table, eventsTable: "<db>.<events>"}`. `ping` moves here from `main.ts` (`client.ping({select: false, abort_signal})`, throws its error).
- `listSignals`: today's `SELECT DISTINCT` and then today's text query (missing column → no text), merged into `text: true` flags; same two queries in the same order as the catalog sends them today.
- `raw(ref, from, to, limit, abort)`: with `limit`, `LIMIT {limit:UInt32}` after the `ORDER BY`; without it today's query, byte for byte.
- `refBuckets(dataRef, width, times, abort)`: `times` false is today's query; true adds `toString(min(x)), toString(max(x))`.
- Every other method unchanged; `textSignals` removed.

### C5: Configuration (pinned, `config.ts`, `.env.example`)

```ts
export type SourceConfig =
  | { kind: "clickhouse"; url: string; username: string; password: string }
  | { kind: "adx"; cluster: string; auth: "azcli" | "none" };
export interface Config { /* as today, minus `clickhouse` */ source: SourceConfig; mapping: TableMapping; events: EventMapping; … }
```

| Variable | Source | Default | Rule |
|---|---|---|---|
| `KIPSCOPE_SOURCE` | both | `clickhouse` | `clickhouse` or `adx`, else error naming both |
| `CLICKHOUSE_URL`, `_USER`, `_PASSWORD`, `CLICKHOUSE_DATABASE` | clickhouse | as today | URL required only for this source |
| `KIPSCOPE_ADX_CLUSTER` | adx | — | required; origin only (no path, query, user info), trailing `/` dropped; `https:`, or `http:` for `localhost`, `127.0.0.1`, `[::1]` |
| `KIPSCOPE_ADX_DATABASE` | adx | — | required; becomes `mapping.database`; KQL entity name `^[A-Za-z0-9_.\- ]{1,260}$` |
| `KIPSCOPE_ADX_AUTH` | adx | `azcli` | `azcli` or `none`; `none` only for a loopback cluster |
| `KIPSCOPE_TABLE`, `KIPSCOPE_COLUMN_*`, `KIPSCOPE_EVENTS_TABLE`, `KIPSCOPE_EVENT_COLUMN_*` | both | per source | identifier check as today |

ADX defaults (neutral, no smart451 names): table `signals` with columns `dataref`, `signal`, `timestamp`, `value`, `text`; events table `events` with `dataref` and `timestamp` (the signals mapping's, as for ClickHouse) and `source`, `kind`, `name`, `value`, `text`, `detail`. ClickHouse defaults stay `sdlog`, `vehicle`, `signal`, `utc`, `value`, `text`. Settings stay in the environment (`.env`), next to the credentials, not in `kipscope.yaml` (spec owner's default).

The recommended ADX layout, for the guide:

```kql
.create table signals (dataref: string, signal: string, timestamp: datetime, value: real, text: string)
.create table events (dataref: string, timestamp: datetime, source: string, kind: string, name: string, value: real, text: string, detail: string)
```

Any other layout maps through a stored function without parameters that returns these columns (`KIPSCOPE_TABLE=KIPscopeSignals`), e.g. for a wide table or other names:

```kql
.create-or-alter function KIPscopeSignals() {
    Telemetry | project dataref = DeviceId, signal = SignalName, timestamp = EventTime, value = todouble(Value), text = ""
}
```

ADX inlines the function, so the adapter's filters still reach the table (emulator: a count through a renaming function 26 ms, the table itself 23 ms).

### C6: ADX adapter (pinned, new `kusto.ts`, `azcli.ts`, `adx.ts`)

**A-1 default (a): token from the Azure CLI, no dependency.**

```ts
// azcli.ts
export type CommandRunner = (file: string, args: readonly string[], timeoutMs: number) => Promise<string>; // stdout; rejects with {code?, stderr?}
/** Token getter for `resource` (the cluster origin): cached until 5 min before expiry, one run shared. */
export function azCliToken(resource: string, run?: CommandRunner, now?: () => number): () => Promise<string>;
export const TOKEN_MARGIN_MS = 300_000;
export const AZ_TIMEOUT_MS = 30_000;
```

Runs `az account get-access-token --resource <cluster origin> --output json` (`execFile`, `shell` on win32 because the CLI is `az.cmd` there, `windowsHide`). Expiry from `expires_on` (epoch seconds, CLI ≥ 2.54), else `expiresOn` (local time), else 10 min. `ENOENT` → `Azure CLI (az) not found; install it and run az login`; other failures → `Azure CLI: <last stderr line without "ERROR: ">`. A failed run is not cached. The token lives only in memory.

```ts
// kusto.ts
export type KustoParam =
  | { type: "string"; value: string }
  | { type: "datetime"; value: Timestamp }   // sent as adxDatetime(value)
  | { type: "long"; value: bigint | number }
  | { type: "dynamic"; value: readonly (string | number)[] }; // sent as dynamic(<JSON>)
export class KustoError extends Error { readonly status?: number } // message from Kusto, never the token
export interface KustoOptions {
  cluster: string; database: string; timeoutSeconds: number;
  token?: () => Promise<string>; // absent: no Authorization header (emulator)
  fetch?: typeof fetch;          // tests
}
export class KustoClient {
  constructor(options: KustoOptions);
  /** Rows of the first PrimaryResult table. */
  query(csl: string, params: Record<string, KustoParam>, abort?: AbortSignal): Promise<unknown[][]>;
  ping(abort: AbortSignal): Promise<void>; // query `print ok = 1`
}
/** Bound rounded up to the next 100 ns: `YYYY-MM-DDTHH:MM:SS.fffffffZ`. */
export function adxDatetime(t: Timestamp): string;
/** A real cell: number, null, or the strings "NaN", "Infinity", "-Infinity". */
export function real(cell: unknown): number | null;
```

Request: `POST <cluster>/v2/rest/query`, headers `Content-Type: application/json; charset=utf-8`, `Accept: application/json` (without it the emulator answers errors as plain text without details), `x-ms-app: KIPscope`, `x-ms-client-request-id: KIPscope.query;<uuid>`, `Authorization: Bearer <token>` when a token getter is set; body `{db, csl: "declare query_parameters(<name>:<type>, …);\n" + csl, properties: {Options: {servertimeout: "hh:mm:ss"}, Parameters: {<name>: <text>}}}`. Answer: a JSON array of frames. Fail when the HTTP status is ≥ 400 (message `error["@message"]`, else `error.message`, else the first text line; 401/403 add `: run az login, or check your access to database <db>`), when a `DataSetCompletion` frame has `HasErrors`, or when a row of the primary table is not an array (in-data error rows, seen with `LowMemoryCondition`). Abort: `fetch(…, {signal})`; closing the request cancels the query (C8).

**KQL** (`T`, `E` = the configured tables, every configured name as `['name']`; `ns(x)` = `tolong(x - datetime(1970-01-01)) * 100`; `grid(x, w)` = `x - ((x % w) + w) % w`; `<sna>` = `(v_ >= real(lo) and v_ <= real(hi)) or …` written from the ref's ranges with `Number#toString`, `false` without ranges; `F` = `<dataRef> == ref and <signal> == sig and isnotnull(<time>)`):

| Method | Query (parameters) |
|---|---|
| `listSignals` | `T \| summarize n_ = countif(isnotempty(<text>)) by <dataRef>, <signal> \| project <dataRef>, <signal>, n_ > 0 \| order by <dataRef> asc, <signal> asc`; SEM0100 naming the text column → `T \| distinct <dataRef>, <signal> \| order by …`, no text |
| `raw` | `T \| where F and <time> >= from and <time> < to \| extend v_ = todouble(<value>)` then `top lim by <time> asc` (with limit) or `order by <time> asc`, `project tostring(ns(<time>)), iff(<sna>, real(null), v_)[, <text>]` (ref, sig: string; from, to: datetime; lim: long) |
| `before` / `after` | `where F and <time> < t` / `>= t`, `top 1 by <time> desc` / `asc`, same projection |
| `buckets` | `where F and range \| extend x_ = ns(<time>), v_ = todouble(<value>), s_ = <sna> \| summarize c_ = countif(not(s_)), n_ = countif(s_), a_ = avgif(v_, not(s_)), lo_ = minif(v_, not(s_)), hi_ = maxif(v_, not(s_)) by b_ = grid(x_, w) \| order by b_ asc \| project tostring(b_), c_, n_, iff(c_ == 0, real(null), a_), lo_, hi_` (w: long) — `avgif` of no row is `"NaN"`, hence the `iff` |
| `refBuckets` | `where <dataRef> == ref and isnotnull(<time>) \| extend x_ = ns(<time>) \| summarize c_ = count()[, f_ = min(x_), l_ = max(x_)] by b_ = grid(x_, w) \| project tostring(b_), c_[, tostring(f_), tostring(l_)]` |
| `refCount` (native) | `T \| where <dataRef> == ref \| count` |
| `loggerGaps` (native) | `let g_ = T \| where … \| extend x_ = ns(<time>) \| summarize lo_ = min(x_), hi_ = max(x_) by b_ = grid(x_, g); union (g_ \| order by b_ asc \| extend p_ = prev(hi_) \| where isnotnull(p_) and lo_ - p_ >= m \| project k_ = "gap", a_ = tostring(p_), z_ = tostring(lo_)), (g_ \| summarize l_ = max(hi_) \| where isnotnull(l_) \| project k_ = "last", a_ = tostring(l_), z_ = "")` (g, m: long) |
| `stateChanges` (native) | `where F and not(<sna>) \| order by <time> asc \| extend t_ = <time>, v_ = todouble(<value>), x_ = <text or "">, pt_ = prev(<time>), pv_ = prev(v_), px_ = prev(x_), rn_ = row_number() \| where rn_ == 1 or <changed> \| take lim \| project tostring(ns(t_)), v_, x_, iff(rn_ == 1, "", tostring(ns(pt_))), pv_, px_`; `<changed>`: text `x_ != px_`; labels `abs(v_ - pv_) > real(tol) and (abs(v_ - real(l1)) <= real(tol) or … or abs(pv_ - real(l1)) <= real(tol) or …)` |
| `events` (native) | `E \| where <dataRef> == ref and isnotnull(<time>) \| top lim by <time> asc, <kind> asc, <source> asc, <name> asc \| project tostring(ns(<time>)), <source>, <kind>, <name>, todouble(<value>), <text>, <detail>`; SEM0100 naming the events table → `undefined` |
| `ping` | `print ok = 1` |

Times returned as `tostring(ns(…))` → `BigInt`; bounds sent as `datetime` parameters through `adxDatetime` (rounded up: stored times are tick multiples, so `t >= ceil(x)` ⟺ `t >= x` and `t < ceil(x)` ⟺ `t < x`). The emulator facts behind this: `unixtime_nanoseconds_todatetime(1790812800123456789)` gives `….1234568Z` (rounds); `(ts - datetime(1970-01-01)) / 1tick * 100` is a `real` (`1790812796472667200.0`); `tolong(ts - datetime(1970-01-01)) * 100` is exact, also before 1970 (`-1500000000`); longs above 2^53 lose digits as JSON numbers. Times outside int64 ns (before 1677, after 2262) are not supported.

`AdxSource` (`adx.ts`) has `info` `{kind: "adx", database, table, eventsTable: "<database>.<events>"}` and exactly the methods `ping`, `listSignals`, `raw`, `before`, `after`, `buckets`, `refBuckets`, `refCount`, `loggerGaps`, `stateChanges`, `events` (C2).

### C7: Conformance suite and fixture (pinned for the tester, `apps/server/test/conformance/`)

```ts
// suite.ts
export interface ConformanceTarget {
  name: string;                         // "clickhouse", "adx"
  adapter: () => SourceAdapter;         // over the seeded conformance tables
  eventsMissing?: () => SourceAdapter;  // same, events table configured as `nope`
}
/** Registers every case twice: `<name> native` and `<name> core only` (completeSource(coreOnly(adapter))). */
export function describeConformance(target: ConformanceTarget): void;
// fixture.ts: the rows below as data, used by both seeds and by the suite's expectations
```

B = 2026-10-05T00:00:00Z = `1791158400000000000`. Every time is a multiple of 100 ns.

| Data ref / signal | Rows |
|---|---|
| `conf-a/Lin.RAMP` | n = 0 … 9,999 at B + n·10 ms, value n; plus one row with null time, value −1 |
| `conf-a/Sna.CODE` | n = 0 … 99 at B + n s, value 7 for 40 ≤ n ≤ 49 (SNA range [6.5, 7.5] in the suite), else n mod 5 |
| `conf-a/State.MODE` | n = 0 … 599 at B + n·100 ms: 0 (n < 100), 3 (< 300), 15 (< 305, SNA [14.5, 15.5]), 3 (< 400), 0 |
| `conf-a/Diag.door` | value 0, text closed, closed, open, open, closed at B + 0, 90, 180, 270, 360 s |
| `conf-a/Fine.NS` | k = 0 … 999 at B + 123,456,700 + k·1,100 ns, value k |
| `conf-a/Beat.HB` | k = 0 … 5,999 at B + k·100 ms, value k mod 2, none in (200 s, 260 s), (400 s, 401.9 s), (500 s, 502 s): 5,364 rows |
| `conf-b/Lin.RAMP` | n = 0 … 9 at B + n s, value 100 + n |
| `conf-b/Span.FAR` | 1969-12-31T23:59:58.5Z (−1,500,000,000) value 1; 1970-01-01T00:00:00.5Z (500,000,000) value 2 |

`conf-a`: 17,069 timestamped rows (+ 1 without time), B … B + 599.9 s; logger gaps B + 200 s → B + 260 s and B + 500 s → B + 502 s. `conf-b`: 12 rows. Events (`conf-a` only): B state VCU `Diag.door` 0 closed `initial`; B + 180 s state VCU `Diag.door` 0 open `from closed`; B + 300 s dtc BMS `P0CA700` 41 `Discharge current too high`, dtc BMS `P0AA100` 64 `Positive contactor jammed closed`, nrc BMS `SID 22` 49 `requestOutOfRange`; one dtc BMS `P0NULL0` without time.

Cases (names used by the specs): "holds the fixture", "lists signals with their text flag", "never returns rows without a time", "keeps times exact", "reads raw points in a half-open range", "limits raw to the earliest points", "finds the neighbours before and after", "aggregates buckets on the floor grid", "floors bucket starts before 1970", "reports SNA as null and in bucket counts", "counts the rows of a data ref per bucket", "answers empty for an unknown signal", "counts points", "finds the extent", "finds the extent and row count of a data ref", "finds logger gaps", "samples the first times", "finds state changes", "lists events in order", "answers no events without an events table" (`eventsMissing`), "rejects an aborted call" (`raw`, `buckets` and `firstTimes` with an aborted signal reject with its reason). Expected values are written from the fixture definition, never read back from a source.

Seeds: `seed-test-db.ts` adds `sdlog.conf_signals` (schema of `signals_ns`, `DateTime64(9)`) and `sdlog.conf_events` (schema of `events`, `DateTime64(9)`) from `fixture.ts`, so existing catalog counts (1,025 signals) stay; `globalSetup.ts` also checks 17,082 rows in `conf_signals` (17,069 + 1 + 12). New `seed-adx.ts`: `.create database kipscope_test persist (@"/kustodata/dbs/kipscope_test/md", @"/kustodata/dbs/kipscope_test/data")` if missing, `.drop table … ifexists`, `.create table` in the default layout (C5), rows by `.ingest inline` or `.set-or-append … <| datatable(…)`; plus the function `KSignals()` over a renamed copy for "reads through a stored function". Runners: `clickhouse.conformance.test.ts` (in `pnpm test`) and `adx.conformance.test.ts` (only in `vitest.adx.config.ts`, `pnpm --filter @kipscope/server test:adx`, own global setup with the "not reachable or not seeded" message of adx-source).

### C8: Emulator (finding, `docker-compose.yml`)

**It runs here.** Evidence, 2026-10-17:

- `docker pull --platform linux/amd64 mcr.microsoft.com/azuredataexplorer/kustainer-linux:latest`: 40.5 s, 1.18 GB, digest `sha256:449165318234dd6aa9811341712e083953d99bd130eb72ed55dc5181d335b8b5`, build `2026.10.16.1102`. The host is arm64; Docker Desktop runs the amd64 image through its emulation.
- `docker run -d --name kipscope-kustainer-probe --platform linux/amd64 -e ACCEPT_EULA=Y -m 4g -p 127.0.0.1:8091:8080 …`: log `Database NetDefaultDB has been created and is answering queries`; a fresh container answered `print ok=1` 3.9 s after `docker run`. Memory 0.44 GiB idle, 1.33 GiB after 21.6 M rows.
- `.create database kipscope volatile`, `.set-or-append` of 7.2 M generated rows: 6.2–6.5 s each; `.create database kipscope_test persist (…)` accepted.
- Queries (warm): count 10 h 20 ms, 2,000 buckets over 7.2 M rows 41 ms, 20 k raw points 31 ms, logger gaps over 21.6 M rows 41 ms (C2).
- Abort: a 5.9 s query whose client disconnected after 1 s and 2 s is listed by `.show queries` as `Cancelled`, `Client disconnected, or client connection has been cut (E_QUERY_CANCELLED)`, durations 1.0 s and 2.0 s.
- Limits: 600,000 rows came back as 500,001 rows with HTTP 200 and `HasErrors` (`LimitsExceeded`, `KustoServicePartialQueryFailureLimitsExceededException`); a `partition` over 3 × 7.2 M rows answered HTTP 200 with an in-data `LowMemoryCondition` error.
- KQL names: bare `kind`, `time` fail in some positions (`extend kind = …`, a column named `time`); bracket-quoted names always work; `dataref`, `timestamp` work bare.
- The probe container was removed (`docker rm -f kipscope-kustainer-probe`); no other container or port was touched. The image stays in the local cache.

Compose addition (tester):

```yaml
  adx-test:
    # Kusto emulator (Kustainer) for the ADX conformance run; amd64 only, emulated on arm64.
    image: mcr.microsoft.com/azuredataexplorer/kustainer-linux@sha256:449165318234dd6aa9811341712e083953d99bd130eb72ed55dc5181d335b8b5
    platform: linux/amd64
    profiles: ["adx"]
    ports:
      - "127.0.0.1:8125:8080"
    environment:
      ACCEPT_EULA: "Y"
    mem_limit: 4g
    volumes:
      - adx-test-data:/kustodata
```

Test env: `TEST_ADX_URL` (default `http://127.0.0.1:8125`), database `kipscope_test`, auth `none`. `apps/server/package.json`: `"seed:adx": "node --env-file-if-exists=../../.env scripts/seed-adx.ts"`, `"test:adx": "TZ=Europe/Berlin vitest run --config vitest.adx.config.ts"`. The default `vitest.config.ts` excludes `**/*.adx.test.ts` and `test/adx.test.ts`.

### C9: Documents (outline pinned; engineer writes them)

`docs/data-sources.md`:

1. **What a source is** — one paragraph; ClickHouse and ADX ship; one suite for all.
2. **Data model** — data ref, signal name, ID `<dataRef>/<name>` (no `/` in a data ref), times (int64 ns UTC, `bigint`, the source's resolution; ADX 100 ns), values (float64), SNA (the server passes ranges, the adapter reports `null`), text and the `text` flag, events (fields, kinds `dtc`/`state`/`nrc`/`isotp`, what KIPscope derives from them, link to the events spec), rows without time never returned.
3. **The interface** — `SourceAdapter` as in C1; a table: method, required / optional / capability, semantics, fallback and its measured cost (C2), who implements it natively (ClickHouse, ADX).
4. **Rules** — half-open ranges, ascending order, limits, `abort` last and its meaning, errors (never a partial answer), read-only, identifiers only from configuration, values only as query parameters, the queue (`KIPSCOPE_QUERY_CONCURRENCY`), the time bounds `TIME_MIN`/`TIME_MAX`.
5. **Write an adapter** — the steps: implement the 7 methods, add a kind to `createAdapter` and its settings to `config.ts`, seed the fixture (`fixture.ts`), add a runner calling `describeConformance`, then add fast paths only where the measured fallback costs more than twice the native query.
6. **Connect your ADX** — steps: install the Azure CLI; `az login` (`--tenant` when needed); the account needs the *Database Viewer* role on the database; create the tables (C5) or a stored function; set `KIPSCOPE_SOURCE=adx`, `KIPSCOPE_ADX_CLUSTER`, `KIPSCOPE_ADX_DATABASE` (and mapping variables if needed) in `.env`; start the server; check `curl -s localhost:7310/api/meta` and the footer (`ADX <database>`); troubleshooting by message (`az not found`, `run az login`, 401/403, SEM0100 = wrong table or column name, `LimitsExceeded`, timeouts).
7. **Try it on the emulator** — `docker compose --profile adx up -d`, `seed:adx`, the variables with `KIPSCOPE_ADX_AUTH=none`, a second server on `KIPSCOPE_PORT=7311`.
8. **All variables** — one table of every source variable with default (the docs test checks it).

`docs/http-api.md`: shared rules (local access only and the 403 cases, JSON bodies and size limits per server-access, times as decimal ns strings, error shape `{error: {code, message}}`, `503 catalog_unavailable`), then one table: `` `METHOD /path` `` · purpose · query or body fields · spec. Routes today: `GET /api/meta`, `GET /api/license`, `GET /api/signals`, `GET /api/catalog`, `POST /api/catalog/refresh`, `GET /api/extent`, `GET /api/series`, `GET /api/value`, `GET /api/density`, `GET /api/gaps`, `GET /api/events`, `POST /api/commands`, `GET /api/workspace`, `GET /api/render-status`, `GET /api/live` (WebSocket), `GET /api/views`, `GET /api/views/:name`, `POST /api/views`, `POST /api/views/open`, `DELETE /api/views/:name`, `POST /api/views/import`. The README gets one line each in "Data sources" and next to the CLI section linking both documents; its CLI reference stays where it is.

### C10: Meta and footer (pinned)

`packages/shared/src/meta.ts`: `ServerMeta.source.kind: string`. `apps/server/src/meta.ts`: `MetaDeps.source: Pick<SourceInfo, "kind" | "database" | "table">`. `apps/web/src/footer/items.ts`: `KIND_LABEL: Record<string, string> = { clickhouse: "ClickHouse", adx: "ADX" }`; the existing `?? source.kind` gives other kinds as given. Nothing else in the web changes.

## Questions for Jan

- **A-1 How KIPscope gets the Azure token.** All three use the user's `az login`; none stores a secret. (a) Run `az account get-access-token` itself and cache the token in memory: no npm dependency, ~60 lines, needs `az` on the server's PATH (as `az login` does anyway). (b) `@azure/identity` `AzureCliCredential` (4.14.0): runs the same `az` command, adds 12 direct dependencies (MSAL for Node and browser, core-rest-pipeline, …; 3.2 MB unpacked for the package alone); later a one-line switch to `DefaultAzureCredential` (managed identity, service principal) for a server in Azure. (c) The Kusto SDK `azure-kusto-data` (7.2.0): its own client, `@azure/identity`, `axios` and more; it would replace our ~150-line REST client, but parses longs as JS numbers, which loses ns times. **Recommended (a):** lean as asked, nothing to install, and the token getter is one function, so (b) can replace it later without touching the adapter. The spec is written for (a).
- **A-2 One source per server, or per data ref.** (a) `KIPSCOPE_SOURCE` picks one source for the whole server; to see ClickHouse and ADX side by side, run two servers. (b) A routing table (`data ref pattern → source`) and a footer that lists several sources. **Recommended (a):** it keeps the contract and the footer as they are, IDs already carry the data ref, so (b) can come later without a format change; (b) needs UI work, which waits for feedback. The spec is written for (a).
- **A-3 The emulator in the everyday test run.** (a) The emulator is a compose profile (`docker compose --profile adx up -d`) with its own `test:adx`; `pnpm test` stays as today plus the ClickHouse conformance run; rounds that touch a source run both. (b) The emulator always starts with `docker compose up -d` and `pnpm test` needs it. **Recommended (a):** the image is 1.18 GB, amd64-only (emulated here) and uses 0.4–1.3 GB of memory, and most changes never touch a source. The spec is written for (a).

## Jan's answers (2026-10-17)

Jan chose the recommended option on all three: A-1 (a) `az account get-access-token` with an in-memory cache; A-2 (a) one source per server via `KIPSCOPE_SOURCE`; A-3 (a) the emulator as compose profile `adx` with its own `test:adx`. The lead numbers them as D-nnn on archive.

## Spec owner's defaults (Jan can veto)

- The 7-method core of C1; `textSignals` folded into `listSignals`; `events` as the only capability.
- ADX natively: `refCount`, `loggerGaps`, `stateChanges`, `events`; fallbacks for `count`, `extent`, `refExtent`, `firstTimes` (measured, C2).
- Neutral ADX layout `signals`/`events` with `dataref`, `timestamp`; any other layout through a stored function. ADX `datetime` only (100 ns); `long` ns columns out of scope.
- Source settings only in the environment; `KIPSCOPE_ADX_AUTH=none` and `http://` only for a loopback cluster.
- The state-change fallback stops after 5,000,000 points and reports `too_many_changes` (no new reason, so no UI change).
- The conformance fixture lives in its own tables (`conf_signals`, `conf_events`; ADX database `kipscope_test`), so existing test counts stay.
- The emulator image pinned by digest (MCR's `latest` moves; the digest is today's build).
- `docs/http-api.md` as the HTTP reference; the CLI reference stays in the README.

## Numbers: what if off by a factor of two

- **7 required methods:** 4 would drop `refBuckets` (no strip, no logger gaps without a capability) or `before`/`after` (edges by searching `raw`, unbounded); 14 is today's burden.
- **STATE_SCAN_PAGE 100,000 points:** ≈ 2.4 MB of JSON per page; 50,000 doubles the round trips (≈ 100 for the cap), 200,000 doubles the peak memory per page (≈ 50 MB of objects). Neither changes a result.
- **STATE_SCAN_MAX 5,000,000:** 2.5 M cuts a 10 Hz state signal after ~3 days; 10 M lets one events-line signal move ≈ 240 MB once per catalog load. Only a third adapter without `stateChanges` meets it.
- **Fallback ≤ 2× rule:** at 1.5× ADX would also implement `extent` (1.5×) and `refExtent` (1.35× stays out); at 4× it would drop `loggerGaps` (2.2× plus 2.6 MB here, ≈ 7 MB on smart451). The table in C2 holds the ratios, so a different threshold is a one-line decision.
- **TOKEN_MARGIN 5 min:** CLI tokens live 60–90 min; 2.5 min still covers a 30 s query; 10 min only spawns `az` a little earlier. One spawn costs ~1 s (Python start of the CLI).
- **AZ_TIMEOUT 30 s:** a cold `az` start takes a few seconds; 15 s could cut a slow login refresh; 60 s keeps a hung CLI blocking the ping longer (the ping has its own 2 s timeout either way).
- **ADX result limits (500,000 rows, 64 MB) against our largest answers:** raw ≤ 20,000 rows, buckets ≤ 20,000, density ≤ 48,000 buckets, `firstTimes` fallback ≤ 1,001 per query, state changes ≤ 2,002, events ≤ 100,001 rows (≈ 20–30 MB; at twice the row size near 64 MB). A breach fails loudly (C6), never shows partial data; the events cap is the first to lower if it happens.
- **Emulator 4 GB memory limit:** the conformance fixture needs ≈ 0.5 GB; 2 GB is enough for it, but not for the 21.6 M-row measurement (1.33 GiB plus query memory).
- **Port 8125:** next to the ClickHouse test port 8124; free today (`lsof` shows no listener). Docker Desktop owns forwarded ports; a clash shows as a compose error, never a kill.
- **Fixture size (17,082 rows):** half would still cover every case (only `Lin.RAMP` needs > 1,001 points for the limit case); ten times would only slow the seeds.

## Risks / Trade-offs

- [ADX untested against a real cluster] → the emulator runs the same engine and REST API; auth, network latency and permissions are untested. The guide's troubleshooting lists the expected messages; a later real-cluster check needs `az` installed (not on this machine) and a cluster.
- [Emulator under amd64 emulation] → slower than native and Docker Desktop must keep emulation on; measured fast enough (C8). If a Docker update drops it, `test:adx` fails with its setup message.
- [Pinned image digest disappears from MCR] → `docker compose --profile adx pull` fails; switch to the then-current digest (one line).
- [Fallback cost on a large third source] → the start log names the native methods, the guide lists each fallback's cost, and the state-change scan is capped.
- [`refCount` semantics loosened] → the gap refresh only needs "changes when rows are added"; both natives and the fallback satisfy it, the suite accepts 17,069 or 17,070.
- [ADX `datetime` is 100 ns] → ns-precise data cannot be stored there; documented, and the conformance fixture uses 100 ns multiples so the same expectations hold on both sources.
- [Kusto error texts used for "missing table/column"] → matched on `SEM0100` plus the configured name; a mismatch shows as an error, never as silently missing data.

## Migration Plan

None for ClickHouse users: no variable changes, same queries. `KIPSCOPE_SOURCE` defaults to `clickhouse`. The emulator is opt-in (`--profile adx`).

## Manual checks (lead)

- "Guide followed on the emulator" (data-source): the guide's steps literally, a second server on 7311, the `curl` output.
- The dev server on carserver after the build: `curl -s localhost:7310/api/meta | jq .source` shows `kind: "clickhouse"` and the footer still reads `ClickHouse sdlog`; the start log names all 8 optional methods (`events` included) as native.
- `pnpm smoke` (the change touches `packages/shared` and `apps/web`).

## Ledger entry on archive (proposed; the lead assigns the number)

- Data-source contract: 7 required methods (`ping`, `listSignals` with text flags, `raw` with limit, `before`, `after`, `buckets`, `refBuckets` with optional row times) plus `info`; 7 optional fast paths computed by the server from the core when absent (`count`, `extent`, `refExtent`, `refCount`, `loggerGaps`, `firstTimes`, `stateChanges`); `events` a capability; fallbacks outside the queue; one conformance suite run native and core only on every adapter; fast paths only where the measured fallback costs more than 2×. ADX: `KIPSCOPE_SOURCE=adx`, Azure CLI token (A-1), one source per server (A-2), emulator as compose profile `adx` with `test:adx` (A-3), neutral layout `signals`/`events` or a stored function, 100 ns times.
