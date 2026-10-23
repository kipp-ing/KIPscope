# adx-source Specification

## Purpose
Reads measurements from Azure Data Explorer (Kusto) behind the data-source contract: KQL over the Kusto REST API, signed in with the user's Azure CLI login, from a neutral table layout or any stored function that returns it; tested against the Kusto emulator.

## Requirements

### Requirement: ADX configuration
With `KIPSCOPE_SOURCE=adx` the server SHALL read `KIPSCOPE_ADX_CLUSTER` (required; `https://`, or `http://` only for a loopback host), `KIPSCOPE_ADX_DATABASE` (required) and `KIPSCOPE_ADX_AUTH` (`azcli`, default, or `none` only for a loopback cluster). Today's table and column variables SHALL map the layout, with the neutral ADX defaults of design C5. Origin: Jan (2026-10-17) „ADX via az login"; the lead's brief (no smart451 names in the ADX layout); D-005.

#### Scenario: Defaults and checks
- **WHEN** `loadConfig` runs with `KIPSCOPE_SOURCE=adx`, `KIPSCOPE_ADX_CLUSTER=https://help.kusto.windows.net`, `KIPSCOPE_ADX_DATABASE=Samples`; then with `KIPSCOPE_ADX_CLUSTER=http://10.0.0.5:8080`; then with `KIPSCOPE_ADX_AUTH=none` and the https cluster; then with `KIPSCOPE_ADX_AUTH=none` and `http://127.0.0.1:8125`
- **THEN** the first gives auth `azcli`, table `signals` with columns `dataref`, `signal`, `timestamp`, `value`, `text` and events table `events`; the second throws naming `KIPSCOPE_ADX_CLUSTER` (http only for loopback); the third throws naming `KIPSCOPE_ADX_AUTH` (`none` only for a loopback cluster); the fourth gives auth `none`
- **Evidence:** `apps/server/test/config.test.ts` › "reads the ADX settings"

#### Scenario: ClickHouse defaults unchanged
- **WHEN** `loadConfig` runs with only `CLICKHOUSE_URL` set
- **THEN** the mapping is database `sdlog`, table `signals`, columns `vehicle`, `signal`, `utc`, `value`, `text`, events table `events`, as before this change
- **Evidence:** `apps/server/test/config.test.ts` › "selects the source"

### Requirement: Azure CLI credential
With `KIPSCOPE_ADX_AUTH=azcli` the adapter SHALL take its bearer token from `az account get-access-token`, keep it until 5 min before expiry and share one running request among concurrent callers. A missing or logged-out CLI SHALL fail every query and the ping with a message saying what to do. The token SHALL never appear in logs, errors, `/api/meta` or any file KIPscope writes. Origin: Jan (2026-10-17) „ADX via az login"; concept §8; A-1 (a).

#### Scenario: Token cached until near expiry
- **WHEN** a token provider with a fake runner that returns token `tok-1` expiring in 60 min is asked 3 times at once, again after 54 min, and again after 56 min (fake clock)
- **THEN** the runner ran once for the first three and the 54 min call, and a second time at 56 min; it got the arguments `account get-access-token --resource https://help.kusto.windows.net --output json`
- **Evidence:** `apps/server/test/azcli.test.ts` › "caches the token until five minutes before expiry"

#### Scenario: CLI missing or logged out
- **WHEN** the fake runner fails with `ENOENT`, and then with exit code 1 and stderr `ERROR: Please run 'az login' to setup account.`
- **THEN** the first error says `Azure CLI (az) not found; install it and run az login`, the second `Azure CLI: Please run 'az login' to setup account.`; neither contains a token
- **Evidence:** `apps/server/test/azcli.test.ts` › "explains a missing or logged-out CLI"

#### Scenario: Token stays private
- **WHEN** a Kusto client with token `secret-token-123` gets a 401 answer and a network error, and `/api/meta` is read with that source unreachable
- **THEN** neither error message nor the meta answer contains `secret-token-123`; the request carried `Authorization: Bearer secret-token-123`
- **Evidence:** `apps/server/test/kusto.test.ts` › "never puts the token into errors"; `apps/server/test/meta.http.test.ts` › "never sends source credentials" (gains an ADX case)

### Requirement: Table layout or stored function
The adapter SHALL read the configured signals and events tables, where each name MAY instead be a stored function without parameters that returns the mapped columns; every configured name SHALL be quoted as a KQL identifier (`['name']`), so names that are KQL keywords (`kind`, `time`) work. Origin: the lead's brief („table layout or a KQL mapping"); data fact: the emulator refuses `extend kind = …` unquoted and `time` as a bare column name.

