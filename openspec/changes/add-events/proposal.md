# Proposal

## Why

carserver now decodes diagnostic data (D-058). Besides 125 numeric `BMS.*` readings (already plottable, grouped as `BMS (diag)`) there is a new table `sdlog.events`: on smart451 385 rows of four kinds (55 DTCs read at one instant, 326 state rows, 2 negative responses, 2 ISO-TP errors). Jan: „the events line is great. however we need a filter. it can get super overwhelming. the filter also needs cli. it needs human way of thinking too." Raw, the table is mostly noise to a person: 38 of the 55 DTCs only say "test not completed", 304 of the 326 state rows repeat a state already known, and the NRC and ISO-TP rows matter only when the logger itself is debugged. What a person wants first fits in 51 rows: 13 active faults, 22 state changes, 16 ignition changes.

D-059 adds state signals: many CAN signals carry `VAL_` names (`CPC_168h.IgnCurMode` 3 = `KEYON`) and the diag states carry their name in `sdlog.signals.text` (`BMS.contactor` „open"), but cursor readouts show bare numbers (`3`, or `0` for every diag state). Jan: „the coursers shall show the statename. like OFF. and if one drags a signal with stats to horizon. the changes are marked. … automatically only two things (yaml define) IGN and contactor state".

## What Changes

- **Events from the source (D-058):** the server reads a data ref's events once per catalog load and interprets them into ten human categories (active, pending, stored fault; not tested; passed; state change; state snapshot; request refused; transport error; other): DTC status bytes by their ISO 14229 bits, state rows by comparing with the previous state of the same name (a changed snapshot is a change seen after a gap). New `GET /api/events`.
- **State changes of signals (D-059):** signals with named states (a `VAL_` table or a diag enum with a name that is not SNA, or text in `sdlog.signals.text`) can be put on the events line by dragging them onto the time strip or by CLI; their state changes become events of category "state change" with the signal as source. `kipscope.yaml` lists the signals that are on the line from the start (shipped: `CPC_168h.IgnCurMode` and `BMS.contactor`, D-058 answers). A listed signal that is not recorded yet waits quietly and shows once it is. Change detection is one ordered query per signal that returns only changed rows (measured 0.05–0.19 s on 87 k–874 k rows).
- **One filter (D-058):** a short, human filter string, the same in UI and CLI: words for what a person looks for (`faults`, `changes`, `active`, `logger`, `all`, `none`), `ecu:`, `name:`, free text, `-` to exclude (`faults bms`, `all -snapshots -untested`, `changes contactor`). The workspace holds it (`events.setFilter`), so UI and CLI share it, with `--wait`. Default `active changes` (D-058, Jan's answer). The UI says in words what the filter shows ("Active faults and state changes") and how much it hides ("51 of 402 events").
- **Display (D-058):** event pins in a lane at the top of the time strip (clustered within 6 px), vertical marks with glyphs in the chart windows, hover shows code, description, category, time; click on a strip pin centres the view on it, click on a chart glyph puts cursor A on it; an Events tab in the sidebar with presets, category and ECU chips, the filter field and the list (click centres). The strip head shows the shown/total count.
- **State names at the cursors (D-059):** A, B and L readouts in legends, the values window and `kipscope value` show the state name (`KEYON`, `open`) where the value has one; an interpolation never runs into or out of a named state. SNA stays SNA (D-010).
- **CLI:** `events list [FILTER…]` (JSON, or `--table` for people), `events filter FILTER…`, `events add SIGNAL`, `events remove SIGNAL`.

**Out of scope:** text states as labelled bands (D-058, still a flat 0 in the plot); units, enum names and invalid sentinels of the BMS readings themselves (change `add-diag-metadata`, D-061, which this change builds on); persistence of the filter or the events-line signals beyond the project file's start value; editing `kipscope.yaml` from the app; label maps in `kipscope.yaml` for signals without `VAL_` (D-058 (Jan's answers)); events of more than one data ref in one list; keys to step from event to event (a later `stepEvent` like `stepDrive`); per-window filters; refreshing events while the server runs (they follow the catalog load, like the density); state names for buckets whose values differ (L on coarse zoom shows the number as today); DTC clear or freeze-frame data.

## Depends on

`add-diag-metadata` (D-061, in parallel): it puts the diagnostic catalog's units, enum state names and invalid sentinels of the `BMS.*` signals on `SignalInfo`. This change reads those enum names as state names (next to `VAL_` tables and the row text) and those sentinels as SNA, and does not specify how they are loaded. If it lands later, diag signals simply have no enum names until then.

## Capabilities

### New Capabilities

- `events`: events of a data ref (source table, column mapping, categories, DTC status, changes vs. snapshots), state changes of events-line signals, the project file's events-line signals, `GET /api/events`, the events panel.
- `event-filter`: the filter string (grammar, meaning, normal form, description, presets, chip toggles), its place in the workspace and its command.
- `state-names`: which signals have named states, the state name of a value, state names in readouts and `/api/value`, text of text-state signals in series data.

### Modified Capabilities

- `time-strip`: event pins lane, pin hit zone (added to the zones), pin tooltips, events count in the head, drop of a signal onto the strip.
- `timeseries-window`: event marks and glyphs in the plot; glyph click places a cursor.
- `workspace-state`: `eventFilter` and `eventSignals` in the workspace, commands `events.setFilter`, `events.addSignal`, `events.removeSignal`.
- `workspace-layout`: Signals | Events switch in the sidebar, key `e`.
- `cli`: `events` forms, `--table`, single-dash filter terms; "One JSON result per call" gains the `--table` exception.

## Impact

- `packages/shared/src`: new `events.ts` (DTO, categories, DTC status, derivation), `eventFilter.ts` (grammar, match, describe, presets, toggles), `states.ts` (state names); `workspace.ts` (fields, commands, error codes), `apply.ts`, `signals.ts` (`SignalInfo.states`, `DbcValueLabel.value`), `cursor.ts` (labels in values), `series.ts` (`RawSeries.text`, `EdgePoint.label`), `index.ts`.
- `apps/server/src`: `config.ts` (events mapping, text column), `datasource.ts` and `clickhouse.ts` (`events`, `stateChanges`, `textSignals`, text in raw/before/after), new `events.ts` (cache, prefetch), new `routes/events.ts`, `catalog.ts` (`states`, label values), `dbc.ts` (physical label values), `project.ts` (`events.signals`), `workspace.ts`/`main.ts` (start value, apply context), `series.ts` and `routes/series.ts` (labels).
- `apps/server/scripts/seed-test-db.ts`: `sdlog.events` table, `text` column, state signals; `apps/server/test/fixtures/test-a.dbc`: two `VAL_` tables (tester).
- `apps/web/src`: new `events/` (data, panel, marks geometry, css), `time/TimeStrip.tsx` and `stripGeometry.ts` (pins, zone, centre action, drop), `chart/TimeseriesWindow.tsx` (marks, glyphs, labels in readouts), `values/ValuesWindow.tsx` (labels), `App.tsx`, `layout/sidebar.ts`, `keys.ts`, `chart/drag.ts` (events drop target), `styles.css` (event tokens).
- `apps/cli/src`: `args.ts`, `run.ts`, `output.ts` (table).
- `kipscope.yaml`, `kipscope.example.yaml`: `events.signals`.
- Payloads: new `GET /api/events`; additive fields in `SignalInfo`, `DbcValueLabel`, `CursorValue`, `EdgePoint`, `RawSeries`, `Workspace`; new commands and error codes. No new dependency, no stored data, no migration.
