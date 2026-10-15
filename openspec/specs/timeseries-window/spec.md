# timeseries-window Specification

## Purpose
Displays one or more signals over time in a window and lets the user navigate from a long overview down to individual raw measurements.

## Requirements

### Requirement: Overview display
When a window shows aggregated buckets, each signal SHALL be drawn as a curve of the bucket means. Aggregated display SHALL be visibly distinguishable from raw display.

#### Scenario: Long range
- **WHEN** a window shows ten hours of a 5 ms signal
- **THEN** it draws the bucket means and indicates that the view is aggregated

### Requirement: Min/max envelope
A window SHALL offer an envelope option, off by default, that draws the minimum and maximum of each bucket around the mean curve.

#### Scenario: Spike in overview
- **WHEN** the envelope is on and a single raw spike lies inside one bucket
- **THEN** the envelope reaches the spike's value

#### Scenario: SNA inside a bucket
- **WHEN** the envelope is on and a bucket contains valid points and SNA points
- **THEN** the envelope spans only the valid points' minimum and maximum, and for an all-SNA bucket no envelope is drawn
- **Evidence:** `apps/web/test/build.test.ts` › "breaks mean and envelope at all-SNA buckets"; UI check in the V_ANZ overview above

### Requirement: Raw display modes
When a window shows raw points, each signal SHALL be drawable as lines between points, as steps holding the previous value, or with point markers, as chosen in the window's display options.

#### Scenario: Step mode
- **WHEN** step mode is selected
- **THEN** the curve holds each value until the next point's timestamp

### Requirement: No invented values
The window SHALL NOT draw a curve segment where no measured point exists on at least one side; it SHALL use edge neighbors from the query to draw segments that cross the visible range edges. An SNA point SHALL count as no measured value for this purpose.

#### Scenario: Window inside a gap between points
- **WHEN** the visible range contains no point but has neighbors on both sides
- **THEN** the line or step through the window is drawn from those neighbors

#### Scenario: Before the first point
- **WHEN** the visible range starts before the signal's first point
- **THEN** nothing is drawn before that point

#### Scenario: SNA neighbor
- **WHEN** the visible range contains no point and its leading neighbor is SNA
- **THEN** no line or step is drawn through the window, and the SNA period is marked
- **Evidence:** `apps/web/test/build.test.ts` › "draws nothing from an SNA neighbor"

### Requirement: Reload on navigation
After a zoom or pan, the window SHALL request the data for the new range and resolution that is not in the tab's series cache, keep showing the already loaded data meanwhile, and replace it when the new data arrives. When the cache holds all data for the new range and resolution, the window SHALL show it at once, without a request and without a loading state. Origin: concept §5 („Beim Hineinzoomen werden feinere Daten nachgeladen"); D-037 (3) (loaded data stays in the browser, „so zooming and panning back is fast").

#### Scenario: Zoom into detail
- **WHEN** the user zooms from an aggregated view into a range with few raw points
- **THEN** the window loads and shows the raw points

#### Scenario: Back to a cached range
- **WHEN** the user zooms into a range, waits for its data, and goes back to the previous range with Backspace
- **THEN** the previous curve is shown at once and no `/api/series` request is sent
- **Evidence:** `apps/web/test/loader.test.ts` › "draws a previous view again without a request"; UI check (network log filtered to `/api/series`, screenshot of the restored curve)

### Requirement: Stale responses discarded
A response for an earlier time range or revision SHALL NOT replace data for a newer one.

#### Scenario: Out-of-order responses
- **WHEN** the user zooms twice quickly and the first response arrives after the second
- **THEN** the window shows the data of the second zoom

