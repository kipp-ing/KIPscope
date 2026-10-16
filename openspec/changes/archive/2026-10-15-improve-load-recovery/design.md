# Design

## Context

See proposal.md (D-042 quoted). Current state that shapes the approach:

- **Loader** (`apps/web/src/chart/loader.ts`): one `SeriesLoader` per timeseries window, `LoadState { status, request, result?, error?, placeholder? }` per key (assignment ID). `update(requests)` skips a key whose state has the same request identity, whatever its status, so an errored request is never fetched again (the bug). On failure, both paths (`load`'s tile promises, `fetchExact`) set `{status: "error", request, error}` and drop `result`, so the plot is cleared. `finished()` then calls `firstViewDone` (overview), `onChange`, `maybePrefetch`.
- **Overview:** `firstViewDone` puts an `Overview` into the per-key map before the extent arrives. When the extent or its tiles fail, the entry stays, so `existing?.signalId === signalId` returns early for every later view. The overview is never tried again until the key is removed and added again. (`signalExtent` already forgets a failed extent promise.)
- **Cache** (`chart/cache.ts`): failed runs store nothing and leave `inFlight` (`answer.then(done, done)`), so a later load starts a new run. Runs are shared by owner. `cache.fetch` is the raw `FetchSeries` that both runs and the loader's `fetchExact` call.
- **Errors** (`apps/web/src/api.ts`): `getJson` parses the body first and throws `new Error(`${code}: ${message}`)` when the response is not ok, with no HTTP status. A non-JSON error body (for example a proxy's 502 page) throws a `SyntaxError`. A network failure rejects with `TypeError`. The server answers 502 `source_error` when ClickHouse fails (`apps/server/src/routes/series.ts`) and 4xx for invalid requests.
- **Acknowledgement** (`apps/web/src/App.tsx` `acknowledge`): sends `rendered` once all windows reported the current revision, and returns early when `revision === lastSent.current`, so a second report for the same revision (now with other errors) is never sent. The server (`apps/server/src/workspace.ts` `rendered`) overwrites the client's last acknowledgement for any revision ≤ current, so a repeat is accepted.
- **Window** (`chart/TimeseriesWindow.tsx`): `requests` is memoized on `[w.signals, viewFrom, viewTo, target, width]`, and `loader.update(requests)` runs in a layout effect only when that memo changes. Every workspace push brings new `w.signals` arrays, so every accepted command calls `update` with identical requests. The plot draws `loader.get(id)?.result` whatever the status (line ~692). The legend status text is inline at line ~1504. The acknowledgement effect calls `onReady(w.id, revision, errors)` whenever `settled`, `revision` or the error list changes.
- **Live channel** (`apps/web/src/live.ts`): `useLive` reopens `WS /api/live` 1 s after a close, and `ws.onopen` sets `connected`. The WebSocket goes to the KIPscope server, not to ClickHouse, so a tunnel drop does not close it. In the incident, recovery comes from the backoff timer and from successful requests, not from a reconnect.

## Goals / Non-Goals

**Goals:**
- D-042 (1): every retryable failed series load recovers by itself within 30 s of the source coming back (35 s with request time), and at once after any successful request of the tab, a live reconnect, or the same request again.
- D-042 (2): a failed load never clears a drawn curve.
- Every number is a constant in `loader.ts` and is unit-tested with fake timers and a fake fetch.
- Goal, not a must: during an outage the tab sends no more than about one retry per signal and window every 30 s once the backoff is saturated.

**Non-Goals:**
- `scripts/tunnel.sh` (D-042 (3)).
- Retrying `/api/value` (readouts, values window), and `/api/extent` outside the overview restart (R6). They refresh when their request changes, as today.
- Jitter (Q2), a visual retry countdown, a "retry now" button.
- Any change in `packages/shared`, `apps/server`, `apps/cli`.

## Decisions

### R1: Backoff per key, all retry behaviour behind `LoaderOptions.retry`

The backoff counter and timer belong to each key (one signal in one window). Per key rather than per loader because "reset on success" is a per-signal fact. With a per-loader counter, one healthy signal would keep resetting the backoff of a broken neighbour, which would then be retried every second. Per key rather than per tab because the tab has no list of failed views; the cache only knows runs.

`LoaderOptions.retry?: boolean`. Absent or false means behaviour as before (no timers, the same request is not retried), so existing tests that fail a load leave no timers behind. `WINDOW_LOADER_OPTIONS` sets `retry: true`. Keeping data on error (R5) does not depend on the option.

### R2: Backoff sequence (pinned)

```ts
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const; // last one repeats
export const RETRY_FLOOR_MS = 1000;
```

- `failures` per key: +1 on each failed load of the key (a retry, a normal load or a new view), and reset to 0 on each `complete` state of the key (from the cache or an answer). It survives a change of view (spec: a failure of a new view continues the sequence), because a new view failing during an outage says the source is still down.
- After a failure with a retryable error, the retry is due at `failedAt + RETRY_DELAYS_MS[min(failures, 6) − 1]`.
- Off by ×2:
  - 30 s cap halved to 15 s: twice the failing requests during an outage. With 4 windows × 8 signals that is 2 instead of 1 request/s, still well under the 470 failing requests in 5 min (1.6/s) that the incident produced without any retry.
  - 30 s cap doubled to 60 s: recovery can take up to a minute after the tunnel is back, which Jan would see as "still broken".
  - First step 1 s halved: one more request per failure for a single hiccup, harmless. First step doubled: a one-off 502 costs 2 s of empty legend instead of 1 s.

  None of these changes behaviour qualitatively. The sequence is Jan's.

### R3: Immediate triggers and the floor (pinned)

- **Triggers:** (a) the tab cache reports a successful `/api/series` answer, (b) `cache.recover()` is called (live channel opened), (c) `update` gets a key's identical request while the key's status is `error`.
- **For (a) and (b):** every key whose status is `error` with a retryable error is retried at `max(now, failedAt + RETRY_FLOOR_MS)`, replacing its scheduled backoff timer when that is earlier. **For (c):** the same, for any error, 4xx included (D-042 „setting the same range again also retries").
- A key that is `loading` (a retry already running) or `complete` ignores the triggers.
- **Floor 1 s, off by ×2:**
  - 0.5 s: a signal that keeps failing while its neighbours succeed is fetched up to 2×/s instead of 1×/s.
  - 2 s: recovery after a success elsewhere waits up to 2 s.

  Either is fine. 1 s equals the first backoff step, so the floor never delays a retry beyond what the backoff alone would do.
- Without the floor there is a loop: a key that keeps failing (for example a 502 for one heavy signal) would be retried after every other answer of the tab, and during a gesture that means every 100 ms.

### R4: Retryable errors (pinned, `api.ts` + `loader.ts`)

```ts
// api.ts
export class ApiRequestError extends Error {
  readonly status: number; // HTTP status
  readonly code: string;   // ApiError code, or `http_${status}` when the body is not an ApiError
  constructor(status: number, code: string, message: string); // super(`${code}: ${message}`)
}
```

`getJson` throws `ApiRequestError` for every response that is not ok. It reads the code and message from the JSON body when that parses as `ApiError`; otherwise the code is `http_<status>` and the message is `res.statusText`. The message format `"<code>: <message>"` is unchanged, so legend texts and render errors stay the same. Network failures stay as fetch throws them.

```ts
// loader.ts
export function retryable(error: unknown): boolean; // false only for ApiRequestError with 400 ≤ status ≤ 499
```

Aborts never reach the retry logic: an aborted load belongs to a request that is no longer current, and the `isCurrent` checks already drop it.

### R5: Kept result on error, retry state (pinned, `LoadState`)

`LoadState` keeps its shape. Its meaning extends:

| status | `result` | `error` | `placeholder` |
|---|---|---|---|
| `loading` (new view) | placeholder or previous result | absent | `true` with a placeholder |
| `loading` (retry of the same request) | as at the failure | **the last error** | as at the failure |
| `complete` | the view's data | absent | absent |
| `error` | **the result shown when the load failed** (absent if there was none) | message | `true` when that result is a placeholder |

- On failure, both paths set `{status: "error", request, error, ...(shown.result ? {result} : {}), ...(shown.placeholder ? {placeholder: true} : {})}`, where `shown` is the key's state just before. When nothing was shown, the state equals today's (the existing test "marks a failed signal and leaves the others alone" uses `toEqual` and stays green).
- `overviewLoaded` also recomputes the placeholder of keys in `error` whose result is absent or a placeholder.
- A retry calls the same `load(request)` path as a throttled visible load. Before it starts, it sets `{status: "loading", request, result, placeholder?, error}` from the error state. If the throttle interval is running, the key becomes pending, keeps that loading state, and is loaded at `endInterval` (one start per interval, Z1). If the cache meanwhile holds all tiles, the state becomes `complete` without a fetch (the cache answers inside `load`).
- `settled` is unchanged (`status !== "loading"` for the current request). An `error` state and a scheduled retry are therefore settled, and a running retry is not. The window's existing acknowledgement effect calls `onReady` again for the same revision when `settled` turns true again or its error list changes. No change in `TimeseriesWindow`'s acknowledgement code is needed.
- `App.acknowledge` (pinned): it remembers the last sent `{revision, status, errors}` as one key, `JSON.stringify([revision, errors])`. It sends when that key differs, not only when the revision differs, so after a successful retry the same revision is acknowledged again as `complete`. `lastSent` is reset on disconnect as today.
- Legend text, pinned in `loader.ts` so it can be tested without React:

  ```ts
  export function loadStatusText(state: LoadState | undefined): string;
  // error set → `failed: ${error}`; else complete → ""; else "loading"
  ```

  `TimeseriesWindow.tsx` uses it for the status `<span>` and keeps the CSS class `status ${state?.status ?? "loading"}`, except that it uses `error` when `state.error` is set, so a retrying row keeps the failed colour.

### R6: Retries stop, overview restart, prefetch (pinned)

- The retry timer of a key is cleared when the key is removed, when its request changes (in `show`), on `dispose`, and when a retry starts. When the timer fires, the retry loads `this.order`'s current request for the key, and only if that key's state is still `error` with that request identity.
- **Overview restart:** the overview's two failure handlers (extent, tiles) set `failed = true` on its entry (`Overview.failed?: true`). When a key's state becomes `complete` and its entry has `failed`, the entry is dropped (owner released) and started again as in `firstViewDone`. After an `error`, a failed entry stays as it is, so during an outage a failed retry adds no extent request.
- **Prefetch:** unchanged. Failures are swallowed (`load.catch(() => {})`) and never scheduled. A prefetch success does count as trigger (a): any successful answer means the source is back.

### R7: Cache recovery signal (pinned, `cache.ts`)

```ts
class SeriesCache {
  /** Called after every successful `/api/series` answer through the cache and on `recover()`; returns unsubscribe. */
  onRecover(listener: () => void): () => void;
  /** Tells listeners the source may be reachable again (live channel opened). */
  recover(): void;
}
```

- The constructor wraps the given fetch: `this.fetch = (r, a) => fetch(r, a).then((res) => { this.notify(); return res; })`. Every run and every `fetchExact` therefore reports success. `notify` calls the listeners in a `queueMicrotask`, outside the cache's own bookkeeping, at most once per answer.
- The loader subscribes lazily: when its first key enters `error` with `retry` on, and it unsubscribes when no key is in `error` and on `dispose`. React StrictMode disposes and reuses a loader, so the subscription cannot live in the constructor.
- `apps/web/src/live.ts`: `ws.onopen` calls `tabSeriesCache().recover()` on every open. On the first open no window exists yet, so the call does nothing.

### R8: Lead's manual check (tunnel drop)

On real data, with one window on a range that is already loaded:

1. Stop the tunnel and change the window's range to an unloaded range. The legend reads `failed: source_error …` and the old curve stays.
2. `kipscope --wait window range <w> <same from> <same to>` reports render status `error`.
3. Restart the tunnel and wait without input. Within 35 s the new range's curve is drawn, the legend status is empty, and `GET /api/render-status` shows this client's last acknowledgement `complete` for the same revision.

Screenshots of steps 1 and 3.

## Open questions (built as recommended)

- **Q1: Retry per key, per window or per tab?** Recommended: per key (R1). Per window lets healthy signals reset broken ones. Per tab needs a registry the cache does not have. The immediate triggers give the "the whole tab recovers together" effect anyway.
- **Q2: Jitter?** Recommended: none. One browser tab and one server, and retries of keys that failed together coincide on purpose so the cache merges them into shared runs. Deterministic times keep the fake-timer tests exact. ×2 for two tabs: 8 → 16 requests at the same 30 s mark, which the server's query queue (`KIPSCOPE_QUERY_CONCURRENCY` 4) absorbs.
- **Q3: Retry 4xx automatically?** Recommended: no (R4). Only the same request again retries it (D-042's „setting the same range again also retries").
- **Q4: Legend during a retry: `loading` or `failed: …`?** Recommended: `failed: …` until data arrives (R5). Otherwise the row flickers between two texts every retry, and the marker D-042 (2) asks for disappears.

## Risks / Trade-offs

- **A kept result of another view** (zoomed while failing) is drawn at its true time positions, so the new range may show only part of a curve, or a coarser one. This is the same as the loading state today, and the `failed:` legend says why.
- **Acknowledgement churn:** during an outage each retry flips `settled` false and then true, so `onReady` is re-sent with the same revision and the same errors. That is at most one `onReady` call per key and retry, and `App.acknowledge` sends only when revision or errors changed, so a retry that fails with the same message sends nothing. A `--wait` that starts during a running retry waits for that retry's end. That is bounded by the server's query timeout.
- **Values and readouts** stay failed after an outage until the cursor or range changes (out of scope). If Jan wants them covered too, that is a follow-up with the same pattern in `values/loader.ts`.
