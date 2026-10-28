# workspace-state Specification

## Purpose
Holds the state of the open workspace on the server and changes it only through commands, so the UI and later the CLI operate the same view through the same actions.

## Requirements

### Requirement: Server-held workspace
The server SHALL hold many workspaces (workspaces "Many workspaces"), each with: windows of kind `timeseries` or `values` with their signals and titles, each timeseries window's range, display options and plot height, each values window's "Between points" mode, the link flag, each signal's colour, cursors A and B with the diff flag, and the user options. Windows and signal assignments SHALL have stable IDs. Origin: D-011; D-017 (link); D-018 (title, height, colours); D-023 (values windows, cursors); D-026, concept §8 (options); many: D-083, Jan's „ja" to a workspace per case.

#### Scenario: Browser reload
- **WHEN** the browser reloads the page
- **THEN** it shows the same workspace (same `/w/<id>` address), the same windows, signals and time ranges as before, and the same titles, heights, link toggle and signal colours, the same values windows, the same cursors and diff mode, and the same digits option
- **Evidence:** UI check (screenshot before and after reload; "Rename" and "Taller window" in the timeseries-window spec cover title and height)

### Requirement: Changes only through commands
The workspace SHALL change only by applying commands. It SHALL support at least: create a timeseries or values window, remove, rename, set height, add, remove, move or copy a signal, set time range, set display options, link or unlink the time axes, set, move or remove a cursor, switch diff mode, and set the user options. Origin: D-011 (D8); concept §7 (CLI controls windows, signals, zoom, cursors, diff mode and display options); D-017, D-018, D-023, D-026 for the newer commands.

#### Scenario: UI zoom is a command
- **WHEN** the user zooms a window in the UI, by wheel, keys or "Go to"
- **THEN** the UI sends a set-time-range command and the window's range changes only after the server accepts it

#### Scenario: Window workflow from the CLI
- **WHEN** a caller posts `window.rename`, `window.setHeight`, `window.moveSignal` and `workspace.setLinkTime` commands to `POST /api/commands`
- **THEN** each is accepted with a new revision and `GET /api/workspace` shows the renamed title, the new height, the moved signal and the flag
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "applies the window-workflow commands over HTTP"

#### Scenario: Cursors from the CLI
- **WHEN** a caller posts `window.create {kind: "values"}`, `cursor.set`, `cursor.move`, `cursor.setDiff` and `cursor.remove` to `POST /api/commands`
- **THEN** each is accepted with a new revision and `GET /api/workspace` shows the values window, the cursor times and the diff flag after each
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "applies cursor commands over HTTP"

#### Scenario: Options over HTTP
- **WHEN** a caller posts `workspace.setOptions {digits: 4}` to `POST /api/commands`
- **THEN** it is accepted with a new revision and `GET /api/workspace` shows `options.digits` `4`
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "applies the options command over HTTP"

### Requirement: Command results
Every command SHALL get a machine-readable result: accepted with the resulting revision, or rejected with an error code and message. A rejected command SHALL leave the workspace unchanged.

#### Scenario: Unknown window
- **WHEN** a command references a window ID that does not exist
- **THEN** the command is rejected with an error code and the revision does not change

### Requirement: Revisions
Each accepted command SHALL increase the workspace revision by one. The current state and revision SHALL be readable at any time.

#### Scenario: Read state
- **WHEN** a caller reads the workspace
- **THEN** it receives the full state together with the current revision

### Requirement: Render acknowledgement
Connected browsers SHALL report the highest revision of their workspace they have fully rendered, including whether its data loaded, also for revisions that change nothing visible. `GET /api/render-status` of a workspace SHALL return its current revision and every browser whose live connection to that workspace is open: client ID, user, connection time and its last acknowledgement (revision, `complete` or `error`, errors, time). Acknowledgements above the current revision SHALL be ignored. Origin: D-005, D-011 (D8); concept §7 (CLI wait); per workspace: workspaces "Many workspaces".

#### Scenario: Rendered after load
- **WHEN** a command adds a signal and the browser has loaded its data and drawn it
- **THEN** the server reports that revision as rendered with data complete
- **Evidence:** UI check via the CLI: `kipscope --wait signal add <w> smart451/BRK_1A0h.WSPD_FL` exits 0 with `render.status` `complete` (cli "Waiting for the open UI", scenario "Real UI")

