## MODIFIED Requirements

### Requirement: Computed signal commands
The CLI SHALL offer `calc list`, `calc add FORMULA [--name NAME] [--unit UNIT]`, `calc edit ID|NAME [--formula F] [--name N] [--unit U]` and `calc rm ID|NAME` over the workspace commands of computed-signals (design F13 of improve-formula-editor), with signal and computed names typed in the formula and resolved as in the editor; `--a`, `--b` and `--no-b` SHALL be usage errors with a hint; `value` and `extent` SHALL take a computed ID. A refusal sends nothing. Origin: concept §7 (one command model for UI and CLI); add-computed-signals lead pick 7; names in the formula: D-106.

#### Scenario: Forms
- **WHEN** the argument lists `calc list`, `calc add "SIG_A - speed"`, `calc add "abs(SIG_A)" --name Abs --unit A`, `calc edit Diff --formula "abs(Diff2)"`, `calc rm c3`, `calc add`, `calc add "a - b" --a rpm`, `calc edit Diff --no-b` and `calc rm` are parsed
- **THEN** the first five give the forms list, add (formula), add (formula, name, unit), edit (target `Diff`, formula) and rm (`c3`); the last four are usage errors (exit 2), the two with `--a`/`--no-b` with the message `--a and --b are gone: write signal names in the formula, e.g. calc add "abs(MS_312h.DNMOT)"`
- **Evidence:** `apps/cli/test/args.test.ts` › "maps the calc forms"

#### Scenario: Add, list, edit, remove over HTTP
- **WHEN** against the test server on a workspace scoped to `testcar` `calc add "SIG_A - speed"`, `calc add 'abs("SIG_A − SPEED")'`, `calc list`, `calc rm "SIG_A − SPEED"`, `calc edit "abs(SIG_A − SPEED)" --formula "SIG_A * 2" --name Twice`, `calc rm Twice`, `calc rm "SIG_A − SPEED"` and `calc list` run
- **THEN** the adds exit 0 printing `created`; the list shows `{name: "SIG_A − SPEED", formula: "Fast_100h.SIG_A - Sna_800h.SPEED"}` (unit as `inferUnit` of their units) and `{name: "abs(SIG_A − SPEED)", formula: "abs(\"SIG_A − SPEED\")"}`; the first `rm` exits 1 with `error.code` `computed_in_use`; the edit exits 0 and stores `Fast_100h.SIG_A * 2` named `Twice`; the next two `rm` exit 0; the last list is empty
- **Evidence:** `apps/cli/test/cli.test.ts` › "adds, lists, edits and removes computed signals"

#### Scenario: Refusals and a computed value
- **WHEN** `calc add "SIG_A - nope"`, `calc add "temp + 1"` (two matches), `calc add "SIG_A %"`, `calc rm Nope` run, then after a valid `calc add` `value testcar/=<id> <time>` runs
- **THEN** the first four exit 1 with `error.code` `unknown_signal`, `ambiguous_signal` (`error.candidates` `Sna_800h.TEMP`, `Tmp_A21h.TEMP`), `invalid_formula` and `unknown_computed`, the state's revision unchanged; the `value` exits 0 with the computed value from `/api/value`
- **Evidence:** `apps/cli/test/cli.test.ts` › "refuses bad calc arguments and reads a computed value"
