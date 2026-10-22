## MODIFIED Requirements

### Requirement: Grouped explorer list
When at least one catalog entry has a group, the explorer SHALL show the matches under group headers (marker, name, match count; one line ≤ 24 px). Empty search: every group, collapsed, by name. Searching: only groups with a match, open, by best match, rank order inside. `Other` always last. The user's Favourites group (capability `favourites`, "Favourites group") SHALL come before all of these and follow its own rules; it SHALL NOT change the groups below it, their order, counts or state. The scenarios below hold for a user without favourites. Origin: D-053 („Empty search: all groups, collapsed. While searching: only groups with a hit, all open, ordered by their best hit …"; `Other` „always last"); name order: design G6; Favourites above: D-102 with D-080 (P1 „top of the explorer").

#### Scenario: Group order and state
- **WHEN** `explorerItems` gets ranked matches from groups `ESP` (ranks 3, 5), `Other` (rank 1), `CGW` (rank 2) and `AC` (rank 4)
- **THEN** while searching with nothing toggled the items are header `CGW` (count 1, open), its match, header `ESP` (2, open), ranks 3 and 5, header `AC` (1), rank 4, header `Other` (1), rank 1, and `firstSignal` is 1; with an empty query (catalog order) they are the headers `AC`, `CGW`, `ESP`, `Other`, all closed, no signal item, and `firstSignal` is 0; toggling `ESP` on the empty query opens just `ESP`, toggling it while searching closes just `ESP`; with `grouped` false the items are the five matches in rank order without headers
- **Evidence:** `apps/web/test/explorer.test.ts` › "groups matches by best hit, Other last, collapsed on an empty query"

#### Scenario: Empty search on real data
- **WHEN** the explorer is shown on real data with the local `kipscope.yaml` and an empty search
- **THEN** it lists fourteen collapsed headers `AC 21`, `CGW 39`, `DCU 89`, `Engine 63`, `EPS 3`, `ESP 64`, `EWM 6`, `HVM 10`, `SAM 35`, `SAS 6`, `SRS 13`, `TCU 38`, `YRG 23`, `Other 18` and no signal row, the count reads `428 matches`; a click on `ESP` shows its 64 rows below it, a second click hides them
- **Evidence:** UI check (screenshot collapsed and with `ESP` open; header height via `getBoundingClientRect`)

#### Scenario: Search on real data
- **WHEN** the user types `temp` on real data with the local `kipscope.yaml`
- **THEN** the list shows, all open, `Engine 4` with `TEMP_COOL`, `T_OIL`, `T_AIR`, `T_ENG`, then `DCU 5` with `COMP_Temp_Excess`, `COMP_TempLmt_Boost`, `HTR_CtrlTemp`, `HTR_ShtDn_SensFlt`, `OverTemp_Lamp`, then `HVM 1`, then `AC 1` with `T_SET`, then `CGW 2` with `T_OUTSIDE`, `T_OUTSIDE_RAW`, and no `Other`; the count reads `13 matches`; the row `TEMP_COOL` is active
- **Evidence:** UI check (screenshot)

#### Scenario: Groups unchanged below the Favourites group
- **WHEN** `explorerItems` gets the matches of "Group order and state" with favourites the names of ranks 5 and 2, searching and with an empty query
- **THEN** the items after the Favourites header and its copies are exactly the items of "Group order and state" for the same query, counts included
- **Evidence:** `apps/web/test/explorer.test.ts` › "puts favourites in a group at the top"

### Requirement: Group collapse
A click on a group header, or Enter while it is the active item, SHALL open or close that group. Each query change SHALL restore the state of "Grouped explorer list"; the state SHALL NOT be remembered, also not across a reload. When no entry has a group, the list SHALL be flat as before this change, below the Favourites group when the user has favourites in the list (capability `favourites`). Origin: D-053 (state per empty or running search); header click and Enter, no remembered state: design G6; flat list: necessary consequence of D-035's "no file … as today"; Favourites above the flat list: D-102 with D-080 (P1 „top of the explorer").

#### Scenario: Toggle and reset
- **WHEN** on real data with the local `kipscope.yaml` the user opens `ESP` and `AC` on the empty search, types `t`, deletes it again, then reloads the page
- **THEN** after deleting all groups are collapsed again, and after the reload too
- **Evidence:** UI check (screenshot after deleting and after the reload); `apps/web/test/explorer.test.ts` › "groups matches by best hit, Other last, collapsed on an empty query" (toggled set)

#### Scenario: No groups, flat list
- **WHEN** the catalog has no `group` on any entry (no `display.groups`) and the user has no favourites
- **THEN** no header is rendered and the rows are exactly the ranked matches, as before this change
- **Evidence:** `apps/web/test/explorer.test.ts` › "groups matches by best hit, Other last, collapsed on an empty query" (`grouped` false); `renderToStaticMarkup` or helper check that no `.group-head` exists for a flat list

#### Scenario: Flat list with favourites
- **WHEN** the catalog has no `group` on any entry and one match is a favourite
- **THEN** the only header is `★ Favourites` with that row under it, followed by all ranked matches without headers
- **Evidence:** `apps/web/test/explorer.test.ts` › "puts favourites in a group at the top" (`grouped` false)
