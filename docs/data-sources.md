# Data sources

How KIPscope reads recorded time series, what an adapter for a new database implements, and how to connect Azure Data Explorer (ADX). Specs: [data-source](../openspec/specs/data-source/spec.md), [adx-source](../openspec/specs/adx-source/spec.md). HTTP routes: [http-api.md](http-api.md).

## What a source is

A source is the database the server reads signals and events from. The server talks to it through one adapter (`apps/server/src/datasource.ts`); the browser and the CLI never see it, and the credentials stay on the server. Two adapters ship: ClickHouse (`clickhouse.ts`, the default) and ADX (`adx.ts`). One server reads one source, chosen by `KIPSCOPE_SOURCE`; to see two sources side by side, run two servers. Every adapter passes the same conformance suite (`apps/server/test/conformance/`), natively and "core only".

## Data model

- **Signal rows:** (data ref, signal name, time, value, text). A **data ref** is one recording, e.g. a vehicle (`smart451`); the **signal name** is unique within it (`BMS.SOC`).
- **ID:** a signal's ID is `<dataRef>/<name>`. A data ref must be non-empty and contain no `/`; the name must be non-empty. The catalog skips other listed entries with one warning per load.
- **Times:** int64 nanoseconds since 1970-01-01T00:00:00Z (UTC), `bigint` inside the server, decimal strings on the wire; exact to the source's own resolution (ClickHouse `DateTime64(9)`: 1 ns; ADX `datetime`: 100 ns). Times before 1970 work; the server accepts `TIME_MIN` (1900-01-01) … `TIME_MAX` (2262-04-11).
- **Values:** 64-bit floats.
- **SNA** (signal not available): the server passes each signal's SNA ranges (closed intervals of stored values, from the DBC); the adapter reports such a point with value `null` and counts it apart in buckets. The adapter never decides what SNA is, beyond the configured SNA texts: on ADX only, `KIPSCOPE_SNA_TEXTS` names row texts that mean SNA (matched exactly and case-sensitively, `SNA` is not `sna` or ` SNA`); such a row is SNA in every value query like a value in an SNA range (value `null`, counted apart in buckets, left out of state changes). Row-based methods (`raw` with `limit`, `count`) still count those rows as rows.
- **Text:** a string per row, empty when the row has none (state names). `listSignals` flags each signal that has some non-empty text (`text: true`); SNA texts do not count as text, so a signal whose only texts are SNA texts has no `text` flag. For text signals `raw`, `before` and `after` also return each point's text.
- **Unit:** `listSignals` may give a signal a `unit` (ADX with `KIPSCOPE_COLUMN_UNIT`: a non-empty unit of its rows, per data ref). The catalog uses it only where neither a DBC entry nor a diagnostic catalog gives a unit.
- **Events** (optional table): rows (data ref, time, source, kind, name, value, text, detail). Kinds KIPscope knows: `dtc` (a fault code; `value` is its ISO 14229 status byte), `state` (a state of a source, `detail` `from <state>` on a change), `nrc` (a refused diagnostic request), `isotp` (transport). From them the server derives a category per event (DTC `active`, `pending`, `stored`, …; state `change` or `snapshot`; `refused`, `transport`, `other`), see the [events spec](../openspec/specs/events/spec.md). A source without an events table has no events; nothing else changes.
- **Rows without a time** are never returned by any method.

## The interface

What an adapter author implements (`SourceAdapter` in `apps/server/src/datasource.ts`):