#### Scenario: Stored function as mapping
- **WHEN** the emulator holds a function `KSignals()` that renames another table's columns to the default layout and the adapter is configured with `KIPSCOPE_TABLE=KSignals`
- **THEN** `listSignals` and `raw(conf-a/Lin.RAMP, B + 1 s, B + 2 s)` answer as on the table itself (8 signals, 100 points)
- **Evidence:** `apps/server/test/adx.test.ts` › "reads through a stored function"

### Requirement: Exact times at ADX resolution
ADX `datetime` has a resolution of 100 ns. Every time the adapter returns SHALL be exact (computed as `long` nanoseconds, sent as a decimal string), and every bound it sends SHALL be rounded up to the next 100 ns, so half-open ranges, `before` and `after` hold for any nanosecond bound. Origin: concept §3 (Originalpräzision); emulator facts (design C6): `unixtime_nanoseconds_todatetime` rounds, `/ 1tick` gives a `real`, ns exceed 2^53.

#### Scenario: Bounds between ticks
- **WHEN** the ADX adapter runs `raw(conf-a/Fine.NS, B + 123,456,701, B + 123,457,801)`, `before(…, B + 123,456,701)` and `after(…, B + 123,456,701)`
- **THEN** `raw` gives exactly k = 1 (B + 123,457,800), `before` k = 0 and `after` k = 1
- **Evidence:** conformance suite › "keeps times exact" (ADX run); `apps/server/test/kusto.test.ts` › "rounds bounds up to the next tick"

### Requirement: Partial results are errors
A query whose answer reports errors (HTTP status ≥ 400, or a `DataSetCompletion` with `HasErrors`, such as the result-size limit or low memory) SHALL fail with the Kusto message and SHALL NOT return the rows it got. Origin: series-query "Query errors are reported"; data facts from the emulator: 600,000 rows come back as 500,001 rows with HTTP 200 and `LimitsExceeded`; a large `partition` answered 200 with `LowMemoryCondition`.

#### Scenario: Truncated answer
- **WHEN** the Kusto client runs `range i from 1 to 600000 step 1` on the emulator, which exceeds its 500,000-row result limit
- **THEN** it rejects with a message containing `LimitsExceeded` and returns no rows
- **Evidence:** `apps/server/test/adx.test.ts` › "fails on a truncated answer"

#### Scenario: Error frames and HTTP errors
- **WHEN** the Kusto client gets a 200 answer whose completion frame has `HasErrors` true, and a 400 answer `{"error": {"@message": "Semantic error: SEM0100 …"}}`
- **THEN** both reject, with the frame's and the error's `@message`
- **Evidence:** `apps/server/test/kusto.test.ts` › "fails on error frames and error answers"

### Requirement: Missing events table or text column
A missing events table SHALL mean no events (`events` answers "no table"), and a missing text column SHALL mean no text signals; any other error SHALL fail. With SNA texts configured a missing text column SHALL fail the signal list with a message naming `KIPSCOPE_SNA_TEXTS`, `KIPSCOPE_COLUMN_TEXT` and the column; with only a unit column configured a missing text column SHALL still mean no text signals, with the units read. Origin: events "Events source"; ClickHouse does the same (design E4 of `add-events`); SNA texts: necessary consequence (every value query would fail on the missing column, design R2).

#### Scenario: Missing table and column
- **WHEN** the ADX adapter runs on the emulator with `KIPSCOPE_EVENTS_TABLE=nope`, and with `KIPSCOPE_COLUMN_TEXT=nope`
- **THEN** `events(conf-a, 100)` answers "no table" and `listSignals` answers the 8 signals all with `text` false
- **Evidence:** `apps/server/test/adx.test.ts` › "treats a missing events table and text column as none"

#### Scenario: Missing text column with row metadata
- **WHEN** on the emulator an adapter on `KMeta` with `text: "nope"` runs `listSignals()` once with `snaTexts: ["SNA"]` and once with only `unit: "unit"`
- **THEN** the first rejects with `KIPSCOPE_SNA_TEXTS needs the text column 'nope' (KIPSCOPE_COLUMN_TEXT), which does not exist`; the second lists the 4 `KMeta` signals, none with `text`, `meta-a/Spd.V` with unit `km/h` and `meta-b/Spd.V` with `mph`
- **Evidence:** `apps/server/test/adx.test.ts` › "treats a missing text column with row metadata"; the same two cases on the recording fake answering SEM0100: `apps/server/test/adxQueries.test.ts` › "falls back without the text column"

