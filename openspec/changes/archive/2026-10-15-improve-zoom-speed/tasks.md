# Tasks

Web only (design Non-Goals): no task in `packages/shared`, `apps/server` or `apps/cli`. Group 1's tasks have disjoint files and build in parallel against the interfaces pinned in design Z3–Z7 (1.2 and 1.3 compile once 1.1's pinned signatures exist); group 2 (tester) writes the tests test-first in parallel; group 3 is the UI user's timing check after group 1.

- 1.1: `apps/web/src/chart/tiles.ts`
- 1.2: `apps/web/src/chart/cache.ts`
- 1.3: `apps/web/src/chart/loader.ts`, `apps/web/src/chart/overview.ts` (new)
- 1.4: `apps/web/src/chart/TimeseriesWindow.tsx`, `apps/web/src/App.tsx` (one prop)
- 1.5: `apps/web/src/chart/linkedPreview.ts` (new)

The tasks assume the recommended answers to design Q1 (one placeholder level per curve), Q2 (no new marker); Q3 is Jan's D-041 (linked windows follow the preview live, design Z9).

## 1. apps/web/src

- [x] 1.1 Pure tile functions (`chart/tiles.ts`), per design Z2, Z3, Z4, Z7:
  - Constants `OVERVIEW_TARGET = 1025`, `MERGE_DEPTH = 2`, `PLACEHOLDER_SEARCH = 6`; `interface TileRange { level: number; first: bigint; last: bigint }`.
  - `overviewLevel(first, last)`, `overviewTiles(first, last): TileRange`, `emptyTile(signalId, level, index)`.
  - `mergeUp(left, right)` (raw + raw → raw; else buckets, count-weighted mean, SNA counts summed, all-SNA bucket without values).
  - `placeholder(from, to, level, maxLevel, lookup)`, `prefetchPlan(from, to, level)`.
  - Verify the 2.1 tests pass (series-cache "Merge like the server", "Finest available level"; the prefetch plan of "Prefetch after rest, none during the gesture").
- [x] 1.2 Cache (`chart/cache.ts`), per design Z3, Z6:
  - `find` through merged children, at most `MERGE_DEPTH` levels down, merged tiles not stored.
  - `load(…, priority = "visible")`: prefetch FIFO with `PREFETCH_IN_FLIGHT = 2`, visible loads never wait, a waiting prefetch run a visible load wants starts at once; `release` drops waiting runs without a fetch.
  - `storable(level, index)`, `get queuedPrefetch()`.
  - Verify the 2.2 tests pass and `apps/web/test/cache.test.ts`'s existing cases stay green.
- [x] 1.3 Loader and overview (`chart/loader.ts`, `chart/overview.ts` new), per design Z1, Z2, Z4, Z5, Z7:
  - `LoaderOptions` (`loadIntervalMs`, `extent`, `prefetch`), `LoadState.placeholder`, constants `LOAD_INTERVAL_MS`, `SETTLE_MS`, `PREFETCH_MAX_TILES`; no options → behaviour as before.
  - Throttle (leading start, pending keys loaded at the end of the interval with their current request, previous owner released only when the new load starts).
  - Placeholder state in `update` via `placeholder(...)` with the cache and overview lookup; recomputed when the overview completes.
  - Overview per key after its first view finished (`extent`, `overviewTiles`, `cache.load(…, "prefetch")`, tiles held per key, owner released on removal and `dispose`).
  - Prefetch at rest (`SETTLE_MS` timer, all keys complete or error, `prefetchPlan` filtered by `find`, `storable`, extent; ≤ `PREFETCH_MAX_TILES`; owner released on the next changing update, removal, `dispose`).
  - `overview.ts`: `signalExtent` (once per tab, failure forgotten), `WINDOW_LOADER_OPTIONS`.
  - Verify the 2.3 tests pass and every existing `loader.test.ts` and `live.test.ts` case stays green.
- [ ] 1.4 Window wiring (`chart/TimeseriesWindow.tsx`, `App.tsx` one prop), per design Z1, Z8, Z9:
  - Loader with `WINDOW_LOADER_OPTIONS`; `requests` from the shown range (shown-range computation moved above the memo), `committedRequests` from `w.range`; `loader.update` in `useLayoutEffect`; `flushSync(rerender)` in `applyRange`; acknowledgement `loader.settled(committedRequests)`. `COMMIT_DELAY_MS` stays 300.
  - Shared preview per design Z9: `linked` prop from `App.tsx`; the shown range from `shownRange(w.id, preview.range, useLinkedPreview(), linked, serverRange)`; in `applyRange` while linked `flushSync(() => { linkedPreview.publish(w.id, r); rerender(); })`; `clear(w.id)` when the own preview is dropped, on unmount and when `linked` turns false; only the source commits.
  - Verify: `grep -n "loader.settled(committedRequests)" apps/web/src/chart/TimeseriesWindow.tsx` and `grep -n "COMMIT_DELAY_MS = 300" apps/web/src/chart/TimeseriesWindow.tsx` each print one line; the UI checks of group 3.

