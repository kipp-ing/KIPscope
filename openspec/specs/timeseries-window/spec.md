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
After a zoom or pan, the window SHALL request data for the new range and resolution, keep showing the already loaded data meanwhile, and replace it when the new data arrives.

#### Scenario: Zoom into detail
- **WHEN** the user zooms from an aggregated view into a range with few raw points
- **THEN** the window loads and shows the raw points

### Requirement: Stale responses discarded
A response for an earlier time range or revision SHALL NOT replace data for a newer one.

#### Scenario: Out-of-order responses
- **WHEN** the user zooms twice quickly and the first response arrives after the second
- **THEN** the window shows the data of the second zoom

### Requirement: Loading and error state
A window SHALL show per signal whether data is loading, complete, or failed, including the error message on failure.

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
While the time axes are linked, zoom, pan, zoom-out, double-click reset and history back in any window SHALL change the time range of all windows; the other windows SHALL show the new range at the latest 1 s after the last zoom or pan input. While unlinked, each window SHALL keep its own range. Origin: D-017 („gemeinsamer zoom standard aktiv abschaltbar“).

#### Scenario: Zoom one of two linked windows
- **WHEN** "Link time axes" is on, window 1 shows `COMBI_412h.V_ANZ`, window 2 shows `CPC_448h.PTC_HV_Volt`, and the user wheel-zooms in window 1
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
A signal's legend row SHALL be draggable onto another window: a plain drop moves the signal, a drop with Alt or Ctrl held copies it, each as one `window.moveSignal` command. The signal SHALL keep its colour and take the target window's display mode (mode is a window option). An emptied window SHALL stay and show "Drop a signal here". Origin: D-017 („Signale zwischen zwei anzeigen hin und her“); Alt/Ctrl copy from power-user expectations (feedback 2026-10-14, point 1).

#### Scenario: Move by drag
- **WHEN** window A shows `COMBI_412h.V_ANZ` and `BS_200h.DVL`, window B shows `CPC_448h.PTC_HV_Volt`, and the user drags the V_ANZ legend row onto window B and releases
- **THEN** V_ANZ is listed and drawn in window B with the same swatch colour as before, window A shows only DVL, and the revision increased by exactly one
- **Evidence:** UI check (screenshot after the drop, revision in the top bar); `apps/web/test/drag.test.ts` › "moves on plain drop and copies with Alt or Ctrl"

#### Scenario: Copy by drag
- **WHEN** the user drags the DVL row onto window B with Alt (or Ctrl) held at release
- **THEN** DVL is shown in both windows in the same colour
- **Evidence:** `apps/web/test/drag.test.ts` › "moves on plain drop and copies with Alt or Ctrl"; UI check if the browser automation can hold the modifier, else `not_run` with the test as evidence

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

### Requirement: One y-axis per unit
Signals with the same unit SHALL share one y scale and axis; each unit SHALL have its own. A signal without unit SHALL have its own scale, titled with its name. The axis title SHALL be the unit, in the signal's colour when it is the only signal on that axis. Origin: D-018 ("'Same value range' means **same unit**: one y-axis per unit, nothing more."); D-017 („gleiche signalbereich gleiche achse“); coloured title from power-user expectations (feedback 2026-10-14, point 2).

#### Scenario: Two signals, same unit
- **WHEN** a window shows `CPC_168h.EAC_HV_Volt` and `CPC_448h.PTC_HV_Volt` (both `V`)
- **THEN** one axis is drawn on the left titled `V` in neutral colour, and both legend rows show `L`
- **Evidence:** UI check (screenshot); `apps/web/test/axes.test.ts` › "puts signals with the same unit on one axis"

### Requirement: Stacked axes
Every unit SHALL get a drawn y axis, stacked up to two per side in signal order: first unit inner left (`L`), second inner right (`R`), third outer left (`L2`), fourth outer right (`R2`); the plot narrows. Each legend row SHALL show its axis side. Origin: D-019 ("stacked axes, up to two per side (at most four units), the plot area gets narrower. Every value stays readable."); legend sides from feedback 2026-10-14, point 2.

#### Scenario: Second unit
- **WHEN** `COMBI_412h.V_ANZ` (`km/h`) is added to that window
- **THEN** a right axis titled `km/h` appears in V_ANZ's colour, V_ANZ's legend row shows `R`, and the `V` axis stays left
- **Evidence:** UI check (screenshot); `apps/web/test/axes.test.ts` › "stacks axes L, R, L2, R2 in signal order", "colours an axis like its only signal"

#### Scenario: Third and fourth unit
- **WHEN** `MS_608h.T_MOT` (`°C`) and then `BS_200h.DVL` (`1/min`) are added as well
- **THEN** a `°C` axis appears outer left and a `1/min` axis outer right, each in its signal's colour with readable tick labels, the plot is narrower, and the legend rows show `L2` and `R2`
- **Evidence:** UI check (screenshot); `apps/web/test/axes.test.ts` › "stacks axes L, R, L2, R2 in signal order"

