## MODIFIED Requirements

### Requirement: ADX configuration
With `KIPSCOPE_SOURCE=adx` the server SHALL read `KIPSCOPE_ADX_CLUSTER` (required; `https://`, or `http://` only for a loopback host), exactly one of `KIPSCOPE_ADX_DATABASE` (one name) and `KIPSCOPE_ADX_DATABASES` (a comma list of 1 or more distinct names, trimmed, blanks dropped), and `KIPSCOPE_ADX_AUTH` (`azcli`, default, or `none` only for a loopback cluster). Today's table and column variables SHALL map the layout for every database, with the neutral ADX defaults of design C5. Origin: Jan (2026-10-17) „ADX via az login"; the lead's brief (no smart451 names in the ADX layout); D-005; Jan (2026-11-06) „wir müssen mit mehreren Datenbanken umgehen können".

#### Scenario: Defaults and checks
- **WHEN** `loadConfig` runs with `KIPSCOPE_SOURCE=adx`, `KIPSCOPE_ADX_CLUSTER=https://help.kusto.windows.net`, `KIPSCOPE_ADX_DATABASE=Samples`; then with `KIPSCOPE_ADX_CLUSTER=http://10.0.0.5:8080`; then with `KIPSCOPE_ADX_AUTH=none` and the https cluster; then with `KIPSCOPE_ADX_AUTH=none` and `http://127.0.0.1:8125`
- **THEN** the first gives auth `azcli`, table `signals` with columns `dataref`, `signal`, `timestamp`, `value`, `text` and events table `events`; the second throws naming `KIPSCOPE_ADX_CLUSTER` (http only for loopback); the third throws naming `KIPSCOPE_ADX_AUTH` (`none` only for a loopback cluster); the fourth gives auth `none`
- **Evidence:** `apps/server/test/config.test.ts` › "reads the ADX settings"

#### Scenario: ClickHouse defaults unchanged
- **WHEN** `loadConfig` runs with only `CLICKHOUSE_URL` set
- **THEN** the mapping is database `sdlog`, table `signals`, columns `vehicle`, `signal`, `utc`, `value`, `text`, events table `events`, as before this change
- **Evidence:** `apps/server/test/config.test.ts` › "selects the source"

#### Scenario: The database list
- **WHEN** `loadConfig` runs with the ADX variables and `KIPSCOPE_ADX_DATABASES= prod, test ,,prod`; then with `KIPSCOPE_ADX_DATABASES=prod,test`; then with both `KIPSCOPE_ADX_DATABASE=prod` and `KIPSCOPE_ADX_DATABASES=prod,test`; then with neither; then with `KIPSCOPE_ADX_DATABASES=prod,bad:name`; then with `KIPSCOPE_SOURCE=clickhouse` and `KIPSCOPE_ADX_DATABASES=prod,test`
- **THEN** the first throws naming `KIPSCOPE_ADX_DATABASES` (repeated name `prod`); the second gives databases `["prod", "test"]`; the third and fourth throw naming `KIPSCOPE_ADX_DATABASE` and `KIPSCOPE_ADX_DATABASES` (exactly one of the two); the fifth throws naming the invalid name (a database name holds no `:`); the sixth ignores the ADX variable as it does the others
- **Evidence:** `apps/server/test/config.test.ts` › "reads the ADX database list"

## ADDED Requirements

### Requirement: Data refs name their database
With two or more configured databases every data ref SHALL be qualified, `<database>:<ref>` (split at the first `:`; database names hold no `:`), in signal IDs, scopes, grants, views, links and handoff catalogs alike. With exactly one database a data ref SHALL stay bare. A bare ref with two or more databases, or a qualified ref whose database is not configured, SHALL be refused with `unknown_database` (400) naming the form `<database>:<ref>` and the configured databases.

#### Scenario: Qualified and bare refs
- **WHEN** two databases `prod` and `test` are configured and `listSignals` runs unscoped, with the scope `{dataRef: "test:car1", …}`, with `{dataRef: "car1", …}` and with `{dataRef: "dev:car1", …}`
- **THEN** the first lists signals whose IDs are `prod:<ref>/<name>` or `test:<ref>/<name>`; the second lists only the signals of `car1` in `test`, with IDs `test:car1/<name>`; the third and fourth throw `unknown_database`, the third naming `prod:car1` and the fourth listing `prod, test`
- **Evidence:** `apps/server/test/adxRouter.test.ts` › "qualifies data refs by database"

#### Scenario: One database keeps bare refs
- **WHEN** one database `prod` is configured via `KIPSCOPE_ADX_DATABASE`, and again via `KIPSCOPE_ADX_DATABASES=prod`
- **THEN** both list signals as `<ref>/<name>`, ask the source for `{dataRef: "car1"}` unchanged and refuse `prod:car1` as a data ref that does not exist in the table
- **Evidence:** `apps/server/test/adxRouter.test.ts` › "does not qualify with one database"

