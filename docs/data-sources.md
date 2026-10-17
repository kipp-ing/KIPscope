# Data sources

How KIPscope reads recorded time series, what an adapter for a new database implements, and how to connect Azure Data Explorer (ADX). Specs: [data-source](../openspec/specs/data-source/spec.md), [adx-source](../openspec/specs/adx-source/spec.md). HTTP routes: [http-api.md](http-api.md).

## 1. What a source is

A source is the database the server reads signals and events from. The server talks to it through one adapter (`apps/server/src/datasource.ts`); the browser and the CLI never see it, and the credentials stay on the server. Two adapters ship: ClickHouse (`clickhouse.ts`, the default) and ADX (`adx.ts`). One server reads one source, chosen by `KIPSCOPE_SOURCE`; to see two sources side by side, run two servers. Every adapter passes the same conformance suite (`apps/server/test/conformance/`), natively and "core only".

## 2. Data model

- **Signal rows:** (data ref, signal name, time, value, text). A **data ref** is one recording, e.g. a vehicle (`smart451`); the **signal name** is unique within it (`BMS.SOC`).
- **ID:** a signal's ID is `<dataRef>/<name>`. A data ref must be non-empty and contain no `/`; the name must be non-empty. The catalog skips other listed entries with one warning per load.
- **Times:** int64 nanoseconds since 1970-01-01T00:00:00Z (UTC), `bigint` inside the server, decimal strings on the wire; exact to the source's own resolution (ClickHouse `DateTime64(9)`: 1 ns; ADX `datetime`: 100 ns). Times before 1970 work; the server accepts `TIME_MIN` (1900-01-01) … `TIME_MAX` (2262-04-11).
- **Values:** 64-bit floats.
- **SNA** (signal not available): the server passes each signal's SNA ranges (closed intervals of stored values, from the DBC); the adapter reports such a point with value `null` and counts it apart in buckets. The adapter never decides what SNA is.
- **Text:** a string per row, empty when the row has none (state names). `listSignals` flags each signal that has some non-empty text (`text: true`); for those signals `raw`, `before` and `after` also return each point's text.
- **Events** (optional table): rows (data ref, time, source, kind, name, value, text, detail). Kinds KIPscope knows: `dtc` (a fault code; `value` is its ISO 14229 status byte), `state` (a state of a source, `detail` `from <state>` on a change), `nrc` (a refused diagnostic request), `isotp` (transport). From them the server derives a category per event (DTC `active`, `pending`, `stored`, …; state `change` or `snapshot`; `refused`, `transport`, `other`), see the [events spec](../openspec/specs/events/spec.md). A source without an events table has no events; nothing else changes.
- **Rows without a time** are never returned by any method.

## 3. The interface

What an adapter author implements (`SourceAdapter` in `apps/server/src/datasource.ts`):

