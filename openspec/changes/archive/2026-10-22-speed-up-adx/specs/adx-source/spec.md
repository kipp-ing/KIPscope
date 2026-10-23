## ADDED Requirements

### Requirement: One ADX query per extent and series
The ADX adapter's `extent` and `series` SHALL each send exactly one KQL query, with or without a scope: `extent` takes `min` and `max` of the time column in one `summarize` (no `top`); `series` computes the range's count with `toscalar` and returns the raw, edge and bucket branches through one `union` (design A3). Through the server's composition (queue and fallbacks), one `/api/series` computation on ADX SHALL take one queue slot and send one query, on the raw path and on the bucket path. Origin: data fact (ADX testers's report of 2026-10-22: the `extent` fallback is two `top 1` scans, 4–17 s per signal; `/api/series` costs two serial round trips); Jan's agreement to the lead's cut (2026-10-22, P1 and P2); D-097 (no native `count`).

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

## MODIFIED Requirements

### Requirement: ADX passes the conformance suite
The ADX adapter SHALL pass the whole conformance suite against the emulator, natively and core only. It SHALL implement `extent`, `series`, `refCount`, `loggerGaps`, `stateChanges` and `events` natively and use the server's fallbacks for `count`, `refExtent` and `firstTimes` (design C6, measured; speed-up-adx design A1). Origin: data-source "One conformance suite"; the lead's brief (factor-of-two rule on the measured costs, D-074); `count` on the fallback: D-097 (Jan, 2026-10-22, following D-074); `extent`, `series`: data fact (ADX testers's report of 2026-10-22 on a real cluster: the `extent` fallback 4–17 s per signal, two serial round trips per series request, while the emulator had shown ≤ 1.6×) and Jan's agreement to the lead's cut (2026-10-22, P1, P2).

#### Scenario: Emulator run
- **WHEN** `docker compose --profile adx up -d`, `pnpm --filter @kipscope/server seed:adx` and `pnpm --filter @kipscope/server test:adx` run
- **THEN** every conformance case passes for `adx native` and `adx core only`, and the ADX adapter object has exactly the methods named above
- **Evidence:** the commands' output; `apps/server/test/adx.test.ts` › "implements the measured fast paths only"

#### Scenario: Native methods without the emulator
- **WHEN** `nativeMethods` runs on an ADX adapter over a fake Kusto client
- **THEN** it lists exactly `extent`, `series`, `refCount`, `loggerGaps`, `stateChanges` and `events`
- **Evidence:** `apps/server/test/adxQueries.test.ts` › "lists the native methods"
