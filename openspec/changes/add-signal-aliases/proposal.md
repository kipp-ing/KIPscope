# Proposal

## Why

The same signal is named differently in the places a user meets it: the ADX table holds raw source names (`ICL_3A2h.SPEED_DISP`), while the search tool and the people around it talk in logical names. Today a KIPscope user has to know the source name, or depend on name rules in a local `kipscope.yaml` that every deployment writes by hand. The ADX testers' feedback (comment of 2026-10-22, item M2, after M1 `add-adx-databases`) asks for signals by logical name. Jan (2026-11-06): the server delivers a dictionary, so the user always works with the same names; it holds per server connection, and the display is switchable because everyone likes it differently.

## What Changes

- **Dictionary file:** `KIPSCOPE_ALIASES_FILE` names a JSON file `{ "<logical name>": "<source name>", … }`, written by the system that starts the KIPscope server, read once at start. One dictionary per server (= per connection); it holds for every data ref and database. Without the variable nothing changes (design D1, Q-2).
- **Shown name:** a signal with an entry shows its logical name wherever the UI shows a name today. It enters the display-name pipeline between `display.rename` and the name rules (design D2).
- **Identity stays on the source name:** signal IDs, workspaces, views, links and grants keep `dataRef/<source name>`; a logical name is never stored. A renamed or removed entry therefore breaks no saved view (design D3, Q-1).
- **Input by logical name:** the CLI's bare-name arguments and the formula editor accept the logical name like a source name; the explorer search finds a signal by either (design D4).
- **Switch:** a user option `names` = `shown` (default) or `source` in the "⋯" menu, next to Digits, and `kipscope names shown|source`. `source` shows the full source name everywhere, also where name rules would shorten it (design D5, Q-3).
- **Hover card and tooltips:** show the other name, so the logical name and the source name are always both visible somewhere (design D5).
- **Unavailable names:** a logical name whose source name is not in the case's scope is not an error at start (scopes differ); asked for by the CLI or API it is refused with a message that names the source name it maps to (design D6).
- **Docs:** [data-sources.md](../../../docs/data-sources.md) (variable, file format), [manual.md](../../../docs/manual.md) (switch), `docs/handoff.md` one paragraph for the search tool that writes the file.
- **Out of scope:** a dictionary per vehicle or variant; ARXML or any other metadata parsing; writing the dictionary from KIPscope; reloading it without a restart; a UI to edit it; aliases in the stored view format (design D3).

## Capabilities

### New Capabilities

- `signal-aliases`: the dictionary file, its validation, and which name a signal shows and answers to.

### Modified Capabilities

- `display-names`: the shown name has a third source (the dictionary) between rename and rules; the rules skip a signal with an entry.
- `workspace-state`: user option `names` and its command; the stored workspace reads without it.
- `cli`: bare-name arguments accept a logical name; the `names` command.

## Impact

- Code: `apps/server/src/config.ts` (variable), new `apps/server/src/aliases.ts` (read and validate), `apps/server/src/names.ts` (pipeline step), `apps/server/src/catalog.ts` (fill `alias`), `packages/shared/src/workspace.ts` and `apply.ts` (option), `packages/shared/src/signals.ts` (name helper that takes the option), `apps/web/src/` (explorer, legend, values window, hover card, "⋯" menu), `apps/cli/src/refs.ts` and `args.ts`.
- Docs: `docs/data-sources.md`, `docs/manual.md`, `docs/handoff.md`, `docs/status.md`, `docs/decisions.md`.
- Tests: `apps/server/test/` (aliases, names, catalog, config), `packages/shared/test/` (apply, search), `apps/cli/test/`, web smoke.
- A deployment without the variable: no change in behaviour, stored files or API. The only addition for everybody is the `names` option in the workspace document (default `shown`); an older stored workspace without it reads with the default.
- Depends on M1 only through data refs staying opaque; no dependency on `add-adx-databases` being archived.
