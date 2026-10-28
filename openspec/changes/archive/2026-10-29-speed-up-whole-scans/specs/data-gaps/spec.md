## MODIFIED Requirements

### Requirement: Period of a signal
A signal's period SHALL be its DBC message's cycle time if that is above 0, else its diagnostic catalog group's interval if it has one, else the period measured from its data if one can be measured; otherwise it has none. Origin: D-062 („period from the DBC, the diagnostic catalog, else measured").

#### Scenario: Test data periods
- **WHEN** `GET /api/gaps?dataRef=gapcar&signal=gapcar/Msr_B12h.MSR&signal=gapcar/Evt_B11h.EVT` is sent to the test server (test DBCs and test diag catalog)
- **THEN** `periods` is exactly `{"gapcar/Cyc_B10h.CYC":{"ns":"20000000","source":"dbc"},"gapcar/Msr_B12h.MSR":{"ns":"100000000","source":"measured"},"gapcar/TBMS.current":{"ns":"10000000000","source":"diag"}}`; `gapcar/Evt_B11h.EVT` (cycle time 0, four rows) has none
- **Evidence:** `apps/server/test/gaps.http.test.ts` › "lists the logger gaps and periods of gapcar"

#### Scenario: smart451 periods
- **WHEN** on the scoped dev server, in a workspace `<id>` with scope `smart451 2026-10-13T00:00:00Z 2026-10-14T00:00:00Z`, `curl -s 'localhost:7310/api/w/<id>/gaps?dataRef=smart451&signal=smart451/BMS.cell_voltage.001&signal=smart451/BMS.cell_voltage_max' | jq -c '[.periods["smart451/BMS.cell_voltage.001"].source, .periods["smart451/BMS.cell_voltage_max"].source]'` runs
- **THEN** it prints `["measured","diag"]` within 15 s of a cold start of that scope, and no answer is 502
- **Evidence:** the `curl` command with its time

### Requirement: Logger gaps
A logger gap SHALL be the time between two consecutive timestamped rows of a data ref (any signal) that are at least 2 s apart, from the earlier row's time to the later row's time. Every such pair SHALL be found, with exact times, and no shorter silence. Origin: D-062 („where the logger recorded nothing at all (every signal)"); 2 s: design G2.

#### Scenario: Test data logger gaps
- **WHEN** `GET /api/gaps?dataRef=gapcar` and `GET /api/gaps?dataRef=testcar` are sent to the test server
- **THEN** gapcar's `logger` is exactly `[{"from":"1790985899980000000","to":"1790985960000000000"},{"from":"1790986180000000000","to":"1790986182000000000"}]` (the 60.02 s pause and the 2.0 s one; not the 1.9 s silence at 00:09:30) and its `through` is `"1790986199980000000"`; testcar's `logger` is `[]`
- **Evidence:** `apps/server/test/gaps.http.test.ts` › "lists the logger gaps and periods of gapcar", "finds no logger gap where the logger never paused"

#### Scenario: smart451 logger gaps
- **WHEN** on the scoped dev server, in a workspace `<id>` with scope `smart451 2026-10-13T00:00:00Z 2026-10-14T00:00:00Z`, `curl -s 'localhost:7310/api/w/<id>/gaps?dataRef=smart451' | jq -c '[.logger[] | select(.from == "1791883673936000000")]'` runs
- **THEN** it prints `[{"from":"1791883673936000000","to":"1791883676982000000"}]` (2026-10-13 09:27:53.936–09:27:56.982 UTC, inside a drive); the number of logger gaps in that day is reported
- **Evidence:** the `curl` command

### Requirement: Gap info per catalog load
The server SHALL compute a data ref's (or a scope's, or a work window's) logger gaps and `through` (its last row's time), and each measured period it needs ("Measured periods only for signals in use"), once per catalog load and after new rows ("Gap info follows new rows"), within the scan bound ("Gap info within the scan bound"). It SHALL share each between concurrent requests and not keep a failed computation. In full mode it SHALL start computing the logger gaps after each catalog load only for the data refs whose `refCount` is within the bound's rows. Origin: necessary consequence of D-062 (the rule needs it for every view and value) and D-007 (carserver: 2 GB RAM); same pattern as the density (time-strip, design T7); bound: D-117.

#### Scenario: Once, shared, retried after failure
- **WHEN** a stub source counts its logger-gap and sample queries; two `/api/gaps?dataRef=car&signal=car/Cyc&signal=car/Odd` requests arrive together, a third after them, then the catalog reloads and a fourth arrives; then the source fails once and two more requests arrive one after the other
- **THEN** the first three cause one logger-gap query and one sample query, the fourth one more of each; the first request after the failure answers 502 `source_error` and the next computes again and answers 200
- **Evidence:** `apps/server/test/gaps.test.ts` › "computes gap info once per catalog load and drops a failure"

