## ADDED Requirements

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
