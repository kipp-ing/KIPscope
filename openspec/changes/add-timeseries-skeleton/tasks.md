# Tasks

## 1. Project setup

- [x] 1.1 Create pnpm workspace with `packages/shared`, `apps/server`, `apps/web` (TypeScript strict, Vitest, lint/format) and verify `pnpm -r build` and `pnpm -r test` succeed on empty packages
- [x] 1.2 Add `docker-compose.yml` for the test ClickHouse and `.env.example` with connection settings (`.env` git-ignored); verify `docker compose up -d` starts a reachable ClickHouse
- [x] 1.3 Create the read-only ClickHouse user `letsview` on carserver as a `users.d` file in serverzoo/carserver (design D10), deploy it, and verify through the SSH tunnel that `SELECT` on `sdlog.signals` works and an `INSERT` is rejected
- [ ] 1.4 Add a README section on running the setup (tunnel, test DB, seed, server, web) and verify the commands run as written on a clean checkout

## 2. Shared time type

- [ ] 2.1 Implement `Timestamp` (int64 ns as `bigint`) with parse/format to decimal string and ISO-8601 with nanoseconds; verify with unit tests including the spec value 2026-10-14T08:00:00.123456789Z round-tripping exactly
- [ ] 2.2 Implement series payload encoding (`t0` + `dt[]` offsets) and decoding; verify unit tests show exact round-trip for nanosecond timestamps over a 10-hour range

## 3. Test data

- [ ] 3.1 Write the seed script creating the `sdlog.signals` schema as on carserver plus a `DateTime64(9)` variant (design D10); verify the tables exist after running it
- [ ] 3.2 Generate synthetic data (design D10): several 5 ms signals over 10 h, irregular and sparse signals, rows with null `utc`, a known spike, nanosecond rows in the variant table; add a small test DBC file; verify by row-count and spot-check queries documented in the script

## 4. Signal catalog (spec: signal-catalog)

- [ ] 4.1 Define the `DataSource` interface and the config-driven table/column mapping (design D5); verify config loading with unit tests
- [ ] 4.2 Implement the DBC parser (`BO_`, `SG_` unit, `CM_ SG_`, ISO-8859-1, CRLF, first file wins; design D6); verify unit tests with the test DBC and a parse of the real `h-can.dbc` finding `MS_312h`
- [ ] 4.3 Build the in-memory catalog from `DISTINCT vehicle, signal` merged with DBC metadata, with search, paging and refresh; verify integration tests against the test DB for each spec scenario (DBC-only signal not listed, signal without DBC entry, match by description, paging)
- [ ] 4.4 Expose `GET /api/signals` with Zod-validated parameters; verify with HTTP-level tests

## 5. Series query (spec: series-query)

- [ ] 5.1 Implement the query queue with concurrency limit, abort-before-run, cancellation by query ID and `max_execution_time` (design D7); verify unit tests for the 50-signals-with-limit-4 scenario and for an aborted request never reaching the DB
- [ ] 5.2 Implement raw-point query with edge neighbors, excluding null `utc` (design D4, D5); verify integration tests for the millisecond-window-between-points, start-of-recording and null-timestamp scenarios
- [ ] 5.3 Implement aggregated query with absolute-grid buckets and count/avg/min/max, omitting empty buckets; verify the 10-hour overview returns ≤ target buckets and a known spike appears as bucket max
- [ ] 5.4 Implement raw-vs-aggregate selection via count; verify tests for both branches and the boundary count = target
- [ ] 5.5 Expose `GET /api/series` with error responses that name signal and range; verify HTTP tests including DB-unavailable returning an error and no data
- [ ] 5.6 Verify precision end to end: HTTP tests fetch a seeded ms timestamp from the `DateTime64(3)` table and a ns timestamp from the `DateTime64(9)` table and compare both exactly

## 6. Workspace state (spec: workspace-state)

- [ ] 6.1 Define workspace state and command union with Zod schemas in `packages/shared`; verify schema tests reject malformed commands
- [ ] 6.2 Implement pure `apply(state, command)` for all skeleton commands, including the 50-distinct-signal limit and unknown-ID rejection; verify unit tests per spec scenario
- [ ] 6.3 Expose `POST /api/commands` and `GET /api/workspace` with revision counting; verify HTTP tests that accepted commands increment the revision and rejected ones don't
- [ ] 6.4 Implement `WS /api/live` state push and render acknowledgement, plus `GET /api/render-status`; verify with a test client that receives the state and whose acknowledgements (complete and error) appear in render status

## 7. Web UI (specs: timeseries-window, signal-catalog)

- [ ] 7.1 Set up the React app with a WebSocket connection to `/api/live` and a minimal layout (window list, add/remove window); verify in the browser that a reload shows the same workspace
- [ ] 7.2 Build the signal explorer (search, metadata display, add to window); verify in the browser against the real catalog that `MS_312h.DNMOT` shows its DBC unit and is found by a description term
- [ ] 7.3 Build the time-series window with uPlot: per-window origin, bigint-based tick labels in local time down to sub-microsecond steps; verify unit tests for tick formatting and the 100 µs scenario in the browser
- [ ] 7.4 Draw aggregated means with optional min/max envelope (off by default) and a visible aggregated indicator; verify in the browser with the spike signal
- [ ] 7.5 Draw raw points as lines, steps or markers using edge neighbors, never before the first or after the last point; verify unit tests for segment construction and in the browser for each mode
- [ ] 7.6 Implement zoom/pan with local preview and debounced set-time-range command at gesture end; verify that zooming one window leaves the other unchanged
- [ ] 7.7 Implement data loading per window and signal with abort + sequence numbers, per-signal loading/error state, and render acknowledgement; verify unit tests for out-of-order responses and in the browser that a failing signal is marked while others stay visible

## 8. Integration check

- [ ] 8.1 Walk through the skeleton flow on the real carserver data: add three signals to two windows, zoom one from the dense drive on 2026-10-13 09:00–11:00 UTC down to single raw points, check render status via `GET /api/render-status`, and note carserver memory/query load during the walk-through; record the result in the change's commit notes
- [ ] 8.2 Repeat the 10-hour overview on the test DB's 5 ms signals (concept load case) and verify the window stays responsive and shows the spike in the envelope
