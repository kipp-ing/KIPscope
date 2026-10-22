## MODIFIED Requirements

### Requirement: Signal metadata
The catalog SHALL return for each signal its name and, where available, its description, alias and unit. Metadata the source lacks SHALL come from configured metadata files: DBC files and diagnostic catalogs (manifest plus names file, see "Diagnostic catalog names"). Where neither gives a unit and the source lists one for the signal's rows (ADX `KIPSCOPE_COLUMN_UNIT`), the catalog SHALL take that unit, per data reference. Missing fields SHALL be reported as absent, not as empty strings or invented values. Origin: concept §4 („Vorhandene Metadaten werden angezeigt"); diagnostic catalogs: D-061 („KIPscope reads the diagnostic catalog (manifest + names) like the DBC files"); table unit: D-100 („used when no DBC or diag unit exists, per data ref").

#### Scenario: Unit from DBC
- **WHEN** a signal `ENG_2E8h.MOT_SPD_D` has data and the DBC defines unit and comment for signal `MOT_SPD_D` in message `ENG_2E8h`
- **THEN** the catalog entry shows that unit and the comment as description

#### Scenario: Signal not in any DBC
- **WHEN** a signal has data but neither a DBC entry nor a diagnostic catalog field (`testcar/Nodbc_500h.RAW`)
- **THEN** the catalog lists it with its name only and no unit, description, alias, `dbc` or `diag`
- **Evidence:** `apps/server/test/catalog.test.ts` › "lists a signal without DBC entry with its name only" (unchanged `toEqual`, catalog built with the fixture diag catalog)

#### Scenario: Unit from the table
- **WHEN** a `Catalog` whose DBC loader defines `TBMS.current` (unit `mA`) and `Nounit_600h.P` (no unit), with the fixture diag catalog, is refreshed over a stub source listing `car/TBMS.current` (unit `A`), `car/Nounit_600h.P` (unit `bar`), `car/Nodbc_500h.RAW` (unit `V`), `a/X.Y` (unit `km/h`), `b/X.Y` (unit `mph`), a fixture diag signal that has a diag unit (listed unit `zz`), and `car/Plain.SIG` (no unit)
- **THEN** the entries have units `mA`, `bar` (with its `dbc`), `V` (no `dbc`, no `diag`), `km/h`, `mph`, the diag unit, and no `unit` key for `car/Plain.SIG`
- **Evidence:** `apps/server/test/catalog.test.ts` › "takes the table unit when no DBC or diag unit exists"

### Requirement: Metadata source precedence
DBC files SHALL be read first, then the diagnostic catalogs in list order; for a signal name defined by more than one source the first one SHALL win whole (no merging of fields), and each catalog load SHALL warn once, naming at most 10 such signals with data. The unit listed by the source for a data reference's rows SHALL come last: it fills only the unit, only of an entry whose winning metadata has none, and never produces a warning. Origin: necessary consequence (two sources can name one signal; D-011 D6 "first file wins" for DBC); DBC first because SNA rules (D-010, D-014, D-015) exist only for DBC entries; table unit last: D-100 („used when no DBC or diag unit exists").

#### Scenario: DBC wins
- **WHEN** a `Catalog` whose DBC loader defines `TBMS.current` (unit `mA`) and whose diag loader is the fixture is refreshed twice over a stub source listing `car/TBMS.current`
- **THEN** the entry has unit `mA`, a `dbc` and no `diag`, and the warning `diag catalog: 1 signals also in a DBC, the DBC wins: TBMS.current` is logged exactly twice, once per load
- **Evidence:** `apps/server/test/catalog.test.ts` › "DBC wins over a diag catalog and warns once per load"

#### Scenario: Earlier catalog wins
- **WHEN** `loadDiagCatalogs` reads the fixture manifest twice (two list entries, same path)
- **THEN** the result has the 18 fixture names once, from the first entry, and one warning `…test-diag.manifest.json: 18 signals already named by an earlier catalog, the earlier wins: …`
- **Evidence:** `apps/server/test/diag.test.ts` › "keeps the earlier catalog's signals"

