# Proposal

## Why

Carserver's scheduled 23:00 (local) reboot killed the SSH tunnel to ClickHouse. The server answered `/api/series` with 502 `source_error` for about 5 minutes (server log: 470 × 502 from 23:05 to 23:10 local). Every window showed `failed: source_error …` with an empty plot. After the tunnel was back, a tab whose committed range had not changed kept its errors: `SeriesLoader.update` treats an identical request as already handled and never fetches an errored one again. (Failed tiles are already not stored in the cache, and a failed overview extent is already forgotten in `signalExtent`.)

Jan, D-042 (2026-10-15):

> (1) a failed series load retries by itself with backoff 1, 2, 4 … 30 s, and at once when a request succeeds again or the live channel reconnects; setting the same range again also retries; (2) on a failed load the window keeps the last drawn data (or the overview placeholder) with the failure marker instead of an empty plot

Jan: „Nice. Yes fix commit test push done."

## What Changes

- **Retry with backoff (D-042 (1)):** a signal whose series load failed with a retryable error (network failure or HTTP 5xx) loads its current view again by itself after 1, 2, 4, 8, 16, 30, 30, … s. The delay grows with each failure in a row and starts at 1 s again after that signal's next success. A retry goes through the tab cache like any visible load (joins a request in flight, completes from the cache when the tiles meanwhile arrived) and through the window's load throttle.
- **Retry at once (D-042 (1)):** errored signals retry at once, though never sooner than 1 s after their last failure, when (a) any `/api/series` request of the tab succeeds, (b) the live channel (`WS /api/live`) opens again, or (c) the window gets the same request again (for example `window range` with the unchanged range). (c) also retries a 4xx error.
- **Retries stop** when the signal leaves the window, its view changes (the new view loads normally), or the window is disposed. Prefetch failures are still dropped and never retried. A failed overview is started again after that signal's next complete view.
- **Keep data on error (D-042 (2)):** a failed load keeps what the window showed for that signal (previous data or placeholder), and the legend shows `failed: <message>`. The plot is no longer cleared. While a retry loads, the legend keeps showing `failed: …`.
- **Render acknowledgement:** an errored signal still counts as settled (`--wait` reports `error`). A scheduled retry does not change that. While a retry loads, the window is not settled. When the retry ends, the window acknowledges the same revision again: `complete` if the retry succeeded, `error` if it failed.

Out of scope: `scripts/tunnel.sh` (D-042 (3), the lead's); retrying `/api/value` (readouts, values window) and `/api/extent` outside the overview restart; jitter between tabs (design Q2); any change in `packages/shared`, `apps/server` or `apps/cli`; any new visual marker beyond the existing `failed:` legend text.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `series-cache`: new requirements for automatic retry with backoff, immediate retry on recovery, the same request retrying a failed load, and how retries interact with prefetch and the overview. "Failed tiles are not kept" and "Render acknowledgement unchanged" now cover retries.
- `timeseries-window`: "Loading and error state": a failed signal keeps its drawn data and shows the failure marker.

## Impact

- `apps/web/src/api.ts` (`ApiRequestError` carrying the HTTP status), `apps/web/src/chart/cache.ts` (recovery listeners), `apps/web/src/chart/loader.ts` (retry, kept result on error, overview restart), `apps/web/src/live.ts` (one call on open), `apps/web/src/chart/TimeseriesWindow.tsx` (legend status reads `error`), `apps/web/src/chart/overview.ts` (`retry: true`), `apps/web/src/App.tsx` (`acknowledge` repeats a revision when its errors changed).
- Tests: additions to `apps/web/test/loader.test.ts` and `apps/web/test/cache.test.ts` (vitest fake timers, fake fetch that fails N times, then answers). Lead's manual check: drop the tunnel, then restore it.
- No change in `packages/shared`, `apps/server` or `apps/cli`. No new endpoint, DTO or dependency.
