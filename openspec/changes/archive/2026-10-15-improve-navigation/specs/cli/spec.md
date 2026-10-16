## ADDED Requirements

### Requirement: Digits option command
The CLI SHALL offer `digits 3|4`, sending exactly one `workspace.setOptions {digits}` command; any other argument SHALL be a usage error (exit 2, nothing sent). `state` shows the option as part of the workspace. Origin: D-026 („4 significant digits are an option"); concept §7 (display options are controllable by CLI); workspace-state "User options".

#### Scenario: Form maps to the command
- **WHEN** the argument lists `digits 4` and `digits 5` are parsed
- **THEN** the first gives `{"type":"workspace.setOptions","digits":4}`, the second is a usage error naming `3|4`
- **Evidence:** `apps/cli/test/args.test.ts` › "maps every command form to its command"

#### Scenario: Digits over HTTP
- **WHEN** `kipscope digits 4` and then `kipscope state` run against the test server
- **THEN** the first exits 0 with a new revision, and the state shows `options.digits` `4`
- **Evidence:** `apps/cli/test/cli.test.ts` › "sets the digits option over HTTP"