### Requirement: Each call goes to its own database
Every call that names a data ref (a scope, a `SignalRef`, `refBuckets`, `events` and the rest of the contract) SHALL be answered by the database in that ref, with the bare ref in the query; a result that carries a data ref SHALL carry the qualified one. Queries of different databases SHALL share the server's one query queue (`KIPSCOPE_QUERY_CONCURRENCY`), and a database that fails SHALL fail only the calls that need it.

#### Scenario: Routing
- **WHEN** fake Kusto clients for `prod` and `test` are behind the adapter, and `raw` runs for `test:car1/X`, `series` for `prod:car2/Y`, and `events` with the scope `test:car1`
- **THEN** the `test` client got the raw and events queries with the parameter `sref = car1`, the `prod` client got the series query with `sref = car2`, and neither client got the other's query
- **Evidence:** `apps/server/test/adxRouter.test.ts` › "sends each call to the database of its data ref"

#### Scenario: One database down
- **WHEN** the `test` client fails every query and `listSignals` runs unscoped, then with the scope `prod:car2`
- **THEN** the first fails and its message names the database `test`; the second succeeds and sends no query to `test`
- **Evidence:** `apps/server/test/adxRouter.test.ts` › "a failing database fails only its calls"

#### Scenario: Shared queue
- **WHEN** `KIPSCOPE_QUERY_CONCURRENCY=2` and 6 series requests for 3 signals of `prod` and 3 of `test` are issued at once
- **THEN** at most 2 queries are in flight at any time across both clients
- **Evidence:** `apps/server/test/adxRouter.test.ts` › "one queue for all databases"

### Requirement: Mapping per database
A database MAY override the table and the column names of the shared mapping, and its events table, in the project file `kipscope.yaml` under `adx.databases.<database>`; everything it leaves out SHALL come from the shared variables. A name there that is not in the database list SHALL be a config error.

#### Scenario: Override
- **WHEN** `KIPSCOPE_ADX_DATABASES=prod,test`, `KIPSCOPE_TABLE=signals` and `kipscope.yaml` holds `adx.databases.test.table: Measurements` and `adx.databases.test.columns.time: ts`; then it holds `adx.databases.dev.table: X`
- **THEN** the mapping of `prod` is the shared one; the mapping of `test` has table `Measurements`, time column `ts` and every other column as shared; the second file throws naming `dev`
- **Evidence:** `apps/server/test/config.test.ts` › "maps each database"

### Requirement: Unscoped lists merge all databases
An unscoped signal list (catalog mode `full`) SHALL read every database in parallel and merge the signals; a request that names a scope SHALL read only the scope's database. The catalog's sources of metadata (DBC, diagnostic catalogs, units from the table) SHALL see the qualified data ref and the bare signal name.

#### Scenario: Merge
- **WHEN** `prod` holds `car1/A`, `car1/B` and `test` holds `car1/A`, and the unscoped list loads
- **THEN** the catalog holds `prod:car1/A`, `prod:car1/B` and `test:car1/A` as three distinct signals
- **Evidence:** `apps/server/test/adxRouter.test.ts` › "merges unscoped lists"

### Requirement: Grants name qualified refs
A grant SHALL name data refs exactly as they are written in signal IDs, so with several databases `test:car1` does not cover `prod:car1`, and a grant of the bare `car1` covers nothing.

#### Scenario: Same ref in two databases
- **WHEN** alice's workspace is granted `prod:car1` and she reads `/api/series` for `prod:car1/A`, for `test:car1/A` and for `car1/A`
- **THEN** the first answers 200, the second and the third answer 403 `forbidden_data` with bodies equal after replacing the ref
- **Evidence:** `apps/server/test/rights.test.ts` › "covers qualified data refs by grant"

### Requirement: Source info lists the databases
`SourceInfo` and the `source` of `/api/meta` SHALL list the databases (`databases`, in configuration order); `database` SHALL be their names joined by `, `. The footer's source item and the start log SHALL show that text. The calendar day cache SHALL be written and checked per set of databases, so a file written for other databases is ignored with the existing "written for source …" message.

#### Scenario: Meta
- **WHEN** `/api/meta` is read with `KIPSCOPE_ADX_DATABASES=prod,test`, then with `KIPSCOPE_ADX_DATABASE=prod`
- **THEN** `source.databases` is `["prod", "test"]` and `source.database` is `prod, test`; then `["prod"]` and `prod`
- **Evidence:** `apps/server/test/meta.http.test.ts` › "names every database"

### Requirement: Conformance over two databases
The ADX conformance suite SHALL also run through the router with two databases that hold the fixture under different qualified refs, and every answer SHALL equal that of one database with the bare ref after stripping the qualifier.

#### Scenario: Same answers
- **WHEN** the conformance suite runs on the emulator with a router over databases `conf` and `conf2`, each holding the fixture
- **THEN** every case passes for `conf:conf-a` and for `conf2:conf-a`
- **Evidence:** `apps/server/test/conformance/adx-databases.conformance.test.ts`
