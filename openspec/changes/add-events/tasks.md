# Tasks

Every task has its own files and builds against the interfaces pinned in design E1–E9, F1–F5, N1–N3, V1–V11, C1, T. Group 1 lands the shared types and pure functions the others import; server, web and CLI engineers may stub them until they are in. Within web: 3.2–3.5 build on 3.1's pinned `marks.ts`/`eventsData.ts` signatures (stub until 3.1 lands); 3.3 passes the readout inputs whose signatures 3.4 pins (N3). The tester writes group 5 test-first, in parallel. Group 6 is the lead's. Jan's answers (D-058): default `active changes`, Events tab in the sidebar, the search-string grammar, IgnCurMode, BMS.contactor, changed snapshots count as changes. Expect two rounds: group 1 and 2.1 first if the round runs long. Builds on `add-diag-metadata` (D-061): 2.3 reads `SignalInfo.diag.kind` (M1) to mark diag enums as text states and to leave `kind` `text` out; stub `diag` as absent until it lands.

- 1.1: `packages/shared/src/events.ts` (new), `index.ts`
- 1.2: `packages/shared/src/eventFilter.ts` (new)
- 1.3: `packages/shared/src/states.ts` (new), `signals.ts`, `cursor.ts`, `series.ts`
- 1.4: `packages/shared/src/workspace.ts`, `apply.ts`
- 2.1: `apps/server/src/config.ts`, `datasource.ts`, `clickhouse.ts`, `.env.example`
- 2.2: `apps/server/src/events.ts` (new), `routes/events.ts` (new), `app.ts`
- 2.3: `apps/server/src/catalog.ts`, `dbc.ts`, `project.ts`, `main.ts`, `workspace.ts`, `series.ts`, `routes/series.ts`, `kipscope.yaml`, `kipscope.example.yaml`
- 3.1: `apps/web/src/events/marks.ts`, `events/list.ts`, `events/eventsData.ts` (new), `api.ts`, `styles.css`
- 3.2: `apps/web/src/time/TimeStrip.tsx`, `time/stripGeometry.ts`, `time/strip.css`
- 3.3: `apps/web/src/chart/TimeseriesWindow.tsx`, `chart/window.css`
- 3.4: `apps/web/src/chart/readout.ts`, `values/format.ts`, `values/ValuesWindow.tsx`
- 3.5: `apps/web/src/events/EventsPanel.tsx`, `events/events.css` (new), `layout/sidebar.ts`, `keys.ts`, `chart/drag.ts`, `App.tsx`, `explorer/SignalExplorer.tsx` (sidebar head only)
- 4.1: `apps/cli/src/args.ts`, `run.ts`, `output.ts`
- 5.1: `packages/shared/test/events.test.ts`, `eventFilter.test.ts`, `states.test.ts` (new), `apply.test.ts`, `cursor.test.ts`
- 5.2: `apps/server/scripts/seed-test-db.ts`, `apps/server/test/fixtures/test-a.dbc`, `globalSetup.ts`, `events.http.test.ts`, `events.test.ts` (new), `config.test.ts`, `project.test.ts`, `catalog.test.ts`, `value.http.test.ts`, `series.http.test.ts`, `signals.http.test.ts`, `workspace.http.test.ts`
- 5.3: `apps/web/test/eventMarks.test.ts`, `eventsPanel.test.ts` (new), `stripGeometry.test.ts`, `readout.test.ts`, `sidebar.test.ts`, `drag.test.ts`
- 5.4: `apps/cli/test/args.test.ts`, `cli.test.ts`, `process.test.ts`, `helpers.ts`

## 1. packages/shared