#### Scenario: Rendered with load error
- **WHEN** the data for a revision failed to load
- **THEN** the server reports that revision as rendered with an error, not as complete
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "reports rendered revisions, complete and with errors" (server side; the browser side is unchanged since `add-timeseries-skeleton`)

#### Scenario: Render status over HTTP
- **WHEN** a client connects to `WS /api/live`, acknowledges revision R as `complete`, then R + 1 as `error` with one error, then revision 999 that does not exist, and finally disconnects
- **THEN** `GET /api/render-status` lists the client with R and `user` `local`, then with R + 1, `error` and that error, still R + 1 after the 999, and no longer lists it after the disconnect
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "reports rendered revisions, complete and with errors" (existing, extended by `user`)

#### Scenario: Clients of another workspace
- **WHEN** one client is connected to `/api/w/A/live` and one to `/api/w/B/live`, and `GET /api/w/A/render-status` is sent
- **THEN** it lists only the client of A, with A's revision
- **Evidence:** `apps/server/test/workspaces.http.test.ts` › "keeps render status per workspace"

#### Scenario: Revision without visible change
- **WHEN** the UI is open on real data and `kipscope --wait link off` and `kipscope --wait window rename <w> Speeds` run
- **THEN** both exit 0 with `render.status` `complete`
- **Evidence:** UI check (both CLI outputs)

### Requirement: Signal limit
A workspace SHALL contain at most 50 distinct signals across all windows. A command that would exceed the limit SHALL be rejected.

#### Scenario: 51st signal
- **WHEN** 50 distinct signals are shown and a command adds another one
- **THEN** the command is rejected with a limit error

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

### Requirement: Stable signal colours
Each signal in the workspace SHALL have one colour, the same in every window, kept when the signal is moved or copied and as long as it stays in at least one window. A signal entering the workspace SHALL get the palette colour used by the fewest signals present (lowest palette position on ties). Origin: D-018 ("stable signal colours across windows").

#### Scenario: Same signal, same colour
- **WHEN** signal S is added to window 1, signal T to window 2, and S is copied to window 2
- **THEN** S has the same colour index in both windows and T a different one
- **Evidence:** `packages/shared/test/apply.test.ts` › "assigns stable colours across windows"

#### Scenario: Colour freed
- **WHEN** S is removed from every window and signal U is added afterwards
- **THEN** S no longer has a colour entry and U gets the lowest free palette colour
- **Evidence:** `packages/shared/test/apply.test.ts` › "frees colours of signals that left the workspace"

### Requirement: At most four units per window
A timeseries window SHALL show signals of at most four units; a signal without unit counts as its own unit. `window.addSignal` and `window.moveSignal` (move or copy into an existing timeseries window) that would exceed four SHALL be rejected with `too_many_units` and a message naming the window's units. A values window has no unit limit. Origin: D-019 ("up to two per side (at most four units)"); D-023 (the unit limit does not apply to the values window).

#### Scenario: Fifth unit added
- **WHEN** a window shows `DCU_1F4h.COMP_HV_Volt` (V), `ICL_3A2h.SPEED_DISP` (km/h), `ENG_5E0h.T_ENG` (°C), `BRK_1A0h.WSPD_FL` (1/min) and `window.addSignal` adds `ENG_2E8h.MOT_SPD_D` (rpm/10ms)
- **THEN** the command is rejected with `too_many_units`, the message lists `V, km/h, °C, 1/min`, and the revision does not change; adding `DCU_2B8h.HTR_HV_Volt` (V) is accepted
- **Evidence:** `packages/shared/test/apply.test.ts` › "rejects a fifth unit in a window"; `apps/server/test/workspace.http.test.ts` › "answers too_many_units over HTTP"; `curl -s -X POST localhost:7310/api/commands -H 'content-type: application/json' -d '{"type":"window.addSignal","windowId":"<w>","signalId":"smart451/ENG_2E8h.MOT_SPD_D"}'` on such a window prints `"code":"too_many_units"`

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

### Requirement: Time bounds in commands
Every time in a command SHALL lie between 1900-01-01T00:00:00Z and 2262-04-11T00:00:00Z inclusive; a command with a time outside SHALL be rejected with `invalid_command` and leave the workspace unchanged. Origin: necessary consequence of the bug "window range 1036-01-11 … 3937-05-09" (live window `w23` held `from = -29473328485867940608`, outside int64 ns; design "Bug analysis").

