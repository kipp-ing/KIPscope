# Proposal

## Why

Jan (2026-10-16): „if you look now: each cell voltage has its axle" (D-061). The 125 `BMS.*` readings on carserver (D-058) have no DBC entry, so no unit, and every unit-less signal gets its own y axis and counts as its own unit: a window shows at most four cell voltages, each on its own scale. The decoder's diagnostic catalog knows them: `CarController/vehicles/smart451/uds/bms-live.manifest.json` (100 fields, units V, °C, %, A, kOhm, …, enum state names, invalid sentinels) and `bms-live.names.toml` (field → signal name). Checked against the live catalog: all 125 `BMS.*` signals map to a catalog field; 116 get a unit (`V` 103, `°C` 7, `%` 4, `A` 1, `kOhm` 1), 9 have none (7 enums, 2 text fields).

D-061 (lead, on Jan's report): „KIPscope reads the diagnostic catalog (manifest + names) like the DBC files: unit, enum state names and invalid sentinels per `BMS.*` signal. Cell voltages then share one `V` axis."

## What Changes

- **Diagnostic catalogs as a metadata source:** a new env list `KIPSCOPE_DIAG_CATALOGS` of manifest paths (default: smart451's `bms-live.manifest.json`, like `KIPSCOPE_DBC_FILES`); each manifest's names file sits next to it (`<base>.names.toml`). Read on every catalog load, like the DBC files.
- **Signal names as the decoder makes them** (ESPCars `sdlog-decode-spec.md` §7.2): `<ECU>.<name>` for a named field, `<ECU>.<group>.<field>` otherwise, arrays `.<n>` 1-based, zero-padded to the width of the element count.
- **Metadata per signal:** `SignalInfo.unit` from the field's unit (absent when blank); a new optional `SignalInfo.diag` with file, ECU, group, DID, field, element, kind (`number` / `enum` / `text`), the enum's state rows and the invalid sentinel rows. No description (the manifest has none).
- **Invalid sentinels are carried, not matched as SNA:** the decoder writes no row for an invalid value (§7.2; 0 such rows among smart451's 494,084 `BMS.*` rows), and a sentinel row's physical value is 0 (factor 0), so matching it would hide the 48 valid `BMS.current` = 0 A rows. D-010 holds at the source; `SignalInfo.sna` stays absent for diag signals.
- **Precedence:** DBC files first, then the diag catalogs in list order; the first source that names a signal wins, and each catalog load warns once about signals named by more than one source (none on smart451).
- **Missing or broken files never block:** an unreadable manifest is skipped with a warning; a missing names file leaves every field with its catalog name; a names entry that resolves to no field or to several is ignored with a warning. The server starts either way.
- **Effect in the UI, no web code:** axes and the unit limit already key on `unit` (one scale per unit, D-018). Cell voltages share one `V` axis, and a window accepts more than four of them.

**Boundary with `add-events` (D-059, written in parallel):** this change only puts the catalog's metadata on `SignalInfo` (field names pinned in design M1). Which signals have states, state names at the cursors, the events line and anything that reads `diag.states` belong to `add-events`. Note for it: a diag enum row stores value 0 and its state in the row's text, so `diag.states` lists the possible names but does not map stored values to them.

**Out of scope:** state names at the cursors, the events line, text states as labelled bands (D-058, D-059: `add-events`); showing `diag` details in the hover card, legends or CLI; descriptions for diag signals; reading the binary `.dcat`; per-data-ref catalogs (metadata is keyed by name, as for DBC); catalogs of other ECUs beyond accepting a list; changes to axes or the unit limit.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `signal-catalog`: "Signal metadata" names the diagnostic catalog as a second metadata source; new "Diagnostic catalog names", "Diagnostic catalog details per signal", "Units from the diagnostic catalog on real data", "Metadata source precedence" and "Diagnostic catalog problems per load".

## Impact

- `packages/shared/src/signals.ts`: `DiagScaleRow`, `DiagInfo`, `SignalInfo.diag`.
- `apps/server/src`: new `diag.ts` (`parseDiagCatalog`, `loadDiagCatalogs`), `config.ts` (`diagCatalogs`, `KIPSCOPE_DIAG_CATALOGS`), `catalog.ts` (optional diag loader, merge, precedence warning), `main.ts` (wiring).
- Dependency: `smol-toml` (server, exact version, no dependencies of its own) for the names file.
- Files: `.env.example`, `README.md`; test fixtures `apps/server/test/fixtures/test-diag.manifest.json`, `test-diag.names.toml`.
- Payloads only gain optional fields; `unit` appears on signals that had none. No stored data, no web change.
