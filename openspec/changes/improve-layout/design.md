# Design

## Context

See proposal.md (Why) and D-025, D-026, D-027. Current state after `add-cursors`, `add-cli` and `improve-navigation` (the base of this change):

- **Page shell (`App.tsx`, `styles.css`).** `.app` is a two-column CSS grid: explorer `clamp(200px, 26vw, 340px)` (340 px from a 1308 px viewport) and `.workspace`. `.workspace` is a flex column: `<main>` (scrolls; top bar "letsview · connected · revision n · message", then the sticky `.option-bar-slot`, then the windows one per row with `margin-bottom: 12px`) and below it the `.drop-new` zone, which keeps its ~56 px permanently and is `visibility: hidden` outside a drag (add-cursors C7).
- **Window header.** Timeseries: title button (click renames), badge (`resolutionLabel`: `raw`, `aggregated · 2 min per point`, `partly aggregated · …`, coloured green/yellow), range, spacer, Mode select, Min/max, then the zoom controls (which `improve-navigation` reduces per D-025) and Remove. Values: title, cursor times, spacer, "Between points" select, Remove. A flex row with `nowrap`; the range shrinks first. Badge and range texts change length on zoom, and the controls after the spacer move with them only when the header overflows; the designer saw the Back button move after a zoom.
- **"Add to".** `SignalExplorer` holds `target` (window ID or `NEW_WINDOW`) in its own state; `resolveTarget` falls back to `NEW_WINDOW` when the window is gone (D-022).
- **Moves.** `applyCommand` `window.moveSignal` filters the assignment out of the source and leaves the window, empty or not. `window.remove` deletes the window, prunes colours and clears `lastZoomed`.
- **Plot width** follows its element through a `ResizeObserver` in `TimeseriesWindow`, so a narrower grid cell needs no chart change.

## Goals / Non-Goals

**Goals:**
- Server, CLI and two web engineers build in parallel against S1–S4.
- Pure CSS for the grid (container query), no layout JavaScript.
- Every layout number below is checked at half and double.

**Non-Goals:**
- No change to the drag machinery (D-022) beyond what the grid needs (nothing: `targetAt` already finds `[data-window-id]` under the pointer).
- No change to the option bar's content (owned by `add-cursors` / `improve-navigation`); this change only places it in the top row.
- No new workspace field or command; the mark is view state (L6, Q1).

## Decisions

### L1: Sidebar 240 px, collapsible, remembered per browser

- Open: `.app { grid-template-columns: 240px minmax(0, 1fr) }`. Collapsed: `.app.sidebar-collapsed { grid-template-columns: minmax(0, 1fr) }` and `.explorer { display: none }`. The explorer stays mounted, so query, active row and the `/` listener survive.
- One toggle, always in the same place: a "Signals" button at the left end of the top row (`aria-expanded`, tooltip "Hide signals (s)" / "Show signals (s)"). Alternatives: a collapse arrow inside the sidebar plus a 32 px rail when collapsed (costs width and two controls); a popover on `/` (that is the later sidebar work package).
- Key `s` (no modifier, focus not in a text field or select, via `isTextField`) toggles. A select is excluded because letter keys pick options there. `/` keeps D-020's meaning: if collapsed, App opens the sidebar and the explorer focuses and selects the search after the open render.
- Remembered in `localStorage["letsview.sidebar"]` = `"open" | "collapsed"`, every access in try/catch, default and fallback `"open"`. Not workspace state: two viewers of one workspace can have different screens.
- No animation: the plots resize once through their `ResizeObserver`.

| Number | Value | Half | Double |
|---|---|---|---|
| Open width | 240 px | 120 px: names like `CPC_168h.EAC_HV_Volt` cut after ~8 characters, unit hidden | 480 px: more than today's 340 px, defeats D-026 |

Testers proposed ~200 px; at 200 px a 20-character name keeps ~16 characters next to dot, unit and `+`, at 240 px ~21 (12 px monospace ≈ 7.2 px per character). Q5.

### L2: Grid by container query, at most two columns

