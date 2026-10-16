# Proposal

## Why

Jan (2026-10-17): „when i select a signal left in signal explorer: many times text ist selected over the browser. thats awkward. and while we are in ther: I wish i could selct multple entries with shift ctrl or so (win ) to select signals . draw them to one or a new window. after 4 legends signals overflow to new window or so"

Today only the press on a row's name starts a drag, and only that drag blocks text selection (`holdNoSelect`). A press, double-click or Shift-click anywhere else on a row (SNA dot, unit, padding) or on a group header selects page text. A Shift-click is exactly what Jan tried for multi-select. And the explorer adds one signal per drag or `+`.

Jan's decisions:
- D-065: „Clicking, double-clicking or Shift/Ctrl-clicking in the signal explorer list (rows and group headers) never selects page text. The search field stays a normal text field."
- D-066: a multi-select drop or add has no signal-count limit („Only by unit limit"). Signals go into the target window until one would need a 5th unit (`MAX_UNITS` = 4); from there on they continue in a new window, and further new windows as needed, each again up to 4 units. The target window's current units count („Fill it up"). Single adds and drops behave as today.

## What Changes

- **No text selection in the list (D-065):** the explorer's result list is `user-select: none`, and a mouse press in it keeps its default from running (no text selection starts, Shift does not extend one, focus stays where it was). The search field is untouched.
- **Selection (lead defaults, design L1):** plain click selects one row and makes it active; Ctrl-click (Windows/Linux) or Cmd-click (macOS) toggles a row; Shift-click selects the range of signal rows from the anchor, across groups; Shift+Arrow in the search extends it; a query change clears it. Selected rows get a left accent bar; the active row keeps its fill.
- **Drag and add a selection (D-066, design L2–L4):** pressing a selected row's name drags the whole selection (ghost `N signals`); `+` on a selected row and Enter on a selected active row add the whole selection to the "Add to" target. An unselected row drags and adds only itself, as today.
- **Placement (D-066, design M2):** a pure `placeSignals` in `packages/shared` walks the selection in list order, skips signals the target shows, puts each into the first window where it fits by units (target first, then the windows this add creates), and opens a new window when none fits. The web runs the plan as today's commands (`window.create`, `window.addSignal`), stopping at the first refusal (e.g. the 50-signal limit) with the server's message shown once. No new server command.
- **Targets during a selection drag (design L5):** a window is a valid target when it does not show at least one selected signal; units never refuse a selection. On the time strip, the selected signals with named states that are not on the events line yet are added; the others are skipped.

**Out of scope:** dragging from anywhere on a row (the name stays the drag handle); select-all (Ctrl/Cmd+A); a selection count in the explorer; selecting legend or values rows; moving or copying several legend rows; a CLI command for several signals; a server-side batch command; changing `MAX_UNITS`, `MAX_SIGNALS` or `MAX_EVENT_SIGNALS`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `signal-catalog`: new "No text selection in the explorer list", "Selecting signals by click", "Selecting signals by keyboard", "Selection lifetime", "Adding a selection"; "Explorer rows are a drag source" gains the selection drag.
- `timeseries-window`: new "Selection overflows into new windows", "Running a selection add", "Selection drag feedback"; "Refused drop targets" exempts a selection drag from the unit refusal.
- `time-strip`: new "Selection drop on the strip", "Selection without new state signals".
- `design-language`: new "Selected row look".

## Impact

- `packages/shared/src`: new `placement.ts` (`placeSignals`, `PlacementPlan`); `index.ts` exports it.
- `apps/web/src`: new `explorer/selection.ts` (pure selection helpers, press handler); `explorer/SignalExplorer.tsx` (selection state, clicks, Shift+Arrow, `+`/Enter, drag source); `styles.css` (explorer list rules only); `chart/drag.ts` (`ExplorerDragSource.signalIds`, selection targets); new `addSignals.ts` (runs a plan); `App.tsx` (wiring, ghost, strip text input); `time/TimeStrip.tsx` (`stripDropText` for several signals).
- No server, CLI or data changes. `noselect.ts` is unchanged (it keeps serving drags).
- Separate from `add-gap-display` (specced, not built): that change writes `chart/build.ts`, `chart/readout.ts`, `chart/gaps.ts`, `chart/TimeseriesWindow.tsx`, `values/*`, and adds a `--gap-fill` token to `styles.css`; this change edits only the explorer rules of `styles.css` and touches none of its other files. Both add one export line to `packages/shared/src/index.ts`.
