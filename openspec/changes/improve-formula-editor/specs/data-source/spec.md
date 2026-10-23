## MODIFIED Requirements

### Requirement: Computed series method
The optional method `computedSeries(ref, from, to, target, width)` SHALL answer the rows of a computed signal over up to 8 source signals (computed-signals "Values per row", "SNA in either input", "Gaps of both inputs") raw when `[from, to)` holds at most `target` rows of its inputs together, else as buckets of the exact rows on the floor grid `k × width`. Origin: D-102 (compile into the source's query, fallback from raw points for other adapters); up to 8 inputs: D-106.

#### Scenario: Same rows natively and from the core
- **WHEN** the conformance suite runs the computed cases ("computes a difference per row with edges", "computes one input per row", "computes three inputs per row", "computes SNA from either input", "gives SNA for non-finite results", "holds an input only within its hold limit", "buckets computed rows exactly") against each adapter, `native` and `core only`
- **THEN** every case passes in all four runs with the values of computed-signals
- **Evidence:** `apps/server/test/conformance/clickhouse.conformance.test.ts`, `adx.conformance.test.ts` (`pnpm --filter @kipscope/server test` and `test:adx`)

#### Scenario: Rows at shared times
- **WHEN** `computedSeries` of `Lin.RAMP - Sna.CODE` on `conf-a` runs over [B, B + 3 s) with target 1000, natively and from the core
- **THEN** both give 300 rows, one per distinct time (the `Sna.CODE` rows at B, B + 1 s, B + 2 s share their times with `Lin.RAMP` rows and add none), each equal to `computeRows` over the same raw points
- **Evidence:** conformance suite › "computes at shared times"

### Requirement: Computed fallback is bounded
Without a native `computedSeries`, the server SHALL compute it from `raw` of all its n inputs read in parallel in one wave, through the query queue and with the caller's abort signal, under one cap of 200,000 rows for all inputs together, `floor(200,000 / n)` per input; an input over its share SHALL fail with a "zoom in" error instead of reading on. Origin: add-computed-signals lead pick 6 (row cap, clear "zoom in" error); one cap for all inputs: lead decision in D-107; one parallel wave: lead (ADX latency dominates, D-097); data-source "Fallback queries are bounded".

#### Scenario: Row cap
- **WHEN** a stub adapter with only the required methods answers `raw` for a two-input formula with 100,001 points for the first input `Lin.RAMP` and 10 for the second, and the completed source's `computedSeries` runs; then with 100,000 and 100,000 points
- **THEN** both `raw` calls start before either answers, each with limit 100,001; the first run rejects with `ComputedTooLargeError`, message `more than 100,000 rows of Lin.RAMP in this range: zoom in`; the second answers; the route answers 422 `computed_too_large` with that message
- **Evidence:** `apps/server/test/fallbacks.test.ts` › "refuses a computed series over the row cap"; `apps/server/test/computed.http.test.ts` › "answers computed_too_large from the fallback"
