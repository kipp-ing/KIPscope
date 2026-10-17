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
A missing events table SHALL mean no events (`events` answers "no table"), and a missing text column SHALL mean no text signals; any other error SHALL fail. Origin: events "Events source"; ClickHouse does the same (design E4 of `add-events`).

#### Scenario: Missing table and column
- **WHEN** the ADX adapter runs on the emulator with `KIPSCOPE_EVENTS_TABLE=nope`, and with `KIPSCOPE_COLUMN_TEXT=nope`
- **THEN** `events(conf-a, 100)` answers "no table" and `listSignals` answers the 8 signals all with `text` false
- **Evidence:** `apps/server/test/adx.test.ts` › "treats a missing events table and text column as none"

### Requirement: Aborts cancel ADX queries
An aborted request SHALL close the HTTP request of its running query, which makes ADX cancel it, and SHALL send nothing else. Origin: D-011 (D7: aborts cancel server-side); data fact: the emulator lists a query whose client disconnected after 1 s as `Cancelled`, `E_QUERY_CANCELLED`, duration 1.0 s (it runs 5.9 s otherwise).

#### Scenario: Cancelled on abort
- **WHEN** a slow query (`range i from 1 to 3000000000 step 1 | summarize sum(i % 7)`) runs through the Kusto client with client request ID `KIPscope.test;<uuid>` and is aborted after 1 s
- **THEN** it rejects with the abort reason within 100 ms, and `.show queries` on the emulator lists that ID as `Cancelled` with a duration under 2 s
- **Evidence:** `apps/server/test/adx.test.ts` › "cancels a query on abort"

### Requirement: ADX query limits
Every query SHALL carry `servertimeout` = `KIPSCOPE_QUERY_TIMEOUT_S`, a client request ID `KIPscope.query;<uuid>` and the app name `KIPscope`, and SHALL pass all values as query parameters (strings, datetimes, longs, dynamic arrays) or as numbers the adapter wrote itself. Origin: series-query "Bounded database load"; D-046 spirit (no value from a request reaches query text).

#### Scenario: Request shape
- **WHEN** the Kusto client sends `raw` for signal `it's "q"` with a fake fetch
- **THEN** the body has `db`, a `csl` starting `declare query_parameters(`, `properties.Options.servertimeout` `00:00:30`, and `properties.Parameters.sig` equal to `it's "q"`; the headers hold `x-ms-app: KIPscope` and an `x-ms-client-request-id` starting `KIPscope.query;`
- **Evidence:** `apps/server/test/kusto.test.ts` › "sends parameters and limits"

### Requirement: ADX passes the conformance suite
The ADX adapter SHALL pass the whole conformance suite against the emulator, natively and core only. It SHALL implement `refCount`, `loggerGaps`, `stateChanges` and `events` natively and use the server's fallbacks for `count`, `extent`, `refExtent` and `firstTimes` (design C6, measured). Origin: data-source "One conformance suite"; the lead's brief (factor-of-two rule on the measured costs).

#### Scenario: Emulator run
- **WHEN** `docker compose --profile adx up -d`, `pnpm --filter @kipscope/server seed:adx` and `pnpm --filter @kipscope/server test:adx` run
- **THEN** every conformance case passes for `adx native` and `adx core only`, and the ADX adapter object has exactly the methods named above
- **Evidence:** the commands' output; `apps/server/test/adx.test.ts` › "implements the measured fast paths only"

### Requirement: Kusto emulator for tests
`docker-compose.yml` SHALL hold the Kusto emulator under the profile `adx` (loopback port 8125, pinned image, volume), so `docker compose up -d` still starts only ClickHouse. `seed:adx` SHALL put the conformance fixture into database `kipscope_test` (default layout) and refuse a non-loopback `TEST_ADX_URL`; `test:adx` SHALL fail with one message naming both commands when the emulator is missing or unseeded. Origin: Jan (2026-10-17) „Not yet, emulate"; A-3 (a); D-007.

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
