## MODIFIED Requirements

### Requirement: Server-held workspace
The server SHALL hold one open workspace: windows of kind `timeseries` or `values` with their signals and titles, each timeseries window's range, display options and plot height, each values window's "Between points" mode, the link flag, each signal's colour, and cursors A and B with the diff flag. Windows and signal assignments SHALL have stable IDs. Origin: D-011 (D8); D-017 (link flag), D-018 (title, height, colours); D-023 (values windows, cursors).

#### Scenario: Browser reload
- **WHEN** the browser reloads the page
- **THEN** it shows the same windows, signals and time ranges as before, and the same titles, heights, link toggle and signal colours, the same values windows and the same cursors and diff mode
- **Evidence:** UI check (screenshot before and after reload; "Rename" and "Taller window" in the timeseries-window delta cover title and height)

### Requirement: Changes only through commands
The workspace SHALL change only by applying commands. It SHALL support at least: create a timeseries or values window, remove, rename, set height, add, remove, move or copy a signal, set time range, set display options, link or unlink the time axes, set, move or remove a cursor, and switch diff mode. Origin: D-011 (D8); concept §7 (CLI controls windows, signals, zoom, cursors and diff mode); D-017, D-018, D-023 for the newer commands.

#### Scenario: UI zoom is a command
- **WHEN** the user zooms a window in the UI
- **THEN** the UI sends a set-time-range command and the window's range changes only after the server accepts it

#### Scenario: Window workflow from the CLI
- **WHEN** a caller posts `window.rename`, `window.setHeight`, `window.moveSignal` and `workspace.setLinkTime` commands to `POST /api/commands`
- **THEN** each is accepted with a new revision and `GET /api/workspace` shows the renamed title, the new height, the moved signal and the flag
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "applies the window-workflow commands over HTTP"

#### Scenario: Cursors from the CLI
- **WHEN** a caller posts `window.create {kind: "values"}`, `cursor.set`, `cursor.move`, `cursor.setDiff` and `cursor.remove` to `POST /api/commands`
- **THEN** each is accepted with a new revision and `GET /api/workspace` shows the values window, the cursor times and the diff flag after each
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "applies cursor commands over HTTP"

### Requirement: Linked time axes
The workspace SHALL hold a flag linking the time axes of all timeseries windows, on by default. While on, every accepted range change (`window.setRange`, `window.create` with a range) SHALL give all timeseries windows that range, and a timeseries `window.create` without a range SHALL take it. While off, a range change SHALL affect only its window. Values windows have no range. Origin: D-017 ("Time zoom is shared across windows by default and can be switched off."); D-023 (values windows).

#### Scenario: Default is linked
- **WHEN** the server starts and a caller reads the workspace
- **THEN** `linkTime` is `true`
- **Evidence:** `packages/shared/test/apply.test.ts` › "applies a range to all windows while linked" (asserts `linkTime` is `true` on a fresh workspace); Jan's hand check: `curl -s localhost:7310/api/workspace | jq .workspace.linkTime` prints `true` after a server restart

#### Scenario: Range change while linked
- **WHEN** three windows exist, the flag is on, and `window.setRange` is applied to the second
- **THEN** all three windows have that range, applied as one command (one revision, per "Revisions")
- **Evidence:** `packages/shared/test/apply.test.ts` › "applies a range to all windows while linked"

#### Scenario: Range change while unlinked
- **WHEN** the flag is off and `window.setRange` is applied to window 1 of 2
- **THEN** window 2 keeps its range
- **Evidence:** `packages/shared/test/apply.test.ts` › "applies a range to one window while unlinked"

#### Scenario: New window while linked
- **WHEN** the flag is on, one window exists, and `window.create` is applied without `from`/`to`
- **THEN** the new window has the existing window's range; without any timeseries window the command is rejected with `invalid_range`
- **Evidence:** `packages/shared/test/apply.test.ts` › "creates a window with the shared range while linked"