### Requirement: Loading and error state
A window SHALL show per signal while its data is loading and when it failed, including the error message on failure; a complete load shows nothing (D-030 „the "complete" can go").

#### Scenario: Query fails
- **WHEN** the query for one signal fails
- **THEN** the window marks that signal as failed and keeps showing the other signals

### Requirement: Time axis precision
The time axis SHALL display local time and SHALL be able to label ticks down to the precision of the data, including sub-millisecond steps.

#### Scenario: Microsecond zoom
- **WHEN** the visible range is 100 µs wide
- **THEN** tick labels distinguish microseconds

### Requirement: SNA never drawn as a value
The window SHALL NOT draw an SNA point or an all-SNA bucket as a value: no line, step, marker or envelope reaches it, and no segment is interpolated or connected through it. In step mode the last valid value SHALL be held up to the timestamp of the following SNA point and end there. Origin: D-010.

#### Scenario: Speed SNA in raw view
- **WHEN** a window shows `COMBI_412h.V_ANZ` from 2026-10-13T09:56:59Z to 09:57:01Z in line mode
- **THEN** the curve is a flat line at 0 that stops at 09:56:59.737 and resumes at 09:57:00.138; nothing is drawn at 511
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "keeps SNA as null and never spans it"

#### Scenario: Step mode holds until SNA
- **WHEN** step mode is selected and a valid point at t1 is followed by an SNA point at t2
- **THEN** the value of t1 is held until t2 and nothing is drawn from t2 until the next valid point
- **Evidence:** `apps/web/test/build.test.ts` › "holds the last valid value up to the SNA point in step mode"; UI check with `BS_200h.DVL` in the same window in step mode

#### Scenario: Markers mode
- **WHEN** markers mode is selected on the window above
- **THEN** no marker appears for the three SNA points
- **Evidence:** UI check (screenshot)

#### Scenario: Aggregated overview
- **WHEN** a window shows the full extent of `COMBI_412h.V_ANZ` (2026-10-11T12:34:24.824Z to 2026-10-13T13:17:33.220Z) aggregated, with the min/max envelope on
- **THEN** neither the mean curve nor the envelope reaches 511; the highest drawn value is 71 km/h
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "breaks mean and envelope at all-SNA buckets"

#### Scenario: Several signals in one window
- **WHEN** `COMBI_412h.V_ANZ` and `BS_200h.DVL` share the window from 2026-10-13T09:56:59Z to 09:57:01Z, so their timestamps interleave
- **THEN** neither curve is drawn across its own SNA period, and each curve still connects its consecutive valid points
- **Evidence:** `apps/web/test/build.test.ts` › "joins several signals without spanning SNA"; UI check (screenshot)

### Requirement: Isolated valid points stay visible
In line mode and in aggregated mean curves, a valid point or bucket whose neighbors on both sides are SNA or absent, with at least one of them SNA, SHALL be drawn as a marker, so that breaking the curve at SNA never hides a valid measurement. Origin: necessary consequence of D-010's curve break.

#### Scenario: One valid point between SNA points
- **WHEN** `testcar/Sna_800h.SPEED` shows point 601 (value 42) between the SNA points 600 and 602 in line mode
- **THEN** a marker is drawn at value 42
- **Evidence:** `apps/web/test/build.test.ts` › "finds isolated valid points"

### Requirement: y range excludes SNA
The automatic y range of a scale SHALL be computed from valid values only; SNA points and all-SNA buckets SHALL NOT widen it. Origin: proposal (window never draws SNA as a value).

#### Scenario: Speed window around SNA
- **WHEN** a window shows `COMBI_412h.V_ANZ` from 2026-10-13T09:56:59Z to 09:57:01Z
- **THEN** the y axis covers the flat 0 line (about −1 to 1) and does not extend to 511
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "ignores SNA in the y range"

### Requirement: SNA periods marked
The window SHALL mark each signal's SNA periods as a thin strip per signal at the bottom of the plot, in the signal's color, so the user sees which signal is unavailable when. Raw: from an SNA point to the next point. Aggregated: each bucket that contains at least one SNA point. A period too short to see SHALL still be visible. Origin: D-010, D-014.

#### Scenario: Two signals with SNA at engine start
- **WHEN** a window shows `COMBI_412h.V_ANZ` and `BS_200h.DVL` from 2026-10-13T09:56:59Z to 09:57:01Z
- **THEN** a mark in the V_ANZ color covers 09:56:59.837 to 09:57:00.138 and a mark in the DVL color covers 09:56:59.791 to 09:57:00.072
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "derives SNA periods from raw points and neighbors"

#### Scenario: SNA in the overview
- **WHEN** a window shows the full extent of `COMBI_412h.V_ANZ` aggregated
- **THEN** SNA is marked from 2026-10-11 13:41 to 2026-10-13 09:07 UTC wherever the signal has points, and at the other three SNA runs
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "derives SNA periods from buckets"

#### Scenario: Single SNA point at the end of the data
- **WHEN** the last point of `testcar/Sna_800h.SPEED` (point 999) is SNA and has no successor
- **THEN** its mark is still visible, at least 2 px wide
- **Evidence:** `apps/web/test/build.test.ts` › "derives SNA periods from raw points and neighbors"

### Requirement: SNA share in the signal list
The window's signal list SHALL show per signal the share of SNA points among all points of the loaded range, edge neighbors excluded. A non-zero share SHALL never be displayed as 0 %, and a share below 100 % never as 100 %. No share is shown when it is 0 or nothing is loaded. Origin: D-010 ("show its share"); proposal.

#### Scenario: Engine start window
- **WHEN** a window shows `COMBI_412h.V_ANZ` and `BS_200h.DVL` from 2026-10-13T09:56:59Z to 09:57:01Z
- **THEN** the list shows `SNA 15.0 %` for V_ANZ (3 of 20) and `SNA 23.0 %` for DVL (14 of 61)
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "computes the SNA share of raw and bucket results"

#### Scenario: Rare SNA
- **WHEN** a window shows the full extent of `BS_200h.DVL` (56 SNA of 232,644 points)
- **THEN** the list shows `SNA < 0.1 %`
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "formats SNA shares without rounding to 0 or 100"

#### Scenario: Valid constant, no SNA
- **WHEN** a window shows `MS_312h.DNMOT` (constant −127, which is raw 0 and valid; D-012)
- **THEN** the curve is drawn at −127 and the list shows no SNA share
- **Evidence:** UI check (screenshot)

### Requirement: Linked time zoom
While the time axes are linked, wheel zoom, wheel pan, rectangle zoom, double-click reset, history back, "Reset", navigation keys, "Go to" and span presets in or for any window SHALL change the time range of all windows; the other windows SHALL show the new range at the latest 1 s after the last zoom or pan input. While unlinked, each window SHALL keep its own range. Origin: D-017 („gemeinsamer zoom standard aktiv abschaltbar“); D-027 (the new navigation follows the same rule).

#### Scenario: Zoom one of two linked windows
- **WHEN** "Link time axes" is on, window 1 shows `COMBI_412h.V_ANZ`, window 2 shows `CPC_448h.PTC_HV_Volt`, and the user Ctrl+wheel-zooms in window 1
- **THEN** within 1 s window 2's header shows the same range as window 1 and its curve is reloaded for it
- **Evidence:** UI check (screenshot of both headers); `packages/shared/test/apply.test.ts` › "applies a range to all windows while linked"

#### Scenario: Zoom one of two unlinked windows
- **WHEN** the user switches "Link time axes" off and zooms window 1
- **THEN** window 2 keeps its time range
- **Evidence:** UI check (screenshot); `packages/shared/test/apply.test.ts` › "applies a range to one window while unlinked"

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

### Requirement: Drag signals between windows
A signal's legend row SHALL be draggable onto another window: a plain drop moves the signal, a drop with Alt or Ctrl held copies it, each as one `window.moveSignal` command. The signal SHALL keep its colour and take the target window's display mode (mode is a window option). A window emptied by the move SHALL disappear (workspace-state "Window emptied by a move is removed"). Origin: D-017; Alt/Ctrl copy: feedback 2026-10-14, point 1; D-027 (emptied window removed).

#### Scenario: Move by drag
- **WHEN** window A shows `COMBI_412h.V_ANZ` and `BS_200h.DVL`, window B shows `CPC_448h.PTC_HV_Volt`, and the user drags the V_ANZ legend row onto window B and releases
- **THEN** V_ANZ is listed and drawn in window B with the same swatch colour as before, window A shows only DVL, and the revision increased by exactly one
- **Evidence:** UI check (screenshot after the drop, revision in the status strip); `apps/web/test/drag.test.ts` › "moves on plain drop and copies with Alt or Ctrl"

#### Scenario: Copy by drag
- **WHEN** the user drags the DVL row onto window B with Alt (or Ctrl) held at release
- **THEN** DVL is shown in both windows in the same colour
- **Evidence:** `apps/web/test/drag.test.ts` › "moves on plain drop and copies with Alt or Ctrl"; UI check if the browser automation can hold the modifier, else `not_run` with the test as evidence

#### Scenario: Last signal dragged out
- **WHEN** window A shows only `BS_200h.DVL`, window B shows `CPC_448h.PTC_HV_Volt`, and the user drags the DVL legend row onto window B and releases
- **THEN** window B shows both signals, window A is gone from the page, and the revision increased by exactly one
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the drop, revision in the status strip); `packages/shared/test/apply.test.ts` › "removes a window emptied by a move"

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
- **WHEN** window B shows `CPC_448h.PTC_HV_Volt` and `COMBI_412h.V_ANZ`, and the user drags the PTC_HV_Volt row from window B onto "+ New window"
- **THEN** a new window "Window <n>" appears last with B's range and mode, showing PTC_HV_Volt, and window B stays with V_ANZ; dragging V_ANZ, B's last signal, onto "+ New window" afterwards creates another new window and removes B
- **Evidence:** `apps/web/test/drag.test.ts` › "drops into a new window"; `packages/shared/test/apply.test.ts` › "moves the only signal into a new window and removes the source"; UI check (screenshot after each drop)