```ts
export interface SourceInfo {
  kind: string;          // `clickhouse`, `adx`, or the new adapter's own word
  database: string;
  table: string;
  eventsTable?: string;  // label for log lines, e.g. `sdlog.events`
}

export interface SourceAdapter {
  readonly info: SourceInfo;
  ping(abort: AbortSignal): Promise<void>;
  listSignals(abort?: AbortSignal): Promise<SourceSignal[]>;
  raw(ref: SeriesRef, from: Timestamp, to: Timestamp, limit?: number, abort?: AbortSignal): Promise<RawPoint[]>;
  before(ref: SeriesRef, t: Timestamp, abort?: AbortSignal): Promise<RawPoint | undefined>;
  after(ref: SeriesRef, t: Timestamp, abort?: AbortSignal): Promise<RawPoint | undefined>;
  buckets(ref: SeriesRef, from: Timestamp, to: Timestamp, width: bigint, abort?: AbortSignal): Promise<Bucket[]>;
  refBuckets(dataRef: string, width: bigint, times: boolean, abort?: AbortSignal): Promise<RefBucket[]>;

  // Optional fast paths; the server computes a missing one from the methods above.
  count?(ref: SignalRef, from: Timestamp, to: Timestamp, abort?: AbortSignal): Promise<number>;
  extent?(ref: SignalRef, abort?: AbortSignal): Promise<{ first: Timestamp; last: Timestamp } | undefined>;
  refExtent?(dataRef: string, abort?: AbortSignal): Promise<{ count: number; first: Timestamp; last: Timestamp } | undefined>;
  refCount?(dataRef: string, abort?: AbortSignal): Promise<number>;
  loggerGaps?(dataRef: string, grid: bigint, minGap: bigint, abort?: AbortSignal): Promise<LoggerGaps>;
  firstTimes?(dataRef: string, names: readonly string[], rows: number, abort?: AbortSignal): Promise<Map<string, Timestamp[]>>;
  stateChanges?(ref: SeriesRef, by: StateChangeRule, limit: number, abort?: AbortSignal): Promise<StateRow[]>;

  // Capability without fallback: absent, or `undefined` from it, means "no events table".
  events?(dataRef: string, limit: number, abort?: AbortSignal): Promise<EventRow[] | undefined>;
}
```

The server uses `DataSource = Required<SourceAdapter>`: `completeSource` (`fallbacks.ts`) fills in every optional method the adapter lacks, and the start log names the native ones (`source adx kipscope_test: native refCount, loggerGaps, stateChanges, events`).

| Method | Kind | Semantics | Fallback | Measured cost, native → fallback | Native in |
|---|---|---|---|---|---|
| `info` | required | kind, database, table, events table label; shown by `/api/meta` and the footer | — | — | both |
| `ping` | required | resolves when the source answers; never queued | — | — | both |
| `listSignals` | required | every (data ref, name) with a `text` flag | — | — | both |
| `raw` | required | points in `[from, to)`, ascending; with `limit` the earliest `limit` | — | — | both |
| `before` / `after` | required | last point strictly before `t` / first point at or after `t` | — | — | both |
| `buckets` | required | non-empty buckets on the grid `k · width` (floor, also before 1970), ordered by start: valid count, SNA count, mean/min/max of valid points (`null` iff count is 0) | — | — | both |
| `refBuckets` | required | non-empty buckets of all timestamped rows of a data ref on `k · width`, any order; `times`: with the first and last row time per bucket | — | — | both |
| `count` | optional | points in `[from, to)` | `buckets` of one bucket of width 2^62, sum of valid + SNA | ClickHouse 10 h: 5.2 → 64 ms, 1 min: 2.1 → 2.9 ms; emulator 10 h: 20 → 32 ms | ClickHouse |
| `extent` | optional | first and last time of a signal | `after(TIME_MIN)` and `before(TIME_MAX)` in parallel | ClickHouse 22 → ≈ 32 ms; emulator 20 → ≈ 30 ms | ClickHouse |
| `refExtent` | optional | row count, first and last time of a data ref | `refBuckets(2^62, times)`: sum, min, max | ClickHouse 38 → 75 ms; emulator 23 → 31 ms | ClickHouse |
| `refCount` | optional | a row count that changes whenever rows are added (rows without time may count, consistently) | `refExtent(…).count` | ClickHouse 1.3 → 38 ms; emulator 12 → 31 ms; smart451 3.4 ms → a full time-column scan every 5 min | both |
| `loggerGaps` | optional | gaps of at least `minGap` between rows of a data ref on `grid`, plus the last row time | `refBuckets(grid, times)`: a gap where the next bucket's first time minus the previous one's last ≥ `minGap` | ClickHouse 98 ms / 58 B → 99 ms / 2.8 MB; emulator 41 → 91 ms / 2.6 MB; smart451 ≈ 7 MB transfer | both |
| `firstTimes` | optional | the first `rows` times of each name (state-name sampling) | per name `raw(…, rows)`, every query queued; no names → no query | ClickHouse 52 ms in 1 query → 1,015 × 2–4 ms / 4; emulator: the fallback (38 ms per name) beats the native partition query (0.51 s for 2 names, low memory at 3 names) | ClickHouse |
| `stateChanges` | optional | first valid point, then each change by the rule (text, or value labels with tolerance), at most `limit` rows; SNA points skipped | `raw` in pages of 100,000 points; stops after 5,000,000 points (the signal is then skipped as `too_many_changes`, with a warning) | ClickHouse 8 ms / 225 B → 6 ms / 1.7 MB (63 k rows); emulator 44 ms / 3 rows → reads all rows; smart451 ≈ 5 MB | both |
| `events` | capability | event rows of a data ref in time order, at most `limit`; `undefined` = no events table | none: absent means no events | — | both |

