- Round 1: continue — shared, web build/tests and test suites fulfilled; blockers: queue.ts lacks loggerGaps/firstTimes (502 on 7310, no real-data/UI scenario judged), seed-test-db.ts:350 TS18048, ValuesWindow.tsx lacks gap-value class.

Lead (2026-10-17): "Load on carserver" measured read-only with `X-ClickHouse-Summary`: logger-gap query 173,772,280 rows, 9.38 s, 20.5 MB (spec ≈ 7 s, 14 MB at 131 M rows: data grew 1.33×); first-times query for 116 signals 4,792,320 rows, 0.17 s, 4.3 MB (spec ≈ 0.2 s, 2 MB). Fulfilled within a factor of two. Not run by the UI user: values window "Inside gaps" in hold mode, state-names "Readouts on smart451"; left to Jan's hand check.

Lead (2026-10-17, G9): "Count on carserver" measured read-only: `SELECT count() … WHERE vehicle = {ref:String}` read_rows 3, 4.6 ms, 3.3 MB (spec 3.4 ms). Fulfilled; 5.2 ticked.
