# Tasks

Bug fixes from the review day 2026-10-28 (todo.md T-01 … T-08, T-10 … T-14, "Docs and cleanup"). Every fix is pinned in design.md "Decisions"; no task waits for another's output, so all build tasks and the tests run in parallel in one round. T-09 and the open questions are out of scope (proposal).

Write areas (disjoint per group; the pacer may give one engineer several groups):

- 1.x `packages/shared/src/search.ts`
- 2.x `apps/server/src/routes/workspace.ts`, `apps/server/src/routes/case.ts`, `apps/server/src/http.ts`
- 3.x `apps/server/src/workspaces.ts`, `apps/server/src/routes/workspaces.ts`
- 4.x `apps/web/src/chart/zoom.ts`, `apps/web/src/App.tsx`
- 5.x `apps/web/src/chart/cache.ts`
- 6.x `apps/web/src/chart/cursors.ts`, `apps/web/src/chart/TimeseriesWindow.tsx`, `apps/web/src/keys.ts`
- 7.x `apps/web/src/bar/RangePicker.tsx`, `apps/web/src/styles.css`, `apps/web/src/bar/bar.ts`, `apps/web/src/time/axis.ts`
- 8.x `apps/cli/src/run.ts`, `apps/cli/src/args.ts`
- 9.x `docs/http-api.md`, `README.md`
- 10.x tests (tester): `packages/shared/test/`, `apps/server/test/`, `apps/web/test/`, `apps/cli/test/`
- 11.x UI checks (UI user), 12.x crash guard

Suggested engineers (four plus the tester): E1 = 1.x + 8.x + 9.x; E2 = 2.x + 3.x; E3 = 4.x + 7.x; E4 = 5.x + 6.x.

## 1. packages/shared

- [ ] 1.1 `search.ts`: `ranges` continues at `i + 1` (T-11); `foldCase` and ranges on the original strings, lower-case fields from `foldCase` (T-12; design "T-11, T-12").
- [ ] 1.2 Verify: `pnpm --filter @kipscope/shared test search`, `pnpm lint`.

## 2. apps/server: commands, preview, comment

- [ ] 2.1 `routes/workspace.ts`: `endpointRefusal` refuses `view.markSaved` at `POST /api/commands` with 400 `invalid_command` (T-02; design "T-02").
- [ ] 2.2 `routes/case.ts`: grant check on the preview's target entry before any load, 403 `forbidden_data` (T-03; design "T-03").
- [ ] 2.3 `http.ts`: the comment above `withRequestClass` names `/api/calendar` (design "Docs and cleanup").
- [ ] 2.4 Verify: `pnpm --filter @kipscope/server test views.http case.http calendar`, `pnpm lint`.

## 3. apps/server: workspace registry

- [ ] 3.1 `workspaces.ts`: `create(owner, {filling})`, `filled(id)`, `Held.filling`; `reuseOf` and the limit eviction skip a filling entry; `openCase` carries `filling` and `claimedAt` over (T-04; design "T-04").
- [ ] 3.2 `routes/workspaces.ts` `openCases`: create with `{filling: true}`, `filled(id)` in a `finally` around the rest.
- [ ] 3.3 Verify: `pnpm --filter @kipscope/server test workspaces`, `pnpm lint`.

## 4. apps/web: zoom history (T-01, priority)

- [ ] 4.1 `chart/zoom.ts`: export `workspaceHistoryKey` (design "T-01").
- [ ] 4.2 `App.tsx`: `navKeyOf` and the calls in `onZoomed`, `onBack`, `canGoBack` use `workspaceHistoryKey`; no `historyKey(` left in `App.tsx`.
- [ ] 4.3 Verify: `pnpm --filter @kipscope/web test zoom`, `grep -n "historyKey(" apps/web/src/App.tsx` (no line), `pnpm lint`. Needs UI check 11.1.

## 5. apps/web: series cache

- [ ] 5.1 `chart/cache.ts`: export `CacheScope` and `scopedTile`; `use()` returns the scoped tile, one cached copy per stored entry (T-05; design "T-05").
- [ ] 5.2 Verify: `pnpm --filter @kipscope/web test cache preload`, `pnpm lint`.

## 6. apps/web: cursors and keys

- [ ] 6.1 `chart/cursors.ts`: `CursorClick` (design "T-07").
- [ ] 6.2 `chart/TimeseriesWindow.tsx`: `pendingClick` / `placeClick` replaced by one `CursorClick`; `doubleClick` in the `dblclick` binding; `dispose` on unmount (T-07).
- [ ] 6.3 `keys.ts` `navKey`: `a`/`A` and `b`/`B` with Shift (T-08; design "T-08").
- [ ] 6.4 Verify: `pnpm --filter @kipscope/web test cursors keys`, `pnpm lint`. Needs UI check 11.3.