#### Scenario: Hint names the action
- **WHEN** the user drags an explorer row over a window that can take it, and later a legend row over a window that can take it
- **THEN** the first window shows "Drop to add", the second "Drop to move · Alt/Ctrl+drop to copy"
- **Evidence:** UI check (two screenshots while dragging)

### Requirement: One y-axis per unit
Signals with the same unit SHALL share one y scale and axis; each unit SHALL have its own. A signal without unit SHALL have its own scale, titled with its name. The axis title SHALL be the unit, in the signal's colour when it is the only signal on that axis. Origin: D-018 ("'Same value range' means **same unit**: one y-axis per unit, nothing more."); D-017 („gleiche signalbereich gleiche achse“); coloured title from power-user expectations (feedback 2026-10-14, point 2).

#### Scenario: Two signals, same unit
- **WHEN** a window shows `CPC_168h.EAC_HV_Volt` and `CPC_448h.PTC_HV_Volt` (both `V`)
- **THEN** one axis is drawn on the left titled `V` in neutral colour, and the `[V]` of both legend rows has the tooltip "y axis L"
- **Evidence:** UI check (screenshot); `apps/web/test/axes.test.ts` › "puts signals with the same unit on one axis"

### Requirement: Stacked axes
Every unit SHALL get a drawn y axis, stacked up to two per side in signal order: first unit inner left (`L`), second inner right (`R`), third outer left (`L2`), fourth outer right (`R2`); the plot narrows. Each legend row's `[unit]` SHALL name its axis side as tooltip (D-030: the side column is gone). Origin: D-019 ("stacked axes, up to two per side (at most four units), the plot area gets narrower. Every value stays readable."); legend sides from feedback 2026-10-14, point 2.

#### Scenario: Second unit
- **WHEN** `COMBI_412h.V_ANZ` (`km/h`) is added to that window
- **THEN** a right axis titled `km/h` appears in V_ANZ's colour, V_ANZ's `[km/h]` has the tooltip "y axis R", and the `V` axis stays left
- **Evidence:** UI check (screenshot); `apps/web/test/axes.test.ts` › "stacks axes L, R, L2, R2 in signal order", "colours an axis like its only signal"

#### Scenario: Third and fourth unit
- **WHEN** `MS_608h.T_MOT` (`°C`) and then `BS_200h.DVL` (`1/min`) are added as well
- **THEN** a `°C` axis appears outer left and a `1/min` axis outer right, each in its signal's colour with readable tick labels, the plot is narrower, and their `[unit]` tooltips name `L2` and `R2`
- **Evidence:** UI check (screenshot); `apps/web/test/axes.test.ts` › "stacks axes L, R, L2, R2 in signal order"

#### Scenario: Unit-less signal and stable sides
- **WHEN** a window lists a signal without unit before a `V` signal, and only the `V` signal's data has loaded
- **THEN** the unit-less signal has its own scale titled with its name on the left and `V` is on the right, before and after the other data arrives
- **Evidence:** `apps/web/test/axes.test.ts` › "gives unit-less signals their own axis titled by name", "keeps sides stable before data loads"

