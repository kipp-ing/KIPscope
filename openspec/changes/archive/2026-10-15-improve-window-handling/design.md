# Design

## Context

See proposal.md and D-037 items (1) and (2). Current state:

- **Height drag (`chart/TimeseriesWindow.tsx`).** `<div class="height-handle" title="Drag to resize">` sits right below `.plot`; CSS (`chart/window.css`) gives it 6 px, `margin: 0 -8px`, `cursor: ns-resize`, and a background only on hover or while pressed, so it is invisible at rest. `startHeightDrag` captures the pointer on the handle, holds no-select and suspends the live cursor, sets a local `heightDrag` state on every move (`clampHeight(startHeight + dy)`, 120–1200 px), and on release sends one `window.setHeight` unless the height equals `w.height ?? DEFAULT_PLOT_HEIGHT`; a refused command drops the local height. The local height is shown until the stored height changes. There is no Esc cancel.
- **`.plot { min-height: 280px }`** in `styles.css` keeps the plot box at 280 px even when the inline height is smaller, so a height below 280 px leaves an empty band under the canvas.
- **Values windows** have no height field (`ValuesWindow` in `packages/shared/src/workspace.ts`: "no range, display or height (D-023)"; `window.setHeight` on one is refused by `notOnValues`) and no handle.
- **Drop targets (`App.tsx`).** `targetAt(x, y)` takes `elementFromPoint(x, y).closest("[data-window-id],[data-drop]")`: a window section gives `{kind: "window"}`, `data-drop="new"` gives `{kind: "new"}`. Only `.status-strip` carries `data-drop="new"`, and only during an active drag. `onUp` handles `{kind: "new"}` for all sources: explorer rows via `addSignal(signal, NEW_WINDOW)`, legend and values rows via `dropCommand` (`window.moveSignal` without `targetWindowId`, `copy` from Alt/Ctrl), and a values row with no timeseries window via `moveToNewWindow`. Every path reveals the created window (`setReveal`).
- **List layout (`styles.css`).** `main` is the scroll container (`overflow-y: auto`, `padding: 0 16px 8px`, `container-type: inline-size`), a block box holding the sticky `.option-bar-slot`, `.window-grid` and, with no window, `p.hint` "No windows yet…". The grid has `gap: 8px`, `align-items: start`. Below `main` the `.status-strip` (28 px) is outside the scroll area.
- **Legend (`.signals`)** is a grid with `justify-content: start`; on a narrow window its value columns and the row's remove "×" can reach the window's right padding.

## Goals / Non-Goals

**Goals:**
- Two web engineers build in parallel on disjoint files (grip: G1–G4; drop: B1–B5); the tester writes `height.test.ts` and `drag.test.ts` against the helpers pinned in S1–S2.
- No change to `packages/shared`, the server, the CLI or any HTTP payload.
- Every number below is checked at half and double.

**Non-Goals:**
- No width resize, no column span, no reordering (D-037: "height only").
- No new command, no workspace field. The drop below reuses the "+ New window" paths unchanged.
- No Esc cancel or double-click reset for height drags (not there today; out of scope per proposal).

## Decisions

### G1: Grip added, strip kept (Q1)

Both the corner grip and the existing strip start the same `startHeightDrag`, so they cannot drift apart. The strip is a wide target right under the plot and costs nothing new; removing it would take a working handle away from users who found it. Alternative: remove the strip, one handle only (saves 6 px per window).

### G2: Grip look and place

- Element: `<div class="corner-grip" title="Drag to resize height" aria-label="Resize height">` holding an inline 16×16 SVG: one quarter-circle arc, convex toward the corner (e.g. `M 13 3 A 10 10 0 0 1 3 13`), `stroke: currentColor`, width 2, round caps, no fill. A direct child of the timeseries `<section>` (which is `position: relative`), rendered after `ul.signals`.
- CSS (`chart/window.css`): `position: absolute; right: 0; bottom: 0; width: 16px; height: 16px; cursor: ns-resize; touch-action: none; color: var(--muted)`; `:hover` and while dragging (`.active` or `:active`) `color: var(--accent)`. Always visible (D-037: "visible"). The window keeps `border-radius: 6px`; the arc sits inside the border.
- Cursor `ns-resize`, not `nwse-resize`: only the height changes (D-037: "width stays from the grid"), so the pointer must not promise a diagonal resize (Q2).
- The grip's `onPointerDown` calls `startHeightDrag` and `stopPropagation()`, so no ancestor handler (mark, cursor, row drag) sees the press.

