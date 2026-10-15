- Round 1 (2026-10-15): needs_jan - tasks 1.1, 1.2, 2.1 fulfilled (build, lint, tests, UI regression check pass); only the lead's task 3.1 (manual tunnel-drop check, scenarios "Tunnel drop on real data" and manual part of "Settled while failed, not while a retry loads") is not_run. Reviewer could-notes (class/status truthiness mismatch, recovery trigger breadth) are not blockers.

## Lead check 3.1: tunnel drop on real data (2026-10-15 23:29 local)

- `scripts/tunnel.sh stop`, then four Ctrl+wheel zoom-in events on window 1 into unloaded raw data: all three linked windows kept drawing the coarse curve (`agg · 268.4 ms`), legends read `failed: source_error: …` for every signal (screenshot taken).
- `scripts/tunnel.sh start` at 23:29:41 without touching the page: on the first poll (~3 s later) no `failed:` was left and all windows showed `raw` data.
- `GET /api/render-status` afterwards: the test tab `complete`, 0 errors. Jan's tab loaded at 22:51 (before the change, hot-reloaded only) still reported `error` until reloaded; after a reload `complete`, 0 errors.
- View restored to 1791883266158071594 … 1791883459827817552.
