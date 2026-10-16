## ADDED Requirements

### Requirement: No text selection in the explorer list
A click, double-click, Shift-click or Ctrl/Cmd-click anywhere in the explorer's result list (rows, group headers, "Show more") SHALL NOT select page text, and a press in the list SHALL NOT take the focus; a click on a row or group header SHALL move the focus into the search without selecting its text, so arrows, Shift+Arrow and Enter work after a click. The search field SHALL stay a normal text field. Origin: D-065 (quoted in design.md); focus: Jan's check 2026-10-17 (Shift+Arrow after a click).

#### Scenario: Presses in the list select nothing
- **WHEN** on smart451 at 1440×900 the user types `speed`, then clicks the padding right of `DVL`'s unit, double-clicks the name `DVR`, Shift-clicks the unit of `DHL`, Ctrl-clicks (Cmd on macOS) the SNA-dot column of `V_ANZ`, and double-clicks the group header `ESP`
- **THEN** after each step `window.getSelection().toString()` is empty and no text is highlighted, and the search field still has focus
- **Evidence:** UI check on smart451 at 1440×900 (one screenshot after the Shift-click, the selection string after each step)

#### Scenario: Search text still selectable
- **WHEN** the search field holds `speed` and the user double-clicks into it
- **THEN** the word `speed` in the field is selected
- **Evidence:** UI check on smart451 at 1440×900 (screenshot)

#### Scenario: Press handler and list rule
- **WHEN** `preventListPress` gets a fake mouse event with button 0, 1 or 2, and the rule for `.explorer .results` is read from `apps/web/src/styles.css`
- **THEN** `preventDefault` was called for each, and the rule contains `user-select: none`
- **Evidence:** `apps/web/test/selection.test.ts` › "keeps presses in the list from selecting text"

### Requirement: Selecting signals by click
The explorer SHALL keep a selection of signal rows. A plain click on a row SHALL select only that row; Ctrl-click (Windows, Linux) or Cmd-click (macOS) SHALL toggle a row; Shift-click SHALL select the signal rows from the anchor (the last plain- or toggle-clicked row) to the clicked row, in list order across groups, headers excluded. Any click on a row SHALL make it the active row. Origin: D-066 (Jan: „selct multple entries with shift ctrl or so (win )"); keys: lead default L1.

#### Scenario: Ctrl/Cmd and Shift on smart451
- **WHEN** on smart451 at 1440×900 the user types `speed`, clicks `LWS_SPEED`, Shift-clicks `DVR`, then Ctrl-clicks (Cmd on macOS) `CompSpd_Target_V2` and `V_ANZ`
- **THEN** after the Shift-click `LWS_SPEED`, `CompSpd_Target_V2`, `DVL`, `DVR` are marked selected and the headers `AC` and `ESP` are not; after the Ctrl/Cmd-clicks `LWS_SPEED`, `DVL`, `DVR`, `V_ANZ` are selected; the active row is always the last clicked one (`V_ANZ` at the end)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each of the two steps)

#### Scenario: Click rules
- **WHEN** the pure helpers get: a plain click on a row; a toggle on a selected and on an unselected row; Ctrl with `mac` false, Meta with `mac` true, and the opposite pairs; a range from an anchor in group `A` to a row in group `C` with a header between; an anchor no longer in the items
- **THEN** one row with it as anchor; the row removed or added, with it as anchor; "toggle" for the platform's key and "plain" for the other; the signal rows between, headers excluded, anchor kept; a range of one row
- **Evidence:** `apps/web/test/selection.test.ts` › "selects one row on a plain click", "toggles with Ctrl, or Cmd on macOS", "selects a range of signal rows across groups with Shift"

### Requirement: Selecting signals by keyboard
Shift+ArrowDown/ArrowUp in the search SHALL move the active item as the plain arrow does and select the signal rows from the anchor to it; without an anchor the previously active row becomes the anchor. Plain arrows SHALL NOT change the selection. Origin: D-066; keys: lead default L1.

#### Scenario: Shift+Arrow on smart451
- **WHEN** the user types `speed`, clicks `DVL` and presses Shift+ArrowDown four times
- **THEN** `DVL`, `DVR`, `TM_DL`, `DHL`, `DHR` are selected and `DHR` is active
- **Evidence:** UI check on smart451 at 1440×900 (screenshot); `apps/web/test/selection.test.ts` › "extends the range with Shift+Arrow"

### Requirement: Selection lifetime
A query change (including Esc) SHALL clear the selection; closing a group SHALL drop its rows from it; a click on a group header (with any modifier; it opens or closes the group as before) and a click that ends a drag SHALL NOT change it otherwise. The listbox SHALL be `aria-multiselectable="true"` and a row's `aria-selected` SHALL tell whether it is selected. Origin: D-066; lifetime: lead default L1; ARIA: necessary consequence (a multi-select listbox).

