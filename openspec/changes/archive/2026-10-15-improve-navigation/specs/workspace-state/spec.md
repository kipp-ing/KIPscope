## ADDED Requirements

### Requirement: User options
The workspace SHALL hold user options; for now only `digits`, the number of significant digits (3 or 4, default 3). The command `workspace.setOptions {digits}` SHALL set it with one revision; any other value SHALL be rejected with `invalid_command` and leave the workspace unchanged. Origin: D-026 („4 significant digits are an option"); concept §8 (user options belong to the stored state; „Benutzeroptionen"); concept §7 (display options are controllable by CLI).

#### Scenario: Default and set
- **WHEN** the server starts, a caller reads the workspace, posts `{"type":"workspace.setOptions","digits":4}` and then `{"type":"workspace.setOptions","digits":5}`
- **THEN** `curl -s localhost:7310/api/workspace | jq -c .workspace.options` first prints `{"digits":3}`, then `{"digits":4}`; the second command is rejected with `invalid_command` and the revision does not change
- **Evidence:** `packages/shared/test/apply.test.ts` › "sets the digits option and rejects other values"; the `curl` commands after a server restart

## MODIFIED Requirements

### Requirement: Server-held workspace
The server SHALL hold one open workspace: windows of kind `timeseries` or `values` with their signals and titles, each timeseries window's range, display options and plot height, each values window's "Between points" mode, the link flag, each signal's colour, cursors A and B with the diff flag, and the user options. Windows and signal assignments SHALL have stable IDs. Origin: D-011 (D8); D-017 (link flag), D-018 (title, height, colours); D-023 (values windows, cursors); D-026 and concept §8 (user options).

#### Scenario: Browser reload
- **WHEN** the browser reloads the page
- **THEN** it shows the same windows, signals and time ranges as before, and the same titles, heights, link toggle and signal colours, the same values windows, the same cursors and diff mode, and the same digits option
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
