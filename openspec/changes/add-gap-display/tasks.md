# Tasks

Build after `add-events` (its `evaluateAt` `named`, `label`, `holdAcrossRange`, chart event lines) and on top of `add-diag-metadata` (`DiagInfo`). Every task has its own files; all build in one round against the interfaces pinned in design G1–G7. Group 1 lands the types the others import; engineers of groups 2 and 3 may stub them until it is in. The tester writes group 4 test-first, in parallel.

- 1.1: `packages/shared/src/gaps.ts` (new), `signals.ts`, `cursor.ts`, `index.ts`
- 2.1: `apps/server/src/dbc.ts`, `diag.ts`, `catalog.ts`
- 2.2: `apps/server/src/datasource.ts`, `clickhouse.ts`
- 2.3: `apps/server/src/gaps.ts` (new), `routes/series.ts`
- 3.1: `apps/web/src/api.ts`, `apps/web/src/chart/gaps.ts` (new)
- 3.2: `apps/web/src/chart/build.ts`, `chart/readout.ts`
- 3.3: `apps/web/src/chart/TimeseriesWindow.tsx`, `values/format.ts`, `values/values.css`, `styles.css`
- 4.1: `apps/server/scripts/seed-test-db.ts`, `apps/server/test/fixtures/test-a.dbc`, `test-diag.manifest.json`, `apps/server/test/globalSetup.ts`
- 4.2: `packages/shared/test/gaps.test.ts` (new), `cursor.test.ts`
- 4.3: `apps/server/test/gaps.test.ts` (new), `gaps.http.test.ts` (new), `value.http.test.ts`, `dbc.test.ts`, `diag.test.ts`, `catalog.test.ts`, `signals.http.test.ts`, `testdb.ts`
- 4.4: `apps/web/test/build.test.ts`, `readout.test.ts`, `live.test.ts`, `values.test.ts`, `gaps.test.ts` (new)
- 4.5: `apps/cli/test/helpers.ts`, `cli.test.ts`

## 1. packages/shared

- [x] 1.1 Gap rule and types (G1, G3 measurement, G4, G5): new `gaps.ts` (constants, `GapInfo` DTO, `SignalGaps`, `Split`, `staticPeriod`, `measurePeriod`, `loggerGapBetween`, `loggerGapAt`, `splitPoints`, `splitBuckets`, `signalGaps`, `NO_GAPS`); `DbcInfo.cycleMs?`, `DiagInfo.intervalMs?`; `NoValueReason` gains `logger_gap`, `period_gap`; `evaluateAt` gains `gaps` (G4 order); exports. Verify: `pnpm --filter @kipscope/shared build && pnpm --filter @kipscope/shared test`; scenarios "Cyclic and bursty samples", "Period and logger splits", "Slow signal at fine buckets, dropout, logger gap", "Pure evaluation".

## 2. apps/server/src

- [x] 2.1 Periods from metadata (G3): `parseDbc` reads `GenMsgCycleTime` (own value, else `BA_DEF_DEF_` default; 0 = none) per message onto its signals; the diag manifest group's optional `interval` (`ms`/`s`/`min`/`h`; `never` silent; other text warns once per load); `catalog.ts` copies `cycleMs` into `DbcInfo` and `intervalMs` into `DiagInfo`. Verify: scenarios "Test DBC", "Test catalog", then after a server restart "Real DBCs", "Real catalog" (curl).
- [x] 2.2 Data source (G2, G3): `DataSource.loggerGaps` and `DataSource.firstTimes` (interface docs as G6); ClickHouse implementations with the SQL of G2 and G3 through the table mapping, abort passed on, no query for an empty name list. Verify: `pnpm --filter @kipscope/server build`; scenario "Test data logger gaps" once 2.3 is in.
- [x] 2.3 Gap cache and routes (G6): new `GapCache` (once per catalog load, shared, failure dropped, prefetch in turn, stopped by a newer load); `seriesRoutes`: gap prefetch after the density prefetch, `GET /api/gaps` with its errors, `/api/value` evaluates with `signalGaps` and answers 502 without gap info. Verify: scenarios "Test data periods", "Test data logger gaps", "Once, shared, retried after failure", "Errors", "Three periods are not a gap", "Cyclic signal with a dropout and a logger pause", "Event, measured and diag signals", "Gap info unavailable"; then on the dev server "smart451 periods", "smart451 logger gaps", "Real signal in a logger gap and in a dropout", "Real dropout" (CLI), "Load on carserver".

## 3. apps/web/src

