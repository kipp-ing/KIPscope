# Proposal

## Why

On ADX every signal without a DBC or diagnostic catalog entry has no unit and no SNA: KIPscope reads both only from metadata files keyed by the signal name. Some ADX tables carry this per row instead (issue #1, last comment, M3 "Units and SNA from the table"): a unit column, and a text column that holds either a state name (`FALSE`, `ACV_ST`) or a sentinel (`SNA`, `INVLD`). State names already work through `KIPSCOPE_COLUMN_TEXT`; units and sentinels do not. A sentinel row today counts as a valid value and, worse, makes its signal a text (state) signal.

Jan decided (D-100, 2026-10-22, „ja gut"): "No metadata file. The ADX source reads units and SNA from the table (M3): optional `KIPSCOPE_COLUMN_UNIT`, read by the scoped signal list in its existing summarize and used when no DBC or diag unit exists, per data ref; optional `KIPSCOPE_SNA_TEXTS` (e.g. `SNA,INVLD`): a row whose text is in the list is SNA (a gap, no label), and such texts alone do not make a signal a state signal. State names keep coming from `KIPSCOPE_COLUMN_TEXT`."

## What Changes

- **Unit column (ADX):** optional `KIPSCOPE_COLUMN_UNIT`. `listSignals` adds `take_anyif(<unit>, isnotempty(<unit>))` to the summarize it already runs (scoped and unscoped share the query; still one query). Each listed signal carries the unit of its rows, per data ref.
- **Catalog:** an entry takes the listed unit only when neither its DBC entry nor its diagnostic catalog field gives one. Two data refs with the same signal name can have different table units.
- **SNA by text (ADX):** optional `KIPSCOPE_SNA_TEXTS` (comma list, exact match). Every value query treats a row whose text is in the list as SNA, exactly as a value in a DBC SNA range: value null (a gap, no state name), counted in the bucket's SNA count, left out of state changes, returned as an SNA neighbour. Such rows do not make their signal a text signal.
- **Config:** both variables are ADX only; with ClickHouse either one set is a config error. A configured unit column that does not exist fails the catalog load; SNA texts with a missing text column fail it too, with a message naming both variables. Unset, every query text is as before.
- **Hover card:** a signal without DBC entry and diag field whose unit came from the table shows its source as `<dataRef> · unit from the table` instead of `<dataRef> · no DBC entry`.
- **Docs and fixtures:** both variables in `docs/data-sources.md` and `.env.example`; an emulator table `KMeta` with unit and sentinel rows for the ADX tests.

No `packages/shared` or HTTP payload change: `SignalInfo.unit` exists; the catalog fills it from one more source.

## Non-goals

- M1 (several databases in one source) and M2 (signals by logical name) of the same comment: separate changes (D-100 consequences).
- ClickHouse support for the unit column or SNA texts (open question Q-1 in design.md).
- Description, range, cycle or value tables from the table (D-100: "not needed for this").
- A metadata file or alias catalog (D-099, superseded).
- Metadata of a signal that has no rows in the scope (D-096 backlog): the table unit is read only from the scope's rows.
- Showing SNA texts in the hover card's SNA line or anywhere else in the UI.
- Case-insensitive or trimmed matching of row text against the SNA list.
- Picking a "right" unit when rows of one signal in one data ref disagree (`take_anyif` takes any).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `adx-source`: unit column and SNA texts (configuration, the signal list query, the value queries), the missing-column rules, the emulator fixture.
- `data-source`: a listed signal may carry a unit; the adapter guide documents it.
- `signal-catalog`: the table unit as the last metadata source; the hover card's source line for it.
- `state-names`: sentinel texts alone do not make a signal a text signal.

## Impact

- `apps/server/src/config.ts` (two variables, ADX only), `apps/server/src/datasource.ts` (`SourceSignal.unit`), `apps/server/src/adx.ts` (`listSignals`, the SNA predicate of every value query), `apps/server/src/catalog.ts` (unit precedence).
- `apps/web/src/explorer/format.ts` (`formatSource`).
- `docs/data-sources.md`, `.env.example`.
- Tests: `apps/server/test/config.test.ts`, `catalog.test.ts`, `adxQueries.test.ts`, `adx.test.ts` (emulator), `apps/server/scripts/seed-adx.ts` (table `KMeta`), `apps/web/test/explorer.test.ts`. The conformance fixture and the ClickHouse test DB stay unchanged.