#### Scenario: Out-of-bounds range
- **WHEN** `window.setRange` is posted with `from: "-29473328485867940608"`
- **THEN** it is rejected with `invalid_command` naming the bounds and the revision does not change
- **Evidence:** `packages/shared/test/workspace.test.ts` › "rejects times outside 1900 … 2262"

### Requirement: Commands by window kind
A values window SHALL accept rename, remove, add, remove, move or copy of signals, and `window.setDisplay` with `mode` `line` or `step` only. `window.setRange`, `window.setHeight`, and `window.setDisplay` with `envelope` or mode `markers` on a values window SHALL be rejected with `invalid_command` and leave the workspace unchanged. `window.create {kind: "values"}` SHALL NOT take `from`, `to` or `envelope`. Origin: necessary consequence of D-023 (a window kind without plot or time axis).

#### Scenario: Range on a values window
- **WHEN** `window.setRange`, `window.setHeight {height: 400}` and `window.setDisplay {envelope: true}` are applied to a values window
- **THEN** each is rejected with `invalid_command` and the revision does not change; `window.setDisplay {mode: "step"}` is accepted and sets its "Between points" mode to hold
- **Evidence:** `packages/shared/test/apply.test.ts` › "rejects range, height and envelope commands on a values window"

### Requirement: No duplicate signal in a window
`window.addSignal` SHALL reject a signal the target window already shows with `already_in_window`, for every window kind, and leave the workspace unchanged. Origin: power-user bug (feedback 2026-10-15, item 5: SPEED_DISP twice in one window); values-window "Signals into a values window" (a window already showing the signal refuses it); same code as workspace-state "Move and copy a signal between windows".

#### Scenario: Add SPEED_DISP twice
- **WHEN** a timeseries window and a values window each show `ICL_3A2h.SPEED_DISP` and `window.addSignal` adds SPEED_DISP to each again
- **THEN** both commands are rejected with `already_in_window` and the revision does not change
- **Evidence:** `packages/shared/test/apply.test.ts` › "rejects adding a signal the window already shows"

### Requirement: User options
The workspace SHALL hold user options; for now only `digits`, the number of significant digits (3 or 4, default 3). The command `workspace.setOptions {digits}` SHALL set it with one revision; any other value SHALL be rejected with `invalid_command` and leave the workspace unchanged. Origin: D-026 („4 significant digits are an option"); concept §8 (user options belong to the stored state; „Benutzeroptionen"); concept §7 (display options are controllable by CLI).

#### Scenario: Default and set
- **WHEN** the server starts, a caller reads the workspace, posts `{"type":"workspace.setOptions","digits":4}` and then `{"type":"workspace.setOptions","digits":5}`
- **THEN** `curl -s localhost:7310/api/workspace | jq -c .workspace.options` first prints `{"digits":3}`, then `{"digits":4}`; the second command is rejected with `invalid_command` and the revision does not change
- **Evidence:** `packages/shared/test/apply.test.ts` › "sets the digits option and rejects other values"; the `curl` commands after a server restart

### Requirement: Move and copy a signal
A command SHALL move a signal assignment from one window to another, or copy it when asked. A move SHALL keep the assignment's ID; a copy SHALL create a new one. A target that already shows the signal (including the source itself) SHALL reject the command with `already_in_window`. A window emptied by a move SHALL be removed ("Window emptied by a move is removed"). Origin: D-017 („Signale zwischen zwei anzeigen hin und her“); concept §4, §7; D-027.

#### Scenario: Move keeps ID and colour
- **WHEN** window `w1` shows assignment `a2` of signal S and `window.moveSignal {windowId: w1, assignmentId: a2, targetWindowId: w3}` is applied
- **THEN** `w1` no longer shows `a2`, `w3` ends with `{id: a2, signalId: S}`, and S's colour index is unchanged
- **Evidence:** `packages/shared/test/apply.test.ts` › "moves a signal keeping assignment ID and colour"

#### Scenario: Copy
- **WHEN** the same command is applied with `copy: true`
- **THEN** `w1` still shows `a2`, `w3` gets a new assignment whose ID is returned as `created`, and the distinct-signal count does not change
- **Evidence:** `packages/shared/test/apply.test.ts` › "copies a signal with a new assignment ID"

