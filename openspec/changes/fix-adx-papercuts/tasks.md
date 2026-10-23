# Tasks

One round, web only (D-112). Interfaces are pinned in design.md "Pinned interfaces"; the three tasks run in parallel.

Write areas (disjoint per task):

- 1.x: `apps/web/src/bar/OptionBar.tsx`, `apps/web/src/bar/OverflowMenu.tsx`, `apps/web/src/bar/bar.css`
- 2.x: `apps/web/src/case/sessionBar.ts`, `apps/web/src/case/SessionBar.tsx`, `apps/web/src/case/case.css`, `apps/web/src/App.tsx`
- 3.x: `apps/web/test/bar.test.ts`, `apps/web/test/sessionBar.test.ts` (tester)

## 1. apps/web/src/bar (Digits)

- [x] 1.1 Replace the Digits `<select>` with the exported `DigitsControl` segmented control and export `digitsByKey` (design "Digits markup"); rename `digitsSelect` in the `<OverflowMenu>` block; same `workspace.setOptions {digits}` command; no command on a click of the checked button.
- [x] 1.2 `OverflowMenu`: first focus skips `tabindex="-1"` (design "First focus in "⋯"").
- [x] 1.3 Verify: `pnpm --filter @kipscope/web test bar`, `pnpm lint`.

## 2. apps/web/src/case + App.tsx (Unlink/Link)

- [x] 2.1 `sessionBar.ts`: `PendingAction`, `pendingAction`, `startsPending` (design).
- [x] 2.2 `SessionBar.tsx`: prop `actionPending`; button text and `disabled` from it; the box stays 64 × 24 px (design "Fit in 64 px", `case.css` only if the label does not fit).
- [x] 2.3 `App.tsx` `caseCommand`: `actionPending` state, progress and end like a step; separate pending sequence (design "Pending Unlink/Link", "Superseding"); pass `actionPending` to `SessionBar`.
- [x] 2.4 Verify: `pnpm --filter @kipscope/web test sessionBar`, `pnpm lint`.

## 3. Tests (tester)

- [x] 3.1 `bar.test.ts` › "renders Digits as a segmented control" and › "moves Digits with the arrow keys" (number-format "Digits control markup and keys"); update › "renders the top row in order" (no `aria-label="Digits"`, no `<select` in the row; the `<OverflowMenu>` block holds the Digits control instead of `digitsSelect`).
- [x] 3.2 `sessionBar.test.ts` › "names the pending Unlink and Link" and › "shows Unlinking… and Linking… while pending" and › "starts a pending state only for a target or an action" (case-navigation "Pending action helper", "Pending action markup", "Which commands start a pending state").
- [x] 3.3 Run `pnpm build`, `pnpm test`, `pnpm lint`.

## 4. UI checks (UI user, after 1–3)

- [x] 4.1 number-format "Real click on 4 keeps the menu open".
- [ ] 4.2 saved-views "Overflow menu by keyboard".
- [x] 4.3 case-navigation "Unlink and Link on smart451" (MutationObserver record, no test hook).
- [ ] 4.4 case-navigation "Probe over steps" and "Step on smart451" still pass (regression of the sequence change).
