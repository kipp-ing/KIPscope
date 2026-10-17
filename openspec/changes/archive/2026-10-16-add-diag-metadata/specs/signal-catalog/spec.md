## MODIFIED Requirements

### Requirement: Signal metadata
The catalog SHALL return for each signal its name and, where available, its description, alias and unit. Metadata the source lacks SHALL come from configured metadata files: DBC files and diagnostic catalogs (manifest plus names file, see "Diagnostic catalog names"). Missing fields SHALL be reported as absent, not as empty strings or invented values. Origin: concept §4 („Vorhandene Metadaten werden angezeigt"); diagnostic catalogs: D-061 („KIPscope reads the diagnostic catalog (manifest + names) like the DBC files").

#### Scenario: Unit from DBC
- **WHEN** a signal `ENG_2E8h.MOT_SPD_D` has data and the DBC defines unit and comment for signal `MOT_SPD_D` in message `ENG_2E8h`
- **THEN** the catalog entry shows that unit and the comment as description

#### Scenario: Signal not in any DBC
- **WHEN** a signal has data but neither a DBC entry nor a diagnostic catalog field (`testcar/Nodbc_500h.RAW`)
- **THEN** the catalog lists it with its name only and no unit, description, alias, `dbc` or `diag`
- **Evidence:** `apps/server/test/catalog.test.ts` › "lists a signal without DBC entry with its name only" (unchanged `toEqual`, catalog built with the fixture diag catalog)

## ADDED Requirements

