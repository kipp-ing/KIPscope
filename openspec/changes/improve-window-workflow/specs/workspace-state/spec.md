## MODIFIED Requirements

### Requirement: Server-held workspace
The server SHALL hold one open workspace consisting of windows, the signals assigned to each window, each window's time range, display options, title and plot height, the time-axis link flag and each signal's colour. Windows and signal assignments SHALL have stable IDs. Origin: D-011 (D8); D-017 (link flag), D-018 (title, height, colours).

#### Scenario: Browser reload
- **WHEN** the browser reloads the page
- **THEN** it shows the same windows, signals and time ranges as before, and the same titles, heights, link toggle and signal colours
- **Evidence:** UI check (screenshot before and after reload; "Rename" and "Taller window" in the timeseries-window delta cover title and height)

### Requirement: Changes only through commands
The workspace SHALL change only by applying commands. It SHALL support at least: create window, remove window, rename window, set window height, add signal to window, remove signal from window, move or copy a signal between windows, set window time range, set window display options, and link or unlink the windows' time axes. Origin: D-011 (D8); concept §7 (CLI controls window, signal and zoom actions); D-017, D-018 for the new commands.

#### Scenario: UI zoom is a command
- **WHEN** the user zooms a window in the UI
- **THEN** the UI sends a set-time-range command and the window's range changes only after the server accepts it

#### Scenario: Window workflow from the CLI
- **WHEN** a caller posts `window.rename`, `window.setHeight`, `window.moveSignal` and `workspace.setLinkTime` commands to `POST /api/commands`
- **THEN** each is accepted with a new revision and `GET /api/workspace` shows the renamed title, the new height, the moved signal and the flag
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "applies the window-workflow commands over HTTP"

## ADDED Requirements

### Requirement: Move and copy a signal between windows
A command SHALL move a signal assignment from one window to another, or copy it when asked. A move SHALL keep the assignment's ID; a copy SHALL create a new one. A target that already shows the signal (including the source itself) SHALL reject the command with `already_in_window`. A window emptied by a move SHALL stay. Origin: D-017 („Signale zwischen zwei anzeigen hin und her“); concept §4 and §7 (assign signals to windows, also by CLI).

#### Scenario: Move keeps ID and colour
- **WHEN** window `w1` shows assignment `a2` of signal S and `window.moveSignal {windowId: w1, assignmentId: a2, targetWindowId: w3}` is applied
- **THEN** `w1` no longer shows `a2`, `w3` ends with `{id: a2, signalId: S}`, and S's colour index is unchanged
- **Evidence:** `packages/shared/test/apply.test.ts` › "moves a signal keeping assignment ID and colour"

#### Scenario: Copy
- **WHEN** the same command is applied with `copy: true`
- **THEN** `w1` still shows `a2`, `w3` gets a new assignment whose ID is returned as `created`, and the distinct-signal count does not change
- **Evidence:** `packages/shared/test/apply.test.ts` › "copies a signal with a new assignment ID"

#### Scenario: Emptied window stays
- **WHEN** the only signal of a window is moved away
- **THEN** the window remains in the workspace with no signals
- **Evidence:** `packages/shared/test/apply.test.ts` › "keeps an emptied source window"

#### Scenario: Target already shows the signal
- **WHEN** the target window already shows signal S, or the target is the source window
- **THEN** the command is rejected with `already_in_window` and the revision does not change
- **Evidence:** `packages/shared/test/apply.test.ts` › "rejects a move into a window that already shows the signal"

### Requirement: Move into a new window
A move or copy without a target window SHALL create a new untitled window at the end with the source window's range, display options and height, and put the signal into it. Origin: D-017; drop zone "+ new window" from power-user expectations (feedback 2026-10-14, point 1), which needs this as one command.

