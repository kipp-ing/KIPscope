# Tasks

Every task has its own files; all build in one round against the interfaces pinned in design H1–H9. Group 1 lands types the others import; engineers of groups 2 and 3 may stub them until it is in. The tester writes group 4 test-first, in parallel. Group 5 is root tooling, group 6 the lead's.

- 1.1: `packages/shared/src/encoding.ts`, `workspace.ts`, `apply.ts`, `index.ts`
- 2.1: `apps/server/src/series.ts`, `clickhouse.ts`, `routes/series.ts`, `catalog.ts`, `workspace.ts`
- 2.2: `apps/server/src/access.ts` (new), `app.ts`, `main.ts`, `routes/workspace.ts`
- 3.1: `apps/web/src/api.ts`, `live.ts`, `ack.ts` (new), `filedrop.ts` (new), `WindowBoundary.tsx` (new), `App.tsx`, `styles.css`
- 3.2: `apps/web/src/chart/cache.ts`, `chart/loader.ts`, `chart/tiles.ts`
- 3.3: `apps/web/src/chart/TimeseriesWindow.tsx`, `chart/height.ts`
- 4.1: `packages/shared/test/*`, `apps/server/test/*` (incl. new `globalSetup.ts`), `apps/server/vitest.config.ts`, `apps/server/scripts/seed-test-db.ts`
- 4.2: `apps/web/test/*`
- 5.1: `package.json`, `apps/server/package.json`, `pnpm-lock.yaml`, `README.md`
- 5.2: `scripts/tunnel.sh`

Jan agreed to Q1 (2026-10-16): task 3.2 includes H9.

## 1. packages/shared

- [x] 1.1 Wire times, limits, live message (H1, H4, H7, H8):
  - `encoding.ts`: `EncodedTimes.dt: (number | string)[]`; `encodeTimes` never throws; `decodeTimes` per H1; new `assertSeries`.
  - `workspace.ts`: `MAX_WINDOWS`, `MAX_RENDER_ERRORS`, `MAX_RENDER_ERROR_LENGTH`; `RenderError` and `RenderedMessage` bounds; `CommandErrorCode` gains `window_limit`, `network`, `bad_response`; `CommandType`; `LiveServerMessage` `state.command?`.
  - `apply.ts`: `window.create` refuses the 65th window with `window_limit` and trims its title (both kinds).
  - Verify: scenarios "Round trip over the full bounds", "Malformed offsets refused", "65th window", "Blank and padded titles", "Server ignores oversized acknowledgements".

## 2. apps/server/src

- [x] 2.1 Series, catalog, store (H2, H5, H7, H8):
  - `series.ts`: `MAX_BUCKET_WIDTH`, capped `bucketWidth`.
  - `clickhouse.ts`: bucket start on the floor grid.
  - `routes/series.ts`: `RangeError` → 400 `invalid_request`; `/api/extent` aborts on client close.
  - `catalog.ts`: `loadMetadata(warn)`, `CatalogLog`, single-flight `refresh`, `CATALOG_RETRY_MS`, `keepCatalogLoaded`.
  - `workspace.ts`: listener gets the command type; each listener in its own `try/catch` → `onListenerError`.
  - Verify: scenarios "Raw points more than 104 days apart", "Width cap", "Full bounds over HTTP", "Buckets around the epoch", "Computation error", "Client disconnects", "Source down at start", "Refresh during a load", "Two loads with one bad file", "Throwing listener".
- [x] 2.2 Access guard and wiring (H3, H4, H5, H7):
  - `access.ts`: `isLoopbackHost`, `hostAllowed`, `originAllowed`.
  - `app.ts`: `extraHost` option; root `onRequest` guard (403 `forbidden_host` / `forbidden_origin`); `text/plain` parser removed; websocket `maxPayload` 262,144.
  - `routes/workspace.ts`: pushes carry `command`; fallback Origin/Host check in the `/api/live` handler only if the hook does not cover the upgrade (H3).
  - `main.ts`: `extraHost` from `KIPSCOPE_HOST`; non-loopback warning; `keepCatalogLoaded` replaces `loadCatalog` and `dbcWarnings`; `CatalogLog` and `onListenerError` go to `app.log`.
  - Verify: every scenario of `server-access`, "Push after a range command"; `grep -n "isLoopbackHost" apps/server/src/main.ts` prints the warning's condition.

## 3. apps/web/src

- [x] 3.1 Commands, acknowledgement, boundary, file drops (H6, H7, H8):
  - `api.ts`: `sendCommand` never rejects (`network`, `bad_response`).
  - `live.ts`: `send` returns boolean; `LiveState.rangeSets`; exported `applyLiveMessage`.
  - `ack.ts`: `Acknowledger`; `App.tsx` uses it instead of `ready`/`lastSent`/`acknowledge` and calls `reconnected()` when `live.connected` turns true.
  - `WindowBoundary.tsx`; `App.tsx` wraps each window and passes `rangeSets={live.rangeSets}` to `TimeseriesWindow`.
  - `filedrop.ts`: `ignoreFileDrops`; `App.tsx` installs it on `document`. `styles.css`: `.window-failed` box in the window's place.
  - Verify: scenarios "Network failure and proxy page", "Settled while disconnected", "Same report not repeated", "UI caps its acknowledgement", "Boundary catches and reports", "Every window is wrapped", "File drag on the document", "Range count from the live channel"; UI check "Through the dev proxy on real data".
