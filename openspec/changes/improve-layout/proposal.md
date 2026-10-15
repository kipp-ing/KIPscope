# Proposal

## Why

The efficiency test ([docs/feedback/2026-10-15-efficiency-testers.md](../../../docs/feedback/2026-10-15-efficiency-testers.md), items 5, 6 and 8) measured about 25 % of the pixels showing data at 1000 × 557 px: a fixed 260–340 px sidebar, a separate top bar, ~55 px of chrome per window header and one window per row. Jan decided:

- D-025: "Screen use must be optimized: more of the screen shows data (details in the next change)."
- D-026: "Screen use, next change: collapsible sidebar, windows tiled side by side, compact window headers. The sidebar gets its own work package later; for now only optimization."
- D-027: "A window emptied by a move is removed automatically (supersedes "a window emptied by a move stays", D-017 feedback)." and "'Add to' goes to a marked window: the user marks a window, and adds go there. The user's own act of marking sets the target, so D-020's 'the target stays where the user put it' still holds."

## What Changes

- **Collapsible sidebar.** The explorer is 240 px wide when open (today `clamp(200px, 26vw, 340px)`, 340 px from a 1308 px viewport). A "Signals" toggle at the left of the top row and the key `s` collapse and reopen it; `/` opens it and focuses the search. The state is remembered per browser (local storage).
- **Tiled windows.** Windows fill a grid of two columns once the window list is at least 920 px wide, else one column, in workspace order row by row. A window alone in the last row spans both columns. Each window keeps its own stored height.
- **Compact window headers.** One line of at most 24 px for every window kind: title, resolution badge (short form, neutral colour), range, then the controls at a fixed place on the right, so nothing moves when a zoom changes the badge or range. The range truncates first, then the title. Remove and Rename move into a "⋯" window menu; a double-click on the title renames.
- **One top row, one status strip.** The separate top bar goes away. Its connection, revision and error message move into the strip at the bottom that C7 of `add-cursors` already keeps reserved for "+ New window"; during a drag the strip turns into the drop zone, so the reserved space is used and nothing moves at drag start.
- **Marked window.** A click on a window's header marks it (accent bar); explorer adds (Enter, the row's `+`) go to the marked window, or to a new window while none is marked. The explorer's "Add to" select shows and sets the same mark. Drops and cursor clicks never change the mark.
- **Emptied window removed.** `window.moveSignal` (move, not copy) that takes the last signal out of a window removes that window in the same command and revision, for every window kind; the result names it as `removedWindow` (HTTP and CLI). **BREAKING** for callers that expected the emptied window to stay.

Out of scope: the sidebar work package (search rail or `/` popover, resizable sidebar, explorer redesign, D-026 "later WP"), workspace persistence (save/load, snapshots, undo; concept §8), reordering windows, per-window column span, more than two columns, heights that fill the viewport ("fit"), keyboard keys for marking, new window (`W`) or values window (`V`), legend restyling and status colours in the legend, Alt+drag copy discoverability, and everything `improve-navigation` owns: wheel and Ctrl/Shift+wheel zoom, one Back and one Reset, time navigation (typed times, keys, presets, extent), the A/B/Δ readout on the chart and the number format (D-025, D-026 number part, D-027 first two items). In the window header this change owns the layout (one line, fixed places, truncation, where Remove goes); `improve-navigation` owns which zoom controls appear in it.

## Order

`add-cursors` and `add-cli` (built, not yet archived) are archived before both `improve-navigation` and `improve-layout`; their deltas are the base of this change (values windows, option bar, drop zone C7, CLI result fields). `improve-navigation` is archived before `improve-layout`. Both touch `App.tsx` and the timeseries window header, so this change's web tasks are built after `improve-navigation`'s web tasks have landed.

## Capabilities

### New Capabilities
- `workspace-layout`: how the page uses the screen: collapsible sidebar, tiled window grid, top row and status strip, compact window headers with the window menu, the marked window, and the screen-use measure.

### Modified Capabilities
- `workspace-state`: a move that empties its source window removes it and returns `removedWindow` (D-027).
- `timeseries-window`: an emptied window no longer stays after a drag; renaming moves to double-click and the window menu; "One-line window header" is replaced by `workspace-layout` "Compact window header".
- `signal-catalog`: the "Add to" target is the marked window (D-027, D-020, D-022).
- `cli`: command results carry `removedWindow`.

## Impact

- `packages/shared`: `apply.ts` (`window.moveSignal` removes an emptied source), `workspace.ts` (`removedWindow` on `CommandResult`).
- `apps/server`: `src/workspace.ts` passes `removedWindow` through `POST /api/commands`.
- `apps/cli`: `src/run.ts`, `src/output.ts` print `removedWindow`.
- `apps/web`: `App.tsx`, `styles.css`, `keys.ts`, new `layout/sidebar.ts`, `explorer/SignalExplorer.tsx` (shell, grid, strip, mark); `chart/TimeseriesWindow.tsx`, `chart/window.css`, `chart/build.ts`, `values/ValuesWindow.tsx`, `values/values.css`, new `window/WindowTitle.tsx`, `window/WindowMenu.tsx` (headers).
- Tests: `packages/shared/test/apply.test.ts`, `apps/server/test/workspace.http.test.ts`, `apps/cli/test/cli.test.ts`, new `apps/web/test/sidebar.test.ts`, `apps/web/test/build.test.ts`.
- UI checks that read "the revision in the top bar" read it in the status strip from now on.
