# data-gaps Specification

## Purpose
Says where a data ref holds no data: each signal's period (from the DBC, the diagnostic catalog or measured), the logger gaps of the data ref, and the rule that splits two consecutive points or buckets of a signal, so that charts, cursors and the CLI never join or evaluate across missing data (D-062).

## Requirements

### Requirement: Period of a signal
A signal's period SHALL be its DBC message's cycle time if that is above 0, else its diagnostic catalog group's interval if it has one, else the period measured from its data if one can be measured; otherwise it has none. Origin: D-062 („period from the DBC, the diagnostic catalog, else measured").

#### Scenario: Test data periods
- **WHEN** `GET /api/gaps?dataRef=gapcar&signal=gapcar/Msr_B12h.MSR&signal=gapcar/Evt_B11h.EVT` is sent to the test server (test DBCs and test diag catalog)
- **THEN** `periods` is exactly `{"gapcar/Cyc_B10h.CYC":{"ns":"20000000","source":"dbc"},"gapcar/Msr_B12h.MSR":{"ns":"100000000","source":"measured"},"gapcar/TBMS.current":{"ns":"10000000000","source":"diag"}}`; `gapcar/Evt_B11h.EVT` (cycle time 0, four rows) has none
- **Evidence:** `apps/server/test/gaps.http.test.ts` › "lists the logger gaps and periods of gapcar"

#### Scenario: smart451 periods
- **WHEN** `curl -s 'localhost:7310/api/gaps?dataRef=smart451&signal=smart451/BMS.cell_voltage.001&signal=smart451/BMS.cell_voltage_max' | jq -c '[.periods[].source] | group_by(.) | map({(.[0]): length}) | add'` runs against the dev server
- **THEN** it prints `{"dbc":408,"diag":29,"measured":1}`; `.periods["smart451/BMS.cell_voltage.001"].source` is `"measured"` and `.periods["smart451/BMS.cell_voltage_max"].source` is `"diag"`; the same `curl` without the two `signal` parameters prints `{"dbc":408,"diag":29}`
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
The server SHALL compute a data ref's logger gaps and `through` (its last row's time), and each measured period it needs ("Measured periods only for signals in use"), once per catalog load and after new rows ("Gap info follows new rows"), share each between concurrent requests, start computing the logger gaps of every data ref after each catalog load, and not keep a failed computation. Origin: necessary consequence of D-062 (the rule needs it for every view and value) and D-007 (carserver: 2 GB RAM); same pattern as the density (time-strip, design T7).

#### Scenario: Once, shared, retried after failure
- **WHEN** a stub source counts its logger-gap and sample queries; two `/api/gaps?dataRef=car&signal=car/Cyc&signal=car/Odd` requests arrive together, a third after them, then the catalog reloads and a fourth arrives; then the source fails once and two more requests arrive one after the other
- **THEN** the first three cause one logger-gap query and one sample query, the fourth one more of each; the first request after the failure answers 502 `source_error` and the next computes again and answers 200
- **Evidence:** `apps/server/test/gaps.test.ts` › "computes gap info once per catalog load and drops a failure"

#### Scenario: Load on carserver
- **WHEN** the gap info of smart451 is computed on carserver for a workspace whose windows hold six signals of the live catalog with a DBC period plus `smart451/BMS.cell_voltage.001` and `smart451/BMS.cell_voltage.002` (no DBC or diag period)
- **THEN** it runs one logger-gap query (≈ 7 s, ≈ 14 MB server memory for 131 M rows), one count query (design G9), one sample query for those 2 signals (before this change: 116 signals, ≈ 0.2 s, ≈ 2 MB) and no other query
- **Evidence:** the query count: `apps/server/test/gaps.test.ts` › "measures periods only for asked and workspace signals"; time and memory: `X-ClickHouse-Summary` of the queries of design G2/G3 (add-gap-display) run with `curl` (read-only), unchanged

