# Proposal

## Why

Jan (2026-10-16): „in the chart windows. lines are drawn throgh times with no data. what can we do, how can we do? better display nothing than smthn wrong". Today a line joins any two consecutive points, however far apart (D-009), and an aggregated curve joins buckets across empty stretches. On smart451 the logger was silent 24 times for 2 s or more (22 of them 20 min to 27.7 h, the car off), and cyclic signals drop out for 0.3–1.3 s in drives (e.g. `STR_0D4h.STEER_ANGLE`, 10 ms, nothing for 800 ms at 2026-10-13 09:34:36.204 UTC). The lines run straight through, and a cursor there shows a value interpolated across hours.

D-062 (Jan, supersedes D-009):
- „A line breaks where the logger recorded nothing at all (every signal), and where a cyclic signal skips more than 3 of its periods (period from the DBC, the diagnostic catalog, else measured). Signals without a known or measurable period break only at logger gaps. The same holds for buckets when zoomed out."
- „Gaps stay blank; logger gaps also get a faint grey band so "no data" reads as intended."
- „A cursor (A, B, L) inside a gap shows „no data", never a value interpolated across it."

## What Changes

- **Periods per signal:** from the DBC (`BA_ "GenMsgCycleTime" BO_ <id> <ms>`, 0 = none), else from the diagnostic catalog (group `interval`, e.g. `30s`; `never` = none), else measured from the signal's first 1,001 rows: the median spacing, accepted only if at least 100 spacings and at most 5 % of them longer than 3 medians (a cyclic signal, not a burst). smart451 (553 signals): 408 from the DBC, 29 from the diag catalog, 94 measured (93 cell voltages at 0.5 s, `MEAS_DCU` at 10 ms), 22 without a period (event and one-shot signals).
- **Logger gaps per data ref:** two consecutive rows of the data ref (any signal) at least 2 s apart, found exactly from per-second minimum and maximum row times in one query per catalog load (smart451: 24 gaps, 7 s, 14 MB on carserver).
- **The gap rule (shared by server and web):** consecutive points of a signal are split when a logger gap lies between them or, with a period P, when they are more than 3 P apart. A split pair draws no line; a step holds the earlier value for at most one period and never into a logger gap. Buckets: split when the empty stretch between two buckets is longer than 3 P, or when a logger gap lies between their drawn points; a slow signal's naturally empty buckets stay joined.
- **`GET /api/gaps?dataRef=`:** logger gaps and every signal's period with its source, computed on each catalog load and again when the data ref's row count changes (design G9), prefetched like the density.
- **Display:** split pairs stay blank in every timeseries window, raw and aggregated, mean and envelope; logger gaps get a faint grey band (`--gap-fill`) under grid and curves; an SNA mark ends where the hold ends.
- **Cursors:** a value inside a split is `{kind: "none", reason: "logger_gap" | "period_gap"}` from `/api/value` (A, B, values window, `kipscope value`) and from the drawn data (L, drags). Cells read `no data` with the reason as tooltip; Δ with it is `—`.
- **Stale gaps (G9, Jan 2026-10-17):** a logger gap that holds a drawn sample splits nothing and draws no band; the server polls each data ref's row count every 5 min and recomputes its gap info after new rows (backfilled chunks included); the web refetches it every 5 min.
- **Test data:** a new data ref `gapcar` with a 60 s and a 2 s logger pause, a 1.9 s silence that is not one, a cyclic DBC signal with a dropout and a 3-period spacing that is not one, an event signal, a measured signal and a diag reading with missed polls; test fixtures gain a cycle time and a group interval.

**Out of scope:** SNA classification (D-010, D-014, D-015 unchanged); choices of interpolation mode beyond gaps; showing periods or gaps in the hover card, the time strip or the CLI beyond `value`; a switch to turn gaps off; persisting gap info; per-signal overrides of a period in `kipscope.yaml`; the time strip's density after a backfill; incremental gap computation.

## Depends on

- **`add-events`** (D-058, D-059; being built now, build this change after it): `evaluateAt`'s `named` parameter and the `label` on raw and held values (design N3), the event lines drawn in the chart's `drawAxes` hook (V6; the gap bands go below them), and its scenario "Readouts on smart451", whose cursor B (10:40 local) lies in the logger gap 08:31:12.966–09:06:56.446 UTC: this change moves B to 12:13 local (delta `state-names`). Its own "after a gap" rule for inferred state changes (5 min, design E7) is a different notion and stays.
- **`add-diag-metadata`** (D-061; built, not archived): `SignalInfo.diag` with its `group`; this change adds `intervalMs` to `DiagInfo`. `SignalInfo.unit` is untouched.

Both should be archived before this one, so that the `state-names` delta and the `signal-catalog` additions apply to their main specs.

## Capabilities

### New Capabilities

- `data-gaps`: signal periods (sources, measurement), logger gaps of a data ref, the rule that splits two points or two buckets, and `GET /api/gaps`.

### Modified Capabilities

- `series-query`: "Value at a time" no longer interpolates or holds across a split; new "No value across a gap".
- `signal-catalog`: new "Message period from the DBC" and "Group interval from the diagnostic catalog".
- `timeseries-window`: "Raw display modes", "No invented values", "SNA periods marked", "Isolated valid points stay visible" respect gaps; new "Lines break at gaps", "Gaps in aggregated views", "Logger gap bands", "Gap info loads with the window".
- `cursors`: "Readout without a value" names the gap reasons and the `no data` text.
- `live-cursor`: "L without a value" adds the gaps.
- `values-window`: "SNA and missing values at a cursor" adds the gaps.
- `cli`: new "Value in a gap".
- `series-cache`: new "Gaps across tile edges".
- `design-language`: new "Gap band look".
- `state-names` (from `add-events`): "State names at the cursors" moves cursor B out of a logger gap.

## Impact

- `packages/shared/src`: new `gaps.ts` (constants, DTO, gap rule, period measurement); `cursor.ts` (`NoValueReason`, `evaluateAt` gains `gaps`); `signals.ts` (`DbcInfo.cycleMs`, `DiagInfo.intervalMs`).
- `apps/server/src`: `dbc.ts` (cycle time), `diag.ts` (interval), `datasource.ts` + `clickhouse.ts` (`loggerGaps`, `firstTimes`), new `gaps.ts` (`GapCache`), `routes/series.ts` (`/api/gaps`, gaps in `/api/value`).
- `apps/web/src`: new `chart/gaps.ts` (fetch and cache), `chart/build.ts` (breaks, SNA lanes), `chart/readout.ts` (reasons from drawn data), `chart/TimeseriesWindow.tsx` (bands, settle), `values/format.ts` (`no data` cells), `styles.css` (`--gap-fill`).
- CLI: no code (passes `value` through); its stub source gains the two data source methods.
- Test data: `seed-test-db.ts` (`gapcar`), `test-a.dbc`, `test-diag.manifest.json`.
- Load: one more full scan per data ref and catalog load (logger gaps), one batched sample query (periods); no change to series queries.
