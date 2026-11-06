## Purpose

Lets the system that starts the server hand KIPscope a dictionary of logical signal names, so users work with the same names in the UI, the CLI and formulas, while signal identity, stored workspaces and views stay on the source names of the data.

## ADDED Requirements

### Requirement: Aliases file
The server SHALL read `KIPSCOPE_ALIASES_FILE` once at start: a UTF-8 JSON object of logical name to source name (`{"Speed": "ICL_3A2h.SPEED_DISP"}`). A relative path SHALL resolve against the repo root. Without the variable there SHALL be no aliases. A named file that does not exist SHALL stop the server. Edits SHALL take effect on restart only.

#### Scenario: Not set
- **WHEN** `loadConfig` runs without `KIPSCOPE_ALIASES_FILE`
- **THEN** the aliases are empty and no catalog entry has `alias` from this source
- **Evidence:** `apps/server/test/config.test.ts` › "reads the aliases file path"

#### Scenario: Path
- **WHEN** `loadConfig` runs with root `/repo/kipscope`, once with `KIPSCOPE_ALIASES_FILE=conf/a.json`, once with `/abs/a.json`
- **THEN** the file is `/repo/kipscope/conf/a.json`, then `/abs/a.json`
- **Evidence:** `apps/server/test/config.test.ts` › "reads the aliases file path"

#### Scenario: Named file missing
- **WHEN** the variable names a file that does not exist
- **THEN** loading fails with `<path>: file not found`
- **Evidence:** `apps/server/test/aliases.test.ts` › "fails for a missing file"

### Requirement: One dictionary per server
One dictionary SHALL hold for the whole server, for every data ref and database; an entry applies to every signal of that source name. An entry whose logical name equals its own source name SHALL be accepted and have no effect.

#### Scenario: Two data refs
- **WHEN** the dictionary holds one entry and two data refs hold that source name
- **THEN** both signals have the entry's logical name
- **Evidence:** `apps/server/test/catalog.test.ts` › "applies one dictionary to every data ref"

### Requirement: Aliases file is checked at start
The server SHALL refuse to start on a file that is not a JSON object of strings, naming the file and the offending key: a blank or padded logical name, one longer than 256 characters or with a control character, a blank source name, or a non-string value. It SHALL also refuse two logical names with one source name, two that differ only in letter case, and a logical name that is the source name of another entry, naming both entries.

#### Scenario: Valid file
- **WHEN** the file is `{"Speed": "ICL_3A2h.SPEED_DISP", "RPM": "Sna_800h.RPM", "WSPD_FL": "WSPD_FL"}`
- **THEN** loading yields two effective entries (`Speed`, `RPM`); the third has no effect
- **Evidence:** `apps/server/test/aliases.test.ts` › "reads a valid dictionary"

#### Scenario: Refusals
- **WHEN** the file is not JSON; or is a JSON array; or holds `{"": "A"}`; or `{" Speed": "A"}`; or `{"Speed": 3}`; or `{"X": "A", "Y": "A"}`; or `{"Speed": "A", "speed": "B"}`; or `{"A": "B", "B": "C"}`
- **THEN** each load fails with a message naming the file, and the last three name the keys `X` and `Y`, `Speed` and `speed`, and `A` and `B`
- **Evidence:** `apps/server/test/aliases.test.ts` › "refuses an invalid dictionary"

### Requirement: Identity stays on the source name
Signal IDs, workspace state, commands, views, links, grants and the CLI's output SHALL stay on `<data ref>/<source name>`. A logical name SHALL never be stored or written to a file. Removing or renaming an entry and restarting SHALL therefore leave every stored workspace and view valid.

#### Scenario: Add by logical name
- **WHEN** the dictionary holds `Speed` → `Fast_100h.SIG_A`, the scope's data ref is `testcar`, and the CLI runs `signal add w1 Speed`
- **THEN** the CLI output and the workspace hold `testcar/Fast_100h.SIG_A`, never `Speed`; saving a view and reading the file shows the same ID
- **Evidence:** `apps/cli/test/` › "adds a signal by its logical name"; `apps/server/test/views.http.test.ts` › "keeps source names in a saved view"

#### Scenario: Entry removed
- **WHEN** a view was saved with `testcar/Fast_100h.SIG_A`, the entry `Speed` is removed and the server restarts
- **THEN** the view opens with the signal, shown as `Fast_100h.SIG_A` (or its rule-made short name)
- **Evidence:** `apps/server/test/aliases.http.test.ts` › "opens a view after an entry was removed"

### Requirement: Shown name from the dictionary
A signal whose source name has an entry SHALL show the logical name as its shown name in every place that shows a shown name (display-names), unless `display.rename` names the signal. The dictionary SHALL beat name rules. The catalog entry SHALL carry the logical name as `alias`.

