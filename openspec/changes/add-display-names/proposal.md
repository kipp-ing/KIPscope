# Proposal

## Why

The UI shows every signal by its full source name, e.g. `COMBI_412h.V_ANZ`, so every row, legend and drag ghost starts with a message name and a hex ID nobody reads. Which part matters differs per project. Jan decided (D-035):

> „the signal names. no one is interested in hex. so it will be just V_ANZ in this case. However: this is different in each project. so a yaml shall be able to define whats shown in the ui"

D-035 in full: „the UI shows short signal names (`V_ANZ` instead of `COMBI_412h.V_ANZ`), defined per project in a YAML. The YAML holds pattern rules (regex with named groups and a `show` template; first match wins) plus an optional `rename` map for single signals (rename beats rules). When two signals get the same shown name, both show the short name plus a message suffix, e.g. `V_ANZ (COMBI)`. The full source name stays in the hover card and tooltips; search matches full name, short name and message alike; CLI and API keep the stable full IDs. Lead's defaults: the file is `letsview.yaml` in the repo root, path overridable by env; no file or no matching rule shows the full name as today."

## What Changes

- **Project file (D-035):** the server reads `letsview.yaml` from the repo root at start, or the file named by `LETSVIEW_PROJECT_FILE`. Its `display` section holds `names` (ordered rules: `match` regex with named groups, `show` template, optional `collision` template) and `rename` (full source name → shown name). No file, or no matching rule: the full name, as today. An invalid file stops the server at start with a message naming the file, the field and the problem. Changes take effect on restart.
- **Display names in the catalog:** the server computes each signal's shown name once per catalog load and sends it as the new optional field `displayName` of `SignalInfo` (absent when it equals `name`). The web never evaluates rules. IDs, `name`, workspace state, commands and the CLI stay unchanged.
- **Collisions:** two signals with different source names and the same shown name both show their rule's `collision` template, e.g. `{signal} ({message})` → `V_ANZ (COMBI)`; names still shared after that show the full source name.
- **Shown name in the UI:** explorer rows, chart legend rows, values window rows, the drag ghost and the title of a unit-less axis show the display name; the hover card keeps the full name, and the shown name's tooltip is the full name.
- **Search:** the shown name is matched and ranked like the name (tiers 0–2) and highlighted in explorer rows; full name and message (part of the full name) still match.
- **smart451 file:** `letsview.yaml` with two rules that shorten all 428 real signals (373 `MESSAGE_<hex>h.SIGNAL`, 55 `MESSAGE.SIGNAL` such as `AC_A1.T_SOLL`), plus `letsview.example.yaml` documenting every key, and a README section.

Out of scope (not in D-035): moving the other server settings (env variables) into the YAML; per-data-reference files or rules; reloading the file without restart (also no reload by `POST /api/catalog/refresh`); renaming from the UI; bare shown names as CLI arguments (the CLI keeps full IDs and its existing bare-name rule); a separate search field for the DBC message name; display names for windows, units or values.

## Capabilities

### New Capabilities
- `display-names`: the project file, its name rules, renames and collision handling, validation at start, where the server delivers the result, and where the UI shows the shown name versus the full source name.

### Modified Capabilities
- `signal-catalog`: "Signal search" and "Search ranking" match the shown name like the name; "Signal explorer in the UI", "Match highlighting" and "Explorer rows are a drag source" show and highlight the shown name (scenarios rewritten for `V_ANZ`, `PTC_HV_Volt`).

## Impact

- `packages/shared/src`: `signals.ts` (`SignalInfo.displayName?`, `shownName()`), `search.ts` (shown-name field in tiers, `SignalMatch.shown` ranges).
- `apps/server/src`: new `project.ts` (read, parse and validate the YAML), new `names.ts` (assign display names), `config.ts` (`projectFile`), `catalog.ts` (sets `displayName` on refresh), `main.ts` (loads the file before listening, logs unresolved collisions).
- `apps/web/src`: `explorer/SignalExplorer.tsx`, `chart/TimeseriesWindow.tsx`, `values/ValuesWindow.tsx`, `App.tsx` (shown name, full-name tooltip); `explorer/SignalCard.tsx` unchanged in content (full name).
- Repo root: `letsview.yaml`, `letsview.example.yaml`, `.env.example`, `README.md`.
- New dependency: `yaml` (exact version) in `apps/server`. Validation with the server's existing `zod`.
- API: `GET /api/signals` and `GET /api/catalog` items gain the optional `displayName`; nothing removed (not breaking).
- Tests: new `apps/server/test/project.test.ts`, `apps/server/test/names.test.ts`, fixture `apps/server/test/fixtures/letsview.test.yaml`; additions to `apps/server/test/catalog.test.ts`, `apps/server/test/config.test.ts`, `apps/server/test/signals.http.test.ts`, `packages/shared/test/search.test.ts`.