ClickHouse implements all 15 natively and sends the same queries as before the contract existed. ADX implements 11: the fallbacks for `count`, `extent`, `refExtent` and `firstTimes` cost at most 1.6× (or less than the native query), the others more than 2× or a transfer of megabytes. Measurements: warm medians of 3 runs on the ClickHouse test DB (21.7 M rows) and the Kusto emulator (21.6 M rows, `Fast_100h.SIG_A/B/C` at 5 ms over 10 h), 2026-10-17. The full table, with the estimates for the smart451 database on carserver:

| Method | ClickHouse native → fallback | Emulator native → fallback | smart451 estimate | Fallback ≤ 2×? |
|---|---|---|---|---|
| `count`, 10 h of SIG_A | 5.2 ms → 64 ms (primary index vs. aggregate) | 20 → 32 ms | overview counts like the 10 h case | ClickHouse no (keeps native); ADX yes |
| `count`, 1 min | 2.1 → 2.9 ms | 15 → 15 ms | — | yes |
| `extent`, SIG_A | 22 → 4 + 32 ms (parallel ≈ 32) | 20 → ≈ 30 ms (28, 29 in parallel) | — | yes (1.5×) |
| `refExtent`, testcar | 38 → 75 ms | 23 → 31 ms | one scan either way | yes (≤ 2.0×) |
| `refCount`, testcar | 1.3 → 38 ms | 12 → 31 ms | 3.4 ms → a full time-column scan (≈ seconds) every 5 min | no: native on both |
| `loggerGaps`, testcar | 98 ms / 58 B → 99 ms / 2.8 MB | 41 ms → 91 ms / 2.6 MB | 7.2 s → ≈ 7.2 s + ≈ 7 MB (93 k seconds × 75 B) | ClickHouse ≈ 1.1×; ADX 2.2× + transfer → native on ADX |
| `firstTimes` | 52 ms (1,015 names, 1 query) → 1,015 × 2–4 ms / 4 | partition query 0.51 s for 2 names, `LowMemoryCondition` with 3 × 7.2 M rows → per name `top 1001` 38 ms | 0.17 s → 116 × ~20 ms / 4 ≈ 0.6 s | ClickHouse no; ADX: the fallback beats native |
| `stateChanges`, Ign MODE (63 k rows) | 8 ms / 225 B → 6 ms / 1.7 MB | 44 ms / 3 rows → reads all 63 k rows | 0.05–0.19 s / 17 rows → ≈ 5 MB | no: native on both |
| `refBuckets` 9 s with row times (density) | 72 → 90 ms | 30 ms (counts only) | 5.7 s → ≈ +25 % | ClickHouse density keeps `times: false` |

## 4. Rules

