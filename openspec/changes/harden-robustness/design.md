# Design

## Context

See proposal.md (Why). Facts that shape the fixes:

- **Wire times** (`packages/shared/src/encoding.ts`): `EncodedTimes {t0, dt: number[]}`, offsets from `t0`; `encodeTimes` throws `RangeError` beyond 2^53 ns. The server encodes raw points and bucket starts (`apps/server/src/series.ts`); the web decodes in `chart/build.ts`, `chart/readout.ts`, `chart/tiles.ts` and re-encodes stitched tiles in `tiles.ts`. No code reads `dt` directly. `tiles.ts` `tileable` refuses spans over `MAX_SPAN = 2^53`, so long views and overviews fall back to the exact path or get none. The CLI never reads series.
- **Buckets** (`apps/server/src/clickhouse.ts` `buckets`): start `intDiv(ns, w) * w`, truncating toward zero. Width `ceil(L / (target − 1))`, `MIN_TARGET = 2`; the time bounds span 1.14 × 10^19 ns. Test and carserver ClickHouse are 26.8 (`docker-compose.yml`).
- **Errors:** every route answers 502 `source_error` for any exception of the query. The web retries 5xx with backoff forever (D-044).
- **Server boundary** (`apps/server/src/app.ts`): Fastify with its default parsers (`application/json`, `text/plain`), `@fastify/websocket` with default options, no hooks. The Vite proxy (`apps/web/vite.config.ts`) is `{target, ws: true}` without `changeOrigin`, so it forwards the browser's `Host` (`localhost:5173`) and `Origin` (`http://localhost:5173`) unchanged.
- **Catalog** (`apps/server/src/main.ts`): `loadCatalog` runs once after `listen`. `POST /api/catalog/refresh` calls `catalog.refresh()` directly; DBC warnings go into a module array that only `loadCatalog` logs.
- **Web commands** (`apps/web/src/api.ts` `sendCommand`): `res.json()` without status check; `App.command` awaits it without catch.
- **Acknowledgement** (`App.tsx` `acknowledge`, `live.ts` `send`): `lastSent` is set before `send`, which drops silently when the socket is not open; after a reconnect with an unchanged revision no effect calls `acknowledge` again.
- **Recovery** (`chart/cache.ts` `notify`, `chart/loader.ts` `recovered`): every successful answer pulls every retryable failed key to `max(now, failedAt + 1 s)` (D-044, archived design R3).
- **Window requests** (`chart/TimeseriesWindow.tsx`): the `requests` memo depends on `w.signals`, a new array on every pushed revision, so `loader.update` sees "the same request again" on every revision and retries failed keys, 4xx included.

## Goals / Non-Goals

**Goals:** every finding of the proposal fixed with the smallest change that makes its scenario pass; interfaces between `packages/shared`, `apps/server/src` and `apps/web/src` pinned below so the three areas build in parallel in one round.

**Non-Goals:** a host allowlist setting, authentication, TLS; retrying `/api/value`; a visual retry countdown; any change of the CLI; moving logic out of `TimeseriesWindow` or `App` beyond the small helpers named here (`ack.ts`, `filedrop.ts`, `WindowBoundary.tsx`, `trackHeightDrag`, `loadKey`, `applyLiveMessage`).

## Decisions

### H1: Offsets are numbers while exact, decimal strings beyond (pinned, `packages/shared/src/encoding.ts`)

```ts
export interface EncodedTimes {
  t0: string;
  /** Offset from t0 in ns per point: a number when |offset| ≤ 2^53 − 1, else a decimal string. */
  dt: (number | string)[];
}
export function encodeTimes(times: readonly Timestamp[]): EncodedTimes;   // never throws
export function decodeTimes(encoded: EncodedTimes): Timestamp[];
// RangeError for a number that is not a safe integer and a string not matching /^-?\d+$/
/** RangeError unless `value` is a SeriesResult: kind raw|buckets, from/to (and width) decimal, t decodes,
 *  v (raw) or count, sna, mean, min, max (buckets) are arrays of t.dt's length. */
export function assertSeries(value: unknown): asserts value is SeriesResult;
```

