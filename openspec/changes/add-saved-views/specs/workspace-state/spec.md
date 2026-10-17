## ADDED Requirements

### Requirement: Workspace survives a restart
The server SHALL write the open workspace and its revision to `<stateDir>/workspace.json` at most 500 ms after the last accepted command and at once on `SIGINT` or `SIGTERM`, replacing the file atomically. A failing write SHALL never fail a command. Origin: concept §8 („Speichern/Laden"); status.md Known limitations ("lost on restart").

#### Scenario: Debounced, atomic writes
- **WHEN** 20 commands are accepted within 100 ms on a fake clock, and 499 ms then 501 ms pass
- **THEN** nothing is written before 500 ms after the last command, exactly one write follows, and no `*.tmp` file is left in the dir
- **Evidence:** `apps/server/test/persist.test.ts` › "writes once after the last change"

### Requirement: Workspace restored at start
At start the server SHALL restore the state file's workspace whole, measurement included, and continue from its revision, without checking signals against the catalog; the project file's `measurement` section SHALL seed only a fresh workspace. A file that is not a valid state SHALL be moved to `workspace.bad.json` with one warning, and the server SHALL start fresh. Origin: concept §8; design S-3 (b), Jan 2026-10-17 („all recommended"), which supersedes D-051's „commands win until restart".

#### Scenario: Restart keeps the workspace
- **WHEN** a store with a temp state dir accepts 5 commands, `flush()` runs, and a new store is built from the same dir
- **THEN** the new store's workspace equals the old one (IDs, `nextId`, colours, cursors, view included) and its revision is 5; the next command gets revision 6
- **Evidence:** `apps/server/test/persist.test.ts` › "restores workspace and revision"

#### Scenario: Broken state file
- **WHEN** `workspace.json` holds `{"kipscope":"workspace","version":1,"revision":3,"workspace":{"windows":"x"}}` and the server starts
- **THEN** it starts at revision 0 with an empty workspace, `workspace.bad.json` holds that text, and one warning names the file
- **Evidence:** `apps/server/test/persist.test.ts` › "moves a broken state file aside"

#### Scenario: Restored measurement wins
- **WHEN** the server starts with a state file whose workspace has measurement `{name: "old", object: "keep?"}` and an open view, and the project file's `measurement` section says name `smart451 test`; then once more with no state file
- **THEN** the first start answers `GET /api/workspace` with measurement `{name: "old", object: "keep?"}` and `view.modified` as stored; the second with measurement name `smart451 test`
- **Evidence:** `apps/server/test/persist.test.ts` › "keeps the restored measurement"

#### Scenario: Dev server restart
- **WHEN** Jan's windows are open in the UI, `kipscope measurement name "restart check"` has run (a name other than the project file's), and `scripts/restart-server.sh` runs
- **THEN** after the reconnect the UI shows the same windows, ranges, cursors and colours, the footer still shows the measurement `restart check`, and the strip's revision is the one before the restart
- **Evidence:** UI check on smart451 (screenshots before and after; lead's manual check)

### Requirement: Open view in the workspace
The workspace SHALL hold the view it came from or was saved as: name (absent when opened from a link and not saved), title, note and a `modified` flag. `view.open` and `view.markSaved` SHALL set it with `modified` false; any other accepted command SHALL set `modified` true while a view is present. Origin: persona test (boss: a title); necessary consequence (the user must see whether the shown state is the saved one).

#### Scenario: Modified flag
- **WHEN** a view is opened, then `cursor.set` is applied, then `view.markSaved` with the same name, then a command is rejected
- **THEN** `view.modified` is false, true, false, and stays false after the rejected command
- **Evidence:** `packages/shared/test/apply.test.ts` › "marks the open view modified"

### Requirement: Open replaces the workspace
The command `view.open` SHALL replace windows, link flag, colours, cursors, diff mode, options, measurement, event filter and events-line signals with the view's, as one revision, following saved-views "Open a view". IDs SHALL never be reused within a server run. Origin: D-011 D8 (all changes are commands, so UI, CLI and later undo use the same action, concept §10); concept §8.

#### Scenario: Open through the command endpoint
- **WHEN** `POST /api/commands {type: "view.open", view: <v1 document>}` is sent, and once with `view: {kipscope: "view", version: 9}`
- **THEN** the first answers 200 with a `report`, the workspace shows the document's windows and `view.name` is absent; the second answers 422 `unsupported_version` and the revision is unchanged
- **Evidence:** `apps/server/test/views.http.test.ts` › "opens a view through the command endpoint"

### Requirement: View names only from the store
A view name in the workspace SHALL match the file-safe name rule and SHALL be set only by the view routes; `POST /api/commands` SHALL refuse `view.open` with a name, so a save in place can only write the file the view came from. Origin: round-1 review (spec owner's default, design V2); necessary consequence of saved-views "Save in place".

#### Scenario: No view name through the command endpoint
- **WHEN** `POST /api/commands {type: "view.open", name: "speeds", view: <v1 document>}` is sent while a view `speeds` is saved, and `applyCommand` gets `view.open` with `name: "_previous"` and with `name: "../x"`
- **THEN** the HTTP call answers 400 `invalid_command`, the revision and `speeds.yaml` are unchanged; both `applyCommand` calls fail `invalid_command`
- **Evidence:** `apps/server/test/views.http.test.ts` › "refuses a view name through the command endpoint"; `packages/shared/test/apply.test.ts` › "refuses a view name that is not file-safe"