```ts
export interface SourceInfo {
  kind: string;          // `clickhouse`, `adx`, or the new adapter's own word
  database: string;
  table: string;
  eventsTable?: string;  // label for log lines, e.g. `sdlog.events`
}

/** One data ref and a half-open window [from, to), from < to (section "Scope"). */
export interface Scope {
  dataRef: string;
  from: Timestamp; // bigint ns
  to: Timestamp;
}

/** What one series request needs: raw points with edges, or buckets. */
export type SeriesAnswer =
  | { kind: "raw"; points: RawPoint[]; before?: RawPoint; after?: RawPoint }
  | { kind: "buckets"; buckets: Bucket[] };

export interface SourceAdapter {
  readonly info: SourceInfo;
  ping(abort: AbortSignal): Promise<void>;
  listSignals(scope?: Scope, abort?: AbortSignal): Promise<SourceSignal[]>;
  raw(ref: SeriesRef, from: Timestamp, to: Timestamp, limit?: number, abort?: AbortSignal): Promise<RawPoint[]>;
  before(ref: SeriesRef, t: Timestamp, scope?: Scope, abort?: AbortSignal): Promise<RawPoint | undefined>;
  after(ref: SeriesRef, t: Timestamp, scope?: Scope, abort?: AbortSignal): Promise<RawPoint | undefined>;
  buckets(ref: SeriesRef, from: Timestamp, to: Timestamp, width: bigint, abort?: AbortSignal): Promise<Bucket[]>;
  refBuckets(dataRef: string, width: bigint, times: boolean, scope?: Scope, abort?: AbortSignal): Promise<RefBucket[]>;

  // Optional fast paths; the server computes a missing one from the methods above.
  count?(ref: SignalRef, from: Timestamp, to: Timestamp, abort?: AbortSignal): Promise<number>;
  extent?(ref: SignalRef, scope?: Scope, abort?: AbortSignal): Promise<{ first: Timestamp; last: Timestamp } | undefined>;
  series?(ref: SeriesRef, from: Timestamp, to: Timestamp, target: number, width: bigint, scope?: Scope, abort?: AbortSignal): Promise<SeriesAnswer>;
  refExtent?(dataRef: string, scope?: Scope, abort?: AbortSignal): Promise<{ count: number; first: Timestamp; last: Timestamp } | undefined>;
  refCount?(dataRef: string, scope?: Scope, abort?: AbortSignal): Promise<number>;
  loggerGaps?(dataRef: string, grid: bigint, minGap: bigint, scope?: Scope, abort?: AbortSignal): Promise<LoggerGaps>;
  firstTimes?(dataRef: string, names: readonly string[], rows: number, scope?: Scope, abort?: AbortSignal): Promise<Map<string, Timestamp[]>>;
  stateChanges?(ref: SeriesRef, by: StateChangeRule, limit: number, scope?: Scope, abort?: AbortSignal): Promise<StateRow[]>;

  // Capability without fallback: absent, or `undefined` from it, means "no events table".
  events?(dataRef: string, limit: number, scope?: Scope, abort?: AbortSignal): Promise<EventRow[] | undefined>;
}
```

Twelve methods take an optional `scope` before `abort`; section "Scope" below says what it means. The server uses `DataSource = Required<SourceAdapter>`: `completeSource` (`fallbacks.ts`) fills in every optional method the adapter lacks, and the start log names the native ones (`source adx kipscope_test: native extent, series, refCount, loggerGaps, stateChanges, events`).