#### Scenario: Values windows stay without range
- **WHEN** the flag is on, a values window comes first and a timeseries window second, `window.setRange` is applied to the timeseries window, and then a timeseries `window.create` without range
- **THEN** the values window still has no range, and the new window takes the timeseries window's range
- **Evidence:** `packages/shared/test/apply.test.ts` › "keeps values windows out of linked ranges"

### Requirement: Switching the link
Switching the link flag on SHALL set all timeseries windows to the range of the window whose range was set last, or of the first timeseries window if that one no longer exists. Switching it off SHALL change no range. Origin: D-017 ("can be switched off"); snapping to the last zoomed window from power-user expectations (feedback 2026-10-14, point 3), needed so that "linked" always means equal ranges.

#### Scenario: Re-link snaps to the last zoomed window
- **WHEN** the flag is off, window 2 was zoomed last, and `workspace.setLinkTime {linked: true}` is applied
- **THEN** every window has window 2's range
- **Evidence:** `packages/shared/test/apply.test.ts` › "snaps all windows to the last zoomed window when linking"

### Requirement: Move into a new window
A move or copy without a target window SHALL create a new untitled timeseries window at the end and put the signal into it. From a timeseries window it SHALL take the source's range, display options and height. From a values window it SHALL take the range of the window zoomed last, else of the first timeseries window, with default display and height, and be rejected with `invalid_range` if neither exists. Origin: D-017; feedback 2026-10-14, point 1; D-023 (values rows are drag sources).

#### Scenario: Move into a new window
- **WHEN** `window.moveSignal` is applied without `targetWindowId` on a source window in step mode with height 400
- **THEN** a new untitled window is appended with the source's range, step mode and height 400, holds the signal, and its ID is returned as `createdWindow`
- **Evidence:** `packages/shared/test/apply.test.ts` › "moves and copies into a new window with the source range and display"; `apps/server/test/workspace.http.test.ts` › "returns the created window and assignment of a move"

#### Scenario: From a values window
- **WHEN** `window.moveSignal` without `targetWindowId` is applied to a values window's assignment while timeseries windows `w1` and `w3` exist and `w3` was zoomed last; and again on a workspace with only the values window
- **THEN** the first creates a timeseries window with `w3`'s range, line mode, no envelope and default height; the second is rejected with `invalid_range` and the revision does not change
- **Evidence:** `packages/shared/test/apply.test.ts` › "moves a signal from a values window into a new timeseries window"

### Requirement: At most four units per window
A timeseries window SHALL show signals of at most four units; a signal without unit counts as its own unit. `window.addSignal` and `window.moveSignal` (move or copy into an existing timeseries window) that would exceed four SHALL be rejected with `too_many_units` and a message naming the window's units. A values window has no unit limit. Origin: D-019 ("up to two per side (at most four units)"); D-023 (the unit limit does not apply to the values window).

#### Scenario: Fifth unit added
- **WHEN** a window shows `CPC_168h.EAC_HV_Volt` (V), `COMBI_412h.V_ANZ` (km/h), `MS_608h.T_MOT` (°C), `BS_200h.DVL` (1/min) and `window.addSignal` adds `MS_312h.DNMOT` (rpm/10ms)
- **THEN** the command is rejected with `too_many_units`, the message lists `V, km/h, °C, 1/min`, and the revision does not change; adding `CPC_448h.PTC_HV_Volt` (V) is accepted
- **Evidence:** `packages/shared/test/apply.test.ts` › "rejects a fifth unit in a window"; `apps/server/test/workspace.http.test.ts` › "answers too_many_units over HTTP"; `curl -s -X POST localhost:7310/api/commands -H 'content-type: application/json' -d '{"type":"window.addSignal","windowId":"<w>","signalId":"smart451/MS_312h.DNMOT"}'` on such a window prints `"code":"too_many_units"`

