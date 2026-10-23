## ADDED Requirements

### Requirement: Computed signal commands
The CLI SHALL offer `calc list`, `calc add FORMULA --a SIGNAL [--b SIGNAL] [--name NAME] [--unit UNIT]`, `calc edit ID|NAME [--formula F] [--a S] [--b S | --no-b] [--name N] [--unit U]` and `calc rm ID|NAME` over the workspace commands of computed-signals (design C13); `value` and `extent` SHALL take a computed ID. A refusal sends nothing. Origin: concept §7 (one command model for UI and CLI); lead pick 7.

#### Scenario: Forms
- **WHEN** the argument lists `calc list`, `calc add "a - b" --a rpm --b speed`, `calc edit Diff --formula "abs(a)" --no-b`, `calc rm c3`, `calc add`, `calc add "a"` and `calc rm` are parsed
- **THEN** the first four give the forms list, add (formula, a, b), edit (target `Diff`, formula, b removed) and rm (`c3`); the last three are usage errors (exit 2)
- **Evidence:** `apps/cli/test/args.test.ts` › "maps the calc forms"

#### Scenario: Add, list, edit, remove over HTTP
- **WHEN** against the test server on a workspace scoped to `testcar` `calc add "a - b" --a SIG_A --b speed`, `calc list`, `calc edit "SIG_A − SPEED" --formula "abs(a)" --no-b --name Abs`, `calc list`, `calc rm Abs` and `calc list` run
- **THEN** each exits 0; the add prints `created` `c<n>` and the list shows `{id: c<n>, name: "SIG_A − SPEED", formula: "a - b", a: "Fast_100h.SIG_A", b: "Sna_800h.SPEED"}` (unit as `inferUnit` of their units); the edit prints a new `created` and the list shows `{name: "Abs", formula: "abs(a)", a: "Fast_100h.SIG_A"}` without `b`; the last list is empty
- **Evidence:** `apps/cli/test/cli.test.ts` › "adds, lists, edits and removes computed signals"

#### Scenario: Refusals and a computed value
- **WHEN** `calc add "a - c" --a SIG_A`, `calc add "a" --a temp` (two matches), `calc rm Nope` run, then after a valid `calc add` `value testcar/=<id> <time>` runs
- **THEN** the first three exit 1 with `error.code` `invalid_formula`, `ambiguous_signal` (`error.candidates` the two names) and `unknown_computed`, the state's revision unchanged; the `value` exits 0 with the computed value from `/api/value`
- **Evidence:** `apps/cli/test/cli.test.ts` › "refuses bad calc arguments and reads a computed value"
