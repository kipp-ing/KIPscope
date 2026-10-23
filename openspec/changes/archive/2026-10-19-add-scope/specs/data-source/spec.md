# data-source delta

T1 = 2026-10-01T01:00:00Z, T2 = 02:00:00Z (test DB `testcar`). Fixture and scopes: design C7 of `add-adx-source`, B = `1791158400000000000`; S, S2, S3 of design Z4 of this change.

## MODIFIED Requirements

### Requirement: Required source methods
Every adapter SHALL implement `ping`, `listSignals`, `raw`, `before`, `after`, `buckets` and `refBuckets` and expose `info` (kind, database, table, events table label), with the signatures of design C1 of `add-adx-source` as extended by design Z1 of `add-scope` (`listSignals`, `before`, `after` and `refBuckets` take an optional `scope` before `abort`). `listSignals` SHALL flag each signal whose rows carry text. Origin: D-006 („ADX follows behind the same adapter interface"); Jan (2026-10-17) „the interfaces shall be lean and documented"; scope: D-078, the ADX feedback item 1.

#### Scenario: Signal list
- **WHEN** `listSignals` runs on the conformance tables
- **THEN** it returns exactly `conf-a` `Beat.HB`, `Diag.door`, `Fine.NS`, `Lin.RAMP`, `Sna.CODE`, `State.MODE` and `conf-b` `Lin.RAMP`, `Span.FAR`, with `text` true only for `conf-a/Diag.door`
- **Evidence:** conformance suite › "lists signals with their text flag"

#### Scenario: Unknown signal
- **WHEN** `raw`, `buckets`, `before`, `after` and `count` run for `conf-a/Nope.X`
- **THEN** they answer `[]`, `[]`, nothing, nothing and 0, never an error
- **Evidence:** conformance suite › "answers empty for an unknown signal"

## ADDED Requirements

### Requirement: Scope argument
`listSignals`, `before`, `after`, `refBuckets`, `extent`, `refExtent`, `refCount`, `loggerGaps`, `firstTimes`, `stateChanges` and `events` SHALL take an optional `scope: Scope {dataRef, from, to}` before `abort` (design Z1). With a scope each SHALL answer exactly as if the source held only the rows of `scope.dataRef` with `from ≤ time < to`; without one, as before. Origin: the ADX feedback item 1 („Adapters filter by data ref and by time ≥ `from` and < `to`"); D-078.

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

#### Scenario: Native and core only, both adapters
- **WHEN** `pnpm --filter @kipscope/server test` and `pnpm --filter @kipscope/server test:adx` run with the test DB and the emulator seeded
- **THEN** the five scoped cases above and every existing case pass in `clickhouse native`, `clickhouse core only`, `adx native` and `adx core only`
- **Evidence:** the two commands' output (tester's report: case count per run)

### Requirement: The server keeps calls inside the scope
The server SHALL never pass a scope of another data ref than the method's own, and SHALL send `raw`, `buckets` and `count` only ranges inside the active scope. Origin: necessary consequence of "Scope argument" (those three take no scope, and an adapter may ignore `scope.dataRef`).

#### Scenario: Full mode with a scope
- **WHEN** the test server in full mode runs on a recording adapter with scope {testcar, T1, T2} and `/api/series` for `testcar/Fast_100h.SIG_A` over 2026-10-01T00:00Z … 10:00Z, `/api/value` at T1 + 1 s and `/api/extent` are sent
- **THEN** every `raw`, `buckets` and `count` call has T1 ≤ `from` and `to` ≤ T2, and every other data call carries scope {testcar, T1, T2}
- **Evidence:** `apps/server/test/scope.http.test.ts` › "keeps every call inside the scope in full mode"

### Requirement: Fallbacks keep the scope
Every fallback of an optional method SHALL pass its scope to the core methods it calls and SHALL use `scope.from … scope.to` where it used the whole time axis (design Z2). Origin: necessary consequence of "Scope argument" (a core-only adapter would otherwise scan the whole history); the ADX feedback („the gap info falls back to `firstTimes`").

#### Scenario: Core calls carry the scope
- **WHEN** a recording stub with only the required methods is completed and `extent`, `refExtent`, `refCount`, `loggerGaps`, `firstTimes` (3 names) and `stateChanges` are called with scope {conf-a, B + 5 s, B + 35 s}
- **THEN** every `before`, `after` and `refBuckets` call the stub received carries that scope, and every `raw` call has `from` = B + 5 s and `to` = B + 35 s
- **Evidence:** `apps/server/test/fallbacks.test.ts` › "passes the scope to every core call"

### Requirement: Scoped queries carry both filters
For a call with a scope, the ClickHouse and ADX adapters SHALL send only queries that filter by the scope's data ref and by both of its time bounds (design Z3). Unscoped calls SHALL send the same queries as before this change. Origin: the ADX feedback acceptance („In scoped mode, no query runs without both a data ref and a time filter"); data-source "ClickHouse answers as before".

#### Scenario: ClickHouse query texts
- **WHEN** a ClickHouse adapter on a client that records query texts and parameters runs every method that takes a scope, once with scope {conf-a, B + 5 s, B + 35 s} and once without
- **THEN** each scoped query filters the data-ref column by `conf-a` and the time column by `>=` B + 5 s and `<` B + 35 s; each unscoped query text equals the one recorded before this change
- **Evidence:** `apps/server/test/clickhouse.scope.test.ts` › "puts the data ref and both time bounds into every scoped query"

#### Scenario: ADX query texts
- **WHEN** an ADX adapter on a fake Kusto client runs every method that takes a scope with that scope
- **THEN** each KQL text applies `where` on the data-ref column `== sref` and on the time column `>= sfrom` and `< sto` to the table (or events table) before any other operator, with `sref`, `sfrom`, `sto` as parameters
- **Evidence:** `apps/server/test/adx.test.ts` › "scopes every query by data ref and time"

### Requirement: Scope in the adapter guide
`docs/data-sources.md` SHALL document the scope: the rule of design Z1 with every method that takes it, the server's guarantees, the fallbacks of Z2, the scoped conformance cases, and the ClickHouse and ADX filter shapes. It SHALL also document `KIPSCOPE_CATALOG` and `KIPSCOPE_SCOPE_PAD`, which `.env.example` SHALL list too. Origin: the ADX feedback („We'd send the ADX adapter part … once the contract in item 1 is settled"); D-074 („lean and documented").

#### Scenario: Guide names every scoped method
- **WHEN** a test reads `docs/data-sources.md`
- **THEN** its section "Scope" names each of the 11 methods of "Scope argument" and the text `as if the source held only`; the existing "documents every source variable" test passes with the two new variables
- **Evidence:** `apps/server/test/docs.test.ts` › "documents the scope argument", "documents every source variable"
