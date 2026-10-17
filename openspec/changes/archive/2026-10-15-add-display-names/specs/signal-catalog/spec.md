## MODIFIED Requirements

### Requirement: Signal search
The catalog SHALL support a case-insensitive text search that splits the query at whitespace into terms and matches a signal when every term occurs as a substring of its name, shown name (display-names), description, alias or unit. Results SHALL be ordered as in "Search ranking". The search API SHALL return results within a bounded page size. Origin: concept §4, D-017 („bei eingabe in suchliste filtern auch auf teile"); shown name: D-035 („search matches full name, short name and message alike").

#### Scenario: Match by description
- **WHEN** a user searches for a term that only occurs in a signal's description
- **THEN** that signal is in the results

#### Scenario: Large catalog
- **WHEN** the source has 10,000 signals and the query matches most of them
- **THEN** the result is limited to one page and indicates that more matches exist

#### Scenario: Match on a part of the name
- **WHEN** the query is `disp` and the catalog holds `ICL_3A2h.SPEED_DISP`
- **THEN** `ICL_3A2h.SPEED_DISP` is in the results, although `disp` is neither the whole name nor its start
- **Evidence:** `packages/shared/test/search.test.ts` › "matches parts of name, description and unit case-insensitively"

#### Scenario: All terms must match
- **WHEN** the query is `temp mot` and one signal has `temp` only in its description and `mot` only in its name, while another has only `temp`
- **THEN** the first signal is a result and the second is not
- **Evidence:** `packages/shared/test/search.test.ts` › "requires every term to match"

#### Scenario: Match by shown name only
- **WHEN** `ICL_3A2h.SPEED_DISP` has the shown name `Speed` (a rename) and the query is `spe`
- **THEN** `ICL_3A2h.SPEED_DISP` is in the results; the query `icl` still finds it through the full name
- **Evidence:** `packages/shared/test/search.test.ts` › "ranks the shown name like the name"

### Requirement: Search ranking
Results SHALL be ordered by tier, best first: (0) a term equals the name, its part after the first `.`, or the shown name; (1) one of them starts with the term; (2) the name or the shown name contains it; (3) only description, alias or unit do. A signal's tier is its worst term's tier; within a tier catalog order holds. API and explorer SHALL rank alike. Origin: D-018 ("explorer ranking"); tiers from the power-user report point 5; shown name like the name: D-035.

#### Scenario: Exact before prefix before substring before description
- **WHEN** the catalog holds `A_100h.DIFF_SPEED_DISP`, `B_200h.SPEED` (description `copy of SPEED_DISP`), `C_300h.SPEED_DISP_RAW` and `ICL_3A2h.SPEED_DISP`, and the query is `speed_disp`
- **THEN** the order is `ICL_3A2h.SPEED_DISP`, `C_300h.SPEED_DISP_RAW`, `A_100h.DIFF_SPEED_DISP`, `B_200h.SPEED`
- **Evidence:** `packages/shared/test/search.test.ts` › "ranks exact before prefix before name substring before other fields"

#### Scenario: Message prefix and full name
- **WHEN** the query is `icl_3a2h.speed_disp` or `icl`
- **THEN** `ICL_3A2h.SPEED_DISP` is tier 0 for the first and tier 1 for the second
- **Evidence:** `packages/shared/test/search.test.ts` › "treats the part after the first dot as the signal name"

#### Scenario: Shown name tiers
- **WHEN** `ICL_3A2h.SPEED_DISP` has shown name `Speed`, `B_200h.SPEED_RAW` has none, and `C_300h.X` has shown name `SPEED_DISP (C)`, and the queries are `speed`, `spe` and `(c)`
- **THEN** for `speed` `ICL_3A2h.SPEED_DISP` is tier 0 and `B_200h.SPEED_RAW` tier 1; for `spe` both are tier 1; for `(c)` `C_300h.X` is tier 2
- **Evidence:** `packages/shared/test/search.test.ts` › "ranks the shown name like the name"