#### Scenario: Load on carserver
- **WHEN** the gap info of the scope `smart451 2026-10-27T00:00:00Z 2026-10-28T00:00:00Z` is computed on carserver for a workspace whose windows hold six signals of the scope's list with a DBC period plus `smart451/BMS.cell_voltage.001` and `smart451/BMS.cell_voltage.002` (no DBC or diag period)
- **THEN** it runs one count query (shared with the scan bound), one logger-gap query, one sample query for those 2 signals and no other query. Goal, measured and reported, not pass/fail: the logger-gap query takes ≤ 10 s (114.9 M rows; ≈ 7 s for 131 M rows were measured on 2026-10-17).
- **Evidence:** the query count: `apps/server/test/gaps.test.ts` › "measures periods only for asked and workspace signals"; time: `X-ClickHouse-Summary` of the scoped logger-gap query run with `curl` (read-only), in `rounds.md`

### Requirement: Gap info follows new rows
Every 5 min after the last poll or prefetch ended, the server SHALL count the rows of each held gap info that an open workspace uses and recompute those whose count changed since they were computed. It serves the old info until the new one is in, and keeps the old one when the recompute fails. Polls and prefetches never overlap. What counts as used:
- the open workspaces' scopes and work windows ("Gap info of a scope")
- in full mode, while an open workspace has no scope or none is open, the data refs of the catalog whose count is within the scan bound's rows

Origin: D-062 as a necessary consequence (a backfilled chunk left a stale gap that split real data, Jan 2026-10-17); design G9 (b); D-117 (the poll never covers more than the open scopes).

#### Scenario: New rows refresh the gap info
- **WHEN** a stub source answers `refCount` 100 and the gap info is computed; a poll runs with the count still 100; the count becomes 101 and the logger gaps change, and a poll runs while a request arrives during its recompute; then the count becomes 102, the next recompute fails, and a request follows
- **THEN** the second poll sends one count query and no logger-gap query; the third sends one logger-gap query, the request during it gets the old info and requests after it the new one; after the failed recompute the request gets the previous info (answer 200) and the next poll recomputes again
- **Evidence:** `apps/server/test/gaps.test.ts` › "recomputes gap info after new rows and keeps the old one meanwhile"

#### Scenario: Count on carserver
- **WHEN** `SELECT count() FROM sdlog.signals WHERE vehicle = 'smart451' AND utc >= '2026-10-27 00:00:00' AND utc < '2026-10-28 00:00:00'` runs on carserver (read-only)
- **THEN** its `X-ClickHouse-Summary` is reported; goal, not pass/fail: `elapsed_ns` < 1 s (a count over 8 days took 1.5 s on 2026-10-28)
- **Evidence:** `curl` with the summary header, in `rounds.md`

#### Scenario: smart451 without the stale gap
- **WHEN** on the scoped dev server, in a workspace `<id>` with scope `smart451 2026-10-16T00:00:00Z 2026-10-17T00:00:00Z`, `curl -s 'localhost:7310/api/w/<id>/gaps?dataRef=smart451' | jq '[.logger[] | select(.to > "1792176671171000000" and .from < "1792176763235000000")] | length'` runs
- **THEN** it prints `0` (no logger gap in 2026-10-16 18:51:11.171–18:52:43.235 UTC, where carserver holds 1,491,779 rows)
- **Evidence:** the `curl` command

#### Scenario: Poll only over open scopes
- **WHEN** a full-mode test server with a recording adapter has the bound's rows set below testcar's row count, one open workspace without a scope, and one poll runs (fake timers)
- **THEN** the poll sends no `refCount` or `loggerGaps` call for testcar, and one for every other data ref of the catalog
- **Evidence:** `apps/server/test/gaps.test.ts` › "polls only data refs within the bound"

## ADDED Requirements

### Requirement: Gap info within the scan bound
`GET /api/gaps`, and the gap info that `/api/value` and computed series wait for, SHALL cover only one of these, checked by the scan bound before any logger-gap or sample query:
- the scope
- in an object scope, the work window
- in full mode without a scope, the data ref

Above the bound, `/api/gaps` SHALL answer 422 `too_wide`. The web SHALL treat it as a gap-info error of that data ref with the answer's message (`gap info for <ref> unavailable: too wide: …`), draw the lines without logger splits, and count the window as settled. No request SHALL wait for the gap info of a range larger than its scope or work window. Origin: D-117 („no request waiting for whole-recording gap info"); D-062 (no value across a gap); concept §10 (an incomplete result stays visible).

#### Scenario: Value waits only for its scope
- **WHEN** a stub source with scope {car, F, F + 1 h} records its calls and a `/api/value` request in that scope arrives
- **THEN** the only `loggerGaps` call carries scope {car, F, F + 1 h}, after one `refCount` with the same scope
- **Evidence:** `apps/server/test/gaps.test.ts` › "takes the value's gap info from the scope"

#### Scenario: Too wide in the window
- **WHEN** a timeseries window's gap info store gets 422 `too_wide` for its data ref
- **THEN** the window's state is settled and carries the error `gap info for <ref> unavailable: too wide: …` with the server's message, and the store fetches again after 5 min (the refresh interval), not after the 30 s failure retry (fake timers)
- **Evidence:** `apps/web/test/gaps.test.ts` › "settles with a too-wide error"
