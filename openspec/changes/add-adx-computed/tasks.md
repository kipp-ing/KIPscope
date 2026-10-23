# Tasks

Round 1: sections 1–2, the native query without chunks (design K-1 … K-10). Round 2: sections 3–4, chunks and queue (K-11, K-12). In each round one engineer and the tester work in parallel. The interfaces between them are pinned in design "Pinned interfaces" and K-8. Server only: no crash guard and no UI run (no change to `apps/web` or `packages/shared`).

**Emulator:** `docker compose --profile adx up -d` and `pnpm --filter @kipscope/server seed:adx` (`docs/data-sources.md` "Try it on the emulator"). Then `pnpm --filter @kipscope/server test:adx` runs `adx.conformance.test.ts`, `adx.test.ts` and `*.adx.test.ts`.

Write areas (disjoint per task):

- 1.1: `apps/server/src/adx.ts`, `apps/server/src/kusto.ts`, `docs/data-sources.md`
- 2.x: `apps/server/test/adxQueries.test.ts`, `apps/server/test/adx.test.ts`, `apps/server/test/kusto.test.ts`, `apps/server/test/computed.adx.test.ts` (new) (tester)
- 3.1: `apps/server/src/adx.ts`
- 4.x: `apps/server/test/adxQueries.test.ts`, `apps/server/test/computed.adx.test.ts` (tester)

## 1. apps/server/src (round 1)

- [x] 1.1 Native `computedSeries` on ADX:
  - `kusto.ts`: `KustoParam` gains `real` (K-8); `paramText` sends `realLiteral` text (move or share the helper from `adx.ts`).
  - `adx.ts`:
    - `formulaKql` (K-7) with the `kmin_`/`kmax_` lambdas (K-4).
    - `computedSeries`: the query of K-6 with K-2 (seed rows), K-3 (SNA fold through `isSna` per input, `snaParams`), K-5 (last row per time, hold filter, `x_ >= cs`), the parameters of K-8 (`cs` = `from`, `cr` = 2^63 − 1 in round 1), the answer of K-9. One input takes the same path (K-10).
    - The constructor takes the `options` argument of "Pinned interfaces". Round 1 may ignore it.
    - Doc comment as on ClickHouse.
  - `docs/data-sources.md`: the `computedSeries` row of the optional-methods table names ADX native (one KQL query with `scan`, count in the same query, chunked above 1,000,000 input rows from round 2) and drops `ADX: fallback`.
  - Verify:
    - "One query per answer", "Constants, names and seeds as parameters", "Real parameters", "Native methods without the emulator": `pnpm --filter @kipscope/server test`.
    - "Same rows on the emulator", "SNA from row texts", "Emulator run": `test:adx`.
    - "Guide lists the method": the `grep`.

## 2. Tests (tester, round 1)

- [x] 2.1 `adxQueries.test.ts`:
  - "answers a computed series with one query" and "compiles constants, names and seeds as parameters" (adx-source "Computed series in one ADX query", "ADX computed query from the parsed formula"), on the existing `fakeAdapter` / `scriptedAdapter` with the columns of K-9.
  - "lists the native methods" adds `computedSeries` before `events`.
- [x] 2.2 `kusto.test.ts`: "sends real parameters" (adx-source "Real parameters").
- [x] 2.3 `adx.test.ts`: "implements the measured fast paths only" adds `computedSeries` to the native list and the function loop.
- [x] 2.4 `computed.adx.test.ts` (new, in `test:adx` by its name): "computes SNA from row texts natively" (`KMeta` adapter as in `adx.test.ts` "ADX row metadata on the emulator"; native and `coreOnly` through `completeSource`).
- [x] 2.5 Run `pnpm build && pnpm test && pnpm lint` and `pnpm --filter @kipscope/server test:adx`. Report the computed conformance cases per run (`adx native`, `adx core only`, `clickhouse native`, `clickhouse core only`). Every one is green.

## 3. apps/server/src (round 2)

- [x] 3.1 Chunks on ADX as pinned in K-11 and K-12:
  - `computedChunkRows` option (default 1,000,000), `COMPUTED_CHUNKS = 3`, `useQueue`, every `computedSeries` query through `this.run`.
  - `cr` from `chunkable`. On a count-only answer: k chunk queries with the parameters of K-11, in parallel under one linked abort. Their sorted buckets are concatenated in chunk order.
  - The raw answer, the one-input path and requests that are not chunkable send one query as in round 1.
  - `docs/data-sources.md` needs no further change if 1.1 already named the chunking.
  - Verify: "Chunk queries", "Each chunk takes a queue slot", "A failing chunk stops the others" (`pnpm --filter @kipscope/server test`); "Chunked buckets equal unchunked ones", "Lookback stays inside the request" (`test:adx`); all round-1 checks still green.

## 4. Tests (tester, round 2)

- [x] 4.1 `adxQueries.test.ts`: "splits a large computed bucket scan into chunks", "queues each computed ADX query, not the whole call" (spy on `queue.run`, `QueryQueue(8)`), "aborts the other chunks when one fails" (adx-source "Chunked computed scan on ADX").
- [x] 4.2 `computed.adx.test.ts`: "chunked buckets equal unchunked ones" (cases a–c) and "keeps the lookback inside the request" (adx-source "ADX chunks read a bounded lookback"; a `KustoClient` subclass or wrapper that records parameters).
- [x] 4.3 Run `pnpm build && pnpm test && pnpm lint` and `pnpm --filter @kipscope/server test:adx`.

## 5. Lead

- [ ] 5.1 Manual check M1 (design.md) on the emulator server, reported (goal, not a gate).
- [ ] 5.2 `docs/status.md`: follow-up for the search tool team. Time a computed series on a real ADX cluster: a two-input formula over a whole recording and over a busy hour, unchunked and chunked, against the fallback's "zoom in". Not a gate (D-111).
