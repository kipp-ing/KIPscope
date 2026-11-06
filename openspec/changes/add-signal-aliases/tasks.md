# Tasks

Built on the defaults of design.md Q-1 (stored identity stays the source name), Q-2 (JSON file via `KIPSCOPE_ALIASES_FILE`) and Q-3 (`shown` | `source`, default `shown`); if Jan picks an alternative, the spec owner revises before round 1.

No ClickHouse or ADX adapter change, no view-format change. Interfaces the groups share (pinned here so they can run in parallel): `Aliases { bySource: ReadonlyMap<string,string>; byLogical: ReadonlyMap<string,string> }` and `loadAliases(path): Aliases` in `apps/server/src/aliases.ts`; `Config.aliasesFile?: string` (config.ts); `DisplayRules.aliases: ReadonlyMap<string,string>` (names.ts); `Options.names: "shown" | "source"` and `NamesOption` (packages/shared/src/workspace.ts); `shownName(s, names?)` (packages/shared/src/signals.ts); `SignalPage.aliasOf?: string` (packages/shared/src/signals.ts).

Write areas (disjoint per group):

- 1.x: `apps/server/src/` (config.ts, aliases.ts new, names.ts, catalog.ts, main.ts, routes/signals.ts), `.env.example`
- 2.x: `packages/shared/src/` (workspace.ts, apply.ts, signals.ts, formula.ts)
- 3.x: `apps/web/src/`
- 4.x: `apps/cli/src/`
- 5.x: tests (`apps/server/test/`, `packages/shared/test/`, `apps/cli/test/`, test dictionary fixture)
- 6.x: `docs/`

## 1. Server: dictionary and shown name

- [ ] 1.1 `config.ts`: read `KIPSCOPE_ALIASES_FILE` like `KIPSCOPE_PROJECT_FILE` (relative to the repo root, required when set); `.env.example` line. Verify: scenarios "Not set" and "Path" (`config.test.ts` › "reads the aliases file path").
- [ ] 1.2 `aliases.ts`: `loadAliases` reads and checks the file (JSON object of strings; key and value rules; one-to-one; case-only twins; a key that is another entry's source name; self-entries dropped). Verify: scenarios "Named file missing", "Valid file", "Refusals" (`aliases.test.ts`).
- [ ] 1.3 `names.ts`: `DisplayRules.aliases`, kind `alias` in `assignOne` between rename and rules; collisions as design D2. `catalog.ts`: set `alias` from the dictionary. `main.ts`: load at start, log "N aliases" (and fail the start on an error). Verify: scenarios "Alias beats a rule, rename beats alias", "One entry, all data refs", "Unused entry", "A dictionary entry skips the rules" (`names.test.ts`, `catalog.test.ts`); server log line on a start with the test dictionary.
- [ ] 1.4 `routes/signals.ts`: `aliasOf` in the search answer when the query equals a logical name (ignoring case) whose source name is not in the scope's list and nothing else matched (design D4). Verify: scenario "Not in this scope" at the HTTP level (`signals.http.test.ts` › "names the source name of an unavailable alias"); a query that is no logical name has no `aliasOf`.

## 2. Shared: option, name helper, formula

- [ ] 2.1 `workspace.ts` / `apply.ts`: `options.names` (`shown` | `source`, stored default `shown`), `workspace.setOptions {digits?, names?}`, one revision, `invalid_command` for any other value. Verify: scenarios "Set names" and "Old workspace" (`apply.test.ts`, `workspace.test.ts`); the existing "sets the digits option" test with the new options object.
- [ ] 2.2 `signals.ts`: `shownName(s, names)`, `SignalPage.aliasOf`. Verify: `signals.test.ts` › "shows the source name with names=source" and the unchanged `shownName(s)` callers compile.
- [ ] 2.3 `formula.ts`: `FormulaNames.signals[].alias`; `resolveName` matches it like the short name; the canonical text keeps the source name. Verify: scenario "Formula" (`formula.test.ts` › "resolves a logical name to the canonical name"); an alias equal to a source name resolves to the source name.

## 3. Web

- [ ] 3.1 Pass `options.names` to every place that calls `shownName`: explorer rows, legend, values window, drag ghost, axis title, formula completion. Verify: scenario "Switch" (UI check, screenshots of both states) and the build.
- [ ] 3.2 "⋯" menu: a `shown | source` radiogroup next to Digits sending `workspace.setOptions {names}`. Verify: UI check (real click, menu stays open like Digits, D-112; arrow keys), `pnpm smoke`.
- [ ] 3.3 Hover card second line with the logical name; tooltips as design D5. Verify: scenario "Card, tooltip, search" (UI check, `title` text); a signal without entry shows no second line.

## 4. CLI

- [ ] 4.1 `refs.ts`: `nameMatches` accepts the alias (source name wins on equality); `unknown_signal` message from `aliasOf`. Verify: scenarios "Logical name", "Not in this scope", "Really unknown" (`refs.test.ts`).
- [ ] 4.2 `args.ts`: `names shown|source`; help text. Verify: scenarios of "Names option command" (`args.test.ts`, `cli.test.ts`).

## 5. Tests and fixtures

- [ ] 5.1 A test dictionary for the test DB (`Speed` → `Fast_100h.SIG_A`, `Revs` → `Sna_800h.RPM`, one entry without a signal) and the server tests that load it. Verify: the tests of groups 1 to 4 find it; the suite without the variable is green and unchanged.
- [ ] 5.2 Identity scenarios: save and open a view with the dictionary on, then with the entry removed. Verify: scenarios "Add by logical name" and "Entry removed" (`views.http.test.ts`, `aliases.http.test.ts`).
- [ ] 5.3 Whole run: `pnpm build`, tests, lint, `pnpm smoke` and `pnpm smoke --preview` with and without `KIPSCOPE_ALIASES_FILE`. Verify: all green, output kept in `rounds.md`.

## 6. Docs

- [ ] 6.1 `docs/data-sources.md` (variable in the table, file format, rules of the checks, the one-dictionary-per-server note), `docs/http-api.md` (`aliasOf`, `options.names`), `docs/manual.md` (the switch, `names`), `docs/handoff.md` (one paragraph for the search tool that writes the file; the product is called "search tool"). Verify: every new variable appears in the variables table (the docs test) and the example file loads with `loadAliases`.
- [ ] 6.2 `docs/decisions.md` D-122 from design D1 to D5 with Jan's Q-1 to Q-3 answers; `docs/status.md`. Verify: status names the change, its evidence and what was not run.

## Workflow follow-up

- Round flow per [docs/team.md](../../../docs/team.md); archive after Jan's OK; commit each coherent step and push at the end (AGENTS.md).