### Requirement: Readable axis titles
Axis titles SHALL be horizontal text above their axis, showing the unit exactly as in the signal metadata, preceded by the axis' SI prefix when its ticks are scaled ("Axis tick numbers"), and SHALL NOT overlap or cut tick labels; tick labels SHALL NOT be cut. Origin: bug "°C garbled in the rotated axis title" (feedback 2026-10-14); prefix: D-026.

#### Scenario: Degree sign
- **WHEN** a window shows only `AC_A1.T_SOLL`
- **THEN** the left axis title reads `°C` in T_SOLL's colour, and the tick labels are fully visible
- **Evidence:** UI check (zoomed screenshot of the axis)

### Requirement: Stable colours in windows
Each signal SHALL be drawn, listed and SNA-marked in its workspace colour, the same in every window. Origin: D-018 ("stable signal colours across windows").

#### Scenario: First signals of two windows
- **WHEN** window 1 shows `COMBI_412h.V_ANZ` first and window 2 shows `CPC_448h.PTC_HV_Volt` first, and V_ANZ is also copied into window 2
- **THEN** the two first signals have different colours, and V_ANZ has the same colour in both windows
- **Evidence:** UI check (screenshot); `packages/shared/test/apply.test.ts` › "assigns stable colours across windows"

### Requirement: Window names
A window SHALL be named by its title or, untitled, "Window <n>" everywhere it is named, including the explorer's "Add to" list. Origin: D-018 ("window rename"); bug "'Add to' lists raw IDs" (feedback 2026-10-14).

#### Scenario: New window from the explorer is untitled
- **WHEN** the user adds `COMBI_412h.V_ANZ` to "New window" in the explorer and the new window gets the ID `w<n>`
- **THEN** the new window's header reads `Window <n>` (not `V_ANZ`), the "Add to" list shows `Window <n>`, and `curl -s localhost:7310/api/workspace | jq '.workspace.windows[-1].title'` prints `null`
- **Evidence:** UI check (screenshot of header and "Add to" list); the `curl` command. Origin: lead decision (rounds.md round 5): a signal-name title goes stale once that signal is moved out.

### Requirement: Renaming a window
A double-click on the title, or "Rename" in the window menu, SHALL allow renaming in place (Enter or leaving the field saves, Esc cancels); a single click on the title marks the window (workspace-layout "Marked window"). The title's tooltip SHALL name the full title and "Double-click to rename". Origin: D-018 ("window rename"); D-027 (a click on the header marks, so renaming moves to the double-click).

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

### Requirement: Aligned time axes
All windows SHALL use the same plot left and right insets (per side, the widest natural axis width of any window), so that one timestamp sits at the same x position in every window of equal width. Origin: lead decision (rounds.md round 5), a necessary consequence of D-017 (linked zoom is only comparable when the time axes line up).

#### Scenario: Different axis counts line up
- **WHEN** "Link time axes" is on, window 1 shows `COMBI_412h.V_ANZ` only (one axis, `L`) and window 2 shows `CPC_448h.PTC_HV_Volt`, `COMBI_412h.V_ANZ` and `MS_608h.T_MOT` (axes `L`, `R`, `L2`)
- **THEN** the left and right edges of both plot areas are at the same x (within 1 px), and the crosshair over a timestamp in window 1 and the same timestamp's tick in window 2 are vertically aligned
- **Evidence:** UI check (one screenshot of both windows with a vertical guide or measured plot edges); `apps/web/test/insets.test.ts` › "takes the largest axis width per side across windows"

### Requirement: Crosshair follows the pointer only
The plot crosshair SHALL be hidden when the pointer leaves the plot and right after every change of the window's shown range, whatever caused it (wheel zoom, wheel pan, drag-select, double-click reset, navigation keys, "Go to", presets, "Back", "Reset", a linked window or the CLI), until the pointer moves over the plot again. Origin: lead decision (rounds.md round 5 of `improve-window-workflow`): a crosshair left at its old pixel points at a wrong time; D-027 (keys and typed ranges).

#### Scenario: Leave and zoom
- **WHEN** the pointer hovers a V_ANZ plot (crosshair visible), then leaves the plot; then the user returns, Ctrl+wheel-zooms once without moving, and later drag-selects a range and double-clicks the plot
- **THEN** the crosshair is gone after leaving, and after each of the wheel zoom, the drag-select and the double-click reset until the pointer moves
- **Evidence:** UI check (screenshots after leaving and after each zoom commit)

#### Scenario: Pan and Zoom out
- **WHEN** the pointer hovers a V_ANZ plot (crosshair visible), the user presses `→` without moving, then moves, then presses `-`
- **THEN** the crosshair is gone after `→` until the pointer moves, and gone again after `-`
- **Evidence:** UI check (screenshots after each key)