| Method | Kind | Semantics | Fallback | Measured cost, native → fallback | Native in |
|---|---|---|---|---|---|
| `info` | required | kind, database, table, events table label; shown by `/api/meta` and the footer | — | — | both |
| `ping` | required | resolves when the source answers; never queued | — | — | both |
| `listSignals` | required | every (data ref, name) with a `text` flag (SNA texts do not count as text) and optionally a `unit` | — | — | both |
| `raw` | required | points in `[from, to)`, ascending; with `limit` the earliest `limit` | — | — | both |
| `before` / `after` | required | last point strictly before `t` / first point at or after `t` | — | — | both |
| `buckets` | required | non-empty buckets on the grid `k · width` (floor, also before 1970), ordered by start: valid count, SNA count, mean/min/max of valid points (`null` iff count is 0) | — | — | both |
| `refBuckets` | required | non-empty buckets of all timestamped rows of a data ref on `k · width`, any order; `times`: with the first and last row time per bucket | — | — | both |
| `count` | optional | points in `[from, to)` | `buckets` of one bucket of width 2^62, sum of valid + SNA | ClickHouse 10 h: 5.2 → 64 ms, 1 min: 2.1 → 2.9 ms; emulator 10 h: 20 → 32 ms | ClickHouse (ADX: fallback, D-097) |
| `extent` | optional | first and last time of a signal | `after(TIME_MIN)` and `before(TIME_MAX)` in parallel | ClickHouse 22 → ≈ 32 ms; emulator 20 → ≈ 30 ms; ADX cluster: fallback 4–17 s per signal (two `top 1` scans), native extent + count of 3 names in one `summarize` 1.8 s | both |
| `series` | optional | what one series request needs: if `[from, to)` holds at most `target` points (as `count` counts them), those points (as `raw` without a limit), `before(ref, from, scope)` and `after(ref, to, scope)`; else `buckets(ref, from, to, width)` | `count` first, then `raw` + `before` + `after` in parallel, or `buckets` (today's calls with today's arguments) | emulator 10 h (buckets): 57 → 82 ms, 5 s (1,000 points, raw): 36 → 33 ms; ADX cluster: two serial round trips of 0.6–8 s each and up to 4 queue slots → one round trip and one slot (design figures) | ADX |
| `refExtent` | optional | row count, first and last time of a data ref | `refBuckets(2^62, times)`: sum, min, max | ClickHouse 38 → 75 ms; emulator 23 → 31 ms | ClickHouse |
| `refCount` | optional | a row count that changes whenever rows are added (rows without time may count, consistently) | `refExtent(…).count` | ClickHouse 1.3 → 38 ms; emulator 12 → 31 ms; smart451 3.4 ms → a full time-column scan every 5 min | both |
| `loggerGaps` | optional | gaps of at least `minGap` between rows of a data ref on `grid`, plus the last row time | `refBuckets(grid, times)`: a gap where the next bucket's first time minus the previous one's last ≥ `minGap` | ClickHouse 98 ms / 58 B → 99 ms / 2.8 MB; emulator 41 → 91 ms / 2.6 MB; smart451 ≈ 7 MB transfer | both |
| `firstTimes` | optional | the first `rows` times of each name (state-name sampling) | per name `raw(…, rows)`, every query queued; no names → no query | ClickHouse 52 ms in 1 query → 1,015 × 2–4 ms / 4; emulator: the fallback (38 ms per name) beats the native partition query (0.51 s for 2 names, low memory at 3 names) | ClickHouse |
| `stateChanges` | optional | first valid point, then each change by the rule (text, or value labels with tolerance), at most `limit` rows; SNA points skipped | `raw` in pages of 100,000 points; stops after 5,000,000 points (the signal is then skipped as `too_many_changes`, with a warning) | ClickHouse 8 ms / 225 B → 6 ms / 1.7 MB (63 k rows); emulator 44 ms / 3 rows → reads all rows; smart451 ≈ 5 MB | both |
| `events` | capability | event rows of a data ref in time order, at most `limit`; `undefined` = no events table | none: absent means no events | — | both |

ClickHouse implements 15 of the 16 natively; it takes `series` from the fallback, so it sends the same queries as before the contract existed. ADX implements 13: the fallbacks for `count`, `refExtent` and `firstTimes` cost at most 1.6× on the emulator (or less than the native query), the others more than 2× or a transfer of megabytes. `extent` and `series` are native on ADX because of the search tool team's measurements on a real cluster (2026-10-22, D-097): there one round trip costs 0.6–8 s, the `extent` fallback's two scans 4–17 s per signal, and the `series` fallback two serial round trips. `count` stays a fallback on ADX (D-097): with a native `series` ADX never calls it from `/api/series`. Measurements: warm medians of 3 runs on the ClickHouse test DB (21.7 M rows) and the Kusto emulator (21.6 M rows, `Fast_100h.SIG_A/B/C` at 5 ms over 10 h), 2026-10-17; cluster figures from the search tool team's report (2026-10-22). The full table, with the estimates for the smart451 database on carserver:

