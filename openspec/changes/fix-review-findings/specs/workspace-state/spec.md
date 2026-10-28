## MODIFIED Requirements

### Requirement: View names only from the store
A view name in the workspace SHALL match the file-safe name rule and SHALL be set only by the view routes; `POST /api/commands` SHALL refuse `view.open` with a name, and SHALL refuse `view.markSaved` in any form, with 400 `invalid_command`, so a save in place can only write the file the view came from. Origin: round-1 review (spec owner's default, design V2); necessary consequence of saved-views "Save in place"; `view.markSaved`: review day 2026-10-28 T-02 (through the command endpoint any caller could make a workspace claim any view name, and "Save" then overwrote that view with `overwrite: true` and no "Replace?" prompt).

#### Scenario: No view name through the command endpoint
- **WHEN** `POST /api/commands {type: "view.open", name: "speeds", view: <v1 document>}` is sent while a view `speeds` is saved, and `applyCommand` gets `view.open` with `name: "_previous"` and with `name: "../x"`
- **THEN** the HTTP call answers 400 `invalid_command`, the revision and `speeds.yaml` are unchanged; both `applyCommand` calls fail `invalid_command`
- **Evidence:** `apps/server/test/views.http.test.ts` › "refuses a view name through the command endpoint"; `packages/shared/test/apply.test.ts` › "refuses a view name that is not file-safe"

#### Scenario: No markSaved through the command endpoint
- **WHEN** a view `speeds` is saved, the workspace has no open view, and `POST /api/commands {type: "view.markSaved", name: "speeds", title: "Speeds"}` is sent; then `POST /api/views {title: "Mine"}` is sent
- **THEN** the command answers 400 `invalid_command`; the revision, `GET /api/workspace`'s `workspace.view` (absent) and `speeds.yaml` are unchanged; the save answers 200 and the workspace's `view.name` is `mine` (the view route still marks its own save)
- **Evidence:** `apps/server/test/views.http.test.ts` › "refuses markSaved through the command endpoint"
