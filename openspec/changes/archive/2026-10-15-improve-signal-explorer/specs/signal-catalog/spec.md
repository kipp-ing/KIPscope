## MODIFIED Requirements

### Requirement: Signal search
The catalog SHALL support a case-insensitive text search that splits the query at whitespace into terms and matches a signal when every term occurs as a substring of its name, description, alias or unit. Results SHALL be ordered as in "Search ranking". The search API SHALL return results within a bounded page size. Origin: concept §4, D-017 („bei eingabe in suchliste filtern auch auf teile").

#### Scenario: Match by description
- **WHEN** a user searches for a term that only occurs in a signal's description
- **THEN** that signal is in the results

#### Scenario: Large catalog
- **WHEN** the source has 10,000 signals and the query matches most of them
- **THEN** the result is limited to one page and indicates that more matches exist

#### Scenario: Match on a part of the name
- **WHEN** the query is `anz` and the catalog holds `COMBI_412h.V_ANZ`
- **THEN** `COMBI_412h.V_ANZ` is in the results, although `anz` is neither the whole name nor its start
- **Evidence:** `packages/shared/test/search.test.ts` › "matches parts of name, description and unit case-insensitively"

#### Scenario: All terms must match
- **WHEN** the query is `temp mot` and one signal has `temp` only in its description and `mot` only in its name, while another has only `temp`
- **THEN** the first signal is a result and the second is not
- **Evidence:** `packages/shared/test/search.test.ts` › "requires every term to match"

### Requirement: Signal explorer in the UI
The UI SHALL offer a signal explorer that searches the catalog and lists each result on one line with its name, unit and an SNA marker, and lets the user add a signal to a window. Further metadata SHALL be shown in a hover card (see "Signal hover card"), not inline. Origin: concept §4, D-017 („signalexplorer als liste mit hover infos").

#### Scenario: Add signal from explorer
- **WHEN** the user searches, selects a result and adds it to a window
- **THEN** the signal appears in that window

#### Scenario: SNA values shown in explorer
- **WHEN** the user searches for `V_ANZ` on real data
- **THEN** the row `COMBI_412h.V_ANZ` shows an SNA dot whose tooltip reads `SNA 511 km/h`, its hover card shows `511 km/h (raw 1FFh)` under SNA, and the row `BS_208h.SZS` (no SNA codes, D-014) shows no dot
- **Evidence:** UI check (screenshot of the explorer with the V_ANZ card open)

#### Scenario: One line per signal
- **WHEN** the user searches for `temp` on real data
- **THEN** every result row is a single line and no description, SNA text or data reference appears in the list itself; goals, measured and reported but not pass/fail: row height ≤ 24 px (`getBoundingClientRect`) and at least 25 rows visible without scrolling at a 900 px tall browser window (today about 10)
- **Evidence:** UI check (screenshot plus the measured row height and visible row count)

## ADDED Requirements

### Requirement: Search ranking
Results SHALL be ordered by tier, best first: (0) a term equals the name or its part after the first `.`; (1) one of them starts with the term; (2) the name contains it; (3) only description, alias or unit do. A signal's tier is its worst term's tier; within a tier catalog order holds. API and explorer SHALL rank alike. Origin: D-018 ("explorer ranking"); tiers from the power-user report point 5.

#### Scenario: Exact before prefix before substring before description
- **WHEN** the catalog holds `A_100h.DIFF_V_ANZ`, `B_200h.SPEED` (description `copy of V_ANZ`), `C_300h.V_ANZ_RAW` and `COMBI_412h.V_ANZ`, and the query is `v_anz`
- **THEN** the order is `COMBI_412h.V_ANZ`, `C_300h.V_ANZ_RAW`, `A_100h.DIFF_V_ANZ`, `B_200h.SPEED`
- **Evidence:** `packages/shared/test/search.test.ts` › "ranks exact before prefix before name substring before other fields"

#### Scenario: Message prefix and full name
- **WHEN** the query is `combi_412h.v_anz` or `combi`
- **THEN** `COMBI_412h.V_ANZ` is tier 0 for the first and tier 1 for the second
- **Evidence:** `packages/shared/test/search.test.ts` › "treats the part after the first dot as the signal name"

#### Scenario: Ties keep catalog order
- **WHEN** two signals share a tier (e.g. `othercar/Fast_100h.SIG_A` and `testcar/Fast_100h.SIG_A` for `sig_a`), and the query is empty
- **THEN** ties are ordered by name, then data reference, and the empty query returns every signal in catalog order
- **Evidence:** `packages/shared/test/search.test.ts` › "keeps catalog order within a tier and for an empty query"

#### Scenario: API ranks like the explorer
- **WHEN** the test catalog is searched for `rpm`
- **THEN** `testcar/Sna_800h.RPM` (exact) comes before the `Fast_100h.SIG_A` entries (unit `rpm`); on real data `curl -s 'localhost:7310/api/signals?q=volt' | jq -r '.items[0].id'` prints `smart451/CPC_168h.EAC_HV_Volt` (first name match; before ranking it was the description match `smart451/AC_443h.PNHV_Evap_CoolVlv_Rq_HVAC`)
- **Evidence:** `apps/server/test/catalog.test.ts` › "ranks search results like the explorer"; the curl command

### Requirement: Full catalog listing
The API SHALL return the whole catalog in one response, unpaged, with every field of each entry, for clients that search locally. Before the catalog has loaded once it SHALL answer 503 `catalog_unavailable`, like the search. Origin: necessary consequence of filtering in the browser without a hard cap (D-018) and without visible lag (power-user report point 5).

#### Scenario: All signals in one response
- **WHEN** a client requests the full catalog from the test DB catalog
- **THEN** it receives every signal (as many as `/api/signals` reports as `total` for an empty query, including `testcar/Many_700h.S0999`) and the load time
- **Evidence:** `apps/server/test/signals.http.test.ts` › "returns the full catalog without a page limit"; on real data `curl -s localhost:7310/api/catalog | jq '.items | length'` equals `curl -s 'localhost:7310/api/signals?q=' | jq .total`

#### Scenario: Catalog not loaded yet
- **WHEN** the full catalog is requested before the first successful load
- **THEN** the response is 503 with code `catalog_unavailable`
- **Evidence:** `apps/server/test/signals.http.test.ts` › "answers 503 before the catalog was ever loaded, and 502 on refresh" (extended to `/api/catalog`)

### Requirement: DBC details per signal
For a signal with a DBC entry the catalog SHALL return the DBC file it came from, the message name and CAN ID, and where the `SG_` line parses: factor, offset, min and max as written; plus the `VAL_` table sorted by raw value. A signal without DBC entry SHALL have no DBC details; absent fields stay absent. Origin: concept §4 („Vorhandene Metadaten werden angezeigt"), D-017 (hover infos).

#### Scenario: Speed signal from the real DBC
- **WHEN** the catalog lists `smart451/COMBI_412h.V_ANZ` (`BO_ 1042 COMBI_412h`, `SG_ V_ANZ : 0|9@0+ (1,0) [0|510] "km/h"`, `VAL_ 1042 V_ANZ 511 "SNV"`)
- **THEN** its DBC details are file `h-can.dbc`, message `COMBI_412h`, ID 1042, factor 1, offset 0, min 0, max 510, values `[{raw 511, label SNV}]`
- **Evidence:** `apps/server/test/dbc.test.ts` › "derives DBC details from the real h-can.dbc" (runs if the file exists; also `MS_608h.T_MOT` 1544, factor 1, offset −40, min −40, max 214; `BS_200h.DVL` 512, factor 0.5, max 8191); `curl -s 'localhost:7310/api/signals?q=COMBI_412h.V_ANZ' | jq -cS '.items[0].dbc'` prints `{"factor":1,"file":"h-can.dbc","max":510,"message":"COMBI_412h","messageId":1042,"min":0,"offset":0,"values":[{"label":"SNV","raw":511}]}`

#### Scenario: Details from the fixture DBCs
- **WHEN** the test DBCs are loaded (`test-a.dbc` before `test-b.dbc`)
- **THEN** `Fast_100h.SIG_C` has message `Fast_100h`, ID 256, factor 1, offset 0, min −100, max 100, file `test-a.dbc`; `Sparse_300h.MODE` has values `[{0, off}, {1, on}]`; `Irr_200h.JITTER` has min 0 and max 0 as written; `Many_700h.S0001` has file `test-b.dbc`
- **Evidence:** `apps/server/test/dbc.test.ts` › "reads message, scaling, range, value table and file"

#### Scenario: Signal without DBC entry
- **WHEN** a signal has data but no DBC entry (`testcar/Nodbc_500h.RAW`)
- **THEN** its catalog entry has no `dbc` field
- **Evidence:** `apps/server/test/catalog.test.ts` › "lists a signal without DBC entry with its name only" (unchanged `toEqual`)

### Requirement: Match highlighting
The explorer SHALL highlight every matched part of the query terms in the displayed name and unit of each row, and in the description inside the hover card. Overlapping matches SHALL be shown as one highlight. Origin: D-018 ("match highlighting").

#### Scenario: Highlight in the name
- **WHEN** the user searches for `volt` on real data
- **THEN** the row `CPC_448h.PTC_HV_Volt` shows `Volt` highlighted (one `<mark>` element) and the rest of the name plain
- **Evidence:** UI check (screenshot; `document.querySelectorAll('.explorer mark')` text); `packages/shared/test/search.test.ts` › "returns merged highlight ranges for name, unit and description" (`volt` on `CPC_448h.PTC_HV_Volt` → name `[[16, 20]]`; `v_a anz` on `COMBI_412h.V_ANZ` → `[[11, 16]]`)

#### Scenario: Description match shown in the card
- **WHEN** the user searches for `temp` on real data and hovers `MS_608h.T_MOT` (description `Motortemperatur`)
- **THEN** the row has no highlight in the name, rows whose name contains `TEMP` are listed above it, and the card shows `temp` highlighted in `Motortemperatur`
- **Evidence:** UI check (screenshot of the card)

### Requirement: No hard cap on results
The explorer SHALL make every match reachable: it shows the total match count and, when not all matches are rendered, a control that renders more. No fixed limit SHALL hide matches. Origin: D-018 ("without a hard cap").

#### Scenario: Whole catalog reachable
- **WHEN** the search field is empty on real data
- **THEN** the count reads the catalog size (e.g. `428 matches`), there is no `showing 100`, and scrolling to the end of the list reaches the alphabetically last signal
- **Evidence:** UI check (screenshot of the list end and the count)

#### Scenario: Show more beyond one chunk
- **WHEN** a search matches more signals than one render chunk (test catalog, empty query, 1,013 signals)
- **THEN** a "Show N more" control appears, and using it until it disappears renders all matches
- **Evidence:** `apps/web/test/explorer.test.ts` › "renders matches in chunks until all are visible" (pure chunking helper). On real data (428 signals < 500) the control never appears, so the helper test is the only evidence; the UI user does not check it.

### Requirement: Filtering without visible lag
The explorer SHALL update its list on every keystroke without a request to the server. Goal: ranking 10,000 signals takes under 50 ms. Origin: power-user report point 5 ("results lag typing", expectation "no visible lag"); the number is a goal.

#### Scenario: No request while typing
- **WHEN** the user types `temperatur` quickly into the search on real data
- **THEN** the list narrows after each character and the network log shows no `/api/signals` or `/api/catalog` request during typing
- **Evidence:** UI check (network log excerpt, screenshot)

#### Scenario: Ranking speed
- **WHEN** 10,000 synthetic signals with descriptions are ranked for `temp`
- **THEN** the median of 5 runs is under 50 ms
- **Evidence:** `packages/shared/test/search.test.ts` › "ranks 10,000 signals in under 50 ms"

### Requirement: Signal hover card
Resting the pointer on a row, or making it active by keyboard, for 350 ms SHALL open a card with name, description, message and CAN ID, unit, scaling, raw step, DBC range, SNA codes, value table, source (data reference, DBC file) and the windows showing the signal. Absent fields SHALL be omitted, never shown empty or invented. Origin: D-017 („mit hover infos"); fields: power-user report point 4; keyboard: D-020; 350 ms is a goal.

#### Scenario: Card for V_ANZ
- **WHEN** the user hovers `COMBI_412h.V_ANZ` on real data and the signal is shown in one window
- **THEN** after about a third of a second a card shows `COMBI_412h.V_ANZ`, `Indicated speed`, `COMBI_412h · 0x412`, unit `km/h`, scaling `× 1 + 0`, raw step `1 km/h`, range `0 … 510 km/h`, SNA `511 km/h (raw 1FFh)`, values `511 SNV`, source `smart451 · h-can.dbc`, and under "Shown in" that window's name as its header shows it (its title, or `Window <n>` when untitled)
- **Evidence:** UI check (screenshot of the card)

#### Scenario: Card with offset
- **WHEN** the user hovers `MS_608h.T_MOT` on real data
- **THEN** the card shows scaling `× 1 - 40`, raw step `1 °C`, range `-40 … 214 °C`, and "Shown in" reads `no window` when no window shows it
- **Evidence:** UI check (screenshot of the card); `apps/web/test/explorer.test.ts` › "formats scaling, raw step and DBC range"

#### Scenario: Card formatting rules
- **WHEN** a signal has DBC range `[0|0]`, an extended CAN ID, or no DBC entry
- **THEN** the range reads `not set`, the ID reads in hex with bit 31 cleared and `(ext)`, and a signal without DBC entry shows its source as `<dataRef> · no DBC entry` with no message, scaling, range, SNA or value lines
- **Evidence:** `apps/web/test/explorer.test.ts` › "formats scaling, raw step and DBC range", "formats message IDs as hex", "formats the source line", "lists the windows showing a signal"

#### Scenario: Card on keyboard focus
- **WHEN** the user types `DVL`, presses ArrowDown once and waits
- **THEN** the card for the second row opens without any pointer movement, and moving the active row moves the card
- **Evidence:** UI check (screenshot)

#### Scenario: No flicker while sweeping
- **WHEN** the user moves the pointer quickly down across ten rows without resting
- **THEN** no card opens; once a card is open, moving to a neighbouring row switches the card at once
- **Evidence:** UI check (description of the observed behaviour)

### Requirement: Explorer keys
The explorer SHALL support: `/` focuses the search field when focus is not in a text field (the `/` is not typed); Esc in the search field clears the query and closes the card; ArrowDown/ArrowUp move the active row (first hit by default, clamped at the ends) and keep it in view; Enter adds the active row exactly as its add button does. Origin: D-020 ("The explorer list is keyboard-driven: `/` focuses the search, arrow keys move, Enter adds, Esc clears.").

#### Scenario: Search, Enter adds the top hit
- **WHEN** focus is on the page body, the user presses `/`, types `V_ANZ` and presses Enter
- **THEN** the search field contains exactly `V_ANZ` and `COMBI_412h.V_ANZ` is added to the selected "Add to" target
- **Evidence:** UI check (screenshot of the new window)

#### Scenario: Arrows choose another hit
- **WHEN** the user types `DVL`, presses ArrowDown twice and Enter
- **THEN** the third result is added, and the active row was visibly marked while moving
- **Evidence:** UI check (screenshot)

#### Scenario: Esc clears
- **WHEN** the search field holds `temp` and the user presses Esc
- **THEN** the field is empty, the full list is shown and the active row is the first one
- **Evidence:** UI check (screenshot)

### Requirement: Explorer rows are a drag source
Pressing on an explorer row's name and moving the pointer SHALL start the app's pointer drag (design S3) with that signal. Windows that do not show it and stay within four units SHALL be highlighted with "Drop to add"; one that would reach a fifth unit SHALL be marked not droppable ("At most 4 units per window") and ignore a drop. A drop adds, never moves; Alt/Ctrl change nothing. The add button SHALL NOT start a drag. Origin: D-020 (explorer drag; fifth unit refused as for legend drags).

#### Scenario: Drag a row onto a window
- **WHEN** a window exists that does not show `COMBI_412h.V_ANZ`, and the user drags the V_ANZ row onto it with the mouse
- **THEN** windows not showing V_ANZ are highlighted with "Drop to add" while dragging, a window showing it is not highlighted, the ghost reads `COMBI_412h.V_ANZ · add` over a valid target, the hover card is closed, and after the drop the signal appears in that window while the explorer row stays
- **Evidence:** UI check (screenshot during the drag and after the drop); `apps/web/test/drag.test.ts` › "adds an explorer signal to windows not showing it and to a new window"

#### Scenario: Fifth unit refused for an explorer drag
- **WHEN** window A shows `CPC_168h.EAC_HV_Volt` (V), `COMBI_412h.V_ANZ` (km/h), `MS_608h.T_MOT` (°C) and `BS_200h.DVL` (1/min), and the user drags the `MS_312h.DNMOT` (`rpm/10ms`) row over A and releases
- **THEN** A is marked not droppable with the hint "At most 4 units per window" while dragging, and the release changes nothing (revision unchanged); dragging `CPC_448h.PTC_HV_Volt` (V) over A highlights it with "Drop to add"
- **Evidence:** `apps/web/test/drag.test.ts` › "refuses an explorer drop that would make a fifth unit"; UI check (screenshot while dragging, revision before and after)

#### Scenario: Legend drags unchanged
- **WHEN** a legend row is dragged after this change
- **THEN** source, target and refused states, the hint "Drop to move · Alt/Ctrl+drop to copy" and move/copy behave as before
- **Evidence:** `apps/web/test/drag.test.ts` › "keeps the legend-drag states" and the existing drag tests

#### Scenario: Drag a row onto "+ New window"
- **WHEN** the user drags the `BS_200h.DVL` row onto the "+ New window" zone
- **THEN** a new window `Window <n>` with DVL is created, exactly as with the add button and "New window" selected
- **Evidence:** UI check (screenshot); `apps/web/test/drag.test.ts` › "adds an explorer signal to windows not showing it and to a new window"

#### Scenario: Click is not a drag
- **WHEN** the user clicks a row's name or its add button without moving the pointer
- **THEN** no drag starts (no ghost, no highlighted targets)
- **Evidence:** UI check

### Requirement: Stable "Add to" target
The explorer's "Add to" target SHALL be held by window ID and change only by the user's own choice, or fall back to "New window" when its window is removed. Creating, renaming or reordering windows, new state revisions and query changes SHALL NOT change it. The add button SHALL name the target it adds to; Enter adds to the same target. Origin: D-020 („The "Add to" target stays where the user put it; creating, renaming or reordering windows does not move it.“).

#### Scenario: Target survives window changes
- **WHEN** windows `w1` and `w2` exist, the user selects `w2`, then a third window is created (via "New window" add or the CLI) and `w1` is renamed
- **THEN** the target is still `w2`, and the next add (button or Enter) lands in `w2`
- **Evidence:** `apps/web/test/explorer.test.ts` › "keeps the Add to target by window ID while windows change"; UI check (add T_SOLL after creating another window; screenshot shows it in the selected window)

#### Scenario: Removed target falls back
- **WHEN** the selected target window is removed
- **THEN** the target becomes "New window" and the select shows it
- **Evidence:** `apps/web/test/explorer.test.ts` › "keeps the Add to target by window ID while windows change"

#### Scenario: Add button names its target
- **WHEN** the user points at a row's add button with target `w2` titled `Speeds`
- **THEN** its tooltip and accessible name read `Add to Speeds` (`Add to new window` for "New window")
- **Evidence:** UI check (screenshot of the tooltip)