| Method | ClickHouse native → fallback | Emulator native → fallback | smart451 estimate | Fallback ≤ 2×? |
|---|---|---|---|---|
| `count`, 10 h of SIG_A | 5.2 ms → 64 ms (primary index vs. aggregate) | 20 → 32 ms | overview counts like the 10 h case | ClickHouse no (keeps native); ADX yes (stays on the fallback, D-097) |
| `count`, 1 min | 2.1 → 2.9 ms | 15 → 15 ms | — | yes |
| `extent`, SIG_A | 22 → 4 + 32 ms (parallel ≈ 32) | 20 → ≈ 30 ms (28, 29 in parallel) | — | emulator yes (1.5×); ADX cluster no: fallback 4–17 s per signal, native extent + count of 3 names in one `summarize` 1.8 s → native on ADX |
| `series`, one request | fallback only (no native) | 10 h of SIG_A (buckets, target 1,000): 57 → 82 ms; 5 s (1,000 points, raw): 36 → 33 ms (2026-10-22, on a separate emulator data set of SIG_A only, about 7.2 M rows, so not comparable with the other rows' times; method in the `speed-up-adx` design A7) | — | emulator yes (1.4×; raw: the fallback's second round trip costs nothing on loopback); ADX cluster no: two serial round trips (`count`, then the data) of 0.6–8 s each → one (design figures) → native on ADX |
| `refExtent`, testcar | 38 → 75 ms | 23 → 31 ms | one scan either way | yes (≤ 2.0×) |
| `refCount`, testcar | 1.3 → 38 ms | 12 → 31 ms | 3.4 ms → a full time-column scan (≈ seconds) every 5 min | no: native on both |
| `loggerGaps`, testcar | 98 ms / 58 B → 99 ms / 2.8 MB | 41 ms → 91 ms / 2.6 MB | 7.2 s → ≈ 7.2 s + ≈ 7 MB (93 k seconds × 75 B) | ClickHouse ≈ 1.1×; ADX 2.2× + transfer → native on ADX |
| `firstTimes` | 52 ms (1,015 names, 1 query) → 1,015 × 2–4 ms / 4 | partition query 0.51 s for 2 names, `LowMemoryCondition` with 3 × 7.2 M rows → per name `top 1001` 38 ms | 0.17 s → 116 × ~20 ms / 4 ≈ 0.6 s | ClickHouse no; ADX: the fallback beats native |
| `stateChanges`, Ign MODE (63 k rows) | 8 ms / 225 B → 6 ms / 1.7 MB | 44 ms / 3 rows → reads all 63 k rows | 0.05–0.19 s / 17 rows → ≈ 5 MB | no: native on both |
| `refBuckets` 9 s with row times (density) | 72 → 90 ms | 30 ms (counts only) | 5.7 s → ≈ +25 % | ClickHouse density keeps `times: false` |

## Rules

- **Ranges** are half-open `[from, to)`; points come in ascending time order; bucket grids are `k · width` from the epoch, floored, also for negative times.
- **Limits:** `raw` with `limit` returns the earliest `limit` points; `stateChanges` and `events` stop at `limit` rows. An adapter never returns fewer rows than asked because of an internal cap.
- **`abort` is the last parameter.** An aborted call rejects with the signal's reason and leaves no work running on the source (ClickHouse and ADX cancel the query when the request closes).
- **Errors:** a failing query rejects with the source's message; never return a partial answer (ADX: HTTP 200 with `HasErrors`, e.g. `LimitsExceeded`, is an error). Credentials and tokens never appear in an error.
- **Read-only:** an adapter never writes to the source.
- **Identifiers only from configuration:** database, table and column names come from the `KIPSCOPE_*` variables (checked at start); every value (data ref, name, times, limits, lists) goes in as a query parameter, never spliced into the query text. Numbers the adapter writes itself (SNA bounds, grid widths) are the only literals.
- **The queue:** every method except `ping` and `info` runs through the server's query queue, at most `KIPSCOPE_QUERY_CONCURRENCY` (default 4 for ClickHouse, 8 for ADX; D-097) at once, each with `KIPSCOPE_QUERY_TIMEOUT_S` (default 30). Every query runs in one of four classes, highest first: `interactive` (HTTP requests, the catalog load), `metadata` (the metadata batch at case open), `background` (the prefetches after a catalog load, the gap polls), `preload` (neighbour preloading). A free slot goes to the oldest waiting query of the highest class; running queries are never preempted. Shared work that a higher-class request joins is raised to that class and ranks by when it was raised. One slot is kept for `interactive` queries (none with a limit of 1), so background work never takes the last free slot. Fallbacks sit outside the queue, so each of their inner queries takes its own slot, runs in its caller's class and carries the caller's abort.
- **Time bounds:** callers send bounds within `TIME_MIN` … `TIME_MAX`; `extent` and `firstTimes` fallbacks use them as "all". A source with coarser resolution rounds bounds up to its next tick, so `[from, to)`, `before` and `after` hold for any nanosecond bound.

## Scope

A scope is one data ref and one half-open time window `[from, to)`, `from < to` (D-078). The workspace may hold one (`scope set` in the CLI, a view's scope, or the strip's **Widen**); while it does, the server passes it to every source call, and navigation, the catalog, the time strip, gaps and events stay inside it. Without a scope everything works as before.

**The rule for every method that takes `scope`:** with a scope, the method answers exactly as if the source held only the timestamped rows (and event rows) of `scope.dataRef` with `scope.from ≤ time < scope.to`. Without a scope it answers as before. Where the method also takes a data ref or a `SignalRef`, the server never sends a scope of another data ref; an adapter may ignore `scope.dataRef` there, and must apply the time bounds. `abort` stays the last parameter.

