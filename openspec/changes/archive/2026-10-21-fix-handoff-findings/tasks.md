# Tasks

Every interface two tasks share is pinned in design X1 (`trimCases`), and X4 (`caseReport.ts`, `caseOpenEvents`), so all build tasks can run in parallel; an engineer stubs a pinned import until its task lands. The tester writes group 6 test-first from the specs.

Write areas (disjoint):

- 1.1: `packages/shared/src/caseTrim.ts` (new), `index.ts`
- 2.1: `apps/server/src/case.ts`
- 3.1: `apps/web/src/workspaces/caseReport.ts` (new), `workspaces/startup.ts`, `filedrop.ts`, `case/sessionBar.ts`, `App.tsx`
- 3.2: `apps/web/src/case/sessionBar.ts`, `case/SessionBar.tsx`, `case/case.css`, `App.tsx`
- 4.1: `apps/cli/src/args.ts`, `apps/cli/src/case.ts`
- 5.1: `docs/handoff.md`
- 5.2: `README.md`
- 6.x: tests as listed per task

## 1. packages/shared

- [x] 1.1 `caseTrim.ts` with `TrimmableCases`, `TrimResult`, `trimCases` (X1: drop order, bisection, `===` when it fits, `link_too_long` with `chars`, RangeError on a bad `current`) exported from `index.ts`. Verify: `pnpm --filter @kipscope/shared build`; scenarios "Short side kept", "Tie and middle", "Current at an edge", "Fits or cannot fit".

## 2. apps/server/src

- [x] 2.1 Loopback back link in identity `none` (X3): `listedOrigin` takes the identity and accepts an `http(s)` URL whose `hostname` `isLoopbackHost` accepts, in `none` only. Verify: scenarios "Foreign back link", "Loopback back link".

## 3. apps/web/src

- [x] 3.1 Open report on every path (X4): `workspaces/caseReport.ts` (`CASE_REPORT_KEY`, `stashCaseReport`, `takeCaseReport`, never throwing); `openDroppedCatalog` stashes the answer's report before `go`; the start-up takes it for the settled workspace; `caseOpenEvents` in `case/sessionBar.ts`; `App.tsx` shows the open with `showResult(caseOpenEvents(…))` and no separate `setNotice`. Verify: scenarios "One notice for case texts and warnings", "Report carried across the page load", "Link in the browser" (unchanged), "Dropped file" (unchanged).

- [x] 3.2 Open report in the session bar (X4a): `openNoteText`, `endsOpenNote`, `caseOpenEvents` built from `openNoteText`; `SessionBar` props `openNote`, `onDismissNote` with the note and its ✕ after the session text; the note's CSS; `App.tsx` holds the note, sets it on open, clears it on ✕ and on `endsOpenNote`. Verify: scenarios "Note in the bar", "One notice for case texts and warnings" (unchanged), "Bar on smart451" (strip ≤ 56 px).

## 4. apps/cli/src

- [x] 4.1 `case url --trim` (X2): `--trim` flag only on `case url`, `trim: true` in the invocation, the help line `case url FILE|- [--trim]`; the trim path (JWS refused, unsigned code decoded, document checked, `trimCases` with the link encoder, `local.dropped` and `local.position`, `link_too_long` with `chars`). Verify: scenarios "Link of a catalog", "Trimmed link", "Trim flag parsed", "Help lists the forms".

## 5. Docs

- [x] 5.1 `docs/handoff.md` per X5: the balanced trim rule (replaces "alternately"), with the 3,540/213 example, `trimCases` and `kipscope case url --trim`; UTF-16 lengths and UTF-8 inflated bytes; `invalid_catalog` refuses the catalog as a whole; `view` charts at `[from − pad, to + pad)`; the named tab's opener rule (`Cross-Origin-Opener-Policy`, `noopener`, a new tab each time otherwise); the loopback back link in `none` in the `origin` and `KIPSCOPE_FINDER_ORIGINS` rows. Verify: scenario "Guide names every key and claim".
- [x] 5.2 `README.md` `case url` row names `--trim`. Verify: `grep -n -- "--trim" README.md` prints the row.

## 6. Tests

- [x] 6.1 `packages/shared/test/caseTrim.test.ts`: "keeps the short side", "drops the side before on a tie", "trims with current at either edge", "leaves a fitting catalog alone and refuses one that cannot fit" (L(n) and its encoder from the spec; count the encoder's calls).
- [x] 6.2 Server: `case.http.test.ts` › "keeps a loopback back link in identity none"; `docs.test.ts` › "documents the handoff" (new words, no `alternately`).
- [x] 6.3 Web: `sessionBar.test.ts` › "shows open warnings with the case notice"; `filedrop.test.ts` › "carries the open report across the page load"; `workspaces.test.ts` › "shows a dropped catalog's report after the page load".
- [x] 6.4 CLI: `cli.test.ts` › "trims a catalog link"; `args.test.ts` › "maps the case forms" (the `--trim` lists); the `--help` test names `--trim`.

- [x] 6.5 Web: `sessionBar.test.ts` › "shows the open report in the session bar".

## 7. Checks outside the suite

- [x] 7.1 UI user on smart451: "Dropped file on smart451" (one screenshot of the message line).
- [x] 7.2 UI user on smart451: "Note on smart451" (dropped file and link, tooltip, gone after `]`).
