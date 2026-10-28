# Tasks

The write areas below are disjoint files, so engineers can work in parallel against design.md "Shared interfaces". Each task names its scenario evidence. The tester writes those tests from the specs in parallel (group 9); an engineer's task is done when its named tests pass.

## 1. packages/shared (P)

- [ ] 1.1 Add the `too_wide` fields to `ApiError`, the `too_wide` code with the same fields to `CommandResult`, and `tooWideText` in `scope.ts`. Move `formatSpan` into `time.ts` with an unchanged rule (`apps/web` switches its import in 6.2). Verify: `packages/shared/test/scope.test.ts` › "words a too-wide answer".
- [ ] 1.2 Add `windowsScope` (`scope.ts`); `WORK_MIN_NS`, the new `workWindow(view, scope, maxSpanNs)` and `objectSpan` (`case.ts`, design B3, B4). Verify: `packages/shared/test/case.test.ts` › "computes the work window"; `packages/shared/test/apply.test.ts` › "unlinks to the span of the catalog's sessions"; `packages/shared/test/scope.test.ts` › "derives a scope from the windows".
- [ ] 1.3 Add `ServerMeta.limits` (`meta.ts`), and `CalendarDensity.pending` with `CALENDAR_PENDING_REFETCH_MS` (`calendar.ts`). Verify: `pnpm --filter @kipscope/shared build` and `pnpm lint`.

## 2. apps/server: config, bound, wiring (S1: `config.ts`, `scanBound.ts`, `http.ts`, `meta.ts`, `main.ts`, `app.ts`, `fallbacks.ts`)

