# Tasks

One round, web only (D-113). Interfaces are pinned in design.md "Pinned interfaces"; tasks 1 and 2 run in parallel.

Write areas (disjoint per task):

- 1.x: `apps/web/src/help/hints.ts`, `apps/web/src/case/sessionBar.ts`, `apps/web/src/case/SessionBar.tsx`, `apps/web/src/case/case.css`, `apps/web/src/App.tsx`
- 2.x: `apps/web/test/sessionBar.test.ts`, `apps/web/test/hints.test.ts` (tester)

## 1. apps/web/src (engineer)

- [ ] 1.1 `hints.ts`: `HINTS.unlinkSlow` (design "Pinned interfaces").
- [ ] 1.2 `sessionBar.ts`: `UNLINK_HINT_DELAY_MS`, `patienceHintFor`, `startPatienceTimer`.
- [ ] 1.3 `SessionBar.tsx` + `case.css`: prop `unlinkHint`; the `session-unlink-hint` span in the title slot (design "Markup", "CSS").
- [ ] 1.4 `App.tsx`: `unlinkHint` state, timer started in `caseCommand` only for Unlink, cancelled in `endStep`, on a new pending state and on unmount; pass `unlinkHint` (design "App wiring").
- [ ] 1.5 Verify: `pnpm --filter @kipscope/web test sessionBar hints`, `pnpm lint`.

## 2. Tests (tester)

- [ ] 2.1 `sessionBar.test.ts` › "starts the Unlink hint after the delay, only for Unlink" (fake timers) and › "shows the Unlink hint in the title slot" (case-navigation "Patience hint helpers", "Patience hint markup").
- [ ] 2.2 `hints.test.ts` › "words the Unlink patience hint (D-113)" (case-navigation "Hint wording").
- [ ] 2.3 Run `pnpm build`, `pnpm test`, `pnpm lint`.

## 3. UI checks (UI user, after 1–2)

- [ ] 3.1 case-navigation "Slow Unlink on smart451" (cold extent; record, one screenshot).
- [ ] 3.2 case-navigation "Warm Unlink on smart451".
- [ ] 3.3 case-navigation "Unlink and Link on smart451" still passes (regression of `caseCommand`/`endStep`).
