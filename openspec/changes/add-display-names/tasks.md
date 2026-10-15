# Tasks

Write areas are disjoint; all of group 1–3 builds in parallel against the interfaces pinned in design N3 (`names.ts` types), N6 (`project.ts`), N7 (`SignalInfo.displayName`, `shownName`) and N8 (`SignalMatch.shown`). Group 4 (tester) writes the tests test-first in parallel. The tasks assume the recommended answers to design "Open Questions" (Q1 refuse to start, Q2 rename kept and rule names suffixed, Q3 catalog order by full name, Q4 both smart451 rules).

- 1.1: `packages/shared/src/signals.ts`, `packages/shared/src/search.ts`
- 2.1: `apps/server/src/config.ts`, `apps/server/src/project.ts` (new), `apps/server/src/main.ts`, `apps/server/package.json`, `pnpm-lock.yaml`, `.env.example`
- 2.2: `apps/server/src/names.ts` (new), `apps/server/src/catalog.ts`, repo root `letsview.yaml` (new), `letsview.example.yaml` (new), `README.md`
- 3.1: `apps/web/src/explorer/SignalExplorer.tsx`, `apps/web/src/chart/TimeseriesWindow.tsx`, `apps/web/src/values/ValuesWindow.tsx`, `apps/web/src/App.tsx`
- 4.1, 4.2: `packages/shared/test/`, `apps/server/test/` (incl. `fixtures/`)

## 1. packages/shared

- [ ] 1.1 Display name in the DTO and in search (`signals.ts`, `search.ts`), per design N7, N8:
  - `SignalInfo.displayName?: string` (doc comment as pinned), `shownName(s)` exported from the package index.
  - `Fields.shown`; tiers 0–2 as in signal-catalog "Search ranking" (shown equals → 0, starts with → 1, contains → 2); `SignalMatch.shown` ranges in `shownName(signal)`, `[]` for an empty query.
  - Verify `packages/shared/test/search.test.ts` › "ranks the shown name like the name" and "returns highlight ranges in the shown name" (from 4.1) pass and every existing search test, including "ranks 10,000 signals in under 50 ms", stays green.

## 2. apps/server/src and repo root

- [ ] 2.1 Project file loading (`config.ts`, `project.ts` new, `main.ts`, `package.json`, `.env.example`), per design N1, N2, N3, N6:
  - `pnpm --filter @letsview/server add yaml@2.8.1 --save-exact`.
  - `Config.projectFile` from `LETSVIEW_PROJECT_FILE` (N1); `.env.example` gets `# LETSVIEW_PROJECT_FILE=letsview.yaml` under "Optional".
  - `ProjectFileError`, `parseProjectFile(text, path)`, `loadProjectFile(file)`: `yaml` `parse` with `uniqueKeys: true`, strict zod schema, three check stages, template parsing and group check via the empty-alternative `exec("")`, messages exactly as in the N6 table; returns `DisplayRules` (types from `names.ts`, task 2.2).
  - `main.ts`: load before building the catalog; on `ProjectFileError` write `letsview: invalid project file` and the message to stderr, `process.exit(1)` before `listen`; info line for a missing optional file; pass the rules to `new Catalog(…, rules)`; after each catalog load the `warn` line of N5 when `catalog.displayFallbacks` is not empty.
  - Verify `apps/server/test/config.test.ts` › "resolves the project file path" and `apps/server/test/project.test.ts` (from 4.2) pass, and the command of display-names "Server refuses to start" prints the three lines and `exit 1`.
- [ ] 2.2 Name assignment and catalog field (`names.ts` new, `catalog.ts`), per design N3, N4, N5, N7:
  - `Template`, `DisplayRule`, `DisplayRules`, `NO_RULES`, `renderTemplate`, `DisplayResult`, `assignDisplayNames` exactly as pinned in N3; N4 order (rename, first matching rule, full name; empty render → full name); N5 steps 1–4 with the fallback loop.
  - `Catalog` constructor third parameter `rules = NO_RULES`; `refresh()` assigns over the distinct source names and sets `displayName` only where it differs from `name`; `displayFallbacks` property; catalog order unchanged.
  - Verify `apps/server/test/names.test.ts`, `apps/server/test/catalog.test.ts` › "sets display names from the test project file" and `apps/server/test/signals.http.test.ts` › "returns displayName in search and full catalog and keeps IDs" (from 4.2) pass, and the existing catalog tests pass unchanged.
