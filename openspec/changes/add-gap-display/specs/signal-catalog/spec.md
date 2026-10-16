## ADDED Requirements

### Requirement: Message period from the DBC
A DBC signal's details SHALL carry its message's cycle time in ms from `BA_ "GenMsgCycleTime" BO_ <id> <ms>;` of the same file, or the file's `BA_DEF_DEF_` default for that attribute when the message has none; a cycle time of 0 or none SHALL leave it absent. Origin: D-062 („period from the DBC"); data fact: smart451's DBCs set it for 138 of 327 messages (h-can 47, hybrid-can 91), default 0.

#### Scenario: Test DBC
- **WHEN** `test-a.dbc` (ISO-8859-1, CRLF) declares `BA_ "GenMsgCycleTime" BO_ 2832 20;` and `BA_ "GenMsgCycleTime" BO_ 2833 0;` with default 0, and is parsed
- **THEN** `Cyc_B10h.CYC` has `cycleMs` 20, `Evt_B11h.EVT` and `Fast_100h.SIG_A` have none; a DBC text whose default is 100 gives a message without its own value `cycleMs` 100
- **Evidence:** `apps/server/test/dbc.test.ts` › "reads GenMsgCycleTime per message"

#### Scenario: Real DBCs
- **WHEN** `curl -s localhost:7310/api/catalog | jq -c '[.items[] | select(.dataRef == "smart451" and .dbc.cycleMs != null)] | length, (map(select(.name == "COMBI_412h.V_ANZ"))[0].dbc.cycleMs)'` runs
- **THEN** it prints `408` and `100`
- **Evidence:** the `curl` command against the dev server

### Requirement: Group interval from the diagnostic catalog
A diagnostic catalog signal's details SHALL carry its group's `interval` in ms when it is a positive number with unit `ms`, `s`, `min` or `h` (e.g. `30s`); `never` or no interval SHALL leave it absent, and any other text SHALL leave it absent with a warning in that catalog load. Origin: D-062 („period from … the diagnostic catalog"); data fact: `bms-live.manifest.json` has 28 groups, 7 with an interval (`10s` 2, `30s` 4, `60s` 1), 21 `never`.

#### Scenario: Test catalog
- **WHEN** `test-diag.manifest.json` gives group `DT_Pack` the interval `10s` and `DT_Cell` `never` and is parsed; then a copy of it whose `DT_Contactor` has the interval `2 sec`
- **THEN** `TBMS.current` has `intervalMs` 10000, the `DT_Cell` signals and `TBMS.contactor` none, and the fixture gives no warning about an interval; the copy gives one warning naming `DT_Contactor` and `2 sec`
- **Evidence:** `apps/server/test/diag.test.ts` › "reads group intervals"

#### Scenario: Real catalog
- **WHEN** `curl -s localhost:7310/api/catalog | jq -c '[.items[] | select(.dataRef == "smart451" and .diag.intervalMs != null)] | length, (map(select(.name == "BMS.soc"))[0].diag.intervalMs)'` runs
- **THEN** it prints `29` and `30000`
- **Evidence:** the `curl` command against the dev server