### Requirement: Aborts cancel ADX queries
An aborted request SHALL close the HTTP request of its running query, which makes ADX cancel it, and SHALL send nothing else. Origin: D-011 (D7: aborts cancel server-side); data fact: the emulator lists a query whose client disconnected after 1 s as `Cancelled`, `E_QUERY_CANCELLED`, duration 1.0 s (it runs 5.9 s otherwise).

#### Scenario: Cancelled on abort
- **WHEN** a slow query (`range i from 1 to 3000000000 step 1 | summarize sum(i % 7)`) runs through the Kusto client with client request ID `KIPscope.test;<uuid>` and is aborted after 1 s
- **THEN** it rejects with the abort reason within 100 ms, and `.show queries` on the emulator lists that ID as `Cancelled` with a duration under 2 s
- **Evidence:** `apps/server/test/adx.test.ts` › "cancels a query on abort"

### Requirement: ADX query limits
Every query SHALL carry `servertimeout` = `KIPSCOPE_QUERY_TIMEOUT_S`, a client request ID `KIPscope.query;<uuid>` and the app name `KIPscope`, and SHALL pass all values as query parameters (strings, datetimes, longs, reals, dynamic arrays) or as numbers the adapter wrote itself. A real parameter SHALL be sent as `real(<n>)`, `real(nan)`, `real(+inf)` or `real(-inf)`. Origin: series-query "Bounded database load"; D-046 spirit (no value from a request reaches query text); reals: necessary consequence of D-111 (formula constants and seed values as parameters, computed-signals "Formula text never reaches a query").

#### Scenario: Request shape
- **WHEN** the Kusto client sends `raw` for signal `it's "q"` with a fake fetch
- **THEN** the body has `db`, a `csl` starting `declare query_parameters(`, `properties.Options.servertimeout` `00:00:30`, and `properties.Parameters.sig` equal to `it's "q"`; the headers hold `x-ms-app: KIPscope` and an `x-ms-client-request-id` starting `KIPscope.query;`
- **Evidence:** `apps/server/test/kusto.test.ts` › "sends parameters and limits"

#### Scenario: Real parameters
- **WHEN** the Kusto client sends a query with the parameters `k0` real 2.5, `k1` real 1e21, `k2` real NaN, `k3` real −Infinity and `k4` real −3 with a fake fetch
- **THEN** the `csl` prologue declares `k0:real` … `k4:real`, and `properties.Parameters` holds `real(2.5)`, `real(1e+21)`, `real(nan)`, `real(-inf)` and `real(-3)`
- **Evidence:** `apps/server/test/kusto.test.ts` › "sends real parameters"

