## MODIFIED Requirements

### Requirement: One workspace per call
All requests of one CLI call SHALL go to the same workspace: the given one, or, when none is given, the workspace named by the first answer's `X-KIPscope-Workspace` header, for every later request of that call. `--wait` and `wait` SHALL therefore wait for a UI connected to that workspace. A call that needs more than one request without a given workspace SHALL send no second request before the first answer named the workspace, so no two requests of one call run in parallel to the default workspace.

Origin: concept §7 („ob … die offene Oberfläche den Zustand dargestellt hat": the UI that shows the changed workspace); necessary consequence of the default workspace (it may change between two requests); no parallel first requests: review day 2026-10-28 T-10 (`state` sent the workspace and the render-status requests in parallel, so without `--workspace` they could name different workspaces).

#### Scenario: Wait sees only its workspace
- **WHEN** a fake browser is connected only to workspace A, workspace B is the default, and `kipscope --wait diff on` runs, then `kipscope --workspace A --wait diff on`
- **THEN** the first exits 6 with `render.status` `no_ui` and `workspace` B; the second exits 0 with `render.status` `complete` and `workspace` A
- **Evidence:** `apps/cli/test/cli.test.ts` › "waits for a UI of the same workspace"

#### Scenario: State asks one workspace
- **WHEN** a stub server records the path of every request, answers the unprefixed `GET /api/workspace` with `X-KIPscope-Workspace: aaaaaaaaaa` and would answer an unprefixed `GET /api/render-status` with `X-KIPscope-Workspace: bbbbbbbbbb` (the default changed in between), and `kipscope state` runs without `--workspace`
- **THEN** the recorded paths are `/api/workspace`, then `/api/w/aaaaaaaaaa/render-status`, in that order and the second sent only after the first was answered; the output's `workspace` is `aaaaaaaaaa`
- **Evidence:** `apps/cli/test/cli.test.ts` › "asks one workspace for state"

### Requirement: Exit codes
The exit code and `outcome` SHALL tell what happened: 0 `ok`, 1 `rejected` (the server or a lookup refused it), 2 `usage` (bad arguments; nothing sent), 3 `unreachable`, 4 `timeout`, 5 `render_error`, 6 `no_ui`, 7 `unavailable` (the server answered 5xx, e.g. `catalog_unavailable`). A wrong argument count SHALL be named as `<form> takes N argument(s)`, `takes N to M arguments`, or for a form without an upper bound `takes at least N argument(s)`, each followed by `, got K (see --help)`. Origin: concept §7 (a caller must see whether a command was accepted, data is available and the UI rendered it); the open-ended count: review day 2026-10-28 T-14 (`search` without a query read `takes 1 to Infinity arguments`).

#### Scenario: Rejected
- **WHEN** B is off and `kipscope cursor move b +1s` runs
- **THEN** the exit code is 1, `accepted` is `false`, `error.code` is `cursor_off`, and the revision does not change
- **Evidence:** `apps/cli/test/cli.test.ts` › "exits 1 with the server's code when a command is rejected"

#### Scenario: Usage error sends nothing
- **WHEN** `kipscope cursor move a 500` (no unit), `kipscope window range w1 2026-10-13` (no clock time) and `kipscope frobnicate` run
- **THEN** each exits 2 with `outcome` `usage`, and the server's revision is the same as before
- **Evidence:** `apps/cli/test/cli.test.ts` › "exits 2 on bad arguments without sending anything"

#### Scenario: Open-ended argument count
- **WHEN** the argument lists `search`, `fav add`, `events filter` and `case go` are parsed
- **THEN** each is a usage error (exit 2) whose message is `search takes at least 1 argument, got 0 (see --help)`, `fav add takes at least 1 argument, got 0 (see --help)`, `events filter takes at least 1 argument, got 0 (see --help)` and `case go takes 1 argument, got 0 (see --help)`; no message holds `Infinity`
- **Evidence:** `apps/cli/test/args.test.ts` › "names an open-ended argument count"

#### Scenario: Server unreachable
- **WHEN** `kipscope --server http://127.0.0.1:<port> state` runs as a separate process and nothing listens on that port
- **THEN** the exit code is 3 and `outcome` is `unreachable`
- **Evidence:** `apps/cli/test/process.test.ts` › "exits 3 when the server is unreachable"

#### Scenario: Server does not answer
- **WHEN** the server address is a TCP listener that accepts connections and never answers, and `kipscope --timeout 300ms state` runs
- **THEN** it exits 4 with `outcome` `timeout` in less than 1 s
- **Evidence:** `apps/cli/test/cli.test.ts` › "exits 4 when the server does not answer in time"

#### Scenario: Data source unavailable
- **WHEN** the server's catalog has never loaded and `kipscope search volt` runs
- **THEN** the exit code is 7, `outcome` is `unavailable` and `error.code` is `catalog_unavailable`
- **Evidence:** `apps/cli/test/cli.test.ts` › "exits 7 when the server answers 5xx"

### Requirement: Computed signal commands
The CLI SHALL offer `calc list`, `calc add FORMULA [--name NAME] [--unit UNIT]`, `calc edit ID|NAME [--formula F] [--name N] [--unit U]` and `calc rm ID|NAME` over the workspace commands of computed-signals (design F13 of improve-formula-editor), with signal and computed names typed in the formula and resolved as in the editor; `--a`, `--b` and `--no-b` are no longer options; `value` and `extent` SHALL take a computed ID. A refusal sends nothing. `--name` of `calc add` and `calc edit` that is empty after trimming SHALL be a usage error (exit 2, `NAME is empty`), nothing sent. Origin: concept §7 (one command model for UI and CLI); add-computed-signals lead pick 7; names in the formula: D-106; empty NAME: review day 2026-10-28 T-14 (`calc add --name ""` was sent and refused by the server instead), the name rule of computed-signals (1–60 characters, trimmed).

#### Scenario: Forms
- **WHEN** the argument lists `calc list`, `calc add "SIG_A - speed"`, `calc add "abs(SIG_A)" --name Abs --unit A`, `calc edit Diff --formula "abs(Diff2)"`, `calc rm c3`, `calc add`, `calc add "a - b" --a rpm`, `calc edit Diff --no-b` and `calc rm` are parsed
- **THEN** the first five give the forms list, add (formula), add (formula, name, unit), edit (target `Diff`, formula) and rm (`c3`); the last four are usage errors (exit 2), the two with `--a`/`--no-b` as unknown options
- **Evidence:** `apps/cli/test/args.test.ts` › "maps the calc forms"

#### Scenario: Empty NAME
- **WHEN** the argument lists `calc add "abs(SIG_A)" --name ""`, `calc add "abs(SIG_A)" --name "  "`, `calc edit Diff --name ""` and `calc add "abs(SIG_A)" --unit ""` are parsed; and against the test server `kipscope calc add "abs(SIG_A)" --name ""` runs
- **THEN** the first three are usage errors (exit 2) with the message `NAME is empty`; the fourth gives the add form with unit `""` (an empty unit stays allowed); the run exits 2 with `outcome` `usage` and the server's revision is the same as before
- **Evidence:** `apps/cli/test/args.test.ts` › "refuses an empty calc NAME"; `apps/cli/test/cli.test.ts` › "exits 2 on bad arguments without sending anything" (extended by the `calc add --name ""` run)

#### Scenario: Add, list, edit, remove over HTTP
- **WHEN** against the test server on a workspace scoped to `testcar` `calc add "SIG_A - speed"`, `calc add 'abs("SIG_A − SPEED")'`, `calc list`, `calc rm "SIG_A − SPEED"`, `calc edit "abs(SIG_A − SPEED)" --formula "SIG_A * 2" --name Twice`, `calc rm Twice`, `calc rm "SIG_A − SPEED"` and `calc list` run
- **THEN** the adds exit 0 printing `created`; the list shows `{name: "SIG_A − SPEED", formula: "Fast_100h.SIG_A - Sna_800h.SPEED"}` (unit as `inferUnit` of their units) and `{name: "abs(SIG_A − SPEED)", formula: "abs(\"SIG_A − SPEED\")"}`; the first `rm` exits 1 with `error.code` `computed_in_use`; the edit exits 0 and stores `Fast_100h.SIG_A * 2` named `Twice`; the next two `rm` exit 0; the last list is empty
- **Evidence:** `apps/cli/test/cli.test.ts` › "adds, lists, edits and removes computed signals"

#### Scenario: Refusals and a computed value
- **WHEN** `calc add "SIG_A - nope"`, `calc add "temp + 1"` (two matches), `calc add "SIG_A %"`, `calc rm Nope` run, then after a valid `calc add` `value testcar/=<id> <time>` runs
- **THEN** the first four exit 1 with `error.code` `unknown_signal`, `ambiguous_signal` (`error.candidates` `Sna_800h.TEMP`, `Tmp_A21h.TEMP`), `invalid_formula` and `unknown_computed`, the state's revision unchanged; the `value` exits 0 with the computed value from `/api/value`
- **Evidence:** `apps/cli/test/cli.test.ts` › "refuses bad calc arguments and reads a computed value"
