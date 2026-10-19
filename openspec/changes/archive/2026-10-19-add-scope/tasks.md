# Tasks

Written for Q-1 (a), Q-2 (a) and Q-3 (a) (design "Questions for Jan"); the lead confirms with Jan before round 1. Every interface two areas share is pinned in design Z1 (source contract), Z5 (shared DTOs), Z10 (server flow and routes) and Z11 (variables), so all tasks below can run in one round in parallel. An engineer stubs a type from another task until it lands. The tester writes group 7 test-first from the specs and design Z4. A second round is only for findings. Builds on `improve-query-priority` (done): background work keeps its `background` class (design Context, Z9).

Write areas (disjoint):

- 1.1: `packages/shared/src/scope.ts` (new), `workspace.ts`, `series.ts`, `signals.ts`, `meta.ts`, `index.ts`
- 1.2: `packages/shared/src/apply.ts`, `views.ts`
- 2.1: `apps/server/src/datasource.ts`, `fallbacks.ts`
- 2.2: `apps/server/src/clickhouse.ts`
- 2.3: `apps/server/src/adx.ts`
- 3.1: `apps/server/src/scope.ts` (new), `catalog.ts`, `config.ts`, `meta.ts`, `main.ts`, `.env.example`
- 3.2: `apps/server/src/density.ts`, `gaps.ts`, `events.ts`, `series.ts`, `routes/series.ts`, `routes/events.ts`, `routes/signals.ts`
- 3.3: `apps/server/src/workspace.ts`, `views.ts`, `routes/workspace.ts`, `routes/views.ts`, `http.ts`
- 4.1: `apps/web/src/explorer/*`, `apps/web/src/api.ts`
- 4.2: `apps/web/src/time/*`
- 4.3: `apps/web/src/App.tsx`, `apps/web/src/footer/*`, `apps/web/src/chart/*` (error line only)
- 5.1: `apps/cli/src/*`
- 6.1: `docs/data-sources.md`, `docs/http-api.md`, `README.md`
- 7.x: tests as listed per task

## 1. packages/shared

- [x] 1.1 Scope types and helpers (Z5, Z6, Z7): `WorkspaceScope`, `Workspace.scope`, the `scope.set` and `scope.clear` commands with their checks (data ref without `/`, `from < to`, span ≥ `MIN_SPAN_NS`), `view.open.scope`, error codes `scope_required` and `out_of_scope`, `CommandResult.clamped`, `ApplyContext.scopeRequired`; new `scope.ts` with `scopeKey`, `clampToScope`, `widenScope`; `Density.scope`, `CatalogSnapshot.scope`, `ServerMeta.catalog.mode` and `.scope`, `CatalogState` `no_scope`. Verify: `pnpm --filter @kipscope/shared build`; scenarios "Clamp rule", "Widen steps".
- [x] 1.2 Behaviour (Z6, Z8): `applyCommand` handles `scope.set` (clamp windows, drop cursors outside), `scope.clear` (refused when `scopeRequired`), clamps `window.setRange` and `window.create` with `clamped`, refuses cursors outside with `out_of_scope`, refuses `window.addSignal`, `events.addSignal` and an unscoped `view.open` when `scopeRequired` and no scope; `view.open` sets `command.scope`, clamps windows and drops cursors with the two warnings, skips signals of another data ref as `out_of_scope`, and drops other-ref events-line signals with a warning. `views.ts`: `ViewDoc.scope` (read, validated, written after `data`), `viewScope`, `workspaceToView` and `linkViewDoc` carry the scope; `OpenReport` reason `out_of_scope`. Verify: scenarios "Set, clear, bad input", "Commands inside the scope", "No scope, no change", "Commands without a scope", "Round trip with a scope", "Derived scope", "Explicit scope smaller than the windows", "Open replaces the scope".

## 2. apps/server/src: contract and adapters

