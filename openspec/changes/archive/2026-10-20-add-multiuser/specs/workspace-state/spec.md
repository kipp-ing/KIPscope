## MODIFIED Requirements

### Requirement: Server-held workspace
The server SHALL hold many workspaces (workspaces "Many workspaces"), each with: windows of kind `timeseries` or `values` with their signals and titles, each timeseries window's range, display options and plot height, each values window's "Between points" mode, the link flag, each signal's colour, cursors A and B with the diff flag, and the user options. Windows and signal assignments SHALL have stable IDs. Origin: D-011; D-017 (link); D-018 (title, height, colours); D-023 (values windows, cursors); D-026, concept §8 (options); many: D-083, Jan's „ja" to a workspace per case.

#### Scenario: Browser reload
- **WHEN** the browser reloads the page
- **THEN** it shows the same workspace (same `/w/<id>` address), the same windows, signals and time ranges as before, and the same titles, heights, link toggle and signal colours, the same values windows, the same cursors and diff mode, and the same digits option
- **Evidence:** UI check (screenshot before and after reload; "Rename" and "Taller window" in the timeseries-window spec cover title and height)

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