| Method | Signature | With a scope |
|---|---|---|
| `listSignals` (required) | `listSignals(scope?, abort?)` | signals of `scope.dataRef` with at least one row in the scope; `text` and `unit` from those rows |
| `before` (required) | `before(ref, t, scope?, abort?)` | last point in `[scope.from, min(t, scope.to))` |
| `after` (required) | `after(ref, t, scope?, abort?)` | first point in `[max(t, scope.from), scope.to)` |
| `refBuckets` (required) | `refBuckets(dataRef, width, times, scope?, abort?)` | non-empty buckets of the rows in the scope (an edge may cut a bucket) |
| `extent` | `extent(ref, scope?, abort?)` | first and last point in the scope |
| `series` | `series(ref, from, to, target, width, scope?, abort?)` | points or buckets of `[from, to)` as without a scope (the server keeps the range inside the scope); the edges are `before(ref, from, scope)` and `after(ref, to, scope)` |
| `refExtent` | `refExtent(dataRef, scope?, abort?)` | count, first and last of the rows in the scope |
| `refCount` | `refCount(dataRef, scope?, abort?)` | rows in the scope (exact; no rows without time) |
| `loggerGaps` | `loggerGaps(dataRef, grid, minGap, scope?, abort?)` | gaps between consecutive rows in the scope; `last` is the last row in the scope |
| `firstTimes` | `firstTimes(dataRef, names, rows, scope?, abort?)` | up to `rows` times per name, from the rows in the scope; no query for `[]` |
| `stateChanges` | `stateChanges(ref, by, limit, scope?, abort?)` | the first row in the scope, then each change within it |
| `events` (capability) | `events(dataRef, limit, scope?, abort?)` | event rows in the scope |

`raw`, `buckets` and `count` keep their signatures: they already take a range, and the server only sends ranges inside the active scope; so does `series`, whose scope bounds its edges. `ping` reads no rows; it is the only query without a data ref and a time filter. In scoped mode (below) the server wraps the source in a guard: a data call without a scope, or a `raw`, `buckets`, `count` or `series` outside a loaded scope, fails before it reaches the adapter and is logged as a bug.

**Fallbacks** (`fallbacks.ts`) pass the scope on and use `scope.from … scope.to` where they used `TIME_MIN … TIME_MAX`: `extent` is `after(ref, TIME_MIN, scope)` and `before(ref, TIME_MAX, scope)`; `refExtent` is `refBuckets(dataRef, 2^62, true, scope)`; `refCount` is `refExtent(dataRef, scope)`; `loggerGaps` is `refBuckets(dataRef, grid, true, scope)`; `firstTimes` is `raw(name, scope.from, scope.to, rows)` per name; the `stateChanges` page scan runs from `scope.from` to `scope.to`; `series` passes the scope to `before` and `after`; `count` is unchanged. Queue classes, aborts and the scan limits stay as they are.

**Filter shapes.** An adapter applies the scope as one filter on the data-ref column and both bounds of the time column, all as query parameters:

- ClickHouse: every query of a scoped call adds `AND <data-ref column> = {ref} AND <time column> >= {from} AND <time column> < {to}`. `listSignals(scope)` is one `GROUP BY` signal query over the scoped rows with the text flag. Unscoped calls send the same query texts as before.
- ADX: one helper builds the scoped table expression `<table> | where <data-ref column> == sref and <time column> >= sfrom and <time column> < sto` with the parameters `sref`, `sfrom`, `sto` (bounds rounded up to the tick as before); every scoped query starts from it instead of the bare table, and the events table uses the same helper. A native `firstTimes` must take the scope too; the native `extent` and `series` start every table reference from it.

**Conformance.** The suite (`apps/server/test/conformance/suite.ts`) runs five scoped cases, natively and core only, over its fixture with three scopes: one that holds part of a heartbeat signal on both sides of a logger gap plus two door events, one early window over several signals of one data ref while a second data ref has rows in the same times, and one that starts inside the logger gap.

| Case | What it checks |
|---|---|
| "lists the signals of a scope" | `listSignals` lists exactly the signals with rows in the scope, with the text flag from those rows, and none of the other data ref |
| "bounds the data-ref methods by a scope" | `refExtent`, `refCount`, `refBuckets` (buckets cut by the edges), `loggerGaps` (a gap inside the scope; none when the scope starts in the gap), `events` (only the event rows in the scope) |
| "bounds the signal methods by a scope" | `extent` of a signal in and of one without rows in the scope; `before` and `after` stop at the scope's edges |
| "samples the first times in a scope" | `firstTimes` counts per name start at `scope.from`; an unknown name is absent |
| "finds state changes in a scope" | `stateChanges` starts with the first row in the scope and lists only the changes within it, by value labels and by text |

