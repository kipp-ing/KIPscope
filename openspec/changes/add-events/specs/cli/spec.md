## MODIFIED Requirements

### Requirement: One JSON result per call
Each call SHALL print exactly one JSON object on one line to stdout (indented with `--pretty`) with `ok`, `outcome` and `exitCode` and, where they apply, `accepted`, `command`, `revision`, `created`, `createdWindow`, `render`, `data`, `local` and `error {code, message}`, except that a successful `events list --table` prints its table. A failed call SHALL also print one line naming the reason to stderr. Origin: concept §7 („maschinenlesbare Ergebnisse"); table: D-058.

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

## ADDED Requirements

### Requirement: Event list
`events list [FILTER…] [--ref DATAREF] [--from TIME --to TIME] [--table]` SHALL return `GET /api/events` for the data ref (`--ref`, else that of the first signal in window order, else rejected with `no_data_ref`) with the workspace's events-line signals and the FILTER words (none: the workspace filter), plus `data.description` and the local times in `local.t`; `--table` SHALL print the lines of design C1. Origin: D-058 („the filter also needs cli"); concept §7.

#### Scenario: JSON and filter
- **WHEN** against the CLI test server (stub events: the 18 testcar events; window `w1` shows `testcar/Sna_800h.RPM`) `kipscope events list`, `kipscope events list faults ecu:bms`, `kipscope events list changes -snapshots --from 2026-10-01T00:00Z --to 2026-10-01T03:00Z` and `kipscope events list 'ecu:'` run
- **THEN** the first returns 7 events (the workspace's default `faults changes`: 5 faults, 2 changes) with `data.filter` `faults changes`, `data.description` `Faults and state changes` and `data.total` 18; the second 5 events; the third 2; the last exits 1 with `invalid_filter`
- **Evidence:** `apps/cli/test/cli.test.ts` › "lists events with the workspace filter or the given one"

#### Scenario: Table
- **WHEN** `TZ=Europe/Berlin kipscope events list changes --table` runs against the CLI test server
- **THEN** stdout holds two event lines, the first `2026-10-01 03:03:00.000+02:00  State change  VCU  VCU.door  closed → open`, and the last line `2 of 18 events · changes · State changes`; exit 0
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints events as a table"

#### Scenario: Events on smart451
- **WHEN** `kipscope events list --table` runs against the dev server with the shipped project file and the default filter
- **THEN** 55 event lines, the last line `55 of 402 events · faults changes · Faults and state changes`
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
