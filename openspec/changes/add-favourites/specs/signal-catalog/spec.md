## MODIFIED Requirements

### Requirement: Explorer keys
The explorer SHALL support: `/` focuses the search field when focus is not in a text field (the `/` is not typed); Esc in the search field clears the query and closes the card; ArrowDown/ArrowUp move the active item (clamped at the ends) and keep it in view; Enter adds the active row exactly as its add button does; `Ctrl+D` (`Cmd+D` on macOS) stars or unstars the active row or the selection (capability `favourites`, "Star a selection or by key"). With groups (capability `signal-groups`) the items include the group headers: Enter on a header opens or closes its group and keeps it active. After each query change the active item SHALL be, while searching, the first row of the best-ranked match (its copy in the Favourites group when it is a favourite); with an empty query the first signal row shown; the first item when no row is shown. Origin: D-020 ("The explorer list is keyboard-driven: `/` focuses the search, arrow keys move, Enter adds, Esc clears."); headers: D-053 with design G6; best hit with favourites first: necessary consequence (Enter keeps adding the top hit, D-020) of D-102's Favourites group; star key: favourites design Q-4.

#### Scenario: Search, Enter adds the top hit
- **WHEN** focus is on the page body, the user presses `/`, types `SPEED_DISP` and presses Enter
- **THEN** the search field contains exactly `SPEED_DISP` and `ICL_3A2h.SPEED_DISP` is added to the selected "Add to" target (also with the header `CGW 1` above the row)
- **Evidence:** UI check (screenshot of the new window)

#### Scenario: Arrows choose another hit
- **WHEN** with the local `kipscope.yaml` and no favourites the user types `temp`, presses ArrowDown twice and Enter; then ArrowDown twice more, Enter, ArrowDown once
- **THEN** `ENG_5E0h.T_AIR` (third row under `Engine 4`) is added, the active item was visibly marked while moving; then the header `DCU 5` is active and Enter hides its five rows, and the next ArrowDown makes the header `HVM 1` active
- **Evidence:** UI check (screenshot); `apps/web/test/explorer.test.ts` › "groups matches by best hit, Other last, collapsed on an empty query" (item order)

#### Scenario: Esc clears
- **WHEN** the search field holds `temp` and the user presses Esc
- **THEN** the field is empty, the full list is shown (with the local `kipscope.yaml`: every group header, all collapsed, and the Favourites group open above them when the user has favourites in the list) and the active item is the first signal row shown, else the first item
- **Evidence:** UI check (screenshot)

#### Scenario: Best hit stays active with favourites
- **WHEN** `firstSignal` gets the searching items of favourites "Group order and copies" (the Favourites header, then the copies of ranks 2 and 5) with `best` the signal ID of rank 1, then with `best` the ID of rank 2, then the empty-query items without `best`
- **THEN** it returns 11 (rank 1's row under `Other`), 1 (rank 2's copy in the Favourites group), and 1 (the first copy, rank 5)
- **Evidence:** `apps/web/test/explorer.test.ts` › "keeps the best hit active when favourites come first"

#### Scenario: Enter adds the top hit with a favourite above it
- **WHEN** on smart451 with `WSPD_FL` starred, the user types `speed` and presses Enter
- **THEN** the signal added is the one that is added for `speed` without favourites (the row of the best hit), not `WSPD_FL`
- **Evidence:** UI check on smart451 at 1440×900 (the added signal with and without the favourite)
