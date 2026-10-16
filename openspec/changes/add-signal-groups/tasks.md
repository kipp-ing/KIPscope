# Tasks

Every task has its own files; all build in one round against the interfaces pinned in design G1–G7. Group 1 lands types the others import; engineers of groups 2–3 may stub them until it is in. The tester writes group 4 test-first, in parallel. Group 5 is the lead's. Q1 is resolved (D-053: fallback rule shipped).

- 1.1: `packages/shared/src/signals.ts`
- 2.1: `apps/server/src/dbc.ts`, `groups.ts` (new), `names.ts`, `catalog.ts`
- 2.2: `apps/server/src/project.ts`, `kipscope.yaml`, `kipscope.example.yaml`
- 3.1: `apps/web/src/explorer/groups.ts` (new), `explorer/SignalExplorer.tsx`, `styles.css`
- 3.2: `apps/web/src/chart/live.ts`
- 4.1: `apps/server/test/*`, `apps/server/test/fixtures/kipscope.test.yaml`
- 4.2: `apps/web/test/explorer.test.ts`, `apps/web/test/live.test.ts`
- 5.1: `README.md`

## 1. packages/shared

- [x] 1.1 Types (G1): `DbcInfo.sender?`, `SignalInfo.group?`, `OTHER_GROUP`, `groupOf()`, exported from the package index. Verify: `pnpm --filter @kipscope/shared build`.

## 2. apps/server/src

- [x] 2.1 Sender and group per entry (G2, G3 types, G4, G5): `MESSAGE` with sender, `DbcSignal.sender`; new `groups.ts` (`GroupRule`, `GroupFields`, `assignGroup`); `DisplayRules.groups` and `NO_RULES.groups = []` in `names.ts`; `dbcInfo()` copies `sender`, `load()` sets `info.group`. Verify: scenarios "Senders from inline DBC text", "Senders from the real DBCs", "First non-blank rule wins", "Blank renders and Other", "No rules", "Test project file on the test DB", "Speed signal from the real DBC", "Details from the fixture DBCs", "No file, no field".
- [x] 2.2 `display.groups` in the project file (G3): schema key, compile `match`/`group` with the problems of G3 (reuse `parseTemplate`, regex compile and group listing), fill `rules.groups`; shipped `kipscope.yaml` gets `display.groups`: `{ group: '{sender}' }`, then `{ match: '^(?<ecu>CPC|PNHV)_', group: '{ecu}' }` (D-053 Q1), same two rules in the example; `kipscope.example.yaml` explains `groups`, `match`, `group`, `{sender}`, fall-through and `Other`. Verify: scenarios "Group rule errors", "Shipped files parse with groups", "Real data grouped by sender" (curl, after restart).

## 3. apps/web/src

- [x] 3.1 Grouped explorer (G6): `explorerItems`, `firstSignal` in new `explorer/groups.ts`; `SignalExplorer.tsx` renders items (header `div.group-head[role=option][aria-expanded]`, chevron, name, count), `toggled` state cleared on query change, header click and Enter toggle, arrows over items, active = `firstSignal` after a query change, chunks over items, card only on signal items and closed on toggle, drag only from rows; header style in `styles.css` (≤ 24 px, like a row). Verify: scenarios "Group order and state", "Empty search on real data", "Search on real data", "No groups, flat list", "Card and drag from a grouped row", "Arrows choose another hit", "Esc clears", "Search, Enter adds the top hit", "Whole catalog reachable", "Show more beyond one chunk", "Grouping speed".
- [x] 3.2 Near distance (G7): `NEAR_PX = 16`, comment cites D-052. Verify: scenario "Nearest of three".

## 4. Tests

- [x] 4.1 Server tests: `dbc.test.ts` (new "reads the sender of each message, none for Vector__XXX"; sender in "derives DBC details from the real h-can.dbc" and "reads message, scaling, range, value table and file"); new `groups.test.ts`; `project.test.ts` ("reports every problem of the group rules", shipped-files test extended); `catalog.test.ts` ("sets groups from the test project file"; `sender: "TEST"` in existing `dbc` objects); `kipscope.test.yaml` gains the two group rules of the scenario. Verify: `pnpm --filter @kipscope/server test`.
- [x] 4.2 Web tests: `explorer.test.ts` ("groups matches by best hit, Other last, collapsed on an empty query", "groups 10,000 matches in under 10 ms"; chunk test unchanged); `live.test.ts` renamed to "picks the nearest curve within 16 px, on a tie the later one" with 17/3/5, 16, −16, 16.5 and `NEAR_PX` 16. Verify: `pnpm --filter @kipscope/web test`.

## 5. Docs (lead)

- [x] 5.1 README section "Signal groups" (scenario "README"). Verify: `grep -n "Signal groups\|{sender}" README.md`.

## Workflow follow-up

- On archive: copy the ledger entry of design.md into `docs/decisions.md`.
