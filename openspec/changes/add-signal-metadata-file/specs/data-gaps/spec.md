## MODIFIED Requirements

### Requirement: Period of a signal
A signal's period SHALL be its DBC message's cycle time if that is above 0, else its metadata-file entry's `cycleMs` if it has one, else its diagnostic catalog group's interval if it has one, else the period measured from its data if one can be measured; otherwise it has none. Origin: D-062 („period from the DBC, the diagnostic catalog, else measured"); metadata files: D-099 („optional range and cycle").

#### Scenario: Test data periods
- **WHEN** `GET /api/gaps?dataRef=gapcar&signal=gapcar/Msr_B12h.MSR&signal=gapcar/Evt_B11h.EVT` is sent to the test server (test DBCs and test diag catalog)
- **THEN** `periods` is exactly `{"gapcar/Cyc_B10h.CYC":{"ns":"20000000","source":"dbc"},"gapcar/Msr_B12h.MSR":{"ns":"100000000","source":"measured"},"gapcar/TBMS.current":{"ns":"10000000000","source":"diag"}}`; `gapcar/Evt_B11h.EVT` (cycle time 0, four rows) has none
- **Evidence:** `apps/server/test/gaps.http.test.ts` › "lists the logger gaps and periods of gapcar"

#### Scenario: smart451 periods
- **WHEN** `curl -s 'localhost:7310/api/gaps?dataRef=smart451&signal=smart451/BMS.cell_voltage.001&signal=smart451/BMS.cell_voltage_max' | jq -c '[.periods[].source] | group_by(.) | map({(.[0]): length}) | add'` runs against the dev server
- **THEN** it prints `{"dbc":408,"diag":29,"measured":1}`; `.periods["smart451/BMS.cell_voltage.001"].source` is `"measured"` and `.periods["smart451/BMS.cell_voltage_max"].source` is `"diag"`; the same `curl` without the two `signal` parameters prints `{"dbc":408,"diag":29}`
- **Evidence:** the `curl` commands

#### Scenario: Period from a metadata file
- **WHEN** `staticPeriod` reads a signal with `meta` `{file: "m.json", cycleMs: 100}`, one with `dbc.cycleMs` 20, and one with `meta` `{file: "m.json"}` and `diag.intervalMs` 10000
- **THEN** it returns `{ns: 100000000n, source: "metadata"}`, `{ns: 20000000n, source: "dbc"}` and `{ns: 10000000000n, source: "diag"}`
- **Evidence:** `packages/shared/test/gaps.test.ts` › "takes the period from a metadata file"