#### Scenario: Unit-less signal and stable sides
- **WHEN** a window lists a signal without unit before a `V` signal, and only the `V` signal's data has loaded
- **THEN** the unit-less signal has its own scale titled with its name on the left and `V` is on the right, before and after the other data arrives
- **Evidence:** `apps/web/test/axes.test.ts` › "gives unit-less signals their own axis titled by name", "keeps sides stable before data loads"

### Requirement: Readable axis titles
Axis titles SHALL be horizontal text above their axis, showing the unit exactly as in the signal metadata, and SHALL NOT overlap or cut tick labels; tick labels SHALL NOT be cut. Origin: bug "°C garbled in the rotated axis title" (feedback 2026-10-14); the API delivers `°C` correctly (design "Bug analysis").

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
A window SHALL be named by its title or, untitled, "Window <n>" everywhere it is named, including the explorer's "Add to" list. Clicking the title SHALL allow renaming in place (Enter or leaving the field saves, Esc cancels). Origin: D-018 ("window rename"); bug "'Add to' lists raw IDs" (feedback 2026-10-14).

#### Scenario: Rename
- **WHEN** the user clicks the title of a window, types `HV voltages` and presses Enter
- **THEN** the header and the explorer's "Add to" list show `HV voltages`, also after a browser reload
- **Evidence:** UI check (screenshot of header and open "Add to" list)

#### Scenario: New window from the explorer is untitled
- **WHEN** the user adds `COMBI_412h.V_ANZ` to "New window" in the explorer and the new window gets the ID `w<n>`
- **THEN** the new window's header reads `Window <n>` (not `V_ANZ`), the "Add to" list shows `Window <n>`, and `curl -s localhost:7310/api/workspace | jq '.workspace.windows[-1].title'` prints `null`
- **Evidence:** UI check (screenshot of header and "Add to" list); the `curl` command. Origin: lead decision (rounds.md round 5): a signal-name title goes stale once that signal is moved out.

### Requirement: Aligned time axes
All windows SHALL use the same plot left and right insets (per side, the widest natural axis width of any window), so that one timestamp sits at the same x position in every window of equal width. Origin: lead decision (rounds.md round 5), a necessary consequence of D-017 (linked zoom is only comparable when the time axes line up).

#### Scenario: Different axis counts line up
- **WHEN** "Link time axes" is on, window 1 shows `COMBI_412h.V_ANZ` only (one axis, `L`) and window 2 shows `CPC_448h.PTC_HV_Volt`, `COMBI_412h.V_ANZ` and `MS_608h.T_MOT` (axes `L`, `R`, `L2`)
- **THEN** the left and right edges of both plot areas are at the same x (within 1 px), and the crosshair over a timestamp in window 1 and the same timestamp's tick in window 2 are vertically aligned
- **Evidence:** UI check (one screenshot of both windows with a vertical guide or measured plot edges); `apps/web/test/insets.test.ts` › "takes the largest axis width per side across windows"

### Requirement: Crosshair follows the pointer only
The plot crosshair SHALL be hidden when the pointer leaves the plot and right after every range change made in the window itself (wheel zoom, wheel pan, drag-select, "Zoom out", double-click reset), until the pointer moves over the plot again. Origin: lead decision (rounds.md round 5): a crosshair left at the old pixel after a zoom points at a wrong time.

#### Scenario: Leave and zoom
- **WHEN** the pointer hovers a V_ANZ plot (crosshair visible), then leaves the plot; then the user returns, wheel-zooms once without moving, and later drag-selects a range and double-clicks the plot
- **THEN** the crosshair is gone after leaving, and after each of the wheel zoom, the drag-select and the double-click reset until the pointer moves
- **Evidence:** UI check (screenshots after leaving and after each zoom commit)

#### Scenario: Pan and Zoom out
- **WHEN** the pointer hovers a V_ANZ plot (crosshair visible), the user Shift+wheels once without moving, then moves, then clicks "Zoom out"
- **THEN** the crosshair is gone after the pan until the pointer moves, and gone after "Zoom out"
- **Evidence:** UI check (screenshots after the pan and after "Zoom out")

### Requirement: Wheel zoom step
One wheel tick SHALL scale the time span by 2^(1/5), centred on the pointer, so five ticks double or halve the span; one wheel event SHALL zoom by at most five ticks (at most ×2). A tick is 100 px of vertical delta in pixel mode, 3 lines in line mode, and one page in page mode counts as five ticks. Origin: lead decision (rounds.md round 5); the exact feel is Jan's to judge (design D4 says what a factor of two either way does).

#### Scenario: Five ticks out
- **WHEN** a window shows 2026-10-13T09:56:00Z–09:58:00Z (2 min) and the user turns the mouse wheel five ticks outward with the pointer at the centre of the plot
- **THEN** the header range spans about 4 min (±10 %), centred on about 09:57
- **Evidence:** UI check (screenshots of the header before and after); `apps/web/test/zoom.test.ts` › "wheel factor is 2 per 5 ticks, capped at 5 ticks per event"

#### Scenario: Page-mode wheel
- **WHEN** a wheel event arrives in page mode with a vertical delta of one page
- **THEN** the span changes by ×2 (five ticks, the cap)
- **Evidence:** `apps/web/test/zoom.test.ts` › "wheel factor is 2 per 5 ticks, capped at 5 ticks per event" (includes a page-mode case); no UI check (no test device sends page mode)

