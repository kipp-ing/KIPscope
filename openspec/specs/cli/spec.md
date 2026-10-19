# cli Specification

## Purpose
The `kipscope` command-line client lets a person, a script or an AI control the open workspace remotely through the same commands as the UI, read its state, and learn whether a command was accepted, whether its data is available and whether the open UI has rendered it.

Conventions for the evidence below: `kipscope` stands for `node apps/cli/src/main.ts`, run from the repo root against the dev server at `localhost:7310` with `TZ=Europe/Berlin` (CEST, +02:00 on 2026-10-13). The `apps/cli/test/*` tests start the real server app in-process on a free port, with a stub data source and catalog, and use a WebSocket client on `/api/live` as a fake browser that sends `rendered` messages (design L8).

## Requirements

### Requirement: CLI client of the open workspace
The CLI `kipscope` SHALL control the open workspace only through the server's HTTP API, at `--server <url>`, else `KIPSCOPE_URL`, else `http://localhost:7310`. It SHALL never read the data source directly. `--help` SHALL print the usage of every form and exit 0. Origin: concept §7 (the CLI controls the open view); D-005 (the server holds the CLI endpoint); D-011 (D8, commands via `POST /api/commands`).

#### Scenario: Server address
- **WHEN** `kipscope state` runs once with `--server http://127.0.0.1:<port>`, once with only `KIPSCOPE_URL=http://127.0.0.1:<port>`, and once with both set to different servers
- **THEN** the first two read the test server; the third reads the `--server` one
- **Evidence:** `apps/cli/test/cli.test.ts` › "chooses --server over KIPSCOPE_URL over localhost:7310"

#### Scenario: Usage
- **WHEN** `kipscope --help` runs
- **THEN** it prints a usage text naming every form of the requirements below and exits 0 without contacting a server
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints the usage with --help"

### Requirement: One JSON result per call
Each call SHALL print exactly one JSON object on one line to stdout (indented with `--pretty`) with `ok`, `outcome` and `exitCode` and, where they apply, `accepted`, `command`, `revision`, `created`, `createdWindow`, `render`, `data`, `local` and `error {code, message}`, except that a successful `events list --table` prints its table and a successful `view export NAME` without `--out` prints the view's YAML text. A failed call SHALL also print one line naming the reason to stderr. Origin: concept §7 („maschinenlesbare Ergebnisse"); table: D-058; YAML text: Jan 2026-10-17 („yaml export"), this change.

#### Scenario: Accepted command
- **WHEN** `kipscope diff on` runs against a fresh test server as a separate process
- **THEN** stdout is exactly one line that parses as `{"ok":true,"outcome":"ok","exitCode":0,"accepted":true,"command":{"type":"cursor.setDiff","diff":true},"revision":1}`, stderr is empty and the exit code is 0
- **Evidence:** `apps/cli/test/process.test.ts` › "prints one JSON line on stdout and nothing on stderr"

#### Scenario: Failed call
- **WHEN** `kipscope cursor move b +1s` runs as a separate process while B is off
- **THEN** stdout is one JSON line with `"ok":false` and `"outcome":"rejected"`, stderr is one line containing `cursor_off`, and the exit code is 1
- **Evidence:** `apps/cli/test/process.test.ts` › "prints the reason of a failure on stderr"

#### Scenario: Table only on success
- **WHEN** `kipscope events list --table --ref nope` runs as a separate process
- **THEN** stdout is one JSON line with `"outcome":"rejected"` and `error.code` `unknown_data_ref`, and the exit code is 1
- **Evidence:** `apps/cli/test/process.test.ts` › "prints the reason of a failure on stderr" (table case)

#### Scenario: YAML only on success
- **WHEN** `kipscope view export nope` runs as a separate process
- **THEN** stdout is one JSON line with `"outcome":"rejected"` and `error.code` `unknown_view`, stderr names `unknown_view`, and the exit code is 1
- **Evidence:** `apps/cli/test/process.test.ts` › "exports a view as YAML text" (failure case)

### Requirement: Exit codes
The exit code and `outcome` SHALL tell what happened: 0 `ok`, 1 `rejected` (the server or a lookup refused it), 2 `usage` (bad arguments; nothing sent), 3 `unreachable`, 4 `timeout`, 5 `render_error`, 6 `no_ui`, 7 `unavailable` (the server answered 5xx, e.g. `catalog_unavailable`). Origin: concept §7 (a caller must see whether a command was accepted, data is available and the UI rendered it).

#### Scenario: Rejected
- **WHEN** B is off and `kipscope cursor move b +1s` runs
- **THEN** the exit code is 1, `accepted` is `false`, `error.code` is `cursor_off`, and the revision does not change
- **Evidence:** `apps/cli/test/cli.test.ts` › "exits 1 with the server's code when a command is rejected"

