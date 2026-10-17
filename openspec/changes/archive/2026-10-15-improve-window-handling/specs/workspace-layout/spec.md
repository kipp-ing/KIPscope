## MODIFIED Requirements

### Requirement: Window heights in the grid
Each timeseries window SHALL keep its own stored plot height in the grid. A grid row SHALL be as tall as its tallest window, with its windows aligned at the top. The corner grip and the strip below the plot SHALL change only their own window's height, never a width. Origin: necessary consequence of D-018 ("resizable window heights") with tiled windows (D-026); D-037 item (1) („width stays from the grid").

#### Scenario: Taller left window
- **WHEN** at 1440×900 windows 1 and 2 share a row at default height and the user drags window 1's height handle about 200 px down
- **THEN** window 1's plot is about 480 px tall, window 2's stays 280 px, both windows keep the same top edge, and window 3 starts below window 1's bottom edge
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, plot heights from `getBoundingClientRect()`)

#### Scenario: Grip in the right column
- **WHEN** at 1440×900 windows 1 and 2 share a row at default height and the user drags window 2's corner grip about 100 px down and releases
- **THEN** window 2's plot is about 380 px tall, window 1's stays 280 px, both windows keep their left edge and width (±1 px), and window 3 starts below window 2's bottom edge
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, rects of windows 1–3 before and after)

## ADDED Requirements

### Requirement: Drop below the windows
During a row drag (explorer, legend or values row), the free area of the window list below the last window, or the whole list below the top row when there is no window, SHALL be a "+ New window" target. A release there SHALL do what a release on the "+ New window" strip does: same command, move or Alt/Ctrl copy, source removed when emptied. Origin: D-037 item (2) („a drag of a signal to empty space create new time series"; "free area below the windows").

#### Scenario: Explorer row below two windows
- **WHEN** at 1440×900 windows 1 and 2 share the first row, the list has free space below them, and the user drags the `BRK_1A0h.WSPD_FL` explorer row into that space, holds, then releases
- **THEN** while holding, the free area shows a dashed accent outline with "+ New window" in its stronger highlight while the strip at the bottom shows "+ New window" without it; after the release a new window "Window <n>" appears last showing WSPD_FL, and the revision rose by two (`window.add` and `signal.add`, as for an explorer drop on the strip)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while holding, screenshot and revision after the release)

#### Scenario: Legend row moved below
- **WHEN** window 1 shows `ICL_3A2h.SPEED_DISP` and `BRK_1A0h.WSPD_FL`, and the user drags the SPEED_DISP legend row onto the free area below the windows and releases without a modifier
- **THEN** a new window appears last showing SPEED_DISP in the same swatch colour, window 1 shows only WSPD_FL, and the revision rose by exactly one
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the drop, revision in the status strip); `apps/web/test/drag.test.ts` › "treats a drop below the windows like + New window"

#### Scenario: Copy below
- **WHEN** the user drags the WSPD_FL legend row of window 1 onto the free area and releases with Alt (or Ctrl) held
- **THEN** a new window shows WSPD_FL and window 1 still shows WSPD_FL, in the same colour
- **Evidence:** `apps/web/test/drag.test.ts` › "treats a drop below the windows like + New window"; UI check if the browser automation can hold the modifier, else `not_run` with the test as evidence

#### Scenario: Last signal moved below
- **WHEN** window 2 shows only `DCU_2B8h.HTR_HV_Volt` and the user drags that legend row onto the free area below the windows and releases
- **THEN** a new window shows HTR_HV_Volt, window 2 is gone from the page, and the revision rose by exactly one
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the drop, revision); `packages/shared/test/apply.test.ts` › "moves the only signal into a new window and removes the source"

#### Scenario: Values row below
- **WHEN** a values window lists `ICL_3A2h.SPEED_DISP` and `BRK_1A0h.WSPD_FL` and the user drags its SPEED_DISP row onto the free area and releases
- **THEN** a new timeseries window shows SPEED_DISP and the values window lists only WSPD_FL
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the drop)

#### Scenario: Empty window list
- **WHEN** the workspace has no window and the user drags the `ICL_3A2h.SPEED_DISP` explorer row into the middle of the empty window list, holds, then releases
- **THEN** while holding, the list area below the top row is highlighted with "+ New window" and the "No windows yet" hint is not shown; after the release one window shows SPEED_DISP
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while holding and after the release)

#### Scenario: Element mapping
- **WHEN** the element under the pointer is a window, the "+ New window" strip, the free area below the windows, or none of them
- **THEN** the drop target is that window, a new window (strip), a new window (free area), or none; the strip and the free area give the same command for the same source and modifiers
- **Evidence:** `apps/web/test/drag.test.ts` › "maps drop elements to targets", "treats a drop below the windows like + New window"

### Requirement: Free area bounds
The free area SHALL start 8 px below the last grid row. Gaps between windows, that 8 px band and the space beside a shorter window in the last row SHALL be no target. A full list has no free area; the "+ New window" strip stays the always reachable target. Origin: D-037 item (2) ("gaps between windows stay no target"); 8 px per design B2.

#### Scenario: Just below the last window
- **WHEN** the user drags a legend row of window 1 and releases 4 px below the bottom edge of the last grid row
- **THEN** no new window appears and the revision is unchanged
- **Evidence:** UI check on smart451 at 1440×900 (pointer position from the last window's `getBoundingClientRect().bottom + 4`, revision before and after)

#### Scenario: Beside a shorter window
- **WHEN** at 1440×900 window 1 is 200 px taller than window 2 in the last row and the user releases a dragged legend row in the empty space below window 2 and beside window 1
- **THEN** no new window appears, nothing is highlighted there, and the revision is unchanged
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while holding, revision before and after)

#### Scenario: Release in the gap stays a no-op
- **WHEN** the user drags a legend row of window 1 and releases it in the gap between windows 1 and 2
- **THEN** no window is highlighted at the release point and the revision is unchanged
- **Evidence:** UI check (revision in the status strip before and after); `apps/web/test/drag.test.ts` › "maps drop elements to targets"

#### Scenario: Full list
- **WHEN** the six-window setup at 1440×900 is scrolled to the end and the user drags the WSPD_FL explorer row
- **THEN** no free area is highlighted above the strip (its height is 0 px), and a release on the "+ New window" strip creates a window with WSPD_FL
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while dragging, screenshot after the drop)

### Requirement: Free area highlight
During a drag the free area SHALL be highlighted like the "+ New window" strip with the hint "+ New window", more strongly under the pointer, and the strip SHALL NOT take that stronger highlight then. Outside a drag it SHALL show nothing. It SHALL take the same space in both states. Origin: necessary consequences of "Drag feedback and cancel" and "Top row and status strip"; label per design B5 (Q3).

#### Scenario: Drag start moves nothing
- **WHEN** at 1440×900 two windows leave free space below them and the user presses on an explorer row and drags past the threshold
- **THEN** every window's `getBoundingClientRect()` top and the list's `scrollHeight` are the same as just before the drag (±0.5 px)
- **Evidence:** UI check on smart451 at 1440×900 (values read before and during the drag)
