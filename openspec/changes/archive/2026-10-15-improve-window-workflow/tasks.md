# Tasks

Grouped by write area (docs/team.md). Groups 1–2 (shared + server), 3 (web, App side), 4 (web, window side) and 5 (tests) can run in parallel against the interfaces pinned in design.md D1–D6. Groups 3 and 4 share no file: group 3 owns `App.tsx`, `chart/zoom.ts`, `chart/drag.ts`, `SignalExplorer.tsx`, `styles.css`; group 4 owns `chart/TimeseriesWindow.tsx`, `chart/build.ts`, `chart/axes.ts` and a new `chart/window.css` for all window-level styles (including `.drop-target`). Test names are those the specs cite as evidence.

## 1. packages/shared

- [x] 1.1 Add `TIME_MIN`/`TIME_MAX` to `time.ts` and the bound check with its message to `TimeInput` (design D1); verify `packages/shared/test/workspace.test.ts` › "rejects times outside 1900 … 2262" and `apps/server/test/series.http.test.ts` › "rejects times outside the bounds with 400" pass
- [x] 1.2 Extend types per D1/D2: `TimeseriesWindow.height`, `Workspace.linkTime/lastZoomed/colors`, `EMPTY_WORKSPACE`, height constants, `SIGNAL_COLORS`, `windowTitle`, `signalColor`, the new command schemas (optional `from`/`to` on `window.create`, both or neither), `already_in_window`, `createdWindow` on `CommandResult`/`ApplyResult`, `too_many_units`, `MAX_UNITS`, `unitKey`, `windowUnits`, optional `ApplyContext.unitOf`; verify `pnpm build` type-checks all packages and `workspace.test.ts` › "titles untitled windows by ID" passes
- [x] 1.3 Linked ranges in `applyCommand` per the D2 table (`window.create` with/without range, `window.setRange`, `workspace.setLinkTime`, `lastZoomed` on create/setRange/remove); verify `apply.test.ts` › "applies a range to all windows while linked", "applies a range to one window while unlinked", "snaps all windows to the last zoomed window when linking", "creates a window with the shared range while linked" pass
- [x] 1.4 `window.moveSignal`, `window.rename`, `window.setHeight` in `applyCommand` per D2; verify `apply.test.ts` › "moves a signal keeping assignment ID and colour", "copies a signal with a new assignment ID", "moves and copies into a new window with the source range and display", "rejects a move into a window that already shows the signal", "keeps an emptied source window", "renames and clears window titles", "sets window height within bounds" pass
- [x] 1.5 Colour assignment on `window.addSignal` and cleanup on `window.removeSignal`/`window.remove` per D2; verify `apply.test.ts` › "assigns stable colours across windows", "frees colours of signals that left the workspace" pass
- [x] 1.6 Unit limit in `window.addSignal` and `window.moveSignal` per D1/D2 (`too_many_units`, only when `ctx.unitOf` is given); verify `apply.test.ts` › "rejects a fifth unit in a window", "counts unit-less signals as their own unit" pass

## 2. apps/server/src

- [x] 2.1 Pass `createdWindow` through `WorkspaceStore.execute` (D2) and give the store's context `unitOf: (id) => catalog.get(id)?.unit` in `main.ts` (D1); verify a `window.addSignal` of `smart451/ENG_2E8h.MOT_SPD_D` posted to a window with four units answers `"code":"too_many_units"`; verify `apps/server/test/workspace.http.test.ts` › "returns the created window and assignment of a move" and "applies the window-workflow commands over HTTP" pass, and after a server restart `curl -s localhost:7310/api/workspace | jq .workspace.linkTime` prints `true` (ran 2026-10-14: the curl answered HTTP 422 `{"ok":false,"code":"too_many_units","message":"a window shows at most 4 units (has: V, km/h, rpm/10ms, °C)"}`; the restart check is Jan's hand check)

## 3. apps/web/src — App side

- [x] 3.1 `chart/zoom.ts` per D4 (`clampRange`, `extentRange`, `ZoomHistory`, `historyKey`); verify `apps/web/test/zoom.test.ts` passes
- [x] 3.2 `chart/drag.ts` per D5 (`canDrop` with unit limit, `dropCommand`, `DRAG_THRESHOLD_PX`); verify `apps/web/test/drag.test.ts` passes
- [x] 3.3 `App.tsx` top bar "Link time axes" toggle sending `workspace.setLinkTime`; `colorOf` from `signalColor`; explorer "New window" without range while linked and a window exists (D6); `SignalExplorer.tsx` "Add to" options labelled by `windowTitle`; verify by UI check: toggle reflects `linkTime` after reload, "Add to" lists "Window <n>"/titles
- [x] 3.4 Drag controller in `App.tsx` per D5: grip pointer-down via `onDragStart`, threshold, ghost, `dropState` per window (`target`/`refused`/`source`), "+ New window" zone (`data-drop="new"`), target lookup by `elementFromPoint`, release → `dropCommand`, Esc and outside release cancel, context menu suppressed while dragging; styles in `styles.css`; verify by UI check of the scenarios "Move by drag", "Highlight and cancel", "Drop into a new window"
- [x] 3.5 Zoom history and reset in `App.tsx` per D6: `ZoomHistory` map by `historyKey`, `onZoomed`, `onBack`, `canGoBack`, Backspace (pointer window, else `lastZoomed`, ignored in text fields), `onReset` fetching extents → `extentRange` → `clampRange` → history push → `window.setRange`; verify by UI check of "Two steps back", "Backspace in a text field", "Back to the full extent"

