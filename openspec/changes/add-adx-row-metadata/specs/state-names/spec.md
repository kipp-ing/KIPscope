## MODIFIED Requirements

### Requirement: Signals with states
The catalog SHALL mark a signal `states: "labels"` when its `VAL_` table names a code that is not SNA, and `states: "text"` when its rows carry text (one query per catalog load) or its `diag.kind` is `enum`, but not when `diag.kind` is `text`; each `VAL_` entry SHALL carry its physical value (D-012). Diag invalid sentinels SHALL NOT become SNA. Row texts in the source's SNA texts (`KIPSCOPE_SNA_TEXTS`) SHALL NOT count as text: a signal whose only row texts are SNA texts gets no `states: "text"`, and a text signal's SNA-text rows have no state name. Origin: D-059 („many signals are state"); D-061 and `add-diag-metadata` M1; design N1; SNA texts: D-100 („such texts alone do not make a signal a state signal").

#### Scenario: States in the test catalog
- **WHEN** the server runs on the test DB and `GET /api/catalog` is read
- **THEN** `testcar/Ign_A20h.MODE` and `testcar/Tmp_A21h.TEMP` have `states` `"labels"`, `testcar/DIAG.door` and `testcar/DIAG.lock` `"text"`, `testcar/Fast_100h.SIG_A` no `states`; `Ign_A20h.MODE`'s `dbc.values` hold `{"raw":3,"label":"KEYON: Ignition on","value":3}`
- **Evidence:** `apps/server/test/catalog.test.ts` › "marks signals with states"; `apps/server/test/signals.http.test.ts` › "lists 1,021 signals" (count 1,017 → 1,021)

#### Scenario: States on smart451
- **WHEN** `curl -s localhost:7310/api/catalog | jq -c '[.items[] | select(.states) | .states] | group_by(.) | map({(.[0]): length})'` runs against carserver
- **THEN** `labels` is at most 74 and `text` at most 9 (the text signals minus those whose `diag.kind` is `text`, e.g. a VIN), both reported; `DCU_1F4h.IgnMode` has `"labels"`, `BMS.contactor` `"text"`, `BCM_42Eh.IGN_15` none
- **Evidence:** the command

#### Scenario: Sentinel texts make no state signal
- **WHEN** on the seeded emulator a `Catalog` (no DBC, no diag catalog) over an ADX adapter on `KMeta` with `snaTexts: ["SNA", "INVLD"]` and `unit: "unit"` is refreshed, and again over an adapter without `snaTexts`
- **THEN** with the list `meta-a/Gear.POS` has `states` `"text"` and `meta-a/Flag.ERR` and `meta-a/Spd.V` have no `states`; without the list `meta-a/Flag.ERR`, `meta-a/Gear.POS` and `meta-a/Spd.V` all have `"text"`
- **Evidence:** `apps/server/test/adx.test.ts` › "builds the catalog from the table's units and sentinels"

#### Scenario: No state name on a sentinel row
- **WHEN** on the seeded emulator `raw(meta-a/Gear.POS, B, B + 40 s)` runs with `text: true` on an adapter on `KMeta` with `snaTexts: ["SNA", "INVLD"]`, and `textLabel` (`apps/server/src/series.ts`) is applied to each point
- **THEN** the point at B + 20 s has value null and no label; the others have labels `P`, `D`, `R`
- **Evidence:** `apps/server/test/adx.test.ts` › "treats SNA texts as SNA in every value query" (same test as adx-source "Sentinels on the emulator")
