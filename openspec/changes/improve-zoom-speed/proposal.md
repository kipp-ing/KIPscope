# Proposal

## Why

A zoom out takes about half a second to redraw, even when every tile is in the tab's cache. The lead measured one zoom out (D-040): 0–5 ms preview of the old data, 300 ms commit delay, ~20 ms command, loading starts at ~345 ms, data drawn at 400–455 ms; a fully cached zoom still took 359 ms because loading waits for the commit. Jan:

> „a zoom out takes half a second or so to redraw. this is a fast machine. i would like to investigate: how can we create somethin near instant even with bad browsers?"

and on the plan: „noice! go ahead". D-040 in full: build as one change (1) loading on the preview range during the gesture, the command still delayed; (2) a coarse overview of each signal's whole extent loaded once, drawn at once where finer tiles are missing; (3) prefetch in idle time of the next zoom-out level and neighbouring tiles. Targets: a cached zoom draws sharp data within one frame (~16 ms); an uncached one draws coarse data within one frame and sharp data within ~150 ms.

## What Changes

- **Load on preview (D-040 (1)):** during a wheel, pan or key gesture the window's loader follows the shown (preview) range, not the committed one. A fully cached preview is drawn sharp in the same frame. Network loads during a gesture start at once for the first step and then at most once per 100 ms with the latest shown range. The `window.setRange` command keeps its 300 ms delay.
- **Coarse overview and placeholder (D-040 (2)):** per signal the tab fetches its extent once and loads one coarse level over the whole extent (1,024–2,048 buckets) as ordinary tiles; a window holds them while it shows the signal. A view with missing tiles draws at once a placeholder from the finest coarser level the cache can fully serve (the overview at worst), then the sharp data when it arrives. Two cached finer tiles also merge exactly into their parent tile, so a zoom out over loaded data needs no request.
- **Idle prefetch (D-040 (3)):** 300 ms after a window's view rests with all loads done, it prefetches the next coarser level over three view widths around the view and one view width of tiles on each side at the current level, at most 256 tiles per window, at most 2 prefetch requests in flight per tab, cancelled by the next gesture, never ahead of a visible load.
- **Render acknowledgement:** a window acknowledges a revision only when the committed range is drawn with its own sharp data; a placeholder or a different preview range never acknowledges.

Out of scope: a server-side tile cache and a binary transport (D-040); sharing a gesture's preview with linked windows before the command (they follow the committed range as today); per-region mixed resolutions in one curve (design Q1); a visible marker beyond the existing resolution badge and loading status (design Q2); persisting anything across reloads (D-037); caching `/api/value` (D-031, D-039); any server, `packages/shared` or CLI change.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `series-cache`: new requirements for load on preview with a throttle, the per-signal overview, placeholders, merging cached tiles up, idle prefetch with its limits, and the zoom timing targets; "Render acknowledgement unchanged" now says a placeholder or preview never acknowledges.
- `timeseries-window`: "Reload on navigation" loads during the gesture for the shown range and shows a placeholder instead of stretched old data; the command delay stays.

## Impact

- `apps/web/src/chart/tiles.ts` (merge, overview level, placeholder search, prefetch plan), `chart/cache.ts` (find through merged children, prefetch priority queue, `storable`), `chart/loader.ts` (options: throttle, overview, placeholder, prefetch), new `chart/overview.ts` (extent once per tab, the window loader options), `chart/TimeseriesWindow.tsx` (requests from the shown range, synchronous preview render, acknowledgement on the committed range).
- Tests: additions to `apps/web/test/tiles.test.ts`, `cache.test.ts`, `loader.test.ts` (fake timers); a UI timing check in Chrome.
- No change in `packages/shared`, `apps/server`, `apps/cli`; no new endpoint, DTO or dependency.
