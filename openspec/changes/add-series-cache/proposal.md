# Proposal

## Why

Every zoom, pan, history step or re-added signal fetches its series again, even when the same data was on screen a moment ago: `SeriesLoader` (`apps/web/src/chart/loader.ts`) asks `/api/series` for the exact `{signalId, from, to, target}` of each view, and no two views share a request. Jan decided (D-037, item 3):

> „signal caching. stuff that has been loaded once shall stay in the browser to be faster, if thats possible."

D-037 (3) in full: „series data loaded once stays in the browser's memory until the tab closes, with a size limit (oldest dropped first), so zooming and panning back is fast. Not persisted across reloads."

The concept asks the same without a separate service (§2): „Bereits für eine Ansicht geladene Daten bleiben für Zeichnung und Cursor nutzbar. Dafür wird kein zusätzlicher Cache-Dienst vorausgesetzt." and keeps §10's rule: „Veraltete Abfrageantworten dürfen keinen neueren Zoomzustand überschreiben."

An exact-range request can never be reused by a different view. So views must ask for reusable pieces: fixed bucket widths and fixed time tiles per width.

## What Changes

- **Tiles on a fixed grid:** each view picks its bucket width from a ladder of powers of two nanoseconds (the smallest at or above today's width), and loads fixed tiles of 256 buckets of that width. Tiles are requested with the existing `/api/series` API, tile-aligned, several adjacent missing tiles in one request; the server already returns exactly the right buckets for such requests (no server code change; a server test pins that property).
- **Browser tile cache:** one cache per browser tab, shared by all timeseries windows, in memory only. A view uses the cached tiles it covers and requests only the missing ones; a view whose tiles are all cached is drawn at once with no request and no loading state. Raw tiles also serve every finer zoom inside them.
- **Size limit:** about 4 million stored values (a raw point counts 2, a bucket 6); the least recently used tiles are dropped first.
- **Shared requests:** a tile wanted by two windows is fetched once; a request is aborted only when no window wants any of its tiles any more. A late response only fills the cache and never replaces a newer view.
- **Fresh data not kept:** tiles that end less than 1 hour before the browser's clock are used but not cached, since data may still be arriving there (design Q1).
- **Unchanged:** the drawn data keeps its form (`SeriesResult`), so drawing, readouts, the live cursor (D-032/D-034) and the render acknowledgement work as before; `/api/value` lookups (values window, committed cursors, D-031) stay exact server lookups.

Out of scope: keeping data across reloads or in browser storage (D-037 „Not persisted across reloads"); a server-side cache (concept §2, „kein zusätzlicher Cache-Dienst"); caching `/api/value` and `/api/extent`; deriving coarse buckets from finer cached ones; a cache size setting or a cache view in the UI; a batch endpoint for several signals; prefetching neighbouring tiles.

## Capabilities

### New Capabilities
- `series-cache`: the browser tab's tile cache for series data: reuse on zoom, pan, history and re-add, requests only for missing tiles, sharing between windows, size limit with least-recently-used eviction, fresh-data rule, and what stays unchanged for drawing and acknowledgement.

### Modified Capabilities
- `timeseries-window`: "Reload on navigation" requests only data that is not cached and shows a fully cached range without request or loading state.
- `series-query`: new requirement "Reusable buckets for aligned requests" pins the existing server behaviour the cache relies on.

## Impact

- `apps/web/src`: new `chart/tiles.ts` (grid math, run requests, split, stitch, raw derivation, aggregation of raw tiles), new `chart/cache.ts` (tab-wide tile store with size limit, in-flight runs, abort by wanters), `chart/loader.ts` (views from tiles), `api.ts` (request type), `chart/TimeseriesWindow.tsx` (one line: the loader uses the tab cache).
- Tests: new `apps/web/test/tiles.test.ts`, `apps/web/test/cache.test.ts`; additions to `apps/web/test/loader.test.ts` and `apps/server/test/series.test.ts`.
- No change in `packages/shared`, `apps/server/src` or `apps/cli`; no API or DTO change, no new dependency.
