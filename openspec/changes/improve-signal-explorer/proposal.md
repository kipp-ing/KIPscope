# Proposal

## Why

Jan after testing (D-017): „signalexplorer als liste mit hover infos. bei eingabe in suchliste filtern auch auf teile." Today an explorer row takes 1–4 lines (description and SNA inline), about 10 fit on screen, there is no detail view, results are capped at 100 and lag behind typing by a 200 ms debounce plus a server round trip (power-user report 2026-10-14, points 4 and 5). D-018 adds "explorer ranking and match highlighting without a hard cap".

## What Changes

- Explorer becomes a compact list: one line per signal (SNA dot, name, unit, add button); description, SNA text and data reference move into a hover card.
- Hover card after 350 ms on pointer hover or keyboard focus: full name, message and CAN ID, unit, description, scaling, raw step, DBC min/max, SNA codes, value table, source (data reference and DBC file), windows currently showing the signal.
- Catalog entries carry DBC details the parser reads today or can read from the same `SG_`/`BO_`/`VAL_` lines: message name and ID, factor, offset, min, max, value table, DBC file. Additive DTO field `SignalInfo.dbc`.
- Search on parts as a requirement: case-insensitive substring per term, all terms must match; ranking exact > prefix > name substring > description/alias/unit; matched parts highlighted; no hard cap.
- Filtering moves into the browser: the web loads the whole catalog once (`GET /api/catalog`) and ranks on every keystroke with one shared function, also used by `GET /api/signals` so CLI and UI agree.
- Keys: `/` focuses search, Esc clears, Enter adds the active (top) hit, arrow keys move through the list.
- Explorer rows are a drag source for the pointer drag of `improve-window-workflow` (its design D5); the drop side is that change's. Interface pinned in design S3.

Out of scope: windows, axes, zoom, cursors, drop targets and drop handling (`improve-window-workflow`), window titles in "Add to" (`improve-window-workflow`), live catalog refresh in the browser, state/enum display of value tables in charts, alias data (still never set by any source), fuzzy or typo-tolerant matching.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `signal-catalog`: search on parts with ranking and highlighting; full catalog listing; DBC details per signal; explorer as one-line list with hover card, keys and drag source.

## Impact

- `packages/shared`: `DbcInfo` and `SignalInfo.dbc`, `CatalogSnapshot`, ranking/highlight function `searchSignals` (new `search.ts`).
- `apps/server`: DBC parser (message ID, `[min|max]`, file name, value table in the DTO), catalog details and ranking, new route `GET /api/catalog`.
- `apps/web`: `SignalExplorer.tsx` rewritten (list, hover card, keys, drag start), new `explorer/` modules, catalog loaded once instead of a request per keystroke.
- Tests: shared ranking tests, DBC/catalog/HTTP tests, web formatter tests; existing `toEqual` assertions on DBC signals gain the `dbc` field.
