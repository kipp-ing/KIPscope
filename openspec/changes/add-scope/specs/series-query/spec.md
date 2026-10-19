# series-query delta

## ADDED Requirements

### Requirement: A range cut to the scope keeps its bucket width
When the series route cuts a requested range to the scope (scope "Routes are bounded by the scope"), the bucket width SHALL be computed from the span asked for (`to − from` of the request), not from the cut range, so the buckets stay on the grid the caller asked for. Origin: necessary consequence of "Reusable buckets for aligned requests" (D-037 (3)); lead fix, design Z15.

#### Scenario: Cut range keeps the asked width
- **WHEN** `querySeries` gets `testcar/Fast_100h.SIG_A` for [BASE, BASE + 10 h) with target 2,000 and an asked span of 20 h (the range already cut)
- **THEN** the result is aggregated with width `bucketWidth(0, 20 h, 2000)`, and its counts sum to 7,200,000
- **Evidence:** `apps/server/test/series.test.ts` › "keeps the bucket width of the asked span when the range was cut to a scope"