#### Scenario: Table unit never overrides
- **WHEN** the catalog of "Unit from the table" is refreshed twice
- **THEN** `car/TBMS.current` keeps `mA` and the diag signal its diag unit on both loads, and the only warning logged per load is the existing `diag catalog: … the DBC wins: TBMS.current` line (none about units)
- **Evidence:** `apps/server/test/catalog.test.ts` › "takes the table unit when no DBC or diag unit exists"

### Requirement: Signal hover card
Resting the pointer on a row, or making it active by keyboard, for 350 ms SHALL open a card with name, description, message and CAN ID, unit, scaling, raw step, DBC range, SNA codes, value table, source (data reference, DBC file) and the windows showing the signal. Absent fields SHALL be omitted, never shown empty or invented. A signal without DBC entry and diagnostic catalog field whose unit came from the source's table SHALL show its source as `<dataRef> · unit from the table`, not as `<dataRef> · no DBC entry`. Origin: D-017 („mit hover infos"); fields: power-user report point 4; keyboard: D-020; 350 ms is a goal; table unit: necessary consequence of D-100 (a unit next to "no DBC entry" reads as if the unit were invented), wording is open question Q-3.

#### Scenario: Card for SPEED_DISP
- **WHEN** the user hovers `ICL_3A2h.SPEED_DISP` on real data and the signal is shown in one window
- **THEN** after about a third of a second a card shows `ICL_3A2h.SPEED_DISP`, `Indicated speed`, `ICL_3A2h · 0x3A2`, unit `km/h`, scaling `× 1 + 0`, raw step `1 km/h`, range `0 … 510 km/h`, SNA `511 km/h (raw 1FFh)`, values `511 SNV`, source `smart451 · h-can.dbc`, and under "Shown in" that window's name as its header shows it (its title, or `Window <n>` when untitled)
- **Evidence:** UI check (screenshot of the card)

#### Scenario: Card with offset
- **WHEN** the user hovers `ENG_5E0h.T_ENG` on real data
- **THEN** the card shows scaling `× 1 - 40`, raw step `1 °C`, range `-40.0 … 214 °C`, and "Shown in" reads `no window` when no window shows it
- **Evidence:** UI check (screenshot of the card); `apps/web/test/explorer.test.ts` › "formats scaling, raw step and DBC range"

#### Scenario: Card formatting rules
- **WHEN** a signal has DBC range `[0|0]`, an extended CAN ID, no DBC entry, or no DBC entry and no diag field but a unit
- **THEN** the range reads `not set`, the ID reads in hex with bit 31 cleared and `(ext)`, a signal without DBC entry shows its source as `<dataRef> · no DBC entry` with no message, scaling, range, SNA or value lines, and one with only a unit shows `<dataRef> · unit from the table`; a unit next to a DBC entry or a diag field leaves those lines as they are (`<dataRef> · <file>`, `<dataRef> · DBC`, the diag line)
- **Evidence:** `apps/web/test/explorer.test.ts` › "formats scaling, raw step and DBC range", "formats message IDs as hex", "formats the source line" (extended), "lists the windows showing a signal"

#### Scenario: Card for a table unit
- **WHEN** the UI user opens the server of adx-source "Server on the emulator" (the lead's second server on port 7311, started after `pnpm build` with `KIPSCOPE_WEB_DIR=apps/web/dist` so it serves the UI) and hovers `Spd.V` of `meta-a` in the explorer
- **THEN** the card shows unit `km/h`, source `meta-a · unit from the table`, and no message, scaling, range, SNA or value lines
- **Evidence:** UI check (screenshot of the card)

#### Scenario: Card on keyboard focus
- **WHEN** the user types `WSPD_FL`, presses ArrowDown once and waits
- **THEN** the card for the second row opens without any pointer movement, and moving the active row moves the card
- **Evidence:** UI check (screenshot)

#### Scenario: No flicker while sweeping
- **WHEN** the user moves the pointer quickly down across ten rows without resting
- **THEN** no card opens; once a card is open, moving to a neighbouring row switches the card at once
- **Evidence:** UI check (description of the observed behaviour)