### Requirement: Gap info follows new rows
Every 5 min after the last poll or prefetch ended, the server SHALL count the rows of each data ref whose gap info it holds for an open workspace (the whole catalog in full mode while an open workspace has no scope or none is open, else only the open workspaces' scopes and work windows, "Gap info of a scope") and recompute the gap info whose count changed since it was computed, serving the old info until the new one is in and keeping it when the recompute fails; polls and prefetches never overlap. Origin: D-062 as a necessary consequence (a backfilled chunk left a stale gap that split real data, Jan 2026-10-17); design G9 (b).

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
`GET /api/gaps?dataRef=<ref>` SHALL return the data ref's gap info, with the measured periods of the signals of that data ref named in up to 100 repeated `signal` parameters (other names ignored). It SHALL answer 400 `invalid_request` without `dataRef` or with more than 100 `signal`s, 503 `catalog_unavailable` before the catalog was ever loaded, 404 `unknown_data_ref` for a data ref without catalog signals, and 502 `source_error` when the computation fails. Origin: D-062 (the web draws the gaps); 100: twice concept §3 (at most 50 signals shown).

#### Scenario: Errors
- **WHEN** the test server is asked for `/api/gaps`, `/api/gaps?dataRef=nocar`, `/api/gaps?dataRef=gapcar` with 101 `signal` parameters, and, on a server whose catalog never loaded, `/api/gaps?dataRef=gapcar`
- **THEN** the answers are 400, 404, 400 `invalid_request` and 503
- **Evidence:** `apps/server/test/gaps.http.test.ts` › "answers gap info errors like the density route"

#### Scenario: Named signals only
- **WHEN** the test server is asked for `/api/gaps?dataRef=gapcar` and for `/api/gaps?dataRef=gapcar&signal=gapcar/Msr_B12h.MSR&signal=testcar/Cyc_B10h.CYC&signal=gapcar/Nope`
- **THEN** the first answer's `periods` holds `gapcar/Cyc_B10h.CYC` (dbc) and `gapcar/TBMS.current` (diag) and nothing else; the second also holds `gapcar/Msr_B12h.MSR` (measured) and nothing else; both answer 200 with the same `logger` and `through`
- **Evidence:** `apps/server/test/gaps.http.test.ts` › "lists measured periods only for named signals"

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

### Requirement: Measured periods only for signals in use
The server SHALL measure a period only for a signal named in a `/api/gaps` or `/api/value` request or held by an open workspace, one with a live client (a window's signals, the events line). Each measurement SHALL also take every workspace signal of the same data ref not yet measured in this catalog load, in one sample query per data ref and request. DBC and diag periods need no query and stay listed for every signal. Origin: the ADX feedback item 7 (~2,400 signals took 17–34 s); concept §3 (at most 50 signals shown).

#### Scenario: Large catalog, small workspace
- **WHEN** a stub source with a native `firstTimes` that records the names it gets lists 2,400 signals `S0001` … `S2400` of data ref `big`, none with a DBC or diag period; the workspace has a timeseries window with `big/S0001` and `big/S0002`, a values window with `big/S0003`, and `big/S0004` on the events line; the catalog loads and its prefetch ends; then `/api/gaps?dataRef=big`, `/api/gaps?dataRef=big&signal=big/S0001&signal=big/S0100` and `/api/value?signal=big/S0200&t=0` arrive one after the other
- **THEN** the prefetch sends one `firstTimes` call with exactly `S0001`–`S0004`; the first request sends none and its `periods` is `{}`; the second sends one with exactly `S0100` and lists `big/S0001` and `big/S0100`; the value request sends one with exactly `S0200`: 3 calls and 6 names in all
- **Evidence:** `apps/server/test/gaps.test.ts` › "measures periods only for asked and workspace signals"

#### Scenario: Series right after a large catalog loads
- **WHEN** the same 2,400 signals come from a stub with only the required methods (so `firstTimes` falls back to one `raw` per name), each stub call takes 1 s (fake timers), the queue limit is 4, the workspace window holds `big/S0001`, and `GET /api/series?signal=big/S0001&from=0&to=60000000000` is sent right after the catalog load
- **THEN** the series answers 200 within 3 s of fake time, and until then the stub has received at most one `raw` call with limit 1,001 (the period sample of `S0001`)
- **Evidence:** `apps/server/test/priority.test.ts` › "answers a series at once after loading a catalog of 2,400 signals"

### Requirement: Gap info covers the window's signals
The browser tab SHALL send its timeseries windows' signal IDs (at most 100 per data ref, first asked first) with each gap info request and fetch again when a window shows a signal the last request did not name. A window SHALL count as rendered only once the gap info of its data refs was asked for all its signals (within the 100) or failed. Origin: necessary consequence of "Measured periods only for signals in use" and D-062 (the split rule needs the period).

#### Scenario: A signal added to a window
- **WHEN** a gap info store with a stub fetch gets window A asking for `car/x` and `car/y`; after that answer, window B asks for `car/y`; then window B asks for `car/y` and `car/z`; 5 min pass (fake timers); then window A releases its ask and 5 min pass again
- **THEN** the store fetches `car` with exactly `[car/x, car/y]`, nothing for B's first ask, then `[car/x, car/y, car/z]`, with B's state not settled until that answer is in and settled after it; the refetch after 5 min names `[car/x, car/y, car/z]` and the one after A's release `[car/y, car/z]`
- **Evidence:** `apps/web/test/gaps.test.ts` › "asks for the windows' signals and fetches again for a new one"

#### Scenario: More than 100 signals
- **WHEN** one window asks for 120 signals of data ref `car`
- **THEN** the store sends one fetch naming the first 100 in the window's order and the window's state is settled once that answer is in
- **Evidence:** `apps/web/test/gaps.test.ts` › "names at most 100 signals per data ref"

#### Scenario: Adding a signal in the app
- **WHEN** the UI user, on the dev server with carserver data, adds `smart451/BMS.cell_voltage.001` to a timeseries window that did not hold it
- **THEN** the browser's network log shows one `/api/gaps?dataRef=smart451…` request whose `signal` parameters include `smart451/BMS.cell_voltage.001`, the line draws, and the window shows no gap info error
- **Evidence:** UI check (screenshot of the network entry and the window)

### Requirement: Gap info of a scope
While the workspace has a scope, `GET /api/gaps` for its data ref SHALL answer the gap info of the scope only (design Z9): logger gaps between rows in the scope, `through` the last row in it, periods measured from its rows. The info SHALL be cached per scope, and the 5-min poll SHALL count only the active scope's rows. In an object scope the same SHALL hold for the asked work window `[from, to)` instead of the whole scope (object-view "Gaps and events follow the view"). Origin: the ADX feedback item 4; D-078 („nothing scans a data ref's whole history"); object scope: D-086.

#### Scenario: A scope that cuts a logger gap
- **WHEN** the test server has scope {gapcar, `1790985900000000000`, `1790986200000000000`} and `GET /api/gaps?dataRef=gapcar` is sent
- **THEN** `logger` is exactly `[{"from":"1790986180000000000","to":"1790986182000000000"}]` (the 60.02 s pause starts before the scope's first row and is no gap in it) and `through` is `"1790986199980000000"`
- **Evidence:** `apps/server/test/gaps.http.test.ts` › "lists the logger gaps of a scope"

#### Scenario: Scoped queries and poll
- **WHEN** a stub source records its calls, the scope {gapcar, F, T} is set (F = `1790985900000000000`, T = `1790986200000000000`), `/api/gaps?dataRef=gapcar` is sent twice, and one poll runs (fake timers)
- **THEN** the source got one `loggerGaps`, one `firstTimes` and, from the poll, one `refCount` call, each with scope {gapcar, F, T}, and no call without a scope
- **Evidence:** `apps/server/test/gaps.test.ts` › "computes and polls the gap info of a scope"

#### Scenario: Work window in an object scope
- **WHEN** a stub source records its calls, a workspace is unlinked on `gapcar` (object scope), `/api/gaps?dataRef=gapcar&from=2026-10-03T00:00:00Z&to=2026-10-04T00:00:00Z` is sent twice, and one poll runs
- **THEN** the source got one `loggerGaps` and one `firstTimes` call with the scope {gapcar, 2026-10-03, 2026-10-04} and a poll `refCount` with the same scope, and no call with the whole object scope
- **Evidence:** `apps/server/test/gaps.test.ts` › "computes and polls the gap info of a work window"
