## Purpose

Says where a data ref holds no data: each signal's period (from the DBC, the diagnostic catalog or measured), the logger gaps of the data ref, and the rule that splits two consecutive points or buckets of a signal, so that charts, cursors and the CLI never join or evaluate across missing data (D-062).

## ADDED Requirements

### Requirement: Period of a signal
A signal's period SHALL be its DBC message's cycle time if that is above 0, else its diagnostic catalog group's interval if it has one, else the period measured from its data if one can be measured; otherwise it has none. Origin: D-062 („period from the DBC, the diagnostic catalog, else measured").

#### Scenario: Test data periods
- **WHEN** `GET /api/gaps?dataRef=gapcar` is sent to the test server (test DBCs and test diag catalog)
- **THEN** `periods` is exactly `{"gapcar/Cyc_B10h.CYC":{"ns":"20000000","source":"dbc"},"gapcar/Msr_B12h.MSR":{"ns":"100000000","source":"measured"},"gapcar/TBMS.current":{"ns":"10000000000","source":"diag"}}`; `gapcar/Evt_B11h.EVT` (cycle time 0, four rows) has none
- **Evidence:** `apps/server/test/gaps.http.test.ts` › "lists the logger gaps and periods of gapcar"

#### Scenario: smart451 periods
- **WHEN** `curl -s 'localhost:7310/api/gaps?dataRef=smart451' | jq -c '[.periods[].source] | group_by(.) | map({(.[0]): length}) | add'` runs against the dev server
- **THEN** it prints `{"dbc":408,"diag":29,"measured":94}` (553 signals, 22 without a period); `.periods["smart451/MEAS_DCU.MEAS_DCU"]` is `{"ns":"10000000","source":"measured"}` and `.periods["smart451/DIAG_BMS.DIAG_BMS"]` is `null`
- **Evidence:** the `curl` commands

### Requirement: Measured period
A period SHALL be measured from the signal's first 1,001 timestamped rows as the median of the positive spacings between consecutive rows, and accepted only when there are at least 100 spacings and at most 5 % of all spacings are longer than 3 medians. Origin: D-062 („else measured"; „without a … measurable period"); numbers: design G3 (smart451: cyclic samples 0–0.9 % long spacings, bursts 12.4 % and more).

#### Scenario: Cyclic and bursty samples
- **WHEN** a period is measured from 1,001 times 100 ms apart; from the same with 50 of the 1,000 spacings 1 s long; with 51 of them 1 s long; from 100 times 100 ms apart; and from 1,001 times in bursts of 2 ms spacings with every eighth spacing 333 ms
- **THEN** the results are 100 ms, 100 ms, none, none (99 spacings) and none
- **Evidence:** `packages/shared/test/gaps.test.ts` › "measures a period only from cyclic samples"

### Requirement: Logger gaps
A logger gap SHALL be the time between two consecutive timestamped rows of a data ref (any signal) that are at least 2 s apart, from the earlier row's time to the later row's time. Every such pair SHALL be found, with exact times, and no shorter silence. Origin: D-062 („where the logger recorded nothing at all (every signal)"); 2 s: design G2.

#### Scenario: Test data logger gaps
- **WHEN** `GET /api/gaps?dataRef=gapcar` and `GET /api/gaps?dataRef=testcar` are sent to the test server
- **THEN** gapcar's `logger` is exactly `[{"from":"1790985899980000000","to":"1790985960000000000"},{"from":"1790986180000000000","to":"1790986182000000000"}]` (the 60.02 s pause and the 2.0 s one; not the 1.9 s silence at 00:09:30) and its `through` is `"1790986199980000000"`; testcar's `logger` is `[]`
- **Evidence:** `apps/server/test/gaps.http.test.ts` › "lists the logger gaps and periods of gapcar", "finds no logger gap where the logger never paused"

#### Scenario: smart451 logger gaps
- **WHEN** `curl -s 'localhost:7310/api/gaps?dataRef=smart451' | jq -c '[.logger[] | select(.from < "1791936000000000000")] | length, .[0], .[9]'` runs (gaps starting before 2026-10-14T00:00Z)
- **THEN** it prints `14`, `{"from":"1791722112563000000","to":"1791725930210000000"}` and `{"from":"1791883673936000000","to":"1791883676982000000"}` (2026-10-13 09:27:53.936–09:27:56.982 UTC, inside a drive)
- **Evidence:** the `curl` command

### Requirement: Gap info per catalog load
The server SHALL compute a data ref's gap info (logger gaps, periods, `through` = its last row's time) once per catalog load and after new rows ("Gap info follows new rows"), share it between concurrent requests, start computing it for every data ref after each catalog load, and not keep a failed computation. Origin: necessary consequence of D-062 (the rule needs it for every view and value) and D-007 (carserver: 2 GB RAM); same pattern as the density (time-strip, design T7).