#### Scenario: Query change and closed group
- **WHEN** under `speed` the rows `DVL` and `LWS_SPEED` are selected and the user Shift-clicks the group header `ESP`, then types a space and deletes it
- **THEN** the Shift-click closes `ESP` and only `LWS_SPEED` stays selected (a drag of it carries one signal); after the query change nothing is selected
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each step); `apps/web/test/selection.test.ts` › "lists the selection in list order and drops hidden rows"

### Requirement: Adding a selection
The `+` button of a selected row, and Enter in the search while the active row is selected, SHALL add the whole selection (two or more rows) to the "Add to" target, placed as timeseries-window "Selection overflows into new windows" describes; on an unselected row they SHALL add only that row exactly as before. The selection SHALL stay after an add. Origin: D-066 („draw them to one or a new window"); `+` and Enter for a selection: lead default L3, open to Jan's veto.

#### Scenario: `+` on a selection into a new window
- **WHEN** on smart451 at 1440×900 "Add to" is "New window", the user types `speed`, clicks `DVL`, Shift-clicks `DHR` and clicks the `+` of `DHL`
- **THEN** one new window `Window <n>` shows `DVL`, `DVR`, `TM_DL`, `DHL`, `DHR` (one axis, `1/min`), the revision rose by six (`window.create` plus five `window.addSignal`), and the five rows stay selected
- **Evidence:** UI check on smart451 at 1440×900 (screenshot and revision after the click)

#### Scenario: `+` on an unselected row
- **WHEN** after that, the user clicks the `+` of `V_ANZ`, which is not selected
- **THEN** only `V_ANZ` is added, to a new window, and the revision rose by two, as before this change
- **Evidence:** UI check on smart451 at 1440×900 (revision before and after)

#### Scenario: Enter adds the selection
- **WHEN** "Add to" is a window `W` showing `CPC_168h.EAC_HV_Volt`, the user types `speed`, clicks `DVL` and presses Shift+ArrowDown once, then Enter
- **THEN** `DVL` and `DVR` are added to `W` and the revision rose by two
- **Evidence:** UI check on smart451 at 1440×900 (screenshot of W)

## MODIFIED Requirements

### Requirement: Explorer rows are a drag source
Pressing on an explorer row's name and moving the pointer SHALL start the app's pointer drag (design S3). When the row is selected and the selection holds two or more rows, the drag SHALL carry the whole selection in list order and follow timeseries-window "Selection overflows into new windows"; otherwise it SHALL carry that one signal, the selection unchanged, as follows. The ghost SHALL show the signal's shown name. Windows that do not show it and stay within four units SHALL be highlighted with "Drop to add"; one that would reach a fifth unit SHALL be marked not droppable ("At most 4 units per window") and ignore a drop. A drop adds, never moves; Alt/Ctrl change nothing. The add button SHALL NOT start a drag. Origin: D-020 (explorer drag; fifth unit refused as for legend drags); shown name in the ghost: D-035; selection drag: D-066 with lead default L2.

#### Scenario: Drag a row onto a window
- **WHEN** a window exists that does not show `COMBI_412h.V_ANZ`, and the user drags the `V_ANZ` row onto it with the mouse (shipped `kipscope.yaml`)
- **THEN** windows not showing V_ANZ are highlighted with "Drop to add" while dragging, a window showing it is not highlighted, the ghost reads `V_ANZ · add` over a valid target, the hover card is closed, and after the drop the signal appears in that window while the explorer row stays
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
- **WHEN** the user drags the `DVL` row (`BS_200h.DVL`) onto the "+ New window" zone
- **THEN** a new window `Window <n>` with DVL is created, exactly as with the add button and "New window" selected
- **Evidence:** UI check (screenshot); `apps/web/test/drag.test.ts` › "adds an explorer signal to windows not showing it and to a new window"

#### Scenario: Click is not a drag
- **WHEN** the user clicks a row's name or its add button without moving the pointer
- **THEN** no drag starts (no ghost, no highlighted targets)
- **Evidence:** UI check

#### Scenario: Unselected row drags alone
- **WHEN** under the query `speed` the rows `DVL` and `DVR` are selected and the user drags the unselected `V_ANZ` row onto "+ New window"
- **THEN** the ghost reads `V_ANZ`, the new window shows only V_ANZ, and `DVL` and `DVR` stay selected
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the drop)

#### Scenario: Selected row drags the selection
- **WHEN** under the query `speed` the rows `DVL`, `DVR` and `DHL` are selected and the user presses the name `DVR` and moves the pointer over a window
- **THEN** the ghost reads `3 signals`, with ` · add` over a valid target
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while dragging)