- [ ] 2.1 `catalogMode` defaults to `scoped`; read `KIPSCOPE_SCAN_ROWS` and `KIPSCOPE_SCAN_SPAN` (design B1). Verify: `apps/server/test/config.test.ts` › "reads the catalog mode and the scope pad", "reads the scan bound".
- [ ] 2.2 Add `scanBound.ts` (`createScanBound`, `TooWideError`, design B2). In `http.ts` add `tooWide` and the `routeScope` option `ownWindow`. Put `limits` in `/api/meta`. In `main.ts`, construct `bound` and `CalendarDays` (from 4.2's module, `<stateDir>/calendar`) into `AppDeps` and pass `bound` to `CatalogStore`. Verify: `apps/server/test/scanBound.test.ts` › "refuses wide spans without a query and counts each range once"; `apps/server/test/meta.http.test.ts` › "reports the scan limits".
- [ ] 2.3 `completeSource(adapter, {scanRows})`: the `series` fallback throws `TooWideError` above `scanRows`, before `raw` or `buckets` (design B9). `main.ts` passes the bound's rows. Verify: `apps/server/test/scanBound.http.test.ts` › "refuses a series over the row budget".

## 3. apps/server: density, gaps, series routes (S2: `density.ts`, `gaps.ts`, `routes/series.ts`)

- [ ] 3.1 Density:
  - checks the bound before `refExtent` or `refBuckets`
  - no coarse density: 400 without `from`/`to` in an object scope
  - the full-mode prefetch only for data refs within the bound
  - the density route uses `ownWindow` in scoped mode without a scope when `from` and `to` are given
  - `TooWideError` → `tooWide`

  Verify:
  - `apps/server/test/density.test.ts` › "computes once per catalog load, shares and does not cache failures", "computes a scope's density from one bucket query"
  - `apps/server/test/density.http.test.ts` › "computes after the catalog load without a request, and a request does not recompute", "sends the counts-only bucket query"
  - `apps/server/test/scope.http.test.ts` › "answers a bounded density without a scope in scoped mode"
  - `apps/server/test/objectScope.http.test.ts` › "answers a detail density for a work window"
- [ ] 3.2 Gap info:
  - takes its count from `bound.count` and checks the bound before `loggerGaps`
  - the full-mode prefetch and poll only within the bound
  - the gaps, value and computed routes map `TooWideError` to 422
  - work windows through `workWindowOf(…, deps.bound.spanNs)`

  Verify:
  - `apps/server/test/gaps.test.ts` › "takes the value's gap info from the scope", "polls only data refs within the bound" and every existing gaps test
  - `apps/server/test/scanBound.http.test.ts` › "answers too_wide on the routes", "answers too_wide for a value without bounded gap info"
- [ ] 3.3 Build `CalendarCache` with `deps.calendarDays`, and start `fillAhead(deps.calendarDays, workspaces)`; stop it on close. Verify: `apps/server/test/calendar.http.test.ts` (all) and `apps/server/test/calendarDays.test.ts` › "fills the shown months ahead for open workspaces".

## 4. apps/server: idle class and calendar days (S3: `priority.ts`, `queue.ts`, `calendarDays.ts`, `calendar.ts`)

- [ ] 4.1 Query class `idle`, last in `QUERY_CLASSES`. The queue starts an idle task only while no interactive task runs or waits and no other idle task runs (design B6). Verify: `apps/server/test/queue.test.ts` › "runs idle tasks one at a time and never beside an interactive one" and every existing queue test; `apps/server/test/priority.test.ts` › "tags prefetches and polls as background and requests as interactive".
- [ ] 4.2 `CalendarDays`:
  - the day count (`refCount`, then `refBuckets` at 60 s, or 6 h parts above the bound)
  - the file, its source check, and the final rule (1 h)
  - the 5-min recheck of non-final days in use
  - `window()` with `pending`, and `fillAhead`

  All work runs in `idle` (design B6). Verify: `apps/server/test/calendarDays.test.ts` › "keeps final days across a restart and rechecks today", "ignores a day file of another source", "fills the shown months ahead for open workspaces".
- [ ] 4.3 `CalendarCache`: a plain scope takes today's path behind the bound; an object scope or full mode without a scope answers from `CalendarDays` with `pending` and never raises its class. Verify: `apps/server/test/calendar.test.ts` › "computes once per window and catalog load, shares, drops failures and the least recent", "runs in the request's class, days at idle", "answers counted days at once and counts the rest at idle"; `apps/server/test/objectScope.http.test.ts` › "answers the calendar of a month while unlinked".

## 5. apps/server: scopes, Unlink, events (S4: `scope.ts`, `objectScope.ts`, `routes/workspace.ts`, `routes/case.ts`, `routes/signals.ts`, `routes/events.ts`, `events.ts`)

- [ ] 5.1 `CatalogStore`:
  - each list load goes through `bound.check`; a refusal becomes 422 `too_wide` for `scope.set`, `view.open`, case steps and Link, with the workspace unchanged, and 422 on `/api/catalog` and `/api/signals`
  - in an object scope, the session's list with `partial: true` and no `listSignals` over the object scope

  Verify: `apps/server/test/scanBound.http.test.ts` › "refuses a scope wider than the bound"; `apps/server/test/objectScope.http.test.ts` › "keeps the session's signal list while unlinked".
- [ ] 5.2 Unlink via `objectSpan`, with `ObjectExtents` removed. `workWindowOf(query, scope, maxSpanNs)` gives 422 `too_wide` over the span. Verify: `apps/server/test/objectScope.http.test.ts` › "unlinks to the span of the catalog's sessions without a query", "needs a bounded work window for gaps and events in an object scope", "sends no query over the whole vehicle while unlinked".
- [ ] 5.3 Events: the full-mode prefetch only within the bound; `/api/events` for a data ref over it answers 422. Verify: `apps/server/test/scanBound.http.test.ts` › "skips the events of a data ref over the bound"; `apps/server/test/events.test.ts` (all).

## 6. apps/web

- [ ] 6.1 W1 (`help/ScopeCard.tsx` new, `help/help.css`, `App.tsx`, `api.ts`): the Scope card and its placement (design B8), and the meta limits in `api.ts`. Verify: `apps/web/test/scopeCard.test.ts` › "prefills the scope from the windows and shows a refusal".
- [ ] 6.2 W2 (`time/TimeStrip.tsx`, `time/strip.ts`, `time/strip.css`, `time/scope.ts`):
  - the strip's too-wide state with no retry
  - in an object scope, no coarse request: the work window's detail with the shown-range fallback, marks everywhere, the presence line only in the work window, and the label `in catalog`
  - `formatSpan` imported from shared

  Verify:
  - `apps/web/test/strip.test.ts` › "shows a too-wide strip without retrying", "asks the detail density for the work window", "draws catalog marks of the vehicle", "labels an object scope"
  - `apps/web/test/stripGeometry.test.ts` (all)
- [ ] 6.3 W3 (`bar/RangePicker.tsx`, `time/calendar.ts`, `bar/*.css`): days not counted yet (dotted baseline, tooltip), and a refetch every 3 s while `pending` and open. Verify: `apps/web/test/rangePicker.test.ts` › "marks days not counted yet", "fetches again while days are pending" and all existing picker tests.
- [ ] 6.4 W4a (`chart/gaps.ts`, `events/*`): a gap `too_wide` settles as an error and refetches after 5 min; work windows with `meta.limits.scanSpan` and one fallback to the shown range, for gaps and events. Verify: `apps/web/test/gaps.test.ts` › "settles with a too-wide error", "falls back to the shown range after a too-wide work window"; `apps/web/test/eventsPanel.test.ts` › "asks events for the work window in an object scope".
- [ ] 6.5 W4b (`chart/TimeseriesWindow.tsx`, `chart/loader.ts`, `values/*`): `No scope set` in the plot without requests or errors; `too wide` in the legend status column with the message as `title`; a value cell `—` with the message. Verify: `apps/web/test/scopeCard.test.ts` › "keeps windows quiet without a scope"; `apps/web/test/loader.test.ts` › "shows a too-wide series in the status column"; `apps/web/test/legend.test.ts` (all).

## 7. apps/cli (`apps/cli/src/case.ts`, `args.ts`)

- [ ] 7.1 `case drives REF FROM TO` (design B10): per UTC day, 6 h parts on `too_wide`, merged at edges, at most 32 days; the usage text. Verify: `apps/cli/test/cli.test.ts` › "builds a catalog from drives", "builds drives day by day and merges at edges", "prints the usage with --help"; `apps/cli/test/args.test.ts` (all).
- [ ] 7.2 A `too_wide` error exits 1 with `error.code` and the message on stderr. Verify: `apps/cli/test/cli.test.ts` › "reports a too-wide scope".

## 8. scripts (`scripts/smoke.mjs`)

- [ ] 8.1 The smoke creates its own scoped workspace by `POST /api/workspaces {open: {view}}`, with `--scope` and `--signal` and their defaults (design B11). It opens `/w/<id>` and deletes the workspace on every exit path. Verify: `node scripts/smoke.mjs --help` lists both options, and one `pnpm smoke` against the dev server prints the created and deleted workspace ID.

## 9. Tests (tester: `*/test/`, fixtures, `apps/server/scripts/seed-test-db.ts`)

- [ ] 9.1 Shared tests of 1.1–1.2 from the scope and object-view scenarios. Verify: `pnpm --filter @kipscope/shared test`.
- [ ] 9.2 Server tests, part A: `scanBound.test.ts`, `scanBound.http.test.ts` (the eight cases named above), the `config.test.ts` cases, and the updated call counts in `density.test.ts`, `density.http.test.ts` and `gaps.test.ts`. Verify: `pnpm --filter @kipscope/server test`.
- [ ] 9.3 Server tests, part B: `calendarDays.test.ts` (fake clock, temp state directory), the idle cases in `queue.test.ts` and `priority.test.ts`, `calendar.test.ts` and `calendar.http.test.ts`, the object-scope cases in `objectScope.http.test.ts`, `scope.http.test.ts` "answers a bounded density without a scope in scoped mode". Verify: `pnpm --filter @kipscope/server test`.
- [ ] 9.4 Migrate the test helpers: every server test that builds its config through `loadConfig` and relies on full mode sets `KIPSCOPE_CATALOG=full`; `scopeApp.ts` keeps `mode: "full"`. Verify: `pnpm test` with unchanged expected values outside this change's deltas.
- [ ] 9.5 Web tests of 6.1–6.5 and CLI tests of 7.1–7.2. Verify: `pnpm --filter @kipscope/web test`, `pnpm --filter @kipscope/cli test`, then `pnpm build && pnpm test && pnpm lint` green.

## 10. Docs

- [ ] 10.1 `docs/data-sources.md` and `docs/http-api.md`:
  - catalog modes with `scoped` as the default and full mode for small sources only
  - the scan bound and both variables, `too_wide` and its fields, `/api/meta` `limits`
  - the object scope without the coarse density, and the calendar's vehicle-days and `idle` class
  - the density route without a scope

  Verify: `apps/server/test/docs.test.ts` passes, and every variable of `config.ts` appears in the variables table.
- [ ] 10.2 README "Run": start scoped, set a scope with the Scope card, `kipscope scope set` or `kipscope case drives smart451 FROM TO > drives.json` then `kipscope case open drives.json`, and the bound variables. Add the default and both variables to `.env.example`. Verify: the README commands run as written against the test server (the tester runs them once).

## 11. Lead

- [ ] 11.1 Measure on carserver (scoped dev server, Jan's `.env`) and record the results in `rounds.md`:
  - cold and warm opens of a 1 h scope (2026-10-27 10:00–11:00Z) and of a 1 d scope (2026-10-27): `/api/w/<id>/gaps`, `/density`, `/value`, the catalog, and the `scope set` time
  - Unlink from a `case drives` catalog: time to answer, and the source calls in the log
  - the refusals of scope "One day of smart451" (7 d and 17 d)
  - the calendar per range-picker "Calendar cost": per-day time, and the fill time of two months
  - `X-ClickHouse-Summary` of one scoped logger-gap query and of one day count

  Any time over twice its goal goes to Jan.
- [ ] 11.2 Crash guard: `pnpm build`, then `pnpm smoke` and `pnpm smoke --preview`, twice in a row against the scoped dev server; all four pass (scope "Smoke twice on carserver").
- [ ] 11.3 Run the UI user on the UI-check scenarios: scope "Card on carserver"; object-view "Unlinked on smart451"; time-strip "Strip states" (too wide); range-picker "Calendar on smart451". Record one screenshot per step.
- [ ] 11.4 Put Questions for Jan Q-1 … Q-7 (design.md) to Jan. Update `docs/todo.md` (T-15 fixed, real-data scenarios outside this change → Q-08) and `docs/status.md`.

## Out of scope

- Chunked or cached whole-recording scans of any kind (D-117).
- Removing full mode, or migrating the server tests away from it (Q-1).
- A per-vehicle session index on the server; sessions come from the search tool or `case drives`.
- A signal list over the work window while unlinked (Q-4); a manual recount of a calendar day (Q-6); the vehicle's other days in a plain scope's calendar (Q-7).
- Bounds on `/api/extent` of one signal, `stateChanges` and computed series beyond their scope; a count check of ADX's native `series`.
- Rewriting the real-data scenarios of specs outside this change's deltas (todo Q-08).
- `measure:object` (object-view "Measured on a large history") dropping its extent and coarse lines; it may keep measuring them.
