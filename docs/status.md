# Status

As of 2026-10-14, end of session 1.

## Done

- OpenSpec set up; change `add-timeseries-skeleton` implemented (31/31 tasks) and archived. Main specs: [openspec/specs/](../openspec/specs/).
- Running skeleton: signal catalog with DBC metadata, resolution-aware series API, command-driven workspace with live state and render acknowledgement, browser UI with zoomable uPlot windows. Verified on carserver data and on the 10 h / 5 ms load case.
- carserver: read-only ClickHouse user `letsview` (serverzoo commit `b3a70b9`, **not pushed yet**); password only in local `.env`.
- Decisions D-001 … D-012 in [decisions.md](decisions.md).

## Next

1. **`add-sna-handling`** (in progress): only [proposal.md](../openspec/changes/add-sna-handling/proposal.md) exists. Next: specs, design, tasks (`/opsx:propose` or continue the change), then apply. Rule: SNA never shown as valid (D-010, D-012).
2. CLI remote control of the open view (concept §7).
3. Cursors A/B with differences (concept §6).
4. Persistence: save/load, snapshots, templates, undo (concept §8).
5. Later: single-value windows, playback, ADX adapter, state signals from value tables, timezone selection.

## Known limitations

- Arithmetic bucket mean (time-weighted mean open, concept §13).
- Workspace lives in server memory; lost on restart.
- Line connects across recording pauses by design (D-009).
- Tick labels may thin out to one label on very narrow plots.

## Run

See [README.md](../README.md). Development needs the SSH tunnel to carserver; tests need `docker compose up -d` and `seed:test`.