- **Ranges** are half-open `[from, to)`; points come in ascending time order; bucket grids are `k · width` from the epoch, floored, also for negative times.
- **Limits:** `raw` with `limit` returns the earliest `limit` points; `stateChanges` and `events` stop at `limit` rows. An adapter never returns fewer rows than asked because of an internal cap.
- **`abort` is the last parameter.** An aborted call rejects with the signal's reason and leaves no work running on the source (ClickHouse and ADX cancel the query when the request closes).
- **Errors:** a failing query rejects with the source's message; never return a partial answer (ADX: HTTP 200 with `HasErrors`, e.g. `LimitsExceeded`, is an error). Credentials and tokens never appear in an error.
- **Read-only:** an adapter never writes to the source.
- **Identifiers only from configuration:** database, table and column names come from the `KIPSCOPE_*` variables (checked at start); every value (data ref, name, times, limits, lists) goes in as a query parameter, never spliced into the query text. Numbers the adapter writes itself (SNA bounds, grid widths) are the only literals.
- **The queue:** every method except `ping` and `info` runs through the server's query queue, at most `KIPSCOPE_QUERY_CONCURRENCY` (default 4) at once, each with `KIPSCOPE_QUERY_TIMEOUT_S` (default 30). Fallbacks sit outside the queue, so each of their inner queries takes its own slot and carries the caller's abort.
- **Time bounds:** callers send bounds within `TIME_MIN` … `TIME_MAX`; `extent` and `firstTimes` fallbacks use them as "all". A source with coarser resolution rounds bounds up to its next tick, so `[from, to)`, `before` and `after` hold for any nanosecond bound.

## 5. Write an adapter

1. Implement `info`, `ping` and the 7 required methods of `SourceAdapter` in a new file under `apps/server/src/`.
2. Add a kind to `createAdapter` (`apps/server/src/sources.ts`) and its settings to `SourceConfig` and `loadConfig` (`apps/server/src/config.ts`); list every new variable in `.env.example` and in section 8 below (`docs.test.ts` checks both).
3. Seed the conformance fixture (`apps/server/test/conformance/fixture.ts`: 8 signals in two data refs, 17,082 rows, events) into a test instance of your database.
4. Add a runner `apps/server/test/conformance/<kind>.conformance.test.ts` that calls `describeConformance({name, adapter, eventsMissing})`. It runs every case twice: `<kind> native` and `<kind> core only` (your adapter reduced to the 7 required methods, everything else from the fallbacks).
5. Add a fast path only where the fallback measurably costs more than twice the native query, or moves megabytes; measure both on realistic data and keep the conformance run green.

The footer shows a new kind as given (`memory fixture`); `adx` and `clickhouse` have labels.

## 6. Connect your ADX

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
5. In `.env`:

   ```sh
   KIPSCOPE_SOURCE=adx
   KIPSCOPE_ADX_CLUSTER=https://<cluster>.<region>.kusto.windows.net
   KIPSCOPE_ADX_DATABASE=<database>
   # KIPSCOPE_TABLE=KIPscopeSignals   # and other mapping variables, if needed
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

## 7. Try it on the emulator

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

## 8. All variables

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
| `KIPSCOPE_EVENTS_TABLE` | both | `events` | same database, data-ref and time columns as the signals table; missing: no events |
| `KIPSCOPE_EVENT_COLUMN_SOURCE` | both | `source` | |
| `KIPSCOPE_EVENT_COLUMN_KIND` | both | `kind` | |
| `KIPSCOPE_EVENT_COLUMN_NAME` | both | `name` | |
| `KIPSCOPE_EVENT_COLUMN_VALUE` | both | `value` | |
| `KIPSCOPE_EVENT_COLUMN_TEXT` | both | `text` | |
| `KIPSCOPE_EVENT_COLUMN_DETAIL` | both | `detail` | |
| `KIPSCOPE_QUERY_CONCURRENCY` | both | `4` | positive integer; queries at once |
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

Test-only: `TEST_CLICKHOUSE_URL`, `TEST_CLICKHOUSE_USER`, `TEST_CLICKHOUSE_PASSWORD` (ClickHouse test DB on 8124) and `TEST_ADX_URL` (emulator, default `http://127.0.0.1:8125`).