#### Scenario: Unit-less signals
- **WHEN** a window holds four signals without unit and a fifth one without unit is added or moved in
- **THEN** the command is rejected with `too_many_units`
- **Evidence:** `packages/shared/test/apply.test.ts` › "counts unit-less signals as their own unit"

#### Scenario: Move of a fifth unit
- **WHEN** `window.moveSignal` would bring a fifth unit into an existing target window
- **THEN** it is rejected with `too_many_units`; without a target (new window) it is accepted
- **Evidence:** `packages/shared/test/apply.test.ts` › "rejects a fifth unit in a window"

#### Scenario: Values window without limit
- **WHEN** the same five signals are added to a values window, or moved into it
- **THEN** all commands are accepted
- **Evidence:** `packages/shared/test/apply.test.ts` › "adds any number of units to a values window"

### Requirement: Window title and height
A command SHALL rename a window; an empty title (after trimming) SHALL remove the title. An untitled window SHALL be named after its stable ID `w<n>`: "Window <n>" for a timeseries window, "Values <n>" for a values window, so its name does not drift. A command SHALL set a timeseries window's plot height between 120 and 1200 px; outside that range it SHALL be rejected. Origin: D-018 ("window rename", "resizable window heights"); concept §7 (windows changed by CLI); D-023 (values windows).

#### Scenario: Rename and clear
- **WHEN** `window.rename {windowId: w6, title: "  HV voltages "}` and later `window.rename {windowId: w6, title: ""}` are applied
- **THEN** the title is first `HV voltages`, then absent, and the window is named `Window 6`
- **Evidence:** `packages/shared/test/apply.test.ts` › "renames and clears window titles"; `packages/shared/test/workspace.test.ts` › "titles untitled windows by ID"

#### Scenario: Height bounds
- **WHEN** `window.setHeight` is applied with 400, then with 100
- **THEN** the first sets height 400, the second is rejected with `invalid_command` and the height stays 400
- **Evidence:** `packages/shared/test/apply.test.ts` › "sets window height within bounds"

#### Scenario: Untitled values window
- **WHEN** a values window `w7` has no title
- **THEN** it is named `Values 7`
- **Evidence:** `packages/shared/test/workspace.test.ts` › "titles untitled windows by ID"

## ADDED Requirements

### Requirement: Commands by window kind
A values window SHALL accept rename, remove, add, remove, move or copy of signals, and `window.setDisplay` with `mode` `line` or `step` only. `window.setRange`, `window.setHeight`, and `window.setDisplay` with `envelope` or mode `markers` on a values window SHALL be rejected with `invalid_command` and leave the workspace unchanged. `window.create {kind: "values"}` SHALL NOT take `from`, `to` or `envelope`. Origin: necessary consequence of D-023 (a window kind without plot or time axis).

#### Scenario: Range on a values window
- **WHEN** `window.setRange`, `window.setHeight {height: 400}` and `window.setDisplay {envelope: true}` are applied to a values window
- **THEN** each is rejected with `invalid_command` and the revision does not change; `window.setDisplay {mode: "step"}` is accepted and sets its "Between points" mode to hold
- **Evidence:** `packages/shared/test/apply.test.ts` › "rejects range, height and envelope commands on a values window"

### Requirement: No duplicate signal in a window
`window.addSignal` SHALL reject a signal the target window already shows with `already_in_window`, for every window kind, and leave the workspace unchanged. Origin: power-user bug (feedback 2026-10-15, item 5: V_ANZ twice in one window); values-window "Signals into a values window" (a window already showing the signal refuses it); same code as workspace-state "Move and copy a signal between windows".

#### Scenario: Add V_ANZ twice
- **WHEN** a timeseries window and a values window each show `COMBI_412h.V_ANZ` and `window.addSignal` adds V_ANZ to each again
- **THEN** both commands are rejected with `already_in_window` and the revision does not change
- **Evidence:** `packages/shared/test/apply.test.ts` › "rejects adding a signal the window already shows"
