## MODIFIED Requirements

### Requirement: SNA in either input
A computed row SHALL be SNA when any input's held point is SNA, and when the result is not finite (D-105 Q-4); an SNA row is never a number. This holds inside `min` and `max` too: an SNA or NaN argument makes their result NaN, as `Math.min`/`Math.max` do in the core. Origin: D-102 („SNA in either gives SNA"); D-010; non-finite: D-105 Q-4; `min`/`max`: necessary consequence of data-source "Same rows natively and from the core". ClickHouse 26.8 gives `least(nan, 1)` = 1 and `least(1, nan)` = nan (probe on the test DB, 2026-10-23).

#### Scenario: SNA from b
- **WHEN** the series of "Difference per row with edges" is asked for [B + 49.5 s, B + 50.5 s)
- **THEN** the 50 points before B + 50 s are null (`Sna.CODE` held at its SNA row n = 49) and the 50 from B + 50 s have values 5000 … 5049
- **Evidence:** conformance suite › "computes SNA from either input"

#### Scenario: Division by zero
- **WHEN** `Lin.RAMP / Sna.CODE` on `conf-a` is asked for [B, B + 1 s)
- **THEN** all 100 points are null
- **Evidence:** conformance suite › "gives SNA for non-finite results"

#### Scenario: SNA and NaN inside min and max
- **WHEN** on `conf-a` with target 1000, `min(Sna.CODE, Lin.RAMP)` and `max(Sna.CODE, Lin.RAMP)` are asked for [B + 49.5 s, B + 50.5 s), and `min(Lin.RAMP / Sna.CODE, 1)` for [B, B + 1 s)
- **THEN** the first two give 100 raw points each, every 10 ms from B + 49.5 s. The first 50 are null in both. The last 50 are 0 for `min` and 5000 … 5049 for `max`. The third gives 100 points: the one at B is null (0 / 0 is NaN), the other 99 are 1 (k / 0 is +Infinity). Native and core-only answers are equal.
- **Evidence:** conformance suite › "keeps SNA through min and max" (ClickHouse and ADX emulator, native and core only). On ClickHouse native it fails before this change.

### Requirement: ClickHouse in one scan
On ClickHouse a computed series SHALL read all its source signals in one scan of `signal IN (…)` with window functions, no join and no union, plus one count. With several inputs the scan SHALL use a ROWS frame and take one row per distinct time from the last row at that time, without `LIMIT 1 BY`. Its rows SHALL equal those of the core (data-source "Same rows natively and from the core", "Rows at shared times"). Origin: D-102 (measured: busiest hour 0.12 s, whole recording 0.95 s; no materialized views); N signals: D-106; ROWS frame and last row per time: Jan 2026-10-23 („ja, gerne optimieren“) on the lead's measurement (3.49 s today vs 2.06 s with that shape, same count, min and max).

#### Scenario: Query count
- **WHEN** the ClickHouse adapter answers a computed buckets request of `Fast_100h.SIG_A - Fast_100h.SIG_B + Fast_100h.SIG_C` through a query-counting client, and then a raw request of a two-input formula
- **THEN** each sends exactly two queries (the count and the scan). The scan's SQL contains `{s2:String}` (buckets case), `IGNORE NULLS OVER` and `ROWS BETWEEN`. It contains none of `JOIN`, `UNION`, `RANGE BETWEEN` and `LIMIT 1 BY`.
- **Evidence:** `apps/server/test/clickhouse.computed.test.ts` › "computes in one scan", "sends the same two queries for a raw answer", "computes three inputs in one scan"

#### Scenario: Same answer on real data
- **WHEN** the lead runs `/api/series` for `MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr` on smart451 over the whole recording with target 2000, once before the round and once after it
- **THEN** both answers have the same bucket starts, `count` and `sna` per bucket, and the same `min` and `max`. `mean` differs by at most 1e-9 relative. Summed over all buckets: `count` 4,141,081, min −946.1, max 81.6.
- **Evidence:** the lead's two saved JSON answers compared with `jq` (manual check S2 in design.md)

#### Scenario: Speed on carserver (goal)
- **WHEN** the lead times `/api/series`, target 2000, for `MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr` over the whole recording, over a 25 min window and over the busiest hour, and for a three-input formula with a third numeric signal of the session over the whole recording
- **THEN** the times are reported against these goals, not as pass/fail: whole recording ≤ 2 s (today 3.9–4.0 s), 25 min window ≤ 0.30 s (today 0.21–0.30 s), busiest hour ≤ 0.5 s. The three-input time is reported without a goal.
- **Evidence:** lead's `curl -s -o /dev/null -w '%{time_total}'` output, three runs each (manual check S1 in design.md)
