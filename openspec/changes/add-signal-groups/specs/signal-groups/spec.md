## ADDED Requirements

### Requirement: Sender from the DBC
For a signal with a DBC entry, the catalog SHALL report the transmitter of its `BO_` line (the last token) as `dbc.sender`. A transmitter `Vector__XXX`, or a `BO_` line without one, SHALL leave `sender` absent. Origin: D-053 („The DBCs name a sender per `BO_` … `Vector__XXX` means no sender").

#### Scenario: Senders from inline DBC text
- **WHEN** `parseDbc` reads, with CRLF line ends, `BO_ 342 YRG_156h: 8 YRG` with one `SG_`, `BO_ 147 CBX_A2: 8 Vector__XXX` with one `SG_`, and `BO_ 7 Bare_7h:` with one `SG_`
- **THEN** the signal of `YRG_156h` has sender `YRG`, and the signals of `CBX_A2` and `Bare_7h` have no `sender` key
- **Evidence:** `apps/server/test/dbc.test.ts` › "reads the sender of each message, none for Vector__XXX"

#### Scenario: Senders from the real DBCs
- **WHEN** the real `h-can.dbc` is parsed (runs if the file exists)
- **THEN** `COMBI_412h.V_ANZ` has sender `CGW`, `MS_608h.T_MOT` `Engine`, `BS_200h.DVL` `ESP`, and `CPC_448h.PTC_HV_Volt` none
- **Evidence:** `apps/server/test/dbc.test.ts` › "derives DBC details from the real h-can.dbc" (extended)

### Requirement: Group rules
`display.groups` SHALL be an optional ordered list of rules: an optional regex `match` on the source name and a template `group` over its named groups and `{sender}`. The group SHALL be the trimmed render of the first rule that matches (or has no `match`) and renders non-blank; else, or for the render `Other`, the group `Other`. Restart to apply. Origin: D-053 (rules „like the display-name rules of D-035", „Restart to change", `Other` for no DBC entry or `Vector__XXX`); fall-through: design G4.

#### Scenario: First non-blank rule wins
- **WHEN** the shipped rules apply, rule 0 `group: '{sender}'` and rule 1 `match: '^(?<ecu>CPC|PNHV)_'`, `group: '{ecu}'`, to `CPC_448h.PTC_HV_Volt` (no sender), `COMBI_412h.V_ANZ` (sender `CGW`), `VIN.VIN_1` (no DBC entry), `CPC_168h.X` (sender `BMS`) and `PNHV_STAT.PNHV_SupBat_Temp` (no sender)
- **THEN** the groups are `CPC` (rule 0 blank, falls through), `CGW`, `Other` (undefined), `BMS` and `PNHV`
- **Evidence:** `apps/server/test/groups.test.ts` › "takes the first rule that matches and renders non-blank"

#### Scenario: Blank renders and Other
- **WHEN** the only rule is `group: ' {sender} '`, applied to a signal with sender `ESP`, one without sender, and one with sender `Other`
- **THEN** the groups are `ESP` (trimmed), `Other` and `Other`, the last two as undefined
- **Evidence:** `apps/server/test/groups.test.ts` › "falls through blank renders and maps Other to undefined"

#### Scenario: No rules
- **WHEN** `display.groups` is absent, empty or `null`
- **THEN** every signal is in `Other` and no catalog entry has `group`
- **Evidence:** `apps/server/test/groups.test.ts` › "falls through blank renders and maps Other to undefined" (empty rule list); `apps/server/test/catalog.test.ts` › "lists a signal without DBC entry with its name only" (unchanged `toEqual`, no `group`)

### Requirement: Invalid group rules stop the server
An invalid group rule (structure, regex, a named group called `sender`, an unknown placeholder, a stray brace; problem texts in design G3) SHALL stop the server like an invalid name rule: exit 1, one line per problem `<path>: <field>: <problem>`. Origin: necessary consequence of D-053 („like the display-name rules of D-035"), whose invalid file stops the server.

#### Scenario: Group rule errors
- **WHEN** `parseProject` reads a text with `display.groups`: rule 0 `{ match: '^(?<ecu>[A-Z+)_', group: '{ecu}' }`, rule 1 `{ match: '^(?<sender>[A-Z]+)_', group: '{sender}' }`, rule 2 `{ match: '^(?<ecu>[A-Z]+)_', group: '{ecux}' }`, rule 3 `{ group: '{sender' }`, rule 4 `{ group: 'x', mtach: 'y' }`
- **THEN** it fails with exactly these problems, each prefixed by the path: `display.groups[0].match: invalid regex: …`, `display.groups[1].match: group "sender" clashes with the field {sender}`, `display.groups[2].group: unknown placeholder "ecux" (known: sender, ecu)`, `display.groups[3].group: stray "{" at column 1`, `display.groups[4]: unknown key "mtach"`
- **Evidence:** `apps/server/test/project.test.ts` › "reports every problem of the group rules" (rule 4 may be checked in a separate text, since structure errors stop before stage 3)

### Requirement: Groups come from the server
The server SHALL compute every signal's group once per catalog load and deliver it in each catalog entry (`/api/catalog` and `/api/signals`) as `group`, absent for `Other`. The web SHALL NOT evaluate rules. Signal IDs, names, workspace, commands and the CLI SHALL NOT change. Origin: D-053 (rules in the project file); server-side like display names: D-036 („Computed on the server … the web … never evaluates rules").

#### Scenario: Test project file on the test DB
- **WHEN** the catalog is built from the test DB with `apps/server/test/fixtures/kipscope.test.yaml`, whose `display.groups` are rule 0 `match: '^Sna_'`, `group: 'SNA codes'` and rule 1 `group: '{sender}'`
- **THEN** `testcar/Sna_800h.SPEED` has group `SNA codes`, `testcar/Fast_100h.SIG_A` and `othercar/Fast_100h.SIG_A` have group `TEST`, and `testcar/Nodbc_500h.RAW` has no `group`
- **Evidence:** `apps/server/test/catalog.test.ts` › "sets groups from the test project file"

#### Scenario: Real data grouped by sender
- **WHEN** the server runs on real data with the shipped `kipscope.yaml`
- **THEN** `curl -s localhost:7310/api/catalog | jq -c '[.items[] | .group // "Other"] | group_by(.) | map({(.[0]): length}) | add'` prints `{"AC":21,"CGW":39,"CPC":89,"EPS":3,"ESP":64,"EWM":6,"Engine":63,"Other":18,"PNHV":10,"SAM":35,"SAS":6,"SRS":13,"TCU":38,"YRG":23}`, and `curl -s 'localhost:7310/api/signals?q=COMBI_412h.V_ANZ' | jq -r '.items[0].group'` prints `CGW` and the same for `CPC_448h.PTC_HV_Volt` prints `CPC`
- **Evidence:** the two curl commands

### Requirement: Grouped explorer list
When at least one catalog entry has a group, the explorer SHALL show the matches under group headers (marker, name, match count; one line ≤ 24 px). Empty search: every group, collapsed, by name. Searching: only groups with a match, open, by best match, rank order inside. `Other` always last. Origin: D-053 („Empty search: all groups, collapsed. While searching: only groups with a hit, all open, ordered by their best hit …"; `Other` „always last"); name order: design G6.

#### Scenario: Group order and state
- **WHEN** `explorerItems` gets ranked matches from groups `ESP` (ranks 3, 5), `Other` (rank 1), `CGW` (rank 2) and `AC` (rank 4)
- **THEN** while searching with nothing toggled the items are header `CGW` (count 1, open), its match, header `ESP` (2, open), ranks 3 and 5, header `AC` (1), rank 4, header `Other` (1), rank 1, and `firstSignal` is 1; with an empty query (catalog order) they are the headers `AC`, `CGW`, `ESP`, `Other`, all closed, no signal item, and `firstSignal` is 0; toggling `ESP` on the empty query opens just `ESP`, toggling it while searching closes just `ESP`; with `grouped` false the items are the five matches in rank order without headers
- **Evidence:** `apps/web/test/explorer.test.ts` › "groups matches by best hit, Other last, collapsed on an empty query"

#### Scenario: Empty search on real data
- **WHEN** the explorer is shown on real data with the shipped `kipscope.yaml` and an empty search
- **THEN** it lists fourteen collapsed headers `AC 21`, `CGW 39`, `CPC 89`, `Engine 63`, `EPS 3`, `ESP 64`, `EWM 6`, `PNHV 10`, `SAM 35`, `SAS 6`, `SRS 13`, `TCU 38`, `YRG 23`, `Other 18` and no signal row, the count reads `428 matches`; a click on `ESP` shows its 64 rows below it, a second click hides them
- **Evidence:** UI check (screenshot collapsed and with `ESP` open; header height via `getBoundingClientRect`)

#### Scenario: Search on real data
- **WHEN** the user types `temp` on real data with the shipped `kipscope.yaml`
- **THEN** the list shows, all open, `Engine 4` with `TEMP_KL`, `T_OEL`, `T_LUFT`, `T_MOT`, then `CPC 5` with `EAC_Sp_Temp_Excess`, `EAC_TempLmt_BoostReq`, `PTC_CtrlTemp`, `PTC_ShtDn_TempSensFlt`, `OverTemp_Lmp`, then `PNHV 1`, then `AC 1` with `T_SOLL`, then `CGW 2` with `T_AUSSEN`, `T_AUSSEN_RAW`, and no `Other`; the count reads `13 matches`; the row `TEMP_KL` is active
- **Evidence:** UI check (screenshot)

### Requirement: Group collapse
A click on a group header, or Enter while it is the active item, SHALL open or close that group. Each query change SHALL restore the state of "Grouped explorer list"; the state SHALL NOT be remembered, also not across a reload. When no entry has a group, the list SHALL be flat as before this change. Origin: D-053 (state per empty or running search); header click and Enter, no remembered state: design G6; flat list: necessary consequence of D-035's "no file … as today".

#### Scenario: Toggle and reset
- **WHEN** on real data with the shipped `kipscope.yaml` the user opens `ESP` and `AC` on the empty search, types `t`, deletes it again, then reloads the page
- **THEN** after deleting all groups are collapsed again, and after the reload too
- **Evidence:** UI check (screenshot after deleting and after the reload); `apps/web/test/explorer.test.ts` › "groups matches by best hit, Other last, collapsed on an empty query" (toggled set)

#### Scenario: No groups, flat list
- **WHEN** the catalog has no `group` on any entry (no `display.groups`)
- **THEN** no header is rendered and the rows are exactly the ranked matches, as before this change
- **Evidence:** `apps/web/test/explorer.test.ts` › "groups matches by best hit, Other last, collapsed on an empty query" (`grouped` false); `renderToStaticMarkup` or helper check that no `.group-head` exists for a flat list

### Requirement: Rows inside groups work as before
Signal rows inside a group SHALL keep the row markup, hover card, drag source, add button and match highlighting of the flat list. Headers SHALL have no add button, no hover card and SHALL NOT start a drag. Opening or closing a group SHALL close an open hover card. Origin: necessary consequence of D-053 with D-017 (hover infos), D-020 (drag, keys) and signal-catalog "Explorer rows are a drag source".

#### Scenario: Card and drag from a grouped row
- **WHEN** on real data the user searches `V_ANZ`, rests the pointer on the row `V_ANZ` under `CGW 1`, then drags the row onto a window not showing it
- **THEN** the card opens with `COMBI_412h.V_ANZ` as first line, the ghost reads `V_ANZ · add`, and after the drop the signal is in that window; pressing on the header `CGW` and moving starts no drag
- **Evidence:** UI check (screenshot of the card and during the drag)

### Requirement: Grouping without visible lag
Grouping SHALL run in the browser on every keystroke with no request to the server. Goal: grouping 10,000 ranked matches into 100 groups takes under 10 ms (median of 5 runs), so ranking plus grouping stays inside the 50 ms goal of signal-catalog "Filtering without visible lag". Origin: power-user report point 5 ("no visible lag"); the number is a goal (design, Numbers).

#### Scenario: Grouping speed
- **WHEN** 10,000 synthetic matches spread over 100 groups are passed to `explorerItems` while searching
- **THEN** the median of 5 runs is under 10 ms, measured and reported
- **Evidence:** `apps/web/test/explorer.test.ts` › "groups 10,000 matches in under 10 ms" (goal: logs the time, fails only above 50 ms)

### Requirement: Shipped files group by sender
The shipped `kipscope.yaml` SHALL group by sending ECU: rule `group: '{sender}'`, then the fallback `match: '^(?<ecu>CPC|PNHV)_'`, `group: '{ecu}'`; `kipscope.example.yaml` SHALL explain `groups`, `match`, `group`, the field `{sender}`, the fall-through of blank renders and the group `Other`; README SHALL describe groups in its project-file section. Origin: D-053 („the shipped file groups by sending ECU"; fallback rule: D-053 Q1).

#### Scenario: Shipped files parse with groups
- **WHEN** the shipped `kipscope.yaml` and `kipscope.example.yaml` are parsed
- **THEN** both parse without error, both have exactly two group rules, rule 0 without `match` and template `{sender}`, rule 1 `match: '^(?<ecu>CPC|PNHV)_'` and template `{ecu}` (D-053 Q1), and the display rules and measurement of the existing test are unchanged
- **Evidence:** `apps/server/test/project.test.ts` › "parses the shipped kipscope.yaml and kipscope.example.yaml" (extended)

#### Scenario: README
- **WHEN** a reader opens README.md
- **THEN** a section "Signal groups" shows the `{sender}` rule with its CPC/PNHV fallback and explains `match`, `group`, `{sender}`, first non-blank rule wins, `Other` last and "restart the server after editing"
- **Evidence:** `grep -n "Signal groups\|{sender}" README.md`
