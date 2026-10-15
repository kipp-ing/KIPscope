# Tasks

Web only (design Non-Goals): no task in `packages/shared`, `apps/server` or `apps/cli`. The tasks in group 1 have disjoint files and build in parallel against the signatures pinned in design R4, R5 and R7. 1.2 compiles once 1.1's `ApiRequestError`, `onRecover` and `recover` exist; it can stub them until then. The tester writes group 2 test-first, in parallel. Group 3 is the lead's manual check after groups 1 and 2.

- 1.1: `apps/web/src/api.ts`, `apps/web/src/chart/cache.ts`, `apps/web/src/live.ts`
- 1.2: `apps/web/src/chart/loader.ts`, `apps/web/src/chart/overview.ts`, `apps/web/src/chart/TimeseriesWindow.tsx`, `apps/web/src/App.tsx`
- 2.1: `apps/web/test/loader.test.ts`, `apps/web/test/cache.test.ts`, `apps/web/test/api.test.ts` (new), `apps/web/test/fakeSeries.ts` (only if a helper is needed)

The tasks assume the recommended answers to design Q1–Q4: backoff per key, no jitter, no automatic retry of 4xx, and the legend keeps `failed: …` while a retry loads.

## 1. apps/web/src

- [x] 1.1 Errors with status, cache recovery signal, reconnect, per design R4 and R7:
  - `api.ts`: `ApiRequestError(status, code, message)` with message `"<code>: <message>"`. `getJson` throws it for every response that is not ok, with code `http_<status>` and `statusText` when the body is not an `ApiError`.
  - `cache.ts`: `onRecover(listener)` (returns unsubscribe) and `recover()`. The constructor wraps `fetch` so every successful answer notifies the listeners once, in a microtask. Failures notify nothing.
  - `live.ts`: `ws.onopen` calls `tabSeriesCache().recover()`.
  - Verify: the 2.1 tests "throws errors with HTTP status and code" and the cache recovery tests pass, all existing `cache.test.ts` cases stay green, and `grep -n "tabSeriesCache().recover()" apps/web/src/live.ts` prints one line.
- [x] 1.2 Retry and kept data, per design R1–R3, R5 and R6:
  - `loader.ts`: `LoaderOptions.retry`, `RETRY_DELAYS_MS`, `RETRY_FLOOR_MS`, `retryable(error)` and `loadStatusText(state)`. Per key: a failure counter (reset on `complete`) and a retry timer (cleared on removal, request change, `dispose` and retry start). Immediate triggers: cache `onRecover` (lazy subscription, unsubscribed when no key is in `error` and on `dispose`), and `update` with the identical request on an `error` key. All of them respect the 1 s floor. Retries go through `load` and the throttle.
  - `loader.ts`: on failure, keep the shown `result` and `placeholder`. While a retry loads, its state keeps `error`. `overviewLoaded` also covers `error` keys without data or with a placeholder. `Overview.failed`, and the overview starts again after a `complete` view.
  - `overview.ts`: `WINDOW_LOADER_OPTIONS.retry = true`.
  - `TimeseriesWindow.tsx`: the legend status text comes from `loadStatusText(state)`, and the class is `error` whenever `state.error` is set.
  - `App.tsx`: `acknowledge` sends when `JSON.stringify([revision, errors])` differs from the last one sent.
  - Verify: every 2.1 loader test passes and every existing `loader.test.ts` and `live.test.ts` case stays green. `grep -n "JSON.stringify(\[revision, errors\])" apps/web/src/App.tsx` prints one line. `npm run build` and lint are clean (README).

## 2. Tests

- [x] 2.1 Test-first, vitest with `vi.useFakeTimers()` and the manual fake fetch (`calls[i].fail(new ApiRequestError(502, "source_error", "…"))`, then `answer()`). One test per scenario evidence named in the delta specs:
  - `loader.test.ts`, new `describe("SeriesLoader retries")`:
    - "retries a failed load with backoff 1, 2, 4, 8, 16, 30 s"
    - "resets the backoff after a complete load"
    - "does not retry a 4xx failure by itself"
    - "retries at once when another request of the tab succeeds"
    - "retries at once on recovery, not sooner than 1 s after the failure"
    - "retries at once when the cache reports a recovery"
    - "retries a failed load at once when the same request comes again"
    - "stops retrying when the signal is removed, the view changes or the loader is disposed"
    - "two windows retry with one request"
    - "a retry completes from the cache without a request"
    - "does not retry a failed prefetch"
    - "starts a failed overview again after a complete view"
    - "is settled while failed, not while a retry loads"
    - "keeps the shown result when a load fails"
    - "keeps the placeholder when a load fails"
    - "names the legend status, failed while a retry loads"
  - `cache.test.ts`:
    - "notifies recovery listeners after a successful answer, not after a failure"
    - "notifies recovery listeners on recover()"
  - `api.test.ts` (new): "throws errors with HTTP status and code" (stubbed global `fetch`, also checks `retryable`).
  - Use the window options (`WINDOW_LOADER_OPTIONS` or the same values with a fake `extent`) wherever a scenario says "with the window options".
  - Report: the vitest output of these files, then build and lint.

## 3. Lead

- [x] 3.1 Manual tunnel-drop check, design R8 (series-cache "Settled while failed, not while a retry loads", timeseries-window "Tunnel drop on real data"): screenshots of steps 1 and 3, CLI output of step 2, and the `GET /api/render-status` output of step 3.
