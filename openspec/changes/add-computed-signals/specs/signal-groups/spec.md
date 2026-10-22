## MODIFIED Requirements

### Requirement: Grouped explorer list
When at least one catalog entry has a group, the explorer SHALL show the matches under group headers (marker, name, match count; one line ≤ 24 px). Empty search: every group, collapsed, by name. Searching: only groups with a match, open, by best match, rank order inside. `Other` always last. The user's Favourites group (capability `favourites`, "Favourites group") SHALL come before all of these and follow its own rules; it SHALL NOT change the groups below it, their order, counts or state. The Computed section (capability `computed-signals`, "Computed section in the explorer") SHALL come right after the Favourites group and before the groups, with the same guarantee. The scenarios below hold for a user without favourites and a list without the Computed section. Origin: D-053 („Empty search: all groups, collapsed. While searching: only groups with a hit, all open, ordered by their best hit …"; `Other` „always last"); name order: design G6; Favourites above: D-102 with D-080 (P1 „top of the explorer"); Computed right under Favourites: D-104.

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


#### Scenario: Groups unchanged below the Computed section
- **WHEN** `explorerItems` gets the matches of "Group order and state" with one computed match, searching and with an empty query
- **THEN** the items after the `ƒ Computed` header and its row are exactly the items of "Group order and state" for the same query, counts included
- **Evidence:** `apps/web/test/explorer.test.ts` › "puts the Computed section under Favourites"
