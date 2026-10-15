# Status

As of 2026-10-15, session 5. No change in flight; all nine changes are archived and the main specs describe the running app.

## What runs

| Capability | Spec | In short |
|---|---|---|
| Signal catalog | [signal-catalog](../openspec/specs/signal-catalog/spec.md) | Signals with DBC metadata and SNA rules; ranked search, hover card, keyboard and drag in the explorer |
| Series queries | [series-query](../openspec/specs/series-query/spec.md) | Raw points or min/mean/max buckets by zoom level; SNA as `null`; verified on 10 h at 5 ms |
| Workspace | [workspace-state](../openspec/specs/workspace-state/spec.md) | Command-driven state with revisions, live push and render acknowledgement |
| Chart windows | [timeseries-window](../openspec/specs/timeseries-window/spec.md) | uPlot windows, one axis per unit (max 4), linked zoom, history, drag and drop, wheel and keys |
| Time navigation | [time-navigation](../openspec/specs/time-navigation/spec.md) | "Go to" with times, ranges and durations; span presets; zoom and pan keys |
| Cursors | [cursors](../openspec/specs/cursors/spec.md) | A and B in every window; exact values, Δ and Δt in the legend |
| Live cursor | [live-cursor](../openspec/specs/live-cursor/spec.md) | L follows the mouse in every window: L column in legends and values window, nearest curve highlighted with a value label |
| Values window | [values-window](../openspec/specs/values-window/spec.md) | Many signals at the cursors, no plot |
| Number format | [number-format](../openspec/specs/number-format/spec.md) | 3 (or 4) significant digits with SI prefixes everywhere people read numbers |
| Layout | [workspace-layout](../openspec/specs/workspace-layout/spec.md) | Collapsible sidebar, tiled windows, compact headers, marked "Add to" window |
| CLI | [cli](../openspec/specs/cli/spec.md) | Every command from the shell, `--wait` for the rendered UI |

History: [openspec/changes/archive/](../openspec/changes/archive/) (skeleton, SNA handling, window workflow, signal explorer, cursors, CLI, navigation, layout, live cursor). Decisions D-001 … D-034: [decisions.md](decisions.md). Tester feedback: [feedback/](feedback/).

## Session 4 in brief

- Built and archived `improve-signal-explorer`, `add-cursors`, `add-cli`, `improve-navigation` and `improve-layout`.
- Jan's hand check: drags, Esc, Alt-copy, trackpad, Digits select and large screens fine. His follow-ups went into `improve-navigation` before its archive:
  - D-030: compact chart legend (bare values with SI prefix, kind as tooltip, no axis or `complete` column, clock-only times, `×` on hover); mouse wheel steps (an accelerated mouse notch no longer pans a whole plot width).
  - D-031: the chart readout always shows the exact value at the cursor, also outside the zoom; B shows without "Diff", which adds only Δ and Δt; no text selection while dragging.

## Session 5 in brief

- Built and archived `add-live-cursor` (D-032 … D-034) in three rounds; Jan: „I like".

## Next

1. Persistence: save and load, snapshots, templates, undo (concept §8). The workspace still lives in server memory.
2. carserver: the read-only ClickHouse user `letsview` lives in serverzoo commit `b3a70b9`, **not pushed yet**; the password is only in the local `.env`.
3. Later: sidebar work package (D-026), playback, ADX adapter, state signals from value tables, timezone selection.

## Known limitations

- Bucket mean is arithmetic, not time-weighted (concept §13). It now shows only in the plot and in a cursor's live value while its line is dragged in a zoomed-out view.
- Workspace lives in server memory and is lost on restart; the dev server restarts on every server or shared code change (`--watch`). Rebuild demos with the CLI.
- The line connects across recording pauses by design (D-009).
- Two signals at the same value on different axes overlap exactly.
- Tick labels may thin out to one label on very narrow plots. A header range below 1 s shows equal start and end (ms precision).
- Seen once, not reproduced: header range stale after a rectangle zoom. Rename has no visible affordance (click the title).
- Hidden browser tabs stay connected but never acknowledge renders; `--wait` takes the first UI that does, and times out when only hidden tabs are open.
- Not checked by hand: L hidden while a cursor line is dragged (unit test only; the browser tool cannot hold a drag); CLI `--wait` with no tab open (exit 6, covered by tests); mouse wheel steps on mice other than Jan's.

## Run

See [README.md](../README.md). Development needs the SSH tunnel to carserver. Restart the dev server with `scripts/restart-server.sh` (only touches node `src/main.ts` on 7310). Team rounds: workflow `change-round` with `{change, date}` after the spec owner wrote spec, design and tasks; tests need `docker compose up -d` and `seed:test`.