### Requirement: Wheel zoom step
With Ctrl or Shift held, a wheel event over a plot SHALL zoom the time span centred on the pointer (a mouse wheel event by "Mouse wheel steps"): one tick scales it by 2^(1/5), so five ticks double or halve the span, and one event zooms by at most five ticks (at most ×2). Origin: D-025 („Ctrl+wheel or Shift+wheel zooms the chart under the pointer"); step size: lead decision (rounds.md round 5 of `improve-window-workflow`), the exact feel is Jan's to judge.

#### Scenario: Five ticks out
- **WHEN** a window shows 2026-10-13T09:56:00Z–09:58:00Z (2 min) and five wheel ticks of 100 px each (not a mouse wheel by "Mouse wheel steps") arrive outward with Ctrl held and the pointer at the centre of the plot
- **THEN** the header range spans about 4 min (±10 %), centred on about 09:57, and the page is not zoomed
- **Evidence:** UI check (screenshots of the header before and after) if the browser automation can hold Ctrl during a wheel, else `not_run` with the test as evidence; `apps/web/test/zoom.test.ts` › "wheel factor is 2 per 5 ticks, capped at 5 ticks per event"

### Requirement: Wheel zoom delta
For a wheel zoom, a tick SHALL be 100 px of delta in pixel mode and 3 lines in line mode, and one page in page mode SHALL count as five ticks. The delta SHALL be the vertical one, or the horizontal one when that is larger (macOS turns Shift+wheel into a horizontal delta). Origin: D-025; lead decision (rounds.md round 5 of `improve-window-workflow`).

#### Scenario: Page-mode wheel
- **WHEN** a wheel event with Ctrl arrives in page mode with a vertical delta of one page
- **THEN** the span changes by ×2 (five ticks, the cap)
- **Evidence:** `apps/web/test/zoom.test.ts` › "wheel factor is 2 per 5 ticks, capped at 5 ticks per event" (includes a page-mode case); no UI check (no test device sends page mode)

### Requirement: Pinch zooms the plot
A trackpad pinch (a wheel event with Ctrl set by the browser) SHALL zoom like a Ctrl+wheel, and the browser's own page zoom SHALL NOT happen over a plot. Origin: D-025; lead decision (rounds.md round 5 of `improve-window-workflow`).

#### Scenario: Shift and pinch
- **WHEN** wheel events arrive with Shift and only a horizontal delta of 500 px, and with Ctrl and a vertical delta of −20 px (a pinch)
- **THEN** the first zooms out ×2, the second zooms in by 2^(−0.04)
- **Evidence:** `apps/web/test/zoom.test.ts` › "classifies wheel events: plain scrolls, Ctrl or Shift zooms, horizontal swipe pans"

### Requirement: Minimum zoom span
A zoom that would make the window's span shorter than 100 ns SHALL be ignored; the range stays as it was. Origin: necessary consequence of nanosecond timestamps (series-query "Timestamp precision"): below 100 ns ticks and the header cannot tell times apart.

#### Scenario: Zoom in past 100 ns
- **WHEN** a window shows a 1 µs range and the user keeps wheel-zooming in at one point
- **THEN** the span stops at 100 ns or more and no command with a shorter span is sent
- **Evidence:** UI check (header and revision after the last tick)

### Requirement: Calendar ticks for wide spans
When a span is too wide for daily or weekly date labels, the time axis SHALL label local month starts every n months, n the smallest of 1, 2, 3, 6, 12, 24, 60, 120, 240, 600, 1200 whose labels fit the plot width at 80 px per label; labels SHALL read `YYYY-MM`, or `YYYY` for steps of a year or more. Origin: necessary consequence of the zoom bounds (1900 … 2262): zoomed far out, clock-based ticks overlapped (round 1 finding "smeared axis at clamped range").

#### Scenario: Full bounds
- **WHEN** a window 800 px wide shows 1900-01-01 … 2262-04-11
- **THEN** the axis reads 1950, 2000, …, 2250
- **Evidence:** `apps/web/test/calendar.test.ts` › "labels the full 1900 … 2262 range with years 1950 … 2250 at 800 px"

#### Scenario: Three months
- **WHEN** a window 800 px wide shows 2026-07-15 … 2026-10-15
- **THEN** the axis reads 2026-08, 2026-09, 2026-10 at local month starts; a 24 h span keeps the clock-based ticks
- **Evidence:** `apps/web/test/calendar.test.ts` › "labels about three months with YYYY-MM at local month starts", "leaves short spans to the clock-based steps"

### Requirement: Header range in milliseconds
The window header SHALL show its range in local time with at most millisecond precision, cut (never rounded up), trailing zero groups dropped. Origin: round 1 finding "nanosecond header range": ranges from zoom, history and extents carry nanoseconds, which made the header unreadable.

#### Scenario: Nanosecond range
- **WHEN** a range starts at 2026-10-13T09:12:00.999999999Z
- **THEN** the header shows `… 11:12:00.999` (Europe/Berlin), not `.000` of the next second
- **Evidence:** `apps/web/test/axis.test.ts` › "shows at most milliseconds and drops trailing zeros", "truncates instead of rounding up"

### Requirement: Resizable window height
The user SHALL be able to change a timeseries window's plot height by dragging either its corner grip ("Corner grip") or the strip below the plot, between 120 and 1200 px; the height SHALL be kept in the workspace. While dragging, only the dragging browser's plot SHALL follow the pointer; on release exactly one `window.setHeight` command SHALL be sent, and none when the released height equals the stored one. Origin: D-018 ("resizable window heights"); D-037 item (1) for the grip; the strip stays per design G1 (Q1).

#### Scenario: Taller window
- **WHEN** the user drags the strip below a window's plot about 200 px down and reloads the browser
- **THEN** the plot is about 480 px tall before and after the reload
- **Evidence:** UI check on smart451 at 1440×900 (screenshots before and after reload); `packages/shared/test/apply.test.ts` › "sets window height within bounds"

#### Scenario: Bounds
- **WHEN** a dragged height would be 50 px or 5000 px
- **THEN** the plot height is 120 px or 1200 px, and the command sent on release carries that clamped height
- **Evidence:** `apps/web/test/height.test.ts` › "clamps a dragged height to 120–1200 px"

#### Scenario: Smallest height on screen
- **WHEN** a window's plot is 280 px tall and the user drags its grip 300 px up and releases
- **THEN** the plot element (`.plot`) measures 120 px tall (±1) and the window's bottom edge moved up by about 160 px; no empty band remains below the drawn plot
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, `.plot` and window rects before and after)