- [x] 3.1 Gap info in the tab (G7 "Gap info"): `fetchGaps`; `chart/gaps.ts` with the tab cache, shared in-flight request, 30 s retry while asked for, `useGapInfo`, `bandsIn`. Verify: scenarios "Once per tab, failure retried", "Bands of a view".
- [x] 3.2 Breaks and drawn values (G7 "Breaks", "Drawn value"): `SignalInput.gaps`; raw breaks with step hold points before `holdBeforeSna` (which never moves a gap break), state-signal step segments and the synthetic edge hold end at the hold end (design G7 "Every hold obeys G4"); bucket breaks in mean, min and max; `snaPeriods` ends at the hold end; `chartValueAt` gains `gaps` (logger gap, split stretch, else as today). Verify: scenarios "Breaks in raw data", "Window inside a split", "Buckets of a dropout and of a slow signal", "SNA point before a split", "One valid point between two splits", "State signal holds stop at gaps", "Drawn data in a gap", "Dropout at a tile edge".
- [x] 3.3 Window, bands and cells (G7 "Cells", "Window"): `useGapInfo` for the window's data refs, gaps into inputs and readouts, bands in a `drawClear` hook (`#f1f5f9`, ≥ 1 CSS px), settled only with gap info, gap-info errors as render errors; `no data` cells (`Cell.gap`, class `gap-value`, reasons' tooltips); `--gap-fill` token. Verify: `pnpm build && pnpm lint`; UI scenarios below.

## 4. Tests

- [x] 4.1 Test data (T): `gapcar` rows exactly as the table in T (32,187 rows), header comment; `test-a.dbc` messages 2832/2833 and the cycle-time attribute lines (ISO-8859-1, CRLF kept); `test-diag.manifest.json` intervals; `globalSetup.ts` checks the gapcar row count. Verify: `pnpm --filter @kipscope/server seed:test`, then `SELECT count() FROM sdlog.signals WHERE vehicle = 'gapcar'` = 32187.
- [x] 4.2 Shared tests: `gaps.test.ts` ("measures a period only from cyclic samples", "splits points by period and by logger gaps", "splits buckets only where a gap is certain"); `cursor.test.ts` ("returns no value across a gap"). Verify: `pnpm --filter @kipscope/shared test`.
- [x] 4.3 Server tests: `gaps.test.ts` (stub source: "computes gap info once per catalog load and drops a failure", "answers 502 for a value without gap info"); `gaps.http.test.ts` ("lists the logger gaps and periods of gapcar", "finds no logger gap where the logger never paused", "answers gap info errors like the density route"; catalog with `testDbcFiles` and `testDiagCatalogs`); `value.http.test.ts` ("evaluates across gaps"); `dbc.test.ts` ("reads GenMsgCycleTime per message", incl. an inline text with default 100); `diag.test.ts` ("reads group intervals", incl. an inline copy with `2 sec`); catalog counts 1,021 → 1,025 in `catalog.test.ts` and `signals.http.test.ts`; `toEqual`s that now include `cycleMs`/`intervalMs`. Verify: `pnpm --filter @kipscope/server test`.
- [x] 4.4 Web tests: `build.test.ts` ("breaks lines and steps at gaps", "breaks buckets only where a gap is certain", "ends an SNA mark at the hold end", "draws a point between two splits as a marker", "breaks a gap across a tile edge like one request", "ends state signal holds at gaps"); `readout.test.ts` ("reads gaps from the drawn data", "reads gaps as no data, and Δ as —"); `live.test.ts` ("reads SNA and gaps without a number and never highlights them" gains a gap case); `values.test.ts` ("formats gaps as no data"); `gaps.test.ts` ("fetches gap info once per data ref and retries a failure", "lists the logger gaps a view shows"). Verify: `pnpm --filter @kipscope/web test`.
- [x] 4.5 CLI (G8): stub source `loggerGaps`, `firstTimes`, SPEED point 12 at 02:00:05Z; `cli.test.ts` › "reads a value at a time and at a cursor" gains the gap case. Verify: `pnpm --filter @kipscope/cli test`.

## UI check (UI user, smart451, 1440×900, no task)

- timeseries-window: "Dropout in a drive", "Day overview", "Band in a drive", "Settled with breaks".
- cursors: "Cursors in a gap"; live-cursor: "Hover over a logger gap band"; values-window: "Inside gaps"; design-language: "Computed look"; state-names: "Readouts on smart451" (moved B).

## Workflow follow-up

- On archive (after `add-events` and `add-diag-metadata` are archived): copy the ledger entry of design.md into `docs/decisions.md`.
