# Power-user exploration (2026-10-14)

Two UI-user agents drove the app on real carserver data before the spec of the next change (D-017): an automotive measurement user (CANape, INCA, iba) and a UI/data-viz user (PlotJuggler, Grafana, Foxglove). Condensed; scope decided in D-018.

## Jan's points: today → expectation

1. **Move signals between windows.** Today: only remove + re-add via the "Add to" dropdown; legend rows are not draggable. Expect: drag a legend row onto another window to move it; Alt/Ctrl-drop copies; drop zone "+ new window"; drop targets highlighted with a hint while dragging, Esc cancels; explorer rows draggable onto windows too; colour and mode survive the move; a window emptied by a move stays with "Drop a signal here".
2. **Same range, same axis.** Today: one axis per distinct unit but signals with the same unit still don't merge reliably; axis titles are unit only, no colour link; a third unit has nowhere to go. Expect: one axis per unit (Jan, D-018); axis title = unit (+ signal name if alone), coloured like the signal when alone; at most two visible axes left/right, legend shows L/R per signal.
3. **Shared zoom.** Today: strictly per window. Expect: "Link time axes" chain toggle in the top bar, on by default, state in the workspace; zoom/pan/zoom-out in one window drives all linked windows; on re-link snap to the last zoomed window. Could: per-window detach, shared hover line.
4. **Explorer list with hover details.** Today: rows of 1–4 lines (description and SNA inline), about 10 visible; no hover card. Expect: one-line rows (name, unit, small status dot); hover card after ~300–400 ms, also on keyboard focus: full name, message, unit, description, scaling, DBC min/max, SNA codes, value table, raw step, source, windows showing it.
5. **Search on parts.** Today: already substring, multi-word AND across name/description/unit, case-insensitive; capped at 100 of N; results lag typing. Expect: rank exact > prefix > name substring > description/unit; matched parts highlighted; no hard cap (virtual scroll or "show more"); no visible lag.
6. **Cursors A/B** → next change. Both users first want a hover readout (time + value per signal, SNA flagged); goes into the cursor change (D-018).

## Bugs and irritations found

- should: `DCU_2B8h.HTR_HV_Volt` window range reads "1036-01-11 … 3937-05-09" (garbage timestamps).
- should: T_SET showed about −40 °C although SNA-filtered (check SNA rule vs data); MOT_SPD_D around −120 with unit `rpm/10ms`.
- should: "°C" garbled in the rotated axis title.
- should: window header wraps with long titles (Remove on its own line).
- should: window names drift (first signal name, `w6`), no rename; "Add to" lists raw IDs; sticky global "Add to" led to adding to the wrong window.
- should: windows stacked at fixed height; no resize; no double-click reset, no zoom history, no Y autoscale.
- could: signal colours repeat across windows (blue first everywhere) → stable colour per signal.
- could: legend status words as running text → status dot with tooltip; keep the aggregated badge, add one for raw.
- could: no keyboard shortcuts (focus search, Esc, zoom back).
- note: the workspace is shared server-side, so two open tabs interfere (by design, D-005; worth a notice).
- note: performance and the raw/aggregated badges were praised.
