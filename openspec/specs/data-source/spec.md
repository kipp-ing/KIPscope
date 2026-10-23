# data-source Specification

## Purpose
The contract between KIPscope's server and a time-series source: what a source holds, the few methods an adapter must implement, the optional fast paths the server can compute itself, the capabilities a source may lack, and the one conformance suite every adapter passes.

## Requirements

### Requirement: Source data model
A source SHALL be read as rows of (data ref, signal name, time, value, text) plus optional event rows (data ref, time, source, kind, name, value, text, detail). A signal's ID SHALL be `<dataRef>/<name>`, with a non-empty data ref without `/` and a non-empty name; the catalog SHALL skip other listed entries with one warning per load. Origin: signal-catalog "Signal identity"; concept §3.

#### Scenario: Data refs that would break IDs
- **WHEN** a stub adapter lists `{dataRef: "a/b", name: "X"}`, `{dataRef: "", name: "Y"}`, `{dataRef: "ok", name: ""}` and `{dataRef: "ok", name: "Z"}` and the catalog loads twice
- **THEN** the catalog holds only `ok/Z`, and the server logged one warning per load naming the three skipped entries
- **Evidence:** `apps/server/test/catalog.test.ts` › "skips listed signals whose data ref or name would break the ID"

### Requirement: Times and values
Times SHALL be int64 nanoseconds since 1970-01-01T00:00:00Z (UTC), exact to the source's own resolution, and SHALL cross every boundary as `bigint` or decimal strings; values are 64-bit floats; text is a string, empty when the row has none. Rows without a time SHALL never appear in any answer. Origin: concept §3 (Originalpräzision); D-011 (int64 ns); series-query "Points without timestamp excluded".

#### Scenario: Rows without time
- **WHEN** the conformance fixture's row of `conf-a/Lin.RAMP` with a null time (value −1) exists in the source, and `raw`, `count`, `extent`, `refExtent` and `firstTimes` are asked for `conf-a`
- **THEN** no answer contains value −1, `count` over all time is 10,000 and `refExtent(conf-a).count` is 17,069
- **Evidence:** conformance suite › "never returns rows without a time" (run by `apps/server/test/conformance/clickhouse.conformance.test.ts` and `adx.conformance.test.ts`, each native and core only)

#### Scenario: Exact times
- **WHEN** `raw(conf-a/Fine.NS)` over all time, `before(conf-a/Fine.NS, B + 123,456,701 ns)` and `after(conf-a/Fine.NS, B + 123,456,701 ns)` run (B = 2026-10-05T00:00:00Z = 1791158400000000000)
- **THEN** `raw` returns 1,000 points at exactly B + 123,456,700 + k·1,100 ns (k = 0 … 999) with value k; `before` gives k = 0 and `after` gives k = 1 (B + 123,457,800)
- **Evidence:** conformance suite › "keeps times exact"

