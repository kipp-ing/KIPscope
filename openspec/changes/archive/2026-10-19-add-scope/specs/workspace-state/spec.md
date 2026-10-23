# workspace-state delta

## MODIFIED Requirements

### Requirement: Open replaces the workspace
The command `view.open` SHALL replace windows, link flag, colours, cursors, diff mode, options, measurement, event filter, events-line signals and scope with the view's, as one revision, following saved-views "Open a view" and "Open sets the scope". A view that resolves no scope SHALL leave the workspace without one. IDs SHALL never be reused within a server run. Origin: D-011 D8 (all changes are commands, so UI, CLI and later undo use the same action, concept §10); concept §8; scope: the ADX feedback item 3, D-078.

#### Scenario: Open through the command endpoint
- **WHEN** `POST /api/commands {type: "view.open", view: <v1 document>}` is sent, and once with `view: {kipscope: "view", version: 9}`
- **THEN** the first answers 200 with a `report`, the workspace shows the document's windows and `view.name` is absent; the second answers 422 `unsupported_version` and the revision is unchanged
- **Evidence:** `apps/server/test/views.http.test.ts` › "opens a view through the command endpoint"

#### Scenario: Open replaces the scope
- **WHEN** the workspace has scope {testcar, T1, T2} (T1 = 2026-10-01T01:00:00Z, T2 = 02:00:00Z), and `view.open` is applied with a document carrying `scope` {othercar, T1, T2}, then with a document with only a values window and no cursor
- **THEN** the scope is {othercar, T1, T2} after the first, and absent after the second
- **Evidence:** `packages/shared/test/apply.test.ts` › "opens a view into its scope"