- [ ] 1.1 Events model (E2, E5, E6, E7 `signalEvents`): `EVENT_CATEGORIES`, `CATEGORY_TEXT`, `DiagEvent`, `SkipReason`, `EventList`, `EventRow`, `StateRow`, `MAX_EVENTS`, `MAX_SIGNAL_CHANGES`, `STATE_GAP`, `dtcCategory`, `dtcStatusText`, `deriveEvents`, `signalEvents`, `mergeEvents`; exported from the index (comments cite D-058, D-059 and the design). Verify: `pnpm --filter @kipscope/shared build`; scenarios "Status bytes", "Status text", "Derivation", "Rule on rows".
- [ ] 1.2 Filter (F1–F5): `DEFAULT_EVENT_FILTER`, limits, `FilterTerm`, `EventFilter`, `parseEventFilter`, `formatEventFilter`, `categoriesOf`, `compileEventFilter`, `describeEventFilter`, `EVENT_PRESETS`, `toggleCategory`, `toggleSource`. Verify: scenarios "Parsing", "Errors", "Matching the test events", "Round trip", "Descriptions", "Toggles".
- [ ] 1.3 State names (N1–N3): `DbcValueLabel.value`, `SignalInfo.states`; new `states.ts` with `valueLabels` (non-SNA VAL_ only), `stateLabel`, `shortLabel`; `CursorValue` `label`, `evaluateAt` `named` option (line mode holds next to a named point); `EdgePoint.label`, `RawSeries.text`. Verify: scenario "Names from values"; existing `cursor.test.ts` green.
- [ ] 1.4 Workspace (E8): `eventFilter`, `eventSignals`, `MAX_EVENT_SIGNALS`, the three commands, five error codes, `ApplyContext.hasStates`; `apply.ts` cases. Verify: scenarios "Set, default and reject", "Add and remove"; existing apply tests green (contexts gain `hasStates`).

## 2. apps/server/src

- [ ] 2.1 Source (E1, E4, E7 SQL): `EventMapping`, `TableMapping.text`, env vars; `DataSource.events`, `stateChanges`, `textSignals`, `RawPoint.text`; ClickHouse queries, `UNKNOWN_TABLE` → undefined, missing text column → `[]`. Verify: scenario "Default mapping"; after 5.2's seed: "Rows without time", "Signal changes in the test DB" (through 2.2).
- [ ] 2.2 Events endpoint and cache (E3): `EventsCache` (table, signal, prefetch, cap, warnings once per load), `GET /api/events` with skip reasons, range, counts, filter, errors; prefetch subscription; registered in `app.ts`. Verify: scenarios "No events table", "testcar events", "Server-side filter and range", "Skipped signals", "Bad requests", "Cache, prefetch, failure, cap", "Too many changes", "Waiting signal"; after the lead restarts the dev server: "Categories on smart451", "Changes on smart451", "Ignition on smart451", "Cost on carserver".
- [ ] 2.3 Catalog, project, workspace start, labels (N1, N3, E8, E9): `states` and label `value` in the catalog (text signals query per load); `events.signals` in `project.ts`; start `eventSignals` and `hasStates` in `main.ts`/`workspace.ts`; `/api/value` labels and held rule, `text` in raw series and edge points of text signals; `kipscope.yaml` and `kipscope.example.yaml` `events.signals` per E9. Verify: scenarios "States in the test catalog", "Reading the section", "Held across a state change", "Labels over HTTP", "Start value and HTTP"; after restart: "States on smart451".

## 3. apps/web/src

- [ ] 3.1 Marks, list helpers and data (V1, V2, V4, V8 helpers, V9): `events/marks.ts` (`groupMarks`, constants, `markColor`, `markTitle`), `events/list.ts` (`listRows`, `dayBands`), `events/eventsData.ts` (`useEvents`, `shownEvents`), `api.ts` `fetchEvents`, the four `--ev-*` tokens. Verify: scenarios "Pin geometry", "Glyph groups", "Tooltip text", "Long list".
- [ ] 3.2 Strip (V3, V5, V10 display): pin lane and hit spans, `Zone` pin, `hitZone` pins argument, `centre` action, `centreRange`, head count button (prop for the open-events callback), drop-target look and text; strip stays 55 px. Verify: scenarios "Zones", "Pin zones", "Centre math and gesture", "Pointer shapes", "Pins on smart451", "Pin click on smart451", "Count on smart451", `time-strip` "Strip on real data" (unchanged).
- [ ] 3.3 Chart marks (V6, V7): `events` prop, lines in `drawAxes`, glyphs in the headroom with titles, glyph click → `cursor.set`; passes `SignalInfo` and raw `text` into the readout functions of 3.4. Verify: scenarios "Marks on smart451", "Glyph click on smart451"; plot heights unchanged.
- [ ] 3.4 Readouts (N2, N3): `formatCell`, `readoutCell`, `deltaCell`/`readoutDelta` show short labels with titles and `=`/`≠`; L from drawn data names raw points and single-name buckets; values window passes `SignalInfo`. Verify: scenarios "Cell text", "Readouts on smart451".
- [ ] 3.5 Panel, sidebar, drop, wiring (V8, V9 App part, V10, V11): `EventsPanel` (heading, field with preview/Enter/Escape, description, presets, chips, events-line signals with `×`, day-banded list, row click centres), `Signals | Events` switch, `loadSidebarPart`/`saveSidebarPart`, `isEventsKey`, `eventsDrop` and the `events` drop target, App: shown events per data ref to strip, windows and panel, open-events function for the head count and `e`. Verify: scenarios "Panel on smart451", "Row click centres", "Preset in the UI", "Typing and Enter", "Shared with the CLI", "Switch and key e", "Stored part and key", "Drop on smart451", "Drop target mapping".