#### Scenario: Emptied window removed
- **WHEN** the only signal of a window is moved away
- **THEN** the window is no longer in the workspace and the result names it as `removedWindow`
- **Evidence:** `packages/shared/test/apply.test.ts` › "removes a window emptied by a move"

#### Scenario: Target already shows the signal
- **WHEN** the target window already shows signal S, or the target is the source window
- **THEN** the command is rejected with `already_in_window` and the revision does not change
- **Evidence:** `packages/shared/test/apply.test.ts` › "rejects a move into a window that already shows the signal"

### Requirement: Window emptied by a move is removed
A `window.moveSignal` without `copy` that takes the last signal out of its source window SHALL remove that window, of any kind, in the same command and revision, exactly as `window.remove` would (including clearing `lastZoomed` when it named that window). The result SHALL carry `removedWindow` with its ID. A copy, `window.removeSignal` and a rejected move SHALL NOT remove a window. Origin: D-027 („A window emptied by a move is removed automatically").

#### Scenario: Last signal into another window
- **WHEN** timeseries window `w1` shows only `a2` and `w3` exists, and `window.moveSignal {windowId: w1, assignmentId: a2, targetWindowId: w3}` is applied
- **THEN** the revision rises by exactly one, `w1` is gone, `w3` shows `a2`, and the result is `{ok: true, revision, removedWindow: "w1"}`
- **Evidence:** `packages/shared/test/apply.test.ts` › "removes a window emptied by a move"

#### Scenario: Values window emptied
- **WHEN** a values window shows one signal and it is moved into a timeseries window
- **THEN** the values window is gone and named as `removedWindow`
- **Evidence:** `packages/shared/test/apply.test.ts` › "removes a window emptied by a move"

#### Scenario: Only signal into a new window
- **WHEN** timeseries window `w1` in step mode with height 400 shows only `a2`, and `window.moveSignal` without `targetWindowId` is applied
- **THEN** one revision later a new window with `w1`'s range, step mode and height 400 shows `a2`, `w1` is gone, and the result carries both `createdWindow` (the new ID) and `removedWindow: "w1"`
- **Evidence:** `packages/shared/test/apply.test.ts` › "moves the only signal into a new window and removes the source"

#### Scenario: Copy, remove and refused moves keep the window
- **WHEN** a window's only signal is copied elsewhere; another window's only signal is removed with `window.removeSignal`; and a third window's only signal is moved into a window that already shows it
- **THEN** all three windows stay (the second with no signals), no result carries `removedWindow`, and the refused move leaves the revision unchanged
- **Evidence:** `packages/shared/test/apply.test.ts` › "keeps a window emptied by removeSignal, a copy or a refused move"

#### Scenario: Window zoomed last is emptied
- **WHEN** "Link time axes" is off, `w1` and `w2` have different ranges, `w1` was zoomed last, and `w1`'s only signal is moved into `w2`
- **THEN** `w1` is gone, `lastZoomed` is absent, and `w2` keeps its range
- **Evidence:** `packages/shared/test/apply.test.ts` › "clears lastZoomed when a move removes that window"

#### Scenario: Over HTTP
- **WHEN** a caller posts such an emptying `window.moveSignal` to `POST /api/commands`
- **THEN** the answer is `{ok: true, revision, removedWindow: "<id>"}` and `GET /api/workspace` no longer lists that window
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "returns the window a move removed"

### Requirement: Window limit
A workspace SHALL hold at most 64 windows of both kinds together. A `window.create` beyond that SHALL be rejected with code `window_limit` and change nothing. Origin: necessary consequence: an unbounded loop of a script or AI client (concept §7) would grow server memory and the pushed state without limit. Number: design H4.

#### Scenario: 65th window
- **WHEN** 64 windows exist and `window.create` is applied, once as timeseries and once as values
- **THEN** both are rejected with `window_limit`, and the workspace still has 64 windows
- **Evidence:** `packages/shared/test/apply.test.ts` › "rejects a 65th window with window_limit"

### Requirement: Window title trimmed on create
`window.create` SHALL store its title trimmed, like `window.rename`; a title that is empty after trimming SHALL leave the window without a title. Origin: necessary consequence of "Window title and height" (rename trims; a blank stored title shows an empty header). Design H8.

#### Scenario: Blank and padded titles
- **WHEN** `window.create` is applied with title `"  "` and with title `"  Speeds "`
- **THEN** the first window has no `title`, the second the title `Speeds`
- **Evidence:** `packages/shared/test/apply.test.ts` › "trims the title on window.create"

### Requirement: Listeners cannot fail a command
An accepted command SHALL return its result and reach every live client even when pushing the state to one of them throws; the error SHALL be reported to the server log. Origin: necessary consequence of "Command results" (a command applied but answered 500 leaves the caller unsure whether it was applied). Design H8.

#### Scenario: Throwing listener
- **WHEN** a workspace store has three listeners, the second throws, and a valid command is executed
- **THEN** the result is accepted with the new revision, the first and third listeners got that revision, and the error callback got the thrown error
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "a throwing listener neither fails the command nor starves later listeners"

### Requirement: State pushes name their command
Every state message the live channel sends after a command SHALL carry that command's type; the state sent on connect SHALL carry none. Origin: necessary consequence of D-042 (1) („setting the same range again also retries"): the UI can only tell a range command that left the range unchanged from an unrelated revision by its type. Design H7.

#### Scenario: Push after a range command
- **WHEN** a live client connects and then `window.setRange` is posted for an existing window with its current range
- **THEN** the first state message has no `command`, and the next has `command` `window.setRange` and the new revision
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "names the command type in state pushes"

### Requirement: Bounded render acknowledgements
A render acknowledgement SHALL carry at most 50 errors, each message at most 500 characters and each window or signal ID at most 200 characters; the server SHALL ignore one that exceeds this. The UI SHALL send at most the first 50 errors, each message cut to 500 characters, so its acknowledgements are never ignored. Origin: necessary consequence of "Render acknowledgement" (the server stores errors per client). Numbers: design H4.

#### Scenario: Server ignores oversized acknowledgements
- **WHEN** `RenderedMessage` parses an acknowledgement with 51 errors, one with a 501-character message, and one with 50 errors of 500 characters
- **THEN** the first two fail and the third passes
- **Evidence:** `packages/shared/test/workspace.test.ts` › "bounds render acknowledgements"

#### Scenario: UI caps its acknowledgement
- **WHEN** the acknowledger builds the message for one window reporting 70 errors, one with a 2,000-character message
- **THEN** the message has 50 errors, every message at most 500 characters, status `error`, and parses as `RenderedMessage`
- **Evidence:** `apps/web/test/ack.test.ts` › "caps errors and message lengths"

### Requirement: Acknowledgement survives a reconnect
The UI SHALL treat an acknowledgement as sent only when the live channel took it, and SHALL acknowledge the current revision again after the live channel opens, also when the revision did not change meanwhile. Origin: concept §7 („ob … die offene Oberfläche den Zustand dargestellt hat"); necessary consequence: today an acknowledgement dropped while disconnected is never repeated and `--wait` times out. Design H6.

#### Scenario: Settled while disconnected
- **WHEN** both windows report revision 7 while the send function returns false, and then the channel reconnects with revision still 7
- **THEN** no acknowledgement counted as sent before the reconnect, and right after it one acknowledgement for revision 7 is sent
- **Evidence:** `apps/web/test/ack.test.ts` › "acknowledges again after a reconnect"

#### Scenario: Same report not repeated
- **WHEN** both windows report revision 7 with no errors twice while connected
- **THEN** exactly one acknowledgement is sent
- **Evidence:** `apps/web/test/ack.test.ts` › "sends one acknowledgement per revision and error list"

#### Scenario: Wait after a server restart on real data
- **WHEN** the UI is open, the lead restarts the server with `scripts/restart-server.sh`, rebuilds a window with the CLI, and runs `kipscope --wait link off`
- **THEN** the CLI exits 0 with `render.status` `complete`
- **Evidence:** lead's manual check (CLI output; restarts are the lead's job)

### Requirement: Failed commands are shown
A command the UI sends SHALL never leave an unhandled failure: a network failure, a non-JSON answer or a body that is not a command result SHALL become a rejected result with code `network` or `bad_response` and a message, shown in the UI's message line like any rejected command. A refusal of the access guard (add-multiuser M6, e.g. `read_only`, `forbidden`) keeps its own code and message. Origin: concept §10 („Fehler … müssen erkennbar bleiben"). Design H6.

#### Scenario: Network failure and proxy page
- **WHEN** `sendCommand` meets a rejected `fetch`, a 502 with an HTML body, and a 200 with body `{"foo":1}`
- **THEN** it resolves to `{ok: false}` with codes `network`, `bad_response` and `bad_response`, each with a message naming the cause (the second names HTTP 502)
- **Evidence:** `apps/web/test/api.test.ts` › "sendCommand resolves every failure to a rejected result"

#### Scenario: Server down in the UI
- **WHEN** the lead stops the KIPscope server while the UI is open and renames a window
- **THEN** the message line shows a `network` or `bad_response` error, the browser console shows no unhandled rejection, and the page keeps working after the server is back
- **Evidence:** lead's manual check (screenshot of the message line)

### Requirement: Events-line signals in the workspace
The workspace SHALL hold the events-line signals as `eventSignals` (IDs in order, absent when empty, at most 8), starting from the project file. `events.addSignal {signalId}` SHALL append one or be rejected with `unknown_signal`, `not_state_signal`, `already_listed` or `event_signal_limit`; `events.removeSignal {signalId}` SHALL remove one or be rejected with `not_listed`. Origin: D-059 („drags a signal with stats to horizon"; yaml start); D-051 pattern; 8: design E8.

#### Scenario: Add and remove
- **WHEN** on a workspace without `eventSignals`, with a context where `testcar/Ign_A20h.MODE` has states, `testcar/Fast_100h.SIG_A` has none and `testcar/Nope.X` is unknown, these are applied: add MODE, add MODE, add SIG_A, add Nope.X, remove Nope.X, remove MODE; and add to a list of 8
- **THEN** `eventSignals` `["testcar/Ign_A20h.MODE"]`; `already_listed`; `not_state_signal`; `unknown_signal`; `not_listed`; the field absent again; `event_signal_limit`
- **Evidence:** `packages/shared/test/apply.test.ts` › "adds and removes events-line signals"

#### Scenario: Start value and HTTP
- **WHEN** the test server starts with a project file listing `testcar/Ign_A20h.MODE`, and a caller posts `events.addSignal` for `testcar/DIAG.door` and reads `GET /api/workspace`
- **THEN** the command is accepted with a new revision and `eventSignals` is `["testcar/Ign_A20h.MODE","testcar/DIAG.door"]`
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "applies the events commands over HTTP"

### Requirement: Workspace survives a restart
The server SHALL write each workspace and its revision to `<stateDir>/workspaces/<id>.json` at most 500 ms after its last accepted command and at once on `SIGINT` or `SIGTERM`, replacing the file atomically. A failing write SHALL never fail a command. Origin: concept §8 („Speichern/Laden"); status.md Known limitations ("lost on restart"); per workspace: workspaces "Workspaces survive a restart".

#### Scenario: Debounced, atomic writes
- **WHEN** 20 commands are accepted for one workspace within 100 ms on a fake clock, and 499 ms then 501 ms pass
- **THEN** nothing is written before 500 ms after the last command, exactly one write of that workspace's file follows, and no `*.tmp` file is left in the dir
- **Evidence:** `apps/server/test/persist.test.ts` › "writes once after the last change"

### Requirement: Workspace restored at start
At start the server SHALL restore each workspace whole, measurement included, and continue from its revision, without checking signals against the catalog; the project file's `measurement` section and events-line signals SHALL seed only a new workspace. A file that is not a valid workspace file SHALL be moved aside with one warning (workspaces "Workspaces survive a restart"), and the other workspaces SHALL start as stored. Origin: concept §8; design S-3 (b), Jan 2026-10-17 („all recommended"), which supersedes D-051's „commands win until restart"; per workspace: D-083.

#### Scenario: Restart keeps the workspace
- **WHEN** a workspace registry with a temp state dir accepts 5 commands on one workspace, `flush()` runs, and a new registry is built from the same dir
- **THEN** the workspace equals the old one (IDs, `nextId`, colours, cursors, view included) and its revision is 5; the next command gets revision 6
- **Evidence:** `apps/server/test/persist.test.ts` › "restores workspace and revision"

#### Scenario: Broken state file
- **WHEN** `workspaces/aaaaaaaaaa.json` holds `{"kipscope":"workspace","version":2,"id":"aaaaaaaaaa","owner":"local","share":"private","grant":{"objects":"all"},"createdAt":"2026-10-19T08:00:00Z","lastActiveAt":"2026-10-19T08:00:00Z","revision":3,"workspace":{"windows":"x"}}` and the server starts
- **THEN** no workspace `aaaaaaaaaa` exists, `aaaaaaaaaa.bad.json` holds that text, and one warning names the file
- **Evidence:** `apps/server/test/persist.test.ts` › "moves a broken state file aside"

#### Scenario: Restored measurement wins
- **WHEN** the server starts with a workspace file whose workspace has measurement `{name: "old", object: "keep?"}` and an open view, and the project file's `measurement` section says name `smart451 test`; then a new workspace is created
- **THEN** `GET /api/w/<restored>/workspace` has measurement `{name: "old", object: "keep?"}` and `view.modified` as stored; the new workspace has measurement name `smart451 test`
- **Evidence:** `apps/server/test/persist.test.ts` › "keeps the restored measurement"

#### Scenario: Dev server restart
- **WHEN** Jan's windows are open in the UI, `kipscope measurement name "restart check"` has run (a name other than the project file's), and `scripts/restart-server.sh` runs
- **THEN** after the reconnect the UI shows the same workspace address, windows, ranges, cursors and colours, the footer still shows the measurement `restart check`, and the strip's revision is the one before the restart
- **Evidence:** UI check on smart451 (screenshots before and after; lead's manual check)

### Requirement: Open view in the workspace
The workspace SHALL hold the view it came from or was saved as: name (absent when opened from a link and not saved), title, note and a `modified` flag. `view.open` and `view.markSaved` SHALL set it with `modified` false; any other accepted command SHALL set `modified` true while a view is present. Origin: persona test (boss: a title); necessary consequence (the user must see whether the shown state is the saved one).

#### Scenario: Modified flag
- **WHEN** a view is opened, then `cursor.set` is applied, then `view.markSaved` with the same name, then a command is rejected
- **THEN** `view.modified` is false, true, false, and stays false after the rejected command
- **Evidence:** `packages/shared/test/apply.test.ts` › "marks the open view modified"

### Requirement: Open replaces the workspace
The command `view.open` SHALL replace windows, link flag, colours, cursors, diff mode, options, measurement, event filter, events-line signals, computed signals (each with a new ID) and scope with the view's, as one revision, following saved-views "Open a view" and "Open sets the scope". A view that resolves no scope SHALL leave the workspace without one. IDs SHALL never be reused within a server run. Origin: D-011 D8 (all changes are commands, so UI, CLI and later undo use the same action, concept §10); concept §8; scope: the ADX feedback item 3, D-078.

#### Scenario: Open through the command endpoint
- **WHEN** `POST /api/commands {type: "view.open", view: <v1 document>}` is sent, and once with `view: {kipscope: "view", version: 9}`
- **THEN** the first answers 200 with a `report`, the workspace shows the document's windows and `view.name` is absent; the second answers 422 `unsupported_version` and the revision is unchanged
- **Evidence:** `apps/server/test/views.http.test.ts` › "opens a view through the command endpoint"

#### Scenario: Open replaces the scope
- **WHEN** the workspace has scope {testcar, T1, T2} (T1 = 2026-10-01T01:00:00Z, T2 = 02:00:00Z), and `view.open` is applied with a document carrying `scope` {othercar, T1, T2}, then with a document with only a values window and no cursor
- **THEN** the scope is {othercar, T1, T2} after the first, and absent after the second
- **Evidence:** `packages/shared/test/apply.test.ts` › "opens a view into its scope"

### Requirement: View names only from the store
A view name in the workspace SHALL match the file-safe name rule and SHALL be set only by the view routes; `POST /api/commands` SHALL refuse `view.open` with a name, so a save in place can only write the file the view came from. Origin: round-1 review (spec owner's default, design V2); necessary consequence of saved-views "Save in place".

#### Scenario: No view name through the command endpoint
- **WHEN** `POST /api/commands {type: "view.open", name: "speeds", view: <v1 document>}` is sent while a view `speeds` is saved, and `applyCommand` gets `view.open` with `name: "_previous"` and with `name: "../x"`
- **THEN** the HTTP call answers 400 `invalid_command`, the revision and `speeds.yaml` are unchanged; both `applyCommand` calls fail `invalid_command`
- **Evidence:** `apps/server/test/views.http.test.ts` › "refuses a view name through the command endpoint"; `packages/shared/test/apply.test.ts` › "refuses a view name that is not file-safe"
