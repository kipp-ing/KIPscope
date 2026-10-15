# Status

As of 2026-10-15, session 3.

## Done

- OpenSpec set up; change `add-timeseries-skeleton` implemented (31/31 tasks) and archived. Main specs: [openspec/specs/](../openspec/specs/).
- Running skeleton: signal catalog with DBC metadata, resolution-aware series API, command-driven workspace with live state and render acknowledgement, browser UI with zoomable uPlot windows. Verified on carserver data and on the 10 h / 5 ms load case.
- carserver: read-only ClickHouse user `letsview` (serverzoo commit `b3a70b9`, **not pushed yet**); password only in local `.env`.
- Change `add-sna-handling` built by the agent team (D-013, [team.md](team.md)) in 3 rounds and archived: SNA rules from the DBC (D-010, D-014, D-015), SNA as `null` in series (D-016), line breaks, SNA strips and SNA shares in the UI.
- Power-user exploration ([feedback/2026-10-14-power-users.md](feedback/2026-10-14-power-users.md)) after Jan's test (D-017).
- Change `improve-window-workflow` built in 5 rounds plus close-out and a spec audit, archived 2026-10-15: move/copy signals by drag, one axis per unit stacked up to four, linked time zoom (default on), stable colours, rename, heights, zoom history, time bounds (D-017 … D-021).
- Change `improve-signal-explorer` built in 2 rounds plus close-out, archived 2026-10-15: one-line explorer with hover card, ranked search with highlighting in the browser (`GET /api/catalog`), keys, explorer drag, stable "Add to" target (D-020, D-022).
- Decisions D-001 … D-024 in [decisions.md](decisions.md).

## Next

1. Change `add-cursors` (D-023): cursors A/B with diff mode, a cursor value window, an option bar, drag and drop from everywhere. Spec written and validated, open questions answered (D-024); ready for the rounds.
2. CLI remote control of the open view (concept §7).
3. Persistence: save/load, snapshots, templates, undo (concept §8).
4. Later: playback, ADX adapter, state signals from value tables, timezone selection.

## Known limitations

- Arithmetic bucket mean (time-weighted mean open, concept §13).
- Workspace lives in server memory; lost on restart.
- Line connects across recording pauses by design (D-009).
- Two signals at the same value on different axes overlap exactly (seen with V_ANZ and DVL at engine start).
- Tick labels may thin out to one label on very narrow plots.
- Header range below 1 s shows equal start and end times (ms precision).
- Jan's hand checks pending: real mouse drags from explorer and legend, Esc during a drag, Alt-copy, wheel feel, height handle.
- Seen once, not reproduced: window header range stale after a rectangle zoom. Rename has no visible affordance.
- `openspec validate --specs --strict` warns that `timeseries-window` requirement 16 (drag) is over 500 characters; `add-cursors` splits it.

## Run

See [README.md](../README.md). Development needs the SSH tunnel to carserver. Restart the dev server with `scripts/restart-server.sh` (only touches node `src/main.ts` on 7310). Team rounds: workflow `change-round` with `{change, date}` after the spec owner wrote spec, design and tasks; tests need `docker compose up -d` and `seed:test`.
