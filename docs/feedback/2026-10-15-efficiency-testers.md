# Efficiency test (2026-10-15)

Three UI-user agents ran the same four tasks one after another on real smart451 data, each with a strong opinion on efficient UI: a keyboard-first power user, an automotive measurement engineer (CANape/INCA, many short investigations a day) and an interaction designer for expert tools. Condensed by the lead. All ran at a 1000 × 557 px viewport (the browser tool could not resize), so screen-use findings are worst case.

Tasks: T1 V_ANZ + DVL in one window, zoom to the acceleration on 2026-10-13 around 15:08, measure Δt/Δv with A/B; T2 values window with V_ANZ, DVL, T_MOT, read A and B; T3 temperature window, whole day, back; T4 move and copy a signal, undo a mistaken zoom.

## Counts

| Task | Keyboard user | Engineer | Designer | Slowest step (all) |
|---|---|---|---|---|
| T1 | ~25 actions, 8 mouse-only | ~13 | ~9 | getting to 15:08: 3–4 zoom rounds from a 3-day view |
| T2 | ~14 | ~6 | ~8 | a drop into the values window at the bottom landed in a new window |
| T3 | ~18 | ~8 | 6 | scrolling to the right window; no "day" preset |
| T4 | 2 + Backspace | Back = 1 click | ~4 | copy: no affordance (Alt not testable with the tool) |

## Already good (all three)

Drag-select zoom in one gesture; Back restores range and cursors exactly; drag from explorer and legend into windows; `/` + Enter; click = A, Shift+click = B; aggregated/raw badge; stable colours; per-value `lin` tag; loading state.

## Agreed by several testers

1. **Time navigation (3/3, top-ranked by 2):** no way to type a time or range ("15:08", "15:07:15 +60s"), no zoom/pan keys (+/−, ←/→), no jump to the data extent, no presets (1 h, 1 day). The default view spans 3 days and the cursors start at the data end.
2. **Δt/Δv on the chart (3/3):** today only in a values window; CANape shows the cursor readout in the chart. → A/B/Δ label or readout row on the chart.
3. **Drop at the bottom edge still lands in a new window (3/3, must):** even after the close-out fix. Suspected cause: the layout shifts when the drop zone appears at drag start, so the target moves away from the pointer. → bug.
4. **Wheel zooms instead of scrolling the page (2/3 + power users):** → Ctrl/Shift+wheel zooms, plain wheel scrolls (CANape/INCA). Already Jan's question 8 in the cursor feedback.
5. **"Add to" target (2/3):** with "New window", every Enter or `+` creates another window; testers want it to follow the window just created or last used. **Conflicts with D-020** (target stays where the user put it).
6. **Emptied window stays after a move (2/3):** → auto-remove or reuse. Today's behaviour is in the spec ("a window emptied by a move stays", D-017 feedback).
7. **Uneven number formats (3/3):** 2, 45, 16.425, 387.5, 371.075 in one column. Already Jan's question 7.
8. **Screen use (designer, must):** about 25 % of the pixels show data; sidebar 260 px fixed; one chart + values window per screen; → collapsible or narrow sidebar, charts filling the height, tiled windows (two side by side).

## Single-tester findings

- should (keyboard): `/` sometimes does not focus the search (after a select had focus); typed text lost. Search text stays after Enter. → bug for `/`; select-all on focus.
- should (keyboard): no keyboard path for "Add to" target, new window (`W`), new values window (`V`), remove.
- should (keyboard): wheel ~2× per 10 ticks and Zoom out ~2× per click feel slow.
- should (designer): three zoom controls in three places (bar Back, window Back, Reset/Zoom out next to Remove). → one Back, one Reset; Remove into a title menu.
- should (designer): header reflows after a zoom, so the next click on Back misses. → fixed header layout, truncate the badge, not the title.
- should (engineer): the view moved on its own once (15:07 → 14:58–15:13) with no other tester active. → investigate (stale tabs sending commands?).
- should (keyboard): layout breaks horizontally when windows are added; sidebar covers the left axis at 1000 px.
- could (designer): status colours (green "complete", yellow badge) compete with data colours; legend 12 px below the chart; ~55 px header for one status line.
- could: Alt+drag copy is not discoverable; no hover/cursor affordance on legend rows.
- note: T_INNEN −40 °C (raw 0) squashes the temperature axis; valid per D-019's rule, testers would flag it.

## Designer's target layout

A thin search rail on the left (or a popover on `/`), a full-bleed grid of tiled chart windows, each with a title bar, draggable signal chips and an A/B/Δ readout row, and one sticky time/cursor bar on top.
