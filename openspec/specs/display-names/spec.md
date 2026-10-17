# display-names Specification

## Purpose
Lets each project define, in a YAML file, the short names the UI shows for its signals, while signal identity, the API's IDs and the CLI stay on the full source names.

## Requirements

### Requirement: Project file location
The server SHALL read the project file once at start: `kipscope.yaml` in the repo root, or the file named by `KIPSCOPE_PROJECT_FILE` (relative to the repo root). Without the default file every signal SHALL show its full source name; a missing file named by the variable SHALL stop the server. Edits SHALL take effect on restart only; a catalog refresh SHALL NOT reread the file. Origin: D-035 (lead's defaults); missing named file, restart only: design N1.

#### Scenario: Default and overridden path
- **WHEN** the config is loaded with root `/repo/kipscope`, once without `KIPSCOPE_PROJECT_FILE`, once with `KIPSCOPE_PROJECT_FILE=conf/p.yaml`, once with `/abs/p.yaml`
- **THEN** the project file is `/repo/kipscope/kipscope.yaml` (optional), then `/repo/kipscope/conf/p.yaml` (required), then `/abs/p.yaml` (required)
- **Evidence:** `apps/server/test/config.test.ts` › "resolves the project file path"

#### Scenario: No file
- **WHEN** the optional default file does not exist
- **THEN** loading it yields no rules and no renames, and the catalog lists every signal without `displayName`
- **Evidence:** `apps/server/test/project.test.ts` › "returns no rules for a missing optional file and fails for a missing required one"

#### Scenario: Named file missing
- **WHEN** `KIPSCOPE_PROJECT_FILE` names a file that does not exist
- **THEN** loading fails with `<path>: file not found`
- **Evidence:** `apps/server/test/project.test.ts` › "returns no rules for a missing optional file and fails for a missing required one"

### Requirement: Name rules
`display.names` SHALL be an ordered list of rules, each a regular expression `match` with named groups and a template `show` over those groups (`{group}`). A signal SHALL show the `show` of the first rule matching its source name (without data reference); a group that did not take part renders empty. No matching rule, or an empty render, SHALL show the full source name. Origin: D-035 (rules, first match wins, full name without a match); empty render: design N3.

#### Scenario: First match wins
- **WHEN** rule 1 is `^(?<message>[^.]+?)_[0-9A-Fa-f]+h\.(?<signal>.+)$` / `{signal}` and rule 2 is `^(?<message>[^.]+)\.(?<signal>.+)$` / `{message}-{signal}`
- **THEN** `ICL_3A2h.SPEED_DISP` shows `SPEED_DISP`, `STR_0D4h.STEER_CHKSUM` shows `STEER_CHKSUM`, and `CLIM_A1.T_SET` shows `CLIM_A1-T_SET`
- **Evidence:** `apps/server/test/names.test.ts` › "takes the first matching rule and renders its template"

#### Scenario: No rule matches
- **WHEN** rule 1 is `^(?<message>[^.]+?)_[0-9A-Fa-f]+h\.(?<signal>.+)$` / `{signal}` and rule 2 is `^X(?<rest>.*)$` / `{rest}`
- **THEN** `VIN.VIN_1` shows `VIN.VIN_1` (no match), and `X` shows `X` (the second rule matches but renders empty)
- **Evidence:** `apps/server/test/names.test.ts` › "keeps the full name without a matching rule or with an empty render"

### Requirement: Renames beat rules
The file's `display.rename` SHALL map full source names to shown names; a signal listed there SHALL show that name whatever the rules say. A rename key that names no signal in the catalog SHALL be ignored. Origin: D-035 („an optional `rename` map for single signals (rename beats rules)").

#### Scenario: Rename over a rule
- **WHEN** rule `^(?<message>[^.]+?)_[0-9A-Fa-f]+h\.(?<signal>.+)$` / `{signal}` applies and `rename` maps `ICL_3A2h.SPEED_DISP` to `Speed` and `NOPE_1h.X` to `Nope`
- **THEN** `ICL_3A2h.SPEED_DISP` shows `Speed`, `BRK_1A0h.WSPD_FL` shows `WSPD_FL`, and `NOPE_1h.X` (not in the input) causes no error
- **Evidence:** `apps/server/test/names.test.ts` › "lets a rename beat every rule"

### Requirement: Collisions show the message suffix
When signals with different source names get the same shown name, each of them made by a rule with a `collision` template SHALL show that template's render instead (smart451: `SPEED_DISP (ICL)`). Renamed signals and full names SHALL stay. The same source name in two data references SHALL NOT count as a collision; the check covers the whole catalog. Origin: D-035 (short name plus message suffix on a collision); per-rule template, renames kept: design N5, Q2.

#### Scenario: Two messages, one signal name
- **WHEN** the smart451 rules (design N10) see `ICL_3A2h.SPEED_DISP` and `KOMBI_512h.SPEED_DISP`
- **THEN** they show `SPEED_DISP (ICL)` and `SPEED_DISP (KOMBI)`, while `BRK_1A0h.WSPD_FL` shows `WSPD_FL`
- **Evidence:** `apps/server/test/names.test.ts` › "suffixes colliding rule names with the collision template"

#### Scenario: Rename collides with a rule name
- **WHEN** the test project file (design N10) is loaded on the test DB, where `Irr_200h.JITTER` is renamed to `SPEED` and the rules make `Sna_800h.SPEED` into `SPEED`
- **THEN** `Irr_200h.JITTER` shows `SPEED` and `Sna_800h.SPEED` shows `SPEED (Sna)`
- **Evidence:** `apps/server/test/catalog.test.ts` › "sets display names from the test project file"

#### Scenario: Same name in two data references
- **WHEN** the test project file is loaded and `Fast_100h.SIG_A` exists in `testcar` and `othercar`
- **THEN** both entries show the same name and that pair alone causes no suffix and no fallback
- **Evidence:** `apps/server/test/names.test.ts` › "suffixes colliding rule names with the collision template" (input of distinct names); `apps/server/test/catalog.test.ts` › "sets display names from the test project file" (both entries agree)

### Requirement: Remaining collisions show full names
When shown names still collide after the collision templates, every signal sharing such a name that does not already show its own full source name SHALL show its full source name, repeated until no shown name is shared by two source names. The server SHALL log one warning per catalog load naming how many signals fell back and up to ten of them. Origin: necessary consequence of D-035 (two signals must not look alike; full names are unique); counter suffixes rejected (design N5).

#### Scenario: Suffix still collides
- **WHEN** the test project file is loaded on the test DB, where rule 1 makes `Fast_100h.SIG_A`, `SIG_B` and `SIG_C` into `SIG` and its collision template into `SIG (Fast)` for all three
- **THEN** all three show their full source names (no `displayName`), and the catalog's fallback list holds exactly these three names
- **Evidence:** `apps/server/test/catalog.test.ts` › "sets display names from the test project file"; `apps/server/test/names.test.ts` › "falls back to full names while names still collide" (also: a rename `B.Y` → `A.X`, the full name of another signal, makes `B.Y` show `B.Y`)

### Requirement: Invalid project file stops the server
A project file with a YAML syntax error, a duplicate or unknown key, a missing or empty `match` or `show`, an invalid regular expression, a placeholder naming no group of its rule, a stray `{` or `}`, or an empty rename value SHALL stop the server before it listens, with exit code 1 and one line per problem on stderr in the form `<path>: <field>: <problem>`. Origin: necessary consequence of D-035 (a typo would otherwise silently show wrong names); refuse versus warn: design Q1.

#### Scenario: Regex and template errors
- **WHEN** `apps/server/test/fixtures/kipscope.bad.yaml` holds rule 0 with `match: '^(?<message>[A-Z+)\.(?<signal>.+)$'`, rule 1 with `match: '^(?<message>[^.]+)\.(?<signal>.+)$'` and `show: '{sig}'`, and rule 2 with the same match and `show: '{signal'`
- **THEN** parsing fails with exactly three lines: `display.names[0].match: invalid regex: …Unterminated character class`, `display.names[1].show: unknown group "sig" (groups: message, signal)`, `display.names[2].show: stray "{" at column 1`, each prefixed by the path
- **Evidence:** `apps/server/test/project.test.ts` › "reports every problem with file, field and reason"

#### Scenario: Structure errors
- **WHEN** the text has `display: { names: [{ match: 'a', colision: 'x' }], renames: {} }`, or a rename `A.B: ''`, or the same rename key twice
- **THEN** parsing fails naming `display: unknown key "renames"`, `display.names[0]: unknown key "colision"` and the missing `display.names[0].show`; `display.rename.A.B: empty name`; and a `yaml:` line with the duplicate key's line
- **Evidence:** `apps/server/test/project.test.ts` › "reports every problem with file, field and reason"

#### Scenario: Server refuses to start
- **WHEN** the server is started with `KIPSCOPE_PROJECT_FILE=apps/server/test/fixtures/kipscope.bad.yaml`
- **THEN** it prints `kipscope: invalid project file` and the three lines of "Regex and template errors" on stderr, exits with code 1, and port 7310 was never opened
- **Evidence:** command `cd apps/server && KIPSCOPE_PROJECT_FILE=apps/server/test/fixtures/kipscope.bad.yaml KIPSCOPE_PORT=7399 node --env-file-if-exists=../../.env src/main.ts; echo "exit $?"` prints those lines and `exit 1`

### Requirement: Display names come from the server
The server SHALL compute every signal's shown name once per catalog load and deliver it in each catalog entry as `displayName`, absent when it equals `name`. Signal IDs, `name`, workspace state, commands and the CLI's arguments and output SHALL stay on the full source names. Origin: D-035 („CLI and API keep the stable full IDs"); server-side computation: necessary consequence of one source of truth for UI and API search (design N7).

#### Scenario: Catalog entry with a display name
- **WHEN** the server runs on real data with the local `kipscope.yaml`
- **THEN** `curl -s 'localhost:7310/api/signals?q=ICL_3A2h.SPEED_DISP' | jq -c '.items[0] | {id, name, displayName}'` prints `{"id":"smart451/ICL_3A2h.SPEED_DISP","name":"ICL_3A2h.SPEED_DISP","displayName":"SPEED_DISP"}`
- **Evidence:** the curl command; `apps/server/test/signals.http.test.ts` › "returns displayName in search and full catalog and keeps IDs" (test DB with the test project file: `testcar/Sna_800h.RPM` has `displayName` `RPM`, `testcar/Fast_100h.SIG_A` has none)

#### Scenario: All real signals shortened, none alike
- **WHEN** the server runs on real data with the local `kipscope.yaml`
- **THEN** `curl -s localhost:7310/api/catalog | jq '[.items[] | select(.displayName)] | length'` prints `428` and `curl -s localhost:7310/api/catalog | jq '[.items[].displayName] | unique | length'` prints `428`, and the server log has no display-name collision warning
- **Evidence:** the two curl commands; server log excerpt

#### Scenario: Identity unchanged
- **WHEN** the CLI runs `signal add w1 SPEED_DISP` against the server on real data with the shipped file, and the workspace is read
- **THEN** the CLI output and the workspace hold `smart451/ICL_3A2h.SPEED_DISP`, never `SPEED_DISP` as an ID
- **Evidence:** command `node apps/cli/src/main.ts signal add <window> SPEED_DISP` output; `curl -s localhost:7310/api/workspace | jq` excerpt

#### Scenario: No file, no field
- **WHEN** the catalog is built without a project file (test DB)
- **THEN** no entry has `displayName` (nor `group`, capability `signal-groups`) and every existing catalog `toEqual` test passes with no change other than `sender: "TEST"` in its `dbc` object (D-053)
- **Evidence:** `apps/server/test/catalog.test.ts` › "lists a signal without DBC entry with its name only" (unchanged) and › "merges DBC unit and comment as description" (only `sender` added)

### Requirement: Shown name in the UI
Explorer rows, chart legend rows, values window rows, the drag ghost and the title of a unit-less signal's y axis SHALL show the signal's shown name. The hover card SHALL keep the full source name, and where the shown name differs from it, the shown name's tooltip in explorer rows, legend rows and values rows SHALL be the full source name. Origin: D-035 („The full source name stays in the hover card and tooltips").

#### Scenario: Short names on real data
- **WHEN** with the local `kipscope.yaml` the user searches `SPEED_DISP`, adds `ICL_3A2h.SPEED_DISP` and `BRK_1A0h.WSPD_FL` to a timeseries window and to a values window
- **THEN** the explorer row reads `SPEED_DISP`, the legend rows read `SPEED_DISP` and `WSPD_FL`, the values rows read `SPEED_DISP` and `WSPD_FL`, and no row shows `ICL_3A2h` or `412h`
- **Evidence:** UI check (one screenshot with explorer, chart and values window)

#### Scenario: Full name in card and tooltip
- **WHEN** the user rests the pointer on the explorer row `SPEED_DISP`, then on the name `SPEED_DISP` in the legend and in the values window
- **THEN** the hover card's first line reads `ICL_3A2h.SPEED_DISP`, and both name tooltips read `ICL_3A2h.SPEED_DISP`
- **Evidence:** UI check (screenshot of the card; tooltip text via `title` attribute of `.sig`)

#### Scenario: Drag ghost
- **WHEN** the user drags the explorer row `SPEED_DISP` over a window that does not show it
- **THEN** the ghost reads `SPEED_DISP · add`
- **Evidence:** UI check (screenshot during the drag)

### Requirement: Example project file shipped, real one local
The repository SHALL ship `kipscope.example.yaml` explaining every key, with rules that shorten a signal to its part after the message (with or without hex ID) and suffix collisions with the message name, and `demo/kipscope.yaml` for the demo recording. `kipscope.yaml` SHALL be local and gitignored, so the rules for a real vehicle's DBC never enter the repo. README SHALL describe the file, its keys, `KIPSCOPE_PROJECT_FILE` and that edits need a restart. Origin: D-035 („so it will be just SPEED_DISP in this case"); 55 names without hex ID: design Q4; local file: D-077.

#### Scenario: Shipped files parse
- **WHEN** `kipscope.example.yaml` is parsed and applied to `ICL_3A2h.SPEED_DISP`, `STR_0D4h.STEER_CHKSUM`, `DCU_2B8h.HTR_HV_Volt`, `CLIM_A1.T_SET` and `DIAG_CLIM.DIAG_CLIM`, and `demo/kipscope.yaml` to `VEH_200h.VehSpeed`
- **THEN** both parse without error; the first yields `SPEED_DISP`, `STEER_CHKSUM`, `HTR_HV_Volt`, `T_SET`, `DIAG_CLIM`, the second `VehSpeed`
- **Evidence:** `apps/server/test/project.test.ts` › "parses kipscope.example.yaml", "parses the demo project file: names, measurement and events (D-076)"

#### Scenario: README
- **WHEN** a reader opens README.md
- **THEN** a section "Display names" shows the smart451 rules, explains `match`, `show`, `collision`, `rename`, the first-match and rename-beats-rules order, the collision fallback, `KIPSCOPE_PROJECT_FILE` and "restart the server after editing"
- **Evidence:** `grep -n "Display names\|KIPSCOPE_PROJECT_FILE" README.md`
