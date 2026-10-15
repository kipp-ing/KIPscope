# Proposal

## Why

Cursors A/B with Δt and ΔValue are step 4 of the central workflow (concept §1, §6) and were announced as the next change (D-017). Jan fixed the scope in D-023: „lass uns das mit drag drop von überall. und das anzeige fenster nur für den cursor wert. und wir brauchen eine leiste für optionen wie diff cursor." D-023 supersedes D-018's "hover value readout first" and answers concept §13's question on single-value windows: they show the cursor value.

## What Changes

- **Cursors A and B** are workspace state, set by commands (`cursor.set`, `cursor.move`, `cursor.remove`, `cursor.setDiff`), so the CLI controls them like the UI (concept §7). Both mark the same absolute time in every timeseries window (concept §6).
- **Timeseries windows** draw the cursors as vertical lines. Click places A and Shift+click places B. Dragging a line moves it locally and sends one command on release. Rectangle zoom, wheel zoom, double-click reset, legend drags and Backspace keep working (design C3).
- **No value readout on hover** (D-023). The crosshair stays a pointer guide without values.
- **Values window**: a new window kind `values` lists its own signals with the value at cursor A. In diff mode it shows A, B and Δ = B−A, plus Δt. Signals get in by drag or "Add to", like any window. The unit limit does not apply there. SNA shows as `SNA`, never as a number (D-010). Raw, interpolated and held values are marked (concept §6).
- **Value at a time**: new endpoint `GET /api/value` evaluates one signal at one time from its raw neighbours, linear in line mode and holding in step mode (design C4).
- **Option bar** above the windows holds cursor A/B on/off, diff mode, "Link time axes" (moved out of the top bar), zoom back, reset zoom and "+ Values window" (D-023).
- **Drag and drop from everywhere** (D-023): values-window rows become a drag source next to legend and explorer rows. The values window is a drop target. "+ New window" stays visible at the bottom of the viewport during a drag, and the window list auto-scrolls near its top and bottom edges. Move, Alt/Ctrl copy, Esc and the refused fifth unit stay unchanged.
- The over-long requirement "Drag feedback and cancel" is split: refusal rules go to their own requirement.

Out of scope: cursor playback ("historische Cursorbewegung", concept §7), a CLI client program (commands and `GET /api/value` over HTTP are the interface), persisting workspaces, cursors or values windows across server restarts (concept §8), the hover value readout (dropped by D-023), cursor values inside timeseries windows (dots, labels or tooltips at the cursor), snapping cursors to raw points, keyboard nudging of cursors, edge markers for cursors outside a window's range, aggregated cursor values (design C4 picks raw neighbours; only revisited if Jan chooses option R2), statistics between A and B (min/max/mean over the interval), min/max columns in the values window, and an undo of cursor moves.

## Capabilities

### New Capabilities
- `cursors`: cursor A/B and diff state in the workspace, their commands, how they are drawn, placed and moved in timeseries windows, and their controls in the option bar.
- `values-window`: the dashboard window that lists signals with their values at the cursors. Covers evaluation, value marking, SNA, the diff columns, and how signals get in and out.

### Modified Capabilities
- `workspace-state`: windows have a kind (`timeseries` or `values`); the state holds the cursors. Range, link, height and unit rules apply to timeseries windows only. A move from a values window into a new window takes a timeseries range.
- `timeseries-window`: the "Link time axes" toggle moves into the option bar. The bar gets zoom back and reset zoom. No hover readout. The drag requirements are split and extended: values-window rows are a source, the values window is a target without the unit limit, "+ New window" stays visible, and the list auto-scrolls.
- `series-query`: a value-at-time query that returns the raw neighbours of a time and the evaluated value.

## Impact

- `packages/shared`: `ValuesWindow`, `WorkspaceWindow`, `CursorState`, `Workspace.cursors`; `window.create {kind}`; cursor commands; error code `cursor_off`; kind rules in `applyCommand`. A new `cursor.ts` holds `CursorValue`, `CursorValueResult`, `evaluateAt` and `formatCursorNumber` (design C1, C2, C4, S1–S3).
- `apps/server/src`: new route `GET /api/value` in `routes/series.ts`, using the existing `DataSource.before`/`after` (design S4). `applyCommand` needs no change beyond `packages/shared`.
- `apps/web/src`: cursor overlay and placement in `chart/TimeseriesWindow.tsx` plus a new `chart/cursors.ts`. New `values/ValuesWindow.tsx` and `values/format.ts`. New `bar/OptionBar.tsx` and `bar/bar.ts`. In `App.tsx`: kind-aware rendering, cursor preview, sticky drop zone and drag sources. `chart/drag.ts` gets kind-aware drop rules. `api.ts` gets `fetchCursorValue`. `explorer/SignalExplorer.tsx` takes the window union type.
- Tests: shared apply and cursor tests, a server route test, and web tests for cursors, the bar, value formatting and drag.