#### Scenario: Once, shared, retried after failure
- **WHEN** a stub source counts its logger-gap and sample queries; two `/api/gaps` requests for one data ref arrive together, a third after them, then the catalog reloads and a fourth arrives; then the source fails once and two more requests arrive one after the other
- **THEN** the first three cause one logger-gap query and one sample query, the fourth one more of each; the first request after the failure answers 502 `source_error` and the next computes again and answers 200
- **Evidence:** `apps/server/test/gaps.test.ts` › "computes gap info once per catalog load and drops a failure"

#### Scenario: Load on carserver
- **WHEN** the gap info of smart451 is computed on carserver
- **THEN** it runs one logger-gap query (≈ 7 s, ≈ 14 MB server memory for 131 M rows) and one sample query (≈ 0.2 s, ≈ 2 MB for 116 signals), one count query (design G9) and no other query
- **Evidence:** `X-ClickHouse-Summary` of the two queries of design G2/G3 run with `curl` (read-only)

### Requirement: Gap info follows new rows
Every 5 min after the last poll or prefetch ended, the server SHALL count each data ref's rows and recompute the gap info whose count changed since it was computed, serving the old info until the new one is in and keeping it when the recompute fails; polls and prefetches never overlap. Origin: D-062 as a necessary consequence (a backfilled chunk left a stale gap that split real data, Jan 2026-10-17); design G9 (b).

#### Scenario: New rows refresh the gap info
- **WHEN** a stub source answers `refCount` 100 and the gap info is computed; a poll runs with the count still 100; the count becomes 101 and the logger gaps change, and a poll runs while a request arrives during its recompute; then the count becomes 102, the next recompute fails, and a request follows
- **THEN** the second poll sends one count query and no logger-gap query; the third sends one logger-gap query, the request during it gets the old info and requests after it the new one; after the failed recompute the request gets the previous info (answer 200) and the next poll recomputes again
- **Evidence:** `apps/server/test/gaps.test.ts` › "recomputes gap info after new rows and keeps the old one meanwhile"

#### Scenario: Count on carserver
- **WHEN** `SELECT count() FROM sdlog.signals WHERE vehicle = 'smart451'` runs on carserver (read-only)
- **THEN** its `X-ClickHouse-Summary` shows `read_rows` ≤ 10 and `elapsed_ns` < 50 ms (measured 2026-10-17: 3 rows, 3.4 ms)
- **Evidence:** `curl` with the summary header

#### Scenario: smart451 without the stale gap
- **WHEN** `curl -s 'localhost:7310/api/gaps?dataRef=smart451' | jq '[.logger[] | select(.to > "1792176671171000000" and .from < "1792176763235000000")] | length'` runs on the dev server
- **THEN** it prints `0` (no logger gap in 2026-10-16 18:51:11.171–18:52:43.235 UTC, where carserver holds 1,491,779 rows)
- **Evidence:** the `curl` command

