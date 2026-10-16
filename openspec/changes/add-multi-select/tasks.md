# Tasks

One round. Every task has its own files; all build in parallel against the interfaces pinned in design M2–M5. Task 3.1 imports `placeSignals` (1.1) and `SignalExplorer` imports the `ExplorerDragSource` shape (3.1); engineers may stub the other side until it lands. The tester writes group 4 test-first, in parallel.

Write areas (disjoint):
- 1.1: `packages/shared/src/placement.ts` (new), `packages/shared/src/index.ts` (one export line)
- 2.1: `apps/web/src/explorer/selection.ts` (new), `apps/web/src/explorer/SignalExplorer.tsx`, `apps/web/src/styles.css` (only the `.explorer …` list rules)
- 3.1: `apps/web/src/chart/drag.ts`, `apps/web/src/addSignals.ts` (new), `apps/web/src/App.tsx`, `apps/web/src/time/TimeStrip.tsx` (`StripDrop`, `stripDropText` only)
- 4.1: `packages/shared/test/placement.test.ts` (new)
- 4.2: `apps/web/test/selection.test.ts` (new), `apps/web/test/addSignals.test.ts` (new), `apps/web/test/drag.test.ts`, `apps/web/test/strip.test.ts`

Not touched (owned by `add-gap-display`, specced, not built): `apps/web/src/chart/{build,readout,gaps,TimeseriesWindow}.ts(x)`, `apps/web/src/values/*`, the `:root` tokens of `styles.css`, any server or CLI file.

## 1. packages/shared

- [ ] 1.1 Placement (M2): new `placement.ts` with `PlacementStep`, `PlacementPlan`, `placeSignals` exactly as pinned (first fit, target first; target units counted; values target takes any unit; unitless = own unit via `unitKey`; repeats once); export from `index.ts`. Verify: `pnpm --filter @kipscope/shared build && pnpm --filter @kipscope/shared test`; scenario timeseries-window "Placement rules".

## 2. apps/web explorer

- [ ] 2.1 Selection and no text selection (M1, M5, M6): new `explorer/selection.ts` (`Selection`, `NO_SELECTION`, `isMacPlatform`, `clickMode`, `selectClick`, `extendTo`, `selectedInOrder`, `pruneSelection`, `preventListPress`); `SignalExplorer`: `preventListPress` as `onMouseDown` of `.results`, selection state (cleared on query change, pruned after a group toggle), row `onClick` (ignored after a ≥ `DRAG_THRESHOLD_PX` move since its `pointerdown`; sets the active row), `+` click stops propagation, Shift+Arrow, Enter and `+` through `addSet`, new prop `onAddMany`, `signalIds` on the drag source for a selected row of a ≥ 2 selection, `aria-multiselectable`, `aria-selected` = selected, class `selected`; `styles.css`: `user-select: none` on `.explorer .results`, `.explorer .row.selected` bar and name colour. Verify: `pnpm --filter @kipscope/web build && pnpm lint`; scenarios "Presses in the list select nothing", "Search text still selectable", "Ctrl/Cmd and Shift on smart451", "Shift+Arrow on smart451", "Query change and closed group", "Selected and active rows apart" (UI user).

## 3. apps/web App and drag

- [ ] 3.1 Selection drops and adds (M3, M4): `drag.ts`: `ExplorerDragSource.signalIds?`, `canAddAny`, `eventsDropMany`, `dropStateFor` for a selection (target or nothing, never refused); new `addSignals.ts` with `runPlan`; `App.tsx`: `addSignals(ids, target)` (plan on the live workspace, `rangeFor` as today's new-window rule over the window's signals, reveal the first created window, thrown errors to the message line), `onAddMany` wired to the explorer, drag release over a window/"new"/"new-below" → `addSignals`, over the strip → `events.addSignal` per `eventsDropMany` ID until the first refusal, highlight via `canAddAny`, ghost `N signals` / ` · add` / `· Already shown` (all shown), strip text input per M4; `TimeStrip.tsx`: `none_new` reason and its text. Single-signal paths unchanged. Verify: `pnpm build && pnpm lint && pnpm --filter @kipscope/web test`; scenarios "Six units onto "+ New window"", "Drop onto a window with three units", "`+` on a selection into a new window", "`+` on an unselected row", "Enter adds the selection", "Unselected row drags alone", "Selected row drags the selection", "Selection with one state signal" (UI user).

## 4. Tests

- [ ] 4.1 Shared: `placement.test.ts` › "fills the target up to four units and overflows into new windows", "counts the units the target already shows", "puts each signal into the first window it fits", "creates windows for a new-window target", "takes any unit into a values window", "counts a signal without unit as its own unit", "places a repeated signal once". Verify: `pnpm --filter @kipscope/shared test`.
- [ ] 4.2 Web: `selection.test.ts` › "selects one row on a plain click", "toggles with Ctrl, or Cmd on macOS", "selects a range of signal rows across groups with Shift", "extends the range with Shift+Arrow", "lists the selection in list order and drops hidden rows", "keeps presses in the list from selecting text" (fake event; reads `apps/web/src/styles.css` with `node:fs` and checks the `.explorer .results` rule); `addSignals.test.ts` › "creates each window before its first signal and stops at the first refusal" (fake `command` and `rangeFor`); `drag.test.ts` › "highlights a window for a selection while one signal is new", "adds the selection's new state signals on the strip"; `strip.test.ts` › "names a selection that has no new state signals". Existing tests stay green unchanged. Verify: `pnpm --filter @kipscope/web test`.

## UI check (UI user, smart451, 1440×900, no task)

- signal-catalog: "Presses in the list select nothing", "Search text still selectable", "Ctrl/Cmd and Shift on smart451", "Shift+Arrow on smart451", "Query change and closed group", "`+` on a selection into a new window", "`+` on an unselected row", "Enter adds the selection", "Unselected row drags alone", "Selected row drags the selection"; existing "Drag a row onto a window", "Click is not a drag".
- timeseries-window: "Six units onto "+ New window"", "Drop onto a window with three units".
- time-strip: "Selection with one state signal".
- design-language: "Selected and active rows apart".
- Modifier clicks: if the browser automation cannot hold Ctrl/Cmd or Shift on a click, report `not_run` for that step with the unit test as evidence.

## Workflow follow-up

- On archive: copy D-065 and D-066 from design.md's decision ledger into `docs/decisions.md`.
