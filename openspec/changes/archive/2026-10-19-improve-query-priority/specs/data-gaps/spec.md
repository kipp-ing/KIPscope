## MODIFIED Requirements

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

## ADDED Requirements

### Requirement: Measured periods only for signals in use
The server SHALL measure a period only for a signal named in a `/api/gaps` or `/api/value` request or held by the workspace (a window's signals, the events line). Each measurement SHALL also take every workspace signal of the same data ref not yet measured in this catalog load, in one sample query per data ref and request. DBC and diag periods need no query and stay listed for every signal. Origin: the ADX feedback item 7 (~2,400 signals took 17–34 s); concept §3 (at most 50 signals shown).

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