### Requirement: A sample voids a logger gap
A logger gap SHALL split two points of a signal only when it lies within them (`p ≤ from` and `to ≤ q`), and two buckets only when neither bucket lies entirely inside it; a logger gap that holds a point, edge neighbour or non-empty bucket of the signal strictly inside it SHALL count as stale for that pair, and the period rule SHALL still apply. Origin: logger gap definition (it holds no row, "Logger gaps"); Jan 2026-10-17 („same values are cluttered as dots"); design G9 (a).

#### Scenario: Points and buckets inside a stale gap
- **WHEN** with a logger gap 1 s–61 s and no period the split is computed for points 10 s and 20 s; 0 s and 10 s; 20 s and 70 s; 0 s and 70 s; with P = 10 ms for points 10 s and 10.05 s; for 1 s buckets at 10 s and 11 s; at 0 s and 61 s; and `evaluateAt(15 s, "line", {t: 10 s, v: 1}, {t: 20 s, v: 3}, undefined, gaps)`
- **THEN** the results are: none, none, none, a logger split with hold end 1 s, a period split, joined, split (logger), and `interpolated` 2
- **Evidence:** `packages/shared/test/gaps.test.ts` › "ignores a logger gap that holds a sample"

### Requirement: Gap info over HTTP
`GET /api/gaps?dataRef=<ref>` SHALL return the data ref's gap info. It SHALL answer 400 `invalid_request` without `dataRef`, 503 `catalog_unavailable` before the catalog was ever loaded, 404 `unknown_data_ref` for a data ref without catalog signals, and 502 `source_error` when the computation fails. Origin: necessary consequence of D-062 (the web draws the gaps; same errors as `/api/density`).

#### Scenario: Errors
- **WHEN** the test server is asked for `/api/gaps`, `/api/gaps?dataRef=nocar`, and, on a server whose catalog never loaded, `/api/gaps?dataRef=gapcar`
- **THEN** the answers are 400, 404 and 503
- **Evidence:** `apps/server/test/gaps.http.test.ts` › "answers gap info errors like the density route"

### Requirement: Split between two points
Two consecutive points of a signal SHALL be split when a logger gap lies between them, or when the signal has a period P and they are more than 3 P apart. The earlier point's value SHALL then count as held up to its hold end: the earliest of its time plus P (period split) and the first logger gap's start (logger split). Origin: D-062; hold end: design G4 (a step stops at a gap).

#### Scenario: Period and logger splits
- **WHEN** the split is computed for points at 0 and 60 ms with P = 20 ms; at 0 and 61 ms with P = 20 ms; at 0 and 10 s without a period; at 0 and 70 s without a period and a logger gap 1 s–61 s; and at 0 and 70 s with P = 20 ms and that logger gap
- **THEN** the results are: none; a period split with hold end 20 ms; none; a logger split with hold end 1 s; a logger split with hold end 20 ms
- **Evidence:** `packages/shared/test/gaps.test.ts` › "splits points by period and by logger gaps"

### Requirement: Split between two buckets
Two consecutive non-empty buckets of width w starting at s1 < s2 SHALL be split when the signal has a period P and `s2 − (s1 + w) > 3 P`, or when a logger gap overlaps the time between their centres `s1 + w/2` and `s2 + w/2`. Empty buckets that are not split SHALL stay joined. Origin: D-062 („The same holds for buckets when zoomed out"); design G5 (only certain gaps break).

#### Scenario: Slow signal at fine buckets, dropout, logger gap
- **WHEN** the split is computed for buckets 30 s apart with w = 5 ms and P = 30 s; for buckets with an empty stretch of 61 ms and P = 20 ms; for adjacent buckets (s2 = s1 + w, w = 1 min) with P = 20 ms; and for adjacent 1 min buckets without a period whose second half of the first bucket holds a logger gap
- **THEN** the results are: joined, split (period), joined, split (logger)
- **Evidence:** `packages/shared/test/gaps.test.ts` › "splits buckets only where a gap is certain"
