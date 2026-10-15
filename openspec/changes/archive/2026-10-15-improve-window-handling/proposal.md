# Proposal

## Why

Jan asked for two window-handling improvements (D-037, items 1 and 2):

> „then a drag of a signal to empty space create new time series. then window sizing is possible (look like i managed once) therer should be the apple like curved handle lower right to grab."

D-037 records his picks: "(1) every timeseries window gets a visible macOS-style grip in its lower right corner that drags the height (width stays from the grid); (2) dropping a signal on the free area below the last window (or on an empty window list) creates a new timeseries window with it, like "+ New window"; gaps between windows stay no target". "(1) and (2) form one change, (3) its own." Item (3), the browser series cache, is the separate change `add-series-cache`.

Today the height can only be changed through `.height-handle`, a 6 px strip below the plot that shows nothing until hovered ("look like i managed once"). A new window can only be made by a drop on the "+ New window" strip at the bottom of the viewport, even when most of the window list is empty space.

## What Changes

- **Corner grip.** Every timeseries window shows a curved grip in its lower right corner, always visible, that drags the plot height exactly like the strip below the plot: the plot follows locally while dragging, one `window.setHeight` goes out on release, none when the height did not change, 120–1200 px as today. The width stays from the grid. The strip below the plot stays as a second handle (design G1, Q1). Values windows have no height (D-023: "no range, display or height") and get no grip.
- **Drop below the windows.** During a row drag (explorer, legend or values row), the free area of the window list below the last window, or the whole list below the top row when there is no window, is a "+ New window" target: highlighted with the hint "+ New window" while dragging, a release there does exactly what a release on the "+ New window" strip does (same command, move vs Alt/Ctrl copy, source removed when its last signal leaves, new window scrolled into view). The gaps between windows, the 8 px just below the last window and the empty space beside a shorter window in the last grid row stay no target. A full list has no free area; the strip stays the always reachable target.

Out of scope: width resize or per-window column span (D-037: "height only"; workspace-layout L2), a grip or height for values windows, Esc to cancel a height drag (the strip has none today), double-click to reset the height, keyboard resize, a drop target in the gaps or beside a shorter window, a reserved minimum free area under a full list, reordering windows by drop position, and everything of `add-series-cache` (D-037 item 3).

## Order

Independent of `add-series-cache` (that change touches the series loader, this one the window chrome and the drop targets). Both are web changes; if both build at once, `apps/web/src/chart/TimeseriesWindow.tsx` is the only file they may share, and this change only touches its view part (height drag and the grip element).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `timeseries-window`: "Resizable window height" names the corner grip besides the strip; new "Corner grip" and "Grip appearance" requirements; "New windows scroll into view" covers the drop below the windows.
- `workspace-layout`: "Window heights in the grid" names the grip; new "Drop below the windows", "Free area bounds" and "Free area highlight" requirements.

## Impact

- `apps/web/src/chart/TimeseriesWindow.tsx`, `apps/web/src/chart/window.css`, new `apps/web/src/chart/height.ts` (grip, design G1–G4).
- `apps/web/src/chart/drag.ts`, `apps/web/src/App.tsx`, `apps/web/src/styles.css` (drop below, design B1–B5).
- Tests: new `apps/web/test/height.test.ts`, `apps/web/test/drag.test.ts`.
- No change to `packages/shared`, `apps/server`, `apps/cli` or the HTTP API: both features use existing commands (`window.setHeight`, `window.moveSignal`, the explorer's add-to-new-window path).
