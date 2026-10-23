# Tasks

One round. The server and the tests are built in parallel. No interface between them changes (design "Pinned interfaces"). The tests check SQL text and conformance values that are pinned in the spec and design.

**Before the round, the lead saves today's whole-recording answer for manual check S2 (design.md).** It cannot be taken after the server has changed.

Write areas (disjoint per task):

- 1.1: `apps/server/src/clickhouse.ts`
- 2.x: `apps/server/test/clickhouse.computed.test.ts`, `apps/server/test/conformance/suite.ts` (tester)

## 1. apps/server/src

- [ ] 1.1 `clickhouse.ts`:
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

- [ ] 2.1 `clickhouse.computed.test.ts`:
  - "computes in one scan", "sends the same two queries for a raw answer" and "computes three inputs in one scan" assert `ROWS BETWEEN` and `IGNORE NULLS OVER`, and no `RANGE BETWEEN` and no `LIMIT 1 BY` (spec "Query count").
  - New "keeps NaN through min and max in the SQL": the formula `` `min(min(${SIG_A}, 1), ${SPEED})` `` gives a scan that contains `isNaN(`, and `i0_v` and `i1_v` exactly twice each (their definition and one use). That means each argument appears once (design S-4).
- [ ] 2.2 `conformance/suite.ts`: new case "keeps SNA through min and max" with the three formulas and values of computed-signals "SNA and NaN inside min and max", native and core only. It must fail on ClickHouse native before 1.1 (at least the `min(Sna.CODE, Lin.RAMP)` and `min(Lin.RAMP / Sna.CODE, 1)` rows).
- [ ] 2.3 Run `pnpm build && pnpm test && pnpm lint` and `pnpm --filter @kipscope/server test:adx`. Every computed case is green in all four runs, including "computes at shared times", "holds an input only within its hold limit", "computes SNA from either input", "gives SNA for non-finite results", "buckets computed rows exactly" and "computes a difference per row with edges" (data-source "Same rows natively and from the core").

## 3. Lead (carserver)

- [ ] 3.1 Manual check S2 "Same answer on real data" (design.md), with the answer saved before the round.
- [ ] 3.2 Manual check S1 "Speed on carserver (goal)": reported against ≤ 2 s (whole recording), ≤ 0.30 s (25 min window) and ≤ 0.5 s (busiest hour); the three-input formula reported without a goal.