#### Scenario: One command per drag
- **WHEN** the user drags the grip 200 px down, back up 200 px and releases; then drags it 100 px down and releases
- **THEN** the first release sends no command and leaves the revision unchanged; the second sends exactly one `window.setHeight` and the revision rises by exactly one
- **Evidence:** `apps/web/test/height.test.ts` › "sends one setHeight only when the height changed"; UI check on smart451 (revision in the status strip before and after each release)

### Requirement: Double-click resets zoom
A double-click in the plot SHALL set the window's range to the union of its signals' extents (first point to just after the last point). While linked, all windows SHALL follow. Origin: D-018 ("double-click resets zoom").

#### Scenario: Back to the full extent
- **WHEN** a window shows only `COMBI_412h.V_ANZ` zoomed to 2026-10-13T09:56:59Z–09:57:01Z and the user double-clicks the plot
- **THEN** the range becomes 2026-10-11T12:34:24.824Z to 2026-10-13T13:17:33.221Z (header in local time) and the view is aggregated
- **Evidence:** UI check (screenshot of the header); `apps/web/test/zoom.test.ts` › "computes the extent range rounded up to the next millisecond"

### Requirement: Zoom history
Each committed wheel zoom, wheel pan, rectangle zoom, double-click reset, "Reset", navigation key, "Go to" and span preset SHALL be recorded; the option bar's "Back" and the Backspace key SHALL return to the previous range, up to 50 steps. While linked, all windows SHALL share one history; while unlinked, each window has its own. "Back" SHALL be disabled when there is no previous range. Origin: D-018 ("zoom history back"); D-025 (one "Back", in the bar); D-027 (new navigation undone alike).

#### Scenario: Two steps back
- **WHEN** the user zooms a V_ANZ window from its full extent into the morning of 2026-10-13, then into 09:56–09:58, then presses Backspace twice with the pointer over the window
- **THEN** the window shows the morning range, then the full extent, and the bar's "Back" is disabled
- **Evidence:** UI check (screenshots of the header after each step); `apps/web/test/zoom.test.ts` › "keeps a bounded zoom history", "shares one history while linked"

### Requirement: Backspace target
Backspace SHALL act on the window under the pointer, else the window zoomed last, and SHALL do nothing while a text field has focus. Origin: D-018; D-025.

#### Scenario: Backspace in a text field
- **WHEN** the search field of the explorer has focus and the user presses Backspace
- **THEN** only the search text changes; no window range changes
- **Evidence:** UI check (revision unchanged where the app shows it); `apps/web/test/keys.test.ts` › "treats input, textarea, select and contenteditable as text fields"

### Requirement: Zoom history per browser tab
The zoom history SHALL live in the browser tab only, not in the workspace; a reload starts with an empty history. Origin: necessary consequence of design D6: history steps are view navigation, and a step back is sent as an ordinary `window.setRange`.

#### Scenario: History after reload
- **WHEN** a window was zoomed twice (Back enabled) and the browser reloads
- **THEN** the window shows the last range and Back is disabled
- **Evidence:** UI check (screenshot of the header after reload)

### Requirement: Zoom stays within time bounds
Wheel zoom, pan, navigation keys, "Go to", presets, reset and back SHALL keep the window range within 1900-01-01T00:00:00Z … 2262-04-11T00:00:00Z. Origin: necessary consequence of the bug "window range 1036-01-11 … 3937-05-09" (D-021).

#### Scenario: Zoom out forty times
- **WHEN** a window shows `CPC_448h.PTC_HV_Volt` and the user presses `-` 40 times with the pointer over it
- **THEN** the header range never shows a year before 1900 or after 2262, no command is rejected, and the signal is still drawn (as an aggregated point or short curve)
- **Evidence:** UI check (screenshot of the header and the message area); `apps/web/test/zoom.test.ts` › "clamps ranges into the time bounds"

### Requirement: Valid constants at raw 0 are drawn
A stored value that is not an SNA code of its signal SHALL be drawn as a value even when it is constant and equals the physical value of raw 0. Origin: D-019 ("T_SOLL's raw 0 (−40 °C, all data on smart451) is shown as a valid value; the DBC rules (D-010, D-014, D-015) apply unchanged, no per-signal exceptions."); data facts in design "Bug analysis". `MS_312h.DNMOT` (−127, D-012) is covered by the existing scenario "Valid constant, no SNA" under "SNA share in the signal list".

#### Scenario: T_SOLL
- **WHEN** a window shows the full extent of `AC_A1.T_SOLL`
- **THEN** the curve is a flat line at −40 °C and the legend shows no SNA share
- **Evidence:** UI check (screenshot)

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

### Requirement: Option bar
Above the windows, an option bar SHALL stay visible while the window list scrolls. It SHALL hold, in this order: the cursor toggles "A", "B" and "Diff" (cursors spec), "Link time axes", the "Go to" field and the span presets (time-navigation), "Back", "Reset", the digits option (number-format) and "+ Values window". Origin: D-023 (cursor toggles, diff mode, "Link time axes", zoom back and reset in a bar); D-025 (one "Back", one "Reset"); D-027 (time navigation); D-026 (digits option).

#### Scenario: Scrolled down
- **WHEN** six windows exist and the list is scrolled to the end
- **THEN** the option bar is fully visible above the windows with its controls in that order
- **Evidence:** UI check (screenshot)

