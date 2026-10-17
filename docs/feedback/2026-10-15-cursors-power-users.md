# Power-user exploration of add-cursors (2026-10-15)

Two UI-user agents drove `add-cursors` (built, not archived) on real smart451 data while Jan was away: an automotive measurement user (CANape, INCA, iba) and a UI/data-viz user (PlotJuggler, Grafana, Foxglove). Both worked in the shared workspace at the same time, so some readings were disturbed by the other (D-005). Condensed by the lead.

## Worked well

- Click = A, Shift+click = B (solid vs dashed); dragging a line; stacked flags when A and B are close.
- Real task: SPEED_DISP 0 → 55 km/h in 13.5 s (A 15:14:27.380, B 15:14:40.880); V_REF_EST 51.19 and WSPD_FL 486.6 1/min at B give a +3.8 km/h speedometer offset at a glance.
- Drag and drop from everywhere: explorer → values window, legend → values window, values row → other window.
- Sticky option bar; unlinked tooltips "Back · Speed change" / "Reset zoom · Speed change" (D-024).
- Header "A … B … Δt", per-cell `lin` tag, "Drop a signal here", loading/complete and aggregation badges.

## Findings: today → expectation

Bugs (fixed in the add-cursors close-out, see rounds.md):
1. should: drops near the viewport bottom land in "+ New window" or the wrong window, although a values window is visible there (both users; three stray windows). → A drop goes to the target under the pointer; the sticky zone never covers a window.
2. should: the window header range lags one zoom step behind the axis (seen twice today, once yesterday). → Header always matches the axis.
3. should: values cells show `—` for 1–3 s after a cursor move, which reads as "no data". Once B stayed `—` while B was on and had data, until B was set again (not reproduced). → A loading state distinct from `—`; B always fills.
4. should: "+ Values window" appends the window out of sight. → Scroll it into view.
5. could: `addSignal` accepts a signal a window already shows (SPEED_DISP twice in one window); the values-window spec says it is refused. → Reject with `already_in_window`, as moves do.
6. note: the signal card stayed open over a window after clicking an explorer row; the drag chip said "copy" on a plain drop after an earlier Alt drag.

Questions for Jan (not built):
7. should: number format is uneven in one column (16, 128.425, 13.8125, −2.94375). → A fixed significant-digit rule (e.g. 5) or decimals from the DBC raw step; align on the decimal point.
8. should: the wheel over a chart zooms, so the page cannot scroll while the pointer is over charts. CANape/INCA scroll with the wheel and zoom with Ctrl+wheel.
9. could: a cursor outside the visible range gives no cue. → Edge marker and "go to cursor".
10. could: "Diff" stays clickable while B is off. → Grey it out, or turning Diff on also places B.
11. could: the hover crosshair still draws a horizontal guide and dots on the curves (no values, per D-023). → Keep, or vertical line only.
12. note: T_CABIN reads −40 °C at A and B (raw 0, a valid value under D-019's rule, like T_SET).
13. note: cursors are shared workspace state, so two people fight over them (D-005, by design).
