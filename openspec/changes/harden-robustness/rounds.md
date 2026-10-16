Round 1: continue - 1.1, 2.1, 3.1-3.3, 4.2 fulfilled; open: refused upgrades leave half-open sockets in app.ts (guard runs before the websocket hook, app.close hangs) and a TS2345 in access.http.test.ts break build and test; 5.2 and pnpm check not run.
Round 2: needs_jan - 2.2 fulfilled (refused upgrade no longer half-open, app.close returns, server suite 13/13); only lead-run checks remain: one pnpm check run (5.1, tester report contradicts itself), 5.2 tunnel.sh stale-PID verify (live keeper pid 44851), 4.1 stopped-ClickHouse verify (shared test DB), 6.1 manual checks.

## Lead checks (2026-10-16)

- 5.1: `pnpm check` exit 0 (shared 84, web 239, server 117, cli 48 tests); `yaml@2.8.1` gone from the lockfile.
- 4.1: `TEST_CLICKHOUSE_URL=http://127.0.0.1:1 pnpm --filter @letsview/server test` prints the setup message, exit 1 (dead port instead of stopping the shared container).
- 5.2: keeper stopped; a `sleep 300` PID in the PID file → `stop` prints `not running`, the sleep survives, `status` prints `keeper not running`.
- 6.1 "Restart with the tunnel down": server restarted 07:24:47 with the tunnel down, retries logged at 1, 2, 4, 8, 16 s; tunnel up 07:25:08, `catalog loaded` (428 signals) 07:25:18 without a refresh (≤ 35 s).
- 6.1 "Wait after a server restart on real data": after a restart with the UI open, `--wait link off` → `complete`, exit 0, 497 ms. `--wait` with V_ANZ also completes (498 ms) while the tab is visible; with the Chrome tab hidden it timed out and the tab acked once shown (known limitation, hidden tabs).
- 6.1 "Server down in the UI": server stopped, rename and "+ Values" → message line `bad_response: HTTP 502: Bad Gateway`, title snaps back; `unhandledrejection` listener and console: none.
