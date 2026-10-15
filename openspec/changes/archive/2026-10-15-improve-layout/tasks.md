# Tasks

Grouped by write area (docs/team.md). Groups 1–3 run in parallel against design S1–S4; group 4 (tester) writes the tests test-first in parallel. The two web tasks have disjoint files:

- 3.1 shell: `App.tsx`, `styles.css`, `keys.ts`, `layout/sidebar.ts` (new), `explorer/SignalExplorer.tsx`
- 3.2 headers: `chart/TimeseriesWindow.tsx`, `chart/window.css`, `chart/build.ts`, `values/ValuesWindow.tsx`, `values/values.css`, `window/WindowTitle.tsx` and `window/WindowMenu.tsx` (new)

Precondition: `add-cursors`, `add-cli` and `improve-navigation` are archived (or at least `improve-navigation`'s web tasks have landed), since 3.1 and 3.2 edit the same files. The tasks assume the recommended answers to design "Open questions for Jan"; Q1 = workspace state would add tasks in groups 1, 2 and 4. Test names are those the specs cite as evidence.

## 1. packages/shared

- [x] 1.1 In `src/workspace.ts` and `src/apply.ts` add `removedWindow?: string` to `CommandResult` and `ApplyResult` (S1). In `window.moveSignal`, after placing the assignment and only for a move (not a copy), remove a source left without signals exactly as `window.remove` does (filter, `pruneColors`, clear `lastZoomed` when it named the source) and return `removedWindow` (L7). A move into a new window creates it from the source first. Verify the `apply.test.ts` tests of 4.1 pass and the rest of `pnpm --filter @letsview/shared test` stays green.

## 2. apps/server and apps/cli

- [x] 2.1 `apps/server/src/workspace.ts`: copy `removedWindow` into the command answer like `createdWindow` (S2). Verify `apps/server/test/workspace.http.test.ts` › "returns the window a move removed" passes.
- [x] 2.2 `apps/cli/src/output.ts` and `apps/cli/src/run.ts`: `CliOutput.removedWindow`, `"removedWindow"` in `BODY_KEYS` right after `"createdWindow"`, copied from the answer (S2). Verify `apps/cli/test/cli.test.ts` › "reports the window a move removed" passes.

## 3. apps/web/src

- [x] 3.1 Page shell (`App.tsx`, `styles.css`, `keys.ts`, `layout/sidebar.ts`, `explorer/SignalExplorer.tsx`), per design L1, L2, L3, L5, L6, S3, S4:
  - `layout/sidebar.ts` with `loadSidebar`, `saveSidebar`, `isSidebarKey`, `SIDEBAR_WIDTH_PX`, `SIDEBAR_STORAGE_KEY`. App holds the sidebar state (loaded once, saved on change), sets `sidebar-collapsed` on `.app`, handles `s`, renders the "Signals" toggle at the left of the top row. The explorer takes `open`/`onOpen`: `/` while collapsed opens it, then focuses and selects the search.
  - Top bar removed; the option-bar slot is the top row. The reserved `.drop-new` box becomes `.status-strip` (~28 px, 2 px border in both states): connection, revision and dismissible error message outside a drag; "+ New window" with `data-drop="new"` during a drag.
  - `<div className="window-grid">` around the windows; grid, container query at 920 px, lone-last span, `align-items: start`, 8 px gap; tile box `.window` padding `4px 8px`, no margin; explorer width 240 px. Remove `.window-header`, `.badge*` and `.spacer` rules from `styles.css` (3.2 owns them in `window.css`).
  - Mark: App state `marked`, resolved with `resolveTarget` on window changes; passes `marked`/`onMark` to both window kinds; `SignalExplorer` gets `target`/`onTarget` instead of its own state; adds go to the mark or a new window, which stays unmarked.
  - Verify `apps/web/test/sidebar.test.ts` and `apps/web/test/explorer.test.ts` pass, plus the UI checks of `workspace-layout` "Collapsible sidebar", "Sidebar state remembered", "Tiled window grid", "Window heights in the grid", "Drops in the grid", "Top row and status strip", "Marked window", "Mark is view state" and `signal-catalog` "Stable "Add to" target".
- [x] 3.2 Window headers (`chart/TimeseriesWindow.tsx`, `chart/window.css`, `chart/build.ts`, `values/ValuesWindow.tsx`, `values/values.css`, `window/WindowTitle.tsx`, `window/WindowMenu.tsx`), per design L4, L5, S3, S4:
  - One-line grid header (title | badge or cursor times | range | `.window-controls`) at ≤ 24 px for both kinds; controls 22 px; Mode select without the "Mode" word (`aria-label`).
  - `resolutionBadge` in `build.ts`; neutral badge with the full text as tooltip.
  - `WindowTitle`: single click calls `onMark`, double-click or the menu's "Rename" edits (Enter/blur saves, Esc cancels), tooltip `<title> · Double-click to rename`. `WindowMenu` "⋯" with "Rename" and "Remove window"; no Remove button in the header.
  - Header click outside `.window-controls` calls `onMark(w.id)`; `.window.marked` accent bar (`::before`) and accent title.
  - Verify `apps/web/test/build.test.ts` › "gives a short badge and the full resolution as tooltip" passes, plus the UI checks of `workspace-layout` "Compact window header", "Header truncation", "Window menu" and `timeseries-window` "Window names".

## 4. Tests (tester)

- [x] 4.1 `packages/shared/test/apply.test.ts`: replace "keeps an emptied source window" by "removes a window emptied by a move" (timeseries and values source, `removedWindow`, one revision); add "moves the only signal into a new window and removes the source", "keeps a window emptied by removeSignal, a copy or a refused move", "clears lastZoomed when a move removes that window". Adjust other shared tests that moved a window's last signal and then used that window.
- [x] 4.2 `apps/server/test/workspace.http.test.ts` › "returns the window a move removed"; `apps/cli/test/cli.test.ts` › "reports the window a move removed". Adjust existing server and CLI tests that relied on an emptied window staying (check "drives signal add, move, copy and remove over HTTP").
- [x] 4.3 `apps/web/test/sidebar.test.ts` › "loads and saves the sidebar state, open by default and when storage fails", "toggles with s outside text fields and selects only"; `apps/web/test/build.test.ts` › "gives a short badge and the full resolution as tooltip". Keep `explorer.test.ts` › "keeps the Add to target by window ID while windows change" green.

## 5. Checks

- [x] 5.1 Tester: `pnpm build && pnpm test && pnpm lint` green.
- [x] 5.2 UI user on smart451, six-window setup of design M1, at 1000×557 and (if the tool can resize) 1440×900 and 1920×1080: every UI scenario of `workspace-layout`, the changed scenarios of `timeseries-window` ("Last signal dragged out", "Drop into a new window", "Rename", "Rename from the menu", "Single click does not rename") and `signal-catalog` ("Removed target falls back", "Select and header mark the same window"); the M1 snippet per viewport and sidebar state, reported against the goals table. A viewport the tool cannot set is `not_run`.

## Workflow follow-up

- Archive order: `add-cursors`, `add-cli`, `improve-navigation`, then `improve-layout`.
- On archive copy into docs/decisions.md: L2 grid rule (two columns from 920 px, lone last spans), L6 mark as view state (or Jan's Q1 answer), L7 auto-remove with `removedWindow`.
