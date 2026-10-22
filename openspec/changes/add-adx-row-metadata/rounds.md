- Round 1: needs_jan - all code tasks built and green (server 671, web 641, test:adx 68), but scenario "Row metadata table seeded" is missed because the spec pins the sentinel count at 4 where the R7 rows give 5 (spec owner must fix design.md R7/Numbers and adx-source spec line 82; task 5.1 stays open), and the lead's checks are not run (6.1 second server on 7311, 6.2 UI card, 'Not started' and 'Default test run unchanged' need the emulator stopped, 'States on smart451' needs carserver).

## Lead's checks after round 1 (2026-10-22)

- Spec fix: sentinel count in `KMeta` is 5 (design R7, Numbers; adx-source "Row metadata table seeded"); seed output `expected 5, got 5` → 5.1 ticked.
- 6.1 "Server on the emulator" (7311, `KIPSCOPE_TABLE=KMeta`, unit column, SNA texts): catalog `[["meta-a/Flag.ERR",null,null],["meta-a/Gear.POS",null,"text"],["meta-a/Spd.V","km/h",null],["meta-b/Spd.V","mph",null]]`; series `[0,10,20,null,null,50,60,null,80,90]` — both exact.
- 6.2 "Card for a table unit": hover `Spd.V` (meta-a) shows Unit `km/h`, Source `meta-a · unit from the table`, no message/scaling/range/SNA/value lines (screenshot). Regression on carserver by the UI user: DBC card still `<dataRef> · h-can.dbc` (COMBI_412h.V_ANZ; SPEED_DISP is not in the scoped catalog).
- "Not started": with `adx-test` stopped, `test:adx` fails once with the expected message. "Default test run unchanged": `docker compose ps` lists `clickhouse-test` only; `pnpm test` passes (shared 221, web 641, cli 102, server 671). Emulator started again afterwards.
- 7.1 crash guard round 1: `pnpm build`, `pnpm smoke`, `pnpm smoke --preview` pass.
