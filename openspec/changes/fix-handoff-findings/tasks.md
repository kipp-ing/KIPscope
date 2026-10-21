# Tasks

Every interface two tasks share is pinned in design X1 (`trimCases`), X4 (`caseReport.ts`, `caseOpenEvents`), X5 (`eventsTableState`) and X6 (`SourceEvents`, `ServerMeta.source.events`), so all build tasks can run in parallel; an engineer stubs a pinned import until its task lands. The tester writes group 6 test-first from the specs.

Write areas (disjoint):

- 1.1: `packages/shared/src/caseTrim.ts` (new), `meta.ts`, `index.ts`
- 2.1: `apps/server/src/case.ts`
- 2.2: `apps/server/src/events.ts`, `routes/events.ts`, `routes/case.ts`, `meta.ts`
- 3.1: `apps/web/src/workspaces/caseReport.ts` (new), `workspaces/startup.ts`, `filedrop.ts`, `case/sessionBar.ts`, `App.tsx`
- 4.1: `apps/cli/src/args.ts`, `apps/cli/src/case.ts`
- 5.1: `docs/handoff.md`
- 5.2: `docs/http-api.md`, `README.md`
- 6.x: tests as listed per task

## 1. packages/shared

- [ ] 1.1 `caseTrim.ts` with `TrimmableCases`, `TrimResult`, `trimCases` (X1: drop order, bisection, `===` when it fits, `link_too_long` with `chars`, RangeError on a bad `current`); `meta.ts` with `SourceEvents` and the optional `ServerMeta.source.events` (X6); both exported from `index.ts`. Verify: `pnpm --filter @kipscope/shared build`; scenarios "Short side kept", "Tie and middle", "Current at an edge", "Fits or cannot fit".

## 2. apps/server/src

- [ ] 2.1 Loopback back link in identity `none` (X3): `listedOrigin` takes the identity and accepts an `http(s)` URL whose `hostname` `isLoopbackHost` accepts, in `none` only. Verify: scenarios "Foreign back link", "Loopback back link".
- [ ] 2.2 Missing events table remembered (X5) and reported (X6): `eventsTableState` with its per-source memory in `events.ts`, `loadTable` skips the source once `none` and warns once per run; the case route's `eventsOf` cache warns through the app's logger; `meta.ts` sends `source.events`. Verify: scenarios "No events table", "Missing table remembered", "Meta follows the first answer", "Reachable source".

## 3. apps/web/src

- [ ] 3.1 Open report on every path (X4): `workspaces/caseReport.ts` (`CASE_REPORT_KEY`, `stashCaseReport`, `takeCaseReport`, never throwing); `openDroppedCatalog` stashes the answer's report before `go`; the start-up takes it for the settled workspace; `caseOpenEvents` in `case/sessionBar.ts`; `App.tsx` shows the open with `showResult(caseOpenEvents(…))` and no separate `setNotice`. Verify: scenarios "One notice for case texts and warnings", "Report carried across the page load", "Link in the browser" (unchanged), "Dropped file" (unchanged).

## 4. apps/cli/src

- [ ] 4.1 `case url --trim` (X2): `--trim` flag only on `case url`, `trim: true` in the invocation, the help line `case url FILE|- [--trim]`; the trim path (JWS refused, unsigned code decoded, document checked, `trimCases` with the link encoder, `local.dropped` and `local.position`, `link_too_long` with `chars`). Verify: scenarios "Link of a catalog", "Trimmed link", "Trim flag parsed", "Help lists the forms".

## 5. Docs

- [ ] 5.1 `docs/handoff.md` per X7: the balanced trim rule (replaces "alternately"), with the 3,540/213 example, `trimCases` and `kipscope case url --trim`; UTF-16 lengths and UTF-8 inflated bytes; `invalid_catalog` refuses the catalog as a whole; `view` charts at `[from − pad, to + pad)`; the named tab's opener rule (`Cross-Origin-Opener-Policy`, `noopener`, a new tab each time otherwise); the loopback back link in `none` in the `origin` and `KIPSCOPE_FINDER_ORIGINS` rows. Verify: scenario "Guide names every key and claim".
- [ ] 5.2 `docs/http-api.md` meta row names the events table (X6); `README.md` `case url` row names `--trim`. Verify: scenario "Documented"; `grep -n -- "--trim" README.md` prints the row.

## 6. Tests

- [ ] 6.1 `packages/shared/test/caseTrim.test.ts`: "keeps the short side", "drops the side before on a tie", "trims with current at either edge", "leaves a fitting catalog alone and refuses one that cannot fit" (L(n) and its encoder from the spec; count the encoder's calls).
- [ ] 6.2 Server: `case.http.test.ts` › "keeps a loopback back link in identity none"; `events.test.ts` › "remembers a missing events table for the run"; `meta.http.test.ts` › "reports whether the source has an events table" and the `events` field in "reports build, source and catalog"; `docs.test.ts` › "documents the handoff" (new words, no `alternately`) and "documents every HTTP route" (meta row names `events`).
- [ ] 6.3 Web: `sessionBar.test.ts` › "shows open warnings with the case notice"; `filedrop.test.ts` › "carries the open report across the page load"; `workspaces.test.ts` › "shows a dropped catalog's report after the page load"; `eventsPanel.test.ts` › "offers no Align without events".
- [ ] 6.4 CLI: `cli.test.ts` › "trims a catalog link"; `args.test.ts` › "maps the case forms" (the `--trim` lists); the `--help` test names `--trim`.

## 7. Checks outside the suite

- [ ] 7.1 UI user on smart451: "Dropped file on smart451" (one screenshot of the message line).
- [ ] 7.2 Lead: `curl -s localhost:7310/api/meta | jq -c .source.events` prints `"table"` (app-footer "Real server").
