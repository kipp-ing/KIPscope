Round 1: continue - build fails on names.test.ts (groups missing, tester fix); README 5.1 still open (lead); UI keyboard checks (Enter/arrows on headers, Esc, flat list) not run, so 3.1 stays open; grouping speed closed (0.59 ms, reviewer).
Round 2: needs_jan - 4.1 ticked (build, 140 server tests, lint green); open only README 5.1 (lead) and the UI keyboard checks of 3.1 (arrows/Enter on headers, Esc, flat list), which need a deliberate UI-user run since round 2 did not touch apps/web.

## Lead check (2026-10-16)

- README section "Signal groups" written (5.1); `grep -n "Signal groups\|{sender}" README.md` → lines 116, 123, 131.
- Keyboard in Chrome on real data (scenarios "Arrows choose another hit", "Esc clears", Enter on a header): `temp` → active item `TEMP_COOL` (first row); ArrowDown ×2 → `T_AIR`, Enter added `ENG_5E0h.T_AIR` to a new window (w6, removed afterwards); ArrowDown ×2 → header `DCU 5`, Enter collapsed it; ArrowDown → header `HVM 1` active; Esc → field empty, 14 headers all collapsed (AC 21 … YRG 23, Other 18), first active. All pass.
- Still not_run in the UI: "No groups, flat list" (needs a server without `display.groups`; unit test covers it) and the 16 px near distance (unit test `live.test.ts`). Tasks 3.1 and 4.1 ticked.
