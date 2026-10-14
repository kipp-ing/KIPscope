## REMOVED Requirements

### Requirement: Independent zoom and pan
**Reason**: D-017: "Time zoom is shared across windows by default and can be switched off. This supersedes concept §4 'Der Zeitzoom ist je Fenster unabhängig' as the default."
**Migration**: Replaced by "Linked time zoom" below; independent zoom is the state with "Link time axes" switched off.

## ADDED Requirements

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
The top bar SHALL show a "Link time axes" toggle that reflects and sets the workspace's link flag, on by default. Switching it on SHALL show all windows at the range of the window zoomed last. Origin: D-017 ("on by default and can be switched off"); toggle in the top bar from power-user expectations (feedback 2026-10-14, point 3).

#### Scenario: Default on
- **WHEN** the app is opened after a server restart
- **THEN** "Link time axes" is checked
- **Evidence:** UI check (screenshot of the top bar)

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
While dragging, each window that can take the signal SHALL be highlighted with the hint "Drop to move · Alt/Ctrl+drop to copy", and a "+ New window" drop zone SHALL appear below the last window. A window showing the signal already, or reaching five units, SHALL NOT be highlighted (the latter is marked not droppable) and SHALL ignore a drop. Esc or a release outside any target SHALL cancel without a command. Origin: power-user expectations (feedback 2026-10-14, point 1) serving D-017.

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
- **Evidence:** UI check (revision unchanged in the top bar)

### Requirement: Zoom stays within time bounds
Zoom-out, wheel zoom, pan, reset and back SHALL keep the window range within 1900-01-01T00:00:00Z … 2262-04-11T00:00:00Z. Origin: necessary consequence of the bug "window range 1036-01-11 … 3937-05-09" (design "Bug analysis").

#### Scenario: Zoom out forty times
- **WHEN** a window shows `CPC_448h.PTC_HV_Volt` and the user clicks "Zoom out" 40 times
- **THEN** the header range never shows a year before 1900 or after 2262, no command is rejected, and the signal is still drawn (as an aggregated point or short curve)
- **Evidence:** UI check (screenshot of the header and the message area); `apps/web/test/zoom.test.ts` › "clamps ranges into the time bounds"

### Requirement: Valid constants at raw 0 are drawn
A stored value that is not an SNA code of its signal SHALL be drawn as a value even when it is constant and equals the physical value of raw 0. Origin: D-019 ("T_SOLL's raw 0 (−40 °C, all data on smart451) is shown as a valid value; the DBC rules (D-010, D-014, D-015) apply unchanged, no per-signal exceptions."); D-012 for DNMOT; data facts in design "Bug analysis".

#### Scenario: T_SOLL
- **WHEN** a window shows the full extent of `AC_A1.T_SOLL`
- **THEN** the curve is a flat line at −40 °C and the legend shows no SNA share
- **Evidence:** UI check (screenshot)

#### Scenario: DNMOT
- **WHEN** a window shows the full extent of `MS_312h.DNMOT`
- **THEN** the curve is a flat line at −127 (the padded axis may show a tick at −120) and the legend shows no SNA share
- **Evidence:** UI check (screenshot)