- [x] 2.1 Contract and fallbacks (Z1, Z2): `Scope`; `scope?` before `abort` on the 11 methods of the Z1 table; every fallback passes the scope and uses `scope.from … scope.to`. Callers in other files keep compiling by passing `undefined` until 3.2 lands. Verify: `pnpm --filter @kipscope/server build`; scenario "Core calls carry the scope"; conformance `core only` runs of the scoped cases.
- [x] 2.2 ClickHouse scope filters (Z3): every method with a scope adds the data-ref and both time filters as query parameters; `listSignals(scope)` is one grouped query with the text flag; unscoped query texts unchanged. Verify: scenarios "ClickHouse query texts", "Density query unchanged" (existing), conformance `clickhouse native`.
- [x] 2.3 ADX scope filters (Z3): one helper for the scoped table expression (signals and events table) with `sref`, `sfrom`, `sto` parameters, used by every method with a scope; no new native method. Verify: scenario "ADX query texts"; `pnpm --filter @kipscope/server test:adx`: conformance `adx native` and `adx core only` incl. the scoped cases.

## 3. apps/server/src: server

- [x] 3.1 Catalog store, modes, guard (Z10, Z11): `Catalog` takes an optional scope for `listSignals`; `CatalogStore` (full catalog in full mode, 4 scope catalogs LRU, single-flight `load(scope)`, `get`); `scopeOf(request)`; `guardScoped` in scoped mode; `KIPSCOPE_CATALOG` and `KIPSCOPE_SCOPE_PAD` in `config.ts` and `.env.example`; `main.ts` wires the store and starts no full catalog, prefetch or poll in scoped mode, and keeps a restored scope's list loaded; meta reports `mode`, `scope`, `no_scope`. Verify: scenarios "Configuration", "Pad values", "Scoped start without a scope", "Guard", "Meta with a scope", "Restored scope in scoped mode", "Signals of a scope" (catalog).
- [x] 3.2 Bounded routes and caches (Z9, Z10 routes table): `/api/catalog`, `/api/signals`, `/api/catalog/refresh`, `/api/extent`, `/api/series`, `/api/value`, `/api/density`, `/api/gaps`, `/api/events` resolve `scopeOf`, answer `scope_required` and `out_of_scope` (409), and pass the scope to every source call; density from one scoped `refBuckets` with `first`/`last`/`scope` of Z9; gap info, poll and events per scope; caches keyed by `scopeKey`; a scope's prefetch after its list loads, in the `background` class. Verify: scenarios "Bounded routes on the test DB", "Full mode with a scope", "One hour of testcar", "One query per scope", "A scope that cuts a logger gap", "Scoped queries and poll", "testcar events in a scope", "Scoped source calls".
- [x] 3.3 Scope-changing commands (Z10): `POST /api/commands` for `scope.set` and `view.open`, `POST /api/views/open` and import with `open` resolve the target scope (`command.scope`, else `viewScope(doc, pad)`), await `catalogs.load`, answer 503 `catalog_unavailable` on failure with the workspace unchanged, and execute with that scope's context; other commands use the current scope's context and `scopeRequired` in scoped mode; `commandStatus` maps the new codes to 422. Verify: scenarios "Scope over HTTP and after a restart", "Set then add", "Load fails", "Catalog not loaded", "Scope list loads first", "Two data refs in one view", "Open through the command endpoint".

## 4. apps/web/src

- [x] 4.1 Explorer per scope (Z12): reload `/api/catalog` on a `scopeKey` change, drop answers of another scope, and show the "No scope set" text without retrying on `scope_required`. Verify: scenarios "Reload on scope change", "No scope in the UI".
- [x] 4.2 Strip with a scope (Z12): the scope's data ref, the `SCOPE` head with **Widen** (one `scope.set` with `widenScope`, disabled while pending) and **Clear** (full mode only), the `in scope` label, the `No scope set` state; one line, ≤ 56 px. Verify: scenarios "Label with a scope", "Data ref of the strip", "Scope on smart451"; `pnpm smoke` passes.
- [ ] 4.3 App wiring (Z12): pass scope, mode and the command sender to the strip; the clamp message on `clamped`; `out_of_scope` in the window's error line; footer `No scope`. Verify: scenarios "Message on a clamped result", "Zoom out and pan on smart451", "Link opens with a scope on real data"; `pnpm smoke` passes.

## 5. apps/cli/src

- [x] 5.1 `scope set|show|widen|clear` (Z13) with usage and help text. Verify: scenarios "Forms map to commands", "Set, show, widen, clear over HTTP", "Help lists the forms".