- [ ] 2.3 Shipped files (repo root `letsview.yaml`, `letsview.example.yaml`, `README.md`), per design N10, display-names "smart451 project file shipped":
  - `letsview.yaml` exactly as N10; `letsview.example.yaml` with the same rules, a commented `rename` example and one comment per key.
  - README section "Display names" (after "Using the app"): the rules, `match`/`show`/`collision`/`rename`, first match wins, rename beats rules, collision suffix and full-name fallback, `LETSVIEW_PROJECT_FILE`, restart after editing, invalid file stops the server.
  - Verify `apps/server/test/project.test.ts` › "parses the shipped letsview.yaml and letsview.example.yaml" passes and `grep -n "Display names\|LETSVIEW_PROJECT_FILE" README.md` finds the section.

## 3. apps/web/src

- [ ] 3.1 Shown name in every UI place (`explorer/SignalExplorer.tsx`, `chart/TimeseriesWindow.tsx`, `values/ValuesWindow.tsx`, `App.tsx`), per design N9:
  - Explorer row: `shownName(s)` with `m.shown` highlight, `title={s.name}` on the name element when `displayName` is present.
  - Chart: `SignalInput.label = shownName(meta)` (series label and unit-less axis title); legend `.sig` shows `shownName(meta)` with `title={meta.name}` when it differs.
  - Values window: `.sig` shows `breakable(shownName(meta))` with the same title rule.
  - Drag ghost: `label = shownName(info)`.
  - Hover card (`explorer/SignalCard.tsx`) stays on `signal.name` / `match.name`: no edit.
  - Fallback without metadata stays the signal ID everywhere.
  - Verify `pnpm build && pnpm test && pnpm lint` is green (existing `apps/web/test/explorer.test.ts`, `drag.test.ts`, `build.test.ts`, `axes.test.ts` unchanged), plus the UI checks display-names "Short names on real data", "Full name in card and tooltip", "Drag ghost"; signal-catalog "SNA values shown in explorer", "Highlight in the name", "Description match shown in the card", "Drag a row onto a window", "Drag a row onto \"+ New window\"".

## 4. Tests (tester)

- [ ] 4.1 `packages/shared/test/search.test.ts`: "ranks the shown name like the name" (signal-catalog "Match by shown name only", "Shown name tiers": `speed` → V_ANZ-as-`Speed` tier 0, `B_200h.SPEED_RAW` tier 1; `spe` both tier 1; `(c)` on shown `V_ANZ (C)` tier 2; `combi` still finds the renamed signal) and "returns highlight ranges in the shown name" (`volt` on `CPC_448h.PTC_HV_Volt` shown `PTC_HV_Volt` → `[[7, 11]]`; no `displayName` → shown ranges equal name ranges; empty query → `[]`). Verify both fail before 1.1 and pass after.
- [ ] 4.2 `apps/server/test`, per display-names scenarios and design N6, N10:
  - Fixtures: `fixtures/letsview.test.yaml` exactly as design N10; `fixtures/letsview.bad.yaml` with the three rules of "Regex and template errors".
  - `config.test.ts` › "resolves the project file path".
  - `project.test.ts` (new) › "returns no rules for a missing optional file and fails for a missing required one", "reports every problem with file, field and reason" (bad fixture: exactly three lines; inline texts for unknown keys, missing `show`, empty rename value, duplicate key → `yaml:` line), "parses the shipped letsview.yaml and letsview.example.yaml" (repo root files; the five sample names of the scenario).
  - `names.test.ts` (new) › "takes the first matching rule and renders its template", "keeps the full name without a matching rule or with an empty render", "lets a rename beat every rule", "suffixes colliding rule names with the collision template" (`COMBI_412h.V_ANZ` + `KOMBI_512h.V_ANZ` → `V_ANZ (COMBI)`, `V_ANZ (KOMBI)`; `fellBack` empty), "falls back to full names while names still collide" (three `SIG (Fast)`; rename `B.Y` → `A.X` while `A.X` shows its full name → `B.Y`; `fellBack` sorted).
  - `catalog.test.ts` › "sets display names from the test project file" (test DB with the fixture rules: every expected name of design N10; `SIG_A` entries of both data references without `displayName` and alike; `displayFallbacks` = the three `Fast_100h.SIG_*` names).
  - `signals.http.test.ts` › "returns displayName in search and full catalog and keeps IDs" (`/api/catalog` and `/api/signals?q=Sna_800h.RPM`: `displayName` `RPM`, ID unchanged; `SIG_A` without; `q=spee` first two items as in signal-catalog "API ranks shown names").
  - Verify each new test fails before 2.1/2.2 and passes after, and `pnpm build && pnpm test && pnpm lint` is green after groups 1–3.

## 5. Real-data checks (tester and UI user)

- [ ] 5.1 Server on smart451 with the shipped `letsview.yaml`: the curl commands of display-names "Catalog entry with a display name" and "All real signals shortened, none alike" (`428`, `428`, no collision warning in the log), the CLI command of "Identity unchanged", and signal-catalog "API ranks like the explorer" (`smart451/CPC_168h.EAC_HV_Volt` unchanged). Verify by the command outputs (≤ 2 lines each).
