# Tasks

Round 1: sections 1–2 (done, 58f8d29). Round 2: sections 4–5, chunked bucket scan (D-110, design "Round 2"). In each round the server and the tests are built in parallel. No interface between them changes (design "Pinned interfaces"). The tests check SQL text and conformance values that are pinned in the spec and design.

**Before the round, the lead saves today's whole-recording answer for manual check S2 (design.md).** It cannot be taken after the server has changed.

Write areas (disjoint per task):

- 1.1: `apps/server/src/clickhouse.ts`
- 2.x: `apps/server/test/clickhouse.computed.test.ts`, `apps/server/test/conformance/suite.ts` (tester)
- 4.1: `apps/server/src/clickhouse.ts`, `apps/server/src/queue.ts`, `apps/server/src/datasource.ts`
- 5.x: `apps/server/test/clickhouse.computed.test.ts`, `apps/server/test/clickhouse.chunks.test.ts` (new), `apps/server/test/queue.test.ts` (tester)

## 1. apps/server/src

- [x] 1.1 `clickhouse.ts`:
  - **Several-input rows query:**
    - S-1: ROWS frame.
    - S-2: `i<i>_t` as a running `max` with its seed.
    - S-3: SNA folded into `i<i>_v` as NaN, seed `if({ss}=1, nan, {sv})`; drop `i<i>_s` and `anySna`; outer select `if(NOT isFinite(v0), NULL, v0)`.
    - S-5: `leadInFrame(x, 1, x + 1) OVER w2`, `w2` with the same `ORDER BY` as `w`, `WHERE nx != x AND <held>`; no `ORDER BY … LIMIT 1 BY` in this path.
  - S-6: the raw answer is `… FROM (rows) ORDER BY x`; the bucket answer and the one-input path stay unchanged apart from S-4.
  - S-4 in `formulaSql`: `min`/`max` carry NaN, each argument once, under an alias `_kf<n>`.
  - Update the `computedSeries` doc comment.
  - Verify:
    - "Query count", "SNA and NaN inside min and max" and the existing computed cases: `pnpm --filter @kipscope/server test`.
    - The ADX emulator run (`test:adx`) stays green.

## 2. Tests (tester)

- [x] 2.1 `clickhouse.computed.test.ts`:
  - "computes in one scan", "sends the same two queries for a raw answer" and "computes three inputs in one scan" assert `ROWS BETWEEN` and `IGNORE NULLS OVER`, and no `RANGE BETWEEN` and no `LIMIT 1 BY` (spec "Query count").
  - New "keeps NaN through min and max in the SQL": the formula `` `min(min(${SIG_A}, 1), ${SPEED})` `` gives a scan that contains `isNaN(`, and `i0_v` and `i1_v` exactly twice each (their definition and one use). That means each argument appears once (design S-4).
- [x] 2.2 `conformance/suite.ts`: new case "keeps SNA through min and max" with the three formulas and values of computed-signals "SNA and NaN inside min and max", native and core only. It must fail on ClickHouse native before 1.1 (at least the `min(Sna.CODE, Lin.RAMP)` and `min(Lin.RAMP / Sna.CODE, 1)` rows).
- [x] 2.3 Run `pnpm build && pnpm test && pnpm lint` and `pnpm --filter @kipscope/server test:adx`. Every computed case is green in all four runs, including "computes at shared times", "holds an input only within its hold limit", "computes SNA from either input", "gives SNA for non-finite results", "buckets computed rows exactly" and "computes a difference per row with edges" (data-source "Same rows natively and from the core").

## 4. apps/server/src (round 2)

- [ ] 4.1 Chunked bucket scan as pinned in design C-1 … C-4 and "Pinned interfaces" (round 2).
  - **Reopened, round 3 fix only (reviewer, `clickhouse.ts:531`):** chunk j > 0 scans from max(`c_j − L`, `from`) and carries the request's seeds, like chunk 0 (design C-3). `DataSource = Required<Omit<SourceAdapter, "useQueue">>` as pinned. Verify: "Lookback stays inside the request", "Chunked buckets equal unchunked ones" (c), "Chunk queries".
  - Round 2 parts, built:
  - `queue.ts`: `QueryRunner`; `queuedAdapter` calls `adapter.useQueue` when present and passes `computedSeries` through unqueued.
  - `datasource.ts`: optional `SourceAdapter.useQueue`.
  - `clickhouse.ts`: constructor option `computedChunkRows` (default 1,000,000), `COMPUTED_CHUNKS = 3`, `useQueue`, every `computedSeries` query through `this.run`.
  - Bucket path with several inputs, all finite `holdNs` and `count > computedChunkRows`: k chunks at bucket starts (C-2). Chunk j > 0 scans `[max(c_j − L, from), c_{j+1})` with the request's seeds; all chunks use `x >= {cs:Int64}` (C-3). The chunks run in parallel with a linked abort (C-4), and their bucket arrays are concatenated.
  - The raw answer and the one-input path stay unchanged.
  - Update the `computedSeries` doc comment.
  - Verify: "Chunk queries", "Each chunk takes a queue slot", "Chunked buckets equal unchunked ones", and all round-1 tests green.

## 5. Tests (tester, round 2)

- [x] 5.1 `clickhouse.computed.test.ts`: "splits a large bucket scan into chunks" and "does not chunk without hold limits, raw or small" (spec "Chunk queries"). The `counting` helper takes the constructor option.
- [x] 5.2 `clickhouse.chunks.test.ts` (new, against `sdlog.conf_signals` like the conformance ClickHouse source): "chunked buckets equal unchunked ones", cases (a) and (b) of the spec.
- [x] 5.3 `queue.test.ts`: "queues each computed query, not the whole call" (spy on `queue.run`). Existing queue tests that expect `computedSeries` queued as one call follow the pinned wiring.
- [ ] 5.5 Round 3: "Chunked buckets equal unchunked ones" case (c), "keeps the lookback inside the request" (`clickhouse.chunks.test.ts`), and in "splits a large bucket scan into chunks" the seeds equal the first chunk's, plus the 40 s hold case with `from` = `FROM`. Then rerun 5.4.
- [x] 5.4 Run `pnpm build && pnpm test && pnpm lint` and `pnpm --filter @kipscope/server test:adx`.

## 3. Lead (carserver)

S1 and S2 are run after round 1 and again after round 2.

- [ ] 3.1 Manual check S2 "Same answer on real data" (design.md), with the answer saved before the round.
- [ ] 3.2 Manual check S1 "Speed on carserver (goal)": reported against ≤ 2 s (whole recording), ≤ 0.30 s (25 min window) and ≤ 0.5 s (busiest hour); the three-input formula reported without a goal.