### Requirement: Required source methods
Every adapter SHALL implement `ping`, `listSignals`, `raw`, `before`, `after`, `buckets` and `refBuckets` and expose `info` (kind, database, table, events table label), with the signatures of design C1 of `add-adx-source` as extended by design Z1 of `add-scope` (`listSignals`, `before`, `after` and `refBuckets` take an optional `scope` before `abort`). `listSignals` SHALL flag each signal whose rows carry text. Origin: D-006 („ADX follows behind the same adapter interface"); Jan (2026-10-17) „the interfaces shall be lean and documented"; scope: D-078, issue #1 item 1.

#### Scenario: Signal list
- **WHEN** `listSignals` runs on the conformance tables
- **THEN** it returns exactly `conf-a` `Beat.HB`, `Diag.door`, `Fine.NS`, `Lin.RAMP`, `Sna.CODE`, `State.MODE` and `conf-b` `Lin.RAMP`, `Span.FAR`, with `text` true only for `conf-a/Diag.door`
- **Evidence:** conformance suite › "lists signals with their text flag"

#### Scenario: Unknown signal
- **WHEN** `raw`, `buckets`, `before`, `after` and `count` run for `conf-a/Nope.X`
- **THEN** they answer `[]`, `[]`, nothing, nothing and 0, never an error
- **Evidence:** conformance suite › "answers empty for an unknown signal"

### Requirement: Ranges, order and limits
Ranges SHALL be half-open `[from, to)` and points SHALL come in ascending time order; `raw` with a limit SHALL return the earliest `limit` points of the range; `before(t)` SHALL be the last point strictly before `t` and `after(t)` the first at or after `t`. Origin: series-query "Raw points", "Edge neighbors"; design C1.

#### Scenario: Half-open ranges and order
- **WHEN** `raw(conf-a/Lin.RAMP, B + 1 s, B + 2 s)` runs
- **THEN** it returns 100 points in ascending time, the first at B + 1 s with value 100, the last at B + 1.99 s with value 199; the point at B + 2 s is not included
- **Evidence:** conformance suite › "reads raw points in a half-open range"

#### Scenario: Limit
- **WHEN** `raw(conf-a/Lin.RAMP, TIME_MIN, TIME_MAX, limit 1001)` runs
- **THEN** it returns exactly 1,001 points, B … B + 10 s, ascending
- **Evidence:** conformance suite › "limits raw to the earliest points"

#### Scenario: Neighbours
- **WHEN** `before` and `after` run on `conf-a/Lin.RAMP` at B + 1 s, `before` at B and `after` at B + 100 s
- **THEN** they give B + 0.99 s (value 99), B + 1 s (value 100), nothing and nothing
- **Evidence:** conformance suite › "finds the neighbours before and after"

### Requirement: Buckets and SNA
`buckets` SHALL return the non-empty buckets on the floor grid `k · width` (also before 1970) ordered by start, with valid count, SNA count, and mean, min and max over valid points (null iff the valid count is 0); values within the reference's SNA ranges SHALL be reported as null. `refBuckets` SHALL return the non-empty buckets of all timestamped rows of a data ref, with each bucket's first and last row time when asked. Origin: series-query "Aggregated buckets", "SNA matching"; data-gaps.

#### Scenario: Buckets on the floor grid
- **WHEN** `buckets(conf-a/Lin.RAMP, B + 0.5 s, B + 2.5 s, 1 s)` and `buckets(conf-b/Span.FAR, −2 s, 1 s, 1 s)` run
- **THEN** the first gives starts B, B + 1 s, B + 2 s with counts 50, 100, 50, means 74.5, 149.5, 224.5, minima 50, 100, 200 and maxima 99, 199, 249; the second starts −2,000,000,000 (value 1) and 0 (value 2)
- **Evidence:** conformance suite › "aggregates buckets on the floor grid", "floors bucket starts before 1970"

#### Scenario: SNA
- **WHEN** `raw(conf-a/Sna.CODE)` over all time and `buckets(conf-a/Sna.CODE, B, B + 100 s, 10 s)` run with SNA range [6.5, 7.5], and `before(conf-a/Sna.CODE, B + 45 s)` with the same range
- **THEN** `raw` gives 100 points whose value is null exactly for n = 40 … 49; the bucket at B + 40 s has count 0, sna 10 and null mean, min and max, the other nine count 10, sna 0, mean 2, min 0, max 4; `before` gives B + 44 s with value null
- **Evidence:** conformance suite › "reports SNA as null and in bucket counts"

#### Scenario: Row buckets of a data ref
- **WHEN** `refBuckets(conf-a, 60 s, times)` runs
- **THEN** it returns 10 buckets whose counts sum to 17,069; the bucket at B + 180 s holds 202 rows from B + 180 s to B + 200 s and the one at B + 240 s 401 rows from B + 260 s to B + 299.9 s
- **Evidence:** conformance suite › "counts the rows of a data ref per bucket"

### Requirement: Optional methods fall back
`count`, `extent`, `series`, `refExtent`, `refCount`, `loggerGaps`, `firstTimes` and `stateChanges` SHALL be optional. When an adapter leaves one out, the server SHALL compute it from the required methods (design C2; `series` also from `count`, design A2 of speed-up-adx) with the same answer as a native one (`refCount`: a count that changes whenever timestamped rows are added). An adapter MAY implement any of them as a faster path. Origin: Jan (2026-10-17) „the interfaces shall be lean"; the lead's brief (fallbacks where possible, capabilities where not); `series`: data-source "Series in one call".

#### Scenario: Same answers natively and from the core
- **WHEN** the conformance suite runs against each adapter twice, once as is and once reduced to its required methods
- **THEN** every case passes in both runs, including "counts points" (`count(conf-a/Lin.RAMP)` 10,000 over all time and 100 in [B + 1 s, B + 2 s)), "finds the extent", "answers a series" (data-source "Series in one call"), "finds the extent and row count of a data ref" (17,069 rows from B to B + 599.9 s; `refCount` 17,069 or 17,070), "finds logger gaps" (conf-a: B + 200 s → B + 260 s and B + 500 s → B + 502 s, last B + 599.9 s; not the 1.9 s silence at B + 400 s; conf-b: −1.5 s → 0.5 s and 0.5 s → B, last B + 9 s), "samples the first times" (`Lin.RAMP` 1,001 times from B, `Sna.CODE` 100, an unknown name absent) and "finds state changes" (`State.MODE` with labels 0 and 3: B → 0, B + 10 s → 3 after 0 at B + 9.9 s, B + 40 s → 0 after 3 at B + 39.9 s; the SNA run in between is no change; with limit 2 the first two; `Diag.door` by text: closed at B, open at B + 180 s after closed at B + 90 s, closed at B + 360 s after open at B + 270 s)
- **Evidence:** `apps/server/test/conformance/clickhouse.conformance.test.ts`, `adx.conformance.test.ts` (each `native` and `core only`)

#### Scenario: No query for no names
- **WHEN** `firstTimes(conf-a, [], 1001)` runs through the fallback and through each native path, with a wrapper counting source queries
- **THEN** it answers an empty map and no query was sent
- **Evidence:** conformance suite › "samples the first times"; `apps/server/test/fallbacks.test.ts` › "sends no query for an empty name list"

### Requirement: Sources without events
`events` SHALL be a capability: an adapter without it, or one that reports its events table missing, gives every data ref no events, and the server logs one warning per catalog load naming the source's events table label. Event rows SHALL come in time order, ties by kind, source and name, at most `limit` of them. Origin: events "Events source" (a missing table means no events); the lead's brief („events table absent → no events").

#### Scenario: Event order and limit
- **WHEN** `events(conf-a, 100)`, `events(conf-a, 2)` and `events(conf-b, 100)` run
- **THEN** the first gives exactly 5 rows: `Diag.door` closed at B, `Diag.door` open at B + 180 s, then at B + 300 s dtc BMS `P0AA100`, dtc BMS `P0CA700`, nrc BMS `SID 22`; the second its first two; the third none; the row without a time never appears
- **Evidence:** conformance suite › "lists events in order"

#### Scenario: Adapter without events
- **WHEN** a test app runs on an adapter without `events` and `GET /api/events?dataRef=conf-a` is sent twice
- **THEN** both answer 200 with `total` 0, and one warning was logged
- **Evidence:** `apps/server/test/fallbacks.test.ts` › "treats a source without events as one without an events table"

### Requirement: Fallback queries are bounded
Every source query a fallback sends SHALL pass the query queue (series-query "Bounded database load") and SHALL carry the caller's abort signal; an aborted caller SHALL get its abort reason and cause no further queries. Origin: series-query "Bounded database load"; D-011 (D7: at most 4 concurrent queries, aborts cancel).

#### Scenario: Queue holds for a fallback fan-out
- **WHEN** a stub adapter with only the required methods sits behind a queue of limit 2, and `firstTimes` for 50 names runs
- **THEN** the stub never sees more than 2 concurrent `raw` calls (queue `peak` 2) and gets 50 calls in all
- **Evidence:** `apps/server/test/fallbacks.test.ts` › "sends fallback queries through the queue"

#### Scenario: Abort stops a fallback
- **WHEN** `firstTimes` for 50 names runs through the fallback on a stub whose `raw` takes 50 ms, behind a queue of limit 2, and its abort signal fires after the first two calls started
- **THEN** the call rejects with the abort reason and the stub received at most 2 calls
- **Evidence:** `apps/server/test/fallbacks.test.ts` › "stops a fallback on abort"

### Requirement: State-change fallback stops on long signals
The `stateChanges` fallback SHALL read the signal in pages of `STATE_SCAN_PAGE` (100,000) points and stop after `STATE_SCAN_MAX` (5,000,000) points; such a signal SHALL be skipped as `too_many_changes`, with one warning per catalog load naming the signal and saying that the adapter should implement `stateChanges`. Origin: necessary consequence of the fallback (a 100 Hz state signal over 5 days holds ~43 M rows); server memory per D-007 (carserver 2 GB).

#### Scenario: Scan cap
- **WHEN** a stub adapter without `stateChanges` holds a state signal with 5,000,001 points of one value and the events-line signal is loaded
- **THEN** the signal is skipped with reason `too_many_changes`, the stub was asked for at most 50 pages, and the warning names the signal and `stateChanges`
- **Evidence:** `apps/server/test/fallbacks.test.ts` › "stops the state-change scan after 5,000,000 points"

### Requirement: ClickHouse answers as before
The ClickHouse adapter SHALL implement every optional method natively except `series`, which it takes from the server's fallback, and SHALL send the same queries as before this change for every existing path (density, gaps, events, series, values, catalog); `raw` without a limit and `refBuckets` without row times SHALL be unchanged. Origin: the lead's brief („Keep ClickHouse behaviour and performance unchanged"); D-007; D-074 („ClickHouse keeps all 15 methods and its queries unchanged"); `series` from the fallback: speed-up-adx design A2 (the fallback sends exactly the `count`, `raw`, `before`, `after` and `buckets` calls of today).

#### Scenario: Existing suite
- **WHEN** `pnpm --filter @kipscope/server test` runs against the seeded test DB
- **THEN** every existing test passes with unchanged expected values
- **Evidence:** the command's output

#### Scenario: Density query unchanged
- **WHEN** the density of `drivecar` is computed with a client that records query texts
- **THEN** its two queries are the `refExtent` and the counts-only `refBuckets` query of today (no `min`/`max` of the time column)
- **Evidence:** `apps/server/test/density.http.test.ts` › "sends the counts-only bucket query"

#### Scenario: No native series on ClickHouse
- **WHEN** `nativeMethods` runs on the ClickHouse adapter
- **THEN** it lists `count`, `extent`, `refExtent`, `refCount`, `loggerGaps`, `firstTimes`, `stateChanges` and `events`, and not `series`
- **Evidence:** `apps/server/test/fallbacks.test.ts` › "takes series from the fallback on ClickHouse"

### Requirement: Source selection
`KIPSCOPE_SOURCE` SHALL select the server's one source: `clickhouse` (default, the current variables) or `adx` (adx-source "ADX configuration"). An unknown value, or a missing required variable of the selected source, SHALL stop the server with a message naming the variable; variables of the other source are ignored. Origin: Jan (2026-10-17) „ADX via az login"; A-2 (a) one source per server; D-005 (the server holds the adapters and credentials).

#### Scenario: Selecting a source
- **WHEN** `loadConfig` runs with no `KIPSCOPE_SOURCE` and `CLICKHOUSE_URL` set; with `KIPSCOPE_SOURCE=adx` plus cluster and database but no `CLICKHOUSE_URL`; with `KIPSCOPE_SOURCE=adx` without `KIPSCOPE_ADX_CLUSTER`; and with `KIPSCOPE_SOURCE=postgres`
- **THEN** the first gives a ClickHouse source with today's defaults; the second an ADX source; the third throws naming `KIPSCOPE_ADX_CLUSTER`; the fourth throws naming `KIPSCOPE_SOURCE` and the allowed values
- **Evidence:** `apps/server/test/config.test.ts` › "selects the source"

### Requirement: One conformance suite
The repo SHALL hold one conformance suite that checks any adapter against the portable fixture of design C7, seeded into the ClickHouse test DB (`conf_signals`, `conf_events`) and the Kusto emulator. Each adapter's run SHALL include a core-only run. A new adapter SHALL need only an adapter factory and a seed of the fixture. Origin: the lead's brief („one suite … so a third adapter author gets the same suite"); concept §10.

#### Scenario: Suite against both adapters
- **WHEN** `pnpm --filter @kipscope/server test` and `pnpm --filter @kipscope/server test:adx` run with the test DB and the emulator seeded
- **THEN** both report the same case names for `native` and `core only`, all passing
- **Evidence:** the two commands' output (tester's report: case count per run)

#### Scenario: Fixture seeded identically
- **WHEN** the seeds ran and `refExtent` and `listSignals` run on both sources
- **THEN** both give 17,069 rows for `conf-a` and 12 for `conf-b`, and the same 8 signals
- **Evidence:** conformance suite › "holds the fixture"

### Requirement: Adapter guide
The repo SHALL hold `docs/data-sources.md` in English (outline: design C9): the data model, every method with its semantics and whether it is required, optional (with its fallback and measured cost) or a capability, the rules for ranges, order, limits, SNA, errors and aborts, how to run the conformance suite on a new adapter, and a step-by-step "Connect your ADX". Origin: Jan (2026-10-17) „the interfaces shall be lean and documented".

#### Scenario: Guide followed on the emulator
- **WHEN** the lead follows the guide's emulator steps literally (start the profile, seed, set the listed variables, start a second server on port 7311)
- **THEN** `curl -s localhost:7311/api/meta | jq -c '[.source.kind, .source.database, .source.reachable, .catalog.size]'` prints `["adx","kipscope_test",true,8]`
- **Evidence:** lead's check: the steps as run and the `curl` output

### Requirement: Source variables documented
Every configuration variable of the sources SHALL appear in `docs/data-sources.md` and in `.env.example`. Origin: Jan (2026-10-17) „documented"; necessary consequence (an undocumented key cannot be set).

#### Scenario: Variables documented
- **WHEN** a test collects every `KIPSCOPE_*` and `CLICKHOUSE_*` key that `config.ts` reads
- **THEN** each one appears in `docs/data-sources.md` and in `.env.example`
- **Evidence:** `apps/server/test/docs.test.ts` › "documents every source variable"

### Requirement: Scope argument
`listSignals`, `before`, `after`, `refBuckets`, `extent`, `series`, `refExtent`, `refCount`, `loggerGaps`, `firstTimes`, `stateChanges` and `events` SHALL take an optional `scope: Scope {dataRef, from, to}` before `abort` (design Z1). With a scope each SHALL answer exactly as if the source held only the rows of `scope.dataRef` with `from ≤ time < to`; without one, as before. Origin: issue #1 item 1 („Adapters filter by data ref and by time ≥ `from` and < `to`"); D-078; `series`: necessary consequence of "Series in one call" (its edges are `before` and `after` with the scope).

#### Scenario: Signals of a scope
- **WHEN** `listSignals(S)` and `listSignals(S2)` run
- **THEN** the first returns exactly `conf-a/Beat.HB` and `conf-a/Diag.door` with `text` only on `Diag.door`; the second exactly `conf-a` `Beat.HB`, `Lin.RAMP`, `Sna.CODE`, `State.MODE` without text and no `conf-b` entry
- **Evidence:** conformance suite › "lists the signals of a scope"

#### Scenario: Data-ref methods in a scope
- **WHEN** `refExtent(conf-a, S)`, `refCount(conf-a, S)`, `refBuckets(conf-a, 60 s, times, S)`, `loggerGaps(conf-a, 1 s, 2 s, S)`, `loggerGaps(conf-a, 1 s, 2 s, S3)`, `events(conf-a, 100, S)` and `events(conf-a, 100, S2)` run
- **THEN** 503 rows from B + 170 s to B + 279.9 s; 503; buckets B + 120 s (100 rows, B + 170 s … B + 179.9 s), B + 180 s (202, B + 180 s … B + 200 s), B + 240 s (201, B + 260 s … B + 279.9 s); one gap B + 200 s → B + 260 s with last B + 279.9 s; no gap with last B + 279.9 s; one event, `Diag.door` open at B + 180 s; no event
- **Evidence:** conformance suite › "bounds the data-ref methods by a scope"

#### Scenario: Signal methods in a scope
- **WHEN** `extent(Lin.RAMP, S2)`, `extent(Fine.NS, S2)`, `before(Lin.RAMP, B + 5 s, S2)`, `before(Lin.RAMP, B + 40 s, S2)`, `after(Lin.RAMP, B, S2)` and `after(Lin.RAMP, B + 35 s, S2)` run on `conf-a`
- **THEN** B + 5 s … B + 34.99 s; nothing; nothing; B + 34.99 s with value 3,499; B + 5 s with value 500; nothing
- **Evidence:** conformance suite › "bounds the signal methods by a scope"

#### Scenario: First times and state changes in a scope
- **WHEN** `firstTimes(conf-a, [Lin.RAMP, Sna.CODE, Beat.HB, Nope.X], 1001, S2)`, `stateChanges(conf-a/State.MODE, labels 0 and 3, 100, S2)` and `stateChanges(conf-a/Diag.door, text, 100, S)` run
- **THEN** `Lin.RAMP` has 1,001 times from B + 5 s, `Sna.CODE` 30, `Beat.HB` 300, `Nope.X` is absent; the state changes are B + 5 s → 0 and B + 10 s → 3 after 0 at B + 9.9 s and nothing else; `Diag.door` gives one row, open at B + 180 s
- **Evidence:** conformance suite › "samples the first times in a scope", "finds state changes in a scope"

#### Scenario: Series in a scope
- **WHEN** `series` runs as case (f) of "Series natively and from the core"
- **THEN** its edge before B + 5 s is absent although `Lin.RAMP` has a point at B + 4.99 s
- **Evidence:** conformance suite › "answers a series"

#### Scenario: Native and core only, both adapters
- **WHEN** `pnpm --filter @kipscope/server test` and `pnpm --filter @kipscope/server test:adx` run with the test DB and the emulator seeded
- **THEN** the scoped cases above and every existing case pass in `clickhouse native`, `clickhouse core only`, `adx native` and `adx core only`
- **Evidence:** the two commands' output (tester's report: case count per run)

### Requirement: The server keeps calls inside the scope
The server SHALL never pass a scope of another data ref than the method's own, and SHALL send `raw`, `buckets`, `count` and `series` only ranges inside the active scope; in scoped mode the guard SHALL refuse a `series` without a scope or with a range outside every held scope of its data ref, before the source. Origin: necessary consequence of "Scope argument" (`raw`, `buckets` and `count` take no scope, `series` applies its scope to the edges only, and an adapter may ignore `scope.dataRef`).

#### Scenario: Full mode with a scope
- **WHEN** the test server in full mode runs on a recording adapter with scope {testcar, T1, T2} and `/api/series` for `testcar/Fast_100h.SIG_A` over 2026-10-01T00:00Z … 10:00Z, `/api/value` at T1 + 1 s and `/api/extent` are sent
- **THEN** every `raw`, `buckets`, `count` and `series` call has T1 ≤ `from` and `to` ≤ T2, and every other data call carries scope {testcar, T1, T2}
- **Evidence:** `apps/server/test/scope.http.test.ts` › "keeps every call inside the scope in full mode"

#### Scenario: Guard on series
- **WHEN** the scoped-mode guard holds scope {conf-a, B + 5 s, B + 35 s} and `series` is called (1) with that scope over [B + 5 s, B + 6 s), (2) without a scope over the same range, (3) with that scope over [B + 30 s, B + 40 s)
- **THEN** (1) reaches the source; (2) and (3) reject with `ScopeGuardError` and the source sees no call
- **Evidence:** `apps/server/test/scope.test.ts` › "guards series by scope and range"

### Requirement: Fallbacks keep the scope
Every fallback of an optional method SHALL pass its scope to the core methods it calls and SHALL use `scope.from … scope.to` where it used the whole time axis (design Z2). Origin: necessary consequence of "Scope argument" (a core-only adapter would otherwise scan the whole history); issue #1 („the gap info falls back to `firstTimes`").

#### Scenario: Core calls carry the scope
- **WHEN** a recording stub with only the required methods is completed and `extent`, `refExtent`, `refCount`, `loggerGaps`, `firstTimes` (3 names) and `stateChanges` are called with scope {conf-a, B + 5 s, B + 35 s}
- **THEN** every `before`, `after` and `refBuckets` call the stub received carries that scope, and every `raw` call has `from` = B + 5 s and `to` = B + 35 s
- **Evidence:** `apps/server/test/fallbacks.test.ts` › "passes the scope to every core call"

### Requirement: Scoped queries carry both filters
For a call with a scope, the ClickHouse and ADX adapters SHALL send only queries that filter by the scope's data ref and by both of its time bounds (design Z3). Unscoped calls SHALL send the same queries as before this change. Origin: issue #1 acceptance („In scoped mode, no query runs without both a data ref and a time filter"); data-source "ClickHouse answers as before".

#### Scenario: ClickHouse query texts
- **WHEN** a ClickHouse adapter on a client that records query texts and parameters runs every method that takes a scope, once with scope {conf-a, B + 5 s, B + 35 s} and once without
- **THEN** each scoped query filters the data-ref column by `conf-a` and the time column by `>=` B + 5 s and `<` B + 35 s; each unscoped query text equals the one recorded before this change
- **Evidence:** `apps/server/test/clickhouse.scope.test.ts` › "puts the data ref and both time bounds into every scoped query"

#### Scenario: ADX query texts
- **WHEN** an ADX adapter on a fake Kusto client runs every method that takes a scope with that scope
- **THEN** each KQL text applies `where` on the data-ref column `== sref` and on the time column `>= sfrom` and `< sto` to the table (or events table) before any other operator, with `sref`, `sfrom`, `sto` as parameters
- **Evidence:** `apps/server/test/adx.test.ts` › "scopes every query by data ref and time"

### Requirement: Scope in the adapter guide
`docs/data-sources.md` SHALL document the scope: the rule of design Z1 with every method that takes it, the server's guarantees, the fallbacks of Z2, the scoped conformance cases, and the ClickHouse and ADX filter shapes. It SHALL also document `KIPSCOPE_CATALOG` and `KIPSCOPE_SCOPE_PAD`, which `.env.example` SHALL list too. Origin: issue #1 („We'd send the ADX adapter part … once the contract in item 1 is settled"); D-074 („lean and documented").