## 4. apps/web/src — window side

- [x] 4.1 `chart/axes.ts` `layoutAxes` per D3 and `buildModel` using its `scaleOf`, exposing `ChartModel.layout`; verify `apps/web/test/axes.test.ts` and the existing `build.test.ts` (incl. "groups y scales by unit") pass
- [x] 4.2 `TimeseriesWindow.tsx` props per D6; colours from `colorOf` for curves, envelopes, SNA lanes and swatches; up to four stacked uPlot y axes from `layout.axes` (L, R, L2 outer left, R2 outer right) without `label`, `size` from the widest tick label + 12 px; HTML axis-title row centred over each axis in axis colours; legend shows the side; `refused` drop state with hint "At most 4 units per window"; verify by UI check of "Two signals, same unit", "Second unit", "Third and fourth unit", "Fifth unit refused", "Degree sign", "First signals of two windows"
- [x] 4.3 `TimeseriesWindow.tsx` header and layout per D6: one-line header with ellipsis title and tooltip, click-to-rename (`window.rename`), Back button (`canGoBack`/`onBack`), `onZoomed` once per committed gesture, `clampRange` in wheel/pan/zoom-out, dblclick → `onReset` (uPlot default overridden), height handle → `window.setHeight`, plot height from `window.height ?? DEFAULT_PLOT_HEIGHT`, grip → `onDragStart`, `dropState` classes and hint, empty text "Drop a signal here"; styles in `chart/window.css`; verify by UI check of "Rename", "Long title", "Taller window", "Zoom out forty times"
- [x] 4.4 Lead decisions of round 5 (built in rounds 4–5, design D4/D6): untitled windows from the explorer (`SignalExplorer.tsx`/`App.tsx`), aligned plot insets (`App.tsx` max per side → `insets` prop → `TimeseriesWindow.tsx` padding), crosshair hidden on leave and after wheel/drag/double-click zoom, wheel step 2^(1/5) per tick capped at 5 ticks per event; verify by UI check of "New window from the explorer is untitled", "Different axis counts line up", "Leave and zoom", "Five ticks out"

- [x] 4.5 D-020: extract pure helpers with unit tests, no behaviour change: wheel tick → factor (incl. page mode) into `chart/zoom.ts`, per-side inset maximum (App), text-field check for Backspace (App); verify `apps/web/test/zoom.test.ts` › "wheel factor is 2 per 5 ticks, capped at 5 ticks per event", `apps/web/test/insets.test.ts` › "takes the largest axis width per side across windows", `apps/web/test/keys.test.ts` › "treats input, textarea, select and contenteditable as text fields" pass

## 5. Tests (packages/shared/test, apps/*/test)

- [x] 5.1 `packages/shared/test/apply.test.ts`: the 15 tests named in `specs/workspace-state/spec.md` and `specs/timeseries-window/spec.md`; change "sets range and display of one window only" to switch linking off first; `workspace.test.ts`: "rejects times outside 1900 … 2262", "titles untitled windows by ID"; verify each named test exists and passes in a targeted run (`pnpm --filter @kipscope/shared test`); fail-before-group-1 cannot be recorded after the fact and is not required
- [x] 5.2 `apps/server/test/workspace.http.test.ts`: "applies the window-workflow commands over HTTP", "returns the created window and assignment of a move"; `series.http.test.ts`: "rejects times outside the bounds with 400"; verify each runs
- [x] 5.3 `apps/web/test/axes.test.ts` (5 tests named in the timeseries-window delta), `zoom.test.ts` ("clamps ranges into the time bounds", "computes the extent range rounded up to the next millisecond", "keeps a bounded zoom history", "shares one history while linked"), `drag.test.ts` ("moves on plain drop and copies with Alt or Ctrl", "rejects drops on the source and on windows showing the signal", "refuses a drop that would make a fifth unit", "drops into a new window"), written against the D3–D5 signatures; verify each runs

## 6. Integration check (real carserver data)

- [x] 6.1 UI user walks every UI check in `specs/timeseries-window/spec.md` on `smart451` (SPEED_DISP, WSPD_FL, HTR_HV_Volt, COMP_HV_Volt, T_ENG, T_SET, MOT_SPD_D as named there), one screenshot per scenario
- [x] 6.2 Run the `curl` commands named in `specs/series-query/spec.md` and `specs/workspace-state/spec.md` against the dev server; verify `400` and `true`

- [x] 6.3 D-020 spec alignment: UI user walks the scenarios added afterwards in `specs/timeseries-window/spec.md` ("Pan and Zoom out", "Shift+wheel pans", "Zoom in past 100 ns", "History after reload") and `specs/workspace-state/spec.md` ("Browser reload" with titles, heights, link toggle and colours); the calendar-tick and header-range scenarios are covered by their existing tests

## Workflow follow-up

- Jan's hand checks (not automatable): Esc during a drag cancels ("Highlight and cancel"); after a server restart "Link time axes" is checked and `jq .workspace.linkTime` prints `true` ("Default on", "Default is linked"); Alt-copy by drag on macOS; wheel feel.

- Lead shows Jan the result; open questions from the spec report go to Jan.
- Archive after Jan's approval; copy project-wide decisions (D2 linked-range semantics, D1 time bounds, D3 stacked-axis layout and the `too_many_units` limit) into docs/decisions.md.