- [x] 3.2 Loader and cache (H1, H6, H7, H9):
  - `tiles.ts`: `tileable` without `MAX_SPAN`.
  - `cache.ts`: wrapped fetch calls `assertSeries` before notifying; `onRecover` listeners get `"success"` or `"reconnect"`.
  - `loader.ts`: `loadKey`. `pulled` per failure record; `"success"` pulls a key forward once per run, `"reconnect"` always.
  - Verify: scenarios "A 200-day view is tileable", "Exact view with a malformed answer", "Tiled view with a malformed answer", "Load key"; "A signal that keeps failing is pulled forward once", "Reconnect pulls forward again"; the existing "Another request succeeds", "Floor of 1 s" and "Live channel reconnects" tests stay green.
- [x] 3.3 Window (H7, H8):
  - `height.ts`: `trackHeightDrag`; `TimeseriesWindow.tsx` uses it and disposes it on unmount.
  - `TimeseriesWindow.tsx`: prop `rangeSets`; `requests` memo on `loadKey(w.signals, rangeSets)` plus view, target, width; `committedRequests` on the signals part.
  - Verify: scenario "Lost capture and unmount"; `grep -n "loadKey(" apps/web/src/chart/TimeseriesWindow.tsx` prints the memo; UI check: dragging the corner grip still resizes and the height stays after release.

## 4. Tests

- [x] 4.1 Shared and server tests, seed, test setup:
  - One test per evidence name in the delta specs for `packages/shared/test` and `apps/server/test`; replace `encoding.test.ts` "rejects offsets beyond 2^53 ns" with the two new encoding tests.
  - `seed-test-db.ts`: data reference `spancar`, signal `Span_910h.FAR` with points at 1969-12-31T23:59:58.5Z, 23:59:59.5Z, 1970-01-01T00:00:00.5Z, 2026-01-01T00:00:00Z, 2026-10-01T00:00:00Z; adjust any test that counts all signals. Seed guard: refuse when `TEST_CLICKHOUSE_URL` and `CLICKHOUSE_URL` have the same port and the same host, where `localhost`, `127.0.0.1` and `[::1]` count as one host.
  - `test/globalSetup.ts` + `vitest.config.ts` `globalSetup`: load `.env` like `setup.ts`, ping the test ClickHouse and check that `spancar/Span_910h.FAR` exists; otherwise fail once with: `test ClickHouse at <url> is not reachable or not seeded: run \`docker compose up -d\` and \`pnpm --filter @kipscope/server seed:test\``.
  - Verify: `pnpm --filter @kipscope/shared test` and `pnpm --filter @kipscope/server test` green after 1.1, 2.1, 2.2; with the test ClickHouse stopped, `pnpm --filter @kipscope/server test` prints that message once and exits non-zero.
- [x] 4.2 Web tests: one test per evidence name in the delta specs for `apps/web/test` (new files `ack.test.ts`, `boundary.test.ts`, `filedrop.test.ts`, `livestate.test.ts`; additions to `api.test.ts`, `loader.test.ts`, `tiles.test.ts`, `height.test.ts`). Include the two Q1 tests (no `it.skip`). Verify: `pnpm --filter @kipscope/web test` green after 3.1–3.3.

## 5. Root tooling

- [x] 5.1 `apps/server/package.json`: `yaml` to 2.8.3 or later, test script `TZ=Europe/Berlin vitest run --passWithNoTests`; `pnpm install` updates the lockfile; root `package.json` script `check`: `pnpm build && pnpm lint && pnpm test`; README: `pnpm check`, and `KIPSCOPE_SERVER_URL` (Vite proxy target, default `http://127.0.0.1:7310`). Verify: `grep -c "yaml@2.8.1" pnpm-lock.yaml` prints 0; `pnpm check` exits 0.
- [x] 5.2 `scripts/tunnel.sh`: `keeper_pid` accepts the PID file only when `ps -o command= -p <pid>` contains `tunnel.sh run`; otherwise it removes the stale PID file and reports `not running`. Verify (only while no keeper runs): `sleep 300 & echo $! > "$TMPDIR/kipscope-tunnel.pid"; scripts/tunnel.sh stop; kill -0 $!` prints `not running` and the `sleep` is still alive (`kill -0` exits 0); `scripts/tunnel.sh status` then prints `keeper not running`.

## 6. Lead

- [x] 6.1 Manual checks of design "Manual checks (lead)": "Restart with the tunnel down", "Wait after a server restart on real data", "Server down in the UI".