#### Scenario: Alias beats a rule, rename beats alias
- **WHEN** the dictionary holds `Speed` → `ICL_3A2h.SPEED_DISP` and `Rpm` → `Sna_800h.RPM`, a rule shortens every name to the part after the dot, and `display.rename` maps `Sna_800h.RPM` to `Revs`
- **THEN** the entry of `ICL_3A2h.SPEED_DISP` has `displayName` `Speed` and `alias` `Speed`; the entry of `Sna_800h.RPM` has `displayName` `Revs` and `alias` `Rpm`
- **Evidence:** `apps/server/test/names.test.ts` › "ranks rename, alias, rules"; `apps/server/test/catalog.test.ts` › "fills alias from the dictionary"

#### Scenario: One entry, all data refs
- **WHEN** two data refs hold `Fast_100h.SIG_A` and the dictionary maps it to `Speed`
- **THEN** both entries show `Speed`
- **Evidence:** `apps/server/test/catalog.test.ts` › "applies one dictionary to every data ref"

#### Scenario: Unused entry
- **WHEN** the scope's catalog holds no signal named by an entry
- **THEN** the server starts and loads the catalog without a warning about that entry
- **Evidence:** `apps/server/test/catalog.test.ts` › "ignores entries without a signal"

### Requirement: Input by logical name
Wherever a caller names a signal by its name, a logical name SHALL be accepted like the source name: the CLI's bare-name arguments and the typed names in formulas. A source name SHALL win over a logical name that equals it. A formula SHALL be stored with the canonical source name.

#### Scenario: CLI bare name
- **WHEN** the dictionary holds `Speed` → `ICL_3A2h.SPEED_DISP` and the CLI runs `signal add w1 Speed` and `signal add w1 speed_disp`
- **THEN** both add `smart451/ICL_3A2h.SPEED_DISP`; the second is rejected as a duplicate in the same window
- **Evidence:** `apps/cli/test/refs.test.ts` › "resolves a logical name"

#### Scenario: Formula
- **WHEN** a user types `Speed * 3.6` in the formula editor and `Speed` is an entry
- **THEN** the formula is accepted and stored as `ICL_3A2h.SPEED_DISP * 3.6`
- **Evidence:** `packages/shared/test/formula.test.ts` › "resolves a logical name to the canonical name"

### Requirement: Unavailable logical name
A logical name whose source name has no signal in the case's scope SHALL be refused by the CLI and the API with `unknown_signal` and a message that names the source name it stands for and says that the scope has no such signal. It SHALL NOT be reported as an unknown name.

#### Scenario: Not in this scope
- **WHEN** the dictionary holds `Boost` → `ECM_1B0h.BOOST` and the scope's data ref has no `ECM_1B0h.BOOST`, and the CLI runs `signal add w1 Boost`
- **THEN** it is rejected with `unknown_signal` and the message `"Boost" stands for ECM_1B0h.BOOST, which this scope has no signal for`
- **Evidence:** `apps/cli/test/refs.test.ts` › "names the source name of an unavailable alias"

#### Scenario: Really unknown
- **WHEN** the CLI runs `signal add w1 Nope` and `Nope` is neither a signal name nor an entry
- **THEN** it is rejected with `unknown_signal` and the message `no signal named "Nope"`, as before
- **Evidence:** `apps/cli/test/refs.test.ts` › "keeps the unknown-name message"

### Requirement: Names option
The UI SHALL offer a choice of what signals show: `shown` (default: logical name, else the name of the rules, else the source name) or `source` (the full source name everywhere). The choice SHALL be a user option of the workspace, set in the "⋯" menu next to Digits and by `kipscope names shown|source`. It SHALL apply at once to the explorer, legends, values windows, drag ghosts and axis titles, and SHALL NOT change any stored signal ID.

#### Scenario: Switch
- **WHEN** `ICL_3A2h.SPEED_DISP` is in a chart, the dictionary shows it as `Speed`, and the user picks `source` in the "⋯" menu
- **THEN** the explorer row, the legend row and the values row read `ICL_3A2h.SPEED_DISP` without a reload; picking `shown` brings `Speed` back
- **Evidence:** UI check (screenshots of both states)

#### Scenario: Default
- **WHEN** a workspace stored before this change is read
- **THEN** its option `names` is `shown`
- **Evidence:** `packages/shared/test/workspace.test.ts` › "reads a workspace without names"

### Requirement: Both names stay reachable
The hover card SHALL show the logical name and the full source name, and the tooltip of a name in explorer rows, legend rows and values rows SHALL be the other name than the one shown. The explorer search SHALL match a signal by logical name or source name whatever the option says.

#### Scenario: Card, tooltip, search
- **WHEN** `ICL_3A2h.SPEED_DISP` shows as `Speed` and the user rests the pointer on the explorer row, then types `icl_3a2` in the search
- **THEN** the card's first line reads `ICL_3A2h.SPEED_DISP` and a second line reads `Speed`; the row's tooltip reads `ICL_3A2h.SPEED_DISP`; the search finds the row
- **Evidence:** UI check (screenshot of the card; tooltip text via `title`); `packages/shared/test/search.test.ts` › "finds a signal by its alias"
