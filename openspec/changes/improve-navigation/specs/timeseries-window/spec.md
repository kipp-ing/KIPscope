## ADDED Requirements

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
A wheel event over a plot without Ctrl or Shift whose horizontal delta is more than twice its vertical delta SHALL pan the time range: a delta of d pixels moves the range by d plot pixels' worth of time, keeping the span. Origin: replaces "Wheel pan", whose Shift+wheel pan D-025 turns into a zoom; a horizontal swipe takes nothing from the page, which does not scroll sideways; the factor 2 keeps diagonal scrolls from panning (design N5, Jan's call Q5).

#### Scenario: Horizontal swipe pans
- **WHEN** wheel events arrive without modifier with (Δx 50, Δy 10), (Δx 30, Δy 20) and (Δx 0, Δy 50) over a plot 500 px wide showing 2 min
- **THEN** the first pans by 12 s, the second and third change no range and are left to the page
- **Evidence:** `apps/web/test/zoom.test.ts` › "classifies wheel events: plain scrolls, Ctrl or Shift zooms, horizontal swipe pans"; UI check on a trackpad only, else `not_run`

## MODIFIED Requirements

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

### Requirement: Crosshair follows the pointer only
The plot crosshair SHALL be hidden when the pointer leaves the plot and right after every change of the window's shown range, whatever caused it (wheel zoom, wheel pan, drag-select, double-click reset, navigation keys, "Go to", presets, "Back", "Reset", a linked window or the CLI), until the pointer moves over the plot again. Origin: lead decision (rounds.md round 5 of `improve-window-workflow`): a crosshair left at the old pixel after a zoom points at a wrong time; keys and typed ranges change the range under a resting pointer too (D-027).

#### Scenario: Leave and zoom
- **WHEN** the pointer hovers a V_ANZ plot (crosshair visible), then leaves the plot; then the user returns, Ctrl+wheel-zooms once without moving, and later drag-selects a range and double-clicks the plot
- **THEN** the crosshair is gone after leaving, and after each of the wheel zoom, the drag-select and the double-click reset until the pointer moves
- **Evidence:** UI check (screenshots after leaving and after each zoom commit)

#### Scenario: Pan and Zoom out
- **WHEN** the pointer hovers a V_ANZ plot (crosshair visible), the user presses `→` without moving, then moves, then presses `-`
- **THEN** the crosshair is gone after `→` until the pointer moves, and gone again after `-`
- **Evidence:** UI check (screenshots after each key)

### Requirement: Wheel zoom step
With Ctrl or Shift held, a wheel event over a plot SHALL zoom the time span centred on the pointer: one tick scales it by 2^(1/5), so five ticks double or halve the span, and one event zooms by at most five ticks (at most ×2). A tick is 100 px of delta in pixel mode, 3 lines in line mode, and one page in page mode counts as five ticks. The delta is the vertical one, or the horizontal one when that is larger (macOS turns Shift+wheel into a horizontal delta). A trackpad pinch (a wheel event with Ctrl set by the browser) SHALL zoom the same way, and the browser's own page zoom SHALL NOT happen over a plot. Origin: D-025 („Ctrl+wheel or Shift+wheel zooms the chart under the pointer"); step size: lead decision (rounds.md round 5 of `improve-window-workflow`), the exact feel is Jan's to judge.

#### Scenario: Five ticks out
- **WHEN** a window shows 2026-10-13T09:56:00Z–09:58:00Z (2 min) and the user turns the mouse wheel five ticks outward with Ctrl held and the pointer at the centre of the plot
- **THEN** the header range spans about 4 min (±10 %), centred on about 09:57, and the page is not zoomed
- **Evidence:** UI check (screenshots of the header before and after) if the browser automation can hold Ctrl during a wheel, else `not_run` with the test as evidence; `apps/web/test/zoom.test.ts` › "wheel factor is 2 per 5 ticks, capped at 5 ticks per event"

#### Scenario: Shift and pinch
- **WHEN** wheel events arrive with Shift and only a horizontal delta of 500 px, and with Ctrl and a vertical delta of −20 px (a pinch)
- **THEN** the first zooms out ×2, the second zooms in by 2^(−0.04)
- **Evidence:** `apps/web/test/zoom.test.ts` › "classifies wheel events: plain scrolls, Ctrl or Shift zooms, horizontal swipe pans"

#### Scenario: Page-mode wheel
- **WHEN** a wheel event with Ctrl arrives in page mode with a vertical delta of one page
- **THEN** the span changes by ×2 (five ticks, the cap)
- **Evidence:** `apps/web/test/zoom.test.ts` › "wheel factor is 2 per 5 ticks, capped at 5 ticks per event" (includes a page-mode case); no UI check (no test device sends page mode)

### Requirement: Zoom history
Each committed wheel zoom, wheel pan, rectangle zoom, double-click reset, "Reset", navigation key, "Go to" and span preset SHALL be recorded; the option bar's "Back" and the Backspace key SHALL return to the previous range, up to 50 steps. While linked, all windows SHALL share one history; while unlinked, each window has its own. Backspace SHALL act on the window under the pointer, else the window zoomed last, and SHALL do nothing while a text field has focus. "Back" SHALL be disabled when there is no previous range. Origin: D-018 ("zoom history back"); D-025 (one "Back", in the bar); D-027 (the new navigation is undone the same way).