### Requirement: ADX passes the conformance suite
The ADX adapter SHALL pass the whole conformance suite against the emulator, natively and core only. It SHALL implement `extent`, `series`, `refCount`, `loggerGaps`, `stateChanges`, `computedSeries` and `events` natively and use the server's fallbacks for `count`, `refExtent` and `firstTimes` (design C6, measured; speed-up-adx design A1). Origin: data-source "One conformance suite"; the lead's brief (factor-of-two rule on the measured costs, D-074); `count` on the fallback: D-097 (Jan, 2026-10-22, following D-074); `extent`, `series`: data fact (search tool team's report of 2026-10-22 on a real cluster: the `extent` fallback 4–17 s per signal, two serial round trips per series request, while the emulator had shown ≤ 1.6×) and Jan's agreement to the lead's cut (2026-10-22, P1, P2); `computedSeries`: D-111 (the fallback stops at 200,000 rows, so it cannot serve a long range at all).

#### Scenario: Emulator run
- **WHEN** `docker compose --profile adx up -d`, `pnpm --filter @kipscope/server seed:adx` and `pnpm --filter @kipscope/server test:adx` run
- **THEN** every conformance case passes for `adx native` and `adx core only`, and the ADX adapter object has exactly the methods named above
- **Evidence:** the commands' output; `apps/server/test/adx.test.ts` › "implements the measured fast paths only"

#### Scenario: Native methods without the emulator
- **WHEN** `nativeMethods` runs on an ADX adapter over a fake Kusto client
- **THEN** it lists exactly `extent`, `series`, `refCount`, `loggerGaps`, `stateChanges`, `computedSeries` and `events`, in that order
- **Evidence:** `apps/server/test/adxQueries.test.ts` › "lists the native methods"

### Requirement: Kusto emulator for tests
`docker-compose.yml` SHALL hold the Kusto emulator under the profile `adx` (loopback port 8125, pinned image, volume), so `docker compose up -d` still starts only ClickHouse. `seed:adx` SHALL put the conformance fixture into database `kipscope_test` (default layout), and the row metadata table `KMeta` of design R7 next to it, and refuse a non-loopback `TEST_ADX_URL`; `test:adx` SHALL fail with one message naming both commands when the emulator is missing or unseeded. Origin: Jan (2026-10-17) „Not yet, emulate"; A-3 (a); D-007; `KMeta`: necessary consequence (units and sentinels need rows the conformance fixture does not hold, and changing that fixture would change the ClickHouse seed).

#### Scenario: Not started
- **WHEN** `pnpm --filter @kipscope/server test:adx` runs with no emulator on 8125
- **THEN** it fails once with `Kusto emulator at http://127.0.0.1:8125 is not reachable or not seeded: run \`docker compose --profile adx up -d\` and \`pnpm --filter @kipscope/server seed:adx\``
- **Evidence:** the command's output (tester, emulator stopped)

#### Scenario: Seed guard
- **WHEN** `seed:adx` runs with `TEST_ADX_URL=https://help.kusto.windows.net`
- **THEN** it exits non-zero before sending anything, saying it seeds only a loopback emulator
- **Evidence:** the command's output

#### Scenario: Default test run unchanged
- **WHEN** `docker compose up -d` runs (no profile), then `pnpm test`
- **THEN** only `clickhouse-test` starts, and `pnpm test` passes without the emulator (the ADX conformance run is not part of it)
- **Evidence:** `docker compose ps --format '{{.Service}}'` prints `clickhouse-test` only; the test output

#### Scenario: Row metadata table seeded
- **WHEN** `pnpm --filter @kipscope/server seed:adx` runs against the emulator
- **THEN** its spot checks print `ok` for `KMeta | count` → `22` and `KMeta | where text in ('SNA','INVLD') | count` → `5`, next to the existing checks, which are unchanged
- **Evidence:** the command's output

### Requirement: One ADX query per extent and series
The ADX adapter's `extent` and `series` SHALL each send exactly one KQL query, with or without a scope: `extent` takes `min` and `max` of the time column in one `summarize` (no `top`); `series` computes the range's count with `toscalar` and returns the raw, edge and bucket branches through one `union` (design A3). Through the server's composition (queue and fallbacks), one `/api/series` computation on ADX SHALL take one queue slot and send one query, on the raw path and on the bucket path. Origin: data fact (search tool team's report of 2026-10-22: the `extent` fallback is two `top 1` scans, 4–17 s per signal; `/api/series` costs two serial round trips); Jan's agreement to the lead's cut (2026-10-22, P1 and P2); D-097 (no native `count`).

#### Scenario: Query count per call
- **WHEN** an ADX adapter on a fake Kusto client that records each query and answers the rows of design A3 runs `extent` and `series`, the latter once answering a count row of 5 for target 10 (raw path) and once a count row of 50 for target 10 (bucket path), each once without and once with scope {conf-a, B + 5 s, B + 35 s}
- **THEN** every call sent exactly one query; the adapter has no `count` method; the `extent` text holds `summarize` with `min(` and `max(` and no `top`; each `series` text holds `toscalar(` and `union`
- **Evidence:** `apps/server/test/adxQueries.test.ts` › "sends one query per extent and series"

#### Scenario: One slot and one query per series request
- **WHEN** `querySeries` runs through `completeSource(queuedAdapter(adx, new QueryQueue(8)))` over that fake client, once on the raw path and once on the bucket path
- **THEN** the fake received one query per run, the queue's `peak` is 1, and the results are a `raw` and a `buckets` `SeriesResult` built from the fake rows (points in row-number order, buckets by start)
- **Evidence:** `apps/server/test/adxQueries.test.ts` › "answers a series request with one query"

#### Scenario: Scoped series query carries both filters
- **WHEN** `series` runs on the recording fake with scope {conf-a, B + 5 s, B + 35 s}
- **THEN** every reference to the signals table in its KQL text is filtered by the data-ref column `== sref` and the time column `>= sfrom` and `< sto` before any other operator, with `sref`, `sfrom`, `sto` as parameters
- **Evidence:** `apps/server/test/adx.test.ts` › "scopes every query by data ref and time" (with `series` in `SCOPED_CALLS`)

### Requirement: Native series answers as the fallback does
On the Kusto emulator, `querySeries` over the native ADX adapter SHALL give the same `SeriesResult`, serialized to JSON, as over the same adapter reduced to its required methods, for every request of data-source "Series natively and from the core". Origin: Jan's agreement to the lead's cut (2026-10-22, P2: „Output must stay identical for both paths (raw and buckets)"); data fact (report P2 done-when: „output byte-identical to today's for both paths").

