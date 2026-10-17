# Design

## Context

Empty repo. Fixed so far: own build (D-004), server + browser with server-held state (D-005), ClickHouse first (D-006). Requirements are in this change's specs; background in [docs/concept.md](../../../docs/concept.md). Hard constraints that shape the approach:

- Up to 7.2 M points per signal over 10 h; database latency is a given (concept §2).
- Timestamps down to nanoseconds; signals have unrelated sampling times.
- The CLI (next change) must drive the same open view, so the command path has to exist from day one.
- The data lives in ClickHouse `sdlog` on carserver (as of 2026-10-14): table `signals (vehicle, device, chunk, signal, utc Nullable(DateTime64(3,'UTC')), value Float64)`, `ORDER BY (vehicle, signal, utc)`; 88 M rows, 428 signals, one vehicle `smart451`, ~10 % rows with null `utc`. Signal names are `<DBC message>.<DBC signal>`. No metadata tables.
- carserver: 2 GB RAM, ClickHouse bound to localhost, per-query limit 512 MiB, 4 threads, 8 concurrent queries server-wide (shared with the decoder).

## Goals / Non-Goals

**Goals:**
- One language and one type system for commands, state and data shapes across server and browser.
- An architecture the later changes (cursors, CLI, undo, persistence, ADX) extend rather than replace.

**Non-Goals:**
- Performance tuning beyond keeping transferred data proportional to window width.
- Multi-user or concurrent editing; one open workspace per server.
- Authentication; the server is assumed to run in a trusted environment for now.

## Decisions

### D1: TypeScript everywhere, pnpm monorepo

Layout: `packages/shared` (time type, command and state types, query DTOs), `apps/server`, `apps/web`. Node ≥ 22, pnpm workspaces, Vitest for tests.

- Server: Fastify with `@fastify/websocket`, `@clickhouse/client`, Zod for validating commands and query parameters.
- Web: Vite + React; uPlot for charts.

Alternatives: Python server (good data tooling, but the command model would be duplicated across two type systems — the command model is the core of the product); Go/Rust server (speed is not the bottleneck, the database is).

### D2: uPlot for time-series rendering

uPlot draws hundreds of thousands of points on canvas, supports step paths, point markers and filled bands (envelope), and allows custom axis tick labels. Alternatives: ECharts (heavier, less control over axes), Plotly (too slow at this size), custom WebGL (only if uPlot proves too slow — not expected with ≤ 50 × ~2,000 buckets).

### D3: Time as int64 nanoseconds, rendered relative to an origin

- Canonical timestamp: nanoseconds since Unix epoch as `bigint` (`Timestamp` in `packages/shared`). In JSON it travels as a decimal string.
- Series payloads carry `t0` (string) plus `dt[]` offsets in nanoseconds as numbers. Offsets stay exact while below 2⁵³ ns (~104 days); query ranges are hours.
- uPlot gets x = offset from a per-window origin as float64, so sub-microsecond positions are exact. Tick labels are formatted from `bigint` (date/time part via `Intl` in local time, fractional seconds by integer arithmetic).

Alternative: float64 milliseconds since epoch — loses precision below ~0.2 µs and is used by most chart libraries by default; rejected because the concept requires original precision.

### D4: Raw vs. aggregated decided by a count query

For a request (signal, [from, to), target N):

1. `count()` of points in range (cheap: table is ordered by `(signal_id, ts)`).
2. If count ≤ N: return raw points plus the last point before `from` and the first at/after `to` (two `LIMIT 1` queries).
3. Otherwise: bucket width `w = ceil((to − from) / N)` ns; group by `intDiv(ts, w)` — buckets aligned to the absolute time grid, not to `from`, so they stay stable while panning. Return start, end, count, `avg`, `min`, `max` per non-empty bucket.

The mean is the plain arithmetic mean of the samples (as stated in the series-query spec). A time-weighted mean for irregular sampling is concept open item §13 and would be a later spec change. Alternative: always aggregate and let the client decide — wastes a round trip when zoomed in and cannot return edge neighbors.

### D5: Long-format table via configurable mapping

The adapter reads one long-format table. Server config names the table and its columns: data reference (`vehicle`), signal name (`signal`), timestamp (`utc`), value (`value`). The default mapping is `sdlog.signals`. Every query filters `utc IS NOT NULL` and on `(vehicle, signal)`, which is the table's sort-key prefix, so range scans stay cheap. Timestamps are read with `toUnixTimestamp64Nano(utc)` regardless of the column's precision.

Signal ID: `<vehicle>/<signal>`, e.g. `smart451/ENG_2E8h.MOT_SPD_D`.

The catalog is built at server start from `SELECT DISTINCT vehicle, signal` (428 rows, 0.35 s on carserver; filtering out null `utc` there costs 8 s, so a signal with only null-timestamp rows would be listed but show no data), merged with DBC metadata (D6) and held in server memory; search runs there, case-insensitive across name, description, alias and unit, paged with a more-results flag. A refresh endpoint/command reloads it when new signals appear. This is metadata, not a data cache, so it doesn't conflict with concept §2.

