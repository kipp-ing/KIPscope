## MODIFIED Requirements

### Requirement: User options
The workspace SHALL hold user options: `digits`, the number of significant digits (3 or 4, default 3), and `names`, what signals show (`shown` or `source`, default `shown`; signal-aliases). The command `workspace.setOptions {digits?, names?}` SHALL set the given options with one revision; any other value SHALL be rejected with `invalid_command` and leave the workspace unchanged. A stored workspace without `names` SHALL read with `shown`. Origin: D-026 („4 significant digits are an option"); concept §8 (user options belong to the stored state; „Benutzeroptionen"); concept §7 (display options are controllable by CLI); `names`: Jan (2026-11-06, „umschaltbar, das mag jeder anders").

#### Scenario: Default and set
- **WHEN** the server starts, a caller reads the workspace, posts `{"type":"workspace.setOptions","digits":4}` and then `{"type":"workspace.setOptions","digits":5}`
- **THEN** `curl -s localhost:7310/api/workspace | jq -c .workspace.options` first prints `{"digits":3,"names":"shown"}`, then `{"digits":4,"names":"shown"}`; the second command is rejected with `invalid_command` and the revision does not change
- **Evidence:** `packages/shared/test/apply.test.ts` › "sets the digits option and rejects other values"; the `curl` commands after a server restart

#### Scenario: Set names
- **WHEN** a caller posts `{"type":"workspace.setOptions","names":"source"}` and then `{"type":"workspace.setOptions","names":"alias"}`
- **THEN** the options read `{"digits":3,"names":"source"}` after the first; the second is rejected with `invalid_command` and the revision does not change
- **Evidence:** `packages/shared/test/apply.test.ts` › "sets the names option and rejects other values"

#### Scenario: Old workspace
- **WHEN** a workspace file written before this change, with `options: {"digits": 4}`, is read
- **THEN** it loads with `{"digits":4,"names":"shown"}`
- **Evidence:** `packages/shared/test/workspace.test.ts` › "reads a workspace without names"