| Number | Value | Half | Double |
|---|---|---|---|
| Hit box | 16×16 px | 8×8 px: as hard to hit as today's 6 px strip, the discoverability problem D-037 addresses comes back | 32×32 px: needs 28 px legend clearance and reaches into the last legend row's values in a 450 px wide window |
| Arc radius, stroke | 10 px, 2 px | 5 px / 1 px: a dot, not read as a handle | 20 px / 4 px: a heavy ornament on every window, larger than the hit box |

### G3: Legend clearance

The timeseries `<section>` gets the extra class `timeseries-window`; `chart/window.css` adds `.timeseries-window .signals { margin-right: 12px }`. With the window's 8 px right padding, legend content ends ≥ 20 px left of the border, 4 px clear of the 16 px hit box. Values windows are unchanged.

| Number | Value | Half | Double |
|---|---|---|---|
| Legend right margin | 12 px | 6 px: content can end 14 px from the border, under the 16 px hit box ("Grip covers nothing" fails) | 24 px: 12 px more legend width lost (≈ 2 % of a 560 px window), names truncate slightly earlier; harmless |

### G4: Height helpers and plot box

- New `chart/height.ts` (S1) holds the clamp and the command decision; `startHeightDrag` uses them and types its target as `HTMLElement`, so the strip and the grip share it. Behaviour is otherwise unchanged (local while dragging, one command on release, none when unchanged, refused command drops the local height).
- `styles.css`: `.plot { min-height: 280px }` is removed (the inline `height` sets the box), so heights from 120 px show without an empty band. This edit belongs to task 2.1, the owner of `styles.css`.
- Bounds stay 120–1200 px (`MIN_PLOT_HEIGHT`, `MAX_PLOT_HEIGHT`, D-018).

### B1: Free area element and DOM contract

- `App.tsx` renders `<div class="drop-below">` as the last child of `<main>`, after `.window-grid` and the hint, always (so nothing moves at drag start). During an active drag it gets class `drop`, the attribute `data-drop="new-below"` and the text "+ New window"; with the pointer over it (target `{kind: "new", place: "below"}`) also class `over`. Outside a drag it has no attribute and no content.
- `p.hint` "No windows yet…" is rendered only outside a drag, so with no window the free area is the whole list below the top row.
- `.status-strip` keeps `data-drop="new"`; its `over` class applies only when the target is `{kind: "new"}` with `place !== "below"`.

### B2: Free area geometry

