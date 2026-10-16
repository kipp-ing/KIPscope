## ADDED Requirements

### Requirement: Attribution in the help
The last line of the `--help` text SHALL be `attributionText()` (`app-footer` design F1): `KIPscope © 2026 Jan Kipping, Agentic engineer, https://kipp.ing · Attribution Assurance License (AAL)`. Command results SHALL NOT carry it. Origin: AAL clause 2 (attribution when the program is launched), per D-049; "One JSON result per call" keeps it out of results; pending Jan's call Q4.

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