The case "answers a series" also runs `series` with a scope: its edge before stops at `scope.from`. Every unscoped case keeps passing unchanged.

**Catalog modes.** `KIPSCOPE_CATALOG=full` (default) loads the whole signal catalog at start, as before; a scope then narrows everything to it. `KIPSCOPE_CATALOG=scoped` loads no catalog at start and runs no prefetch or poll over all data refs: the catalog, signal search and data routes answer 409 `scope_required` until the workspace has a scope, and the signal list is loaded per scope (`listSignals(scope)`, at most four kept). Use it for a source too large to list or scan whole, such as a big ADX table. A view opened without its own scope gets one derived from its first signal's data ref and the union of its window ranges and cursors, widened by `KIPSCOPE_SCOPE_PAD` (default `1h`) on each side.

## Write an adapter

1. Implement `info`, `ping` and the 7 required methods of `SourceAdapter` in a new file under `apps/server/src/`.
2. Add a kind to `createAdapter` (`apps/server/src/sources.ts`) and its settings to `SourceConfig` and `loadConfig` (`apps/server/src/config.ts`); list every new variable in `.env.example` and in section "All variables" below (`docs.test.ts` checks both).
3. Seed the conformance fixture (`apps/server/test/conformance/fixture.ts`: 8 signals in two data refs, 17,082 rows, events) into a test instance of your database.
4. Add a runner `apps/server/test/conformance/<kind>.conformance.test.ts` that calls `describeConformance({name, adapter, eventsMissing})`. It runs every case twice: `<kind> native` and `<kind> core only` (your adapter reduced to the 7 required methods, everything else from the fallbacks).
5. Add a fast path only where the fallback measurably costs more than twice the native query, or moves megabytes; measure both on realistic data and keep the conformance run green.

The footer shows a new kind as given (`memory fixture`); `adx` and `clickhouse` have labels.

## Connect your ADX

1. Install the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) on the machine that runs the server, so `az` is on its `PATH`.
2. `az login` (add `--tenant <tenant id>` when your account has several tenants). KIPscope runs `az account get-access-token --resource <cluster>` and keeps the token in memory only, until 5 minutes before it expires; nothing is stored.
3. Your account needs at least the **Database Viewer** role on the database.
4. Create the tables in the default layout:

   ```kql
   .create table signals (dataref: string, signal: string, timestamp: datetime, value: real, text: string)
   .create table events (dataref: string, timestamp: datetime, source: string, kind: string, name: string, value: real, text: string, detail: string)
   ```

   Or map your own layout through a stored function without parameters that returns these columns, and set `KIPSCOPE_TABLE` to its name:

   ```kql
   .create-or-alter function KIPscopeSignals() {
       Telemetry | project dataref = DeviceId, signal = SignalName, timestamp = EventTime, value = todouble(Value), text = ""
   }
   ```

   ADX inlines the function, so KIPscope's filters still reach the table (emulator: a count through a renaming function 26 ms, the table itself 23 ms). Other column names work through the `KIPSCOPE_COLUMN_*` variables; names that are KQL keywords (`kind`, `time`) are fine, every name is quoted as `['name']`. A missing events table means no events; a missing text column means no text signals.

   Row metadata (ADX only): with `KIPSCOPE_COLUMN_UNIT=unit` the signal list reads each signal's unit in the `summarize` it already runs, `take_anyif(['unit'], isnotempty(['unit']))` per data ref and signal, scoped and unscoped, in one query; the card's source line then reads `<data ref> · unit from the table` when no DBC entry or diagnostic catalog names the signal. A DBC or diag unit always wins. With `KIPSCOPE_SNA_TEXTS=SNA,INVLD` a row whose text is one of these is SNA (see Data model), passed to every value query as the parameter `snat`. A missing unit column fails the catalog load (`SEM0100` naming it); SNA texts without the text column fail it too.