#### Scenario: Usage error sends nothing
- **WHEN** `kipscope cursor move a 500` (no unit), `kipscope window range w1 2026-10-13` (no clock time) and `kipscope frobnicate` run
- **THEN** each exits 2 with `outcome` `usage`, and the server's revision is the same as before
- **Evidence:** `apps/cli/test/cli.test.ts` › "exits 2 on bad arguments without sending anything"

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

### Requirement: Window and link commands
The CLI SHALL offer `window create [--values] [--title T] [--from TIME --to TIME] [--mode M] [--envelope on|off]`, `window remove W`, `window rename W TITLE`, `window height W PX`, `window range W FROM TO`, `window display W [--mode M] [--envelope on|off]` and `link on|off`, each sending exactly one command. Origin: concept §7 (create and change windows, set ranges and zoom, control display options); D-017 (link).

#### Scenario: Forms map to commands
- **WHEN** the argument lists of every window and link form are parsed, e.g. `window range w1 "2026-10-13 15:08:00" "2026-10-13 15:08:03"` and `window create --values --title Readout`
- **THEN** they give exactly the commands of design L2, e.g. `{"type":"window.setRange","windowId":"w1","from":"1791896880000000000","to":"1791896883000000000"}` and `{"type":"window.create","kind":"values","title":"Readout"}`
- **Evidence:** `apps/cli/test/args.test.ts` › "maps every command form to its command"

#### Scenario: Windows over HTTP
- **WHEN** `window create`, `window rename`, `window height`, `window display --mode step`, `window range`, `link off` and `window remove` run one after another against the test server
- **THEN** each exits 0 with a revision one higher than the one before, and `kipscope state` shows each change
- **Evidence:** `apps/cli/test/cli.test.ts` › "drives windows and the link flag over HTTP"

#### Scenario: Window from the CLI in the open UI
- **WHEN** the UI is open on real data and `kipscope window create --title Speeds --from "2026-10-13 15:08:00" --to "2026-10-13 15:08:03"` runs, then `kipscope signal add <new window ID> SPEED_DISP`
- **THEN** within 1 s the UI shows a window "Speeds" whose header reads `2026-10-13 15:08:00 – 2026-10-13 15:08:03` with `ICL_3A2h.SPEED_DISP` in it
- **Evidence:** UI check (screenshot of the window and the two CLI outputs)

### Requirement: Signal commands
The CLI SHALL offer `signal add W SIGNAL`, `signal remove W REF` and `signal move W REF TARGET|new [--copy]`, each sending one command. REF is an assignment ID (`a<n>`) or a signal reference matched against W's assignments; `new` moves into a new window. A REF that W does not show SHALL be rejected with `unknown_assignment` without sending. Origin: concept §4, §7 („Signale … hinzufügen, entfernen und zuordnen"); D-017.

#### Scenario: Signals over HTTP
- **WHEN** against the test server `signal add w1 testcar/Sna_800h.RPM`, `signal move w1 RPM new --copy`, `signal move w1 a2 w3` and `signal remove w3 testcar/Sna_800h.RPM` run (window and assignment IDs as the outputs name them)
- **THEN** each exits 0; the copy's output carries `createdWindow` and `created`; the move keeps the assignment ID; after the remove `w3` no longer shows RPM
- **Evidence:** `apps/cli/test/cli.test.ts` › "drives signal add, move, copy and remove over HTTP"

#### Scenario: Reference not in the window
- **WHEN** `w1` does not show RPM and `kipscope signal remove w1 RPM` runs
- **THEN** the exit code is 1, `error.code` is `unknown_assignment`, and the revision does not change
- **Evidence:** `apps/cli/test/cli.test.ts` › "drives signal add, move, copy and remove over HTTP"

### Requirement: Signal references
A SIGNAL argument SHALL be a full ID (`dataRef/name`), sent unchanged, or a bare name: the one signal whose name, or name part after the first `.`, equals it ignoring case. No match SHALL be rejected with `unknown_signal`, several with `ambiguous_signal` listing the candidate IDs; nothing is sent. Origin: full IDs per concept §7 (stable IDs); bare names are a goal of this change (design L6, Q5).

#### Scenario: Bare, ambiguous and unknown names
- **WHEN** the test catalog holds `testcar/Sna_800h.RPM`, `testcar/Fast_100h.SIG_A` and `othercar/Fast_100h.SIG_A`, and `signal add w1 rpm`, `signal add w1 SIG_A` and `signal add w1 NOPE` run
- **THEN** the first adds `testcar/Sna_800h.RPM`; the second exits 1 with `ambiguous_signal` and `error.candidates` `["othercar/Fast_100h.SIG_A","testcar/Fast_100h.SIG_A"]`; the third exits 1 with `unknown_signal`; the last two leave the revision unchanged
- **Evidence:** `apps/cli/test/cli.test.ts` › "resolves bare signal names and refuses ambiguous ones"

#### Scenario: Bare name on real data
- **WHEN** a window `<w>` exists in the open UI and `kipscope signal add <w> SPEED_DISP` runs
- **THEN** `command.signalId` in the output is `smart451/ICL_3A2h.SPEED_DISP` and the signal appears in that window
- **Evidence:** UI check (CLI output and screenshot), covered by "Window from the CLI in the open UI"