#### Scenario: Two steps back
- **WHEN** the user zooms a V_ANZ window from its full extent into the morning of 2026-10-13, then into 09:56–09:58, then presses Backspace twice with the pointer over the window
- **THEN** the window shows the morning range, then the full extent, and the bar's "Back" is disabled
- **Evidence:** UI check (screenshots of the header after each step); `apps/web/test/zoom.test.ts` › "keeps a bounded zoom history", "shares one history while linked"

#### Scenario: Backspace in a text field
- **WHEN** the search field of the explorer has focus and the user presses Backspace
- **THEN** only the search text changes; no window range changes
- **Evidence:** UI check (revision unchanged where the app shows it); `apps/web/test/keys.test.ts` › "treats input, textarea, select and contenteditable as text fields"

### Requirement: Zoom stays within time bounds
Wheel zoom, pan, navigation keys, "Go to", presets, reset and back SHALL keep the window range within 1900-01-01T00:00:00Z … 2262-04-11T00:00:00Z. Origin: necessary consequence of the bug "window range 1036-01-11 … 3937-05-09" (D-021).

#### Scenario: Zoom out forty times
- **WHEN** a window shows `CPC_448h.PTC_HV_Volt` and the user presses `-` 40 times with the pointer over it
- **THEN** the header range never shows a year before 1900 or after 2262, no command is rejected, and the signal is still drawn (as an aggregated point or short curve)
- **Evidence:** UI check (screenshot of the header and the message area); `apps/web/test/zoom.test.ts` › "clamps ranges into the time bounds"

### Requirement: Readable axis titles
Axis titles SHALL be horizontal text above their axis, showing the unit exactly as in the signal metadata, preceded by the axis' SI prefix when its ticks are scaled ("Axis tick numbers"), and SHALL NOT overlap or cut tick labels; tick labels SHALL NOT be cut. Origin: bug "°C garbled in the rotated axis title" (feedback 2026-10-14); prefix: D-026.

#### Scenario: Degree sign
- **WHEN** a window shows only `AC_A1.T_SOLL`
- **THEN** the left axis title reads `°C` in T_SOLL's colour, and the tick labels are fully visible
- **Evidence:** UI check (zoomed screenshot of the axis)

### Requirement: Option bar
Above the windows, an option bar SHALL stay visible while the window list scrolls. It SHALL hold, in this order: the cursor toggles "A", "B" and "Diff" (cursors spec), "Link time axes", the "Go to" field and the span presets (time-navigation), "Back", "Reset", the digits option (number-format) and "+ Values window". Origin: D-023 („a bar holds cursor A/B on/off and diff mode, the "Link time axes" toggle (moved out of the top bar) and zoom back / reset zoom"); D-025 (one "Back", one "Reset"); D-027 (time navigation); D-026 (digits option).

#### Scenario: Scrolled down
- **WHEN** six windows exist and the list is scrolled to the end
- **THEN** the option bar is fully visible above the windows with its controls in that order
- **Evidence:** UI check (screenshot)

### Requirement: Bar zoom back and reset
The bar's "Back" SHALL step back the zoom history of its target window, and "Reset" SHALL set the target's range to the union of its signals' extents. They are the only Back and Reset controls (D-025). The target is the window zoomed last, else the first timeseries window. While linked, "Reset" SHALL use the signals of all timeseries windows. While unlinked, both tooltips SHALL name the target. "Back" SHALL be disabled when the target has no history. Origin: D-023 (zoom back / reset zoom in the bar); D-024 (target while unlinked); D-025 („one "Back" and one "Reset"").

#### Scenario: Linked reset
- **WHEN** "Link time axes" is on, window 1 shows `COMBI_412h.V_ANZ`, window 2 shows `CPC_448h.PTC_HV_Volt`, both at 2026-10-13T13:08:00Z–13:08:03Z, and the user clicks "Reset"
- **THEN** both windows show the union of both signals' extents (earliest first point to just after the latest last point), and "Back" returns both to 13:08:00Z–13:08:03Z
- **Evidence:** `apps/web/test/bar.test.ts` › "resets to the union of all timeseries extents while linked"; UI check (screenshots of both headers)

#### Scenario: Unlinked back
- **WHEN** "Link time axes" is off, window 1 was zoomed once and then window 2 zoomed once, and the user clicks the bar's "Back"
- **THEN** the tooltip read "Back · Window 2", window 2 shows its previous range, and window 1 is unchanged
- **Evidence:** `apps/web/test/bar.test.ts` › "targets the window zoomed last, else the first timeseries window"; UI check (headers before and after)

### Requirement: No value readout on hover
Hovering a plot SHALL show the crosshair only: no value or tooltip of any signal at the pointer. Values are read at the cursors, in the values window and in the chart readout (cursors "Chart readout"), and neither changes while the pointer moves. Origin: D-023 („no value readout on hover"); D-027 (readout at the cursors on the chart).

#### Scenario: Hover a speed plot
- **WHEN** A is on, the pointer moves over a window showing `COMBI_412h.V_ANZ` and `BS_200h.DVL`
- **THEN** a crosshair follows the pointer, and no signal value appears or changes anywhere on the page apart from axis ticks, values-window cells and readout cells, which stay as they were before the pointer moved
- **Evidence:** UI check (two screenshots at different pointer positions)

## REMOVED Requirements

### Requirement: Wheel pan
**Reason**: D-025 makes Shift+wheel zoom („Ctrl+wheel or Shift+wheel zooms the chart under the pointer"), so "a vertical one with Shift held SHALL pan" no longer holds.
**Migration**: Panning by wheel is the horizontal swipe ("Horizontal swipe pans"); by keyboard `←`/`→` (time-navigation "Navigation keys").
