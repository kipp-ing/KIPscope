# Status

As of 2026-10-14, session 2.

## Done

- OpenSpec set up; change `add-timeseries-skeleton` implemented (31/31 tasks) and archived. Main specs: [openspec/specs/](../openspec/specs/).
- Running skeleton: signal catalog with DBC metadata, resolution-aware series API, command-driven workspace with live state and render acknowledgement, browser UI with zoomable uPlot windows. Verified on carserver data and on the 10 h / 5 ms load case.
- carserver: read-only ClickHouse user `letsview` (serverzoo commit `b3a70b9`, **not pushed yet**); password only in local `.env`.
- Change `add-sna-handling` built by the agent team (D-013, [team.md](team.md)) in 3 rounds and archived: SNA rules from the DBC (D-010, D-014, D-015), SNA as `null` in series (D-016), line breaks, SNA strips and SNA shares in the UI.
- Decisions D-001 … D-016 in [decisions.md](decisions.md).

## Next

1. CLI remote control of the open view (concept §7).
2. Cursors A/B with differences (concept §6).
3. Persistence: save/load, snapshots, templates, undo (concept §8).
4. Later: single-value windows, playback, ADX adapter, state signals from value tables, timezone selection.

## Known limitations

- Arithmetic bucket mean (time-weighted mean open, concept §13).
- Workspace lives in server memory; lost on restart.
- Line connects across recording pauses by design (D-009).
- Two signals at the same value on different axes overlap exactly (seen with V_ANZ and DVL at engine start).
- Tick labels may thin out to one label on very narrow plots.

## Run

See [README.md](../README.md). Development needs the SSH tunnel to carserver. Team rounds: workflow `change-round` with `{change, date}` after the spec owner wrote spec, design and tasks; tests need `docker compose up -d` and `seed:test`.
