# Proposal: improve-window-workflow

## Why

Jan tested the app and found it "already usable"; the power-user exploration of 2026-10-14 ([docs/feedback/2026-10-14-power-users.md](../../../docs/feedback/2026-10-14-power-users.md)) showed where the window workflow still blocks real investigations. Jan's decisions:

- D-017: „Signale zwischen zwei anzeigen hin und her. gleiche signalbereich gleiche achse. gemeinsamer zoom standard aktiv abschaltbar.“ — "Time zoom is shared across windows by default and can be switched off. This supersedes concept §4 'Der Zeitzoom ist je Fenster unabhängig' as the default."
- D-018: "'Same value range' means **same unit**: one y-axis per unit, nothing more." and "The window-workflow change also takes: […] stable signal colours across windows, window rename, and window layout with keys (resizable window heights, double-click resets zoom, zoom history back)."

Three bugs from the same report make windows unreliable: a window range of "1036-01-11 … 3937-05-09", values that look like SNA (`AC_A1.T_SOLL` at −40 °C, `MS_312h.DNMOT` near −120) and a garbled "°C" axis title.

## What Changes

- Move a signal to another window by dragging its legend row; Alt/Ctrl at drop copies; a "+ New window" drop zone; highlighted targets; Esc cancels. Backed by a new workspace command `window.moveSignal` (CLI-ready, concept §7).
- One y-axis per unit (D-018), stacked up to two per side for at most four units per window (D-019: "Every value stays readable."); the plot narrows. The legend shows the axis (L, R, L2, R2) per signal; the axis title is the unit, coloured like the signal when it is the only one on that axis. A fifth unit is rejected (`too_many_units`) by `window.addSignal` and `window.moveSignal`, and a window that would get it is no drop target.
- Linked time axes (D-017): a workspace flag, on by default, toggled in the top bar. While on, every range change applies to all windows; switching it on snaps all windows to the last zoomed window. **BREAKING** for `window.setRange` callers: with the flag on (default) it changes every window.
- Stable signal colours: each signal keeps one colour across all windows and moves, held in the workspace.
- Window rename (command `window.rename`); every place that names a window uses its title; the window header no longer wraps with long titles.
- Window layout and keys: resizable plot height (command `window.setHeight`), double-click resets the zoom to the window's data, zoom history "Back" (button and Backspace).
- Lead decisions of round 5: windows created from the UI are untitled ("Window <n>"), all windows share the same plot insets so linked time axes line up, the crosshair hides on leave and after every range change in the window (CSS class), one wheel tick scales by 2^(1/5) with at most five ticks per event.
- Navigation details found in rounds 1–3: Shift/horizontal wheel pans, page-mode wheel counts as five ticks, a minimum span of 100 ns, calendar ticks (`YYYY-MM`/`YYYY`) for wide spans, the header range cut to milliseconds; the zoom history lives in the browser tab only (D-020: spec brought in line with the code).
- Bugs: time values are bounded to 1900-01-01 … 2262-04-11 in commands and series requests, and zoom-out stops there (fixes the "1036 … 3937" range); axis titles are rendered as text above the axes so "°C" reads correctly; `T_SOLL` at −40 °C and `DNMOT` at −127 are stated as correct (valid raw 0 per DBC, D-012/D-015/D-019).

## Out of scope

- Signal explorer: list with hover details, ranking, match highlighting, no hard cap, dragging explorer rows onto windows, the sticky "Add to" target (change `improve-signal-explorer`).
- Hover value readout, cursors A/B, shared hover line (change `add-cursors`, D-018).
- Per-window detach from the linked zoom; live following of linked windows during a gesture beyond the accept latency (spec "Linked windows follow").
- Notice about several open tabs sharing one workspace (D-005 by design).
- Per-signal display mode (mode stays per window), Y-axis options (manual ranges, log), status dots in the legend, undo of non-zoom commands.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workspace-state`: workspace contents (titles, heights, link flag, colours); new commands (move/copy signal, rename, set height, link time axes), linked-range semantics, stable signal colours, at most four units per window, time bounds for command times.
- `timeseries-window`: shared zoom replaces independent zoom by default; drag-and-drop between windows; one axis per unit, stacked up to four; window title, header, height, double-click reset, zoom history; zoom-out bounds; aligned insets, crosshair, wheel zoom and pan, minimum span, calendar ticks, header range; statement on T_SOLL.
- `series-query`: series requests reject times outside the bounds.

## Impact

- `packages/shared`: `Workspace` (`linkTime`, `lastZoomed`, `colors`), `TimeseriesWindow.height`, new commands, `CommandResult.createdWindow`, `TIME_MIN`/`TIME_MAX` in `TimeInput`, `SIGNAL_COLORS`, `applyCommand`.
- `apps/server`: pass `createdWindow` through `WorkspaceStore.execute`; give the apply context `unitOf` from the catalog (bounds come from the shared `TimeInput`).
- `apps/web`: `App.tsx` (top-bar toggle, drag state, drop zone, histories, Backspace), `chart/TimeseriesWindow.tsx`, `chart/build.ts` (axis layout), new pure modules `chart/axes.ts`, `chart/zoom.ts`, `chart/drag.ts`, `time/axis.ts` (`calendarTicks`, `formatRange`), `chart/window.css` (window-level styles), `SignalExplorer.tsx` (titles in "Add to" only), `styles.css`.
