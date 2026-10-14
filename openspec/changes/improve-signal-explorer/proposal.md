# Proposal

## Why

Jan after testing (D-017): „signalexplorer als liste mit hover infos. bei eingabe in suchliste filtern auch auf teile." Today an explorer row takes 1–4 lines (description and SNA inline), about 10 fit on screen, there is no detail view, results are capped at 100 and lag behind typing by a 200 ms debounce plus a server round trip (power-user report 2026-10-14, points 4 and 5). D-018 adds "explorer ranking and match highlighting without a hard cap". D-020 adds explorer drag with the unit-limit refusal, the keys `/`, arrows, Enter, Esc, and a stable "Add to" target.

## What Changes

- Explorer becomes a compact list: one line per signal (SNA dot, name, unit, add button); description, SNA text and data reference move into a hover card.
- Hover card after 350 ms on pointer hover or keyboard focus: full name, message and CAN ID, unit, description, scaling, raw step, DBC min/max, SNA codes, value table, source (data reference and DBC file), windows currently showing the signal.
- Catalog entries carry DBC details the parser reads today or can read from the same `SG_`/`BO_`/`VAL_` lines: message name and ID, factor, offset, min, max, value table, DBC file. Additive DTO field `SignalInfo.dbc`.
- Search on parts as a requirement: case-insensitive substring per term, all terms must match; ranking exact > prefix > name substring > description/alias/unit; matched parts highlighted; no hard cap.
- Filtering moves into the browser: the web loads the whole catalog once (`GET /api/catalog`) and ranks on every keystroke with one shared function, also used by `GET /api/signals` so CLI and UI agree.
- Keys: `/` focuses search, Esc clears, Enter adds the active (top) hit, arrow keys move through the list.
- Explorer rows are a drag source for the pointer drag of `improve-window-workflow` (its design D5). This change also builds the explorer branch of the drop: a drop adds; a window that would reach a fifth unit is refused, the same rule as legend drags; windows show the hint "Drop to add" (D-020). Interface pinned in design S3; the window spec's "Drag feedback and cancel" is scoped accordingly (MODIFIED delta).
- The "Add to" target stays where the user put it, and the add button names it (D-020).

Out of scope: windows, axes, zoom, cursors; legend-row drag and drop and its move/copy behaviour (`improve-window-workflow`, unchanged); window titles in "Add to" (`improve-window-workflow`); a unit-limit warning on the add button or Enter (the server's `too_many_units` message shows as today); live catalog refresh in the browser, state/enum display of value tables in charts, alias data (still never set by any source), fuzzy or typo-tolerant matching.

Order: `improve-window-workflow` is archived before this change is built (D-020); this change's `timeseries-window` delta modifies a requirement that change adds.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `signal-catalog`: search on parts with ranking and highlighting; full catalog listing; DBC details per signal; explorer as one-line list with hover card, keys, drag source and stable "Add to" target.
- `timeseries-window`: "Drag feedback and cancel" names the hint per drag kind ("Drop to add" for explorer drags) and applies the unit-limit refusal to both.

## Impact

- `packages/shared`: `DbcInfo` and `SignalInfo.dbc`, `CatalogSnapshot`, ranking/highlight function `searchSignals` (new `search.ts`).
- `apps/server`: DBC parser (message ID, `[min|max]`, file name, value table in the DTO), catalog details and ranking, new route `GET /api/catalog`.
- `apps/web`: `SignalExplorer.tsx` rewritten (list, hover card, keys, drag start, "Add to" target), new `explorer/` modules, catalog loaded once instead of a request per keystroke; `api.ts` (`fetchCatalog`, `searchSignals` renamed `fetchSignalPage`); `App.tsx`, `chart/drag.ts`, `chart/TimeseriesWindow.tsx` for the explorer drop branch.
- Tests: shared ranking tests, DBC/catalog/HTTP tests, web formatter tests, explorer drag tests; existing `toEqual` assertions on DBC signals gain the `dbc` field.