#### Scenario: Guide names every scoped method
- **WHEN** a test reads `docs/data-sources.md`
- **THEN** its section "Scope" names each of the 12 methods of "Scope argument" and the text `as if the source held only`; the existing "documents every source variable" test passes
- **Evidence:** `apps/server/test/docs.test.ts` › "documents the scope argument", "documents every source variable"

### Requirement: Series in one call
The optional method `series(ref, from, to, target, width, scope)` SHALL answer what a series request needs in one call (design A2): when `[from, to)` holds at most `target` points (counted as `count` counts them, SNA points included), those points as `raw` gives them, plus `before(ref, from, scope)` and `after(ref, to, scope)`; otherwise the non-empty buckets of `buckets(ref, from, to, width)`. Without a native `series`, the server SHALL compute it with exactly today's calls: `count` first, then `raw`, `before` and `after` in parallel, or `buckets`. Origin: data fact (search tool team's report of 2026-10-22, P2: `/api/series` awaits `count` before its data query, two serial ADX round trips of 0.6–8 s each, ×12 per open); Jan's agreement to the lead's cut (2026-10-22, P2); D-074 (a fast path where the fallback costs more than twice: two serial round trips against one).

#### Scenario: Series natively and from the core
- **WHEN** the conformance suite calls `series` on `conf-a` with (a) `Lin.RAMP` over [B + 1 s, B + 2 s), target 100, width 10,204,082 ns; (b) the same with target 99; (c) `Lin.RAMP` over [B, B + 100 s), target 11, width 10 s; (d) `Sna.CODE` with SNA range 6.5 … 7.5 over [B + 40 s, B + 50 s), target 20; (e) `Diag.door` as a text signal over [B + 100 s, B + 200 s), target 10; (f) `Lin.RAMP` over [B + 5 s, B + 6 s), target 100, with scope {conf-a, B + 5 s, B + 35 s}; (g) `Nope.X` over [B, B + 100 s), target 100
- **THEN** (a) is raw with 100 points B + 1 s … B + 1.99 s, values 100 … 199, before {B + 0.99 s, 99}, after {B + 2 s, 200}; (b) is buckets whose counts sum to 100 with SNA 0; (c) is 10 buckets starting B, B + 10 s, … B + 90 s, each count 1,000, SNA 0, mean 1,000·i + 499.5, min 1,000·i, max 1,000·i + 999; (d) is raw with 10 points B + 40 s … B + 49 s, every value null, before {B + 39 s, 4}, after {B + 50 s, 0}; (e) is raw with one point B + 180 s, value 0, text `open`, before {B + 90 s, 0, `closed`}, after {B + 270 s, 0, `open`}; (f) is raw with 100 points from B + 5 s, no before, after {B + 6 s, 600}; (g) is raw with no points and no edges; in `native` and `core only` runs of both adapters
- **Evidence:** conformance suite › "answers a series" (`clickhouse.conformance.test.ts`, `adx.conformance.test.ts`)

