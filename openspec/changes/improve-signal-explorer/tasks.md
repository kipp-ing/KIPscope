# Tasks

Grouped by write area (docs/team.md). Groups 1–3 can run in parallel (3.4 touches `App.tsx`/`chart/drag.ts` only, after 3.3 has fixed the S3 props) against the interfaces pinned in design.md S1–S4; group 4 (tester) runs test-first in parallel. Test names are those the spec cites as evidence. Web tasks 3.1–3.2 (one engineer: `explorer/format.ts`, `Highlight.tsx`, `SignalCard.tsx`) and 3.3 (another: `SignalExplorer.tsx`, `api.ts`, `styles.css`) touch disjoint files.

## 1. packages/shared

- [ ] 1.1 Add `DbcValueLabel`, `DbcInfo`, `SignalInfo.dbc` and `CatalogSnapshot` to `src/signals.ts` exactly as in design S1; verify `pnpm build` type-checks all packages
- [ ] 1.2 Add `src/search.ts` (`MatchTier`, `MatchRange`, `SignalMatch`, `SearchIndex`, `buildSearchIndex`, `searchSignals`) per design E2/S2 and export it from `index.ts`; verify the `packages/shared/test/search.test.ts` tests from 4.1 pass

## 2. apps/server/src

- [ ] 2.1 Extend `dbc.ts` per design E4: `parseDbc(text, file?)` keeps message name, `BO_` ID, factor, offset, `[min|max]` and sets `file`; `loadDbcFiles` passes `basename(path)`; verify `dbc.test.ts` "reads message, scaling, range, value table and file" and "derives DBC details from the real h-can.dbc" pass and existing dbc tests stay green
- [ ] 2.2 In `catalog.ts`: copy DBC details into `SignalInfo.dbc` (values sorted by raw) and replace the substring filter in `search` with `buildSearchIndex`/`searchSignals` (index built in `refresh`), paging unchanged; verify `catalog.test.ts` "ranks search results like the explorer" and "lists a signal without DBC entry with its name only" pass, and `curl -s 'localhost:7310/api/signals?q=V_ANZ' | jq -r '.items[0].id'` prints `smart451/COMBI_412h.V_ANZ`
- [ ] 2.3 Add `GET /api/catalog` → `CatalogSnapshot` in `routes/signals.ts`, 503 `catalog_unavailable` before the first load (design E3); verify `signals.http.test.ts` "returns the full catalog without a page limit" and the extended 503 test pass, and `curl -s localhost:7310/api/catalog | jq '.items | length'` equals `curl -s 'localhost:7310/api/signals?q=' | jq .total`

## 3. apps/web/src

- [ ] 3.1 Add `explorer/format.ts` with the constants and helpers of design E6/E7/S4 (`HOVER_DELAY_MS`, `HIDE_GRACE_MS`, `CHUNK`, `visibleCount`, `nextShown`, `formatScaling`, `formatRawStep`, `formatDbcRange`, `formatMessageId`, `formatSource`, `windowsShowing`); verify `apps/web/test/explorer.test.ts` passes
- [ ] 3.2 Add `explorer/Highlight.tsx` and `explorer/SignalCard.tsx` (props per S4; content, order, formats, placement, `role="tooltip"`, scrolling value table per E7); verify by UI check "Card for V_ANZ" and "Card with offset"
- [ ] 3.3 Rewrite `SignalExplorer.tsx` (plus `fetchCatalog` in `api.ts`, row styles in `styles.css`): load `/api/catalog` once with 5 s retry and `onSeen(items)` (E3); rank per keystroke via `buildSearchIndex`/`searchSignals`, no debounce (E1); one-line rows with SNA dot, highlighted name/unit and `+` button (E5); count line and "Show N more" chunks (E6); card open/close timers rendering `SignalCard` (E7); combobox/listbox keys `/`, Esc, arrows, Enter (E8); optional `onDragStart`/`dragging` props per S3, called on pointer down on a row's name, not on `+` (E9); verify by the UI checks in group 5

- [ ] 3.4 In `App.tsx` and `chart/drag.ts` (built by `improve-window-workflow` D5, which runs before this change) add `ExplorerDragSource` and the S3 drop contract (targets, "Drop to add", drop → `addSignal`), and pass `onDragStart`/`dragging` to `SignalExplorer`, leaving legend-source behaviour as D5 pins it; verify by UI check "Drag a row onto a window" and "Drag a row onto \"+ New window\""
- [ ] 3.5 In `SignalExplorer.tsx`: hold the "Add to" target by window ID through `resolveTarget` (add it to `explorer/format.ts`), never switch it on window changes or "New window" adds, and label `+`/Enter with `Add to <windowTitle>` (E10); verify `explorer.test.ts` "keeps the Add to target by window ID while windows change" and UI checks "Target survives window changes" and "Add button names its target"

## 4. Tests (packages/shared/test, apps/*/test)

- [ ] 4.1 Write `packages/shared/test/search.test.ts`: "matches parts of name, description and unit case-insensitively", "requires every term to match", "ranks exact before prefix before name substring before other fields", "treats the part after the first dot as the signal name", "keeps catalog order within a tier and for an empty query", "returns merged highlight ranges for name, unit and description" (`volt` → `[[16, 20]]` on `CPC_448h.PTC_HV_Volt`; `v_a anz` → `[[11, 16]]` on `COMBI_412h.V_ANZ`), "ranks 10,000 signals in under 50 ms" (median of 5); all inputs per the spec scenarios
- [ ] 4.2 Write `apps/server/test/dbc.test.ts` "reads message, scaling, range, value table and file" (fixtures: `SIG_C` 256/1/0/−100/100/`test-a.dbc`, `Sparse_300h.MODE` values, `JITTER` 0/0, `Many_700h.S0001` `test-b.dbc`) and "derives DBC details from the real h-can.dbc" (runs if the file exists: V_ANZ, T_MOT, DVL per spec); `catalog.test.ts` "ranks search results like the explorer" (`rpm` → `testcar/Sna_800h.RPM` first, then the `Fast_100h.SIG_A` entries); `signals.http.test.ts` "returns the full catalog without a page limit" and `/api/catalog` in the 503 test; update existing `toEqual` assertions on DBC signals for the new `dbc` field (the no-DBC assertion stays unchanged)
- [ ] 4.3 Write `apps/web/test/explorer.test.ts`: "formats scaling, raw step and DBC range", "formats message IDs as hex", "formats the source line", "lists the windows showing a signal", "renders matches in chunks until all are visible" (1,013 → 500, 1,000, 1,013), "keeps the Add to target by window ID while windows change" (`resolveTarget`: kept on create/rename/reorder, `NEW_WINDOW` when removed), with the expected strings of design E7

## 5. Integration check (real carserver data)

- [ ] 5.1 UI user walks through every UI check in `specs/signal-catalog/spec.md` on `smart451` (queries `V_ANZ`, `T_MOT`, `DVL`, `temp`, `temperatur`, `volt`, empty; cards for V_ANZ and T_MOT; keys; network log while typing; pointer drag of rows onto a window and "+ New window"; Add to target with T_SOLL); one screenshot per scenario
- [ ] 5.2 Run the curl commands named in the spec against the dev server; verify the V_ANZ top hit, the `dbc` object of V_ANZ and the catalog length equal to the search total
