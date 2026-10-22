# cursors Specification

## Purpose
Global cursors A and B mark absolute points in time across all windows, so that values, time differences and value differences can be read at the same moment everywhere. The UI and the CLI control them through the same workspace commands.

## Requirements

### Requirement: Cursor state in the workspace
The workspace SHALL hold cursors A and B, each either off or at one absolute time in nanoseconds, plus a diff flag. All three SHALL be off on a fresh workspace, SHALL be readable with the rest of the state, and SHALL change only through commands. Origin: concept §6 (A and B are the same absolute time in all windows), §7 (the open view's cursors must be controllable and readable); D-023.

#### Scenario: Fresh workspace
- **WHEN** the server starts and a caller reads the workspace
- **THEN** `curl -s localhost:7310/api/workspace | jq -c .workspace.cursors` prints `{"diff":false}`
- **Evidence:** `packages/shared/test/apply.test.ts` › "starts with both cursors off and diff off"; the `curl` command after a server restart

### Requirement: Cursor commands
Commands SHALL set a cursor to an absolute time, move it by a signed number of nanoseconds, switch it off, and switch diff mode on or off. Each SHALL be one command with one revision. Moving an off cursor SHALL be rejected with `cursor_off`. A time outside the bounds SHALL be rejected with `invalid_command`, and the workspace SHALL stay unchanged. Origin: concept §7 („Cursor absolut setzen oder relativ verschieben", „Differenzmodus … steuern"); workspace-state "Time bounds in commands".

#### Scenario: Set, move, remove
- **WHEN** `cursor.set {cursor: "a", t: "2026-10-13T13:08:00.093Z"}` and then `cursor.move {cursor: "a", by: "902000000"}` are applied, and later `cursor.remove {cursor: "a"}`
- **THEN** A is first `1791896880093000000`, then `1791896880995000000`, then off; each command raised the revision by one
- **Evidence:** `packages/shared/test/apply.test.ts` › "sets, moves and removes cursors"; `apps/server/test/workspace.http.test.ts` › "applies cursor commands over HTTP"

#### Scenario: Move an off cursor or past the bounds
- **WHEN** `cursor.move {cursor: "b", by: "1000"}` is applied while B is off, and `cursor.move {cursor: "a", by: "-9000000000000000000"}` while A is on
- **THEN** the first is rejected with `cursor_off`, the second with `invalid_command` naming the bounds; the revision does not change
- **Evidence:** `packages/shared/test/apply.test.ts` › "rejects moving an off cursor or past the time bounds"

#### Scenario: Diff mode
- **WHEN** `cursor.setDiff {diff: true}` is applied
- **THEN** `GET /api/workspace` shows `cursors.diff` as `true` and the cursor times are unchanged
- **Evidence:** `packages/shared/test/apply.test.ts` › "sets, moves and removes cursors"

### Requirement: Cursor lines in every timeseries window
Each cursor that is on SHALL be drawn in every timeseries window whose range contains its time, as a vertical line over the plot height at that absolute time, whatever the window's zoom: A solid with the flag "A", B dashed with the flag "B", in one neutral colour outside the signal palette. Other windows SHALL draw no line for it. Origin: concept §6 („A und B bezeichnen in allen Fenstern dieselben absoluten Zeitpunkte. Fenster behalten ihren unabhängigen Zoom.").

#### Scenario: Two unlinked windows
- **WHEN** "Link time axes" is off, window 1 shows `ICL_3A2h.SPEED_DISP` from 2026-10-13T13:08:00Z to 13:08:03Z, window 2 shows `DCU_2B8h.HTR_HV_Volt` from 13:07:00Z to 13:10:00Z, and `cursor.set {cursor: "a", t: "2026-10-13T13:08:01.5Z"}` is posted with `curl`
- **THEN** within 1 s both windows show a solid line flagged "A" at 15:08:01.5 local time: in window 1 at the middle of the plot, in window 2 near its first third
- **Evidence:** UI check (one screenshot of both windows)

#### Scenario: Cursor outside a window's range
- **WHEN** window 2 is zoomed to 13:09:00Z–13:09:10Z while A stays at 13:08:01.5Z
- **THEN** window 2 draws no cursor line and window 1 still shows A
- **Evidence:** UI check (screenshot)

#### Scenario: Lines stay at their time while zooming
- **WHEN** A and B are on and the user wheel-zooms window 1 and pans it by a horizontal swipe
- **THEN** both lines move with their time on the axis during the zoom preview and after it; they never stay at their old pixel
- **Evidence:** UI check (screenshots before and after the zoom, tick labels under the lines)

### Requirement: Placing cursors by click
In a timeseries plot, a click without pointer movement (below 4 px) SHALL place cursor A at the clicked time, and a Shift+click SHALL place B. Both switch the cursor on if it was off. The click SHALL send one `cursor.set` once the double-click interval has passed. The line SHALL appear at once, and a double-click SHALL place no cursor. Origin: concept §6 (cursors are placed in the windows); D-023; gesture choice in design C3.

#### Scenario: Click and Shift+click
- **WHEN** A and B are off and the user clicks window 1 at about 13:08:01Z, then Shift+clicks at about 13:08:02Z
- **THEN** a line "A" appears at the first spot and a line "B" at the second, the option bar's A and B toggles are checked, and the revision rose by exactly two
- **Evidence:** UI check (screenshot, revision before and after)

#### Scenario: Double-click resets zoom only
- **WHEN** A is at 13:08:01.5Z and the user double-clicks window 1 elsewhere
- **THEN** the zoom resets as before ("Double-click resets zoom") and A stays at 13:08:01.5Z
- **Evidence:** `apps/web/test/cursors.test.ts` › "commits a click only after the double-click interval"; UI check (screenshot of the values window header before and after)

#### Scenario: Rectangle zoom still zooms
- **WHEN** the user drags a rectangle of about 200 px in window 1
- **THEN** the window zooms to the rectangle and no cursor moves
- **Evidence:** UI check (screenshot, cursor times in the values window header unchanged)

#### Scenario: Placed times are short
- **WHEN** a click lands at 1791896881512345678 ns in a window spanning 3 s
- **THEN** the cursor is placed at 1791896881512000000 (snapped to 1 ms, the largest power of ten in ns that is at most span/1000)
- **Evidence:** `apps/web/test/cursors.test.ts` › "snaps cursor times to a power of ten below a thousandth of the span"

### Requirement: Dragging a cursor line
Pressing within 6 px of a cursor line and moving the pointer SHALL drag that cursor. While dragging, the line SHALL follow the pointer in every timeseries window, and no zoom selection or signal drag SHALL start. Release SHALL send exactly one `cursor.set`. Esc SHALL put the line back without a command. On a tie, B is taken. Origin: concept §6 (cursors are moved); necessary consequence of command-based state (one command per gesture, design C2); hit rule in design C3.

#### Scenario: Drag A
- **WHEN** A is at 13:08:01Z and the user presses on A's line in window 1, drags it about 100 px right and releases
- **THEN** A's line follows the pointer in both windows during the drag, the window does not zoom, and after release the revision rose by exactly one and A shows its new time in the values window header
- **Evidence:** UI check (screenshot while dragging, revision before and after)

#### Scenario: Cancel with Esc
- **WHEN** the user drags B's line and presses Esc before releasing
- **THEN** B is back at its previous time and the revision is unchanged
- **Evidence:** UI check (revision before and after)

#### Scenario: Hit test
- **WHEN** A is at x = 100 px and B at x = 104 px, and the user presses at x = 102, 107 and 111
- **THEN** 102 and 107 take B (tie and nearer), and 111 takes nothing (more than 6 px from both)
- **Evidence:** `apps/web/test/cursors.test.ts` › "hits the nearer cursor line within 6 px, B on a tie"

### Requirement: Cursor controls in the option bar
The option bar SHALL show toggles "A", "B" and "Diff" that reflect the workspace state. Switching A on SHALL place it at one third of the reference window's range, and B at two thirds. The reference window is the window zoomed last, else the first timeseries window. Switching a cursor off SHALL remove it. "Diff" SHALL set the diff flag. A and B SHALL be disabled while no timeseries window exists. Origin: D-023 („a bar holds cursor A/B on/off and diff mode").

#### Scenario: Toggle cursors on
- **WHEN** all windows are linked at 2026-10-13T13:08:00Z–13:08:03Z and the user checks A, then B
- **THEN** A is placed at 13:08:01Z and B at 13:08:02Z (lines in every window), each with one command
- **Evidence:** `apps/web/test/bar.test.ts` › "places new cursors at a third and two thirds of the reference range"; UI check (screenshot)

#### Scenario: State set from the CLI shows in the bar
- **WHEN** a caller posts `cursor.setDiff {diff: true}` and `cursor.remove {cursor: "b"}` with `curl`
- **THEN** within 1 s "Diff" is checked, "B" is unchecked and B's line is gone in every window
- **Evidence:** UI check (screenshot of the bar and a window)

### Requirement: Readout cells in the legend
While A is on, each signal's legend row in a timeseries window SHALL show its value at A, while B is on also at B, and in diff mode Δ = B−A, in columns aligned across rows and headed by the cursor times ("Readout row"); after them the live column L (live-cursor "L column in every chart legend") SHALL always follow, also while A and B are off. The legend SHALL always be a grid (name, `[unit]`, A | B | Δ while on, L), never a wrapping list. Cells use number-format without the unit but with its SI prefix (the row names `[unit]` once) and no tag; the kind (`lin`, `hold`, `avg`) is the tooltip. SNA reads `SNA`, a missing value `—` with the reason, a loading value the values window's loading state. Origin: D-027; concept §6; design N3 of `improve-navigation`; D-030; D-031; L column: D-032 („Every chart legend gets a 4th column L"); always a grid: D-033 („The chart legend is always a grid ... (replaces the wrapping list with cursors off)"); column headers: D-092 (10).

#### Scenario: Speed difference on the chart
- **WHEN** a window on smart451 shows `COMBI_412h.V_ANZ`, `BS_200h.DVL` and `CPC_168h.EAC_HV_Volt` from 2026-10-13T13:08:00Z to 13:08:03Z in line mode, diff mode is on, A is at 13:08:00.093Z and B at 13:08:00.995Z
- **THEN** the V_ANZ row reads `[km/h]`, A `23.0`, B `18.0`, Δ `-5.00`, then the L cell; the DVL row reads A `180` with tooltip "linear between points (lin)"; the EAC_HV_Volt row reads A `360`, B `361` and Δ `687 m` (values from `kipscope value … line` on 2026-10-21: V_ANZ 23 and 18 raw, DVL 179.75 interpolated, EAC_HV_Volt 360 and 360.687 interpolated; design DW24)
- **Evidence:** UI check (screenshot of the window); `apps/web/test/readout.test.ts` › "evaluates raw results like evaluateAt, with edge neighbours", "computes Δ only from numbers and marks it avg > lin > hold"

#### Scenario: A only
- **WHEN** diff mode is off, A is on and B is off in the window above; then B is set to 13:08:00.995Z
- **THEN** each row shows the A column and the L column, headed `A 15:08:00.093`; then the A, B and L columns without Δ, headed `A …` and `B …` and no `Δt`
- **Evidence:** UI check (screenshot)

#### Scenario: Cursors off
- **WHEN** A and B are off and the pointer is outside every plot
- **THEN** the legend is a grid, one row per signal, with name and `[unit]` and no A, B or Δ column, no header row, only the empty L column at the same x in every row
- **Evidence:** UI check (screenshot)

### Requirement: Readout row
While a cursor is on, a timeseries window's legend SHALL have one header row above its signal rows, whose cells head the cursor columns: over A `A <clock>` (local `HH:MM:SS.mmm`, cut, never rounded up; the full time in the values-window format as tooltip), over B `B <clock>` while B is on (`B off` in diff mode), and over Δ `Δt <signed Δt>` (values-window "Time formats") in diff mode. Its name cell holds the next-step hints (`guidance` "Next-step hints at the cursors") and is otherwise empty. Each cursor column SHALL have one fixed width, that of `A 00:00:00.000` in the legend's font with tabular numbers (goal ≈ 84 px; the mock's 72 px ×½ cuts every header, ×2 is 500 px for three columns, more than a 480 px window), so moving a cursor changes no column; a longer cell text truncates with `…` and keeps its full text as tooltip. There SHALL be no separate readout row; the header covers no part of the plot except the Δt label ("Δt between the cursor flags"). Origin: D-027 (the values window stays for many signals); concept §6 (Δt); clock only: D-030; header row: D-092 (10) („A/B/Δ readout becomes the legend's column headers"); fixed width: D-092 („Layout never moves").

#### Scenario: Times and Δt
- **WHEN** the window of "Speed difference on the chart" is shown, then diff mode is switched off, then B is switched off, then A
- **THEN** the header row reads `A 15:08:00.093` (tooltip `2026-10-13 15:08:00.093`), `B 15:08:00.995`, `Δt +902 ms` over the A, B and Δ columns; then `A 15:08:00.093`, `B 15:08:00.995`; then only `A 15:08:00.093`; then the header row is gone
- **Evidence:** UI check (three screenshots); `apps/web/test/readout.test.ts` › "heads the legend columns with the cursor times"

#### Scenario: Header helper
- **WHEN** `legendHeaders` gets A at 1791896880093456789 ns and B at A + 902 ms in Europe/Berlin with diff on; A alone; B off with diff on; and no cursor
- **THEN** it gives `A 15:08:00.093` with the tooltip `2026-10-13 15:08:00.093456789`, `B 15:08:00.995` and `Δt +902 ms`; `A 15:08:00.093` only; `A 15:08:00.093`, `B off` and no Δt; undefined
- **Evidence:** `apps/web/test/readout.test.ts` › "heads the legend columns with the cursor times"

#### Scenario: Columns hold still
- **WHEN** on smart451 a window shows three signals with A, B and Diff on, the layout probe of design DW1 runs, and the user drags A's line across the plot and releases it
- **THEN** the probe reports at most 1 px for the window's header cells, the plot and the legend's first row; the column headers changed their times
- **Evidence:** UI check on smart451 at 1440×900 (probe output, screenshot after)

#### Scenario: Nothing over the curves
- **WHEN** a window shows six signals in at most four units (the unit limit, D-019) with A and B on in diff mode
- **THEN** the plot shows the curves, the cursor lines with their flags and the Δt label only; all values are in the legend rows
- **Evidence:** UI check (screenshot)

### Requirement: Exact readout values
A chart readout cell SHALL show the values window's exact value at the committed cursor time, fetched from the server for the window's mode (markers as line), inside or outside the zoom and at any zoom level. While that value loads, the cell SHALL show the value of the drawn curve, or outside the zoom the previous value, dimmed. A render is acknowledged once these values are in. Origin: D-031 (Jan's pick "Always exact"); supersedes D-024's zoom-dependent chart value.

#### Scenario: Same as the values window
- **WHEN** a values window and the window of "Speed difference on the chart" both list `ICL_3A2h.SPEED_DISP`, both in linear mode, and A is set to 2026-10-13T13:08:00.1435Z; then the timeseries window is zoomed out to SPEED_DISP's full extent (aggregated)
- **THEN** the values window reads `22.5 km/h lin` and the chart `22.5` with tooltip "linear between points (lin)", also when zoomed out
- **Evidence:** UI check (screenshots); `apps/web/test/readout.test.ts` › "shows the exact server value, inside or outside the zoom"

#### Scenario: Zoom past A
- **WHEN** a window shows `ICL_3A2h.SPEED_DISP` with A at 2026-10-13T13:08:00.093Z in line mode, and the window is zoomed to 13:08:01Z–13:08:03Z
- **THEN** the A cell still reads `23.0` without a loading state in between
- **Evidence:** UI check (screenshot before and after the zoom); `apps/web/test/readout.test.ts` › "shows the drawn value, dimmed, while the exact one loads; outside the zoom the previous one"

### Requirement: Live readout during a drag
While a cursor line is dragged, or a click waits for its double-click, its cells SHALL follow the drawn curve at the shown time (a bucket mean in an aggregated view); on release the exact value replaces it. Origin: D-031; concept §6 (values follow the cursor); design N4.

#### Scenario: Follows a dragged line
- **WHEN** the user drags A's line slowly across the SPEED_DISP window of "Speed difference on the chart"
- **THEN** the chart's A cell changes while dragging, and a values window showing SPEED_DISP keeps its committed value, dimmed, until release; after release both read the same value
- **Evidence:** UI check (two screenshots during the drag, one after); `apps/web/test/readout.test.ts` › "follows the drawn curve live while a line is dragged"

### Requirement: Readout without a value
A cursor at an SNA value SHALL read `SNA`, a cursor inside a gap (reason `logger_gap` or `period_gap`) `no data` with the gap as tooltip, a cursor without another value `—` with the values window's reason, a failed request `—` with the message. Δ SHALL be computed only from two numbers and marked `lin` if either value is interpolated, else `hold` if either is held (`avg` only during a drag in an aggregated view). Origin: D-010 (SNA never a number); concept §5 (no invented values) and §6 (value kinds stay recognisable); `no data`: D-062.

#### Scenario: SNA in and outside the range
- **WHEN** a window shows SPEED_DISP from 2026-10-13T09:56:59Z to 09:57:01Z and A is set to 09:57:00Z; then a second, unlinked window shows 13:09:00Z–13:09:10Z
- **THEN** both windows' SPEED_DISP cells read `SNA`, the server's value at 09:57:00Z
- **Evidence:** UI check (screenshots); `apps/web/test/readout.test.ts` › "reads SNA, empty buckets and cursors outside the range without a number", "shows a failed request as — with the message, and Δ as —"

#### Scenario: Cursors in a gap
- **WHEN** on smart451 a window shows `STR_0D4h.STEER_ANGLE` and `ICL_3A2h.SPEED_DISP` from 2026-10-13 11:34:34 to 11:34:39 local, diff mode on, A at 11:34:36.6 (inside their dropout) and B at 11:34:38
- **THEN** both A cells read `no data` with a tooltip naming more than 3 periods without a point, both B cells a number, both Δ cells `—`; with A moved to 11:27:55 in a window over 11:27:45–11:28:05 the A cells read `no data` with a tooltip naming the logger
- **Evidence:** UI check (screenshots with tooltip); `apps/web/test/readout.test.ts` › "reads gaps as no data, and Δ as —"

### Requirement: Δt between the cursor flags
While diff mode is on and both cursor lines are drawn in a window, a label `Δt` with the signed exact Δt SHALL be drawn at the top of the plot between the flags "A" and "B"; when the gap is narrower than the label, it SHALL sit beside the right-hand flag. It SHALL NOT cover a flag. Origin: D-027 („Δt … readout on the chart next to the cursors").

#### Scenario: Wide and narrow gap
- **WHEN** diff mode is on in a window showing 2026-10-13T13:08:00Z–13:08:03Z, A is at 13:08:00.093Z and B at 13:08:00.995Z; then B is set to 13:08:00.100Z
- **THEN** the label `Δt +902 ms` sits between the flags; then `Δt +7 ms` sits right of the right-hand flag without covering either flag
- **Evidence:** UI check (two screenshots); `apps/web/test/cursors.test.ts` › "places the Δt label between the flags or beside the right one"

### Requirement: Compact legend rows
A timeseries window's legend row SHALL show the signal, its `[unit]` (tooltip: its y axis side), the readout cells, the loading state only while loading or failed, and the SNA share; nothing for a complete load. Removing a signal SHALL be a `×` at the row's end, visible while the pointer is on the row or on the `×` itself, or the button has keyboard focus. Origin: D-030 (Jan on the diff legend: "the hint wich axes can go", "the "complete" can go", "the remove can go"; × on row hover his pick).

#### Scenario: Diff legend on one line
- **WHEN** a window shows `DCU_1F4h.COMP_HV_Volt`, `ENG_2E8h.MOT_SPD_D` and `BRK_1A0h.WSPD_FL` from 2026-10-13 15:06:30 to 15:18:20 local, all loaded, with A at 15:10:50.3, B at 15:13:34.2 and diff mode on
- **THEN** each row reads name, `[unit]`, A, B, Δ and the SNA share, with no axis side, no `complete`, no `avg` and no `remove`; hovering a row shows its `×`, it stays while the pointer moves along the row onto it, and clicking it removes that signal
- **Evidence:** UI check (screenshot, and one with the pointer on a row)

### Requirement: Keys bring a cursor into view
Outside text fields and selects, without Ctrl, Meta or Alt, while no drag runs and the range picker is closed, Shift+A and Shift+B SHALL centre the bar target's span on cursor A or B (span kept) with one `window.setRange` and one history entry, as its strip flag does (time-strip "Cursor markers on the strip"); with that cursor off they SHALL do nothing. The Keys tab SHALL list them. Origin: D-095 (critic 13: Shift+A / Shift+B bring A or B into view).

#### Scenario: Key mapping
- **WHEN** the key handler gets `A` with Shift, `B` with Shift, `a` without Shift, `A` with Shift and Ctrl, `A` with Shift in the explorer search, and `A` with Shift while the range picker is open
- **THEN** `cursorA`, `cursorB`, nothing for the last four (lower-case `a` stays unbound)
- **Evidence:** `apps/web/test/keys.test.ts` › "maps Shift+A and Shift+B to bring a cursor into view"; `apps/web/test/hints.test.ts` › "keeps every hint within the wording rule" (`Shift+A` and `Shift+B` in `SHORTCUTS`)

#### Scenario: Keys on smart451
- **WHEN** at 1440×900 A is at 2026-10-13 15:09 local and B is off, window 1 shows a 20 min range on 2026-10-17, and the user presses Shift+A, then Shift+B, then Backspace
- **THEN** after Shift+A the range button shows a 20 min range centred on A (`26-10-13 14:59` and `0:20 h`), revision +1; Shift+B changes nothing (revision unchanged); Backspace returns to the range on 2026-10-17
- **Evidence:** UI check on smart451 (range button and revision after each key)
