# Design

## Context

D-112, two papercuts Jan saw on ADX with Edge on Windows. Web only; no shared type, HTTP payload or server change.

- **Digits:** `OptionBar.tsx` (~line 356) renders `<select aria-label="Digits">` inside `<OverflowMenu>`. `OverflowMenu.tsx` closes on any `pointerdown` outside its root (capture phase) and on `focusin` outside. Edge on Windows delivers the select popup's pointer down as outside, so the menu closes and the change is lost.
- **Unlink/Link:** `SessionBar.tsx`'s action button sends `case.unlink` or `case.go {index: current}`. `App.tsx` `caseCommand` sets `pending`/`progress` only when `pendingTarget` gives an index, which it never does for these two (unlinked → undefined; `case.unlink` → undefined). The server loads the vehicle's signal list before it applies (`case-navigation` "Step loads the target's list first"), seconds on ADX, with nothing on screen.

## Pinned interfaces (web only)

`apps/web/src/bar/` (Digits; one engineer):

```ts
/** The digits an arrow key on the Digits group chooses, or undefined for any other key.
 *  ArrowRight/ArrowDown → 4, ArrowLeft/ArrowUp → 3; no wrap. */
export function digitsByKey(current: Digits, key: string): Digits | undefined;
```

Exported from `OptionBar.tsx` (or a new `bar/digits.ts` re-exported there; the tester imports from `../src/bar/OptionBar.tsx`). The tester renders the control through `OptionBar` with the menu open, or through an exported `DigitsControl({digits, onCommand})` component in the same file; the engineer exports `DigitsControl`.

`apps/web/src/case/` (Unlink/Link; one engineer):

```ts
// sessionBar.ts
export type PendingAction = "Unlinking…" | "Linking…";
/** linked + case.unlink → "Unlinking…"; unlinked + case.go → "Linking…"; else undefined. */
export function pendingAction(
  c: Pick<WorkspaceCase, "linked">,
  input: CommandInput,
): PendingAction | undefined;
/** True exactly when pendingTarget(c, pending, input) or pendingAction(c, input) gives a value. */
export function startsPending(
  c: Pick<WorkspaceCase, "current" | "count" | "linked">,
  pending: number | undefined,
  input: CommandInput,
): boolean;

// SessionBar.tsx, new optional prop
actionPending?: PendingAction | undefined; // button text and disabled while set
```

The ellipsis is the single character `…` (U+2026), as in the step messages.

## Decisions

- **Digits markup:** `<div role="radiogroup" aria-label="Digits" title={HINTS.digits} class="digits-toggle">` with a muted `DIGITS` label (`aria-hidden`) and two `<button type="button" role="radio" class="toggle">` (the class the Align group and the cursor pills use, `bar.css` `.toggle[aria-checked="true"]`). Roving tabindex: checked `0`, other `-1`. `onKeyDown` on the group uses `digitsByKey`, focuses the chosen button and sends the command if it differs. A click on the checked button sends nothing. Buttons are real `<button>`s, so pointer downs land inside the menu root and no popup exists; the menu's close logic stays as it is.
- **First focus in "⋯":** `OverflowMenu` focuses `panel.querySelector("select, button:not([tabindex='-1']), input")`, so the checked Digits button gets focus on open. No other change to `OverflowMenu`.
- **Pending Unlink/Link in `App.tsx`:** a third state beside `pending` and `progress`: `actionPending` (state plus ref). `caseCommand` computes `pendingAction(open, input)`; when set it sets `progress` true and `actionPending`, clears `awaitedRevision`, and `settle` handles it exactly like a step (refused/failed → end; rendered revision ≥ result → end; else wait for `awaitedRevision` in the existing `onRendered` path). `endStep` clears `actionPending` too.
- **Superseding:** `settle` today returns early when `seq !== caseSeq.current`. Change: a case command that starts neither a target nor an action does not bump the sequence that guards the pending state (keep a separate `pendingSeq` bumped only when `startsPending` is true). So a refused `]` while unlinked cannot orphan `Linking…`; a newer step or action replaces the pending state as today.
- **Disabled while pending:** `disabled` of the action button becomes `disabled || actionPending !== undefined`. The arrows and the position button are unchanged (Unlink while linked keeps them as they are; while unlinked they are greyed anyway).
- **Fit in 64 px:** `Unlinking…` at the row's 12 px sans is about 60 px, close to the 62 px inside the 1 px borders. The slot box is fixed (D-095), so the label must fit: if `scrollWidth > clientWidth` at 12 px, the button uses `font-size: 11px; letter-spacing: -0.01em` in all states (the label slot already uses 11 px). Off by a factor of two (120 px of text) the box would still not move (fixed `width`, `overflow: hidden`, `white-space: nowrap`), only the text would clip; the UI check's `scrollWidth ≤ clientWidth` catches that.

## Numbers

- 64 × 24 px action slot, 2 px line: from D-095 and DW4, unchanged.
- "Seconds on ADX": the pending state has no timeout, so a reload twice as slow only shows the line longer; a reload of 0 ms on carserver is why the UI check records mutations instead of screenshots.

## Risks

- The sequence change in `caseCommand` touches the step path. The existing tests "shows the step target at once" and "shows the progress line only while a step is on its way" and the case-navigation "Step on smart451" UI check must stay green.