5. In `.env`:

   ```sh
   KIPSCOPE_SOURCE=adx
   KIPSCOPE_ADX_CLUSTER=https://<cluster>.<region>.kusto.windows.net
   KIPSCOPE_ADX_DATABASE=<database>
   # KIPSCOPE_TABLE=KIPscopeSignals   # and other mapping variables, if needed
   # KIPSCOPE_COLUMN_UNIT=unit          # ADX only: unit per row
   # KIPSCOPE_SNA_TEXTS=SNA,INVLD       # ADX only: row texts that mean SNA
   ```

6. Start the server: `pnpm --filter @kipscope/server dev`.
7. Check: `curl -s localhost:7310/api/meta | jq .source` shows `"kind": "adx"`, your database and `"reachable": true`; the footer reads `ADX <database>`.

Troubleshooting, by message:

| Message | Meaning |
|---|---|
| `Azure CLI (az) not found; install it and run az login` | `az` is not on the server's `PATH` (step 1). |
| `Azure CLI: … run 'az login' …` | not logged in, or the login expired (step 2). |
| `…: run az login, or check your access to database <db>` (HTTP 401/403) | the token is not accepted: wrong tenant, or the account lacks the Database Viewer role (step 3). |
| `SEM0100 … '<name>'` | a table, function or column of the configuration does not exist: check `KIPSCOPE_TABLE` and `KIPSCOPE_COLUMN_*`. |
| `LimitsExceeded`, `LowMemoryCondition` | an answer exceeded ADX's result limits (500,000 rows, 64 MB) or memory; KIPscope shows an error instead of partial data. |
| timeout | the query ran longer than `KIPSCOPE_QUERY_TIMEOUT_S` (sent as `servertimeout`). |

## Try it on the emulator

The Kusto emulator (Kustainer, image pinned in `docker-compose.yml`, amd64, emulated on arm64; 1.2 GB) runs on `127.0.0.1:8125` without authentication:

```sh
docker compose --profile adx up -d
pnpm --filter @kipscope/server seed:adx    # conformance fixture into database kipscope_test (loopback only)
```

Start a second server next to your normal one (environment variables win over `.env`; its own state directory keeps your workspace untouched):

```sh
KIPSCOPE_SOURCE=adx \
KIPSCOPE_ADX_CLUSTER=http://127.0.0.1:8125 \
KIPSCOPE_ADX_DATABASE=kipscope_test \
KIPSCOPE_ADX_AUTH=none \
KIPSCOPE_PORT=7311 \
KIPSCOPE_STATE_DIR=.kipscope/adx \
pnpm --filter @kipscope/server start
```

Then `curl -s localhost:7311/api/meta | jq -c '[.source.kind, .source.database, .source.reachable, .catalog.size]'` prints `["adx","kipscope_test",true,8]`. The ADX conformance run: `pnpm --filter @kipscope/server test:adx` (`TEST_ADX_URL`, default `http://127.0.0.1:8125`).

## All variables

Every variable `apps/server/src/config.ts` reads. The server reads them from the environment or `.env` (see `.env.example`); nothing reaches the browser. Table and column names must match `^[A-Za-z_][A-Za-z0-9_]*$`.

| Variable | Source | Default | Rule |
|---|---|---|---|
| `KIPSCOPE_SOURCE` | both | `clickhouse` | `clickhouse` or `adx` |
| `CLICKHOUSE_URL` | clickhouse | — | required for this source |
| `CLICKHOUSE_USER` | clickhouse | `default` | |
| `CLICKHOUSE_PASSWORD` | clickhouse | empty | |
| `CLICKHOUSE_DATABASE` | clickhouse | `sdlog` | identifier |
| `KIPSCOPE_ADX_CLUSTER` | adx | — | required; origin only (no path, query or user info), `https://`, or `http://` for `localhost`, `127.0.0.1`, `[::1]` |
| `KIPSCOPE_ADX_DATABASE` | adx | — | required; letters, digits, `_`, `.`, `-`, space, 1–260 characters |
| `KIPSCOPE_ADX_AUTH` | adx | `azcli` | `azcli`, or `none` only for a loopback cluster |
| `KIPSCOPE_TABLE` | both | `signals` | table or (ADX) stored function |
| `KIPSCOPE_COLUMN_DATAREF` | both | ClickHouse `vehicle`, ADX `dataref` | |
| `KIPSCOPE_COLUMN_SIGNAL` | both | `signal` | |
| `KIPSCOPE_COLUMN_TIME` | both | ClickHouse `utc`, ADX `timestamp` | |
| `KIPSCOPE_COLUMN_VALUE` | both | `value` | |
| `KIPSCOPE_COLUMN_TEXT` | both | `text` | missing column: no text signals |
| `KIPSCOPE_COLUMN_UNIT` | adx | none | ADX only (refused with ClickHouse); identifier, empty = none; the unit column, read with `take_anyif` per data ref and signal; missing column: the catalog load fails |
| `KIPSCOPE_SNA_TEXTS` | adx | none | ADX only (refused with ClickHouse); comma list, each entry trimmed, empty entries and repeats dropped, empty list = none; row texts that mean SNA, matched exactly and case-sensitively; needs the text column (missing: the catalog load fails) |
| `KIPSCOPE_EVENTS_TABLE` | both | `events` | same database, data-ref and time columns as the signals table; missing: no events |
| `KIPSCOPE_EVENT_COLUMN_SOURCE` | both | `source` | |
| `KIPSCOPE_EVENT_COLUMN_KIND` | both | `kind` | |
| `KIPSCOPE_EVENT_COLUMN_NAME` | both | `name` | |
| `KIPSCOPE_EVENT_COLUMN_VALUE` | both | `value` | |
| `KIPSCOPE_EVENT_COLUMN_TEXT` | both | `text` | |
| `KIPSCOPE_EVENT_COLUMN_DETAIL` | both | `detail` | |
| `KIPSCOPE_QUERY_CONCURRENCY` | both | ClickHouse `4`, ADX `8` | positive integer; queries at once |
| `KIPSCOPE_QUERY_TIMEOUT_S` | both | `30` | positive integer; seconds per query |

