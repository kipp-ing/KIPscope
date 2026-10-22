# Tasks

Web only. No `packages/shared`, `apps/server`, CLI or HTTP payload change. The interfaces two groups share are pinned in design.md ("Pinned interfaces": `runsOf`, `deriveRun`, `SeriesCache.put`), so groups 1, 2 and the tester's group 3 run in parallel; group 2 stubs a pinned import until group 1 lands. Every round that touched `apps/web` ends with the UI user (group 4) and the crash guard (group 5).

Write areas (disjoint per group):

- 1.x: `apps/web/src/chart/tiles.ts`, `apps/web/src/chart/cache.ts`
- 2.x: `apps/web/src/chart/loader.ts`
- 3.x: `apps/web/test/` (tester)

## 1. apps/web/src/chart: tiles.ts and cache.ts

- [x] 1.1 `tiles.ts`: `runsOf` as pinned in design W4. Verify: `tiles.test.ts` › "groups indices into runs as the cache does".
- [x] 1.2 `tiles.ts`: `deriveRun` as pinned in W4 (count rule, raw from raw only, bucket merge like `mergeUp`, run bounds as `from`/`to`). Verify: scenarios "Computed run equals the server's", "Buckets cannot give raw" (`tiles.test.ts`).
- [x] 1.3 `cache.ts`: `put` as pinned ("Pinned interfaces"): `splitRun`, then `store` under the workspace's scope, replacing same IDs; no fetch, no `notify`; returns the tiles. Verify: scenario "Computed run stored like a fetched one" (`cache.test.ts`).
- [x] 1.4 `cache.ts`: `load` groups its missing indices through `runsOf` (no behaviour change). Verify: existing `cache.test.ts` and `loader.test.ts` › "requests only the tiles a pan uncovers" stay green.

## 2. apps/web/src/chart/loader.ts

- [x] 2.1 Extent first (W2): a load that the cache and the key's covers cannot answer, for a signal whose extent the key does not know under the scope, starts the extent and records `{seq, view, missing}`; on resolve with an unchanged sequence number decide case A, B or C; on reject mark the overview failed and load the recorded view at once. A view complete from the cache never waits. Verify: scenarios "Extent before the first series request", "Cached view does not wait", "Extent fails".
- [x] 2.2 Case A (W2, W6, W1.4): the overview's missing tiles as `"visible"` under the overview owner; when complete, `overviewLoaded()` first completes waiting keys by computing their recorded missing runs from the overview without `find`, `put`, and requests a refused run visible; a failed overview request fails every waiting key and marks the overview failed. Verify: scenarios "Overview serves the open view", "Open on the extent, every window width", "Step to a session the view spans".
- [x] 2.3 Covers and case B (W3, W2, W7 first row): `coverFor`; record the wide view cover when the view's tiles span the extent at `L < O`; overview tiles from `find`, else computed from that cover and `put`, else requested as prefetch; apply the same rule in `firstViewDone` after a view complete from the cache; drop covers with the overview. Verify: scenarios "Overview from a wide view", "Step to a narrower view: view first, overview after it", "Overview requested once".
- [x] 2.4 W5 in `show` and `load`: `find`, then per `runsOf(missing)` `coverFor` → `deriveRun` → `put`, then request the rest; `show` completes synchronously when nothing is left. Verify: scenarios "Zoom out above the overview without a request", "Requested where the overview cannot answer", "Draws on open what a loader without overview draws" (via "Open on the extent, every window width").
- [x] 2.5 Prefetch (W8): each range's index list through W5 steps 2–3; computed tiles count against the budget. Verify: scenarios "Prefetch computed from the overview", "Prefetch after rest, none during the gesture" (unchanged).
- [x] 2.6 Comments: `LoaderOptions.extent` as pinned; the class comment names the extent-first order and computed runs. Verify: `pnpm lint`.

## 3. Tests (tester, test-first from the specs)

- [x] 3.1 `fakeSeries.ts` or `loader.test.ts`: fixtures SPARSE, SHIFTED, STEP of design W9 and a helper that compares two results with `mean` within 1e-12 relative.
- [x] 3.2 `tiles.test.ts`: "groups indices into runs as the cache does", "derives a run like the server from raw tiles", "derives a run like the server from finer bucket tiles", "derives nothing where the server would answer raw from buckets".
- [x] 3.3 `cache.test.ts`: "stores a computed run like a fetched one".
- [x] 3.4 `loader.test.ts` new: "asks the extent before the first series request", "draws a cached step at once, before the extent", "loads the view first when the extent fails", "requests the run the overview cannot answer", "zooms out above the overview without a request", "opens on the extent with one series request per signal", "draws on open what a loader without overview draws", "steps to a session the view spans with one series request", "steps to a narrower view: view first, overview after it", "fetches the serving overview as a visible load", "computes the overview from a wide view's tiles", "prefetches nothing the overview answers".
- [x] 3.5 `loader.test.ts` adjusted to the extent-first order (flush the extent's microtask before reading `calls`), meaning unchanged: "loads the overview once per signal after its first view" (now also: extent asked before the first series request), "draws a cached zoom in the same update, without a request", "starts a failed overview again after a complete view", and any other window-options test that reads `calls` inside the first `update`.
- [x] 3.6 Run `pnpm build && pnpm test && pnpm lint`; report per scenario of the delta spec pass, fail or not_run.

## 4. UI check (UI user, carserver, real data)

- [x] 4.1 Scenario "Open on carserver": tab in front (series load only in a visible tab), network log filtered to `/api/`, count per signal; one screenshot.
- [x] 4.2 Scenario "Step without preload on carserver"; one screenshot.
- [x] 4.3 Regression: timeseries-window "Back to a cached range" and series-cache "Uncached zoom draws a placeholder, then sharp data" by eye (placeholder first, sharp after; Backspace sends no `/api/series`).

## 5. Crash guard

- [x] 5.1 `pnpm build`, `pnpm smoke` against the running Vite and `pnpm smoke --preview`: pass.

## Out of scope

P3 batch endpoints; P7, P8; preloading overviews or extents for neighbours; an extent timeout; any server, `packages/shared`, `TimeseriesWindow.tsx`, `overview.ts` or `preload.ts` change; the App's double-click reset; D-039's warm-cache raw/bucket dependency.
