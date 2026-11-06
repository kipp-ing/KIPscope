## MODIFIED Requirements

### Requirement: Signal references
A SIGNAL argument SHALL be a full ID (`dataRef/name`), sent unchanged, or a bare name: the one signal whose name, or name part after the first `.`, or logical name (signal-aliases) equals it ignoring case. A source name that equals the text SHALL win over a logical name. No match SHALL be rejected with `unknown_signal`, several with `ambiguous_signal` listing the candidate IDs; nothing is sent. Origin: full IDs per concept §7 (stable IDs); bare names are a goal of this change (design L6, Q5); logical names: signal-aliases.

#### Scenario: Bare, ambiguous and unknown names
- **WHEN** the test catalog holds `testcar/Sna_800h.RPM`, `testcar/Fast_100h.SIG_A` and `othercar/Fast_100h.SIG_A`, and `signal add w1 rpm`, `signal add w1 SIG_A` and `signal add w1 NOPE` run
- **THEN** the first adds `testcar/Sna_800h.RPM`; the second exits 1 with `ambiguous_signal` and `error.candidates` `["othercar/Fast_100h.SIG_A","testcar/Fast_100h.SIG_A"]`; the third exits 1 with `unknown_signal`; the last two leave the revision unchanged
- **Evidence:** `apps/cli/test/cli.test.ts` › "resolves bare signal names and refuses ambiguous ones"

#### Scenario: Bare name on real data
- **WHEN** a window `<w>` exists in the open UI and `kipscope signal add <w> SPEED_DISP` runs
- **THEN** `command.signalId` in the output is `smart451/ICL_3A2h.SPEED_DISP` and the signal appears in that window
- **Evidence:** UI check (CLI output and screenshot), covered by "Window from the CLI in the open UI"

#### Scenario: Logical name
- **WHEN** the dictionary maps `Speed` to `Fast_100h.SIG_A` and the test catalog holds `testcar/Fast_100h.SIG_A`, and `signal add w1 speed` runs
- **THEN** it adds `testcar/Fast_100h.SIG_A`
- **Evidence:** `apps/cli/test/refs.test.ts` › "resolves a logical name"

## ADDED Requirements

### Requirement: Names option command
The CLI SHALL offer `names shown|source`, sending exactly one `workspace.setOptions {names}` command; any other argument SHALL be a usage error (exit 2, nothing sent). `state` shows the option as part of the workspace. Origin: Jan (2026-11-06); workspace-state "User options".

#### Scenario: Form maps to the command
- **WHEN** the argument lists `names source` and `names alias` are parsed
- **THEN** the first gives `{"type":"workspace.setOptions","names":"source"}`, the second is a usage error naming `shown|source`
- **Evidence:** `apps/cli/test/args.test.ts` › "maps every command form to its command"

#### Scenario: Names over HTTP
- **WHEN** `kipscope names source` and then `kipscope state` run against the test server
- **THEN** the first exits 0 with a new revision, and the state shows `options.names` `source`
- **Evidence:** `apps/cli/test/cli.test.ts` › "sets the names option over HTTP"
