# Tasks

Written for Q-1 (a) and Q-2 (a) (design "Questions for Jan"); the lead confirms with Jan before round 1. All interfaces are pinned in design "Interfaces", so every task below can run in one round in parallel; an engineer stubs a type from another task until it lands. The tester writes group 5 test-first from the specs and the design. A second round only for findings.

Write areas (disjoint):

- 1.1: `packages/shared/src/gaps.ts`
- 2.1: `apps/server/src/priority.ts` (new), `apps/server/src/queue.ts`
- 2.2: `apps/server/src/gaps.ts`, `apps/server/src/routes/series.ts`
- 2.3: `apps/server/src/density.ts`, `apps/server/src/events.ts`, `apps/server/src/routes/events.ts`
- 3.1: `apps/web/src/api.ts`, `apps/web/src/chart/gaps.ts`, `apps/web/src/chart/TimeseriesWindow.tsx`
- 4.1: `docs/http-api.md`, `docs/data-sources.md`
- 5.1: `apps/server/test/queue.test.ts`
- 5.2: `apps/server/test/priority.test.ts` (new)
- 5.3: `apps/server/test/gaps.test.ts`, `apps/server/test/gaps.http.test.ts`
- 5.4: `apps/web/test/gaps.test.ts`

1.1 is a few lines; the pacer may give it to the engineer of 2.2.

## 1. packages/shared

- [x] 1.1 `MAX_GAP_SIGNALS = 100` exported from `gaps.ts` (and the package index if it re-exports by name); `GapInfo.periods` doc comment as pinned in design "Interfaces". Verify: `pnpm --filter @kipscope/shared build`.

## 2. apps/server/src

- [x] 2.1 Query classes and the queue (design P1–P5): `priority.ts` with `QueryClass`, `QUERY_CLASSES`, `Priority` (`cls`, `raise`, `onRaise`), `withPriority`, `currentPriority` on `AsyncLocalStorage`; `QueryQueue` picks the best (rank, arrival) waiting query, keeps `kept` slots for `interactive`, re-picks on `raise`, starts each task in the async context captured at `run`, keeps abort handling, and reports `stats.byClass`. `queuedAdapter` unchanged in shape. Verify: series-query scenarios "Start order by class", "Aborted while waiting in a class", "Interactive query during a background fan-out", "Limit of one", "Raised while waiting"; existing `queue.test.ts` cases still pass.
- [x] 2.2 Gap info per signal and background prefetch (design P6, P7, P9): `GapCache` with the logger part per data ref, measured periods per signal batched per data ref and request, `wanted()`, `get(dataRef, signalIds)`, `prefetch` measuring the workspace signals only, `refresh` re-measuring the names measured so far; a `Priority` handle per logger part and per period batch, raised on join (P4); `workspaceSignals(workspace)`. In `routes/series.ts`: `GapCache` gets `() => workspaceSignals(workspace.workspace)`; `/api/gaps` parses repeated `signal` (≤ `MAX_GAP_SIGNALS`, else 400 `invalid_request`) and passes the signals; `/api/value` calls `gaps.get(info.dataRef, [query.signal])`; the density/gap prefetch chain and every poll run under `withPriority("background", …)`. Verify: data-gaps scenarios "Test data periods", "Once, shared, retried after failure", "Errors", "Named signals only", "Large catalog, small workspace", "Series right after a large catalog loads", "New rows refresh the gap info" (unchanged); series-query "Prefetch and polls run as background".
- [x] 2.3 Raised shared work in density and events (design P4, P9): `DensityCache` and `EventsCache` (table and signal entries) create a `Priority` handle per entry with the starting caller's class, compute under it, and raise it on join; `routes/events.ts` runs its prefetch under `withPriority("background", …)`. Verify: series-query scenarios "Request joins the density prefetch", "Prefetch and polls run as background" (events part); `density.test.ts`, `events.test.ts`, `events.http.test.ts` unchanged and green.

## 3. apps/web/src

- [x] 3.1 Gap info per signal (design P8): `fetchGaps(dataRef, signals, abort)` adds one `signal` parameter per name; `GapInfoStore` counts asks per signal per data ref, names the first `MAX_GAP_SIGNALS`, fetches again for a newly asked signal, names the current signals on refetch and retry, and computes `settled` as pinned; `useGapInfo(signalIds)`; `TimeseriesWindow` passes its signal IDs memoised on content. Verify: data-gaps scenarios "A signal added to a window", "More than 100 signals", UI check "Adding a signal in the app"; `pnpm smoke` passes (crash guard).

## 4. Docs

- [x] 4.1 `docs/http-api.md`: `/api/gaps` row reads "logger gaps and periods of a data ref" with parameters `dataRef`, `signal` (repeated, at most 100). `docs/data-sources.md` "The queue" paragraph: four classes, interactive first, one slot kept for interactive queries, fallbacks' inner queries in their caller's class. Verify: `pnpm --filter @kipscope/server test` (`docs.test.ts` › "documents every HTTP route" still green); the paragraph names the classes in the order of design P9.

## 5. Tests (tester, test-first)

- [x] 5.1 `queue.test.ts` › "starts waiting queries by class, oldest first", "drops an aborted query from its class", "keeps one slot for interactive queries", "has no kept slot with a limit of one", "starts a raised query at once"; controlled tasks (deferred promises the test resolves), no wall-clock waits; the existing `stats` expectation gains `byClass`. Verify: `pnpm --filter @kipscope/server test -- queue`.
- [x] 5.2 `priority.test.ts` (new) › "tags prefetches and polls as background and requests as interactive" (stub records `currentPriority().cls` per call; full stack `completeSource(queuedAdapter(stub, new QueryQueue(4)))`), "raises a prefetch that a request joins", "answers a series at once after loading a catalog of 2,400 signals" (fake timers, each stub call 1 s). Verify: `pnpm --filter @kipscope/server test -- priority`.
- [x] 5.3 `gaps.test.ts`: "computes gap info once per catalog load and drops a failure" requests with `signal=car/Cyc&signal=car/Odd`; new "measures periods only for asked and workspace signals" (2,400-signal stub, workspace with windows and events line). `gaps.http.test.ts`: "lists the logger gaps and periods of gapcar" names `Msr_B12h.MSR` and `Evt_B11h.EVT`; new "lists measured periods only for named signals"; "answers gap info errors like the density route" gains the 101-signal case. Verify: `pnpm --filter @kipscope/server test -- gaps` (test DB seeded).
- [x] 5.4 `apps/web/test/gaps.test.ts` › "asks for the windows' signals and fetches again for a new one", "names at most 100 signals per data ref" (fake timers); existing cases moved to `ask(signalIds, …)` and the two-argument `fetchInfo`. Verify: `pnpm --filter @kipscope/web test -- gaps`.

## Workflow follow-up

- Lead: confirm Q-1 and Q-2 with Jan before round 1; after the rounds the manual checks of design "Manual checks (lead)"; `pnpm build && pnpm test && pnpm lint`, `pnpm smoke`.
- On archive: ledger entry with the four classes, the kept slot and measured periods only for signals in use (Q-1, Q-2 answers); `docs/status.md` "Next" item 1.1 done.