## 7. apps/web: range picker, sidebar icon, dead code

- [ ] 7.1 `bar/RangePicker.tsx`: Escape listener on `document` while mounted, root `onKeyDown` removed (T-06; design "T-06").
- [ ] 7.2 `styles.css`: `.option-bar-slot .sidebar-toggle` `color: var(--label)` (T-13).
- [ ] 7.3 `bar/bar.ts`: remove `SPAN_PRESETS` and `NS_PER_S`; `time/axis.ts`: remove `formatRange` (design "Docs and cleanup"). The test file `axis.test.ts` is the tester's (10.3).
- [ ] 7.4 Verify: `grep -rn "SPAN_PRESETS\|formatRange" apps/web/src` (no line), `pnpm --filter @kipscope/web test bar rangePicker keys`, `pnpm lint`. Needs UI checks 11.2 and 11.4.

## 8. apps/cli

- [ ] 8.1 `run.ts` `state`: workspace first, then render status (T-10; design "T-10").
- [ ] 8.2 `args.ts` `take`: `takes at least N argument(s)` for an open upper bound; `calc add` / `calc edit` refuse a `--name` empty after trimming with `NAME is empty` (T-14; design "T-14").
- [ ] 8.3 Verify: `pnpm --filter @kipscope/cli test`, `pnpm lint`.

## 9. docs

- [ ] 9.1 `docs/http-api.md` "Request class" names `GET /api/calendar` (design "Docs and cleanup").
- [ ] 9.2 `README.md` CLI table: rows `digits 3|4`, `events filter|add|remove`, `events list`; output-key sentence with `workspace` and `removedWindow` in output.ts order (design "Docs and cleanup").
- [ ] 9.3 Verify: `grep -n "api/calendar" docs/http-api.md`; `grep -n "digits 3\|events filter\|events add\|events remove\|events list\|removedWindow" README.md` shows each.

## 10. Tests (tester, test-first from the scenarios)

- [ ] 10.1 `packages/shared/test/search.test.ts` › "highlights overlapping occurrences of one term", › "keeps highlight ranges on the original text" (signal-catalog "Match highlighting").
- [ ] 10.2 `apps/server/test/views.http.test.ts` › "refuses markSaved through the command endpoint" (workspace-state); `apps/server/test/case.http.test.ts` › "refuses a preview outside the grant" (case-preload "Preview outside the grant"); `apps/server/test/calendar.test.ts` › "runs in the request's class" extended by a `preload` request (case-preload "Calendar in the preload class"); `apps/server/test/workspaces.test.ts` › "never reuses a workspace a catalog open is filling"; `apps/server/test/workspaces.http.test.ts` › "never hands a filling catalog workspace to a reuse" (workspaces).
- [ ] 10.3 `apps/web/test/zoom.test.ts` › "keys the history by the workspace's catalog session" (case-navigation "Key of a workspace"); `apps/web/test/cache.test.ts` › "drops edge points outside the asking scope" (series-cache); `apps/web/test/cursors.test.ts` › "drops a waiting click and its line when the window closes" (cursors); `apps/web/test/keys.test.ts` › "maps Shift+A and Shift+B with Caps Lock on" (cursors); `apps/web/test/designTokens.test.ts` › "sidebar button icon is slate-700" (design-language); remove the `formatRange` block and import from `apps/web/test/axis.test.ts`.
- [ ] 10.4 `apps/cli/test/cli.test.ts` › "asks one workspace for state" (stub server recording paths), › "exits 2 on bad arguments without sending anything" extended by `calc add "abs(SIG_A)" --name ""`; `apps/cli/test/args.test.ts` › "names an open-ended argument count", › "refuses an empty calc NAME" (cli).
- [ ] 10.5 Run `pnpm build`, `pnpm test`, `pnpm lint`.

## 11. UI checks (UI user, after 4–7, on smart451)

- [ ] 11.1 case-navigation "Back per session on smart451" (T-01).
- [ ] 11.2 range-picker "Esc after focus left the picker" (T-06); range-picker "Cancel, Esc and keys" still passes.
- [ ] 11.3 cursors "No ghost line on smart451" (T-07); cursors "Click and Shift+click" still passes.
- [ ] 11.4 design-language "Icon colour of the sidebar button" (T-13).

## 12. Crash guard

- [ ] 12.1 `pnpm build`, `pnpm smoke` against the running Vite and `pnpm smoke --preview` (the round touches `apps/web` and `packages/shared`).
