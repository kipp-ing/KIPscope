## MODIFIED Requirements

### Requirement: Link toggle
The option bar SHALL show a "Link time axes" toggle that reflects and sets the workspace's link flag, on by default; the top bar SHALL no longer show it. Switching it on SHALL show all windows at the range of the window zoomed last. Origin: D-017 ("on by default and can be switched off"); D-023 (the toggle moves out of the top bar into the option bar).

#### Scenario: Default on
- **WHEN** the app is opened after a server restart
- **THEN** "Link time axes" is checked in the option bar, and the top bar shows no such toggle
- **Evidence:** Jan's hand check after a server restart (screenshot of the option bar and the top bar); `packages/shared/test/apply.test.ts` › "applies a range to all windows while linked" (asserts `linkTime` is `true` on a fresh workspace)

#### Scenario: Re-link
- **WHEN** both windows show different ranges, window 2 was zoomed last, and the user switches "Link time axes" on
- **THEN** both windows show window 2's range
- **Evidence:** UI check (screenshot); `packages/shared/test/apply.test.ts` › "snaps all windows to the last zoomed window when linking"

### Requirement: Drag feedback and cancel
While dragging, each window that can take the signal SHALL be highlighted with a hint naming the action: "Drop to move · Alt/Ctrl+drop to copy" for a legend or values row, "Drop to add" for an explorer row. A window that cannot take the signal SHALL NOT be highlighted and SHALL ignore a drop ("Refused drop targets"). Esc or a release outside any target SHALL cancel without a command. Origin: feedback 2026-10-14, point 1 (serving D-017); D-020 (explorer drags); D-023 (values rows).

#### Scenario: Highlight and cancel
- **WHEN** the user starts dragging the PTC_HV_Volt row, holds it over window A, then presses Esc and releases
- **THEN** while dragging window A is highlighted with the hint and "+ New window" is visible; after Esc nothing is highlighted, no signal moved and the revision is unchanged
- **Evidence:** UI check (screenshot while dragging, revision before and after)

#### Scenario: No drop on a window that shows the signal
- **WHEN** V_ANZ is shown in windows A and B and the user drags it from A over B
- **THEN** B is not highlighted and releasing over B changes nothing
- **Evidence:** `apps/web/test/drag.test.ts` › "rejects drops on the source and on windows showing the signal"; UI check (screenshot)

#### Scenario: Fifth unit refused
- **WHEN** window A shows four units (V, km/h, °C, 1/min) and the user drags `MS_312h.DNMOT` (`rpm/10ms`) from window B over A
- **THEN** A is marked as not droppable with the hint "At most 4 units per window", and releasing over A changes nothing
- **Evidence:** `apps/web/test/drag.test.ts` › "refuses a drop that would make a fifth unit"; UI check (screenshot while dragging, revision unchanged)

#### Scenario: Drop into a new window
- **WHEN** the user drags the PTC_HV_Volt row from window B onto "+ New window"
- **THEN** a new window "Window <n>" appears last with B's range and mode, showing PTC_HV_Volt, and window B stays with "Drop a signal here"
- **Evidence:** `apps/web/test/drag.test.ts` › "drops into a new window"; UI check (screenshot)

#### Scenario: Hint names the action
- **WHEN** the user drags an explorer row over a window that can take it, and later a legend row over a window that can take it
- **THEN** the first window shows "Drop to add", the second "Drop to move · Alt/Ctrl+drop to copy"
- **Evidence:** UI check (two screenshots while dragging)

## ADDED Requirements

### Requirement: Refused drop targets
During a drag, the legend row's own window and any window already showing the signal SHALL be refused without a highlight. A timeseries window that would reach a fifth unit SHALL be marked not droppable with the hint "At most 4 units per window", whatever the drag source. A values window SHALL never be refused for units. Origin: D-019 (four units), D-020 (refusal for explorer drags), D-023 (values rows as source; no unit limit in the values window).

#### Scenario: Values row over a four-unit window
- **WHEN** window A shows four units (V, km/h, °C, 1/min) and the user drags the `MS_312h.DNMOT` row of a values window over A and releases
- **THEN** A is marked not droppable with "At most 4 units per window", and the release changes nothing (revision unchanged)
- **Evidence:** `apps/web/test/drag.test.ts` › "drags a values row like a legend row"; UI check (screenshot while dragging, revision before and after)

#### Scenario: Values window takes a fifth unit
- **WHEN** a values window lists four units and the user drags the DNMOT legend row from a timeseries window over it
- **THEN** the values window is highlighted with "Drop to move · Alt/Ctrl+drop to copy"
- **Evidence:** `apps/web/test/drag.test.ts` › "accepts any unit on a values window"; UI check (screenshot while dragging)