- App wraps the windows in `<div class="window-grid">` inside `<main>`; only window `<section>`s are its children. `main { container-type: inline-size }`; `.window-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; align-items: start }`; `@container (min-width: 920px) { .window-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) } }`.
- A lone last window spans: `.window-grid > :last-child:nth-child(odd) { grid-column: 1 / -1 }` (inside the container query). One window therefore stays full width as today. Alternative: it stays half width and leaves half a row empty (Q7).
- Row by row in workspace order; no reordering, no per-window span, no masonry (`grid-auto-flow: dense` would reorder windows away from their IDs and from the CLI's order).
- Heights: each timeseries window keeps `height` (D-018); `align-items: start` makes a row as tall as its tallest window. A shorter neighbour leaves empty space below it; stretching it would show a height the workspace does not hold.
- Values windows take a cell like any window.
- Aligned time axes (D-021) still hold: all windows get the same insets, so in each column one timestamp sits at the same x in windows of equal width, which the spec already limits it to.

| Number | Value | Half | Double |
|---|---|---|---|
| Two columns from list width | 920 px (cells ≥ 456 px, plot ≈ 376 px) | 460 px: two columns already at 1000 px with the sidebar open, plots ≈ 290 px wide, about four time labels | 1840 px: two columns only at 1920 px with the sidebar collapsed; no tiling at 1440 px, D-026 unmet |
| Gap | 8 px | 4 px: tiles hard to tell apart, a release meant for the gap hits a window | 16 px: 1 % of a 1440 px row wasted for nothing |
| Columns | at most 2 | — | 3 at 1920 px: plots ≈ 490 px; time series lose resolution for little gain (Q7) |

A classic scrollbar (up to 15 px) narrows the list: at 1000 px collapsed the list is 984 − 15 = 969 px, still above 920.

### L3: One top row, one status strip

- The top bar (`header.topbar`, ~42 px plus 12 px margin) goes. The sticky `.option-bar-slot` becomes the top row: "Signals" toggle, then `<OptionBar>` unchanged. It may wrap if `improve-navigation` makes the bar wider than the viewport; one line at 1440 px is a goal.
- The reserved `.drop-new` box becomes the status strip `.status-strip`: about 28 px tall plus 4 px margin, full list width. Outside a drag it shows `connected · revision n` (or `disconnected`) and the last error message (click dismisses, as today). During a drag it shows "+ New window" with the dashed accent border and carries `data-drop="new"`. The border is 2 px in both states (transparent outside a drag), so its size never changes and nothing moves at drag start (C7).
- Auto-scroll bands stay 48 px below the top row and above the strip (`barRef`, `dropRef`).

| Number | Value | Half | Double |
|---|---|---|---|
| Strip height | ~28 px | 14 px: a drop target that thin across a 1000 px wide list is still wide, but the text is cut | 56 px: today's zone, 6 % of a 900 px screen |

### L4: Compact header with fixed control places

- `.window-header` becomes a CSS grid on one line, height ≤ 24 px, `font-size: 12px`, title 13 px semibold: `grid-template-columns: minmax(6ch, max-content) auto minmax(0, 1fr) auto` = title | badge (timeseries) or cursor times (values) | range (timeseries; empty cell for values) | `.window-controls` (flex, `nowrap`: the window's controls, then "⋯"). Grid sizing gives the `1fr` range cell what is left after the others reach their content size, so the range truncates first, then the title shrinks to `6ch`. The controls cell is sized by its own content only, so its x depends on the window width and the set of controls, not on text.
- Controls are 22 px tall (`padding: 0 6px`). The Mode select drops its "Mode" word (`aria-label="Display mode"`); "Min/max" stays.
- Badge: `resolutionBadge` (S4) gives a short text (`raw`, `agg · 2 min`, `part · 2 min`) and the full `resolutionLabel` as tooltip. Neutral colours (muted text, 1 px `--border` outline, no fill): the designer found green/yellow competing with the signal palette (goal).
- Window menu: "⋯" (`aria-label="Window menu"`, `aria-haspopup="menu"`) opens a small popover below it with "Rename" and "Remove window". Esc, a click outside or an item closes it. Remove leaves the header (two clicks instead of one; no undo exists yet, concept §8 is later). Alternative: a "×" icon (one click, easy misclick next to Min/max; Q9).
- Rename: double-click on the title, or "Rename" in the menu, turns the title into the text field (Enter/blur saves, Esc cancels, as today). A single click marks (L5). The title's tooltip reads `<title> · Double-click to rename`. Status's known limitation "Rename has no visible affordance" is answered by the tooltip and the menu item.
- Chrome around the plot: `.window` padding `4px 8px`, header margin 2 px; window chrome above the plot drops from about 60 px to about 47 px (border 1, padding 4, header 24, margin 2, axis titles 16).

| Number | Value | Half | Double |
|---|---|---|---|
| Header height | ≤ 24 px | 12 px: below the 12 px text plus the 22 px controls | 48 px: today's chrome, the finding |
| Title minimum | 6 characters | 3: `Win…` no longer tells `Window 1` from `Window 12` | 12: at 456 px cells the controls (~220 px) leave too little for the range |

### L5: Marking a window

- A click on the header marks the window: on the title, the badge, the range or the empty cell; not on a control (select, checkbox, buttons in `.window-controls`, the menu). Implemented in the header's `onClick` with `event.target.closest(...)` excluding `.window-controls`. Alternative: a dedicated "target" button in each header (one more control in a compact header, small hit area; Q2).
- No other gesture marks: a click in the plot sets cursor A and is often done in several windows in a row; a drop goes where the pointer is. Following them would bring back the "target jumps under the click" bug that D-020 fixed.
- Display: `.window.marked` shows a 3 px accent bar along its top edge (`::before`, absolute, so nothing moves) and the title in `--accent`; the header tooltip on the empty cell reads "Adds from the explorer go here". The drop highlight (2 px outline all around plus the hint overlay) stays distinct.
- State: App holds `marked: string | undefined` (window ID). `resolveTarget` (D-022) runs on every window-list change, so a removed window (menu, CLI or L7) clears the mark. The explorer's "Add to" select becomes controlled by App (`target`, `onTarget`); choosing a window marks it, choosing "New window" clears the mark. It stays as the keyboard path and the way to unmark (Q3).
- Adds: Enter and the row's `+` call `onAdd(signal, target)` as today; App adds to the marked window or creates a new one. A rejected add (unit limit, duplicate) shows its message and changes neither the mark nor the window list. A window created by an add is not marked (D-027 chose marking over the testers' "follow the new window"; Q4).

### L6: The mark is view state (recommendation)

The mark lives in App state of one browser tab, like the old select and the zoom history: no command, no revision, gone on reload. Pro: no shared-model change, no CLI change, two viewers do not fight over one target, and a stale ID after a server restart (IDs restart at `w1`) cannot point at the wrong window. Con: a CLI or AI caller cannot see where the user's adds go. Alternative: `Workspace.marked?: string` with a command `window.mark {windowId | null}`, in `GET /api/workspace` and `letsview state` (concept §7 „auslesbarer Zustand"); costs one shared command, one CLI form and tests in three packages. Q1 (direction).

### L7: Auto-remove inside `window.moveSignal`

- After placing the assignment, if the move was not a copy and the source has no signals left, `applyCommand` removes the source window exactly as `window.remove` does (filter, `pruneColors`, clear `lastZoomed` when it named the source) and returns `removedWindow: source.id`. One command, one revision.
- A move into a new window creates the new window from the source (range, display, height) before the source is removed; the result carries both `createdWindow` and `removedWindow`.
- Only moves: `window.removeSignal` leaves an empty window (the user removed a signal, maybe to add another), and so does a copy. Both kinds of window are removed.
- Linked ranges are untouched. The zoom history of the removed window is simply never used again (App keys histories by window ID while unlinked; the linked history is shared). App's existing effects already drop the removed window's insets and render-ready entry, and `resolveTarget` clears a mark on it.
- The web learns of the removal from the next state; it needs no `removedWindow`. HTTP and CLI pass it on (S2) so a caller sees the side effect without reading the state.

### M1: Measuring screen use

**Six-window setup.** After a server restart, with no window marked, add from the explorer one by one: `COMBI_412h.V_ANZ`, `BS_200h.DVL`, `MS_608h.T_MOT`, `CPC_448h.PTC_HV_Volt`, `CPC_168h.EAC_HV_Volt`, `AC_A1.T_SOLL` (each Enter makes a new window). Default heights, linked, cursors off, no values window, list scrolled to the top, viewport = `innerWidth × innerHeight`.

**Snippet** (plot area = uPlot's `.u-over`, the drawing area without axes), run in the page:

```js
(() => { const W = innerWidth, H = innerHeight; let a = 0, full = 0;
  for (const o of document.querySelectorAll('.window .u-over')) { const r = o.getBoundingClientRect();
    a += Math.max(0, Math.min(r.right, W) - Math.max(r.left, 0)) * Math.max(0, Math.min(r.bottom, H) - Math.max(r.top, 0)); }
  const strip = document.querySelector('.status-strip')?.getBoundingClientRect().top ?? H;
  for (const w of document.querySelectorAll('.window')) { const r = w.getBoundingClientRect(); if (r.top >= 0 && r.bottom <= strip) full++; }
  return `${W}x${H} plot ${(100 * a / (W * H)).toFixed(1)} %, fully visible windows ${full}`; })()
```

**Estimates** from the CSS above, assuming a left axis of 50 px, 12 px right inset and 240 px drawing height in a 280 px plot. Today's values except the measured 25 % are estimates too.

| Viewport | Today | Estimate open | Goal open | Estimate collapsed | Goal collapsed | Fully visible windows today → goal |
|---|---|---|---|---|---|---|
| 1000×557 | ~25 % (measured), 27 % est. | 37 % | ≥ 35 % | 45 % | ≥ 42 % | 1 → 1 open, 2 collapsed |
| 1440×900 | 36 % est. | 41 % | ≥ 40 % | 51 % | ≥ 48 % | 1 → 4 |
| 1920×1080 | 40 % est. | 51 % | ≥ 48 % | 59 % | ≥ 55 % | 2 → 4 |

The gain at 1440×900 with the sidebar open is modest in pixels (the single column was already wide) and large in windows seen at once (1 → 4). Collapsing the sidebar is the big lever. Filling the viewport height (Q8) would add about 6 points at 1440×900.

**Must:** ≥ 30 % at 1000×557 open, the only measured baseline. Half (15 %): today's layout passes, so it proves nothing. Double (60 %): above every estimate, unreachable without filling heights.

## Shared interfaces (pinned)

### S1: Shared types (`packages/shared`)

```ts
// src/workspace.ts
export type CommandResult =
  | { ok: true; revision: number; created?: string; createdWindow?: string; removedWindow?: string }
  | { ok: false; code: CommandErrorCode; message: string };

// src/apply.ts
export type ApplyResult =
  | { ok: true; workspace: Workspace; created?: string; createdWindow?: string; removedWindow?: string }
  | { ok: false; code: CommandErrorCode; message: string };
```

No new command, no new workspace field.

### S2: HTTP and CLI

- `POST /api/commands` answers `{ok: true, revision, created?, createdWindow?, removedWindow?}`; `apps/server/src/workspace.ts` copies `removedWindow` like `createdWindow`.
- CLI (`apps/cli/src/output.ts`): `CliOutput.removedWindow?: string`; `BODY_KEYS` gets `"removedWindow"` right after `"createdWindow"`. `run.ts` copies `answer.removedWindow` like `answer.createdWindow`.

### S3: Web props and DOM contract (between tasks 3.1 and 3.2)

```ts
// chart/TimeseriesWindow.tsx and values/ValuesWindow.tsx, added to Props
/** This window is the explorer's add target (L5). */
marked: boolean;
/** A click on the header outside the controls; App marks the window. */
onMark: (windowId: string) => void;

// explorer/SignalExplorer.tsx, Props (the internal target state goes)
/** NEW_WINDOW or the marked window's ID; App resolves it with resolveTarget. */
target: string;
/** The "Add to" select changed: a window ID marks it, NEW_WINDOW clears the mark. */
onTarget: (target: string) => void;
/** Sidebar open; while false, `/` calls onOpen and focuses the search after it becomes true. */
open: boolean;
onOpen: () => void;
```

DOM and CSS:
- App renders `<div className="window-grid">` with only the window sections as children; the "No windows yet" hint stays outside it. Sections keep `data-window-id`.
- `styles.css` (3.1) owns the page shell, the grid, the top row, the status strip, the explorer, and the tile box: `.window { background; border; border-radius; padding: 4px 8px; margin: 0 }`. It drops its `.window-header`, `.badge`, `.badge.agg`, `.badge.raw` and `.spacer` rules.
- `chart/window.css` (3.2) owns everything inside `.window`, including `.window-header`, `.window-controls`, `.badge`, the menu and `.window.marked`. `values/values.css` (3.2) only what is specific to values windows.
- The App sets `className` `sidebar-collapsed` on `.app` while collapsed.

### S4: Web helpers

```ts
// apps/web/src/layout/sidebar.ts (3.1)
export type SidebarState = "open" | "collapsed";
export const SIDEBAR_STORAGE_KEY = "letsview.sidebar";
export const SIDEBAR_WIDTH_PX = 240;
/** Unknown value, missing or throwing storage → "open". */
export function loadSidebar(storage: Pick<Storage, "getItem"> | undefined): SidebarState;
/** Never throws. */
export function saveSidebar(storage: Pick<Storage, "setItem"> | undefined, state: SidebarState): void;
/** `s` without Ctrl/Meta/Alt while focus is not in a text field or select (isTextField counts SELECT). */
export function isSidebarKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }, focused: Element | null): boolean;

// apps/web/src/chart/build.ts (3.2)
/** Short badge text and the full resolutionLabel as tooltip; undefined while nothing is loaded. */
export function resolutionBadge(results: (SeriesResult | undefined)[]): { short: string; full: string } | undefined;
// all raw → {short: "raw", full: "raw"}; all aggregated, widest 2 min → {short: "agg · 2 min", full: "aggregated · 2 min per point"};
// mixed → {short: "part · 2 min", full: "partly aggregated · 2 min per point"}
```

`window/WindowTitle.tsx` (title button, double-click rename, `editing` controlled so the menu's "Rename" can open it) and `window/WindowMenu.tsx` (`{onRename, onRemove}`) are internal to 3.2 and replace the two copies of `WindowTitle` in the window components.

## Risks / Trade-offs

- [Auto-remove surprises a CLI caller that kept using the emptied window ID.] → `removedWindow` in the result; the next command on it answers `unknown_window` as for any removed window.
- [A single click on the title no longer renames; muscle memory from the last two changes.] → Tooltip "Double-click to rename" and "Rename" in the menu.
- [Half-width plots at 1440 px show about half the time labels.] → Collapse the sidebar (cells grow 24 %), or a single window spans the full width. Per-window span is out of scope.
- [Rows with very different heights leave holes.] → Accepted; heights are the user's (D-018). Fill-height is Q8.
- [`improve-navigation` adds controls to the header or the option bar.] → The controls cell and the top row are sized by content; the 6-character title floor and the range absorb the rest. The narrow-window scenario at 1000×557 collapsed catches an overflow.
- [Browser tool cannot set 1440×900 or 1920×1080 (the efficiency test ran at 1000×557).] → Those viewports are goals and `not_run` if the tool cannot resize; the must is at 1000×557.
- [`s` collides with a key `improve-navigation` might pick.] → The lead reserves `s` for the sidebar when both changes are reviewed together.

## Migration Plan

No data migration: the workspace is in memory and no field changes. The behaviour change for callers is `removedWindow` and the disappearing window (proposal **BREAKING**). Tests that relied on an emptied window staying are updated in 4.1 and 4.2. UI checks that read "the revision in the top bar" read the status strip. Rollback: revert the commit and restart the server.

## Open questions for Jan

Resolved by Jan (2026-10-15, D-028): every recommendation below is accepted; the tasks already follow them.

The tasks assume every recommendation. Q1 = workspace state would add a shared command, a CLI form and tests (new tasks in 1, 2 and 4); every other answer changes one CSS rule or one handler inside an existing task.

1. **Mark: view state or workspace state?** (direction) Recommendation: view state per browser tab (L6). Alternative: `Workspace.marked` with `window.mark`, visible to the CLI and an AI caller (concept §7).
2. **How to mark** (detail). Recommendation: click on the header outside the controls; renaming moves to double-click and the menu. Alternative: a small "target" button per header, title click keeps renaming.
3. **"Add to" select** (detail). Recommendation: keep it as a mirror that also sets and clears the mark (keyboard path, unmark). Alternative: replace it with a read-only line "Adds to Speeds ✕".
4. **No mark: does a window created by an explorer add become marked?** (detail) Recommendation: no, every add without a mark makes a new window (D-027 chose marking over "follow the new window"). Alternative: mark it, so the second Enter adds there.
5. **Sidebar width** (detail). Recommendation: 240 px. Alternative: the testers' 200 px (long names cut earlier).
6. **Sidebar key** (detail). Recommendation: `s` outside text fields and selects. Alternative: no key, button and `/` only.
7. **Grid** (detail). Recommendation: at most two columns from 920 px, a lone last window spans the full width. Alternatives: the lone window stays half width; three columns from about 1400 px.
8. **Fill the height** (direction). Recommendation: not in this change; heights stay the user's (D-018). Alternative: a "Fit" action or automatic heights so two rows fill the viewport (about +6 points at 1440×900), maybe with the sidebar work package.
9. **Remove** (detail). Recommendation: in the "⋯" menu (two clicks, no undo yet). Alternative: a "×" icon at the header's right end.
10. **Top bar** (detail). Recommendation: drop it; connection, revision and errors go into the bottom strip that C7 keeps reserved anyway. Alternative: keep a slim top bar and leave the strip empty outside drags.
