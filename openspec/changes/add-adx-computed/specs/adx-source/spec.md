## MODIFIED Requirements

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

## ADDED Requirements

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
