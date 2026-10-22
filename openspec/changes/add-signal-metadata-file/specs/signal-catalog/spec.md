## MODIFIED Requirements

### Requirement: Signal metadata
The catalog SHALL return for each signal its name and, where available, its description, alias and unit. Metadata the source lacks SHALL come from configured metadata files: DBC files, signal metadata files (capability `signal-metadata-file`) and diagnostic catalogs (manifest plus names file, see "Diagnostic catalog names"). Missing fields SHALL be reported as absent, not as empty strings or invented values. Origin: concept §4 („Vorhandene Metadaten werden angezeigt"); diagnostic catalogs: D-061 („KIPscope reads the diagnostic catalog (manifest + names) like the DBC files"); metadata files: D-099 („KIPscope reads a third metadata source").

#### Scenario: Unit from DBC
- **WHEN** a signal `ENG_2E8h.MOT_SPD_D` has data and the DBC defines unit and comment for signal `MOT_SPD_D` in message `ENG_2E8h`
- **THEN** the catalog entry shows that unit and the comment as description

#### Scenario: Signal not in any DBC
- **WHEN** a signal has data but neither a DBC entry, a metadata-file entry nor a diagnostic catalog field (`testcar/Nodbc_500h.RAW`)
- **THEN** the catalog lists it with its name only and no unit, description, alias, `dbc`, `meta` or `diag`
- **Evidence:** `apps/server/test/catalog.test.ts` › "lists a signal without DBC entry with its name only" (unchanged `toEqual`, catalog built with the fixture diag catalog); "merges metadata file entries" (`car/Nodbc_500h.RAW` next to the fixture's names)

#### Scenario: Unit and description from a metadata file
- **WHEN** a `Catalog` with the fixture metadata file (design F9) over a stub source listing `car/META.SPEED`, `car/META.MODE` and `car/Nodbc_500h.RAW` is loaded
- **THEN** `get("car/Nodbc_500h.RAW")` is `{id, dataRef: "car", name: "Nodbc_500h.RAW"}` only; `get("car/META.SPEED")` has unit `km/h`, description `Indicated speed`, `meta.file` `test-metadata.json`, `meta.cycleMs` 100 and no `dbc` or `diag`; `get("car/META.MODE")` has description `Drive mode`, no unit and `states` `"labels"`
- **Evidence:** `apps/server/test/catalog.test.ts` › "merges metadata file entries"

### Requirement: SNA values per signal
The catalog SHALL return for each signal the values its DBC marks as "signal not available" (SNA): each as raw code and as the physical value the source stores; for a signal whose metadata comes from a metadata file, the SNA values the file gives, each as the physical value given and its raw code where given. A signal without SNA definition (no DBC or metadata-file entry, or none defined) SHALL report no SNA values, not an empty list. Origin: D-010, D-012; metadata files: D-099 („SNA values as physical values"; „SNA values turn values into gaps in the queries").

#### Scenario: Speed with SNA code 1FFh
- **WHEN** the catalog lists `smart451/ICL_3A2h.SPEED_DISP` (9 bit, factor 1, offset 0, `GenSigSNA "1FFh"`, `VAL_ 511 "SNV"`)
- **THEN** its entry reports exactly one SNA value: raw 511, physical 511
- **Evidence:** `apps/server/test/dbc.test.ts` › "derives SNA values from the real h-can.dbc" (runs if the real DBC exists); command `curl -s 'localhost:7310/api/signals?q=ICL_3A2h.SPEED_DISP'` shows `"sna":[{"raw":511,"value":511,...}]`

#### Scenario: Signal without DBC entry
- **WHEN** a signal has data but no DBC entry (`testcar/Nodbc_500h.RAW`)
- **THEN** its catalog entry has no `sna` field
- **Evidence:** `apps/server/test/catalog.test.ts` › "lists a signal without DBC entry with its name only" (unchanged `toEqual`)

#### Scenario: SNA ranges from a metadata file
- **WHEN** a `Catalog` with the fixture metadata file over a stub source listing `car/META.SPEED`, `car/META.WSPD` and `car/META.MODE` is loaded
- **THEN** `snaRanges("car/META.SPEED")` is `[{lo: 510.5, hi: 511.5}]` (factor 1), `snaRanges("car/META.WSPD")` is `[{lo: 8191.25, hi: 8191.75}]` (factor 0.5), `snaRanges("car/META.MODE")` is `[]` and its entry has no `sna`
- **Evidence:** `apps/server/test/catalog.test.ts` › "takes SNA ranges from a metadata file"

#### Scenario: Metadata-file SNA turns values into gaps
- **WHEN** a `Catalog` over the test DB whose metadata-file loader gives `Nodbc_500h.RAW` (100 points, values `number % 2`) the SNA value 1 serves a raw series query over all its points
- **THEN** the series holds 100 points, 50 of them with value `null` (the ones stored as 1) and 50 with value 0
- **Evidence:** `apps/server/test/series.test.ts` › "nulls the SNA value from a metadata file"

### Requirement: Metadata source precedence
DBC files SHALL be read first, then the metadata files in list order, then the diagnostic catalogs in list order; for a signal name defined by more than one source the first one SHALL win whole (no merging of fields), and each catalog load SHALL warn once per losing source kind and winning source kind, naming at most 10 such signals with data. Origin: necessary consequence (two sources can name one signal; D-011 D6 "first file wins" for DBC); DBC first because SNA rules (D-010, D-014, D-015) exist only for DBC entries; metadata files before diagnostic catalogs: design F6 (Q1).

#### Scenario: DBC wins
- **WHEN** a `Catalog` whose DBC loader defines `TBMS.current` (unit `mA`) and whose diag loader is the fixture is refreshed twice over a stub source listing `car/TBMS.current`
- **THEN** the entry has unit `mA`, a `dbc` and no `diag`, and the warning `diag catalog: 1 signals also in a DBC, the DBC wins: TBMS.current` is logged exactly twice, once per load
- **Evidence:** `apps/server/test/catalog.test.ts` › "DBC wins over a diag catalog and warns once per load"

#### Scenario: Earlier catalog wins
- **WHEN** `loadDiagCatalogs` reads the fixture manifest twice (two list entries, same path)
- **THEN** the result has the 18 fixture names once, from the first entry, and one warning `…test-diag.manifest.json: 18 signals already named by an earlier catalog, the earlier wins: …`
- **Evidence:** `apps/server/test/diag.test.ts` › "keeps the earlier catalog's signals"

#### Scenario: Three sources
- **WHEN** a `Catalog` with the test DBCs, the fixture metadata file and the fixture diag catalog is refreshed twice over a stub source listing `car/Fast_100h.SIG_C`, `car/TBMS.current` and `car/TBMS.contactor`
- **THEN** `Fast_100h.SIG_C` has a `dbc`, its DBC unit and no `meta`; `TBMS.current` has unit `mA`, a `meta` and no `diag` or `sna`; `TBMS.contactor` keeps its `diag`; the warnings `metadata file: 1 signals also in a DBC, the DBC wins: Fast_100h.SIG_C` and `diag catalog: 1 signals also in a metadata file, the metadata file wins: TBMS.current` are each logged exactly twice, once per load
- **Evidence:** `apps/server/test/catalog.test.ts` › "DBC, then metadata file, then diag catalog"

#### Scenario: One entry for every data ref
- **WHEN** a `Catalog` with the fixture metadata file over a stub source listing `car1/META.SPEED` and `car2/META.SPEED` is loaded
- **THEN** both entries carry the same unit, description, `meta` and `sna`
- **Evidence:** `apps/server/test/catalog.test.ts` › "applies a metadata file entry to every data ref"

### Requirement: Signal hover card
Resting the pointer on a row, or making it active by keyboard, for 350 ms SHALL open a card with name, description, message and CAN ID, unit, scaling, raw step, range, SNA codes, value table, source (data reference, and the DBC file, metadata file or diagnostic catalog) and the windows showing the signal. Details SHALL come from the DBC entry or the metadata-file entry, whichever the signal has. Absent fields SHALL be omitted, never shown empty or invented. Origin: D-017 („mit hover infos"); fields: power-user report point 4; keyboard: D-020; metadata files and `no metadata`: D-099; 350 ms is a goal.

#### Scenario: Card for SPEED_DISP
- **WHEN** the user hovers `ICL_3A2h.SPEED_DISP` on real data and the signal is shown in one window
- **THEN** after about a third of a second a card shows `ICL_3A2h.SPEED_DISP`, `Indicated speed`, `ICL_3A2h · 0x3A2`, unit `km/h`, scaling `× 1 + 0`, raw step `1 km/h`, range `0 … 510 km/h`, SNA `511 km/h (raw 1FFh)`, values `511 SNV`, source `smart451 · h-can.dbc`, and under "Shown in" that window's name as its header shows it (its title, or `Window <n>` when untitled)
- **Evidence:** UI check (screenshot of the card)

#### Scenario: Card with offset
- **WHEN** the user hovers `ENG_5E0h.T_ENG` on real data
- **THEN** the card shows scaling `× 1 - 40`, raw step `1 °C`, range `-40.0 … 214 °C`, and "Shown in" reads `no window` when no window shows it
- **Evidence:** UI check (screenshot of the card); `apps/web/test/explorer.test.ts` › "formats scaling, raw step and DBC range"

#### Scenario: Card formatting rules
- **WHEN** a signal has range `[0|0]`, an extended CAN ID, or no metadata at all (no DBC entry, metadata-file entry or diagnostic catalog field)
- **THEN** the range reads `not set`, the ID reads in hex with bit 31 cleared and `(ext)`, and a signal without metadata shows its source as `<dataRef> · no metadata` with no message, scaling, range, SNA or value lines
- **Evidence:** `apps/web/test/explorer.test.ts` › "formats scaling, raw step and DBC range", "formats message IDs as hex", "formats the source line" (expects `smart451 · no metadata`), "lists the windows showing a signal"

#### Scenario: Card lines of a metadata-file signal
- **WHEN** the card's formatting reads a signal with `meta` `{file: "adx.metadata.json", message: "ICL_3A2h", messageId: 930, factor: 0.5, offset: 0}` and sna `[{value: 8191.5, sources: ["metadata"]}]`, unit `1/min`, digits 3; then one with `meta` `{file: "adx.metadata.json"}` only
- **THEN** source reads `adx · adx.metadata.json`, message `ICL_3A2h · 0x3A2`, scaling `× 0.5 + 0`, the SNA line `8.19 k1/min` (no raw part); for the second, `formatMessage` gives no Message line and the source still reads `adx · adx.metadata.json`; a DBC SNA value with raw 16383 reads `8.19 k1/min (raw 3FFFh)`
- **Evidence:** `apps/web/test/explorer.test.ts` › "formats the source line", "formats the message line", "formats SNA lines with and without raw"

#### Scenario: Card from a metadata file on real data
- **WHEN** the dev server runs with `KIPSCOPE_METADATA_FILES=apps/server/test/fixtures/ui-metadata.json` (design F9) and the user hovers `BMS.soc` on smart451
- **THEN** the card shows `State of charge (metadata file)`, unit `%`, range `0 … 100 %`, source `smart451 · ui-metadata.json`, and no Message, Scaling or SNA line; after a restart without the variable the card shows the diagnostic catalog source again
- **Evidence:** UI check (one screenshot of the card with the file)

#### Scenario: Card on keyboard focus
- **WHEN** the user types `WSPD_FL`, presses ArrowDown once and waits
- **THEN** the card for the second row opens without any pointer movement, and moving the active row moves the card
- **Evidence:** UI check (screenshot)

#### Scenario: No flicker while sweeping
- **WHEN** the user moves the pointer quickly down across ten rows without resting
- **THEN** no card opens; once a card is open, moving to a neighbouring row switches the card at once
- **Evidence:** UI check (description of the observed behaviour)

## ADDED Requirements

### Requirement: Metadata file details per signal
For a signal whose metadata comes from a metadata file the catalog SHALL return `meta` with the file's basename and the entry's message, message ID, factor, offset, min, max, cycle time and value table (sorted by raw) where the entry gives them, plus unit, description and SNA values; absent fields stay absent. A metadata-file signal SHALL have no `dbc` and no `diag`. Origin: D-099 (unit, description, value table, SNA, optional range and cycle; "value tables give state names").

#### Scenario: Metadata over HTTP
- **WHEN** a catalog over a stub source listing `adx/META.SPEED`, `adx/META.TEMP` and `adx/Nodbc_500h.RAW` loads the fixture metadata file, and `GET /api/signals?q=META` is read
- **THEN** `META.SPEED` has `meta` `{file: "test-metadata.json", message: "ICL_3A2h", messageId: 930, factor: 1, offset: 0, min: 0, max: 510, cycleMs: 100, values: [{raw: 511, label: "SNV", value: 511}]}` and `sna` `[{raw: 511, value: 511, sources: ["metadata"]}]`; `META.TEMP` has unit `°C` and `meta.values` `[{raw: 0, label: "COLD", value: -40}]`; neither has `dbc` or `diag`
- **Evidence:** `apps/server/test/signals.http.test.ts` › "metadata file over HTTP" › "returns metadata file details"

#### Scenario: Value labels and SNA in shared helpers
- **WHEN** `valueLabels`, `stateLabel`, `isSnaValue` and `labelTolerance` read a signal with `meta` `{file, factor: 0.5, values: [{raw: 1, label: "on", value: 0.5}, {raw: 3, label: "SNA", value: 1.5}]}` and sna `[{value: 1.5, sources: ["metadata"]}]`
- **THEN** `labelTolerance` is 0.25, `valueLabels` is `[{value: 0.5, label: "on"}]`, `stateLabel(…, 0.6)` is `on`, `isSnaValue(…, 1.6)` is true and `isSnaValue(…, 1.0)` false; the same signal without `factor` has `labelTolerance` 0.5
- **Evidence:** `packages/shared/test/states.test.ts` › "reads labels, SNA and tolerance from a metadata file"