### Requirement: New-window drop zone stays visible
During every drag, the "+ New window" drop zone SHALL be visible at the bottom of the viewport over the window list, wherever the list is scrolled. It SHALL NOT be shown outside a drag. Origin: D-023 („"+ New window" stays visible during a drag").

#### Scenario: Many windows, scrolled to the top
- **WHEN** six timeseries windows fill more than the viewport, the list is scrolled to the top, and the user drags the `BS_200h.DVL` explorer row
- **THEN** "+ New window" is visible at the bottom of the viewport without scrolling, and dropping on it creates a new window with DVL
- **Evidence:** UI check (screenshot while dragging, screenshot after the drop)

### Requirement: Auto-scroll while dragging
While dragging, the window list SHALL scroll when the pointer is within 48 px of its visible top edge (below the option bar) or bottom edge (above the drop zone), faster the deeper, up to 24 px per frame, and stop at the list's ends. Pointing at the drop zone itself SHALL NOT scroll. The wheel SHALL scroll the list during a drag instead of zooming. Origin: D-023 („the page scrolls when the pointer nears its edge").

#### Scenario: Reach the last window
- **WHEN** six windows exist, the list is scrolled to the top, and the user drags the V_ANZ legend row of window 1 into the band just above "+ New window"
- **THEN** the list scrolls down until window 6 is visible and stops at the end; dropping on window 6 moves V_ANZ there
- **Evidence:** UI check (screenshots while scrolling and after the drop)

#### Scenario: Hold over the drop zone
- **WHEN** the pointer rests on "+ New window" during a drag, with the list scrolled to the top
- **THEN** the list does not scroll
- **Evidence:** UI check (two screenshots 2 s apart show the same first window)

### Requirement: No value readout on hover
Hovering a plot SHALL show the crosshair only: no value, tooltip or legend value of any signal. Values are read at the cursors (values-window). Origin: D-023 („no value readout on hover"; supersedes D-018's "hover value readout first").

#### Scenario: Hover a speed plot
- **WHEN** the pointer moves over a window showing `COMBI_412h.V_ANZ` and `BS_200h.DVL`
- **THEN** a crosshair follows the pointer and no signal value appears anywhere on the page apart from axis ticks and values-window cells
- **Evidence:** UI check (screenshot while hovering)

### Requirement: Option bar
Above the windows, an option bar SHALL stay visible while the window list scrolls. It SHALL hold, in this order: the cursor toggles "A", "B" and "Diff" (cursors spec), "Link time axes", "Back", "Reset zoom" and "+ Values window". Origin: D-023 („a bar holds cursor A/B on/off and diff mode, the "Link time axes" toggle (moved out of the top bar) and zoom back / reset zoom").

#### Scenario: Scrolled down
- **WHEN** six windows exist and the list is scrolled to the end
- **THEN** the option bar is fully visible above the windows with its seven controls in that order
- **Evidence:** UI check (screenshot)

### Requirement: Bar zoom back and reset
The bar's "Back" SHALL step back the zoom history of its target window, and "Reset zoom" SHALL set the target's range to the union of its signals' extents. The target is the window zoomed last, else the first timeseries window. While linked, "Reset zoom" SHALL use the signals of all timeseries windows. While unlinked, both tooltips SHALL name the target. "Back" SHALL be disabled when the target has no history. Origin: D-023 (zoom back / reset zoom in the bar); target rule in design C5.

#### Scenario: Linked reset
- **WHEN** "Link time axes" is on, window 1 shows `COMBI_412h.V_ANZ`, window 2 shows `CPC_448h.PTC_HV_Volt`, both at 2026-10-13T13:08:00Z–13:08:03Z, and the user clicks "Reset zoom"
- **THEN** both windows show the union of both signals' extents (earliest first point to just after the latest last point), and "Back" returns both to 13:08:00Z–13:08:03Z
- **Evidence:** `apps/web/test/bar.test.ts` › "resets to the union of all timeseries extents while linked"; UI check (screenshots of both headers)

#### Scenario: Unlinked back
- **WHEN** "Link time axes" is off, window 1 was zoomed once and then window 2 zoomed once, and the user clicks the bar's "Back"
- **THEN** the tooltip read "Back · Window 2", window 2 shows its previous range, and window 1 is unchanged
- **Evidence:** `apps/web/test/bar.test.ts` › "targets the window zoomed last, else the first timeseries window"; UI check (headers before and after)

### Requirement: Drop lands under the pointer
A drop SHALL go to the target under the pointer at release, never to a target the pointer left earlier. While dragging, space of the drop zone's height SHALL be reserved below the last window, so the "+ New window" zone never covers a window. Origin: power-user bug (feedback 2026-10-15, item 1: three stray windows); necessary consequence of "New-window drop zone stays visible".

#### Scenario: Values window at the bottom
- **WHEN** a values window is the last window, the list is scrolled to the end, and the user drags the `COMBI_412h.V_ANZ` explorer row onto the lower part of the values window and releases
- **THEN** the values window lists V_ANZ, no new window appears, and while dragging the "+ New window" zone sits below the values window without covering it
- **Evidence:** UI check (screenshot while dragging, screenshot and revision after the drop)

### Requirement: Header shows the plotted range
The window header's range SHALL always equal the range the plot shows, also during a zoom or pan preview before the server accepted it. Origin: power-user bug (feedback 2026-10-15, item 2: the header lagged one zoom step behind the axis).

#### Scenario: Three quick wheel zooms
- **WHEN** a window shows 2026-10-13T13:08:00Z–13:08:03Z and the user wheel-zooms three times in quick succession
- **THEN** after each step, and during the preview, the header's start and end match the first and last time of the axis; no screenshot shows the range of the step before
- **Evidence:** UI check (screenshots after each step); `apps/web/test/zoom.test.ts` › "shows the preview range in the header" if the header range comes from a pure helper, else the UI check alone

### Requirement: New windows scroll into view
A window created by "+ Values window" or by a drop on "+ New window" SHALL be scrolled into view. Origin: power-user bug (feedback 2026-10-15, item 4: the new window was appended out of sight).

#### Scenario: Values window below the fold
- **WHEN** six windows fill more than the viewport, the list is scrolled to the top, and the user clicks "+ Values window", later drops a legend row on "+ New window"
- **THEN** each new window is fully visible right after it appears, without manual scrolling
- **Evidence:** UI check (screenshot after each creation)