#### Scenario: Byte-identical on the emulator
- **WHEN** `docker compose --profile adx up -d`, `pnpm --filter @kipscope/server seed:adx` and `pnpm --filter @kipscope/server test:adx` run, and the test sends the seven requests (a)–(g) through `querySeries` once with `completeSource(adapter)` and once with `completeSource(coreOnly(adapter))`
- **THEN** each pair of answers has equal `JSON.stringify` output, and (a), (d)–(g) are `raw` while (b) and (c) are `buckets`
- **Evidence:** `apps/server/test/adx.test.ts` › "answers series requests as the fallback does"

### Requirement: Row metadata configuration
With `KIPSCOPE_SOURCE=adx` the server SHALL read `KIPSCOPE_COLUMN_UNIT` (unit column, an identifier; unset or empty: none) and `KIPSCOPE_SNA_TEXTS` (comma list, entries trimmed, empty entries and repeats dropped; none left: unset), matched exactly and case-sensitively. With ClickHouse either one set SHALL be a config error naming it. Unset, ADX queries SHALL be as before. Origin: D-100; ClickHouse refusal: necessary consequence (D-100 names only ADX), Q-1; exact match: design R1.

#### Scenario: Row metadata variables
- **WHEN** `loadConfig` runs with the ADX settings of "Defaults and checks" plus (a) `KIPSCOPE_COLUMN_UNIT=unit` and `KIPSCOPE_SNA_TEXTS= SNA, INVLD,,SNA `; (b) neither; (c) `KIPSCOPE_SNA_TEXTS= , `; (d) `KIPSCOPE_COLUMN_UNIT=bad name`; and with only `CLICKHOUSE_URL` set plus (e) `KIPSCOPE_COLUMN_UNIT=unit`, (f) `KIPSCOPE_SNA_TEXTS=SNA`
- **THEN** (a) gives mapping `unit` `unit` and `snaTexts` `["SNA", "INVLD"]`; (b) and (c) give a mapping without `unit` and `snaTexts` keys; (d) throws naming `KIPSCOPE_COLUMN_UNIT`; (e) throws `KIPSCOPE_COLUMN_UNIT: only with KIPSCOPE_SOURCE=adx`; (f) throws `KIPSCOPE_SNA_TEXTS: only with KIPSCOPE_SOURCE=adx`
- **Evidence:** `apps/server/test/config.test.ts` › "reads the ADX row metadata settings"

