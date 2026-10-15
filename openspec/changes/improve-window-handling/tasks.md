# Tasks

Web only. Groups 1 and 2 run in parallel on disjoint files; group 3 (tester) writes the tests test-first against design S1 and S2 in parallel. The tasks assume the recommended answers to design "Open questions for Jan"; any other answer changes one rule or element inside 1.1 or 2.1.

- 1.1 grip: `apps/web/src/chart/TimeseriesWindow.tsx`, `apps/web/src/chart/window.css`, `apps/web/src/chart/height.ts` (new)
- 2.1 drop below: `apps/web/src/chart/drag.ts`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`
- 3.x tests: `apps/web/test/height.test.ts` (new), `apps/web/test/drag.test.ts`

## 1. apps/web/src: corner grip

- [ ] 1.1 Corner grip per design G1–G4 and S1:
  - New `chart/height.ts` with `draggedHeight` and `heightCommand` (S1); `startHeightDrag` uses them, takes an `HTMLElement` target and is otherwise unchanged.
  - Timeseries `<section>` gets the class `timeseries-window`; render `<div class="corner-grip">` with the arc SVG as its last child, `title="Drag to resize height"`, `aria-label="Resize height"`, `onPointerDown` → `stopPropagation()` and `startHeightDrag`. The `.height-handle` strip stays.
  - `chart/window.css`: `.corner-grip` (16×16 px, absolute bottom right, `ns-resize`, muted, accent on hover and while dragging) and `.timeseries-window .signals { margin-right: 12px }`.
  - No change to `ValuesWindow`.
  - Verify `apps/web/test/height.test.ts` passes, plus the UI checks of `timeseries-window` "Corner grip" and "Grip appearance" (all scenarios), "Resizable window height" › "One command per drag", "Smallest height on screen" (needs 2.1's `.plot` edit), and `workspace-layout` "Window heights in the grid" › "Grip in the right column".

## 2. apps/web/src: drop below the windows

- [ ] 2.1 Drop below per design B1–B5 and S2:
  - `chart/drag.ts`: `NewWindowPlace`, `place` on the `new` target, `DROP_NEW`, `DROP_NEW_BELOW`, `dropTargetOf` (S2). Existing functions keep their signatures.
  - `App.tsx`: `targetAt` uses `dropTargetOf`; render `.drop-below` as `<main>`'s last child (always), with `drop`, `data-drop="new-below"` and "+ New window" during an active drag and `over` when the target's `place` is `"below"`; the strip's `over` only for a `new` target with `place !== "below"`; the "No windows yet" hint only outside a drag. `onUp` unchanged.
  - `styles.css`: `main` as flex column with `padding: 0 16px`, `flex: none` on `.option-bar-slot`, `.window-grid`, `main > .hint`; `.drop-below` geometry, dashed `::before` outline and fills (B2); remove `min-height: 280px` from `.plot` (G4).
  - Verify `apps/web/test/drag.test.ts` passes, plus the UI checks of `workspace-layout` "Drop below the windows", "Free area bounds" and "Free area highlight" (all scenarios), `timeseries-window` "New windows scroll into view" › "Drop below a short list", and that `workspace-layout` "Top row and status strip" › "Drag start moves nothing" and "Tiled window grid" › "Two columns at 1440×900" still hold.

## 3. Tests (tester)

- [ ] 3.1 New `apps/web/test/height.test.ts` against S1: "clamps a dragged height to 120–1200 px" (50 → 120, 5000 → 1200, 280 + 200.4 → 480, rounding), "sends one setHeight only when the height changed" (undefined for the stored height and for `DEFAULT_PLOT_HEIGHT` when `height` is absent; `{ type: "window.setHeight", windowId, height }` otherwise).
- [ ] 3.2 `apps/web/test/drag.test.ts` against S2: "maps drop elements to targets" (fake elements with `getAttribute`: window ID, `new` → strip, `new-below` → below, unknown `data-drop`, no attributes, `null`/`undefined` → undefined) and "treats a drop below the windows like + New window" (`dropCommand` for `{kind:"new",place:"below"}` deep-equals the strip's for plain, Alt and Ctrl, including the last-signal move; `canAdd` and `canDrop` true). Keep all existing drag tests green.

## 4. Checks

- [ ] 4.1 `pnpm build && pnpm test && pnpm lint` green.
- [ ] 4.2 UI check on smart451 at 1440×900 of every UI scenario in `specs/timeseries-window/spec.md` and `specs/workspace-layout/spec.md` of this change; the Alt/Ctrl copy scenario may be `not_run` with the test as evidence.
