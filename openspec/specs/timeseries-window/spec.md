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
A window SHALL offer an envelope option ("Min/max" in the window's "⋯" menu), off by default, that draws the minimum and maximum of each bucket around the mean curve.

#### Scenario: Spike in overview
- **WHEN** the envelope is on and a single raw spike lies inside one bucket
- **THEN** the envelope reaches the spike's value

#### Scenario: SNA inside a bucket
- **WHEN** the envelope is on and a bucket contains valid points and SNA points
- **THEN** the envelope spans only the valid points' minimum and maximum, and for an all-SNA bucket no envelope is drawn
- **Evidence:** `apps/web/test/build.test.ts` › "breaks mean and envelope at all-SNA buckets"; UI check in the SPEED_DISP overview above

### Requirement: Raw display modes
When a window shows raw points, each signal SHALL be drawable as lines between points, as steps holding the previous value, or with point markers, as chosen in the window's display options (the window's "⋯" menu). A step SHALL hold a value until the next point's timestamp, or only up to its hold end where the two points are split (data-gaps "Split between two points"). Origin: concept §5; hold end: D-062.

#### Scenario: Step mode
- **WHEN** step mode is selected
- **THEN** the curve holds each value until the next point's timestamp, or up to the hold end where the next point is split off

### Requirement: No invented values
The window SHALL NOT draw a curve segment where no measured point exists on at least one side; it SHALL use edge neighbors from the query to draw segments that cross the visible range edges. An SNA point SHALL count as no measured value for this purpose. Two split points (data-gaps) SHALL count as having no measured value between them beyond the earlier one's hold end. Origin: concept §5; split: D-062.

#### Scenario: Window inside a gap between points
- **WHEN** the visible range contains no point but has neighbors on both sides that are not split
- **THEN** the line or step through the window is drawn from those neighbors

#### Scenario: Window inside a split
- **WHEN** a window shows `gapcar/Evt_B11h.EVT` from 2026-10-03T00:05:10Z to 00:05:50Z (inside the logger gap; neighbours 2 at 00:04:00Z and 3 at 00:07:00Z) in line mode, then in step mode
- **THEN** nothing is drawn in either mode
- **Evidence:** `apps/web/test/build.test.ts` › "breaks lines and steps at gaps"

#### Scenario: Before the first point
- **WHEN** the visible range starts before the signal's first point
- **THEN** nothing is drawn before that point

#### Scenario: SNA neighbor
- **WHEN** the visible range contains no point and its leading neighbor is SNA
- **THEN** no line or step is drawn through the window, and the SNA period is marked
- **Evidence:** `apps/web/test/build.test.ts` › "draws nothing from an SNA neighbor"

### Requirement: Reload on navigation
After and during a zoom or pan, the window SHALL request the data for the shown range and resolution that is not in the tab's series cache, without waiting for the range command; meanwhile it SHALL show a coarser placeholder of the shown range (series-cache "Placeholder where tiles are missing"), or the already loaded data when no placeholder is available, and replace it when the new data arrives. When the cache holds all data for the shown range and resolution, the window SHALL show it at once, in the frame that first shows the range, without a request and without a loading state. Origin: concept §5 („Beim Hineinzoomen werden feinere Daten nachgeladen"); D-037 (3) (loaded data stays in the browser, „so zooming and panning back is fast"); D-040 (1), (2) (loading on the preview range, coarse data where finer tiles are missing).

#### Scenario: Zoom into detail
- **WHEN** the user zooms from an aggregated view into a range with few raw points
- **THEN** the window loads and shows the raw points

#### Scenario: Back to a cached range
- **WHEN** the user zooms into a range, waits for its data, and goes back to the previous range with Backspace
- **THEN** the previous curve is shown at once and no `/api/series` request is sent
- **Evidence:** `apps/web/test/loader.test.ts` › "draws a previous view again without a request"; UI check (network log filtered to `/api/series`, screenshot of the restored curve)

#### Scenario: Loading starts during the gesture
- **WHEN** the user zooms with one Ctrl+wheel step into a range that is not cached
- **THEN** its `/api/series` request starts within 50 ms of the wheel event, not after the 300 ms command delay
- **Evidence:** UI timing check (design T1 of change `improve-zoom-speed`, step 2: Resource Timing `startTime` − t0); `apps/web/test/loader.test.ts` › "throttles loads during a gesture: first at once, then once per interval"

### Requirement: Stale responses discarded
A response for an earlier time range or revision SHALL NOT replace data for a newer one.

#### Scenario: Out-of-order responses
- **WHEN** the user zooms twice quickly and the first response arrives after the second
- **THEN** the window shows the data of the second zoom

