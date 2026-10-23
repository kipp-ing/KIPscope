# Proposal

## Why

A computed series over a whole recording is slow on ClickHouse. The lead measured on carserver: `MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr` on smart451, 11 days, 4.2 M input rows, target 2000, takes 3.9–4.0 s through `/api/series`. `DNMOT` alone takes 0.49 s. The archived `improve-formula-editor` set a goal of 3 s (its M12) and missed it. Jan, on the lead's report (2026-10-23): „ja, gerne optimieren“.

The lead's direct SQL measurements show where the time goes. The scan takes 3.49 s, the `count()` 0.18 s, the sort alone 0.29 s. The rest is the window functions, about 0.3–0.5 s per window column, each on one thread. `ORDER BY x LIMIT 1 BY x` costs about 1.0 s, and only 8 duplicate times exist in 4.2 M rows. The same result as today's query came back in 2.06 s from this query:

- a ROWS frame instead of the RANGE frame
- each input's last time as `max(…) OVER w` instead of `last_value … IGNORE NULLS`
- one row per time by keeping the last row of each time, instead of `LIMIT 1 BY`

## What Changes

- **ClickHouse multi-input scan** (`computedSeries` in `apps/server/src/clickhouse.ts`):
  - a ROWS frame
  - the last time per input as a running `max`
  - SNA folded into the value column as NaN, which drops one window column per input
  - one row per time from the last row of each time
  - the rows query has no `ORDER BY … LIMIT 1 BY`
  - The answers stay identical (conformance suite).
- **Raw and bucket answers share one rows query** (as today). The raw answer orders its few rows itself.
- **`min`/`max` keep NaN**: ClickHouse compiles them so that any NaN argument gives NaN, matching `Math.min`/`Math.max` in the core. The SNA fold needs this. It also fixes a native/core mismatch that exists today: `least(nan, 1)` is 1 in ClickHouse 26.8, while `Math.min(NaN, 1)` is NaN.
- **Chunked bucket scan** (round 2, D-110: Jan, „probier mal die stückelung“). This applies to a bucket answer with several inputs and more than 1,000,000 input rows, where every input has a hold limit:
  - The range is split at bucket starts into k = min(3, ceil(count / 1,000,000)) chunks.
  - The chunks are scanned in parallel, each through the query queue.
  - Later chunks read back by the largest hold limit, never before `from`, and carry the request's seeds.
  - The answer stays identical.
  - The ClickHouse source queues each of its computed queries itself, through a small `useQueue` hook on the adapter.
- **Speed goal**: the whole recording in ≤ 2 s (lead's curl, reported, not a gate). The 25 min window must be no slower than today's 0.21–0.30 s.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `computed-signals`: "Chunked bucket scan" and "Chunks read a bounded lookback" are added (round 2). "SNA in either input" gains a scenario for SNA and NaN inside `min`/`max`. "ClickHouse in one scan" gets the new query shape in its "Query count" check and the new speed goals.

## Impact

- Code: `apps/server/src/clickhouse.ts` (`computedSeries`, `formulaSql`), and in round 2 `apps/server/src/queue.ts` and `apps/server/src/datasource.ts` (the `useQueue` hook), with tests in `apps/server/test/`.
- No change to `packages/shared`, `apps/web`, HTTP payloads, the fallback or ADX.

## Out of scope

- `PARTITION BY` a time bucket inside one query. The chunks of round 2 are separate queries with a lookback instead.
- Chunking the raw answer or the one-input path, chunks split by row counts, and more than 3 chunks (4 only as the lead's measurement).
- The one-input path. It keeps its `ORDER BY x LIMIT 1 BY x`. Applying the last-row rule to it is a later option.
- Dropping or caching the `count()` (0.18 s).
- Native ADX compilation, materialized views, pre-aggregation.
- Any web change, such as prefetching or a progress display for a slow computed series.