### Requirement: Search and extent
`search QUERY… [--limit N]` SHALL return the server's ranked search page (`items`, `total`, `more`) in `data`, and `extent SIGNAL` the signal's first and last time in `data` and in local time in `local`. Origin: concept §4, §7 („Signale suchen"); signal-catalog "Signal search" and "Search ranking".

#### Scenario: Ranked search on real data
- **WHEN** `kipscope search volt --limit 3 | jq -r '.data.items[0].id, (.data.items | length)'` runs
- **THEN** it prints `smart451/DCU_1F4h.COMP_HV_Volt` and `3`
- **Evidence:** the command against the dev server; `apps/cli/test/cli.test.ts` › "searches and reads extents"

#### Scenario: Extent
- **WHEN** the stub source gives `testcar/Sna_800h.SPEED` the extent 2026-10-01T02:00:00Z … 02:01:39.9Z and `kipscope extent testcar/Sna_800h.SPEED` runs
- **THEN** `data.first` is `1790820000000000000`, `local.first` is `2026-10-01 04:00:00+02:00` and `local.last` is `2026-10-01 04:01:39.900+02:00`
- **Evidence:** `apps/cli/test/cli.test.ts` › "searches and reads extents"

### Requirement: Readable state
`state` SHALL return in `data` the revision, the workspace exactly as `GET /api/workspace` gives it, and the render status of `GET /api/render-status`; `local` SHALL give cursors A and B and each timeseries window's range in local time with offset. Origin: concept §7 („auslesbarer Zustand"; the open view including cursors and zoom must be controllable); D-011 (D8).

#### Scenario: State with local times
- **WHEN** window `w1` spans 2026-10-13T13:08:00Z … 13:08:03Z, A is at 13:08:01.5Z, a fake browser acknowledged the current revision, and `kipscope state` runs
- **THEN** `data.workspace` equals the body of `GET /api/workspace`, `data.render.clients` lists the fake browser with that revision, `local.cursors.a` is `2026-10-13 15:08:01.500+02:00` and `local.ranges.w1` is `{"from":"2026-10-13 15:08:00+02:00","to":"2026-10-13 15:08:03+02:00"}`
- **Evidence:** `apps/cli/test/cli.test.ts` › "returns workspace, render status and local times"

#### Scenario: Same times as the UI
- **WHEN** the UI is open with a values window, `kipscope cursor set a "2026-10-13 15:08:01.5"` runs and then `kipscope state | jq -r .local.cursors.a`
- **THEN** it prints `2026-10-13 15:08:01.500+02:00`, and the values window header shows A at `2026-10-13 15:08:01.500`
- **Evidence:** UI check (screenshot of the values window header next to the CLI output)

### Requirement: Time arguments
A TIME SHALL be decimal ns, ISO-8601 with `Z` or `±HH:MM`, or local wall time `YYYY-MM-DD[T| ]HH:MM[:SS[.f]]` (1–9 fraction digits) in the process's time zone, as the UI shows it, kept to the ns. A local time that is ambiguous or does not exist (DST change) or a time outside 1900…2262 SHALL be a usage error. Origin: concept §8 (local time; original precision; ambiguous local times unambiguous); D-011 (D3); D-021.

#### Scenario: Equivalent forms
- **WHEN** `1791896880093000000`, `2026-10-13T13:08:00.093Z`, `2026-10-13T15:08:00.093+02:00`, `2026-10-13 15:08:00.093` and `2026-10-13T15:08:00.093` are parsed in Europe/Berlin, and `2026-10-13 15:08:00.123456789`
- **THEN** the first five give `1791896880093000000`, the last `1791896880123456789`
- **Evidence:** `packages/shared/test/localtime.test.ts` › "parses ns, ISO with zone and local wall time"

#### Scenario: DST change
- **WHEN** `2026-10-25 02:30` (the hour that occurs twice), `2026-03-29 02:30` (the hour that is skipped) and `2026-10-25 02:30+01:00` are parsed in Europe/Berlin
- **THEN** the first fails with a message naming both `+02:00` and `+01:00`, the second fails saying it does not exist, the third gives 2026-10-25T01:30:00Z; on the CLI the failures exit 2
- **Evidence:** `packages/shared/test/localtime.test.ts` › "refuses ambiguous and nonexistent local times"; `apps/cli/test/cli.test.ts` › "exits 2 on bad arguments without sending anything" (includes `cursor set a "2026-10-25 02:30"`)

#### Scenario: Round trip and UI format
- **WHEN** times with ns digits, at both instants of the 2026-10-25 02:30 fold and in 1900 and 2262 are formatted with offset and parsed back, and formatted without offset next to the UI's `formatFull`
- **THEN** each parses back to the same ns, and the text without offset equals the UI's text
- **Evidence:** `packages/shared/test/localtime.test.ts` › "round-trips local times with offset to the nanosecond"; `apps/web/test/axis.test.ts` › "formats local times like the shared formatLocal"

#### Scenario: Local time on real data
- **WHEN** `kipscope value smart451/ICL_3A2h.SPEED_DISP "2026-10-13 15:08:00.1435" | jq -c .data.value` runs
- **THEN** it prints `{"kind":"interpolated","value":22.5}`, the value `add-cursors` checks at `2026-10-13T13:08:00.1435Z`
- **Evidence:** the command against the dev server

### Requirement: Durations
A DURATION SHALL be `[+|-]<decimal><unit>` with unit `ns`, `us`, `µs`, `ms`, `s`, `min` or `h`, exact to 1 ns. A missing unit, the unit `m` (minutes or milliseconds?) and a value finer than 1 ns SHALL be usage errors. An argument like `-1.5s` SHALL be read as a value, not as an option. Origin: concept §7 („Cursor … relativ verschieben"); workspace-state "Time bounds in commands" (ns).

#### Scenario: Duration forms
- **WHEN** `+500ms`, `-1.5s`, `1.5us`, `2µs`, `1min`, `-2h`, `7ns` are parsed, and `500`, `2m`, `0.5ns`, `1.0000000001s`
- **THEN** the first seven give `500000000`, `-1500000000`, `1500`, `2000`, `60000000000`, `-7200000000000`, `7`; each of the last four fails
- **Evidence:** `packages/shared/test/localtime.test.ts` › "parses durations exactly and refuses ambiguous units"

### Requirement: Cursor anchors
A TIME MAY be `a` or `b`, optionally followed by `+DURATION` or `-DURATION`: the cursor's current time plus the offset, read from the state just before the command. An anchor on a cursor that is off SHALL reject the call with `cursor_off` without sending. Origin: goal of this change (e.g. zoom to ±1 s around A, place B 500 ms after A; design L5, Q6); concept §6 (A and B are absolute times).

#### Scenario: Anchors
- **WHEN** A is at 2026-10-13T13:08:00.093Z, and `cursor set b a+500ms` and `window range w1 a-1s a+1s` run, then `cursor remove b` and `value testcar/Sna_800h.SPEED b`
- **THEN** B is at `1791896880593000000`, `w1` spans `1791896879093000000` … `1791896881093000000`, and the `value` call exits 1 with `cursor_off` without a request to `/api/value`
- **Evidence:** `apps/cli/test/cli.test.ts` › "resolves cursor anchors and refuses off cursors"

### Requirement: Cursor commands
The CLI SHALL offer `cursor set a|b TIME`, `cursor move a|b DURATION`, `cursor remove a|b` and `diff on|off`, each sending one command; `cursor move` sends one `cursor.move` and the server adds the duration. Origin: concept §7 („Cursor absolut setzen oder relativ verschieben", „Differenzmodus … steuern"); D-023, D-024 (add-cursors commands).

#### Scenario: Cursors over HTTP
- **WHEN** `cursor set a "2026-10-13 15:08:00.093"`, `cursor move a +902ms`, `cursor move a -2ms`, `diff on` and `cursor remove a` run one after another
- **THEN** A is `1791896880093000000`, then `1791896880995000000`, then `1791896880993000000`, `cursors.diff` is `true`, then A is off; each call raised the revision by one
- **Evidence:** `apps/cli/test/cli.test.ts` › "sets, moves and removes cursors and switches diff"

#### Scenario: Relative move in the open UI
- **WHEN** the UI shows a values window and A at 15:08:01.500 local, and `kipscope --wait cursor move a +500ms` runs
- **THEN** it exits 0 with `render.status` `complete`, and the screenshot taken right after shows A at `2026-10-13 15:08:02` in the values window header and the line moved by 0.5 s in every window
- **Evidence:** UI check (screenshot and CLI output)

### Requirement: Raw command
`command JSON` SHALL send one command of the shared command model unchanged, so every command the server knows is reachable without its own form. JSON that does not parse SHALL be a usage error; validating the command stays with the server. Origin: concept §7 (an AI uses this regular interface); D-011 (D8, one command model).

#### Scenario: Raw commands
- **WHEN** `command '{"type":"workspace.setLinkTime","linked":false}'`, `command '{"type":"nope"}'` and `command '{'` run
- **THEN** the first exits 0 and `linkTime` is `false`; the second exits 1 with `invalid_command`; the third exits 2 and the revision does not change
- **Evidence:** `apps/cli/test/cli.test.ts` › "sends a raw command"

### Requirement: Waiting for the open UI
With `--wait`, an accepted command SHALL block until a connected UI has acknowledged its revision or a later one; `wait [REVISION]` does the same (default: current). `render` SHALL report `complete`, `error` with the UI's errors, `no_ui` once no UI was connected for 2 s in a row, or `timeout` after `--timeout` (default 30 s). Origin: concept §7 (the caller sees whether data is available and the open UI rendered the state); D-005; D-011.

#### Scenario: Rendered
- **WHEN** a fake browser is connected and acknowledges each new revision as `complete` 200 ms after it arrives, and `kipscope --wait window create --from 0 --to 10` runs
- **THEN** it exits 0 after at least 200 ms with `render.status` `complete`, `render.revision` the command's revision and `render.clientId` the fake browser's client ID
- **Evidence:** `apps/cli/test/cli.test.ts` › "waits for the render acknowledgement"

#### Scenario: A later revision counts
- **WHEN** the fake browser does not acknowledge revision R but, after another command, acknowledges R + 1, while `kipscope wait R` runs
- **THEN** it exits 0 with `render.revision` R + 1
- **Evidence:** `apps/cli/test/cli.test.ts` › "counts an acknowledgement of a later revision"

#### Scenario: Revision that does not exist yet
- **WHEN** the current revision is 5 and `kipscope wait 9` runs
- **THEN** it exits 1 at once with `error.code` `unknown_revision`
- **Evidence:** `apps/cli/test/cli.test.ts` › "counts an acknowledgement of a later revision"

#### Scenario: Rendered with data errors
- **WHEN** the fake browser acknowledges the revision with `status: "error"` and `errors: [{"windowId":"w1","signalId":"car/A","message":"source_error: timeout"}]`
- **THEN** the call exits 5, `accepted` is `true`, and `render.errors` holds that error
- **Evidence:** `apps/cli/test/cli.test.ts` › "exits 5 when the UI rendered with data errors"

#### Scenario: No UI connected
- **WHEN** no browser is connected and `kipscope --wait diff on` runs
- **THEN** it exits 6 after 2 to 3 s, with `accepted` `true`, the new `revision` and `render.status` `no_ui`
- **Evidence:** `apps/cli/test/cli.test.ts` › "exits 6 when no UI is connected"; `apps/cli/test/wait.test.ts` › "reports no_ui after 2 s without a client, not after a 1 s reconnect gap"

#### Scenario: UI does not acknowledge
- **WHEN** a fake browser is connected but never acknowledges, and `kipscope --wait --timeout 500ms diff on` runs
- **THEN** it exits 4 in less than 1 s with `accepted` `true` and `render.status` `timeout`
- **Evidence:** `apps/cli/test/cli.test.ts` › "exits 4 when the UI does not acknowledge in time"

#### Scenario: Real UI
- **WHEN** the UI is open on real data with a window `<w>`, and `kipscope --wait signal add <w> smart451/BRK_1A0h.WSPD_FL` runs; then the UI tab is closed and `kipscope --wait diff off` runs
- **THEN** the first exits 0 with `render.status` `complete` and a screenshot taken right after shows WSPD_FL drawn, not loading; the second exits 6 with `render.status` `no_ui`
- **Evidence:** UI check (screenshot and both CLI outputs)

### Requirement: Value at a time
`value SIGNAL TIME [--mode line|step]` SHALL return in `data` the server's value of the signal at that time with its neighbour points, as the values window evaluates it, and those times in `local`. Origin: concept §6, §7 (values at the cursors; readable state; whether the data is available); D-024 (raw values, independent of zoom).

#### Scenario: Value at a time and at a cursor
- **WHEN** the stub source gives `testcar/Sna_800h.SPEED` the points 10 at 2026-10-01T02:00:01Z and 11 at 02:00:01.1Z, A is at 02:00:01.05Z, and `value testcar/Sna_800h.SPEED a` and `value testcar/Sna_800h.SPEED a --mode step` run
- **THEN** `data.value` is `{"kind":"interpolated","value":10.5}`, then `{"kind":"held","value":10}`; `local.at` is `2026-10-01 04:00:01+02:00`
- **Evidence:** `apps/cli/test/cli.test.ts` › "reads a value at a time and at a cursor"

#### Scenario: Unknown signal
- **WHEN** `kipscope value testcar/NOPE.X 0` runs
- **THEN** it exits 1 with `error.code` `unknown_signal`
- **Evidence:** `apps/cli/test/cli.test.ts` › "reads a value at a time and at a cursor"

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

### Requirement: Removed window in the result
When an accepted command removed a window as a side effect (workspace-state "Window emptied by a move is removed"), the CLI's JSON result SHALL carry `removedWindow` with that window's ID, placed right after `createdWindow` in the key order. Origin: concept §7 („maschinenlesbare Ergebnisse", a caller must see what its command changed); D-027 (emptied window removed).

#### Scenario: Move empties a window
- **WHEN** against the test server `w1` shows only `testcar/Sna_800h.RPM`, `w3` exists, and `kipscope signal move w1 RPM w3` runs
- **THEN** it exits 0, its output carries `"removedWindow":"w1"` after `revision`, and a following `kipscope state` no longer lists `w1`
- **Evidence:** `apps/cli/test/cli.test.ts` › "reports the window a move removed"

#### Scenario: Copy reports no removal
- **WHEN** `kipscope signal move w3 RPM new --copy` runs
- **THEN** the output carries `createdWindow` and `created` and no `removedWindow`
- **Evidence:** `apps/cli/test/cli.test.ts` › "reports the window a move removed"

### Requirement: Attribution in the help
The last line of the `--help` text SHALL be `attributionText()` (`app-footer` design F1): `KIPscope © 2026 Jan Kipping, Agentic engineer, https://kipp.ing · Attribution Assurance License (AAL)`. Command results SHALL NOT carry it. Origin: AAL clause 2 (attribution when the program is launched), per D-049; "One JSON result per call" keeps it out of results;.

#### Scenario: Help ends with the attribution
- **WHEN** `kipscope --help` runs
- **THEN** it exits 0 and the last non-empty line of stdout is `KIPscope © 2026 Jan Kipping, Agentic engineer, https://kipp.ing · Attribution Assurance License (AAL)`
- **Evidence:** `apps/cli/test/cli.test.ts` › "ends the help with the attribution"

#### Scenario: Results unchanged
- **WHEN** `kipscope state` runs against the test server
- **THEN** stdout is exactly one line that parses as JSON and contains no `kipp.ing`
- **Evidence:** `apps/cli/test/cli.test.ts` › "keeps results one JSON line without the attribution"

### Requirement: Measurement commands
The CLI SHALL offer `measurement name TEXT` and `measurement object TEXT` (`measurement.set` with that field; `""` clears it), `measurement meta KEY VALUE` (`measurement.setMeta`; `""` removes the entry) and `measurement clear` (`measurement.clear`), each one command. A missing or extra argument SHALL be a usage error (exit 2, nothing sent). Origin: Jan, 2026-10-16 („meta info shall be cli settable"); concept §7.

#### Scenario: Forms map to commands
- **WHEN** the argument lists `measurement name "Testfahrt A9"`, `measurement object ""`, `measurement meta driver Jan`, `measurement meta driver ""`, `measurement clear`, `measurement name` and `measurement colour red` are parsed
- **THEN** they give `{"type":"measurement.set","name":"Testfahrt A9"}`, `{"type":"measurement.set","object":""}`, `{"type":"measurement.setMeta","key":"driver","value":"Jan"}`, `{"type":"measurement.setMeta","key":"driver","value":""}` and `{"type":"measurement.clear"}`; the last two are usage errors
- **Evidence:** `apps/cli/test/args.test.ts` › "maps every command form to its command"

#### Scenario: Over HTTP
- **WHEN** `kipscope measurement name "Testfahrt A9"`, `kipscope measurement object smart451`, `kipscope measurement meta driver Jan` and `kipscope state` run against the test server, then `kipscope measurement meta k <201 × "x">`
- **THEN** the first three exit 0 with one new revision each, the state shows the measurement of `measurement-info` "Read by the CLI"; the last exits 1 with `error.code` `invalid_command`
- **Evidence:** `apps/cli/test/cli.test.ts` › "sets and reads measurement info over HTTP"

#### Scenario: Help lists the forms
- **WHEN** `kipscope --help` runs
- **THEN** the text names `measurement name`, `measurement object`, `measurement meta` and `measurement clear`
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints the usage with --help" (form list extended)

### Requirement: Event list
`events list [FILTER…] [--ref DATAREF] [--from TIME --to TIME] [--table]` SHALL return `GET /api/events` for the data ref (`--ref`, else that of the first signal in window order, else rejected with `no_data_ref`) with the workspace's events-line signals and the FILTER words (none: the workspace filter), plus `data.description` and the local times in `local.t`; `--table` SHALL print the lines of design C1. Origin: D-058 („the filter also needs cli"); concept §7.

#### Scenario: JSON and filter
- **WHEN** against the CLI test server (stub events: the 18 testcar events; window `w1` shows `testcar/Sna_800h.RPM`) `kipscope events list`, `kipscope events list faults ecu:bms`, `kipscope events list changes -snapshots --from 2026-10-01T00:00Z --to 2026-10-01T03:00Z` and `kipscope events list 'ecu:'` run
- **THEN** the first returns 4 events (the workspace's default `active changes`: 2 active faults, 2 changes) with `data.filter` `active changes`, `data.description` `Active faults and state changes` and `data.total` 18; the second 5 events; the third 2; the last exits 1 with `invalid_filter`
- **Evidence:** `apps/cli/test/cli.test.ts` › "lists events with the workspace filter or the given one"

#### Scenario: Table
- **WHEN** `TZ=Europe/Berlin kipscope events list changes --table` runs against the CLI test server
- **THEN** stdout holds two event lines, the first `2026-10-01 03:03:00.000+02:00  State change  VCU  VCU.door  closed → open`, and the last line `2 of 18 events · changes · State changes`; exit 0
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints events as a table"

#### Scenario: Events on smart451
- **WHEN** `kipscope events list --table` runs against the dev server with the shipped project file and the default filter
- **THEN** 51 event lines, the last line `51 of 402 events · active changes · Active faults and state changes`
- **Evidence:** the command (head and tail of the output)

### Requirement: Event filter and events-line commands
`events filter FILTER…` SHALL send one `events.setFilter` with the words joined by spaces (`""` for the empty filter; no word is a usage error); `events add SIGNAL` and `events remove SIGNAL` SHALL send one `events.addSignal` or `events.removeSignal` with the resolved signal ID (signal references as in "Signal references"). `--wait` SHALL work as for every command. Origin: D-058 („the filter also needs cli"); D-059 (events-line signals, removable).

#### Scenario: Forms map to commands
- **WHEN** the argument lists `events filter faults bms`, `events filter changes -snapshots`, `events filter ""`, `events filter`, `events add testcar/Ign_A20h.MODE`, `events remove MODE` and `events frob` are parsed
- **THEN** `{"type":"events.setFilter","filter":"faults bms"}`, `{"type":"events.setFilter","filter":"changes -snapshots"}`, `{"type":"events.setFilter","filter":""}`, a usage error, `{"type":"events.addSignal","signalId":"testcar/Ign_A20h.MODE"}`, `{"type":"events.removeSignal","signalId":<MODE resolved>}` and a usage error
- **Evidence:** `apps/cli/test/args.test.ts` › "maps every command form to its command"

#### Scenario: Over HTTP
- **WHEN** `kipscope events filter Faults BMS`, `kipscope state`, `kipscope events filter 'ecu:'` run against the test server
- **THEN** the first exits 0 with a new revision; the state shows `eventFilter` `faults bms`; the last exits 1 with `invalid_filter`
- **Evidence:** `apps/cli/test/cli.test.ts` › "sets the event filter and events-line signals over HTTP"

#### Scenario: Help lists the forms
- **WHEN** `kipscope --help` runs
- **THEN** the text names `events list`, `events filter`, `events add` and `events remove` and explains FILTER in one line
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints the usage with --help" (form list extended)

### Requirement: Single-dash words are arguments
A token of one `-` followed by a character other than `-` SHALL be a positional argument, except `-h`; so `events list all -snapshots` passes `-snapshots` to the filter. Options are `--long` only, as today. Origin: necessary consequence of the filter's `-` exclusions typed without quotes (D-058, human use); existing `-<digit>` rule kept.

#### Scenario: Exclusions unquoted
- **WHEN** `events list all -snapshots -ecu:VCU`, `window rename w1 -x` and `-h` are parsed
- **THEN** filter words `all -snapshots -ecu:VCU`; title `-x`; help
- **Evidence:** `apps/cli/test/args.test.ts` › "keeps single-dash words as arguments"

### Requirement: Value in a gap
`value SIGNAL TIME` SHALL return the server's gap reason unchanged when the time lies in a gap: `data.value` `{"kind":"none","reason":"logger_gap"}` or `{"kind":"none","reason":"period_gap"}`, with exit code 0. Origin: D-062 (a cursor in a gap shows „no data"; concept §7: the CLI reads what the UI shows).

#### Scenario: Stub logger gap
- **WHEN** the stub source gives `testcar/Sna_800h.SPEED` the points 10 at 2026-10-01T02:00:01Z, 11 at 02:00:01.1Z and 12 at 02:00:05Z and the logger gap 02:00:02Z–02:00:04Z, and `value testcar/Sna_800h.SPEED 2026-10-01T02:00:03Z --mode step` runs
- **THEN** it exits 0 and `data.value` is `{"kind":"none","reason":"logger_gap"}`
- **Evidence:** `apps/cli/test/cli.test.ts` › "reads a value at a time and at a cursor" (gap case added)

#### Scenario: Real dropout
- **WHEN** `kipscope value smart451/STR_0D4h.STEER_ANGLE "2026-10-13 11:34:36.6" | jq -c .data.value` runs against the dev server
- **THEN** it prints `{"kind":"none","reason":"period_gap"}`
- **Evidence:** the command

### Requirement: View commands
The CLI SHALL offer `view list`, `view save TITLE [--name N] [--note TEXT] [--overwrite]`, `view open NAME`, `view delete NAME` and `view import FILE [--name N] [--overwrite] [--open]`, each printing one JSON line; `view open` SHALL report like a command and honour `--wait`. An unreadable FILE or one over 256 KiB SHALL be a usage error. Origin: concept §7 (everything from the shell); concept §9 („… über CLI").

#### Scenario: Forms
- **WHEN** the argument lists `view save "Drive 3" --note "BRK_LMP first" --overwrite`, `view open drive-3`, `view import x.yaml --name copy --open` and `view save` (no title) are parsed
- **THEN** the first three give the requests of design V8 (`POST /api/views {title: "Drive 3", note: "BRK_LMP first", overwrite: true}`, `POST /api/views/open {name: "drive-3"}`, an import with `name: "copy", open: true`); the last is a usage error
- **Evidence:** `apps/cli/test/args.test.ts` › "maps the view forms"

#### Scenario: Save, list, open over HTTP
- **WHEN** against the test server with a temp state dir `window create --title Speeds`, `view save Speeds`, `window remove w1`, `view open speeds` and `view list` run
- **THEN** each exits 0; the open's output has `accepted` true, a revision one higher than before and `data.report.missing` `[]`; `kipscope state` shows a window titled Speeds; the list holds `speeds` (no `_previous`: the workspace was empty before the open)
- **Evidence:** `apps/cli/test/cli.test.ts` › "saves, lists and opens views"

#### Scenario: Unknown view and existing name
- **WHEN** `view open nope` runs, and `view save Speeds` runs a second time without `--overwrite`
- **THEN** both exit 1 with `outcome` `rejected`, the first with `error.code` `unknown_view`, the second with `view_exists`
- **Evidence:** `apps/cli/test/cli.test.ts` › "saves, lists and opens views"

### Requirement: View export prints the file
`view export NAME` SHALL print the view's YAML text unchanged to stdout and exit 0; with `--out FILE` it SHALL write the text to FILE and print one JSON line with `data {name, path, bytes}`. On failure it SHALL print the usual JSON line. Origin: Jan 2026-10-17 („yaml export"); like `events list --table` (D-058), the useful output of this form is the file itself.

#### Scenario: Export round trip
- **WHEN** `kipscope view export speeds > s.yaml` runs as a separate process, then `kipscope view import s.yaml --name speeds-copy`
- **THEN** `s.yaml` starts with `kipscope: view` and the import exits 0 with `data.view.name` `speeds-copy`
- **Evidence:** `apps/cli/test/process.test.ts` › "exports a view as YAML text"

#### Scenario: Export to a file on real data
- **WHEN** `kipscope view export <name> --out /tmp/v.yaml` runs against the dev server for a saved view
- **THEN** it prints one JSON line with `data.bytes` equal to the size of `/tmp/v.yaml`, whose text equals `curl -s localhost:7310/api/views/<name>`
- **Evidence:** the command and `cmp` of the two texts

### Requirement: Link from the CLI
`view link [--page URL]` SHALL print one JSON line with `data {url, chars}`: `url` is `<page>#view=<code>` for the open workspace, built by `viewLinkUrl` like the UI's "Copy link" (design V1, round 3), and `chars` its length; `--page` SHALL default to the server address. Origin: concept §9 („Untersuchung direkt öffnen … über CLI oder Link"); design goal "the CLI can do all of it"; round-1 finding (the UI user's tool cannot read the clipboard).

#### Scenario: Link of the open workspace
- **WHEN** against the test server `window create --title Speeds` runs, then `view link --page http://127.0.0.1:5173/`, and the code after `#view=` is decoded with `decodeViewLink`
- **THEN** it exits 0, `data.url` starts with `http://127.0.0.1:5173/#view=`, `data.chars` equals the length of `data.url`, and the decoded document has one window titled Speeds; `args.test.ts` maps `view link` without `--page` to the `--server` address
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints a link to the open workspace"; `apps/cli/test/args.test.ts` › "maps the view forms"; equality with "Copy link": saved-views "Same link from web and CLI"

### Requirement: Scope commands
The CLI SHALL offer `scope set REF FROM TO`, `scope show`, `scope widen` and `scope clear` as in design Z13, each printing one JSON line and honouring `--wait`; FROM and TO follow "Time arguments". `scope widen` without a scope SHALL exit 1 with `scope_required` and send nothing; a missing or extra argument SHALL be a usage error. Origin: issue #1 item 5 („`scope set <ref> <from> <to>`"); D-078 (explicit widening); concept §7.

#### Scenario: Forms map to commands
- **WHEN** the argument lists `scope set testcar 2026-10-01T01:00:00Z 2026-10-01T02:00:00Z`, `scope clear`, `scope set testcar 2026-10-01T01:00:00Z` and `scope show extra` are parsed
- **THEN** the first two give `{"type":"scope.set","dataRef":"testcar","from":"1790816400000000000","to":"1790820000000000000"}` and `{"type":"scope.clear"}`; the last two are usage errors
- **Evidence:** `apps/cli/test/args.test.ts` › "maps the scope forms"

#### Scenario: Set, show, widen, clear over HTTP
- **WHEN** against the test server (stub catalog, full mode) `scope widen`, `scope set testcar "2026-10-01 03:00" "2026-10-01 04:00"` (TZ Europe/Berlin), `scope show`, `scope widen`, `scope show` and `scope clear` run
- **THEN** the first exits 1 with `scope_required` and the revision is unchanged; the set exits 0 with one new revision; `scope show` gives `data.scope` {testcar, T1, T2}, `data.catalog.mode` `full`, `local.from` `2026-10-01 03:00:00+02:00`; after the widen `data.scope` is {testcar, T1 − 1 h, T2 + 1 h}; the clear exits 0 and `kipscope state` shows no `scope`
- **Evidence:** `apps/cli/test/cli.test.ts` › "sets, shows, widens and clears the scope"

#### Scenario: Help lists the forms
- **WHEN** `kipscope --help` runs
- **THEN** the text names `scope set`, `scope show`, `scope widen` and `scope clear`
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints the usage with --help" (form list extended)
