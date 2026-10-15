# Proposal

## Why

A four-agent review of the running app (2026-10-15) found a set of small faults that each can break a session: a wire format that fails for spans over 2^53 ns (~104 days), a server that any web page can read and steer, a catalog that never loads when ClickHouse is down at start, silent command failures in the UI, and an acknowledgement that a reconnect loses. None is visible on today's data (4.3 days on carserver), but all of them are time bombs or need only a restart at the wrong moment (`--watch`, carserver's 23:00 reboot, D-042). Jan approved a hardening pass before persistence: „I trust your opinion". The technical calls are the lead's (design H1–H9).

## What Changes

- **Exact times for any span:** series results encode time offsets as JSON numbers while they are exact and as decimal strings beyond 2^53 ns, so every range within the time bounds (1900–2262) answers. The bucket width is capped at 2^62 ns (it overflowed Int64 for the full bounds at target 2), and buckets before 1970 lie on the same floor grid the web's tiles use. Views and overviews longer than 104 days use tiles like shorter ones. A request the server cannot answer because of its own computation gets 400, never a retryable 5xx. (Finding 1)
- **Local access only:** the server accepts only `localhost`, `127.0.0.1` and `[::1]` (any port) as `Host`, plus `LETSVIEW_HOST` when it is not loopback, and only those hosts as `Origin` when a request carries one; the live WebSocket too. Bodies are JSON only; live frames are limited to 256 KiB, render acknowledgements to 50 errors of at most 500 characters; a workspace holds at most 64 windows. A non-loopback `LETSVIEW_HOST` logs a warning at start. (Finding 2)
- **Catalog loads by itself:** while the catalog has never loaded, the server retries after 1, 2, 4, 8, 16, then every 30 s; a manual refresh joins a running load. DBC warnings are logged on every load, and nothing accumulates. (Finding 3)
- **Failed commands are shown:** a command the UI sends never rejects; network failures and non-JSON answers become a failed result shown in the existing message line. (Finding 4)
- **Recovery pulls a failing signal forward once per failure streak** (needs Jan, design Q1): today every success in the tab pulls every failing signal forward, so one signal with a persistent error is fetched about once a second while the user works. (Finding 5)
- **Acknowledgement survives a reconnect:** an acknowledgement that could not be sent is not marked as sent, and the UI acknowledges the current revision again after the live channel opens. (Finding 6)
- **Small fixes (finding 7):** height drag ends cleanly on lost pointer capture and unmount; each window has an error boundary, and a malformed series answer becomes `failed` instead of a blank app; a file dropped on the page no longer navigates away; a failed signal is requested again only when its request changes or a range command arrives, not on every revision; `window.create` trims its title like rename; a throwing workspace listener no longer fails a command; `/api/extent` aborts when the client goes away.
- **Tooling:** `yaml` ≥ 2.8.3 (GHSA-48c2-rrv3-qjmp); root `pnpm check` (build, lint, test); server tests run with `TZ=Europe/Berlin` and stop at once with one clear message when the test ClickHouse is down or not seeded; the seed guard compares URLs by host and port; `scripts/tunnel.sh stop` kills only its own keeper; README documents `LETSVIEW_SERVER_URL`.

**Out of scope:** persistence and a versioned workspace schema (next change); refactors of `TimeseriesWindow` and `App` beyond the small extractions the design pins; time-weighted mean; the Known limitations in `docs/status.md` except where fixed above (for example `/api/value` stays without retry); authentication or TLS; a configurable host allowlist beyond `LETSVIEW_HOST`; any new UI element besides the window's error box.

## Capabilities

### New Capabilities

- `server-access`: which hosts and origins may use the HTTP API and the live channel, JSON-only bodies, the live frame limit, the start-up warning.

### Modified Capabilities

- `series-query`: exact times for any span, capped bucket width, floor grid before 1970, 400 for unanswerable requests, extent aborts on disconnect.
- `series-cache`: long views tile; "Retry at once on recovery" once per failure streak (Q1); a malformed answer fails the load.
- `signal-catalog`: background load until the first success, single-flight refresh, DBC warnings per load.
- `workspace-state`: window limit, trimmed title on create, isolated listeners, state pushes name their command type, bounded and reconnect-safe render acknowledgements, failed commands shown in the UI.
- `timeseries-window`: error boundary per window, height drag cleanup, page ignores dropped files, no reload on unrelated revisions.

## Impact

- `packages/shared`: `encoding.ts` (`EncodedTimes.dt: (number | string)[]`, `assertSeries`), `workspace.ts` (`MAX_WINDOWS`, `window_limit`, render caps, `state.command`), `apply.ts`.
- `apps/server/src`: new `access.ts`; `app.ts`, `config.ts`, `main.ts`, `catalog.ts`, `series.ts`, `clickhouse.ts`, `workspace.ts`, `routes/*.ts`.
- `apps/web/src`: `api.ts`, `App.tsx`, `live.ts`, new `ack.ts`, `filedrop.ts`, `WindowBoundary.tsx`; `chart/loader.ts`, `chart/cache.ts`, `chart/tiles.ts`, `chart/height.ts`, `chart/TimeseriesWindow.tsx`.
- Tests in all three packages; seed data gains one signal on a new data reference `spancar`.
- Root tooling: `package.json`, `apps/server/package.json`, `pnpm-lock.yaml`, `apps/server/vitest.config.ts`, `README.md`, `scripts/tunnel.sh`.
- Wire compatibility: an old web build reading a new answer works for spans under 104 days (offsets stay numbers); no CLI change is needed (the CLI never reads series).