- [x] 1.5 Shared preview store (`chart/linkedPreview.ts`, new), per design Z9: `SharedPreview`, `LinkedPreviewStore` (`get`, `publish` with synchronous notify, `clear` only for the current source, `subscribe`), `linkedPreview`, `useLinkedPreview` (`useSyncExternalStore`), pure `shownRange`. Verify the 2.4 tests pass.

## 2. Tests (tester)

- [x] 2.1 `apps/web/test/tiles.test.ts` additions (with `fakeSeries.ts`):
  - "merges two child tiles into their parent like the server": two adjacent level-10 bucket tiles of a dense fake signal with SNA points (including an all-SNA bucket) → `mergeUp` equals the fake server's level-11 tile (count, sna, min, max exactly; mean within 1e-12 relative); one raw and one bucket child → buckets; two raw children → raw equal to the fake server's raw answer with `before`/`after`.
  - "finds the finest coarser level for a placeholder": `lookup` with tiles only at level 23 for a level-20 view → `placeholder` returns the stitched level-23 result (width 8,388,608); with tiles at 21 too → level 21; with none → `undefined`.
  - "plans the prefetch: next coarser level three views wide, one view each side": `prefetchPlan(0n, 1000n × 2n ** 20n, 20)` → `[{21, −2n, 3n}, {20, −4n, −1n}, {20, 3n, 7n}]`; `overviewLevel(0n, 4294967295n)` → 22 and `overviewTiles` 0…3; about 3 days → level 37.
- [x] 2.2 `apps/web/test/cache.test.ts` additions:
  - "finds a tile merged from cached children, at most two levels down" (series-cache "Zoom out over loaded tiles").
  - "runs at most two prefetch requests at once, visible loads first" (series-cache "Two in flight, visible first").
  - "drops a queued prefetch run nobody wants" (released while waiting → never fetched, `queuedPrefetch` 0, promise rejected).
  - "starts a queued prefetch run at once when a visible load wants it".
- [x] 2.3 `apps/web/test/loader.test.ts` additions (vitest fake timers; a dense fake signal, e.g. one point per 2^19 ns, so level-20 and level-22 views come back as buckets; a fake `extent`):
  - "draws a cached zoom in the same update, without a request" (window options; A, B loaded, back to A → `complete` and `onChange` within `update`, fetch count unchanged).
  - "throttles loads during a gesture: first at once, then once per interval" (series-cache "Wheel gesture of 250 ms" and "Single step after a pause"; each view uncached and sharing no tile with the next).
  - "loads the overview once per signal after its first view" (two loaders, one cache, one memoised extent; exactly one `{from 0, to 4294967296, target 1025}` after the first views answered, none before).
  - "keeps the overview tiles when the cache drops them" (limit 1).
  - "shows a placeholder at once and sharp data after the response" (series-cache "Uncached zoom draws a placeholder, then sharp data"; `settled` false before the answer, true after).
  - "prefetches after the view rests, never during a gesture" (loader with `prefetch: true`, `loadIntervalMs: 100`, no extent; gesture views far from the rest view so they share no tile with the plan; the three pinned requests, at most two in flight; a new update aborts the running ones and the queued one is never sent).
  - Verify each new test fails before group 1 and passes after; then `pnpm build && pnpm test && pnpm lint` green.

- [x] 2.4 `apps/web/test/linkedPreview.test.ts` (new): "publishes synchronously and clears only for the current source" (subscriber called inside `publish`; a later `publish` by another source replaces it; `clear` by the earlier source is ignored, by the current one clears and notifies); "shows the own preview, else the linked shared one, else the server range" (own beats shared; shared from another source only while linked; a window's own shared publication does not override its server range when it has no own preview; unlinked → server range).

## 3. UI check (UI user)

- [ ] 3.1 Design T1 in Chrome on localhost with two linked windows (`smart451/COMBI_412h.V_ANZ`, `smart451/CPC_448h.PTC_HV_Volt`): steps 1–4, steps 1–2 on three 1 h ranges; report `bursts` per window and `series` per step and the median of step 2 per window (series-cache "Zoom timing", "Zoom out after rest is cached", "Command still delayed, no load after it"; timeseries-window "Loading starts during the gesture", "Linked windows follow the gesture", "Zoom one of two unlinked windows"). Plus the overview network check of series-cache "Overview requested once" and the CLI check of "Placeholder does not settle".
