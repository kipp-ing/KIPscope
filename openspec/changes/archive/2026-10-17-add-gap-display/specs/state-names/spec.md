## MODIFIED Requirements

### Requirement: State names at the cursors
A, B and L readout cells in legends and in the values window SHALL show the short state name instead of the number, with number and label in the tooltip; L from drawn data names a raw point or a bucket whose minimum and maximum share a name, else shows the number. A Diff cell SHALL show `=` or `≠` when A or B has a name. Origin: D-059; Diff: necessary consequence (states have no difference).

#### Scenario: Readouts on smart451
- **WHEN** on smart451 window 1 shows `DCU_1F4h.IgnMode` and `BMS.contactor` over 2026-10-13 11:00–11:20 local, a values window shows both, A is at 11:10 and B at 2026-10-13 12:13 local, and then the pointer hovers window 1 at about 11:15
- **THEN** the legend and values window show A `KEYON` and `closed`, B `NONE` and `no data` (the contactor's last reading is at 12:09:04 local, D-062), Diff `≠` and `—`; while hovering the L cells show `KEYON` and `closed`; the tooltip of A's IgnMode cell names `KEYON` and `3`
- **Evidence:** UI check on smart451 at 1440×900 (screenshot with hover, tooltip text)

#### Scenario: Cell text
- **WHEN** readout cells are formatted for value 3 with label `KEYON: Ignition on`, for value 254 with label `SENSOR_DEF`, for 20.5 without label, and Diff cells for A `KEYON` / B `KEYON` and A `KEYON` / B 0 (`NONE`)
- **THEN** `KEYON` (title `KEYON: Ignition on · 3`), `SENSOR_DEF` (title `SENSOR_DEF · 254`), `20.5`; `=` and `≠`
- **Evidence:** `apps/web/test/readout.test.ts` › "shows state names in readout cells"