### Requirement: Wheel pan
A horizontal wheel movement, or a vertical one with Shift held, SHALL pan the time range: a wheel delta of d pixels moves the range by d plot pixels' worth of time, keeping the span. Origin: necessary consequence of D-018 (window layout with keys): trackpads and Shift+wheel are the usual way to move along a time axis; the vertical wheel is taken by zoom.

#### Scenario: Shift+wheel pans
- **WHEN** a window shows 2026-10-13T09:56:00Z–09:58:00Z and the user turns the wheel with Shift held
- **THEN** the header range moves earlier or later and still spans 2 min
- **Evidence:** UI check (screenshots of the header before and after)

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

### Requirement: One-line window header
The window header SHALL stay on one line: a long title is cut with an ellipsis and shown in full as tooltip, and the buttons stay on the header line. Origin: bug "window header wraps with long titles" (feedback 2026-10-14).

#### Scenario: Long title
- **WHEN** a window in a 1280 px wide browser is renamed to an 80-character title
- **THEN** the header is one line with the title cut by an ellipsis and Remove on the same line
- **Evidence:** UI check (screenshot)

### Requirement: Resizable window height
The user SHALL be able to change a window's plot height by dragging a handle below the plot, between 120 and 1200 px; the height SHALL be kept in the workspace. Origin: D-018 ("resizable window heights").

#### Scenario: Taller window
- **WHEN** the user drags the handle of a window about 200 px down and reloads the browser
- **THEN** the plot is about 480 px tall before and after the reload
- **Evidence:** UI check (screenshots before and after reload); `packages/shared/test/apply.test.ts` › "sets window height within bounds"

### Requirement: Double-click resets zoom
A double-click in the plot SHALL set the window's range to the union of its signals' extents (first point to just after the last point). While linked, all windows SHALL follow. Origin: D-018 ("double-click resets zoom").

#### Scenario: Back to the full extent
- **WHEN** a window shows only `COMBI_412h.V_ANZ` zoomed to 2026-10-13T09:56:59Z–09:57:01Z and the user double-clicks the plot
- **THEN** the range becomes 2026-10-11T12:34:24.824Z to 2026-10-13T13:17:33.221Z (header in local time) and the view is aggregated
- **Evidence:** UI check (screenshot of the header); `apps/web/test/zoom.test.ts` › "computes the extent range rounded up to the next millisecond"

### Requirement: Zoom history
Each committed zoom, pan, zoom-out or double-click reset SHALL be recorded; "Back" in the window header and the Backspace key SHALL return to the previous range, up to 50 steps. While linked, all windows SHALL share one history; while unlinked, each window has its own. Backspace SHALL act on the window under the pointer, else the window zoomed last, and SHALL do nothing while a text field has focus. Back SHALL be disabled when there is no previous range. Origin: D-018 ("zoom history back").

#### Scenario: Two steps back
- **WHEN** the user zooms a V_ANZ window from its full extent into the morning of 2026-10-13, then into 09:56–09:58, then presses Backspace twice with the pointer over the window
- **THEN** the window shows the morning range, then the full extent, and Back is disabled
- **Evidence:** UI check (screenshots of the header after each step); `apps/web/test/zoom.test.ts` › "keeps a bounded zoom history", "shares one history while linked"

#### Scenario: Backspace in a text field
- **WHEN** the search field of the explorer has focus and the user presses Backspace
- **THEN** only the search text changes; no window range changes
- **Evidence:** UI check (revision unchanged in the top bar); `apps/web/test/keys.test.ts` › "treats input, textarea, select and contenteditable as text fields"

### Requirement: Zoom history per browser tab
The zoom history SHALL live in the browser tab only, not in the workspace; a reload starts with an empty history. Origin: necessary consequence of design D6: history steps are view navigation, and a step back is sent as an ordinary `window.setRange`.

#### Scenario: History after reload
- **WHEN** a window was zoomed twice (Back enabled) and the browser reloads
- **THEN** the window shows the last range and Back is disabled
- **Evidence:** UI check (screenshot of the header after reload)

### Requirement: Zoom stays within time bounds
Zoom-out, wheel zoom, pan, reset and back SHALL keep the window range within 1900-01-01T00:00:00Z … 2262-04-11T00:00:00Z. Origin: necessary consequence of the bug "window range 1036-01-11 … 3937-05-09" (design "Bug analysis").

#### Scenario: Zoom out forty times
- **WHEN** a window shows `CPC_448h.PTC_HV_Volt` and the user clicks "Zoom out" 40 times
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
A window created by "+ Values window" or by a drop on "+ New window" SHALL be scrolled into view. Origin: power-user bug (feedback 2026-10-15, item 4: the new window was appended out of sight).

#### Scenario: Values window below the fold
- **WHEN** six windows fill more than the viewport, the list is scrolled to the top, and the user clicks "+ Values window", later drops a legend row on "+ New window"
- **THEN** each new window is fully visible right after it appears, without manual scrolling
- **Evidence:** UI check (screenshot after each creation)