## 4. apps/cli/src

- [ ] 4.1 CLI (C1): tokenizer rule, `--ref`, `--table`, forms `events list|filter|add|remove`, list execution (workspace filter and signals, description, `local.t`), table output, usage text. Verify: scenarios "Forms map to commands", "Exclusions unquoted", "JSON and filter", "Table", "Over HTTP", "Help lists the forms", "Table only on success", "CLI value"; after restart: "Events on smart451".

## 5. Tests

- [ ] 5.1 Shared tests: `events.test.ts` › "maps DTC status bytes to categories", "decodes the status byte for people", "derives changes and snapshots per state name", "derives state changes of a signal"; `eventFilter.test.ts` › "parses words, keys, phrases and exclusions", "reports errors with their position", "matches events by categories, facets and text" (the 18 testcar events of design T as `DiagEvent`s), "normalises and round-trips", "describes a filter in words", "switches categories and sources in the string"; `states.test.ts` › "finds the state name of a value", "shortens CODE: labels"; `apply.test.ts` › "sets the event filter in normal form", "adds and removes events-line signals"; `cursor.test.ts` › line mode next to a named point is held. Verify: `pnpm --filter @kipscope/shared test`.
- [ ] 5.2 Server tests on the test DB: seed exactly as design T (header comment updated), `test-a.dbc` `VAL_` tables, `globalSetup.ts` checks 19 event rows; `events.http.test.ts` › "lists the events of testcar with categories", "answers no events without an events table", "filters on the server", "rejects bad parameters", "reports skipped signals", "adds the state changes of listed signals", "waits for a listed signal until it is recorded"; `events.test.ts` › "caches per catalog load and prefetches", "keeps the first 100,000 events", "skips a signal with more than 2,000 changes"; `config.test.ts` › "reads the events mapping"; `project.test.ts` › "reads events.signals"; `catalog.test.ts` › "marks signals with states"; `value.http.test.ts` › "holds and names state values"; `series.http.test.ts` › "carries the text of a text signal"; `signals.http.test.ts` 1,017 → 1,021; `workspace.http.test.ts` › "applies the events commands over HTTP". Verify: `pnpm --filter @kipscope/server seed:test && pnpm --filter @kipscope/server test`.
- [ ] 5.3 Web tests: `eventMarks.test.ts` › "clusters events into pins", "groups events into chart glyphs", "formats pin tooltips"; `eventsPanel.test.ts` › "caps the list at 500 rows"; `stripGeometry.test.ts` › pin cases in "finds the hit zone", centre case in "computes jump, brush, pan and resize ranges", pin cases in "turns pointer sequences into strip actions"; `readout.test.ts` › "shows state names in readout cells"; `sidebar.test.ts` › "loads and saves the sidebar part", "opens the events with e outside text fields and selects"; `drag.test.ts` › events cases in "maps drop elements to targets". Verify: `pnpm --filter @kipscope/web test`.
- [ ] 5.4 CLI tests: stub source with the 18 testcar event rows, `stateChanges`, `textSignals` and the test DBC labels in `helpers.ts`; `args.test.ts` › events forms in "maps every command form to its command", "keeps single-dash words as arguments"; `cli.test.ts` › "lists events with the workspace filter or the given one", "prints events as a table", "sets the event filter and events-line signals over HTTP", state case in "reads a value at a time and at a cursor", forms in "prints the usage with --help"; `process.test.ts` › table case in "prints the reason of a failure on stderr". Verify: `pnpm --filter @kipscope/cli test`.

## 6. Lead

- [ ] 6.1 Reseed the test DB and restart the dev server before the checks of 2.2, 2.3, 3.x and 4.1; do the hand check of design "Manual checks" (drag BLS onto the strip, remove it) and send Jan the screenshots.

## Workflow follow-up

- On archive: copy the ledger entry of design.md into `docs/decisions.md` (Jan's answers are in D-058).