- Exact for any span and any gap within the time bounds; a span under 104 days encodes exactly as today, so existing fixtures and an older web build keep working.
- Web: `tiles.ts` `tileable` keeps only the time-bounds check (`MAX_SPAN` goes). `SeriesCache`'s wrapped fetch calls `assertSeries(result)` before `notify()`, so a malformed answer rejects like a failed request in both the tile runs and the loader's exact path, stores no tile, and does not count as a recovery.
- Alternatives: consecutive deltas (still need a fallback for one gap over 2^53, and silently change the meaning of `dt` for hand-written fixtures); bucket indices relative to `t0` (buckets only, raw points still need a scheme); all offsets as strings (every answer about 20 % larger, every fixture changes). Mixed number/string is the only scheme that is exact, needs one rule for raw and buckets, and changes nothing for today's data.
- Off by ×2: the threshold is the float exactness limit, not tunable; a lower one only makes more offsets strings.

### H2: Bucket width cap, floor grid, 400 for own errors (pinned, `apps/server/src`)

- `series.ts`: `export const MAX_BUCKET_WIDTH = 2n ** 62n;` `bucketWidth` returns `min(ceil(L / (target − 1)), MAX_BUCKET_WIDTH)`. With `w = 2^62` a range in the bounds touches buckets −1, 0 and 1 only (`TIME_MAX / 2^62 < 2`), so at most 3. Every start `t − pmod(t, w)` stays above `TIME_MIN − 2^62 > −2^63`. Off by ×2: 2^61 → at most 6 buckets for the full bounds, harmless; 2^63 does not fit Int64.
- `clickhouse.ts` `buckets`: start `x − positiveModulo(x, {w:Int64})` with `x = toUnixTimestamp64Nano(time)` (floor grid; matches the web's `floorDiv` tiles). If the result type is not Int64 on 26.8, the engineer casts it with `toInt64`; the scenario "Buckets around the epoch" decides.
- `routes/series.ts` `/api/series`: a `RangeError` from `querySeries` answers 400 `invalid_request` with the range; every other error stays 502 `source_error`. With H1 and the cap no valid request reaches it; it guards against a future regression turning into an endless retry.

### H3: Access guard (pinned, new `apps/server/src/access.ts`)

```ts
/** 127.0.0.1, localhost, ::1 and [::1], case-insensitive. 0.0.0.0 and :: are not loopback. */
export function isLoopbackHost(host: string): boolean;
export interface AccessOptions { /** LETSVIEW_HOST when neither loopback nor 0.0.0.0/::. */ extraHost?: string }
/** Host header without port: loopback name or extraHost. Undefined → false. */
export function hostAllowed(host: string | undefined, options: AccessOptions): boolean;
/** Undefined → true. Else http:/https: URL whose hostname passes hostAllowed. "null" → false. */
export function originAllowed(origin: string | undefined, options: AccessOptions): boolean;
```

- `app.ts`: `buildApp(deps, options: { logger?: boolean; extraHost?: string })`. One `onRequest` hook at the root, before the route plugins, answers 403 `forbidden_host` or `forbidden_origin` as `ApiError`. `app.removeContentTypeParser("text/plain")`, so Fastify answers 415 to non-JSON bodies. The live channel's upgrade runs through the same hook; if `@fastify/websocket` does not let a hook refuse the upgrade, the `/api/live` handler checks the same two functions on `request.headers` and closes with 1008 before sending `hello` (the spec scenario accepts either).
- `main.ts`: `extraHost` from `config.host` as above; when `!isLoopbackHost(config.host)` it logs at warn: `LETSVIEW_HOST <host> is not loopback: every machine that reaches it can read signals and change the workspace`. For a wildcard host the warning adds that only loopback names pass the Host check.
- The Vite proxy needs no change: it forwards `Host: localhost:5173` and `Origin: http://localhost:5173`, both allowed. `changeOrigin` stays off.
- Alternatives: CORS headers alone (do not cover WebSockets or DNS rebinding); a token in the page (needs a login flow; out of scope for a local tool).

### H4: Limits (pinned, `packages/shared/src/workspace.ts`, `apps/server/src/app.ts`)

```ts
export const MAX_WINDOWS = 64;
export const MAX_RENDER_ERRORS = 50;
export const MAX_RENDER_ERROR_LENGTH = 500; // characters per message
// RenderError: windowId, signalId z.string().max(200); message z.string().max(MAX_RENDER_ERROR_LENGTH)
// RenderedMessage.errors: z.array(RenderError).max(MAX_RENDER_ERRORS).optional()
// CommandErrorCode gains "window_limit" and the client-only "network" | "bad_response" (never sent by the server)
```

- `apply.ts` `window.create` (both kinds) fails with `window_limit` when `state.windows.length >= MAX_WINDOWS`.
- `app.ts`: `app.register(websocket, { options: { maxPayload: 262_144 } })` (256 KiB). Worst acknowledgement: 50 × (500 + 2 × 200 characters at up to 3 UTF-8 bytes + ~60 bytes of keys) ≈ 138 KB < 256 KiB. The lead suggested ~64 KiB; that would cut valid non-ASCII acknowledgements, so 256 KiB.
- Off by ×2: 32 windows still exceed any screen; 128 still bounds memory. 25 errors still name every failing signal of a typical outage (4 windows × 8 signals = 32 is cut, status stays `error`); 100 errors stay under 256 KiB only for ASCII. 128 KiB frames would reject a worst-case non-ASCII acknowledgement; 512 KiB is harmless.

### H5: Catalog background load (pinned, `apps/server/src/catalog.ts`)

```ts
export interface CatalogLog { warn(message: string): void }
// constructor(source, loadMetadata: (warn: (message: string) => void) => Promise<Map<string, DbcSignal>>, rules = NO_RULES, log?: CatalogLog)
// refresh(): while a refresh runs, further calls return the same promise (single flight).
//   Each run passes a fresh `warn` to loadMetadata that calls log.warn(`DBC file skipped: ${message}`).
export const CATALOG_RETRY_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const; // last one repeats
/** Refreshes now and after each failure (delays above) until the catalog has loaded once; returns stop(). */
export function keepCatalogLoaded(
  catalog: Catalog,
  events: { loaded(): void; failed(error: unknown, retryInMs: number): void },
): () => void;
```

- `main.ts` drops `dbcWarnings` and `loadCatalog`; after `listen` it calls `keepCatalogLoaded` with `loaded` logging the size and `warnDisplayFallbacks`, and `failed` logging the error and the delay. The refresh route is unchanged; its warnings now reach the log through `CatalogLog`.
- Same sequence as D-044's series retry, so one rule to remember. Off by ×2: a 60 s cap delays the first catalog after the 23:00 reboot by up to a minute; 15 s doubles idle load on a dead source (one `SELECT DISTINCT` per 15 s, negligible).

### H6: Web failure handling (pinned, `apps/web/src`)

- `api.ts` `sendCommand(command): Promise<CommandResult>` never rejects. A rejected `fetch` → `{ok:false, code:"network", message}`. Status 200, 400 or 422 with a body that is a `CommandResult` (object; `ok` boolean; `revision` number when ok; `code` and `message` strings when not) → that body. Anything else → `{ok:false, code:"bad_response", message: "HTTP <status>: <statusText>"}`. `App.command` shows it as today. Callers' types do not change.
- `live.ts`: `send(message): boolean` (true only when the socket was open and `send` did not throw). `LiveState` gains `rangeSets: number`; `export function applyLiveMessage(state: LiveState, message: LiveServerMessage): LiveState` holds the `onmessage` logic and increments `rangeSets` for `state` messages with `command === "window.setRange"`.
- New `ack.ts` (App's acknowledgement logic, testable without React):

  ```ts
  export class Acknowledger {
    constructor(send: (message: RenderedMessage) => boolean);
    setState(revision: number, windowIds: readonly string[]): void; // from the live state; then tries to send
    report(windowId: string, revision: number, errors: RenderError[]): void; // a window's onReady; then tries to send
    reconnected(): void; // live channel opened: forget the last sent key, try to send
  }
  ```

  It sends when every window reported the current revision and `JSON.stringify([revision, errors])` differs from the last key that `send` accepted (D-044, archived R5); errors are the first `MAX_RENDER_ERRORS`, each message cut to `MAX_RENDER_ERROR_LENGTH`. `App.tsx` keeps one instance in a ref and calls `reconnected()` when `live.connected` turns true.
- New `WindowBoundary.tsx`: class component, props `{windowId, revision, onReady, children}`, state `{error?: string}`. `getDerivedStateFromError` stores the message; `componentDidCatch` and `componentDidUpdate` (revision changed while failed) call `onReady(windowId, revision, [{windowId, message: \`render: ${message}\`}])`. It renders `<div class="window window-failed">Window failed to draw: {message} <button>Retry</button></div>`; Retry clears the error. `App.tsx` wraps each item of the window list.

### H7: Requests follow content and range commands (pinned)

- Shared: `export type CommandType = Command["type"]`; `LiveServerMessage` `state` gains `command?: CommandType`.
- Server `workspace.ts`: listener `(revision, workspace, command: CommandType) => void`; `execute` calls each listener in its own `try/catch` and passes errors to `options.onListenerError` (constructor `(ctx, options?: { onListenerError?(error: unknown): void })`, default `console.error`). `routes/workspace.ts` sends `command` in pushes; `main.ts` passes `app.log.error`.
- Web `chart/loader.ts`: `export function loadKey(signals: readonly {id: string; signalId: string}[], rangeSets: number): string`. `TimeseriesWindow` gets prop `rangeSets` from App (`live.rangeSets`) and memoizes `requests` on `[loadKey(w.signals, rangeSets), viewFrom, viewTo, target, width]` and `committedRequests` on the signals part of the key. A `window.setRange` of any window (linked windows move together) hands every window's requests to its loader again, so a failed identical request retries (D-042 (1)); other revisions do not.
- Alternative: compare window content only. Rejected: a range command that leaves the range unchanged would no longer retry, against D-042 (1).

### H8: Small items

- **Height drag** (`chart/height.ts`): `export function trackHeightDrag(handle: EventTarget, h: { move(clientY: number): void; end(): void; release(): void }): () => void`. `pointermove` → `move`; the first of `pointerup`, `pointercancel`, `lostpointercapture` → `release()` then `end()`, listeners removed; the returned dispose → `release()` if not yet, listeners removed, never `end()`. `TimeseriesWindow` keeps the dispose in a ref and calls it on unmount; `end` sends the height command as today.
- **File drops** (`filedrop.ts`): `export function ignoreFileDrops(target: EventTarget): () => void`; on `dragover` and `drop` whose `dataTransfer.types` contains `Files`, `preventDefault()`, and `dropEffect = "none"` on `dragover`. Signal drags are pointer-based, not HTML drag and drop, so they are unaffected. `App.tsx` installs it on `document` in an effect.
- **Title on create** (`apply.ts`): trim; empty → no `title`, both kinds.
- **Extent abort** (`routes/series.ts`): same `AbortController` and `close` listener as `/api/series`, passed to `source.extent(ref, signal)`; an aborted request sends nothing.

### H9: Recovery pulls forward once per run of failures (needs Jan, Q1)

- `cache.ts`: `onRecover(listener: (reason: "success" | "reconnect") => void)`; the wrapped fetch notifies `"success"`, `recover()` notifies `"reconnect"`.
- `loader.ts`: the failure record gains `pulled?: true`. On `"success"`, a key with `pulled` is skipped; otherwise it is scheduled at `max(now, at + RETRY_FLOOR_MS)` as today and marked `pulled`. On `"reconnect"`, every retryable failed key is scheduled as today, `pulled` or not. `complete` deletes the record, so the next run starts fresh. Backoff, floor and the same-request trigger are unchanged.
- Effect: during an outage nothing succeeds, so the first success after it pulls every failed signal forward, as D-042 (1) intends. A signal with its own persistent error (ClickHouse memory limit or timeout on one heavy query, answered 502) is pulled once, then follows 1, 2, 4 … 30 s instead of about one fetch per second while the user zooms other windows.
- Alternatives: (a) pull forward only transient errors (network, 503, 504), with the server answering 503 `source_unavailable` for connection failures and 502 for query errors; needs a server-side classification and still pulls a query error that ClickHouse reports as a connection reset. (b) Keep as is (D-044 literal): about 1 request/s per persistently failing signal during interaction, bounded by the 1 s floor.

## Risks / Trade-offs

- [Host guard locks out a legitimate setup, e.g. Vite started with `--host` and opened by LAN IP] → the 403 names the host; setting `LETSVIEW_HOST` to that address admits it. Logged in the start-up warning.
- [`@fastify/websocket` skips `onRequest` on upgrade] → fallback check in the handler (H3); the scenario covers both.
- [`positiveModulo` returns UInt64 and the subtraction changes type] → `toInt64` cast; the epoch scenario on the test DB catches it.
- [Adding `spancar` to the seed changes catalog counts in existing tests] → its own data reference, so `testcar` counts stay; the tester adjusts any test that counts all signals.
- [Q1 declined] → drop task 3.2's H9 part and the two new scenarios of "Retry at once on recovery"; the rest of the change does not depend on it.
- [Old tabs after the deploy] → hot reload keeps old modules (Known limitation); reload once.

## Migration Plan

No stored data changes. Deploy with the usual restart; reload open tabs. Rollback: revert the change; no data to migrate back.

## Manual checks (lead)

1. Tunnel down, server restart, tunnel up after 20 s: catalog loads within 35 s without a refresh (signal-catalog "Restart with the tunnel down").
2. Server restart with the UI open, then `letsview --wait link off` exits 0 `complete` (workspace-state "Wait after a server restart on real data").
3. Server stopped, rename a window: message line shows the error, no unhandled rejection in the console (workspace-state "Server down in the UI").

## Ledger entries on archive (proposed for `docs/decisions.md`)

- **D-045: Exact wire times and bucket bounds.** Series offsets travel as JSON numbers up to 2^53 − 1 ns and as decimal strings beyond (supersedes D-011 D3's "offsets as numbers"); bucket width at most 2^62 ns; buckets on the floor grid before 1970; own computation errors answer 400. (H1, H2)
- **D-046: Local access only.** `Host` and, when present, `Origin` must name localhost, 127.0.0.1, [::1] or a non-loopback `LETSVIEW_HOST`; JSON bodies only; live frames ≤ 256 KiB; acknowledgements ≤ 50 errors of ≤ 500 characters; ≤ 64 windows; warning on a non-loopback host. (H3, H4)
- **D-047: Robustness conventions.** Catalog reloads 1, 2, 4 … 30 s until its first success, one load at a time, DBC warnings per load; UI commands never reject (`network`, `bad_response`); an acknowledgement counts as sent only when the socket took it and is repeated after a reconnect; state pushes name their command type and only content changes or `window.setRange` re-hand requests to the loader; a window that fails to draw shows an error box and reports a render error. (H5–H8; H9 if Jan agrees to Q1)

## Open Questions

- **Q1 (Jan): May a success of another request pull a failing signal forward only once per run of failures?** D-044 says „A success of any series request in the tab … retries at once, never sooner than 1 s after the last failure", and the archived design R3 accepted that a signal that keeps failing is fetched about once a second while others succeed. The review counts that as a fault (finding 5). Recommended: once per run (H9); the outage case Jan described in D-042 behaves as before. If Jan says no, task 3.2 drops its H9 part and the spec keeps D-044's wording.
