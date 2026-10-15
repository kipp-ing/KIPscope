# Tasks

Web only (design Non-Goals): no task in `packages/shared`, `apps/server/src` or `apps/cli`; the server's existing behaviour is pinned by test 2.3. Group 1's tasks have disjoint files and build in parallel against the interfaces pinned in design C1, C2 and C7; group 2 (tester) writes the tests test-first in parallel.

- 1.1: `apps/web/src/chart/tiles.ts` (new)
- 1.2: `apps/web/src/chart/cache.ts` (new), `apps/web/src/chart/loader.ts`, `apps/web/src/api.ts`, `apps/web/src/chart/TimeseriesWindow.tsx` (one line)

The tasks assume the recommended answers to design "Open Questions" (Q1 tiles ending within the last hour are not stored) and Jan's D-038 for Q2 (width snapped down).

## 1. apps/web/src

- [x] 1.1 Tile grid and pure tile functions (`chart/tiles.ts`, new), per design C1, C3, C4, C5:
  - Constants, `SeriesRequest`, `Tile`, `tileId`, `bucketWidthOf`, `tileSpan`, `levelFor`, `touchedTiles` (bigint floor division, negative times included), `tileable`, `runRequest`.
  - `splitRun` (raw neighbours per tile from adjacent points or the run's own), `deriveRaw`, `aggregateRaw` (series-query bucket rules; SNA null counted in `sna`, kept out of mean/min/max; all-SNA bucket without mean/min/max; empty buckets omitted), `stitch` (all raw → raw with view neighbours; else buckets on the snapped range), `tileWeight`.
  - Verify `apps/web/test/tiles.test.ts` from 2.1 passes (series-cache "Power-of-two width", "Width never coarser than today", "Stitched raw tiles", "Mixed raw and bucket tiles"; "derives a finer raw tile with its edge neighbours").
- [x] 1.2 Tab cache and loader on tiles (`chart/cache.ts` new, `chart/loader.ts`, `api.ts`, `chart/TimeseriesWindow.tsx`), per design C2, C5, C6, C7, C8:
  - `SeriesCache`: LRU `Map` of stored tiles with weight sum and `limit`; `find` with raw-ancestor lookup over a per-signal set of raw levels; `load` joining in-flight runs, grouping the rest into runs of ≤ `MAX_RUN_TILES`, storing answered tiles unless they end after `now() − 1 h`, rejecting on error without storing; `release` aborting runs nobody wants; `tabSeriesCache()`.
  - `SeriesLoader(cache, onChange)`: per changed request level, touched tiles, `find`, synchronous `complete` when all found, else `loading` with the previous result and `load` with a per-request owner; release the previous owner after the new load; fallback to the exact request when not `tileable`; `get`, `settled`, `dispose` as today.
  - `api.ts`: `fetchSeries(r: SeriesRequest, abort)`. `TimeseriesWindow.tsx`: `new SeriesLoader(tabSeriesCache(), rerender)`.
  - Verify `apps/web/test/cache.test.ts` and `apps/web/test/loader.test.ts` from 2.2 pass, `apps/web/test/live.test.ts` stays green, plus the UI checks series-cache "Zoom back to a previous view", "Re-add a removed signal", "Pan by half a view", "Zoom further into raw data", "Live cursor on cached data", "Reload starts empty", "Cached view settles at once"; timeseries-window "Back to a cached range".

## 2. Tests (tester)

- [x] 2.1 `apps/web/test/tiles.test.ts` (new), plus a fake series server `apps/web/test/fakeSeries.ts` (new) that answers a `SeriesRequest` from a point list by the series-query rules (raw with `before`/`after` when `count ≤ target`, else buckets of width `ceil((to − from) / (target − 1))` on the grid `k × width`, only points inside `[from, to)`, SNA as null):
  - "picks the power-of-two width and the touched tiles": `[0, 1000 × 2^20)` with target 1001 → level 20, span 2^28, tiles 0…3, `runRequest` → `from` 0, `to` 1073741824, target 1025; ten hours with target 2000 → level 34 (width ≤ 18,009,004,503 ns); a range of 3 × 2^20 ns with target 2 → level 21, never above `ceil((to − from) / (target − 1))`; a negative `from` floors to the lower tile; `tileable` false beyond `TIME_MAX`.
  - "stitches raw tiles like one request": three raw tiles from `splitRun` of a fake raw answer with an SNA point in the middle tile; `stitch` for a view inside them equals the fake server's answer for the view range (points, nulls, `before`, `after`).
  - "derives a finer raw tile with its edge neighbours": `deriveRaw` from a level-12 raw tile to a level-10 tile equals the fake server's raw answer for that tile range, also for a finer tile with no point inside.
  - "aggregates raw tiles to buckets in a mixed view": a raw tile next to a bucket tile → `stitch` gives buckets of the view's width; the raw part's buckets equal the fake server's buckets for that tile (count, sna, mean, min, max, all-SNA bucket without values); result `from`/`to` snapped to the width.
  - Verify each fails before 1.1 and passes after.
- [x] 2.2 `apps/web/test/cache.test.ts` (new) and `apps/web/test/loader.test.ts` (adapted to `new SeriesLoader(new SeriesCache(fetch, options), onChange)`, existing tests kept), with a controllable fake fetch counting calls:
  - cache: "drops the least recently used tile first" (limit for two tiles; A, B, use A, store C → B gone, `size` = A + C); "aborts a run only when nobody wants it" (two owners, one releases → not aborted, both promises resolve; last releases → abort signal set, no tile stored); "does not store tiles that end within the last hour" (fake `now`; tile ending 30 min before → resolved, not in `peek`, next `load` fetches again).
  - loader: "draws a previous view again without a request" (A, B, back to A → call count unchanged, state `complete` and `settled` right after `update`); "serves a re-added signal from the cache"; "requests only the tiles a pan uncovers" (first and pan requests with the pinned `from`/`to`/target of series-cache "First view" and "Pan by half a view"); "zooms into raw tiles without a request"; "keeps drawing a view whose tiles were dropped" (limit 1); "shares one request between two windows" (two loaders, one cache); "lets a late response fill the cache only"; "requests failed tiles again for the next view".
  - Verify each new test fails before 1.2 and passes after.
- [x] 2.3 `apps/server/test/series.test.ts`: "returns identical buckets for aligned requests that share them" with the pinned SPEED requests of series-query "Same bucket from two aligned requests" (width `134217728`, second result's buckets equal the first result's buckets from 1790820046092632064 on). It passes against today's server code; run `curl -s 'localhost:7310/api/series?signal=smart451/COMBI_412h.V_ANZ&from=1791896364897009664&to=1791896914652823552&target=513' | jq -r '.kind, .width'` (prints `buckets`, `1073741824`). After group 1: `pnpm build && pnpm test && pnpm lint` green, and the `grep` of series-cache "Reload starts empty" prints nothing.
