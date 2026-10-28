# Proposal

## Why

On carserver, smart451 holds 768 M rows (17 days, about +50 M a day), and scans over the whole recording now pass ClickHouse's 30 s limit: the logger-gap scan and the density buckets end in `TIMEOUT_EXCEEDED`, `count/min/max` over the vehicle takes 19.5 s, and `/api/gaps`, `/api/density` and `/api/value` answer 502. So the app shows "Recording unavailable" and `pnpm smoke` fails (T-15, docs/todo.md). Jan decided the direction (D-117): „der datensee wird bald TBs haben"; „im see stochern über alles ist ja quatsch". KIPscope never scans a source's whole data. Every raw query is bounded by a scope, and the overview of a vehicle comes from the search tool's catalog. Chunking and caching would only move the wall back.

## What Changes

- **BREAKING (config):** `KIPSCOPE_CATALOG` defaults to `scoped`. `full` stays as an explicit opt-in that is only for small sources (test DB, demo); the docs say so. Jan's local dev server and `pnpm smoke` run scoped.
- **Scan bound:** every request that scans a data ref over a range (signal list, density, gaps, the calendar of a plain scope, extent of the data ref, series of one signal) is first checked against a span bound (`KIPSCOPE_SCAN_SPAN`, default 2 d, no query) and a row budget (`KIPSCOPE_SCAN_ROWS`, default 150 M rows; one cached `refCount` of the range). A request over either bound gets 422 `too_wide` within about a second, never a 502 after 30 s. The same holds in full mode.
- **Too wide is visible** (concept §10): the strip, a timeseries window, a cursor value cell, the range picker, the explorer and the CLI each show the `too_wide` text. A `scope.set` (or Widen, or `view.open`) whose signal list would be too wide is refused with the workspace unchanged.
- **No whole-recording gap info:** value and series take their gap info from the scope (or the work window in an object scope), and that gap info is itself within the bound. The 5-min recheck counts only the scopes and work windows of open workspaces. In full mode only data refs within the bound are prefetched and polled.
- **Vehicle level from the catalog** (D-117): Unlink takes the vehicle's span from the open catalog's sessions of that vehicle; it runs no extent query. The strip over an object scope draws the catalog's session marks plus the detail drives of the work window; the coarse density over the whole vehicle goes away. The work window is capped at the span bound (was 32 d). While unlinked, the signal list is the last linked session's list (`partial: true`); no list is loaded for the whole vehicle.
- **Calendar day by day** (D-118, amends D-117): the range picker's calendar may still cover a vehicle's months. It is counted one vehicle-day per query, in a new lowest query class `idle` (below `preload`, at most one in flight, never beside an interactive query). Counted days are kept in the state directory across restarts: past days are final, and today is counted again every 5 min. The months the picker would show are counted ahead for the open workspaces' vehicles. Days not counted yet are marked in the calendar and fill in while it is open.
- **Start without a scope:** in scoped mode a workspace without a scope shows a Start card in the window area. It has a scope form (data ref, from, to) that sends `scope.set`, a link to open a catalog, and the CLI forms. `kipscope case drives REF FROM TO` builds a catalog from bounded per-day densities (at most 32 days), so Jan has a local way to get sessions without the search tool.
- `pnpm smoke` sets a scope first (`--scope REF FROM TO`, default one day of smart451) and passes twice in a row against the scoped dev server.
- No change to the source contract (`docs/data-sources.md` adapters: ClickHouse, ADX, fallbacks). Every call the server now makes already exists with a `scope` argument.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `scope`: catalog modes (scoped default, full opt-in), the scan bound and `too_wide`, a too-wide `scope.set` refused, the Start card, real-data runs in a scope.
- `object-view`: Unlink extent from the catalog's sessions, the work window capped at the span bound, no coarse vehicle density, the session's signal list while unlinked, bounded queries with no `refExtent`.
- `time-strip`: density within the scan bound (also full mode), the too-wide strip state, the strip over an object scope (sessions and work-window drives), the carserver cost measured in a scope.
- `data-gaps`: gap info within the scan bound, value and series never waiting for whole-recording gap info, the poll only over open scopes and windows, the smart451 scenarios run in a scope.
- `range-picker`: the calendar of a plain scope within the scan bound; unlinked or without a scope from vehicle-days counted at `idle`, kept across restarts, filled ahead, with days not counted yet marked and filling in; cost measured.
- `series-query`: series of one signal within the row budget; the value answer when its gap window is too wide.
- `cli`: `case drives REF FROM TO` from bounded per-day densities; `too_wide` exit and message.

## Impact

- `apps/server`: `config.ts` (mode default, two new variables), `priority.ts`/`queue.ts` (class `idle`), a new day store `calendarDays.ts` (files under `KIPSCOPE_STATE_DIR/calendar/`), a new scan-bound module used by the density, gaps, calendar, catalog-list, extent and series paths. Other server files: `routes/series.ts`, `density.ts`, `gaps.ts`, `calendar.ts`, `catalog.ts`/`scope.ts` (list load), `objectScope.ts` and the case routes (Unlink extent, work window), and `routes/meta` (limits in `/api/meta`).
- `packages/shared`: `ApiError` code `too_wide` with its details, `MetaLimits` in the meta payload, the `workWindow` cap as a parameter, and the `scope.set` refusal code.
- `apps/web`: Start card, too-wide texts on strip, window, value cell, picker and explorer; the object-scope strip without the coarse density; the work window from the meta limits.
- `apps/cli`: `case drives REF FROM TO`; `too_wide` exit code 1 with the message.
- Tests: the server test helpers pin `catalog: "full"` explicitly where they rely on it. New tests for the bound, Unlink without extent, the Start card and drives by day.
- `scripts/smoke.mjs`: sets the scope before it checks.
- Docs: `docs/data-sources.md` (modes, bound), `docs/http-api.md` (`too_wide`, limits), README (local start with a scope), `docs/status.md` by the lead.
- carserver: no DDL, no materialized view. All limits on the ClickHouse side (`max_execution_time` 30 s, `max_threads` 4, `readonly=2`) stay as they are.
