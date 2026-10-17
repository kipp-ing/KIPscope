# Spec Delta

## Purpose

Global cursors A and B mark absolute points in time across all windows, so that values, time differences and value differences can be read at the same moment everywhere. The UI and the CLI control them through the same workspace commands.

## ADDED Requirements

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
- **WHEN** A and B are on and the user wheel-zooms and Shift+wheel-pans window 1
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
