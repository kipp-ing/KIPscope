# Critic's findings, accepted by Jan (2026-10-21: "do as proposed")

All numbered points below are to be done. The power-user wishes at the end go to the backlog only.

1. Duration reads as seconds next to a stopwatch ("⏱0:10"); "227:18" unreadable. → H:MM with unit: "0:10 h", "1:06 h"; from 48 h on "9 d 11 h"; tooltip "Duration 10 min" (long form). Under 1 min stays "41 s".
2. Sidebar is not a fixed slot (declared 248/208 px, renders 321/317 px because unwrapped descriptions set the flex min width) → aside gets `width` + `min-width:0`; descriptions ellipsis + tooltip.
3. Mock contradictions: SessionBar rows 1–3 still draw the old density-bar strip → redraw from Strip "Recommended"; the picker draws drives in the accent → drive bars #334155, accent only for the selection.
4. D-094 says 24 px, the strip is 28 px → fix the number (lead does it in decisions.md).
5. Events on the strip are 3×7 px pins told apart only by colour (fault #be123c vs stored #b45309 under deuteranopia); 3 px can't be hovered → one shape per kind (fault = full-height tick with a head, stored = hollow, change = short tick), each pin a ≥ 9 px invisible hit area. (Event lines in the plots exist in the app; show them in the mock.)
6. The strip has no time scale → start and end labels in fixed slots at the strip ends (10 px, #64748b), day labels when unlinked, a time readout on hover.
7. A 0:12 range out of 227 h is < 1 px → range drawn ≥ 3 px with an accent caret; A and B flags < 18 px apart merge into one "A·B" flag; events keep their own lane above the flags.
8. Presence line #94a3b8 is 2.6:1 → #64748b (4.8:1). An off-screen cursor's flag turns accent → keep it black, add a ◂ / ▸ caret at the strip edge instead; the accent means only "shown range".
9. A/B/Diff are three solid #0f172a pills, heaviest marks on screen, and Link uses a sky tint → one pressed style for all toggles: sky-100 fill with #0369a1 ink.
10. Start shown twice (range button "26-10-13 15:06 ⏱0:12 h" and session bar "26-10-13 15:06 ⏱0:10 h") → the session bar shows title + session duration; its start goes into the title tooltip and the list. Slot stays fixed.
11. Axis tick labels in series colours fail contrast (#E69F00 2.2:1 …); unit labels overlap the top tick → ticks #334155, a small series swatch beside the unit, the unit on its own line above the plot.
12. Align only lives in the list, invisible while closed; "Back to the finder" is jargon → alignment in the k/n button's tooltip plus a small glyph; link text "Back to search".
13. Flags 16×12 hit areas too small → visible 14×12, hit area 24×24; keys Shift+A / Shift+B bring A or B into view.
14. Calendar: every day cell is a tab stop, no grid semantics → role=grid with a roving tabindex; arrows and PageUp/PageDown move, Enter picks; each day aria-label e.g. "Tue 13, 2 drives".
15. Polish: slots sized for worst cases (k/n 88 px for "123 / 456", duration 64 px, range button fits "26-10-13 15:06:03  41 s"; put those strings in the mock); "26-10-13" may read as 2013 → tooltip "Tue 2026-10-13 15:06" wherever a start appears; Reset icon reads as fullscreen → a fit / zoom-out glyph; k/n and Unlink 24 px tall; the note's ✕ larger; Share stays in the row at every width (no width rule).

Not done (backlog): windows filling the height; event counts per session in the list; putting A or B on an event; copy-link of view and cursors; filter by event kind on the strip.