- `styles.css`: `main` becomes `display: flex; flex-direction: column` with `padding: 0 16px` (bottom padding moves into the free area's margin, so a full list still ends 8 px below its last window); `.option-bar-slot`, `.window-grid` and `main > .hint` get `flex: none`.
- `.drop-below { flex: 1 0 0; min-height: 0; margin-top: 8px; position: relative; overflow: hidden; display: flex; align-items: center; justify-content: center }`. It fills what the list leaves below the grid; a list that overflows gives it 0 px, so it is never hit and never drawn.
- The dashed outline is a pseudo-element, not a border, so a 0 px area shows nothing: `.drop-below.drop::before { content: ""; position: absolute; inset: 0; border: 2px dashed var(--accent); border-radius: 6px }`, text `color: var(--accent)`, light fill as `.status-strip.drop`; `.drop-below.over` the stronger fill of `.status-strip.drop.over`.
- The 8 px `margin-top` is the dead band below the last row: a release there hits `main`, which is no target. Space beside a shorter window in the last row is inside `.window-grid`, also no target.

| Number | Value | Half | Double |
|---|---|---|---|
| Dead band below the last row | 8 px (= grid gap) | 4 px: a release meant for the last window that lands just under it creates a stray window (the feedback 2026-10-15 item 1 kind of bug) | 16 px: 8 px less target and 8 px more scroll at the end of a full list; harmless |
| Free area minimum | 0 px | — | a reserved minimum (e.g. 48 px) would cost list height on every full list (D-025) and duplicate the strip right below it |

### B3: Auto-scroll unchanged

The free area exists only when the list does not overflow, so it never competes with the 48 px auto-scroll band (`EDGE_PX`): at the end of a full list its height is 0, and with free space there is nothing to scroll. `autoScroll` is not changed.

### B4: Release semantics

`onUp` is not changed: `{kind: "new", place: "below"}` takes every path `{kind: "new"}` takes today (explorer add to `NEW_WINDOW`, `dropCommand` move or copy, `moveToNewWindow` for a values row without a timeseries window, `setReveal` of the created window). Source removal on a last-signal move comes from `window.moveSignal` (workspace-state, D-027).

### B5: Hint text (Q3)

The free area shows the strip's own label "+ New window", so both targets read as the same action. Alternative: "Drop here for a new window".

## Shared interfaces (pinned)

Both web tasks are independent; S1 and S2 are what the tester writes against.

### S1: `apps/web/src/chart/height.ts` (task 1.1, tested by 3.1)

```ts
import { type CommandInput, type TimeseriesWindow } from "@kipscope/shared";

/** Plot height after a vertical drag of dy CSS px from startHeight: rounded, clamped to
 * MIN_PLOT_HEIGHT..MAX_PLOT_HEIGHT. */
export function draggedHeight(startHeight: number, dy: number): number;

/** The command for a released height drag: window.setHeight with this height, or undefined when it
 * equals the stored height (w.height ?? DEFAULT_PLOT_HEIGHT). */
export function heightCommand(w: TimeseriesWindow, height: number): CommandInput | undefined;
```

### S2: `apps/web/src/chart/drag.ts` (task 2.1, tested by 3.2)

```ts
/** Which "+ New window" target a drop hit: the status strip or the free area below the windows. */
export type NewWindowPlace = "strip" | "below";

export type DropTarget =
  | { kind: "window"; windowId: string }
  | { kind: "new"; place?: NewWindowPlace }; // absent counts as "strip"

/** data-drop values. */
export const DROP_NEW = "new";
export const DROP_NEW_BELOW = "new-below";

/** Target named by an element (the closest [data-window-id],[data-drop] under the pointer):
 * data-window-id → window; data-drop "new" → { kind: "new", place: "strip" };
 * "new-below" → { kind: "new", place: "below" }; anything else or no element → undefined. */
export function dropTargetOf(
  el: { getAttribute(name: string): string | null } | null | undefined,
): DropTarget | undefined;
```

`canDrop`, `canAdd`, `dropCommand` and `dropStateFor` keep their signatures and look at `kind` only, so a `place` never changes a command. `App.tsx`'s `targetAt` becomes `dropTargetOf(document.elementFromPoint(x, y)?.closest("[data-window-id],[data-drop]"))`.

## Risks / Trade-offs

- **Flex column on `main`.** Sticky top row and container query keep working in a flex container, but a flex item may shrink: hence `flex: none` on the slot, the grid and the hint (B2). Checked by "Drag start moves nothing" and the existing "Two columns at 1440×900".
- **`add-series-cache` in parallel.** It may edit `TimeseriesWindow.tsx` (loader part); this change edits only the height drag and the view's grip element. If both build at once, the lead merges by hand.
- **Removing `.plot` min-height.** Before the first render the plot box takes the inline height (default 280 px), so the initial layout does not change.

## Migration Plan

None: no stored data changes.

## Open questions for Jan

Built as recommended; each answer changes one rule or element inside an existing task.

1. **Keep the strip below the plot?** (detail) Recommendation: keep it next to the grip (G1). Alternative: grip only, 6 px less per window.
2. **Grip pointer** (detail). Recommendation: `ns-resize`, since only the height changes (G2). Alternative: `nwse-resize`, the macOS corner look, though the width does not follow.
3. **Free area label** (detail). Recommendation: "+ New window", like the strip (B5). Alternative: "Drop here for a new window".