#### Scenario: Ties keep catalog order
- **WHEN** two signals share a tier (e.g. `othercar/Fast_100h.SIG_A` and `testcar/Fast_100h.SIG_A` for `sig_a`), and the query is empty
- **THEN** ties are ordered by name, then data reference, and the empty query returns every signal in catalog order
- **Evidence:** `packages/shared/test/search.test.ts` › "keeps catalog order within a tier and for an empty query"

#### Scenario: API ranks like the explorer
- **WHEN** the test catalog is searched for `rpm`
- **THEN** `testcar/Sna_800h.RPM` (exact) comes before the `Fast_100h.SIG_A` entries (unit `rpm`); on real data `curl -s 'localhost:7310/api/signals?q=volt' | jq -r '.items[0].id'` prints `smart451/DCU_1F4h.COMP_HV_Volt` (first name match; before ranking it was the description match `smart451/CLIM_44Ch.HVM_Evap_Vlv_Rq`)
- **Evidence:** `apps/server/test/catalog.test.ts` › "ranks search results like the explorer"; the curl command

#### Scenario: API ranks shown names
- **WHEN** the test DB catalog is built with the test project file (display-names design N10) and searched for `spee` through `/api/signals`
- **THEN** the first two items are `testcar/Irr_200h.JITTER` (shown `SPEED`, a rename; tier 1 by its shown name) and `testcar/Sna_800h.SPEED` (shown `SPEED (Sna)`; tier 1), in this catalog order, before any description-only match
- **Evidence:** `apps/server/test/signals.http.test.ts` › "returns displayName in search and full catalog and keeps IDs"