### Requirement: Diagnostic catalog names
The server SHALL read the diagnostic catalogs of `KIPSCOPE_DIAG_CATALOGS` (default smart451's `bms-live.manifest.json`), each with the names file next to it, on every catalog load, and SHALL name each field's signals as the decoder does: `<ECU>.<name>` if named, else `<ECU>.<group>.<field>`; arrays `.<n>`, 1-based, zero-padded (design M3). Origin: D-061; ESPCars `docs/sdlog-decode-spec.md` §7.2; data fact: all 125 `BMS.*` signals match a field.

#### Scenario: Fixture names
- **WHEN** `parseDiagCatalog` reads `test-diag.manifest.json` with `test-diag.names.toml` (design M6)
- **THEN** it yields exactly 18 names: `TBMS.cell_voltage.01` … `TBMS.cell_voltage.12`, `TBMS.current`, `TBMS.contactor`, `TBMS.vin`, `TBMS.DT_Pack.PRES_Temp_2Byte`, `TBMS.DT_Pack.PRES_Flag` and `TBMS.DT_Ident_B.PRES_VIN_17Byte`; the inline names `"DT_Pack/PRES_Temp_2Byte" = "temp"` and `"DT_Cell_Voltage_Cell/PRES_Cell_2Byte" = "cell"` give `TBMS.temp` and `TBMS.cell.01` … `.12`
- **Evidence:** `apps/server/test/diag.test.ts` › "names fields like the decoder"

#### Scenario: Real catalog names
- **WHEN** the real `bms-live.manifest.json` and `bms-live.names.toml` are read (test runs if the files exist)
- **THEN** there are 498 names, among them `BMS.cell_voltage.001` and `BMS.cell_voltage.200`, `BMS.contactor`, `BMS.soc` and `BMS.vin`, and no warning
- **Evidence:** `apps/server/test/diag.test.ts` › "reads the real bms-live catalog"

#### Scenario: Config
- **WHEN** `loadConfig` runs without `KIPSCOPE_DIAG_CATALOGS`, and with `KIPSCOPE_DIAG_CATALOGS=a.manifest.json, /abs/b.manifest.json`
- **THEN** `diagCatalogs` is `[<root>/../CarController/vehicles/smart451/uds/bms-live.manifest.json]`, then `[<root>/a.manifest.json, /abs/b.manifest.json]`
- **Evidence:** `apps/server/test/config.test.ts` › "defaults to the carserver sdlog mapping", "applies overrides" (both extended)

### Requirement: Diagnostic catalog details per signal
For a signal with a diagnostic catalog field the catalog SHALL return the field's unit when not blank, and `diag` (design M1) with the enum's state rows and the invalid rows. Invalid rows SHALL NOT become SNA codes. Origin: D-061 („unit, enum state names and invalid sentinels per `BMS.*` signal"); no SNA: data fact (the decoder stores no invalid value, 0 of 494,084 `BMS.*` rows; as SNA, a sentinel's physical 0 would hide 48 valid 0 A rows of `BMS.current`).

#### Scenario: Fixture details
- **WHEN** `parseDiagCatalog` reads the fixture pair
- **THEN** `TBMS.cell_voltage.03` has unit `V` and `diag` `{file: "test-diag.manifest.json", ecu: "TBMS", group: "DT_Cell", did: 520, field: "PRES_Cell_2Byte", element: 3, kind: "number", invalid: [{low: 65535, high: 65535, text: "Signal not available"}]}`; `TBMS.contactor` has no unit, kind `enum`, states `open` 0, `precharge` 1, `closed` 2 and invalid 3 and 255; `TBMS.vin` kind `text`, no unit, no states, no invalid; `TBMS.DT_Pack.PRES_Temp_2Byte` unit `°C` (manifest `" °C "`), no invalid; `TBMS.DT_Pack.PRES_Flag` no unit
- **Evidence:** `apps/server/test/diag.test.ts` › "carries unit, kind, states and invalid rows"

#### Scenario: Diag metadata over HTTP
- **WHEN** a catalog over a stub source listing `testcar/TBMS.cell_voltage.01`, `testcar/TBMS.contactor`, `testcar/TBMS.unknown` and `testcar/Nodbc_500h.RAW` loads the test DBCs and the fixture diag catalog, and `GET /api/signals?q=TBMS` is read
- **THEN** `TBMS.cell_voltage.01` has `unit` `V` and `diag.element` 1, `TBMS.contactor` has `diag.kind` `enum` and three states, neither has `sna` or `dbc`; `TBMS.unknown` has name only
- **Evidence:** `apps/server/test/signals.http.test.ts` › "diag catalog over HTTP" › "returns diag metadata"

#### Scenario: Merged into the catalog
- **WHEN** a `Catalog` is built with the fixture diag loader over a stub source listing `car/TBMS.current` and `car/TBMS.contactor`
- **THEN** `get("car/TBMS.current")` equals `{id, dataRef: "car", name: "TBMS.current", unit: "A", diag: {…, kind: "number", invalid: [{low: -32768, high: -32768, text: "SNA"}]}}` and `snaRanges("car/TBMS.current")` is `[]`
- **Evidence:** `apps/server/test/catalog.test.ts` › "merges diag catalog metadata"

### Requirement: Units from the diagnostic catalog on real data
On smart451 every `BMS.*` signal with a unit in the manifest SHALL carry it, so that cell voltages share one `V` axis and count as one unit in a window. Origin: D-061 („Cell voltages then share one `V` axis"); Jan: „each cell voltage has its axle"; axes and unit limit: existing "One y-axis per unit" (timeseries-window, D-018) and MAX_UNITS, unchanged.

#### Scenario: Unit counts on carserver
- **WHEN** after a server restart `curl -s 'localhost:7310/api/signals?q=BMS.&limit=200' | jq -c '[.items[] | select(.name|startswith("BMS.")) | .unit // "none"] | group_by(.) | map({(.[0]): length}) | add'` runs
- **THEN** it prints `{"%":4,"A":1,"V":103,"kOhm":1,"none":9,"°C":7}`; `curl -s 'localhost:7310/api/signals?q=BMS.contactor' | jq -cS '.items[0].diag'` prints `{"did":53248,"ecu":"BMS","field":"PRES_Contactor_State","file":"bms-live.manifest.json","group":"DT_Contactor_Contactor_State","invalid":[{"high":3,"low":3,"text":"signal not available"},{"high":255,"low":255,"text":"Signal not available"}],"kind":"enum","states":[{"high":0,"low":0,"text":"open"},{"high":1,"low":1,"text":"precharge"},{"high":2,"low":2,"text":"closed"}]}`
- **Evidence:** the two commands

#### Scenario: Cell voltages share one axis
- **WHEN** on smart451 the user adds `BMS.cell_voltage.001` … `BMS.cell_voltage.005` to one empty timeseries window over a range with diag data (e.g. 2026-10-13 11:00–11:20 local) and searches the explorer for `cell_voltage.00`
- **THEN** all five are accepted (today the fifth is refused with "a window shows at most 4 units"), the window draws one y axis titled `V` and the five curves lie on it; the explorer rows show unit `V`
- **Evidence:** UI check on smart451 at 1440×900 (one screenshot of the window and the explorer)

### Requirement: Metadata source precedence
DBC files SHALL be read first, then the diagnostic catalogs in list order; for a signal name defined by more than one source the first one SHALL win whole (no merging of fields), and each catalog load SHALL warn once, naming at most 10 such signals with data. Origin: necessary consequence (two sources can name one signal; D-011 D6 "first file wins" for DBC); DBC first because SNA rules (D-010, D-014, D-015) exist only for DBC entries.

#### Scenario: DBC wins
- **WHEN** a `Catalog` whose DBC loader defines `TBMS.current` (unit `mA`) and whose diag loader is the fixture is refreshed twice over a stub source listing `car/TBMS.current`
- **THEN** the entry has unit `mA`, a `dbc` and no `diag`, and the warning `diag catalog: 1 signals also in a DBC, the DBC wins: TBMS.current` is logged exactly twice, once per load
- **Evidence:** `apps/server/test/catalog.test.ts` › "DBC wins over a diag catalog and warns once per load"

#### Scenario: Earlier catalog wins
- **WHEN** `loadDiagCatalogs` reads the fixture manifest twice (two list entries, same path)
- **THEN** the result has the 18 fixture names once, from the first entry, and one warning `…test-diag.manifest.json: 18 signals already named by an earlier catalog, the earlier wins: …`
- **Evidence:** `apps/server/test/diag.test.ts` › "keeps the earlier catalog's signals"

### Requirement: Diagnostic catalog problems per load
A diagnostic catalog problem SHALL never stop the server or a catalog load: an unusable manifest SHALL be skipped, a missing or unparsable names file SHALL leave that manifest's fields with their catalog names, and a names entry that cannot apply SHALL be ignored (cases: design M3). Each problem SHALL be logged once per catalog load with the path and, for entries, the key. Origin: necessary consequence: missing metadata never blocks data display (as "DBC warnings per load", design H5).

#### Scenario: Bad names entries
- **WHEN** `parseDiagCatalog` reads the fixture manifest with the inline names `PRES_VIN_17Byte = "a"`, `Nope = "b"`, `"0x0999/PRES_Flag" = "c"`, `DT_Pack_Current = "current"`, `"0x0204/PRES_Temp_2Byte" = "9x"`, `"DT_Pack/PRES_Flag" = "current"` and `"0x0204/DT_Pack_Current" = "amps"` (in this order)
- **THEN** only `DT_Pack_Current = "current"` applies (`TBMS.current`); six warnings name the keys `PRES_VIN_17Byte` (ambiguous), `Nope` (no such field), `0x0999/PRES_Flag` (no group), `0x0204/PRES_Temp_2Byte` (not a name), `DT_Pack/PRES_Flag` (name already given) and `0x0204/DT_Pack_Current` (field already named), each ending `entry ignored`
- **Evidence:** `apps/server/test/diag.test.ts` › "ignores bad names entries with a warning"

#### Scenario: Missing names file, broken manifest
- **WHEN** `loadDiagCatalogs` reads, in this order: the fixture pair, a copy of the fixture manifest without names file next to it (temp dir), a missing path, a JSON file with `format` `uds-catalog-manifest/2`
- **THEN** the pair yields its 18 names; the copy adds `TBMS.DT_Cell.PRES_Cell_2Byte.01` … `.12`, `TBMS.DT_Pack.DT_Pack_Current`, `TBMS.DT_Contactor.PRES_Contactor_State` and `TBMS.DT_Ident_A.PRES_VIN_17Byte` (catalog names; 33 names in all); exactly four warnings: the copy's names file missing (`fields keep their catalog names`), the copy's 3 names already named by the pair (`TBMS.DT_Pack.PRES_Temp_2Byte`, `TBMS.DT_Pack.PRES_Flag`, `TBMS.DT_Ident_B.PRES_VIN_17Byte`), the missing manifest skipped, the foreign format skipped
- **Evidence:** `apps/server/test/diag.test.ts` › "skips missing and foreign manifests, falls back without names file"

#### Scenario: Server starts without the catalog
- **WHEN** the server starts with `KIPSCOPE_DIAG_CATALOGS=/nonexistent.manifest.json`
- **THEN** it serves the catalog as before this change (`BMS.*` without unit) and logs `diag catalog: /nonexistent.manifest.json skipped: …` once per catalog load
- **Evidence:** `apps/server/test/catalog.test.ts` › "logs diag catalog warnings once per load" (stub loader reporting one problem per load, two refreshes, two warnings)
