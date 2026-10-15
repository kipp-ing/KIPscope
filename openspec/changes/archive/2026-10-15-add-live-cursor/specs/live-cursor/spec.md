## Purpose

The live cursor L is the time under the mouse pointer in a timeseries plot. It is local to one browser tab and shows every signal's value at that time in every window, without commands, so values can be read anywhere without moving cursor A or B (D-032).

## ADDED Requirements

### Requirement: Live time under the pointer
While the pointer moves over a timeseries plot and nothing hides L ("When L is hidden"), the live time L SHALL be the time under the pointer, snapped and kept inside the shown range exactly like a click that places A. Origin: D-032 („a live cursor "L" follows the mouse"); same snap as a click: necessary consequence, so L reads the value a click there would place.

#### Scenario: Snapped like a click
- **WHEN** a plot shows 2 s over 1000 px and the pointer is at the x of 13:08:00.0934567Z
- **THEN** L is 13:08:00.093Z (the span/1000 grid of a click), and inside the half-open shown range also at the plot's right edge
- **Evidence:** `apps/web/test/live.test.ts` › "snaps the live time like a click, inside the shown range"

### Requirement: Live cursor is local to the browser tab
L SHALL send no command, change no revision, take no part in the render acknowledgement and have no CLI form. Origin: D-032 („It is local to the browser (no command, no revision, not in the CLI)").

#### Scenario: Hover changes no state
- **WHEN** the pointer moves across a window showing `COMBI_412h.V_ANZ` for 3 s
- **THEN** `curl -s localhost:7310/api/workspace | jq .revision` prints the same number before and after
- **Evidence:** the `curl` command before and after; UI check (L cells change while the pointer moves)

### Requirement: L column in every chart legend
Every timeseries window's legend rows SHALL have a column L after A | B | Δ, always present and aligned in one column (cursors "Readout cells in the legend"). Without L its cells SHALL be empty; showing or clearing L SHALL NOT move any legend row or column. Origin: D-032 („Every chart legend gets a 4th column L"; „without a hover L is empty"); one column: D-033 („L lines up under itself also with A and B off"); no shift: necessary consequence of a column that fills at frame rate.

#### Scenario: Cursors off, no hover
- **WHEN** A and B are off, the window shows `COMBI_412h.V_ANZ`, `BS_200h.DVL` and `CPC_448h.PTC_HV_Volt` (names of different length) and the pointer is outside every plot; then the pointer enters the plot
- **THEN** the legend is one row per signal with an empty L column; then the L cells fill at the same x in every row (within 1 px), and no row, name or SNA share moves
- **Evidence:** UI check (two screenshots, rows at the same pixel positions, L cells in one column)

### Requirement: L values from the drawn data
While L is set, each L cell SHALL show its signal's value at L from that window's loaded data: the raw value evaluated in the window's mode (markers as line) zoomed in, the bucket mean zoomed out, printed like the A cell (number-format without unit, SI prefix kept), the kind (`lin`, `hold`, `avg`) as tooltip. Origin: D-032 („The L value comes from the drawn data (raw points zoomed in, bucket value zoomed out, kind as tooltip), like a dragged line under D-031").

#### Scenario: Live value zoomed in
- **WHEN** a window shows `COMBI_412h.V_ANZ`, `BS_200h.DVL` and `CPC_448h.PTC_HV_Volt` from 2026-10-13T13:08:00Z to 13:08:03Z in line mode and L is 13:08:00.093Z
- **THEN** the L cells read V_ANZ `23.0`, DVL `180` with tooltip "linear between points (lin)", PTC_HV_Volt `363`
- **Evidence:** `apps/web/test/live.test.ts` › "evaluates L from the drawn data: raw zoomed in, bucket mean zoomed out"; UI check: hover, click without moving (A placed at L), screenshot shows the A and L cells equal for all three rows

#### Scenario: Live value zoomed out
- **WHEN** the same window is zoomed out to V_ANZ's full extent (aggregated) and the pointer hovers a part with data
- **THEN** each L cell shows a number with tooltip "bucket mean (avg)"
- **Evidence:** `apps/web/test/live.test.ts` › "evaluates L from the drawn data: raw zoomed in, bucket mean zoomed out"; UI check (screenshot with the tooltip)

### Requirement: L line in the other windows
While one timeseries window is hovered, every other timeseries window SHALL fill its L cells at L and, if L lies in its shown range, draw a thin vertical L line there, distinct from the A and B lines (no flag, not draggable). The hovered window SHALL show its crosshair and no L line. Origin: D-032 („while one window is hovered, the other timeseries windows show a thin L line at the same time and fill their L column").

#### Scenario: Two linked windows
- **WHEN** "Link time axes" is on, window 1 shows `COMBI_412h.V_ANZ` and window 2 shows `BS_200h.DVL`, both 2026-10-13T13:08:00Z–13:08:03Z, and the pointer hovers window 1 at 13:08:01Z
- **THEN** window 2 shows a thin L line at the same x as window 1's crosshair (within 1 px) and its DVL L cell holds a number; after the pointer leaves window 1, the line is gone and both L columns are empty
- **Evidence:** UI check (two screenshots)

#### Scenario: Outside the other window's range
- **WHEN** "Link time axes" is off, window 2 shows 13:09:00Z–13:09:10Z and the pointer hovers window 1 at 13:08:01Z
- **THEN** window 2 draws no L line and its L cells read `—` with the reason "outside this window's range"
- **Evidence:** UI check (screenshot with the tooltip); `apps/web/test/live.test.ts` › "reads SNA and gaps without a number and never highlights them"

### Requirement: Near signal
In the hovered window, the near signal SHALL be the one whose curve at the pointer's x lies within 8 px vertically of the pointer; with several, the nearest, on a tie the one later in the legend. The distance SHALL be measured in screen pixels on each signal's own y axis. Only a signal with a number at L is a candidate. Origin: D-032 („within about 8 px vertically of the pointer (nearest wins)"); per-axis pixels: necessary consequence of several y axes in one plot.

#### Scenario: Nearest of three
- **WHEN** the candidates lie 9 px, 3 px and 5 px from the pointer; then 3 px and 3 px; then 8 px; then 8.5 px
- **THEN** the second is near; then the later of the two; then that one; then none
- **Evidence:** `apps/web/test/live.test.ts` › "picks the nearest curve within 8 px, on a tie the later one"

#### Scenario: Only numbers inside the plot are candidates
- **WHEN** the signals of a 200 px high plot are, in legend order: `SNA`; `—` (gap); `—` (outside this window's range); loading; an envelope edge (no scale) with a number; a number at y −2; a number at y 40; a number at y 40
- **THEN** the candidates are exactly the last two, in that order, so the pointer at y 40 picks the last one
- **Evidence:** `apps/web/test/live.test.ts` › "builds near candidates only from numbers inside the plot"

### Requirement: Near-signal highlight
The near signal SHALL be drawn with a thicker line, every other signal of the hovered window faded, and its legend row marked; without a near signal all are drawn as normal. Other windows SHALL highlight nothing. Origin: D-032 („is highlighted: thicker line, others faded, its legend row marked"); only the hovered window: the pointer's height exists only there.

#### Scenario: Pointer on a curve
- **WHEN** the window of "Live value zoomed in" is hovered with the pointer on the V_ANZ curve at 13:08:00.093Z; then the pointer moves 30 px straight up, away from every curve
- **THEN** V_ANZ is drawn thicker, DVL and PTC_HV_Volt faded and V_ANZ's legend row marked; then no curve is highlighted and all are drawn as normal
- **Evidence:** UI check (two screenshots)

### Requirement: Highlight label
While a signal is near, a label at its curve point at the pointer's x SHALL show its value at L with number-format (SI prefix and unit). The label SHALL stay inside the plot and SHALL NOT cover the curve point. Origin: D-032 („a label at the curve shows its value at the pointer's x"); format: D-026 („everywhere").

#### Scenario: Label on the speed curve
- **WHEN** V_ANZ is near as in "Pointer on a curve"; then the pointer follows the PTC_HV_Volt curve to the plot's right edge
- **THEN** the label reads `23.0 km/h` next to the curve point; then the PTC_HV_Volt value with unit `V`, still fully inside the plot
- **Evidence:** UI check (two screenshots); `apps/web/test/live.test.ts` › "places the label beside the curve point, inside the plot"

### Requirement: L without a value
At an SNA value the L cell SHALL read `SNA`; where the loaded data gives no value (before the first or after the last point, next point SNA in line mode, an empty bucket, outside the window's range) `—` with the reason as tooltip. Such a signal SHALL NOT be near and gets no label. Origin: D-010 (SNA never a number); concept §5 („Ohne verfügbare Messgrundlage darf kein Wert erfunden werden").

#### Scenario: Hover over an SNA run
- **WHEN** a window shows V_ANZ from 2026-10-13T09:56:59Z to 09:57:01Z and the pointer hovers 09:57:00Z at the height where a valid curve would be
- **THEN** the L cell reads `SNA`, nothing is highlighted and no label shows
- **Evidence:** UI check (screenshot); `apps/web/test/live.test.ts` › "reads SNA and gaps without a number and never highlights them"

### Requirement: When L is hidden
L SHALL be cleared, with its lines, highlight and label, when the pointer leaves the plot, and stay cleared while a mouse button is held on a plot (click or rectangle zoom) and while a cursor line, a legend or explorer row or a height handle is dragged. Origin: D-032 („without a hover L is empty"); during gestures: necessary consequence, a dragged line already shows its live value (cursors "Live readout during a drag").

#### Scenario: Leave and drag
- **WHEN** the pointer hovers a V_ANZ plot (L cells filled), then leaves it; returns and drags A's line; returns and drag-selects a range
- **THEN** the L cells are empty after leaving, during the line drag (the dragged A cell still follows the line) and while the button is held for the rectangle
- **Evidence:** UI check (screenshots after leaving, during the drag, during the rectangle)

### Requirement: L after a click
On mouse up without movement (a click) on a plot, L SHALL be set again at the same pointer position, without a further move. Origin: D-033 („on mouse up without movement L comes back at the same spot, so A and L read the same right after a click").

#### Scenario: Click without moving
- **WHEN** the pointer hovers the window of "Live value zoomed in" at 13:08:00.093Z, the button is pressed and released without moving
- **THEN** the L cells are empty while the button is held; after the release they read the same as the A cells (`23.0`, `180`, `363`) without a further move
- **Evidence:** UI check (screenshot after the release, A and L cells equal)

### Requirement: L after a range change
After any change of the hovered window's shown range, L SHALL stay cleared until the pointer moves, like the crosshair (timeseries-window "Crosshair follows the pointer only"). Origin: necessary consequence: an L kept at its pixel would name a wrong time.

#### Scenario: Wheel zoom without moving
- **WHEN** the pointer hovers a V_ANZ plot (L cells filled) and the user Ctrl+wheel-zooms once without moving; then moves
- **THEN** the L cells are empty after the zoom; then filled again
- **Evidence:** UI check (screenshots after the zoom and after the move)

### Requirement: Live cursor costs no requests
Moving the pointer SHALL send no request for chart legends or lines; they read the loaded data only. L SHALL be published at most once per animation frame, and the plot SHALL be redrawn for the highlight only when the near signal changes. Origin: D-032 (the L value comes from the drawn data); one update per frame: necessary consequence of a value that follows the pointer at screen rate.

#### Scenario: No requests while hovering
- **WHEN** no values window is open and the pointer moves over a window showing three signals for 3 s
- **THEN** the browser's network log shows no request to `/api/series` or `/api/value` in that time
- **Evidence:** UI check (network log read with the browser tools, filtered to `/api/`)

#### Scenario: One update per frame
- **WHEN** ten pointer moves arrive before the next animation frame
- **THEN** subscribers are notified once, with the last time
- **Evidence:** `apps/web/test/live.test.ts` › "publishes at most one live time per animation frame"
