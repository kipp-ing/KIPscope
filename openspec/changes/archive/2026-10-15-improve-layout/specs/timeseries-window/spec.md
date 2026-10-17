## MODIFIED Requirements

### Requirement: Drag signals between windows
A signal's legend row SHALL be draggable onto another window: a plain drop moves the signal, a drop with Alt or Ctrl held copies it, each as one `window.moveSignal` command. The signal SHALL keep its colour and take the target window's display mode (mode is a window option). A window emptied by the move SHALL disappear (workspace-state "Window emptied by a move is removed"). Origin: D-017 („Signale zwischen zwei anzeigen hin und her“); Alt/Ctrl copy from power-user expectations (feedback 2026-10-14, point 1); D-027 (emptied window removed).

#### Scenario: Move by drag
- **WHEN** window A shows `ICL_3A2h.SPEED_DISP` and `BRK_1A0h.WSPD_FL`, window B shows `DCU_2B8h.HTR_HV_Volt`, and the user drags the SPEED_DISP legend row onto window B and releases
- **THEN** SPEED_DISP is listed and drawn in window B with the same swatch colour as before, window A shows only WSPD_FL, and the revision increased by exactly one
- **Evidence:** UI check (screenshot after the drop, revision in the status strip); `apps/web/test/drag.test.ts` › "moves on plain drop and copies with Alt or Ctrl"

#### Scenario: Copy by drag
- **WHEN** the user drags the WSPD_FL row onto window B with Alt (or Ctrl) held at release
- **THEN** WSPD_FL is shown in both windows in the same colour
- **Evidence:** `apps/web/test/drag.test.ts` › "moves on plain drop and copies with Alt or Ctrl"; UI check if the browser automation can hold the modifier, else `not_run` with the test as evidence

#### Scenario: Last signal dragged out
- **WHEN** window A shows only `BRK_1A0h.WSPD_FL`, window B shows `DCU_2B8h.HTR_HV_Volt`, and the user drags the WSPD_FL legend row onto window B and releases
- **THEN** window B shows both signals, window A is gone from the page, and the revision increased by exactly one
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the drop, revision in the status strip); `packages/shared/test/apply.test.ts` › "removes a window emptied by a move"

### Requirement: Drag feedback and cancel
While dragging, each window that can take the signal SHALL be highlighted with a hint naming the action: "Drop to move · Alt/Ctrl+drop to copy" for a legend or values row, "Drop to add" for an explorer row. A window that cannot take the signal SHALL NOT be highlighted and SHALL ignore a drop ("Refused drop targets"). Esc or a release outside any target SHALL cancel without a command. Origin: feedback 2026-10-14, point 1 (serving D-017); D-020 (explorer drags); D-023 (values rows).

#### Scenario: Highlight and cancel
- **WHEN** the user starts dragging the HTR_HV_Volt row, holds it over window A, then presses Esc and releases
- **THEN** while dragging window A is highlighted with the hint and "+ New window" is visible; after Esc nothing is highlighted, no signal moved and the revision is unchanged
- **Evidence:** UI check (screenshot while dragging, revision before and after)

#### Scenario: No drop on a window that shows the signal
- **WHEN** SPEED_DISP is shown in windows A and B and the user drags it from A over B
- **THEN** B is not highlighted and releasing over B changes nothing
- **Evidence:** `apps/web/test/drag.test.ts` › "rejects drops on the source and on windows showing the signal"; UI check (screenshot)

#### Scenario: Fifth unit refused
- **WHEN** window A shows four units (V, km/h, °C, 1/min) and the user drags `ENG_2E8h.MOT_SPD_D` (`rpm/10ms`) from window B over A
- **THEN** A is marked as not droppable with the hint "At most 4 units per window", and releasing over A changes nothing
- **Evidence:** `apps/web/test/drag.test.ts` › "refuses a drop that would make a fifth unit"; UI check (screenshot while dragging, revision unchanged)

#### Scenario: Drop into a new window
- **WHEN** window B shows `DCU_2B8h.HTR_HV_Volt` and `ICL_3A2h.SPEED_DISP`, and the user drags the HTR_HV_Volt row from window B onto "+ New window"
- **THEN** a new window "Window <n>" appears last with B's range and mode, showing HTR_HV_Volt, and window B stays with SPEED_DISP; dragging SPEED_DISP, B's last signal, onto "+ New window" afterwards creates another new window and removes B
- **Evidence:** `apps/web/test/drag.test.ts` › "drops into a new window"; `packages/shared/test/apply.test.ts` › "moves the only signal into a new window and removes the source"; UI check (screenshot after each drop)

#### Scenario: Hint names the action
- **WHEN** the user drags an explorer row over a window that can take it, and later a legend row over a window that can take it
- **THEN** the first window shows "Drop to add", the second "Drop to move · Alt/Ctrl+drop to copy"
- **Evidence:** UI check (two screenshots while dragging)

### Requirement: Window names
A window SHALL be named by its title or, untitled, "Window <n>" everywhere it is named, including the explorer's "Add to" list. A double-click on the title, or "Rename" in the window menu, SHALL allow renaming in place (Enter or leaving the field saves, Esc cancels); a single click on the title marks the window (workspace-layout "Marked window"). The title's tooltip SHALL name the full title and "Double-click to rename". Origin: D-018 ("window rename"); bug "'Add to' lists raw IDs" (feedback 2026-10-14); D-027 (a click on the header marks, so renaming moves to the double-click).

#### Scenario: Rename
- **WHEN** the user double-clicks the title of a window, types `HV voltages` and presses Enter
- **THEN** the header and the explorer's "Add to" list show `HV voltages`, also after a browser reload
- **Evidence:** UI check (screenshot of header and open "Add to" list)

#### Scenario: Rename from the menu
- **WHEN** the user opens a values window's "⋯" menu, chooses "Rename", types `Drive` and presses Enter; later double-clicks the title, types `x` and presses Esc
- **THEN** the header reads `Drive` after the first and still `Drive` after the second
- **Evidence:** UI check (screenshot of the header after each)

#### Scenario: Single click does not rename
- **WHEN** the user clicks a window's title once
- **THEN** no text field opens, the window is marked, and the title's tooltip reads `<title> · Double-click to rename`
- **Evidence:** UI check (screenshot after the click, with the tooltip)

#### Scenario: New window from the explorer is untitled
- **WHEN** the user adds `ICL_3A2h.SPEED_DISP` to "New window" in the explorer and the new window gets the ID `w<n>`
- **THEN** the new window's header reads `Window <n>` (not `SPEED_DISP`), the "Add to" list shows `Window <n>`, and `curl -s localhost:7310/api/workspace | jq '.workspace.windows[-1].title'` prints `null`
- **Evidence:** UI check (screenshot of header and "Add to" list); the `curl` command. Origin: lead decision (rounds.md round 5): a signal-name title goes stale once that signal is moved out.

## REMOVED Requirements

### Requirement: One-line window header
**Reason**: Replaced by `workspace-layout` "Compact window header", which covers every window kind, fixes the control positions against reflow and moves Remove into the window menu (D-026 "compact window headers").
**Migration**: The long-title case ("Long title", 80 characters) is kept as a scenario of `workspace-layout` "Compact window header"; Remove is found in the "⋯" menu.
