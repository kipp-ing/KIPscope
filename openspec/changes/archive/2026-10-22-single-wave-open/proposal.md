# Proposal

## Why

The ADX testers measured an open after `speed-up-adx` (D-097, 2026-10-22): per signal the web still runs four serial round trips, `series` (target 769, extent unknown) → `extent` → `series` (257) → `series` (overview, 1281), so an open of 4 signals sends 16 requests and the peak in flight equals the number of signals; the server's query queue (8 slots on ADX) is not the limit. Their report's item P4: "Opening a session issues one series fetch per signal". The overview already covers the view when the view spans the signal's data (design Z2 of `improve-zoom-speed` meant it to: "the full-extent view of a window about 1,000 px wide usually has the overview's level and is served by it"), but the loader fetches the view first and the overview only after it. Jan agreed on 2026-10-22 (via the lead) to build P4 alone; P3 (batch endpoints) comes later.

## What Changes

- **Extent first:** with the window options, the first load of a signal in a window waits for the signal's extent (native on ADX since D-097, 0.16–0.34 s measured), unless its view is complete from the cache. Then the loader knows the overview's level before it requests anything.
- **One series request per signal on open:** when the view's level is at or above the overview's, the loader requests the overview as a visible load and computes the view's tiles from it. When the window is wider (view level below the overview's) and the view spans the signal's extent, it requests the view and computes the overview from the view's tiles. Otherwise it loads the view first and the overview after it, as today.
- **Exact or not at all:** a run of tiles is computed in the browser only where the result equals the server's answer for that run's request (same tile level, raw only where the server would answer raw, same buckets); every other run is requested as today. Drawn data stays the same.
- **Zoom and prefetch:** later views and the prefetch at rest compute runs at or above the overview's level (or the window's wider cover) instead of requesting them; finer tiles are requested only when the user zooms in below that level or the view is narrower than the overview resolves.
- **After a step:** a view whose tiles the neighbour preload stored is drawn at once, as today; otherwise the step behaves like an open for windows whose view spans the new session's signal extent, and as today for narrower windows (design W7).

No HTTP payload, server, CLI or `packages/shared` change.

## Non-goals (later changes or never)

- P3 batch endpoints (`/api/series/batch`, `/api/extent/batch`): one request per signal stays one request per signal.
- P7 `/open` without the full scoped signal list; P8 loading state and a blocked second open.
- Preloading overviews or extents for the neighbour sessions (case-preload stays as it is).
- A timeout that loads the view when its extent is slow.
- Changing the known warm-cache behaviour of D-039 (raw vs buckets of a sparse view can depend on what was loaded before).
- Any change to when series load in a background tab, to the window's width measurement, or to the App's double-click reset (it keeps its own `fetchExtent`).
- Wall-clock targets: the ADX testers measures on ADX after release.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `series-cache`: the overview is fetched first (after the extent) when it serves the view, or computed from a wide view's tiles; runs at or above a held cover are computed in the browser when exact; the prefetch computes such runs instead of requesting them; one series request per signal on open.

## Impact

- `apps/web/src/chart/tiles.ts` (`runsOf`, `deriveRun`), `apps/web/src/chart/cache.ts` (`put`, `load` groups through `runsOf`), `apps/web/src/chart/loader.ts` (extent first, the three branches, computed runs, prefetch).
- `apps/web/test/`: `tiles.test.ts`, `cache.test.ts`, `loader.test.ts` (new scenarios; a few existing window-options tests adjusted for the extent-first order).
- Unchanged: `apps/server`, `packages/shared`, `apps/web/src/chart/TimeseriesWindow.tsx`, `chart/overview.ts`, `preload/preload.ts`, every HTTP payload.
- Decisions: Jan's agreement to P4 alone (2026-10-22) is not yet in `docs/decisions.md`; the lead records it. D-038 (snap finer), D-039, D-040 (2), D-043 (one coarse level of 1,024–2,048 buckets per extent), D-081 and D-097 are kept as written.