### Requirement: Units from the table
With a unit column the ADX signal list SHALL read `take_anyif(<unit>, isnotempty(<unit>))` per data ref and signal in the summarize it already runs, scoped and unscoped, in one query. A listed signal SHALL carry that unit when non-empty after trimming, else none. A configured unit column that does not exist SHALL fail the list. Origin: D-100 („in its existing summarize … per data ref"); issue #1 M3; unscoped: design R2, Q-2; missing column: necessary consequence (set explicitly).

#### Scenario: Unit in the signal list query
- **WHEN** an ADX adapter with `unit: "unit"` on a fake Kusto client that records each query runs `listSignals()` and `listSignals(scope)` with scope {conf-a, B + 5 s, B + 35 s}, and an adapter without `unit` runs the same
- **THEN** each call sends exactly one query; with the unit column its text holds `take_anyif(['unit'], isnotempty(['unit']))` inside the `summarize … by` that also computes the text flag, and the scoped text still filters by `sref`, `sfrom`, `sto` before any other operator; without the unit column no text holds `take_anyif`
- **Evidence:** `apps/server/test/adxQueries.test.ts` › "reads the unit in the signal list query"

#### Scenario: Units on the emulator
- **WHEN** the emulator is seeded and an adapter on table `KMeta` (design R7) with `unit: "unit"` and `snaTexts: ["SNA", "INVLD"]` runs `listSignals()` and `listSignals({meta-a, B + 5 s, B + 10 s})`, and one with `unit: "nope"` runs `listSignals()`
- **THEN** the first lists exactly `meta-a/Flag.ERR` (no unit), `meta-a/Gear.POS` (no unit), `meta-a/Spd.V` with unit `km/h`, `meta-b/Spd.V` with unit `mph`; the scoped call lists only `meta-a/Spd.V`, without unit (its unit rows lie before B + 5 s); the third rejects with an error naming `nope`
- **Evidence:** `apps/server/test/adx.test.ts` › "reads units from the table per data ref"

### Requirement: SNA by row text
With SNA texts, every ADX value query (`raw`, `before`, `after`, `series`, `buckets`, `stateChanges`) SHALL treat a row whose text is in the list as SNA, as a value in a DBC SNA range is treated (null value, bucket SNA count, left out of state changes, returned as SNA neighbour), together with the ranges, the list passed as a query parameter. Row-based methods SHALL count such rows as rows. Origin: D-100 („a gap, no label"); issue #1 M3 („like a DBC SNA value"); parameter and rows: design R3.

#### Scenario: SNA list as a parameter
- **WHEN** an ADX adapter with `snaTexts: ["SNA", "INVLD"]` on the recording fake runs `raw`, `before`, `after`, `series`, `buckets`, `stateChanges` and `listSignals`, and an adapter without `snaTexts` runs the same
- **THEN** with the list every query text holds `tostring(['text']) in (snat)` and its parameters hold `snat` of type `dynamic` with value `["SNA", "INVLD"]`; without the list no query text holds `snat` and no parameter set has it
- **Evidence:** `apps/server/test/adxQueries.test.ts` › "passes the SNA texts to every value query"

#### Scenario: Sentinels on the emulator
- **WHEN** on the seeded emulator an adapter on `KMeta` with `snaTexts: ["SNA", "INVLD"]` runs `raw(meta-a/Spd.V, B, B + 10 s)` with no SNA range and again with range [79.5, 80.5], `buckets(meta-a/Spd.V, B, B + 10 s, 5 s)`, `before(meta-a/Spd.V, B + 4.5 s)`, `after(meta-a/Spd.V, B + 6.5 s)`, `stateChanges(meta-a/Gear.POS, text, 100)`, and an adapter without `snaTexts` runs the first `raw`
- **THEN** the first `raw` gives values 0, 10, 20, null, null, 50, 60, null, 80, 90; with the range also n = 8 is null; the buckets are B (count 3, sna 2, mean 10, min 0, max 20) and B + 5 s (count 4, sna 1, mean 70, min 50, max 90); `before` gives B + 4 s with value null, `after` B + 7 s with value null; `stateChanges` gives exactly P at B, D at B + 10 s (prev P at B) and R at B + 30 s (prev D at B + 10 s); without `snaTexts` `raw` gives 255, 255 and 254 at n = 3, 4, 7
- **Evidence:** `apps/server/test/adx.test.ts` › "treats SNA texts as SNA in every value query"

#### Scenario: Native series with sentinels answers as the fallback does
- **WHEN** on the seeded emulator `querySeries` runs for `meta-a/Spd.V` over [B, B + 10 s) with target 100 (raw path) and target 4 (bucket path), once over `completeSource(adapter)` and once over `completeSource(coreOnly(adapter))`, the adapter on `KMeta` with `snaTexts: ["SNA", "INVLD"]`
- **THEN** both give the same `SeriesResult` serialized to JSON; the raw one has `v` `[0,10,20,null,null,50,60,null,80,90]`, the bucket one SNA counts summing to 3
- **Evidence:** `apps/server/test/adx.test.ts` › "answers KMeta series requests as the fallback does"

#### Scenario: Server on the emulator
- **WHEN** the lead starts a second server as in `docs/data-sources.md` "Try it on the emulator" plus `KIPSCOPE_TABLE=KMeta`, `KIPSCOPE_COLUMN_UNIT=unit`, `KIPSCOPE_SNA_TEXTS=SNA,INVLD`, then runs `curl -s localhost:7311/api/catalog | jq -c '[.items[] | [.id, .unit, .states]]'` and `curl -s 'localhost:7311/api/series?signal=meta-a/Spd.V&from=2026-10-05T00:00:00Z&to=2026-10-05T00:00:10Z' | jq -c '.v'`
- **THEN** the first prints `[["meta-a/Flag.ERR",null,null],["meta-a/Gear.POS",null,"text"],["meta-a/Spd.V","km/h",null],["meta-b/Spd.V","mph",null]]`, the second `[0,10,20,null,null,50,60,null,80,90]`
- **Evidence:** lead's check: the commands and their output

### Requirement: Computed series in one ADX query
The ADX adapter's `computedSeries` SHALL answer an unchunked request with exactly one KQL query that also counts the inputs' rows in `[from, to)`: rows when the count is at most `target`, else buckets of the exact rows on the floor grid. The query SHALL hold no `join`, `lookup` or `materialize`. Origin: D-111 („one KQL query per chunk"); count in the same query: D-097 (one round trip per series request, no native `count`).

#### Scenario: One query per answer
- **WHEN** an ADX adapter on a fake Kusto client runs `computedSeries` of `Lin.RAMP - Sna.CODE + Beat.HB` on `conf-a`, no hold limits, target 10. The fake answers once a count row of 5 with five `p` rows out of time order, and once a count row of 50 with three `k` rows out of start order.
- **THEN** each call sends exactly one query.
  - Its text contains `scan declare`, `toscalar(`, `next(` and `s2`. It contains none of `join`, `lookup` and `materialize`.
  - The first answer is `raw` with the five points in time order.
  - The second is `buckets` sorted by start.
  - A fake answer without a count row rejects with `the computed query returned no count`.
- **Evidence:** `apps/server/test/adxQueries.test.ts` › "answers a computed series with one query"

#### Scenario: Same rows on the emulator
- **WHEN** `pnpm --filter @kipscope/server test:adx` runs against the seeded emulator
- **THEN** every computed conformance case passes in `adx native` (now the native query) and in `adx core only`, with the values of computed-signals: "computes a difference per row with edges", "computes one input per row", "computes three inputs per row", "computes SNA from either input", "gives SNA for non-finite results", "keeps SNA through min and max", "holds an input only within its hold limit", "gives no rows while an input has no data", "buckets computed rows exactly" and "computes at shared times"
- **Evidence:** the command's output (tester's report: computed case count per run)

### Requirement: ADX computed query from the parsed formula
The ADX computed query SHALL be built from the parsed formula only: signal names, formula constants, seeds and hold limits as query parameters (design K-7, K-8), the inputs (1 to 8) read with one `signal in (s0, …)` filter. No text of the request reaches the query. Origin: D-111 („never user text in a query"); computed-signals "Formula text never reaches a query"; up to 8 inputs: D-106.

#### Scenario: Constants, names and seeds as parameters
- **WHEN** the fake-client adapter builds the query of `Lin.RAMP * 2.5 + min(Sna.CODE, 1e3)`, where `Lin.RAMP` has the seed {B − 10 ms, 5} and no hold limit, and `Sna.CODE` the seed {B − 1 s, null} and a hold limit of 500 ms. It then builds `abs("it's \"q\"")`, one input named `it's "q"` without a seed.
- **THEN** the first text contains `k0`, `k1`, `s0` and `s1`, and neither `2.5`, `Lin.RAMP` nor `Sna.CODE`. Its parameters hold:
  - `k0` real 2.5, `k1` real 1000
  - `s0` string `Lin.RAMP`, `s1` string `Sna.CODE`
  - `sv0` real 5, `ss0` long 0, `st0` long B − 10 ms
  - `ss1` long 1, `st1` long B − 1 s
  - `h0` long 9,223,372,036,854,775,807 and `h1` long 500,000,000

  The second text does not contain `it's`. Its parameters hold `s0` = `it's "q"` and no `sv0`, `ss0` or `st0`.
- **Evidence:** `apps/server/test/adxQueries.test.ts` › "compiles constants, names and seeds as parameters"

### Requirement: ADX computed rows
The ADX computed query SHALL carry each input's last value and time forward with one `scan` (seeds as rows before `from`), keep only rows where every input is held and only the last row per time, fold SNA (DBC ranges, SNA texts) into the value as NaN, and give SNA for a non-finite result or an SNA or NaN `min`/`max` argument (design K-1 … K-5). Origin: D-111; `scan`: D-102; `min`/`max`: emulator probe (design Context) with D-109.

#### Scenario: SNA from row texts
- **WHEN** on the seeded emulator an adapter on `KMeta` with `snaTexts: ["SNA", "INVLD"]` runs `computedSeries` of `Spd.V - Flag.ERR` on `meta-a` over [B, B + 10 s), no seeds or hold limits: once with target 1000, once with target 5 and width 5 s. Each runs over `completeSource(adapter)` and over `completeSource(coreOnly(adapter))`.
- **THEN** native and core-only answers are deep-equal.
  - The first is raw with 10 points at B + n s, values 0, 9, null, null, null, 50, 60, null, 80, 90. At n = 2 `Flag.ERR` has the text `SNA`, at n = 3, 4 and 7 `Spd.V` has `SNA` or `INVLD`, and from n = 5 `Flag.ERR` is held at 0.
  - The second is buckets B (count 2, sna 3, mean 4.5, min 0, max 9) and B + 5 s (count 4, sna 1, mean 70, min 50, max 90).
- **Evidence:** `apps/server/test/computed.adx.test.ts` › "computes SNA from row texts natively"

### Requirement: Chunked computed scan on ADX
The ADX adapter SHALL split a computed bucket answer into k = min(3, ceil(count / 1,000,000), nb) chunks at bucket starts when the formula has several inputs, every input has a finite hold limit, the range spans nb ≥ 2 buckets and the count exceeds 1,000,000 and `target`: the first query answers only the count, then the chunks run in parallel, each in its own queue slot, under one abort. Origin: D-111; D-110; k and threshold: design Q-1, Q-2.

#### Scenario: Chunk queries
- **WHEN** the fake-client ADX adapter with `computedChunkRows` 1,000 answers a buckets request of `Lin.RAMP - Sna.CODE + Beat.HB` on `conf-a` over [B, B + 100 s), target 100, width 1 s, hold limits 15 ms each, with seeds for all three inputs. Its first query is answered with a count row of 5,000 and nothing else. Then the same request runs four more times:
  - with no hold limit on `Beat.HB`
  - with a count row of 50 (raw)
  - with the default `computedChunkRows`
  - with a hold limit of 40 s on `Beat.HB`
- **THEN** the first request sends 4 queries with one identical text.
  - Query 1 has `lim` 100, `cr` 1,000, `cs` B.
  - Queries 2–4 have `lim` −1, `cr` 9,223,372,036,854,775,807 and `cs` B, B + 33 s, B + 66 s. Their `t0` is B, B + 33 s − 15 ms, B + 66 s − 15 ms, and their `t1` is B + 33 s, B + 66 s, B + 100 s. Each carries the `sv<i>`/`ss<i>`/`st<i>` of query 1.
  - The answer is the chunks' buckets in chunk order.
  - The next three requests send one query each. In the first of them `cr` is 9,223,372,036,854,775,807, in the third it is 1,000,000.
  - With the 40 s hold limit the 2nd chunk has `t0` = B.
- **Evidence:** `apps/server/test/adxQueries.test.ts` › "splits a large computed bucket scan into chunks"

#### Scenario: Each chunk takes a queue slot
- **WHEN** the adapter of "Chunk queries" (first request) is wrapped by `queuedAdapter` with a `QueryQueue(8)` and `computedSeries` runs through the wrapper
- **THEN** the queue's `run` is called 4 times (the count query and 3 chunks), never once for the whole call
- **Evidence:** `apps/server/test/adxQueries.test.ts` › "queues each computed ADX query, not the whole call"

#### Scenario: A failing chunk stops the others
- **WHEN** the fake of "Chunk queries" (first request) throws `Error("chunk failed")` on the chunk with `cs` B + 33 s and leaves the other chunk queries pending until their abort signal fires
- **THEN** the call rejects with that error, and the abort signals of the other two chunk queries are aborted
- **Evidence:** `apps/server/test/adxQueries.test.ts` › "aborts the other chunks when one fails"

### Requirement: ADX chunks read a bounded lookback
Every ADX chunk after the first SHALL read its inputs from max(`chunkStart − L`, `from`), with L the largest hold limit, keep only rows at `chunkStart` or later, and carry the request's seeds. The answer SHALL equal the unchunked one. Origin: D-110 (lookback by the largest hold limit, results identical); never before `from`: D-078 (speed-up-computed C-3).

#### Scenario: Chunked buckets equal unchunked ones
- **WHEN** on the seeded emulator an ADX adapter with `computedChunkRows` 100 and one with the default each answer `Lin.RAMP - Sna.CODE` on `conf-a` over [B, B + 100 s), target 100:
  - (a) with hold limits 30 ms for `Lin.RAMP` and 3 s for `Sna.CODE`, width 10 s (3 chunks split at B + 30 s and B + 60 s)
  - (b) with hold limits 30 ms for `Lin.RAMP` and 500 ms for `Sna.CODE`, width 1 s (split at B + 33 s and B + 66 s)
  - (c) with the hold limits of (b) and width 2.5 s. The first split is at B + 32.5 s, between the `Sna.CODE` rows at B + 32 s and B + 33 s, and that chunk's lookback starts exactly at the row at B + 32 s.
- **THEN** in each case both answers are deep-equal bucket arrays.
  - (a) has the values of computed-signals "Ten buckets of 10 s".
  - In (b), bucket B + 33 s has count 51 and sna 0, and bucket B + 45 s has count 0 and sna 51.
  - In (c), bucket B + 32.5 s has count 103 and sna 0.
- **Evidence:** `apps/server/test/computed.adx.test.ts` › "chunked buckets equal unchunked ones"

#### Scenario: Lookback stays inside the request
- **WHEN** on the seeded emulator, through a Kusto client that records each query's parameters, the two adapters of "Chunked buckets equal unchunked ones" answer `Lin.RAMP - Sna.CODE` on `conf-a` over [B + 20 s, B + 50 s). Target 100, width 1 s, hold limits 15 s for `Sna.CODE` and 30 ms for `Lin.RAMP`, 3 chunks split at B + 30 s and B + 40 s, so c_1 − L = B + 15 s lies before `from`.
- **THEN** both answers are deep-equal, and bucket B + 45 s has count 0 and sna 100. No query has a `t0` before B + 20 s: the 2nd chunk's `t0` is B + 20 s, the 3rd chunk's B + 25 s.
- **Evidence:** `apps/server/test/computed.adx.test.ts` › "keeps the lookback inside the request"
