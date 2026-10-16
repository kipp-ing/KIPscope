## ADDED Requirements

### Requirement: Signals with states
The catalog SHALL mark a signal `states: "labels"` when it has a named value that is not SNA (its `VAL_` table, or its diagnostic-catalog enum from `add-diag-metadata`) and `states: "text"` when its rows carry text (found by one query per catalog load), and SHALL give each `VAL_` entry its physical value as for SNA codes (D-012). Origin: D-059 („many signals are state"); D-061 (diag enums feed the state names); design N1.

#### Scenario: States in the test catalog
- **WHEN** the server runs on the test DB and `GET /api/catalog` is read
- **THEN** `testcar/Ign_A20h.MODE` and `testcar/Tmp_A21h.TEMP` have `states` `"labels"`, `testcar/DIAG.door` and `testcar/DIAG.lock` `"text"`, `testcar/Fast_100h.SIG_A` no `states`; `Ign_A20h.MODE`'s `dbc.values` hold `{"raw":3,"label":"KEYON: Ignition on","value":3}`
- **Evidence:** `apps/server/test/catalog.test.ts` › "marks signals with states"; `apps/server/test/signals.http.test.ts` › "lists 1,021 signals" (count 1,017 → 1,021)

#### Scenario: States on smart451
- **WHEN** `curl -s localhost:7310/api/catalog | jq -c '[.items[] | select(.states) | .states] | group_by(.) | map({(.[0]): length})'` runs against carserver
- **THEN** `text` is 9 and `labels` is reported (at most 74 from `VAL_` plus the diag enum signals of `add-diag-metadata`); `CPC_168h.IgnCurMode` has `"labels"`, `BMS.contactor` `"text"`, `SAM_423h.KL_15` none
- **Evidence:** the command

### Requirement: State name of a value
The state name of a valid value SHALL be the named value (`VAL_` or diag enum) within half a factor step of it (|factor| / 2, 0.5 without factor) or, for a text signal, the row's text; an SNA value SHALL have none (D-010). The UI SHALL show a label `CODE: words` as `CODE` with the whole label in the tooltip. Origin: D-059 („the coursers shall show the statename. like OFF"); D-010, D-015; short form: design N2.

#### Scenario: Names from values
- **WHEN** the names of `Ign_A20h.MODE` values 3, 3.4, 0, 2 and 15 (SNA) and of a signal with factor 0.1 and label 25 → `HOT` at value 2.54 and 2.56 are looked up, and the short forms of `KEYON: Ignition on`, `CLS: Close`, `NO_TEMP_SENSOR` and `Contactor open` are formed
- **THEN** `KEYON: Ignition on`, `KEYON: Ignition on`, `NONE`, none, none; `HOT` and none; `KEYON`, `CLS`, `NO_TEMP_SENSOR`, `Contactor open`
- **Evidence:** `packages/shared/test/states.test.ts` › "finds the state name of a value", "shortens CODE: labels"

### Requirement: No interpolation into a state
In line mode, a value at a time between two points of which at least one has a state name SHALL be held (the earlier point's value and name) instead of interpolated, in readouts and in `/api/value`. Origin: concept §9 („Besonders bei Betriebszuständen … ob ein Mittelwert eine sinnvolle Aussage liefert"); D-059 (a cursor shows a state name, which an interpolated value has none of).

#### Scenario: Held across a state change
- **WHEN** `GET /api/value?signal=testcar/Ign_A20h.MODE&t=2026-10-01T01:09:59.95Z&mode=line`, the same at 01:20:00.05Z, and `signal=testcar/Tmp_A21h.TEMP&t=2026-10-01T01:02:00.5Z&mode=line` are sent
- **THEN** `value` is `{"kind":"held","value":0,"label":"NONE"}`, then `{"kind":"held","value":3,"label":"KEYON: Ignition on"}`, then `{"kind":"interpolated","value":20.5}`
- **Evidence:** `apps/server/test/value.http.test.ts` › "holds and names state values"

### Requirement: State names in values
`/api/value` SHALL add `label` to a raw or held value that has a state name, and to `at` and `next` of a text signal the row's text; `kipscope value` SHALL pass it through. Raw series of a text signal SHALL carry each point's text. Origin: D-059 (cursor readouts; CLI per concept §7, the CLI reads what the UI shows).

#### Scenario: Labels over HTTP
- **WHEN** `/api/value` is asked for `testcar/Tmp_A21h.TEMP` at 01:05:05Z, `testcar/Ign_A20h.MODE` at 01:40:00.5Z and `testcar/DIAG.door` at 01:02:00Z (step), and `/api/series` for `testcar/DIAG.door` over 01:00–03:00Z
- **THEN** `{"kind":"raw","value":254,"label":"SENSOR_DEF"}`; `{"kind":"sna"}` without label; `{"kind":"held","value":0,"label":"closed"}` with `at.label` `closed` and `next.label` `open`; a raw series whose `text` is `["closed","closed","open","open","closed"]`
- **Evidence:** `apps/server/test/value.http.test.ts` › "holds and names state values"; `apps/server/test/series.http.test.ts` › "carries the text of a text signal"

#### Scenario: CLI value
- **WHEN** `kipscope value testcar/Ign_A20h.MODE 2026-10-01T01:20:00.05Z --mode step` runs against the CLI test server whose stub source gives that signal the points 3 at 01:20:00Z and 3 at 01:20:00.1Z and the test DBC's labels
- **THEN** `data.value` is `{"kind":"held","value":3,"label":"KEYON: Ignition on"}`
- **Evidence:** `apps/cli/test/cli.test.ts` › "reads a value at a time and at a cursor" (state case added)

### Requirement: State names at the cursors
A, B and L readout cells in legends and in the values window SHALL show the short state name instead of the number, with number and label in the tooltip; L from drawn data names a raw point or a bucket whose minimum and maximum share a name, else shows the number. A Diff cell SHALL show `=` or `≠` when A or B has a name. Origin: D-059; Diff: necessary consequence (states have no difference).

#### Scenario: Readouts on smart451
- **WHEN** on smart451 window 1 shows `CPC_168h.IgnCurMode` and `BMS.contactor` over 2026-10-13 11:00–11:20 local, a values window shows both, A is at 11:10 and B at 2026-10-13 10:40 local, and then the pointer hovers window 1 at about 11:15
- **THEN** the legend and values window show A `KEYON` and `closed`, B `NONE` and `open`, Diff `≠` and `≠`; while hovering the L cells show `KEYON` and `closed`; the tooltip of A's IgnCurMode cell names `KEYON` and `3`
- **Evidence:** UI check on smart451 at 1440×900 (screenshot with hover, tooltip text)

#### Scenario: Cell text
- **WHEN** readout cells are formatted for value 3 with label `KEYON: Ignition on`, for value 254 with label `SENSOR_DEF`, for 20.5 without label, and Diff cells for A `KEYON` / B `KEYON` and A `KEYON` / B 0 (`NONE`)
- **THEN** `KEYON` (title `KEYON: Ignition on · 3`), `SENSOR_DEF` (title `SENSOR_DEF · 254`), `20.5`; `=` and `≠`
- **Evidence:** `apps/web/test/readout.test.ts` › "shows state names in readout cells"