### Requirement: Bar zoom back and reset
The bar's "Back" SHALL step back the zoom history of its target window, and "Reset" SHALL set the target's range to the union of its signals' extents. They are the only Back and Reset controls (D-025). While linked, "Reset" SHALL use the signals of all timeseries windows. "Back" SHALL be disabled when the target has no history. Origin: D-023 (zoom back / reset zoom in the bar); D-025 („one "Back" and one "Reset"").

#### Scenario: Linked reset
- **WHEN** "Link time axes" is on, window 1 shows `COMBI_412h.V_ANZ`, window 2 shows `CPC_448h.PTC_HV_Volt`, both at 2026-10-13T13:08:00Z–13:08:03Z, and the user clicks "Reset"
- **THEN** both windows show the union of both signals' extents (earliest first point to just after the latest last point), and "Back" returns both to 13:08:00Z–13:08:03Z
- **Evidence:** `apps/web/test/bar.test.ts` › "resets to the union of all timeseries extents while linked"; UI check (screenshots of both headers)

### Requirement: Bar target
The target of the bar's "Back" and "Reset" SHALL be the window zoomed last, else the first timeseries window. While unlinked, both tooltips SHALL name the target. Origin: D-024 (target while unlinked); D-029 (bar target).

#### Scenario: Unlinked back
- **WHEN** "Link time axes" is off, window 1 was zoomed once and then window 2 zoomed once, and the user clicks the bar's "Back"
- **THEN** the tooltip read "Back · Window 2", window 2 shows its previous range, and window 1 is unchanged
- **Evidence:** `apps/web/test/bar.test.ts` › "targets the window zoomed last, else the first timeseries window"; UI check (headers before and after)

### Requirement: Drop lands under the pointer
A drop SHALL go to the target under the pointer at release, never to a target the pointer left earlier. The drop zone's space SHALL stay reserved below the last window whether or not a drag runs, so nothing moves when a drag starts and the "+ New window" zone never covers a window. Origin: power-user bug (feedback 2026-10-15, item 1: three stray windows); necessary consequence of "New-window drop zone stays visible".

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
A window created by "+ Values window", by a drop on "+ New window" or by a drop on the free area below the windows (workspace-layout "Drop below the windows") SHALL be scrolled into view. Origin: power-user bug (feedback 2026-10-15, item 4: the new window was appended out of sight); D-037 item (2) for the free area.

#### Scenario: Values window below the fold
- **WHEN** six windows fill more than the viewport, the list is scrolled to the top, and the user clicks "+ Values window", later drops a legend row on "+ New window"
- **THEN** each new window is fully visible right after it appears, without manual scrolling
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each creation)

#### Scenario: Drop below a short list
- **WHEN** at 1440×900 two windows share the first row and the user drops the `BS_200h.DVL` explorer row on the free area below them
- **THEN** the new window is fully visible right after it appears, without manual scrolling
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the drop)

