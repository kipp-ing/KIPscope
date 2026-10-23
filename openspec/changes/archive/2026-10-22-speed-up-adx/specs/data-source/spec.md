## ADDED Requirements

### Requirement: Series in one call
The optional method `series(ref, from, to, target, width, scope)` SHALL answer what a series request needs in one call (design A2): when `[from, to)` holds at most `target` points (counted as `count` counts them, SNA points included), those points as `raw` gives them, plus `before(ref, from, scope)` and `after(ref, to, scope)`; otherwise the non-empty buckets of `buckets(ref, from, to, width)`. Without a native `series`, the server SHALL compute it with exactly today's calls: `count` first, then `raw`, `before` and `after` in parallel, or `buckets`. Origin: data fact (ADX testers's report of 2026-10-22, P2: `/api/series` awaits `count` before its data query, two serial ADX round trips of 0.6–8 s each, ×12 per open); Jan's agreement to the lead's cut (2026-10-22, P2); D-074 (a fast path where the fallback costs more than twice: two serial round trips against one).

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

## MODIFIED Requirements

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

### Requirement: Scope argument
`listSignals`, `before`, `after`, `refBuckets`, `extent`, `series`, `refExtent`, `refCount`, `loggerGaps`, `firstTimes`, `stateChanges` and `events` SHALL take an optional `scope: Scope {dataRef, from, to}` before `abort` (design Z1). With a scope each SHALL answer exactly as if the source held only the rows of `scope.dataRef` with `from ≤ time < to`; without one, as before. Origin: the ADX feedback item 1 („Adapters filter by data ref and by time ≥ `from` and < `to`"); D-078; `series`: necessary consequence of "Series in one call" (its edges are `before` and `after` with the scope).

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

### Requirement: Scope in the adapter guide
`docs/data-sources.md` SHALL document the scope: the rule of design Z1 with every method that takes it, the server's guarantees, the fallbacks of Z2, the scoped conformance cases, and the ClickHouse and ADX filter shapes. It SHALL also document `KIPSCOPE_CATALOG` and `KIPSCOPE_SCOPE_PAD`, which `.env.example` SHALL list too. Origin: the ADX feedback („We'd send the ADX adapter part … once the contract in item 1 is settled"); D-074 („lean and documented").

#### Scenario: Guide names every scoped method
- **WHEN** a test reads `docs/data-sources.md`
- **THEN** its section "Scope" names each of the 12 methods of "Scope argument" and the text `as if the source held only`; the existing "documents every source variable" test passes
- **Evidence:** `apps/server/test/docs.test.ts` › "documents the scope argument", "documents every source variable"