### Requirement: Loading and error state
A window SHALL show per signal while its data is loading and when it failed, including the error message on failure; a complete load shows nothing (D-030 „the "complete" can go"). When a signal's load fails, the window SHALL keep drawing what it showed for that signal at that moment (its previous data or its placeholder) instead of clearing the curve. Its legend status SHALL read `failed` as a pill (the status column has one width) whose tooltip is `failed: <message>`, also while a retry of the same view loads, until a load of the signal completes. The kept data SHALL be treated like data still loading: the live cursor and dragged cursor lines read their values from it, and the SNA share and the resolution badge describe it. Committed cursor readouts SHALL keep coming from `/api/value` with their own loading and failed state. Origin: concept §10 („Fehler … müssen erkennbar bleiben"); D-042 (2) („on a failed load the window keeps the last drawn data (or the overview placeholder) with the failure marker instead of an empty plot"). The readout behaviour is a necessary consequence of D-031 (readouts from the server) and D-034 (the live cursor reads the drawn curve).

#### Scenario: Query fails
- **WHEN** the query for one signal fails
- **THEN** the window marks that signal as failed and keeps showing the other signals
- **Evidence:** `apps/web/test/loader.test.ts` › "marks a failed signal and leaves the others alone" (existing, stays green)

#### Scenario: Failure keeps the drawn curve
- **WHEN** a signal's view A is complete, the loader gets view B, and B's fetch fails
- **THEN** the state is `error` with B's request, the error message, and A's result as `result`
- **Evidence:** `apps/web/test/loader.test.ts` › "keeps the shown result when a load fails"

#### Scenario: Failure keeps the placeholder
- **WHEN** a signal shows a placeholder for view B (overview loaded) and B's fetch fails
- **THEN** the state is `error` with the placeholder as `result` and `placeholder: true`
- **Evidence:** `apps/web/test/loader.test.ts` › "keeps the placeholder when a load fails"

#### Scenario: Legend text
- **WHEN** a signal's state is `error` with message M, or `loading` while a retry carries the last error M, or plain `loading`, or `complete`
- **THEN** its status text (`loadStatusText`, the pill's tooltip while failed) is `failed: M`, `failed: M`, `loading` and empty, in that order; the legend pill itself reads `failed` for the first two
- **Evidence:** `apps/web/test/loader.test.ts` › "names the legend status, failed while a retry loads"; the pill: `FAILED_PILL` in `apps/web/src/chart/TimeseriesWindow.tsx` (declutter-workspace DW12, commit 2af9df9)

#### Scenario: Tunnel drop on real data
- **WHEN** the UI shows a window with real data, the carserver tunnel is dropped, the window's view is changed to a range not loaded before, and the tunnel is restored
- **THEN** while it is down the window keeps a curve and its legend status pill reads `failed` with the tooltip `failed: source_error …`; within 35 s of the tunnel coming back the curve for the new range is drawn and the legend status is empty, without any user action
- **Evidence:** lead's manual check (design R8), screenshots before and after

### Requirement: Time axis precision
The time axis SHALL display local time and SHALL be able to label ticks down to the precision of the data, including sub-millisecond steps.

#### Scenario: Microsecond zoom
- **WHEN** the visible range is 100 µs wide
- **THEN** tick labels distinguish microseconds

### Requirement: SNA never drawn as a value
The window SHALL NOT draw an SNA point or an all-SNA bucket as a value: no line, step, marker or envelope reaches it, and no segment is interpolated or connected through it. In step mode the last valid value SHALL be held up to the timestamp of the following SNA point and end there. Origin: D-010.

#### Scenario: Speed SNA in raw view
- **WHEN** a window shows `ICL_3A2h.SPEED_DISP` from 2026-10-13T09:56:59Z to 09:57:01Z in line mode
- **THEN** the curve is a flat line at 0 that stops at 09:56:59.737 and resumes at 09:57:00.138; nothing is drawn at 511
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "keeps SNA as null and never spans it"

#### Scenario: Step mode holds until SNA
- **WHEN** step mode is selected and a valid point at t1 is followed by an SNA point at t2
- **THEN** the value of t1 is held until t2 and nothing is drawn from t2 until the next valid point
- **Evidence:** `apps/web/test/build.test.ts` › "holds the last valid value up to the SNA point in step mode"; UI check with `BRK_1A0h.WSPD_FL` in the same window in step mode

#### Scenario: Markers mode
- **WHEN** markers mode is selected on the window above
- **THEN** no marker appears for the three SNA points
- **Evidence:** UI check (screenshot)

#### Scenario: Aggregated overview
- **WHEN** a window shows the full extent of `ICL_3A2h.SPEED_DISP` (2026-10-11T12:34:24.824Z to 2026-10-13T13:17:33.220Z) aggregated, with the min/max envelope on
- **THEN** neither the mean curve nor the envelope reaches 511; the highest drawn value is 71 km/h
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "breaks mean and envelope at all-SNA buckets"

#### Scenario: Several signals in one window
- **WHEN** `ICL_3A2h.SPEED_DISP` and `BRK_1A0h.WSPD_FL` share the window from 2026-10-13T09:56:59Z to 09:57:01Z, so their timestamps interleave
- **THEN** neither curve is drawn across its own SNA period, and each curve still connects its consecutive valid points
- **Evidence:** `apps/web/test/build.test.ts` › "joins several signals without spanning SNA"; UI check (screenshot)

### Requirement: Isolated valid points stay visible
In line mode and in aggregated mean curves, a valid point or bucket whose neighbors on both sides are SNA, split off (data-gaps) or absent, with at least one of them SNA or split off, SHALL be drawn as a marker, so that breaking the curve never hides a valid measurement. Origin: necessary consequence of D-010's and D-062's curve breaks.

#### Scenario: One valid point between SNA points
- **WHEN** `testcar/Sna_800h.SPEED` shows point 601 (value 42) between the SNA points 600 and 602 in line mode
- **THEN** a marker is drawn at value 42
- **Evidence:** `apps/web/test/build.test.ts` › "finds isolated valid points"

#### Scenario: One valid point between two splits
- **WHEN** `gapcar/TBMS.current` (period 10 s) shows its point at 2026-10-03T00:01:40Z, 40 s after the previous and before the next point, in line mode
- **THEN** a marker is drawn at 12.5
- **Evidence:** `apps/web/test/build.test.ts` › "draws a point between two splits as a marker"

### Requirement: y range excludes SNA
The automatic y range of a scale SHALL be computed from valid values only; SNA points and all-SNA buckets SHALL NOT widen it. Origin: proposal (window never draws SNA as a value).

#### Scenario: Speed window around SNA
- **WHEN** a window shows `ICL_3A2h.SPEED_DISP` from 2026-10-13T09:56:59Z to 09:57:01Z
- **THEN** the y axis covers the flat 0 line (about −1 to 1) and does not extend to 511
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "ignores SNA in the y range"

### Requirement: SNA periods marked
The window SHALL mark each signal's SNA periods as a thin strip per signal at the bottom of the plot, in the signal's color, so the user sees which signal is unavailable when. Raw: from an SNA point to the next point, or to its hold end where the next point is split off (data-gaps). Aggregated: each bucket that contains at least one SNA point. A period too short to see SHALL still be visible. Origin: D-010, D-014; hold end: D-062.

#### Scenario: Two signals with SNA at engine start
- **WHEN** a window shows `ICL_3A2h.SPEED_DISP` and `BRK_1A0h.WSPD_FL` from 2026-10-13T09:56:59Z to 09:57:01Z
- **THEN** a mark in the SPEED_DISP color covers 09:56:59.837 to 09:57:00.138 and a mark in the WSPD_FL color covers 09:56:59.791 to 09:57:00.072
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "derives SNA periods from raw points and neighbors"

#### Scenario: SNA in the overview
- **WHEN** a window shows the full extent of `ICL_3A2h.SPEED_DISP` aggregated
- **THEN** SNA is marked from 2026-10-11 13:41 to 2026-10-13 09:07 UTC wherever the signal has points, and at the other three SNA runs
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "derives SNA periods from buckets"

#### Scenario: Single SNA point at the end of the data
- **WHEN** the last point of `testcar/Sna_800h.SPEED` (point 999) is SNA and has no successor
- **THEN** its mark is still visible, at least 2 px wide
- **Evidence:** `apps/web/test/build.test.ts` › "derives SNA periods from raw points and neighbors"

#### Scenario: SNA point before a split
- **WHEN** a signal with period 20 ms has an SNA point at 0 ms and its next point at 1 s
- **THEN** its SNA mark covers 0 to 20 ms, not up to 1 s
- **Evidence:** `apps/web/test/build.test.ts` › "ends an SNA mark at the hold end"

### Requirement: SNA share in the signal list
The window's signal list SHALL show per signal the share of SNA points among all points of the loaded range, edge neighbors excluded. A non-zero share SHALL never be displayed as 0 %, and a share below 100 % never as 100 %. No share is shown when it is 0 or nothing is loaded. Origin: D-010 ("show its share"); proposal.

#### Scenario: Engine start window
- **WHEN** a window shows `ICL_3A2h.SPEED_DISP` and `BRK_1A0h.WSPD_FL` from 2026-10-13T09:56:59Z to 09:57:01Z
- **THEN** the list shows `SNA 15.0 %` for SPEED_DISP (3 of 20) and `SNA 23.0 %` for WSPD_FL (14 of 61)
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "computes the SNA share of raw and bucket results"

#### Scenario: Rare SNA
- **WHEN** a window shows the full extent of `BRK_1A0h.WSPD_FL` (56 SNA of 232,644 points)
- **THEN** the list shows `SNA < 0.1 %`
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "formats SNA shares without rounding to 0 or 100"

#### Scenario: Valid constant, no SNA
- **WHEN** a window shows `ENG_2E8h.MOT_SPD_D` (constant −127, which is raw 0 and valid; D-012)
- **THEN** the curve is drawn at −127 and the list shows no SNA share
- **Evidence:** UI check (screenshot)

### Requirement: Linked time zoom
While the time axes are linked, wheel zoom, wheel pan, rectangle zoom, double-click reset, history back, "Reset", navigation keys, "Go to" and span presets in or for any window SHALL change the time range of all windows. During a wheel, pan or key gesture in one window, every linked window SHALL show and load the previewed range in the same frame, each at its own resolution; the range command SHALL still be sent once, by the gesture's window. While unlinked, each window SHALL keep its own range. Origin: D-017; D-027; D-041 („every linked window shows the preview range and loads during the gesture like the zoomed one").

#### Scenario: Zoom one of two linked windows
- **WHEN** "Link time axes" is on, window 1 shows `ICL_3A2h.SPEED_DISP`, window 2 shows `DCU_2B8h.HTR_HV_Volt`, and the user Ctrl+wheel-zooms in window 1
- **THEN** within 1 s window 2's header shows the same range as window 1 and its curve is reloaded for it
- **Evidence:** UI check (screenshot of both headers); `packages/shared/test/apply.test.ts` › "applies a range to all windows while linked"

#### Scenario: Linked windows follow the gesture
- **WHEN** the two linked windows have rested 2 s on one hour and one Ctrl+wheel event arrives over window 1 (design T1 of change `improve-zoom-speed`)
- **THEN** window 2 draws the new range in its first stroke burst within 50 ms of the wheel event: from the cache with no further burst when its tiles are cached (zoom out, steps 3–4), as a placeholder followed by its sharp data within 200 ms when they are not (zoom in, step 2); one `window.setRange` command is sent, about 300 ms after the event
- **Evidence:** UI timing check (design T1, per-window `bursts` and per-signal `series`); `apps/web/test/linkedPreview.test.ts` › "shows the own preview, else the linked shared one, else the server range" and "publishes synchronously and clears only for the current source"

#### Scenario: Zoom one of two unlinked windows
- **WHEN** the user switches "Link time axes" off and zooms window 1
- **THEN** window 2 keeps its time range, also during the gesture
- **Evidence:** UI check (screenshot); `packages/shared/test/apply.test.ts` › "applies a range to one window while unlinked"; `apps/web/test/linkedPreview.test.ts` › "shows the own preview, else the linked shared one, else the server range"

### Requirement: Link toggle
The option bar SHALL show "Link time axes" as a 26 × 26 px icon toggle (a link icon, `aria-label` `Link time axes`, `aria-pressed` the workspace's link flag, the pressed style of design-language "Cursor toggles as pills" while on) directly after "Reset", with a tooltip saying whether it is on; it SHALL reflect and set the workspace's link flag, on by default, and the top bar SHALL no longer show it. Switching it on SHALL show all windows at the range of the window zoomed last. Origin: D-017 ("on by default and can be switched off"); D-023 (the toggle moves out of the top bar into the option bar); icon next to the range control: D-092 (mock `Main.dc.html`, the designer's top-row inventory).

#### Scenario: Default on
- **WHEN** the app is opened after a server restart
- **THEN** the "Link time axes" toggle has `aria-pressed="true"` in the option bar, shows no text, and the top bar shows no such toggle
- **Evidence:** Jan's hand check after a server restart (screenshot of the option bar); `packages/shared/test/apply.test.ts` › "applies a range to all windows while linked" (asserts `linkTime` is `true` on a fresh workspace)

#### Scenario: Re-link
- **WHEN** both windows show different ranges, window 2 was zoomed last, and the user clicks "Link time axes" so that it is pressed
- **THEN** both windows show window 2's range
- **Evidence:** UI check (screenshot); `packages/shared/test/apply.test.ts` › "snaps all windows to the last zoomed window when linking"

### Requirement: Drag signals between windows
A signal's legend row SHALL be draggable onto another window: a plain drop moves the signal, a drop with Alt or Ctrl held copies it, each as one `window.moveSignal` command. The signal SHALL keep its colour and take the target window's display mode (mode is a window option). A window emptied by the move SHALL disappear (workspace-state "Window emptied by a move is removed"). Origin: D-017; Alt/Ctrl copy: feedback 2026-10-14, point 1; D-027 (emptied window removed).

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

### Requirement: One y-axis per unit
Signals with the same unit SHALL share one y scale and axis; each unit SHALL have its own. A signal without unit SHALL have its own scale, titled with its name. The axis title SHALL be the unit in slate-700 (`#334155`), preceded by an 8 × 2 px swatch in the signal's colour when it is the only signal on that axis. Origin: D-018 ("'Same value range' means **same unit**: one y-axis per unit, nothing more."); D-017 („gleiche signalbereich gleiche achse“); the series' colour on the axis: power-user expectations (feedback 2026-10-14, point 2); swatch instead of coloured text: D-095 (critic 11: tick labels in series colours fail contrast, `#E69F00` 2.2:1).

#### Scenario: Two signals, same unit
- **WHEN** a window on smart451 shows `CPC_168h.EAC_HV_Volt` and `CPC_448h.PTC_HV_Volt` (both `V`)
- **THEN** one axis is drawn on the left titled `V` in `rgb(51, 65, 85)` with no swatch, and the `[V]` of both legend rows has the tooltip `[V] · y axis L`
- **Evidence:** UI check (screenshot, the title's computed colour); `apps/web/test/axes.test.ts` › "puts signals with the same unit on one axis"

### Requirement: Stacked axes
Every unit SHALL get a drawn y axis, stacked up to two per side in signal order: first unit inner left (`L`), second inner right (`R`), third outer left (`L2`), fourth outer right (`R2`); the plot narrows. Each legend row's `[unit]` SHALL name its axis side as tooltip (D-030: the side column is gone). Origin: D-019 ("stacked axes, up to two per side (at most four units), the plot area gets narrower. Every value stays readable."); legend sides from feedback 2026-10-14, point 2.

#### Scenario: Second unit
- **WHEN** `COMBI_412h.V_ANZ` (`km/h`) is added to that window
- **THEN** a right axis titled `km/h` appears with a swatch in V_ANZ's colour, V_ANZ's `[km/h]` has the tooltip `[km/h] · y axis R`, and the `V` axis stays left
- **Evidence:** UI check (screenshot); `apps/web/test/axes.test.ts` › "stacks axes L, R, L2, R2 in signal order", "colours an axis like its only signal"

#### Scenario: Third and fourth unit
- **WHEN** `COMBI_408h.T_AUSSEN` (`°C`) and then `BS_200h.DVL` (`1/min`) are added as well
- **THEN** a `°C` axis appears outer left and a `1/min` axis outer right, each with its signal's swatch and readable tick labels, the plot is narrower, and their `[unit]` tooltips name `L2` and `R2`
- **Evidence:** UI check (screenshot); `apps/web/test/axes.test.ts` › "stacks axes L, R, L2, R2 in signal order"

#### Scenario: Unit-less signal and stable sides
- **WHEN** a window lists a signal without unit before a `V` signal, and only the `V` signal's data has loaded
- **THEN** the unit-less signal has its own scale titled with its name on the left and `V` is on the right, before and after the other data arrives
- **Evidence:** `apps/web/test/axes.test.ts` › "gives unit-less signals their own axis titled by name", "keeps sides stable before data loads"

### Requirement: Readable axis titles
Axis titles SHALL be horizontal text on their own line above their axis, showing the unit exactly as in the signal metadata, preceded by the axis' SI prefix when its ticks are scaled ("Axis tick numbers"), at least 8 px clear of the top tick label; tick labels and tick marks SHALL be slate-700 (`#334155`) on every axis, never the series colour, and SHALL NOT be cut. Origin: bug "°C garbled in the rotated axis title" (feedback 2026-10-14); prefix: D-026; dark ticks, own line, 8 px: D-095 (critic 11: coloured ticks fail contrast, unit labels overlapped the top tick).

#### Scenario: Degree sign
- **WHEN** a window on smart451 shows only `COMBI_408h.T_AUSSEN`
- **THEN** the left axis title reads `°C` with T_AUSSEN's swatch, and the tick labels are fully visible
- **Evidence:** UI check (zoomed screenshot of the axis)

#### Scenario: Axis colours on smart451
- **WHEN** at 1440×900 a window shows `COMBI_412h.V_ANZ` and `CPC_168h.EAC_HV_Volt` (two units, two axes)
- **THEN** each axis title row element has the colour `rgb(51, 65, 85)` and holds one swatch whose background is its signal's colour; the plot's top minus the title row's bottom is at least 8 px (`getBoundingClientRect()`); the canvas' tick labels are dark slate in a zoomed screenshot, not the series colours; the window's plot top minus its top stays ≤ 48 px (goal of `workspace-layout` "Header height")
- **Evidence:** UI check on smart451 at 1440×900 (computed colours, rects, zoomed screenshot); `apps/web/test/axes.test.ts` › "colours an axis like its only signal" (the swatch colour)

### Requirement: Stable colours in windows
Each signal SHALL be drawn, listed and SNA-marked in its workspace colour, the same in every window. Origin: D-018 ("stable signal colours across windows").

#### Scenario: First signals of two windows
- **WHEN** window 1 shows `ICL_3A2h.SPEED_DISP` first and window 2 shows `DCU_2B8h.HTR_HV_Volt` first, and SPEED_DISP is also copied into window 2
- **THEN** the two first signals have different colours, and SPEED_DISP has the same colour in both windows
- **Evidence:** UI check (screenshot); `packages/shared/test/apply.test.ts` › "assigns stable colours across windows"

### Requirement: Window names
A window SHALL be named by its title or, untitled, "Window <n>" everywhere it is named, including the explorer's "Add to" list. Origin: D-018 ("window rename"); bug "'Add to' lists raw IDs" (feedback 2026-10-14).

#### Scenario: New window from the explorer is untitled
- **WHEN** the user adds `ICL_3A2h.SPEED_DISP` to "New window" in the explorer and the new window gets the ID `w<n>`
- **THEN** the new window's header reads `Window <n>` (not `SPEED_DISP`), the "Add to" list shows `Window <n>`, and `curl -s localhost:7310/api/workspace | jq '.workspace.windows[-1].title'` prints `null`
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
- **WHEN** "Link time axes" is on, window 1 shows `ICL_3A2h.SPEED_DISP` only (one axis, `L`) and window 2 shows `DCU_2B8h.HTR_HV_Volt`, `ICL_3A2h.SPEED_DISP` and `ENG_5E0h.T_ENG` (axes `L`, `R`, `L2`)
- **THEN** the left and right edges of both plot areas are at the same x (within 1 px), and the crosshair over a timestamp in window 1 and the same timestamp's tick in window 2 are vertically aligned
- **Evidence:** UI check (one screenshot of both windows with a vertical guide or measured plot edges); `apps/web/test/insets.test.ts` › "takes the largest axis width per side across windows"

### Requirement: Crosshair follows the pointer only
The plot crosshair SHALL be hidden when the pointer leaves the plot and right after every change of the window's shown range, whatever caused it (wheel zoom, wheel pan, drag-select, double-click reset, navigation keys, "Go to", presets, "Back", "Reset", a linked window or the CLI), until the pointer moves over the plot again. Origin: lead decision (rounds.md round 5 of `improve-window-workflow`): a crosshair left at its old pixel points at a wrong time; D-027 (keys and typed ranges).

#### Scenario: Leave and zoom
- **WHEN** the pointer hovers a SPEED_DISP plot (crosshair visible), then leaves the plot; then the user returns, Ctrl+wheel-zooms once without moving, and later drag-selects a range and double-clicks the plot
- **THEN** the crosshair is gone after leaving, and after each of the wheel zoom, the drag-select and the double-click reset until the pointer moves
- **Evidence:** UI check (screenshots after leaving and after each zoom commit)

#### Scenario: Pan and Zoom out
- **WHEN** the pointer hovers a SPEED_DISP plot (crosshair visible), the user presses `→` without moving, then moves, then presses `-`
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

### Requirement: Resizable window height
The user SHALL be able to change a timeseries window's plot height by dragging either its corner grip ("Corner grip") or the strip below the plot, between 120 and 1200 px; the height SHALL be kept in the workspace. While dragging, only the dragging browser's plot SHALL follow the pointer; on release exactly one `window.setHeight` command SHALL be sent, and none when the released height equals the stored one. Origin: D-018 ("resizable window heights"); D-037 item (1) for the grip; the strip stays per design G1 (Q1).

#### Scenario: Taller window
- **WHEN** the user drags the strip below a window's plot about 200 px down and reloads the browser
- **THEN** the plot is about 480 px tall before and after the reload
- **Evidence:** UI check on smart451 at 1440×900 (screenshots before and after reload); `packages/shared/test/apply.test.ts` › "sets window height within bounds"

#### Scenario: Bounds
- **WHEN** a dragged height would be 50 px or 5000 px
- **THEN** the plot height is 120 px or 1200 px, and the command sent on release carries that clamped height
- **Evidence:** `apps/web/test/height.test.ts` › "clamps a dragged height to 120-1200 px"

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
- **WHEN** a window shows only `ICL_3A2h.SPEED_DISP` zoomed to 2026-10-13T09:56:59Z–09:57:01Z and the user double-clicks the plot
- **THEN** the range becomes 2026-10-11T12:34:24.824Z to 2026-10-13T13:17:33.221Z (header in local time) and the view is aggregated
- **Evidence:** UI check (screenshot of the header); `apps/web/test/zoom.test.ts` › "computes the extent range rounded up to the next millisecond"

### Requirement: Zoom history
Each committed wheel zoom, wheel pan, rectangle zoom, double-click reset, "Reset", navigation key, "Go to", span preset, time-strip action and drive key SHALL be recorded; the option bar's "Back" and the Backspace key SHALL return to the previous range, up to 50 steps. While linked, all windows SHALL share one history; while unlinked, each window has its own. "Back" SHALL be disabled when there is no previous range. Origin: D-018 ("zoom history back"); D-025 (one "Back", in the bar); D-027 (new navigation undone alike); D-057 (strip actions as "Go to"; a double-click on the strip replaces its first click's entry, `time-strip` "Double-click shows the whole recording").

#### Scenario: Two steps back
- **WHEN** the user zooms a SPEED_DISP window from its full extent into the morning of 2026-10-13, then into 09:56–09:58, then presses Backspace twice with the pointer over the window
- **THEN** the window shows the morning range, then the full extent, and the bar's "Back" is disabled
- **Evidence:** UI check (screenshots of the header after each step); `apps/web/test/zoom.test.ts` › "keeps a bounded zoom history", "shares one history while linked"

#### Scenario: Strip steps back
- **WHEN** a smart451 window at its full extent gets a strip drag over one local day, then a click on a drive segment, then Backspace twice with the pointer over the window
- **THEN** the window shows the dragged day, then the full extent; if the browser tool cannot drag, the drag is replaced by `.` (a drive key) and the check runs the same way
- **Evidence:** UI check on smart451 at 1440×900 (header after each step)

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
- **WHEN** a window shows `DCU_2B8h.HTR_HV_Volt` and the user presses `-` 40 times with the pointer over it
- **THEN** the header range never shows a year before 1900 or after 2262, no command is rejected, and the signal is still drawn (as an aggregated point or short curve)
- **Evidence:** UI check (screenshot of the header and the message area); `apps/web/test/zoom.test.ts` › "clamps ranges into the time bounds"

### Requirement: Valid constants at raw 0 are drawn
A stored value that is not an SNA code of its signal SHALL be drawn as a value even when it is constant and equals the physical value of raw 0. Origin: D-019 ("T_SET's raw 0 (−40 °C, all data on smart451) is shown as a valid value; the DBC rules (D-010, D-014, D-015) apply unchanged, no per-signal exceptions."); data facts in design "Bug analysis". `ENG_2E8h.MOT_SPD_D` (−127, D-012) is covered by the existing scenario "Valid constant, no SNA" under "SNA share in the signal list".

#### Scenario: T_SET
- **WHEN** a window shows the full extent of `CLIM_A1.T_SET`
- **THEN** the curve is a flat line at −40 °C and the legend shows no SNA share
- **Evidence:** UI check (screenshot)

### Requirement: Refused drop targets
During a drag, the legend row's own window and any window already showing the signal SHALL be refused without a highlight. A timeseries window that would reach a fifth unit SHALL be marked not droppable with the hint "At most 4 units per window", whatever the drag source, except for a drag of an explorer selection of two or more signals, which overflows instead ("Selection overflows into new windows"). A values window SHALL never be refused for units. Origin: D-019 (four units), D-020 (refusal for explorer drags), D-023 (values rows as source; no unit limit in the values window); selection exception: D-066.

#### Scenario: Values row over a four-unit window
- **WHEN** window A shows four units (V, km/h, °C, 1/min) and the user drags the `ENG_2E8h.MOT_SPD_D` row of a values window over A and releases
- **THEN** A is marked not droppable with "At most 4 units per window", and the release changes nothing (revision unchanged)
- **Evidence:** `apps/web/test/drag.test.ts` › "drags a values row like a legend row"; UI check (screenshot while dragging, revision before and after)

#### Scenario: Values window takes a fifth unit
- **WHEN** a values window lists four units and the user drags the MOT_SPD_D legend row from a timeseries window over it
- **THEN** the values window is highlighted with "Drop to move · Alt/Ctrl+drop to copy"
- **Evidence:** `apps/web/test/drag.test.ts` › "accepts any unit on a values window"; UI check (screenshot while dragging)

#### Scenario: Selection over a four-unit window
- **WHEN** window A shows four units (V, km/h, °C, 1/min) and the user drags an explorer selection of `ENG_2E8h.MOT_SPD_D` and `STR_0D4h.STEER_SPEED` over A and releases
- **THEN** A is highlighted with "Drop to add" while dragging; after the release A is unchanged and one new window shows MOT_SPD_D and STEER_SPEED
- **Evidence:** `apps/web/test/drag.test.ts` › "highlights a window for a selection while one signal is new"; `packages/shared/test/placement.test.ts` › "counts the units the target already shows"

### Requirement: New-window drop zone stays visible
During every drag, the "+ New window" drop zone SHALL be visible at the bottom of the viewport over the window list, wherever the list is scrolled. It SHALL NOT be shown outside a drag. Origin: D-023 („"+ New window" stays visible during a drag").

#### Scenario: Many windows, scrolled to the top
- **WHEN** six timeseries windows fill more than the viewport, the list is scrolled to the top, and the user drags the `BRK_1A0h.WSPD_FL` explorer row
- **THEN** "+ New window" is visible at the bottom of the viewport without scrolling, and dropping on it creates a new window with WSPD_FL
- **Evidence:** UI check (screenshot while dragging, screenshot after the drop)

### Requirement: Auto-scroll while dragging
While dragging, the window list SHALL scroll when the pointer is within 48 px of its visible top edge (below the option bar) or bottom edge (above the drop zone), faster the deeper, up to 24 px per frame, and stop at the list's ends. Pointing at the drop zone itself SHALL NOT scroll. The wheel SHALL scroll the list during a drag instead of zooming. Origin: D-023 („the page scrolls when the pointer nears its edge").

#### Scenario: Reach the last window
- **WHEN** six windows exist, the list is scrolled to the top, and the user drags the SPEED_DISP legend row of window 1 into the band just above "+ New window"
- **THEN** the list scrolls down until window 6 is visible and stops at the end; dropping on window 6 moves SPEED_DISP there
- **Evidence:** UI check (screenshots while scrolling and after the drop)

#### Scenario: Hold over the drop zone
- **WHEN** the pointer rests on "+ New window" during a drag, with the list scrolled to the top
- **THEN** the list does not scroll
- **Evidence:** UI check (two screenshots 2 s apart show the same first window)

### Requirement: Option bar
Above the windows, an option bar SHALL stay visible while the window list scrolls. After the sidebar button it SHALL hold, in this order: "Views" (with the open view's title and the Read-only pill, `saved-views`); a separator; the range control (time-navigation; its content is owned by `add-range-picker`); "Back" and "Reset" as 26 × 26 px icon buttons (`aria-label` `Back` and `Reset`; Reset's tooltip names `Home`, Back's names `Backspace` while there is an earlier range and otherwise reads `Back: no earlier time range yet`); the "Link time axes" icon toggle ("Link toggle"); a separator; the cursor pills "A", "B" and "Diff" (cursors spec); then, at the row's end and at every width, "Share…", the "⋯" menu and "?" (`guidance` "Help panel"). The Digits control (number-format "Digits option", a segmented control `3 | 4`) and "+ Values window" SHALL always be items of the "⋯" menu, never in the row (`saved-views` "Top-row overflow menu"). Origin: D-023 (cursor toggles, diff mode, "Link time axes", zoom back and reset in a bar); D-025 (one "Back", one "Reset"); D-027 (time navigation); D-026 (digits option); order, icons and the "⋯" items: D-092 (7) (supersedes D-071's width rule for Digits and "+ Values window") and mock `Main.dc.html`; Share in the row at every width: D-095 (critic 15, supersedes the compact-width move of D-092's mock); Digits as a segmented control: D-112 (1).

#### Scenario: Scrolled down
- **WHEN** six windows exist and the list is scrolled to the end
- **THEN** the option bar is fully visible above the windows with its controls in that order
- **Evidence:** UI check (screenshot)

#### Scenario: Order in the row
- **WHEN** the option bar is rendered to static markup for a workspace with a timeseries window, its overflow menu closed
- **THEN** the controls appear in the order `Views`, the `range-control` element, `Back`, `Reset`, `Link time axes`, `A`, `B`, `Diff`, `Share…`, `More`; `Back` and `Reset` hold no visible text; no element with `aria-label="Digits"`, no `<select` and no `+ Values` button is in the row
- **Evidence:** `apps/web/test/bar.test.ts` › "renders the top row in order"

### Requirement: Bar zoom back and reset
The bar's "Back" SHALL step back the zoom history of its target window, and "Reset" SHALL set the target's range to the union of its signals' extents. They are the only Back and Reset controls (D-025). While linked, "Reset" SHALL use the signals of all timeseries windows. "Back" SHALL be disabled when the target has no history. Origin: D-023 (zoom back / reset zoom in the bar); D-025 („one "Back" and one "Reset"").

#### Scenario: Linked reset
- **WHEN** "Link time axes" is on, window 1 shows `ICL_3A2h.SPEED_DISP`, window 2 shows `DCU_2B8h.HTR_HV_Volt`, both at 2026-10-13T13:08:00Z–13:08:03Z, and the user clicks "Reset"
- **THEN** both windows show the union of both signals' extents (earliest first point to just after the latest last point), and "Back" returns both to 13:08:00Z–13:08:03Z
- **Evidence:** `apps/web/test/bar.test.ts` › "resets to the union of all timeseries extents while linked"; UI check (screenshots of both headers)

### Requirement: Bar target
The target of the bar's "Back" and "Reset" SHALL be the window zoomed last, else the first timeseries window. While unlinked, both tooltips SHALL name the target. Origin: D-024 (target while unlinked); D-029 (bar target).

#### Scenario: Unlinked back
- **WHEN** "Link time axes" is off, window 1 was zoomed once and then window 2 zoomed once, and the user clicks the bar's "Back"
- **THEN** the tooltip reads `Back: the previous time range of Window 2 · Backspace`, window 2 shows its previous range, and window 1 is unchanged
- **Evidence:** `apps/web/test/bar.test.ts` › "targets the window zoomed last, else the first timeseries window"; `apps/web/test/hints.test.ts` (tooltips name the window); UI check (headers before and after)

### Requirement: Drop lands under the pointer
A drop SHALL go to the target under the pointer at release, never to a target the pointer left earlier. The drop zone's space SHALL stay reserved below the last window whether or not a drag runs, so nothing moves when a drag starts and the "+ New window" zone never covers a window. Origin: power-user bug (feedback 2026-10-15, item 1: three stray windows); necessary consequence of "New-window drop zone stays visible".

#### Scenario: Values window at the bottom
- **WHEN** a values window is the last window, the list is scrolled to the end, and the user drags the `ICL_3A2h.SPEED_DISP` explorer row onto the lower part of the values window and releases
- **THEN** the values window lists SPEED_DISP, no new window appears, and while dragging the "+ New window" zone sits below the values window without covering it
- **Evidence:** UI check (screenshot while dragging, screenshot and revision after the drop)

### Requirement: Header shows the plotted range
The range text a window shows (while unlinked its own range in the header, "Own range of an unlinked window"; while linked the range button, workspace-layout "Linked windows show the range once") SHALL always equal the range the plot shows, also during a zoom or pan preview before the server accepted it. Origin: power-user bug (feedback 2026-10-15, item 2: the header lagged one zoom step behind the axis); text since D-092 (1), D-093.

#### Scenario: Three quick wheel zooms
- **WHEN** a window shows 2026-10-13T13:08:00Z–13:08:03Z and the user wheel-zooms three times in quick succession
- **THEN** after each step, and during the preview, the range text's start and duration match the first and last time of the axis; no screenshot shows the range of the step before
- **Evidence:** UI check (screenshots after each step); `apps/web/test/zoom.test.ts` › "shows the preview range in the header"

### Requirement: New windows scroll into view
A window this browser tab creates SHALL be scrolled fully into view: below the top row and above the status strip, or with its header right below the top row when it is taller than that area. The windows that SHALL be revealed this way are those created by "+ Values window", by an explorer add (`+`, Enter, a selection), by a drop on "+ New window" or on the free area below the windows (workspace-layout "Drop below the windows"), and by a values row moved into a new window. Of several created windows the first SHALL be scrolled to. Each created window SHALL flash once for `FLASH_MS` (1,200 ms; design-language "Flash look"). An explorer add into an existing window (the marked one) SHALL reveal and flash that window the same way. Drops onto an existing window and windows created by the CLI SHALL neither scroll nor flash. Origin: power-user bug (feedback 2026-10-15, item 4: the new window was appended out of sight); D-037 item (2) for the free area; persona test 2026-10-17 finding 3 (novice and boss could not find the new window); Jan 2026-10-17 („highlighted"); defaults S2 (design.md).

#### Scenario: Values window below the fold
- **WHEN** six windows fill more than the viewport, the list is scrolled to the top, and the user clicks "+ Values window", later drops a legend row on "+ New window"
- **THEN** each new window is fully visible right after it appears, without manual scrolling, and flashes
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each creation)

#### Scenario: Drop below a short list
- **WHEN** at 1440×900 two windows share the first row and the user drops the `BRK_1A0h.WSPD_FL` explorer row on the free area below them
- **THEN** the new window is fully visible right after it appears, without manual scrolling
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the drop)

#### Scenario: Explorer add among seventeen windows
- **WHEN** seventeen windows exist (created with `kipscope window create` and `kipscope signal add`), the list is scrolled to the top, no window is marked, and the user types `SPEED_DISP` and presses Enter
- **THEN** within one second the new window is fully visible between the top row and the status strip and carries `data-flash`; 1.5 s later it no longer carries it
- **Evidence:** UI check on smart451 at 1440×900 (screenshot within 1 s, the attribute read twice)

#### Scenario: Add into a marked window out of sight
- **WHEN** of seventeen windows window 1 is marked, the list is scrolled to the end, and the user adds `ENG_5E0h.T_ENG` with the row's add button
- **THEN** window 1 is scrolled fully into view (its header right below the top row if taller), shows T_ENG and flashes; no new window is created
- **Evidence:** UI check on smart451 at 1440×900 (screenshot within 1 s)

#### Scenario: Selection creates two windows
- **WHEN** the user selects six signals of six units and presses Enter with "New window" as target
- **THEN** the first of the two new windows is scrolled into view and both carry `data-flash` right after the add
- **Evidence:** UI check on smart451 (the attribute on both, screenshot)

#### Scenario: Scroll delta
- **WHEN** `revealDelta` gets a window fully inside the view, one below it, one above it, and one taller than the view, each with view `{top: 100, bottom: 700}`
- **THEN** it returns 0, `bottom − 700`, `top − 100`, and `top − 100`
- **Evidence:** `apps/web/test/reveal.test.ts` › "scrolls a window fully into view below the top row"

#### Scenario: Drop on an existing window
- **WHEN** the user drops an explorer row onto a visible, unmarked window
- **THEN** the list does not scroll and the window carries no `data-flash`
- **Evidence:** UI check on smart451 (scroll position before and after, the attribute)

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
- **WHEN** a window shows `DCU_2B8h.HTR_HV_Volt` from 2026-10-13T13:08:00Z to 13:08:03Z
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
The grip SHALL be a curved mark following the window's rounded corner, in a muted colour that turns to the accent colour while hovered or dragged, with the tooltip "Drag to resize the height" and a vertical resize pointer. It SHALL NOT cover legend text, a value or a control. Origin: D-037 item (1) („apple like curved handle"); vertical pointer because only the height changes (design G2, Q2); no overlap as a necessary consequence of a readable legend.

#### Scenario: Look and pointer
- **WHEN** at 1440×900 the pointer rests on the option bar, then moves onto a window's grip
- **THEN** the grip is a curved mark in the muted colour at rest and in the accent colour under the pointer, the tooltip reads "Drag to resize the height", and the pointer is a vertical resize pointer (`getComputedStyle(grip).cursor` is `ns-resize`)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot of the corner at rest and hovered, computed cursor)

#### Scenario: Grip covers nothing
- **WHEN** at 1440×900 a timeseries window in the right grid column shows four signals with cursors A and B on and Diff on, so its legend rows are full
- **THEN** no legend text or value overlaps the grip's hit box (rects of the grip and the last legend row's cells do not intersect)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot of the corner, rects)

### Requirement: A window that fails to draw is contained
When drawing one window throws, only that window SHALL be replaced by a box reading `Window failed to draw: <message>` with a Retry button that draws it again; the other windows, the sidebar and the option bar SHALL keep working. The failed window SHALL report a render error for the current revision, so `--wait` ends with status `error`. Origin: concept §10 („Fehler … müssen erkennbar bleiben"); concept §7 (wait). Design H6.

#### Scenario: Boundary catches and reports
- **WHEN** the window boundary of window `w2` at revision 9 catches an error `boom`
- **THEN** its state holds the message `boom`, and `onReady` was called with `w2`, 9 and one error for `w2` whose message contains `boom`
- **Evidence:** `apps/web/test/boundary.test.ts` › "catches a window's error and reports it as rendered with an error"

#### Scenario: Every window is wrapped
- **WHEN** `grep -n "<WindowBoundary" apps/web/src/App.tsx` runs
- **THEN** it prints the line that wraps each window of the window list
- **Evidence:** command output

### Requirement: Height drag always ends
A height drag SHALL end, restoring text selection and the live cursor, when the pointer is released, the gesture is cancelled, the pointer capture is lost, or the window unmounts. Unmounting SHALL send no `window.setHeight`. Origin: necessary consequence of "Resizable window height" and "No text selection while dragging": a leaked drag left selection off and the live cursor suspended for the whole tab. Design H8.

#### Scenario: Lost capture and unmount
- **WHEN** a height drag is tracked on a handle and the handle fires `lostpointercapture`; a second drag fires `pointerup` and then `lostpointercapture` (as browsers do); and a third drag is disposed (unmount) before any pointer event
- **THEN** the end callback runs once each for the first and second drag, the release callback runs once for each drag, the third never calls end, and later `pointermove` events change nothing
- **Evidence:** `apps/web/test/height.test.ts` › "ends a height drag on lost capture and on unmount"

### Requirement: Dropped files are ignored
A file dragged from the desktop and dropped anywhere on the page SHALL be ignored: the tab SHALL stay on KIPscope, and the pointer SHALL show that no drop is possible. Origin: necessary consequence: today a dropped file navigates the tab away and loses the zoom history and cursors of the session. Design H8.

#### Scenario: File drag on the document
- **WHEN** a cancelable `dragover` and a cancelable `drop` whose data types include `Files` are dispatched on the document target the guard is installed on
- **THEN** both are default-prevented and `dropEffect` is `none`; after the guard is removed, they are not
- **Evidence:** `apps/web/test/filedrop.test.ts` › "prevents file drops on the page"

### Requirement: Unrelated revisions do not reload
A window SHALL hand its requests to the loader again only when a signal assignment, the view, the target or the plot width changes, or when a `window.setRange` command arrives (also one that leaves the range unchanged); other revisions SHALL NOT retry a failed signal. Origin: D-042 (1) („setting the same range again also retries"); D-044 („4xx only when the same request comes again"): an unrelated revision is not the same request coming again. Design H7.

#### Scenario: Load key
- **WHEN** the load key is computed for the same window before and after an unrelated revision (new but equal `signals` array), after a signal is added, and after the range-command count rises
- **THEN** the first two keys are equal, the others differ
- **Evidence:** `apps/web/test/loader.test.ts` › "load key ignores unrelated revisions"

#### Scenario: Range count from the live channel
- **WHEN** the live state reducer gets a state message with `command` `window.setRange`, then one with `window.rename`, then one without `command`
- **THEN** the range-command count rises by one after the first and stays after the others
- **Evidence:** `apps/web/test/livestate.test.ts` › "counts range commands from state pushes"

### Requirement: Event marks in the plot
Each timeseries window SHALL mark the shown events of its signals' data refs within its range: a 1 px line over the plot behind the curves in the category colour at half opacity (faults solid, changes dashed, others dotted) and a 6 px glyph above the plot area, grouped, coloured and filled or hollow like the strip's pins (hollow when all its events are DTCs, fault memory reads), with the pin tooltip; both SHALL follow zoom and pan. Origin: D-058 („marks … in the chart windows"); add-events design V6; hollow: data fact (DTC times are readout times), proposal E-3.

#### Scenario: Marks on smart451
- **WHEN** window 1 shows `DCU_2B8h.HTR_HV_Volt` on smart451 over 2026-10-14 18:55–19:15 local with the default filter, then the filter `none`
- **THEN** first the window shows filled glyphs and lines at the isolation changes of 18:59:47–19:08:32 (more than one glyph; the glyph at 18:59:47 lists `BMS.contactor` `closed → open`), and the plot height is the same as without events; with `none` no glyph or line remains
- **Evidence:** UI check on smart451 at 1440×900 (screenshots, plot height)

#### Scenario: Glyph groups
- **WHEN** chart glyphs are built for a plot 600 px wide over [0, 60 s) from events at 10 s, 10.5 s, 30 s and 75 s
- **THEN** two glyphs: one at x 100–105 holding 2 events, one at x 300 holding 1; none for 75 s
- **Evidence:** `apps/web/test/eventMarks.test.ts` › "groups events into chart glyphs"

#### Scenario: Hollow marks
- **WHEN** `markStyle` runs for a mark of one active DTC, a mark of two DTCs, a mark of a DTC and a state change, and a mark of one state change; and `groupMarks` builds a mark of one DTC alone
- **THEN** hollow (background `var(--panel)`, inset 1 px outline in `#be123c`), hollow, filled `#be123c`, filled `#7c3aed`; the lone DTC mark is at least 5 px wide
- **Evidence:** `apps/web/test/eventMarks.test.ts` › "draws fault memory reads hollow"

### Requirement: Event glyph click places a cursor
A click on an event glyph SHALL place cursor A at the exact time of the glyph's first event, Shift+click cursor B, with one `cursor.set` sent at once; a glyph click SHALL NOT zoom or start a drag. Origin: D-058 (brief: „click jumps/centres"; in a plot the event is already in view, and a cursor on it gives the values at that moment, `cursors` "Placing cursors by click"); design V7.

#### Scenario: Glyph click on smart451
- **WHEN** window 1 shows 2026-10-14 18:55–19:15 local on smart451 and the user clicks the glyph at 18:59:47, then Shift+clicks the glyph at 19:01:47
- **THEN** A is at 2026-10-14 18:59:47.679 and B at 19:01:47.966 (values window header), the revision rose by two, and the range is unchanged
- **Evidence:** UI check on smart451 at 1440×900 (values window header, revision, screenshot)

### Requirement: Selection overflows into new windows
A selection of two or more explorer signals, dropped or added, SHALL be placed in list order: a signal the target shows is skipped; each other goes into the first window where it fits, the target first, then the windows this add created, else into a new window. A timeseries window fits while it keeps at most four units, counting those it already shows; a values window fits every signal. Origin: D-066 („Only by unit limit", „Fill it up"); skip, first fit: lead default L4.

#### Scenario: Six units onto "+ New window"
- **WHEN** on smart451 at 1440×900 the user types `speed`, Ctrl-clicks (Cmd on macOS) `STEER_SPEED` (°/s), `CompSpd_Target` (%), `WSPD_FL` (1/min), `SPEED_DISP` (km/h), `V_MAX_LIM` (km/h(mph)) and `ENG_SPD_SET` (~/min), and drags `WSPD_FL` onto "+ New window"
- **THEN** while dragging the ghost reads `6 signals · add` over the zone; after the drop two new windows appear: the first shows STEER_SPEED, CompSpd_Target, WSPD_FL, SPEED_DISP on four axes, the second V_MAX_LIM and ENG_SPD_SET; the first is scrolled into view and the revision rose by eight
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while dragging, screenshot and revision after the drop)

#### Scenario: Drop onto a window with three units
- **WHEN** window `W` shows `DCU_1F4h.COMP_HV_Volt` (V), `ICL_3A2h.SPEED_DISP` (km/h) and `ENG_5E0h.T_ENG` (°C), and the user types `speed`, Ctrl/Cmd-clicks `STEER_SPEED`, `CompSpd_Target`, `WSPD_FL`, `WSPD_FR` and `SPEED_DISP`, and drags the selection onto `W`
- **THEN** `W` is highlighted with "Drop to add" (not "At most 4 units per window"); after the drop `W` shows its three signals plus STEER_SPEED (four units), one new window shows CompSpd_Target, WSPD_FL and WSPD_FR, SPEED_DISP is not added twice, and the revision rose by five
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while dragging, screenshot and revision after the drop)

#### Scenario: Placement rules
- **WHEN** `placeSignals` gets six signals of six units for an empty timeseries window; five signals `d, e, a, f, b` for a window showing units `a, b, c`; nine signals of nine units for "+ New window"; a values window showing `x` with `x` and six other units; three signals without unit and two of unit `V` for an empty window; a list with a repeated ID
- **THEN** four into the target and two into created window 0 (`windows` 1); `d`, `a`, `b` into the target and `e`, `f` into window 0; windows 0, 0, 0, 0, 1, 1, 1, 1, 2 (`windows` 3); `x` skipped and all six into the values window; the three unitless and the first `V` into the target, the second `V` too (`V` is one unit); the repeat placed once
- **Evidence:** `packages/shared/test/placement.test.ts` › "fills the target up to four units and overflows into new windows", "counts the units the target already shows", "puts each signal into the first window it fits", "creates windows for a new-window target", "takes any unit into a values window", "counts a signal without unit as its own unit", "places a repeated signal once"

### Requirement: Running a selection add
A selection add SHALL have no signal-count limit beyond the workspace's 50 signals. It SHALL send its commands in list order, creating each new window right before its first signal, and on the first refused command (e.g. `signal_limit`) stop, keep what was added and show the server's message once. A new window SHALL get the range a single "New window" add would give it, over all its signals; the first new window SHALL be scrolled into view. Origin: D-066; lead default L4.

#### Scenario: Running a plan stops at the first refusal
- **WHEN** `runPlan` runs a plan with one created window and three steps against a fake `command` that refuses the second `window.addSignal` with `signal_limit`
- **THEN** it sent `window.create` (with the range from `rangeFor` of that window's signals), the first `window.addSignal`, the refused one, and nothing after; it returns the created window's ID
- **Evidence:** `apps/web/test/addSignals.test.ts` › "creates each window before its first signal and stops at the first refusal"

### Requirement: Selection drag feedback
During a selection drag, a window SHALL be highlighted with "Drop to add" when it does not show at least one selected signal, and SHALL never be refused for units; "+ New window" always accepts. The ghost SHALL read `<N> signals`, plus ` · add` over a valid target and `· Already shown` over a window that shows all N. Origin: D-066; targets and ghost: lead defaults L2 and L6.

#### Scenario: Targets of a selection drag
- **WHEN** drop states are computed for an explorer source with `signalIds` `[A, B]` over: a window showing A only; a window showing A and B; a window with four other units; "+ New window"
- **THEN** target; not highlighted; target (never "refused"); accepted
- **Evidence:** `apps/web/test/drag.test.ts` › "highlights a window for a selection while one signal is new"

### Requirement: Lines break at gaps
In a raw view the window SHALL draw no line between two split points (data-gaps) and, in step mode, hold the earlier valid value up to its hold end and draw nothing from there to the next point. Gaps SHALL stay blank. Origin: D-062 („A line breaks where the logger recorded nothing … and where a cyclic signal skips more than 3 of its periods"; „Gaps stay blank").

#### Scenario: Breaks in raw data
- **WHEN** raw points with period 20 ms at 0, 20, 40 ms and 500, 520 ms are drawn in line mode and in step mode, and points without a period at 0 and 10 s around a logger gap 1 s–9 s
- **THEN** the line has no segment from 40 to 500 ms; the step holds the 40 ms value to 60 ms and nothing until 500 ms; around the logger gap the line has no segment and the step holds the first value to 1 s
- **Evidence:** `apps/web/test/build.test.ts` › "breaks lines and steps at gaps"

#### Scenario: Dropout in a drive
- **WHEN** on smart451 at 1440×900 a window shows `STR_0D4h.STEER_ANGLE` and `ICL_3A2h.SPEED_DISP` from 2026-10-13 11:34:34 to 11:34:39 local in line mode
- **THEN** both curves stop at about 11:34:36.2 and resume at about 11:34:37.0, nothing is drawn in between, and no grey band shows there (the logger was not silent for 2 s)
- **Evidence:** UI check (screenshot)

#### Scenario: State signal holds stop at gaps
- **WHEN** a signal with named states and period 100 ms is drawn (as steps) from raw points at 0, 100, 200 ms and 10 s with a logger gap 250 ms–9.9 s; and a view 1 s–9 s of it contains no point, with edge neighbours at 200 ms and 10 s
- **THEN** the step of the 200 ms value ends at 250 ms (the logger gap's start, before 300 ms) and nothing is drawn until 10 s; in the empty view no synthetic edge hold is drawn and the view stays blank
- **Evidence:** `apps/web/test/build.test.ts` › "ends state signal holds at gaps"

### Requirement: Gaps in aggregated views
In an aggregated view the mean curve and the min/max envelope SHALL break between two split buckets (data-gaps "Split between two buckets") and stay joined across other empty buckets. Origin: D-062 („The same holds for buckets when zoomed out").

#### Scenario: Buckets of a dropout and of a slow signal
- **WHEN** bucket results are drawn: width 5 ms of a signal with period 30 s whose buckets are 30 s apart; width 5 ms of a 20 ms signal with an empty stretch of 100 ms; and width 1 min of a signal without a period whose buckets around a logger gap are adjacent
- **THEN** the first stays one line; the second breaks in the empty stretch; the third breaks between the two buckets next to the logger gap, mean and envelope alike
- **Evidence:** `apps/web/test/build.test.ts` › "breaks buckets only where a gap is certain"

#### Scenario: Day overview
- **WHEN** on smart451 a window shows `DCU_2B8h.HTR_HV_Volt` over 2026-10-13 00:00–24:00 local, aggregated, envelope on
- **THEN** neither mean nor envelope crosses any of the grey bands (00:00–06:05, 06:05:45–10:30:23, 10:31:12–11:06:56, 12:13:07–12:42:29, 12:42:59–13:42:28, 13:42:58–15:07:03, 15:17:33–24:00 and the thin one at 11:27:54)
- **Evidence:** UI check (screenshot)

### Requirement: Logger gap bands
Every timeseries window SHALL paint each logger gap of its signals' data refs that meets its view and holds no drawn sample of that data ref, as a faint grey band over the plot's full height, under the grid, the event marks and the curves, at least 1 CSS px wide. Origin: D-062 („logger gaps also get a faint grey band so "no data" reads as intended"; „in every timeseries window" as a consequence of „every signal"); stale gaps: design G9 (a).

#### Scenario: Band in a drive
- **WHEN** on smart451 at 1440×900 a window shows `DCU_2B8h.HTR_HV_Volt` and `STR_0D4h.STEER_ANGLE` from 2026-10-13 11:27:45 to 11:28:05 local
- **THEN** a faint grey band covers 11:27:53.936 to 11:27:56.982; both curves end at its left edge and resume at its right edge; grid lines show over the band
- **Evidence:** UI check (screenshot)

#### Scenario: Bands of a view
- **WHEN** the bands of the view 2026-10-03T00:04:00Z–00:09:41Z are listed from gapcar's logger gaps
- **THEN** they are 00:04:59.980–00:06:00.000 and 00:09:40.000–00:09:41 (clipped to the view)
- **Evidence:** `apps/web/test/gaps.test.ts` › "lists the logger gaps a view shows"

### Requirement: Drawn data beats a stale logger gap
A window SHALL draw the curves, envelopes and bands of a stretch whose logger gap holds drawn samples as if the gap were absent: no break and no band there, and the drawn value (L, drags) a value, not `logger_gap`. Origin: Jan 2026-10-17 („same values are cluttered as dots, which should have a hüllkurve instead? looks strange"); design G9 (a).

#### Scenario: Repro of the stale gap
- **WHEN** with the logger gap 1792176671171000000–1792176763235000000 (2026-10-16 18:51:11.171–18:52:43.235 UTC) the view 18:51:11.385–18:51:20.691 is built from 500 buckets of 20 ms of `STR_0D4h.STEER_ANGLE` (period 10 ms, means alternating −1,400 and 1,400, all inside the gap) and 95 raw points of `DCU_2B8h.HTR_HV_Volt` (period 100 ms, 100 ms apart, edge neighbours inside the gap); the bands of the view are listed with and without these results; and the drawn values are read at 18:51:15.000
- **THEN** mean, min and max hold no inserted null and no bucket is isolated (was 499 breaks, 500 isolated); HTR_HV_Volt has no break (was 94); the bands are `[]` with the results and the one clipped gap without them; STEER_ANGLE reads `aggregated` and HTR_HV_Volt `interpolated`
- **Evidence:** `apps/web/test/build.test.ts` › "draws through a logger gap that holds samples"; `apps/web/test/gaps.test.ts` › "leaves out a band that holds samples"; `apps/web/test/readout.test.ts` › "reads drawn data inside a stale logger gap"

#### Scenario: Steering angle on 2026-10-16
- **WHEN** on smart451 at 1440×900 a window shows `DCU_2B8h.HTR_HV_Volt`, `STR_0D4h.STEER_ANGLE` and `ICL_3A2h.SPEED_DISP` from 2026-10-16 20:51:11.385 to 20:51:20.691 local
- **THEN** STEER_ANGLE is a mean curve with its min/max envelope (or a line when raw), the other two are lines, no point markers stand alone and no grey band shows
- **Evidence:** UI check (screenshot)

### Requirement: Gap info loads with the window
A window SHALL fetch the gap info of each data ref of its signals once per browser tab and scope (in an object scope per work window; and again as in "Gap info refetched"), draw its data meanwhile without breaks, and count as settled only when every needed gap info has loaded or failed. A failure SHALL be a render error of the window and SHALL be retried every 30 s while the window shows that data ref. Origin: necessary consequence of D-062 (breaks and bands need it) and D-011 (`--wait` reports the drawn state).

#### Scenario: Once per tab, failure retried
- **WHEN** two windows of one data ref ask for its gap info, the first fetch fails, and 30 s pass
- **THEN** one request is sent first, both windows report a render error naming the data ref, one more request is sent after 30 s, and after its success no window reports the error
- **Evidence:** `apps/web/test/gaps.test.ts` › "fetches gap info once per data ref and retries a failure"

#### Scenario: Settled with breaks
- **WHEN** on smart451 `kipscope --wait window range <w> "2026-10-13 11:27:45" "2026-10-13 11:28:05"` runs on a window showing `DCU_2B8h.HTR_HV_Volt` in a fresh browser tab
- **THEN** it reports `complete`, and a screenshot taken right after shows the band and the break
- **Evidence:** UI check (CLI output and screenshot)

### Requirement: Gap info refetched
A loaded gap info SHALL be fetched again every 5 min while a window shows its data ref, replaced only when the answer differs, and kept without a render error when that fetch fails. Origin: necessary consequence of D-062 (the server's gap info follows new rows, data-gaps); design G9 (c).

#### Scenario: Refetch every 5 min
- **WHEN** a window shows a data ref whose gap info has loaded, 5 min pass with the same answer, 5 min more with one logger gap less, then 5 min more with a failing fetch
- **THEN** one request is sent at each 5 min mark; the info object stays the same after the first, is replaced after the second, and stays after the third with no render error, the window settled throughout
- **Evidence:** `apps/web/test/gaps.test.ts` › "refetches gap info every 5 min and keeps it on failure"

### Requirement: Missing signals read calm
A signal whose series request answers 404 `unknown_signal` (the shown vehicle lacks it, as after a step) SHALL read `missing` in its legend status as a muted pill, tooltip `Missing: <dataRef> has no signal <shown name>`, its readout cells `—` with that tooltip; it SHALL add no y axis or axis title and not be retried for the same view; its row stays. Other failures keep `failed: <message>`. Origin: D-092 (designer: red `failed: unknown_signal: …`); D-089 (missing signals stay).

#### Scenario: Status and axes
- **WHEN** the loader gets for a signal a fetch that fails with the API error built from a 404 answer `{error: {code: "unknown_signal", message: "unknown signal: othercar/X"}}`, outside and inside a case; and `layoutAxes` gets that signal marked missing beside `SIG_A` (unit `V`)
- **THEN** `loadStatusText` gives `missing` in both cases and the state is not retried; `layoutAxes` gives one axis (`V`) and no scale or side for the missing signal; a readout cell for a value request failing the same way reads `—` with the tooltip `Missing: othercar has no signal X`
- **Evidence:** `apps/web/test/loader.test.ts` › "reads an unknown signal as missing"; `apps/web/test/axes.test.ts` › "leaves missing signals out of the axes"; `apps/web/test/readout.test.ts` › "reads an unknown signal as missing"

#### Scenario: Step to a vehicle without the signal on smart451
- **WHEN** a catalog with one smart451 drive and one session of a second vehicle that lacks `COMBI_412h.V_ANZ` is open (needs a second data ref on the server; the catalog holds only smart451 as of 2026-10-22, so this UI check is deferred, `not_run`, until one exists; a synthetic data ref is not evidence), a window shows V_ANZ beside a signal both have, and the user presses `]`
- **THEN** the V_ANZ legend row reads `missing` in a grey pill with the tooltip `Missing: <vehicle> has no signal V_ANZ`, no axis title shows `failed` or `unknown_signal`, the other signal is drawn; `[` draws V_ANZ again
- **Evidence:** until a second data ref exists: "Status and axes" (`apps/web/test/loader.test.ts` › "reads an unknown signal as missing", `apps/web/test/axes.test.ts` › "leaves missing signals out of the axes") and the UI user's run with a synthetic `othercar` entry (grey `missing` pill, tooltip `Missing: othercar has no signal COMBI_412h.V_ANZ`, no `failed`, `[` redraws); then UI check (screenshot after `]` with the tooltip, after `[`)

### Requirement: Flat y range
A y range whose span is at most 1e-9 of its largest magnitude SHALL widen to its middle ± max(10 % of |middle|, 1), a non-finite one to 0 … 1, so a constant signal draws mid-plot on an axis with ticks and never makes the chart throw. Origin: data fact (smart451 `SAS_0C2h.LWS_SPEED`, Drive 2 from about 11:23 to 11:56 local: constant −1433.6, bucket means −1433.5999999999979; uPlot threw `RangeError: Invalid array length`, round 2); padding as `yRange`'s flat line; numbers ×2: design DW2.

#### Scenario: Constant series, no RangeError
- **WHEN** the window's range function gets [−1433.6, −1433.6], [0, 0], [1e9, 1e9], [−1433.6, −1433.6 + 1e-12], [0, 1e-12] and [0.3, 0.1 + 0.2]
- **THEN** each result is finite with low < high, contains the input, spans at least 1e-9 of its magnitude, and a split loop with about 7 increments over it ends after more than 1 and fewer than 1000 steps
- **Evidence:** `apps/web/test/axes.test.ts` › "y scale range of a constant series (D-095, uPlot RangeError)" › "gives a finite, splittable range for constant negative (LWS_SPEED -1433.6)" and its siblings

#### Scenario: Constant series on smart451
- **WHEN** a window on smart451 shows only `SAS_0C2h.LWS_SPEED` over a constant stretch of Drive 2, 11:30–11:50 local, aggregated (over the whole drive the signal jumps to about 0 at 11:23 and 11:56 local, so the axis spans 0 … −1.5 k and the line lies at the bottom)
- **THEN** the line is drawn in the middle of the plot (the axis spans −1433.6 ± 143.36, so its tick labels lie within −1.58 k and −1.29 k, `°/s`; about −1.30 k … −1.55 k were seen), the tick labels are readable, and the console shows no uncaught exception
- **Evidence:** UI check on smart451 (screenshot, console); `pnpm smoke` passes