### Requirement: Plain wheel scrolls the page
A vertical wheel or two-finger scroll over a plot without Ctrl or Shift SHALL NOT change any range; the page or window list SHALL scroll as it does over any other element. Origin: D-025 („The mouse wheel scrolls the page"); data fact: two testers and the earlier power users lost their view by scrolling over a chart, and one "spontaneous" range change traced to trackpad momentum (feedback 2026-10-15).

#### Scenario: Scroll past a chart
- **WHEN** six windows fill more than the viewport, the pointer rests on the plot of window 1 and the user turns the wheel five ticks down
- **THEN** the window list scrolls down, every header shows the range it had before, and the revision is unchanged
- **Evidence:** UI check (screenshots before and after, revision); `apps/web/test/zoom.test.ts` › "classifies wheel events: plain scrolls, Ctrl or Shift zooms, horizontal swipe pans"

### Requirement: No zoom controls in window headers
A timeseries window's header SHALL hold no "Back", "Reset" or "Zoom out" control. Zooming back and resetting SHALL be done with the option bar's "Back" and "Reset", Backspace, `Home` (time-navigation "Navigation keys") and a double-click in the plot ("Double-click resets zoom"). This requirement defines which controls exist, not the header's layout. Origin: D-025 („one "Back" and one "Reset" (no duplicate controls in the bar and in each window, no separate "Zoom out")").

#### Scenario: Header controls
- **WHEN** two timeseries windows are open
- **THEN** neither header shows "Back", "Reset", "Reset zoom" or "Zoom out", and the option bar shows exactly one "Back" and one "Reset"
- **Evidence:** UI check (screenshot of the bar and both headers)

### Requirement: Axis tick numbers
Y-axis ticks SHALL use one SI prefix per axis, chosen from the largest absolute tick and written in the axis title before the unit, and the same number of decimals on every label, as many as the step needs to keep neighbouring labels distinct. Units without prefix (number-format) and axes titled by a signal name get none. Origin: D-026 („everywhere (… axes …)"); distinct labels are a necessary consequence (362.0, 362.5, 363.0 V need four digits; design N8).

#### Scenario: Pinned ticks
- **WHEN** the axis formatter gets the ticks 0, 500, 1000, 1500 `1/min`; 362, 362.5, 363 `V`; 0, 20, 40, 60 `km/h`; and 0, 0.0005, 0.001 `V`, each with 3 digits
- **THEN** it gives title `k1/min` with `0.0`, `0.5`, `1.0`, `1.5`; title `V` with `362.0`, `362.5`, `363.0`; title `km/h` with `0`, `20`, `40`, `60`; title `mV` with `0.0`, `0.5`, `1.0`
- **Evidence:** `packages/shared/test/numfmt.test.ts` › "formats axis ticks with one prefix per axis"

#### Scenario: Narrow voltage range
- **WHEN** a window shows `CPC_448h.PTC_HV_Volt` from 2026-10-13T13:08:00Z to 13:08:03Z
- **THEN** the axis labels are distinct, all with the same number of decimals, and the axis title reads `V` or a prefixed `V` matching the labels
- **Evidence:** UI check (zoomed screenshot of the axis)

### Requirement: Horizontal swipe pans
A wheel event over a plot without Ctrl or Shift whose horizontal delta is more than twice its vertical delta SHALL pan the time range: a delta of d pixels moves the range by d plot pixels' worth of time, keeping the span; a mouse wheel event pans by "Mouse wheel steps". Origin: replaces "Wheel pan" (D-025 turns Shift+wheel into a zoom); the page does not scroll sideways; the factor 2 keeps diagonal scrolls from panning (design N5, Jan's call Q5).

#### Scenario: Horizontal swipe pans
- **WHEN** wheel events arrive without modifier with (Δx 50, Δy 10), (Δx 30, Δy 20) and (Δx 0, Δy 50) over a plot 500 px wide showing 2 min
- **THEN** the first pans by 12 s, the second and third change no range and are left to the page
- **Evidence:** `apps/web/test/zoom.test.ts` › "classifies wheel events: plain scrolls, Ctrl or Shift zooms, horizontal swipe pans"; UI check on a trackpad only, else `not_run`

### Requirement: No text selection while dragging
While a cursor line, a legend or explorer row, or a height handle is dragged, the page SHALL select no text, wherever the pointer goes. Origin: D-031 follow-up (Jan: „while draggin browser selects text. thats strange").

#### Scenario: Line dragged over the legend
- **WHEN** the user drags cursor A's line and moves the pointer down over the legend rows before releasing
- **THEN** no text is highlighted during or after the drag
- **Evidence:** UI check by hand (real mouse), else `not_run`

### Requirement: Mouse wheel steps
A mouse wheel event in pixel mode SHALL move by a fixed step whatever its delta: a pan by 2 % of the plot width, a zoom by a quarter tick (2^(1/20)). It is a mouse event when Chrome's `wheelDelta` is a non-zero multiple of 120 and not exactly 3 × the pixel delta (a trackpad's); other events keep their deltas. Origin: D-030 (Jan: „on my mouse … wheel oversensitive"; one slow notch arrives as 4–7 accelerated events, over 1000 px in all).

#### Scenario: One slow notch
- **WHEN** the events (Δx −4.0, wheelDelta 120), (−32.0, 120), (−96.2, 240), (−129.5, 360) arrive over a plot showing 10 min, then a trackpad event (Δx 40, wheelDelta −120)
- **THEN** the notch pans the range 8 % (48 s) to the left, and the trackpad event pans by 40 plot pixels
- **Evidence:** `apps/web/test/zoom.test.ts` › "tells a mouse wheel from a trackpad", "pans 2 % of the plot per mouse event and zooms a quarter tick, whatever the delta"; UI check with Jan's mouse and trackpad only, else `not_run`

### Requirement: Corner grip
Every timeseries window SHALL show a grip in its lower right corner, visible without hovering. Dragging it SHALL change only that window's plot height, as "Resizable window height" describes; the window's width SHALL stay as the grid gives it. Values windows SHALL have no grip. Origin: D-037 item (1) („the apple like curved handle lower right to grab"; "height only"); values windows have no height (D-023: "no range, display or height").

#### Scenario: Grip visible on every timeseries window
- **WHEN** at 1440×900 the workspace shows two timeseries windows and one values window, and the pointer rests on the option bar
- **THEN** each timeseries window shows the curved grip in its lower right corner, its hit box within 20 px of the window's right and bottom border (`getBoundingClientRect()`), and the values window shows none
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, rects of each grip and window)

#### Scenario: Drag the grip
- **WHEN** a window's plot is 280 px tall at revision n and the user presses on its grip, moves 200 px down, holds, then releases
- **THEN** while holding, the plot is about 480 px tall and the revision is still n; after the release the plot stays about 480 px tall, the revision is n + 1, the window's width is unchanged (±1 px), and after a reload the plot is still about 480 px tall
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while holding and after release, plot height and window width from `getBoundingClientRect()`, revision in the status strip)

#### Scenario: Grip press is not a click elsewhere
- **WHEN** the user presses and releases the grip without moving, in a window that is not marked
- **THEN** no cursor is placed, the window is not marked, no row drag starts, and the revision is unchanged
- **Evidence:** UI check on smart451 (screenshot, revision before and after)

### Requirement: Grip appearance
The grip SHALL be a curved mark following the window's rounded corner, in a muted colour that turns to the accent colour while hovered or dragged, with the tooltip "Drag to resize height" and a vertical resize pointer. It SHALL NOT cover legend text, a value or a control. Origin: D-037 item (1) („apple like curved handle"); vertical pointer because only the height changes (design G2, Q2); no overlap as a necessary consequence of a readable legend.

#### Scenario: Look and pointer
- **WHEN** at 1440×900 the pointer rests on the option bar, then moves onto a window's grip
- **THEN** the grip is a curved mark in the muted colour at rest and in the accent colour under the pointer, the tooltip reads "Drag to resize height", and the pointer is a vertical resize pointer (`getComputedStyle(grip).cursor` is `ns-resize`)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot of the corner at rest and hovered, computed cursor)

#### Scenario: Grip covers nothing
- **WHEN** at 1440×900 a timeseries window in the right grid column shows four signals with cursors A and B on and Diff on, so its legend rows are full
- **THEN** no legend text or value overlaps the grip's hit box (rects of the grip and the last legend row's cells do not intersect)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot of the corner, rects)
