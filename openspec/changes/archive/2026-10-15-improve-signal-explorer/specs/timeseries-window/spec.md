## MODIFIED Requirements

### Requirement: Drag feedback and cancel
While dragging, each window that can take the signal SHALL be highlighted with a hint, and a "+ New window" drop zone SHALL appear below the last window. The hint SHALL read "Drop to move · Alt/Ctrl+drop to copy" for a legend-row drag and "Drop to add" for an explorer-row drag (signal-catalog "Explorer rows are a drag source"). A window showing the signal already, or reaching five units, SHALL NOT be highlighted (the latter is marked not droppable with the hint "At most 4 units per window", for both kinds of drag) and SHALL ignore a drop. Esc or a release outside any target SHALL cancel without a command. Origin: power-user expectations (feedback 2026-10-14, point 1) serving D-017; explorer drags and their refusal rule D-020. Archive note: this delta requires `improve-window-workflow` to be archived first, since that change adds this requirement.

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
- **WHEN** the user drags the HTR_HV_Volt row from window B onto "+ New window"
- **THEN** a new window "Window <n>" appears last with B's range and mode, showing HTR_HV_Volt, and window B stays with "Drop a signal here"
- **Evidence:** `apps/web/test/drag.test.ts` › "drops into a new window"; UI check (screenshot)

#### Scenario: Hint names the action
- **WHEN** the user drags an explorer row over a window that can take it, and later a legend row over a window that can take it
- **THEN** the first window shows "Drop to add", the second "Drop to move · Alt/Ctrl+drop to copy"
- **Evidence:** UI check (two screenshots while dragging)