#### Scenario: The fallback runs today's calls
- **WHEN** a stub adapter with the required methods and `count` records its calls, and the completed source's `series` runs for a range whose `count` answers 5 with target 10, then for one whose `count` answers 50 with target 10, each with a scope S
- **THEN** the first records `count`, then `raw(ref, from, to)` without a limit, `before(ref, from, S)` and `after(ref, to, S)`, and no `buckets`; the second records `count`, then `buckets(ref, from, to, width)` and nothing else; `count` ended before any other call started
- **Evidence:** `apps/server/test/fallbacks.test.ts` › "computes a series from count, then raw and edges or buckets"

#### Scenario: Unchanged series answers
- **WHEN** `pnpm --filter @kipscope/server test` runs against the seeded test DB
- **THEN** every existing test of `series.test.ts`, `series.http.test.ts` and `series.abort.test.ts` passes with unchanged expected values
- **Evidence:** the command's output

### Requirement: Listed units
`listSignals` MAY report a non-empty unit per listed signal from the source's own rows (with a scope: the scope's rows); an adapter without units SHALL report no field. The `text` flag SHALL count only text that is not an SNA text. The adapter guide SHALL document both and the ADX variables `KIPSCOPE_COLUMN_UNIT` and `KIPSCOPE_SNA_TEXTS` with their rules. Origin: D-100; guide: data-source "Adapter guide" (Jan, 2026-10-17 „documented").

#### Scenario: Guide documents the row metadata
- **WHEN** the docs test reads `docs/data-sources.md`
- **THEN** the interface table's `listSignals` row names `unit`; the text mentions `take_anyif`, `KIPSCOPE_COLUMN_UNIT` and `KIPSCOPE_SNA_TEXTS` with "ADX only"; and "documents every source variable" passes with both new variables in the variables table and in `.env.example`
- **Evidence:** `apps/server/test/docs.test.ts` › "documents the row metadata", "documents every source variable"

#### Scenario: No unit without a unit column
- **WHEN** the conformance suite's "lists signals with their text flag" runs on ClickHouse and on the emulator (adapters built without a unit column, as today)
- **THEN** besides the unchanged text flags, no listed signal has a `unit` key, on either source
- **Evidence:** conformance suite › "lists signals with their text flag" (one added assertion: `listed.every((s) => !("unit" in s))`)

### Requirement: Computed series method
The optional method `computedSeries(ref, from, to, target, width)` SHALL answer the rows of a computed signal (computed-signals "Values per row", "SNA in either input", "Gaps of both inputs") raw when `[from, to)` holds at most `target` rows of its inputs together, else as buckets of the exact rows on the floor grid `k × width`. Origin: D-102 (compile into the source's query, fallback from raw points for other adapters).

#### Scenario: Same rows natively and from the core
- **WHEN** the conformance suite runs the computed cases ("computes a difference per row with edges", "computes one input per row", "computes SNA from either input", "gives SNA for non-finite results", "holds an input only within its hold limit", "buckets computed rows exactly") against each adapter, `native` and `core only`
- **THEN** every case passes in all four runs with the values of computed-signals
- **Evidence:** `apps/server/test/conformance/clickhouse.conformance.test.ts`, `adx.conformance.test.ts` (`pnpm --filter @kipscope/server test` and `test:adx`)

#### Scenario: Rows at shared times
- **WHEN** `computedSeries` of `a - b` with a = `conf-a/Lin.RAMP`, b = `conf-a/Sna.CODE` runs over [B, B + 3 s) with target 1000, natively and from the core
- **THEN** both give 300 rows, one per distinct time (the `Sna.CODE` rows at B, B + 1 s, B + 2 s share their times with `Lin.RAMP` rows and add none), each equal to `computeRows` over the same raw points
- **Evidence:** conformance suite › "computes at shared times"

### Requirement: Computed fallback is bounded
Without a native `computedSeries`, the server SHALL compute it from `raw` of each input with a limit of 200,001 rows, through the query queue and with the caller's abort signal; more than 200,000 rows of one input SHALL fail with a "zoom in" error instead of reading on. Origin: lead pick 6 (row cap, clear "zoom in" error); data-source "Fallback queries are bounded".

#### Scenario: Row cap
- **WHEN** a stub adapter with only the required methods answers `raw` for input a with 200,001 points and the completed source's `computedSeries` runs
- **THEN** it rejects with `ComputedTooLargeError`, message `more than 200,000 rows of <a's name> in this range: zoom in`, after one `raw` call per input with limit 200,001; the route answers 422 `computed_too_large` with that message
- **Evidence:** `apps/server/test/fallbacks.test.ts` › "refuses a computed series over the row cap"; `apps/server/test/computed.http.test.ts` › "answers computed_too_large from the fallback"

### Requirement: Computed method in the adapter guide
`docs/data-sources.md` SHALL list `computedSeries` as optional with its fallback, its row cap and the rule that an adapter compiles only the parsed formula, never text. Origin: data-source "Adapter guide"; D-102.

#### Scenario: Guide lists the method
- **WHEN** `grep -n "computedSeries" docs/data-sources.md` runs
- **THEN** it prints at least one line, in the table of optional methods, naming the fallback and `200,000`
- **Evidence:** the command