The adapter implements a `DataSource` interface of source primitives (`listSignals`, `count`, `raw`, `before`, `after`, `buckets`) that the ADX adapter will implement too; the raw-vs-aggregate logic (D4) sits above it and is shared.

Alternative: catalog search with `ILIKE` in ClickHouse — rejected because metadata comes from DBC files, not the database, and a `DISTINCT` over 88 M rows per keystroke would load the small server.

### D6: Signal metadata from DBC files

Config lists DBC files (default: `CarController/vehicles/smart451/dbc/h-can.dbc` and `hybrid-can.dbc`). The server parses them at start (ISO-8859-1, CRLF): `BO_` message names, `SG_` units, `CM_ SG_` comments as description. Lookup key is `<message>.<signal>`, matching how the decoder names signals. If several files define the same key, the first file in config order wins. Alias stays absent (no source yet). Value tables (`VAL_`, 195 in h-can) are parsed but only used once state signals are supported.

A small purpose-built parser instead of a library: only three line types are needed, and the npm DBC parsers are thinly maintained.

### D7: Bounded query concurrency

The server runs data-source queries through a queue with a configured concurrency limit (default 4, half of carserver's server-wide 8, leaving room for the decoder). A query whose client request was aborted is dropped from the queue before it runs. A running one gets the abort signal, which closes its HTTP request; with `cancel_http_readonly_queries_on_client_close` plus progress headers every 100 ms (`send_progress_in_http_headers`) ClickHouse notices the closed connection and cancels the query (verified: without progress headers it kept running). `KILL QUERY` by ID was rejected: it needs `SELECT` on `system.processes` for the read-only user. Query IDs carry a `kipscope-` prefix for tracing. Queries set `max_execution_time` to fail fast instead of piling up.

### D8: Commands over HTTP, state over WebSocket

- `POST /api/commands` — validates and applies one command, returns `{ok: true, revision}` or `{ok: false, code, message}`. This is the endpoint the CLI will use.
- `GET /api/workspace` — state + revision.
- `GET /api/series`, `GET /api/signals` — data access.
- `WS /api/live` — server pushes `{revision, state}` after each accepted command; browsers send `{rendered: revision, status: "complete" | "error", errors?}`.
- `GET /api/render-status` — latest rendered revision per connected browser.

Commands are a discriminated union in `packages/shared`, applied by a pure function `applyCommand(state, command) → state | error` that also lives there (the server runs it; a later CLI can reuse it for dry runs). Stable IDs come from a counter in the state (`w1`, `a2`, …), which keeps the function pure, which makes undo (later change) a matter of storing inverse commands or previous states. State lives in memory; persistence is a later change.

The UI sends a set-time-range command at the end of a zoom/pan gesture (debounced for wheel zoom), not per animation frame; during the gesture the window shows a local preview. This keeps the revision stream meaningful for render acknowledgement and later for undo.

### D9: Client data loading

Each window holds loaded series in memory per signal (no separate cache service). On a new range or revision it fetches each signal with an `AbortController` and a request sequence number; a response is applied only if its sequence number is the latest for that window and signal. A revision is acknowledged once every signal of every window has either drawn its data or failed.

### D10: Real data for development, local ClickHouse for tests

- **Development and acceptance** run against carserver through an SSH tunnel (`ssh -N -L 18123:localhost:8123 jan@192.168.42.207`) with a new read-only user `letsview`: `readonly = 1`, `SELECT` on `sdlog.*` only, defined as a `users.d` file in serverzoo/carserver like the existing ClickHouse config. ClickHouse stays bound to localhost.
- **Automated tests** run against ClickHouse in `docker compose` with the same `signals` schema and a seed script generating synthetic data: a few 5 ms signals over 10 h (concept's load case), irregular and sparse signals, rows with null `utc`, and a known spike. A second table with `DateTime64(9)` covers nanosecond precision. A small test DBC file covers metadata. This keeps tests reproducible and spares the 2 GB machine.

Connection settings come from environment variables (`.env`, git-ignored); credentials never reach the browser.

## Risks / Trade-offs

- [Count + aggregate = two round trips per signal] → Acceptable given DB latency is a given; could be merged into one query later if it matters.
- [carserver is small; 50 signals mean ~100 queries per zoom step] → D7 queue and aborts; measured during the integration check (task 8.1).
- [DBC and database drift apart (CarController updated, decoder not yet re-run)] → Missing metadata shows as absent; never blocks data display.
- [SSH tunnel is a manual step] → Documented in README; a permanent network path is a later operations decision.
- [Arithmetic mean misleads for irregular sampling and state signals] → Documented; only numeric signals in scope; time-weighted mean tracked as open item.
- [JSON transfer of 50 × 2,000 buckets] → ~a few MB at most; switch to a binary format only if measured as a problem.
- [In-memory workspace lost on server restart] → Accepted for the skeleton; persistence is a planned change.
- [uPlot float x-axis] → Mitigated by per-window origin (D3).