Server settings, independent of the source:

| Variable | Default | Rule |
|---|---|---|
| `KIPSCOPE_HOST` | `127.0.0.1` | a non-loopback host logs a warning: no authentication |
| `KIPSCOPE_PORT` | `7310` | positive integer |
| `KIPSCOPE_DBC_FILES` | smart451 `h-can.dbc`, `hybrid-can.dbc` | comma list, relative to the repo root |
| `KIPSCOPE_DIAG_CATALOGS` | smart451 `bms-live.manifest.json` | comma list, relative to the repo root |
| `KIPSCOPE_PROJECT_FILE` | `kipscope.yaml` (optional) | must exist when set |
| `KIPSCOPE_STATE_DIR` | `.kipscope` | workspace state and saved views |
| `KIPSCOPE_CATALOG` | `full` | `full` (catalog of all data refs at start) or `scoped` (a signal list per scope only, section "Scope"); any other value stops the server |
| `KIPSCOPE_SCOPE_PAD` | `1h` | a CLI duration ≥ 0 (`30min`, `1h`, `0s`): padding on each side of a scope derived from a view (section "Scope") |

Sessions from a search tool (finder; not part of KIPscope, [handoff.md](handoff.md)); any bad value stops the server naming the variable:

| Variable | Default | Rule |
|---|---|---|
| `KIPSCOPE_FINDER_JWKS` | unset | the finder's key set: a JWKS file path (relative to the repo root) or an `https` URL (`http` only for a loopback host); unset with an identity other than `none`, every catalog open answers 503 `finder_not_configured` |
| `KIPSCOPE_FINDER_ISSUER` | — | required with the key set; must equal `iss` |
| `KIPSCOPE_FINDER_AUDIENCE` | — | required with the key set; must be in `aud` |
| `KIPSCOPE_FINDER_ALGS` | `EdDSA,ES256` | subset of `EdDSA ES256 ES384 PS256 RS256`; `none` and `HS*` stop the server |
| `KIPSCOPE_FINDER_USER_CLAIM` | `sub` | the claim (name or dotted path) that must equal the signed-in user |
| `KIPSCOPE_FINDER_MAX_AGE` | `1h` | a CLI duration of 1 min … 24 h: the largest `exp − iat` accepted |
| `KIPSCOPE_FINDER_ORIGINS` | empty | comma list of `http(s)://host[:port]`: a catalog's back link is kept only for these origins |
| `KIPSCOPE_CASE_DATAREF` | `{object}` | template of a session's data ref; must contain `{object}` |
| `KIPSCOPE_CASE_PAD` | `60s` | a CLI duration of 0 … 24 h: the pad on each side of a session when the catalog has none |

Test-only: `TEST_CLICKHOUSE_URL`, `TEST_CLICKHOUSE_USER`, `TEST_CLICKHOUSE_PASSWORD` (ClickHouse test DB on 8124) and `TEST_ADX_URL` (emulator, default `http://127.0.0.1:8125`).
