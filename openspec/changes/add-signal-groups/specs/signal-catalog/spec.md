## MODIFIED Requirements

### Requirement: DBC details per signal
For a signal with a DBC entry the catalog SHALL return the DBC file it came from, the message name and CAN ID, the message's sender where the `BO_` line names one other than `Vector__XXX` (capability `signal-groups`), and where the `SG_` line parses: factor, offset, min and max as written; plus the `VAL_` table sorted by raw value. A signal without DBC entry SHALL have no DBC details; absent fields stay absent. Origin: concept §4 („Vorhandene Metadaten werden angezeigt"), D-017 (hover infos); sender: D-053.

#### Scenario: Speed signal from the real DBC
- **WHEN** the catalog lists `smart451/COMBI_412h.V_ANZ` (`BO_ 1042 COMBI_412h: 8 CGW`, `SG_ V_ANZ : 0|9@0+ (1,0) [0|510] "km/h"`, `VAL_ 1042 V_ANZ 511 "SNV"`)
- **THEN** its DBC details are file `h-can.dbc`, message `COMBI_412h`, ID 1042, sender `CGW`, factor 1, offset 0, min 0, max 510, values `[{raw 511, label SNV}]`
- **Evidence:** `apps/server/test/dbc.test.ts` › "derives DBC details from the real h-can.dbc" (runs if the file exists; also `MS_608h.T_MOT` 1544, sender `Engine`, factor 1, offset −40, min −40, max 214; `BS_200h.DVL` 512, sender `ESP`, factor 0.5, max 8191); `curl -s 'localhost:7310/api/signals?q=COMBI_412h.V_ANZ' | jq -cS '.items[0].dbc'` prints `{"factor":1,"file":"h-can.dbc","max":510,"message":"COMBI_412h","messageId":1042,"min":0,"offset":0,"sender":"CGW","values":[{"label":"SNV","raw":511}]}`

#### Scenario: Details from the fixture DBCs
- **WHEN** the test DBCs are loaded (`test-a.dbc` before `test-b.dbc`)
- **THEN** `Fast_100h.SIG_C` has message `Fast_100h`, ID 256, sender `TEST`, factor 1, offset 0, min −100, max 100, file `test-a.dbc`; `Sparse_300h.MODE` has values `[{0, off}, {1, on}]`; `Irr_200h.JITTER` has min 0 and max 0 as written; `Many_700h.S0001` has file `test-b.dbc`
- **Evidence:** `apps/server/test/dbc.test.ts` › "reads message, scaling, range, value table and file"

#### Scenario: Signal without DBC entry
- **WHEN** a signal has data but no DBC entry (`testcar/Nodbc_500h.RAW`)
- **THEN** its catalog entry has no `dbc` field
- **Evidence:** `apps/server/test/catalog.test.ts` › "lists a signal without DBC entry with its name only" (unchanged `toEqual`)

### Requirement: No hard cap on results
The explorer SHALL make every match reachable: it shows the total match count and, when not all list items (rows and, with groups, group headers) are rendered, a control that renders more. No fixed limit SHALL hide matches; with groups, every match SHALL be reachable by opening its group. Origin: D-018 ("without a hard cap"); headers as items: design G6.

#### Scenario: Whole catalog reachable
- **WHEN** the search field is empty on real data
- **THEN** the count reads the catalog size (e.g. `428 matches`), there is no `showing 100`; without groups, scrolling to the end of the list reaches the alphabetically last signal; with the shipped `kipscope.yaml`, the header counts add up to 428 and opening the last header `Other` and scrolling to the end reaches its alphabetically last signal
- **Evidence:** UI check (screenshot of the list end and the count)

#### Scenario: Show more beyond one chunk
- **WHEN** a search matches more signals than one render chunk (test catalog, empty query, 1,013 signals)
- **THEN** a "Show N more" control appears, and using it until it disappears renders all items
- **Evidence:** `apps/web/test/explorer.test.ts` › "renders matches in chunks until all are visible" (pure chunking helper, applied to the item count). On real data (at most 440 items < 500) the control never appears, so the helper test is the only evidence; the UI user does not check it.

### Requirement: Explorer keys
The explorer SHALL support: `/` focuses the search field when focus is not in a text field (the `/` is not typed); Esc in the search field clears the query and closes the card; ArrowDown/ArrowUp move the active item (clamped at the ends) and keep it in view; Enter adds the active row exactly as its add button does. With groups (capability `signal-groups`) the items include the group headers: Enter on a header opens or closes its group and keeps it active. After each query change the active item SHALL be the first signal row shown, or the first item when no row is shown. Origin: D-020 ("The explorer list is keyboard-driven: `/` focuses the search, arrow keys move, Enter adds, Esc clears."); headers: D-053 with design G6.

#### Scenario: Search, Enter adds the top hit
- **WHEN** focus is on the page body, the user presses `/`, types `V_ANZ` and presses Enter
- **THEN** the search field contains exactly `V_ANZ` and `COMBI_412h.V_ANZ` is added to the selected "Add to" target (also with the header `CGW 1` above the row)
- **Evidence:** UI check (screenshot of the new window)

#### Scenario: Arrows choose another hit
- **WHEN** with the shipped `kipscope.yaml` the user types `temp`, presses ArrowDown twice and Enter; then ArrowDown twice more, Enter, ArrowDown once
- **THEN** `MS_608h.T_LUFT` (third row under `Engine 4`) is added, the active item was visibly marked while moving; then the header `AC 1` is active and Enter hides its row `T_SOLL`, and the next ArrowDown makes the header `CGW 2` active
- **Evidence:** UI check (screenshot); `apps/web/test/explorer.test.ts` › "groups matches by best hit, Other last, collapsed on an empty query" (item order)

#### Scenario: Esc clears
- **WHEN** the search field holds `temp` and the user presses Esc
- **THEN** the field is empty, the full list is shown (with the shipped `kipscope.yaml`: every group header, all collapsed) and the active item is the first one
- **Evidence:** UI check (screenshot)
