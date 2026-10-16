# Status

As of 2026-10-16, session 6. In flight: `add-footer` (permanent footer with attribution, meta items and measurement info). The fifteen other changes are archived and the main specs describe the running app.

## What runs

| Capability | Spec | In short |
|---|---|---|
| Signal catalog | [signal-catalog](../openspec/specs/signal-catalog/spec.md) | Signals with DBC metadata and SNA rules; ranked search, hover card, keyboard and drag in the explorer |
| Display names | [display-names](../openspec/specs/display-names/spec.md) | `kipscope.yaml` rules and renames give short names (`V_ANZ`) in the UI; full name in card and tooltips; search on both |
| Series cache | [series-cache](../openspec/specs/series-cache/spec.md) | Power-of-two tiles kept in tab memory (LRU, 4 M values); zoom/pan back without a request |
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
| Server access | [server-access](../openspec/specs/server-access/spec.md) | Local access only (`Host`/`Origin` guard), JSON bodies, size limits on live frames and acknowledgements |

History: [openspec/changes/archive/](../openspec/changes/archive/) (skeleton, SNA handling, window workflow, signal explorer, cursors, CLI, navigation, layout, live cursor, display names, window handling, series cache, zoom speed, load recovery, robustness). Decisions D-001 … D-049: [decisions.md](decisions.md). Tester feedback: [feedback/](feedback/).

## Session 4 in brief

- Built and archived `improve-signal-explorer`, `add-cursors`, `add-cli`, `improve-navigation` and `improve-layout`.
- Jan's hand check: drags, Esc, Alt-copy, trackpad, Digits select and large screens fine. His follow-ups went into `improve-navigation` before its archive:
  - D-030: compact chart legend (bare values with SI prefix, kind as tooltip, no axis or `complete` column, clock-only times, `×` on hover); mouse wheel steps (an accelerated mouse notch no longer pans a whole plot width).
  - D-031: the chart readout always shows the exact value at the cursor, also outside the zoom; B shows without "Diff", which adds only Δ and Δt; no text selection while dragging.

## Session 5 in brief

- Built and archived `add-live-cursor` (D-032 … D-034) in three rounds; Jan: „I like".
- Built and archived `add-display-names` (D-035, D-036) in three rounds; Jan: „nice. working".
- Checked `CPC_508h.PNHV_SupBat_Curr` on Jan's question: decoding matches the DBC and raw frames; negative is discharge (−188 A at hard acceleration, +22 A recuperation), so no fix needed.
- Built and archived `improve-window-handling` (corner grip, drop below the windows) and `add-series-cache` (D-037 … D-039); Jan: „looks good". By hand still: the grip with a real mouse drag.
- Built and archived `improve-zoom-speed` (D-040, D-041, D-043): load during the gesture, overview placeholder, idle prefetch, linked windows follow live. Measured: cached zoom 8–13 ms (was 359 ms), uncached sharp ~65 ms after the gesture (was 400–455 ms). Jan: „Butter smooth".
- carserver reboots daily at 23:00 local and killed the tunnel (470 × 502); built and archived `improve-load-recovery` (D-042, D-044): retry with backoff and on recovery, curve kept on error; `scripts/tunnel.sh` reconnects within ~5 s. Lead's tunnel-drop check: recovered ~3 s after the tunnel came back.

## Session 6 in brief

- Archived `harden-robustness` (D-045 … D-047).
- Renamed letsview to KIPscope (D-048); new home https://github.com/kipp-ing/KIPscope, local folder `~/dev/repos/KIPscope`. The carserver ClickHouse user stays `letsview`.
- License: Attribution Assurance License, GPG-signed (D-049).
- Wrote `add-footer` with Jan's answers (Q1–Q9).

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
- Tabs opened before a web change may need a reload: hot reload swaps modules but keeps old state (seen once: a tab kept reporting render errors until reloaded).
- `/api/value` is not retried after an outage: readouts and the values window stay failed until cursor or range change.
- Not checked by hand: L hidden while a cursor line is dragged (unit test only; the browser tool cannot hold a drag); CLI `--wait` with no tab open (exit 6, covered by tests); mouse wheel steps on mice other than Jan's.

## Run

See [README.md](../README.md). Development needs the SSH tunnel to carserver: `scripts/tunnel.sh start`. Restart the dev server with `scripts/restart-server.sh` (only touches node `src/main.ts` on 7310). Team rounds: workflow `change-round` with `{change, date}` after the spec owner wrote spec, design and tasks; tests need `docker compose up -d` and `seed:test`.