### Requirement: Signal explorer in the UI
The UI SHALL offer a signal explorer that searches the catalog and lists each result on one line with its shown name (display-names), unit and an SNA marker, and lets the user add a signal to a window. Further metadata, including the full source name, SHALL be shown in a hover card (see "Signal hover card"), not inline. Origin: concept §4, D-017 („signalexplorer als liste mit hover infos"); shown name: D-035.

#### Scenario: Add signal from explorer
- **WHEN** the user searches, selects a result and adds it to a window
- **THEN** the signal appears in that window

#### Scenario: SNA values shown in explorer
- **WHEN** the user searches for `SPEED_DISP` on real data with the shipped `kipscope.yaml`
- **THEN** the row `SPEED_DISP` (`ICL_3A2h.SPEED_DISP`) shows an SNA dot whose tooltip reads `SNA 511 km/h`, its hover card shows `511 km/h (raw 1FFh)` under SNA, and the row `BRK_SW` (`BRK_21Ch.BRK_SW`, no SNA codes, D-014) shows no dot
- **Evidence:** UI check (screenshot of the explorer with the SPEED_DISP card open)

#### Scenario: One line per signal
- **WHEN** the user searches for `temp` on real data
- **THEN** every result row is a single line and no description, SNA text or data reference appears in the list itself; goals, measured and reported but not pass/fail: row height ≤ 24 px (`getBoundingClientRect`) and at least 25 rows visible without scrolling at a 900 px tall browser window (today about 10)
- **Evidence:** UI check (screenshot plus the measured row height and visible row count)

### Requirement: Match highlighting
The explorer SHALL highlight every matched part of the query terms in the shown name and unit of each row, and in the full name and description inside the hover card. Overlapping matches SHALL be shown as one highlight. Origin: D-018 ("match highlighting"); shown name in the row, full name in the card: D-035.

#### Scenario: Highlight in the name
- **WHEN** the user searches for `volt` on real data with the shipped `kipscope.yaml`
- **THEN** the row `HTR_HV_Volt` (`DCU_2B8h.HTR_HV_Volt`) shows `Volt` highlighted (one `<mark>` element) and the rest of the name plain
- **Evidence:** UI check (screenshot; `document.querySelectorAll('.explorer mark')` text); `packages/shared/test/search.test.ts` › "returns merged highlight ranges for name, unit and description" (`volt` on `DCU_2B8h.HTR_HV_Volt` → name `[[16, 20]]`; `v_a disp` on `ICL_3A2h.SPEED_DISP` → `[[11, 16]]`) and › "returns highlight ranges in the shown name" (`volt` on `DCU_2B8h.HTR_HV_Volt` shown `HTR_HV_Volt` → shown `[[7, 11]]`; without `displayName` shown ranges equal name ranges; empty query → `[]`)

#### Scenario: Description match shown in the card
- **WHEN** the user searches for `temp` on real data and hovers `T_ENG` (`ENG_5E0h.T_ENG`, description `Motortemperatur`)
- **THEN** the row has no highlight in the name, rows whose name contains `TEMP` are listed above it, and the card shows `temp` highlighted in `Motortemperatur`
- **Evidence:** UI check (screenshot of the card)

### Requirement: Explorer rows are a drag source
Pressing on an explorer row's name and moving the pointer SHALL start the app's pointer drag (design S3) with that signal; the ghost SHALL show the signal's shown name. Windows that do not show it and stay within four units SHALL be highlighted with "Drop to add"; one that would reach a fifth unit SHALL be marked not droppable ("At most 4 units per window") and ignore a drop. A drop adds, never moves; Alt/Ctrl change nothing. The add button SHALL NOT start a drag. Origin: D-020 (explorer drag; fifth unit refused as for legend drags); shown name in the ghost: D-035.

#### Scenario: Drag a row onto a window
- **WHEN** a window exists that does not show `ICL_3A2h.SPEED_DISP`, and the user drags the `SPEED_DISP` row onto it with the mouse (shipped `kipscope.yaml`)
- **THEN** windows not showing SPEED_DISP are highlighted with "Drop to add" while dragging, a window showing it is not highlighted, the ghost reads `SPEED_DISP · add` over a valid target, the hover card is closed, and after the drop the signal appears in that window while the explorer row stays
- **Evidence:** UI check (screenshot during the drag and after the drop); `apps/web/test/drag.test.ts` › "adds an explorer signal to windows not showing it and to a new window"

#### Scenario: Fifth unit refused for an explorer drag
- **WHEN** window A shows `DCU_1F4h.COMP_HV_Volt` (V), `ICL_3A2h.SPEED_DISP` (km/h), `ENG_5E0h.T_ENG` (°C) and `BRK_1A0h.WSPD_FL` (1/min), and the user drags the `ENG_2E8h.MOT_SPD_D` (`rpm/10ms`) row over A and releases
- **THEN** A is marked not droppable with the hint "At most 4 units per window" while dragging, and the release changes nothing (revision unchanged); dragging `DCU_2B8h.HTR_HV_Volt` (V) over A highlights it with "Drop to add"
- **Evidence:** `apps/web/test/drag.test.ts` › "refuses an explorer drop that would make a fifth unit"; UI check (screenshot while dragging, revision before and after)

#### Scenario: Legend drags unchanged
- **WHEN** a legend row is dragged after this change
- **THEN** source, target and refused states, the hint "Drop to move · Alt/Ctrl+drop to copy" and move/copy behave as before
- **Evidence:** `apps/web/test/drag.test.ts` › "keeps the legend-drag states" and the existing drag tests

#### Scenario: Drag a row onto "+ New window"
- **WHEN** the user drags the `WSPD_FL` row (`BRK_1A0h.WSPD_FL`) onto the "+ New window" zone
- **THEN** a new window `Window <n>` with WSPD_FL is created, exactly as with the add button and "New window" selected
- **Evidence:** UI check (screenshot); `apps/web/test/drag.test.ts` › "adds an explorer signal to windows not showing it and to a new window"

#### Scenario: Click is not a drag
- **WHEN** the user clicks a row's name or its add button without moving the pointer
- **THEN** no drag starts (no ghost, no highlighted targets)
- **Evidence:** UI check
