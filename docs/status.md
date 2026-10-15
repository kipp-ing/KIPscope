# Status

As of 2026-10-15, session 4.

## Done

- OpenSpec set up; change `add-timeseries-skeleton` implemented (31/31 tasks) and archived. Main specs: [openspec/specs/](../openspec/specs/).
- Running skeleton: signal catalog with DBC metadata, resolution-aware series API, command-driven workspace with live state and render acknowledgement, browser UI with zoomable uPlot windows. Verified on carserver data and on the 10 h / 5 ms load case.
- carserver: read-only ClickHouse user `letsview` (serverzoo commit `b3a70b9`, **not pushed yet**); password only in local `.env`.
- Change `add-sna-handling` built by the agent team (D-013, [team.md](team.md)) in 3 rounds and archived: SNA rules from the DBC (D-010, D-014, D-015), SNA as `null` in series (D-016), line breaks, SNA strips and SNA shares in the UI.
- Power-user exploration ([feedback/2026-10-14-power-users.md](feedback/2026-10-14-power-users.md)) after Jan's test (D-017).
- Change `improve-window-workflow` built in 5 rounds plus close-out and a spec audit, archived 2026-10-15: move/copy signals by drag, one axis per unit stacked up to four, linked time zoom (default on), stable colours, rename, heights, zoom history, time bounds (D-017 … D-021).
- Changes `add-cursors` (cursors A/B, values window, option bar, drag from everywhere) and `add-cli` (CLI remote control) built and archived 2026-10-15 (D-023, D-024, D-029); efficiency test with three testers ([feedback/2026-10-15-efficiency-testers.md](feedback/2026-10-15-efficiency-testers.md)).
- Change `improve-signal-explorer` built in 2 rounds plus close-out, archived 2026-10-15: one-line explorer with hover card, ranked search with highlighting in the browser (`GET /api/catalog`), keys, explorer drag, stable "Add to" target (D-020, D-022).
- Decisions D-001 … D-029 in [decisions.md](decisions.md).

## Next

1. Change `improve-navigation` (D-025, D-026, D-028): wheel scrolls / Ctrl+Shift+wheel zooms, one Back and one Reset, time navigation ("Go to", keys, presets), A/B/Δ readout on the chart, 3 significant digits with SI prefixes. Building.
2. Change `improve-layout` (D-026, D-027, D-028): collapsible sidebar, two-column tiles, compact headers, marked window as "Add to" target, emptied windows removed. Spec done; built after 1.
3. Jan: hand check of cursors and CLI (archived before the check, D-028): real mouse drags of cursor lines and rows, Esc mid-drag, Alt-copy, CLI `--wait` with no tab open (exit 6).
4. Persistence: save/load, snapshots, templates, undo (concept §8).
5. Later: sidebar work package (D-026), playback, ADX adapter, state signals from value tables, timezone selection.

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
- The dev server restarts on code changes (`--watch`) and the in-memory workspace is lost; rebuild demos with the CLI (`node apps/cli/src/main.ts`).
- Hidden browser tabs stay connected and never acknowledge renders (7 clients stuck at revision 0 seen); `--wait` takes the first UI that acknowledges.

## Run

See [README.md](../README.md). Development needs the SSH tunnel to carserver. Restart the dev server with `scripts/restart-server.sh` (only touches node `src/main.ts` on 7310). Team rounds: workflow `change-round` with `{change, date}` after the spec owner wrote spec, design and tasks; tests need `docker compose up -d` and `seed:test`.