## 6. Docs

- [x] 6.1 `docs/data-sources.md` section "Scope" and the two variables (Z14); `docs/http-api.md` shared rule "Scope" with the 409 and 422 codes; README CLI list. Verify: scenario "Guide names every scoped method"; "documents every source variable".

## 7. Tests (tester, test-first)

- [x] 7.1 Conformance (Z4): the five scoped cases in `apps/server/test/conformance/suite.ts`, run native and core only by both runners; expected values from the fixture definition. Verify: `pnpm --filter @kipscope/server test` and `test:adx`.
- [x] 7.2 Server scope tests: `apps/server/test/scope.http.test.ts` (recording adapter, full and core-only; every scenario naming it), `scope.test.ts` › "refuses unbounded calls before the adapter", `config.test.ts`, `meta.http.test.ts`, `persist.test.ts` (scope in the restored workspace), `docs.test.ts` › "documents the scope argument". Verify: `pnpm --filter @kipscope/server test`.
- [x] 7.3 Server feature tests: `fallbacks.test.ts` › "passes the scope to every core call"; `clickhouse.scope.test.ts`; `adx.test.ts` › "scopes every query by data ref and time"; `catalog.test.ts`, `density.test.ts`, `density.http.test.ts`, `gaps.test.ts`, `gaps.http.test.ts`, `events.test.ts`, `events.http.test.ts`, `views.http.test.ts` per the scenarios naming them; every stub source (`viewsApp.ts`, `apps/cli/test/helpers.ts`, test stubs) moved to the new parameter order, with existing expected values unchanged. Verify: `pnpm --filter @kipscope/server test && pnpm --filter @kipscope/cli test`.
- [x] 7.4 Shared tests: `packages/shared/test/scope.test.ts` (new), `apply.test.ts`, `views.test.ts` per the scenarios naming them. Verify: `pnpm --filter @kipscope/shared test`.
- [x] 7.5 Web tests: `explorer.test.ts`, `strip.test.ts`, `zoom.test.ts` per the scenarios naming them. Verify: `pnpm --filter @kipscope/web test`.
- [x] 7.6 CLI tests: `args.test.ts` › "maps the scope forms", `cli.test.ts` › "sets, shows, widens and clears the scope" and the help list. Verify: `pnpm --filter @kipscope/cli test`.

## 8. Follow-up after rounds 1-3 (lead's call, 2026-10-19)

- [x] 8.1 (should) `apps/web/src/chart/loader.ts` `rescope()` reloads every key whose state matches its request, complete keys included, through `beginRetry` (new sequence number, late old answer dropped). Verify: `rescope.test.ts` › "loads a complete key's request again, the late old answer does not overwrite".
- [x] 8.2 (should) Web regression tests `apps/web/test/rescope.test.ts` for `enterScope`, `scopeChangeWatcher` (seam of `useScopeChange` and `useMeta`), the cache generation guard, gap store reload and `again` drop, `SeriesLoader.rescope`, `ValueLoader.rescope`, `useMeta` refetch on a scope change. Verify: `pnpm --filter @kipscope/web test` (20 new tests). The hooks themselves run in no test (no hook renderer); the wiring is reviewed by reading.
- [x] 8.3 (could) `apps/web/src/chart/cache.ts` `clear()` aborts queued prefetch runs. Verify: `rescope.test.ts` › "never fetches the queued prefetch runs after a clear".
- [x] 8.4 (spec owner, lead calls) Scenarios "Footer count follows the scope" (signal-catalog) and "Windows recover after Widen, Clear or open" (time-navigation) so the tests and the UI check of this round trace to the spec; UI check of both held on smart451 (415, 551, 553, 415).

## Workflow follow-up

- Lead: Jan's answers to Q-1 … Q-3 before round 1; manual checks of design "Manual checks (lead)" and scope "carserver in scoped mode"; `pnpm build && pnpm test && pnpm lint`, `test:adx`, `pnpm smoke`.
- Tell the Azure users on issue #1 that the contract (design Z1, `docs/data-sources.md` "Scope") is settled.
- On archive: the ledger entry of design "Ledger entry on archive" with Jan's answers; `docs/status.md` "Next" item 1.2.