#### Scenario: Move into a new window
- **WHEN** `window.moveSignal` is applied without `targetWindowId` on a source window in step mode with height 400
- **THEN** a new untitled window is appended with the source's range, step mode and height 400, holds the signal, and its ID is returned as `createdWindow`
- **Evidence:** `packages/shared/test/apply.test.ts` › "moves and copies into a new window with the source range and display"; `apps/server/test/workspace.http.test.ts` › "returns the created window and assignment of a move"

### Requirement: Linked time axes
The workspace SHALL hold a flag linking the time axes of all windows, on by default. While on, every accepted range change (`window.setRange`, `window.create` with a range) SHALL give all windows that range, and `window.create` without a range SHALL take it. While off, a range change SHALL affect only its window. Origin: D-017 ("Time zoom is shared across windows by default and can be switched off. This supersedes concept §4 'Der Zeitzoom ist je Fenster unabhängig' as the default.").

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
- **THEN** the new window has the existing window's range; without any window the command is rejected with `invalid_range`
- **Evidence:** `packages/shared/test/apply.test.ts` › "creates a window with the shared range while linked"

### Requirement: Switching the link
Switching the link flag on SHALL set all windows to the range of the window whose range was set last, or of the first window if that one no longer exists. Switching it off SHALL change no range. Origin: D-017 ("can be switched off"); snapping to the last zoomed window from power-user expectations (feedback 2026-10-14, point 3), needed so that "linked" always means equal ranges.

#### Scenario: Re-link snaps to the last zoomed window
- **WHEN** the flag is off, window 2 was zoomed last, and `workspace.setLinkTime {linked: true}` is applied
- **THEN** every window has window 2's range
- **Evidence:** `packages/shared/test/apply.test.ts` › "snaps all windows to the last zoomed window when linking"

### Requirement: Window title and height
A command SHALL rename a window; an empty title (after trimming) SHALL remove the title. An untitled window SHALL be named "Window <n>" after its stable ID `w<n>`, so its name does not drift. A command SHALL set a window's plot height between 120 and 1200 px; outside that range it SHALL be rejected. Origin: D-018 ("window rename", "resizable window heights"); concept §7 (windows changed by CLI).

#### Scenario: Rename and clear
- **WHEN** `window.rename {windowId: w6, title: "  HV voltages "}` and later `window.rename {windowId: w6, title: ""}` are applied
- **THEN** the title is first `HV voltages`, then absent, and the window is named `Window 6`
- **Evidence:** `packages/shared/test/apply.test.ts` › "renames and clears window titles"; `packages/shared/test/workspace.test.ts` › "titles untitled windows by ID"

#### Scenario: Height bounds
- **WHEN** `window.setHeight` is applied with 400, then with 100
- **THEN** the first sets height 400, the second is rejected with `invalid_command` and the height stays 400
- **Evidence:** `packages/shared/test/apply.test.ts` › "sets window height within bounds"

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
A window SHALL show signals of at most four units; a signal without unit counts as its own unit. `window.addSignal` and `window.moveSignal` (move or copy into an existing window) that would exceed four SHALL be rejected with `too_many_units` and a message naming the window's units. Origin: D-019 ("up to two per side (at most four units)"); rejection of the fifth unit is a necessary consequence, since every unit needs a drawn axis.

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

### Requirement: Time bounds in commands
Every time in a command SHALL lie between 1900-01-01T00:00:00Z and 2262-04-11T00:00:00Z inclusive; a command with a time outside SHALL be rejected with `invalid_command` and leave the workspace unchanged. Origin: necessary consequence of the bug "window range 1036-01-11 … 3937-05-09" (live window `w23` held `from = -29473328485867940608`, outside int64 ns; design "Bug analysis").

#### Scenario: Out-of-bounds range
- **WHEN** `window.setRange` is posted with `from: "-29473328485867940608"`
- **THEN** it is rejected with `invalid_command` naming the bounds and the revision does not change
- **Evidence:** `packages/shared/test/workspace.test.ts` › "rejects times outside 1900 … 2262"
