# Tasks

Grouped by write area (docs/team.md): engineers own groups 1 and 2, the tester owns group 3, so the three can run in parallel against the interfaces pinned in design.md (S4–S8). Test names are those the specs cite as evidence.

## 1. packages/shared + apps/server/src

- [ ] 1.1 Add `SnaSource`, `SnaValue`, `SignalInfo.sna` and the nullable series fields (`EdgePoint.v`, `RawSeries.v`, `BucketSeries.sna/mean/min/max`) exactly as in design S4; verify `pnpm build` type-checks all packages
- [ ] 1.2 Extend `parseDbc` per design S1 (bit length, sign, factor, offset, `GenSigSNA`, `VAL_` SNA/SNV union, `"0h"` rule, D-014 exemptions: valid `VAL_` label beats `GenSigSNA`, no `GenSigSNA` on 1-bit and checksum/CRC signals, two's complement) and `DbcSignal.sna` per S6; verify the `dbc.test.ts` tests "unites GenSigSNA and VAL_ SNA/SNV labels", "lets a valid VAL_ label beat GenSigSNA", "ignores GenSigSNA on 1-bit and checksum signals", "treats GenSigSNA 0h as no SNA", "converts signed SNA codes with two's complement" and "derives SNA values from the real h-can.dbc" pass
- [ ] 1.3 Copy SNA values into `SignalInfo.sna` and add `Catalog.snaRanges(id)` (value ± tolerance) per S6; verify `catalog.test.ts` passes, including "lists a signal without DBC entry with its name only", and `curl -s 'localhost:7310/api/signals?q=COMBI_412h.V_ANZ'` shows `"sna":[{"raw":511,"value":511,"sources":["GenSigSNA","VAL_"]}]`
- [ ] 1.4 Change `DataSource`, `RawPoint`, `Bucket` and `SeriesRef` per S6 and implement the ClickHouse predicate and queries per S3 (constant `0` without ranges), passing refs through `queue.ts`; verify the `series.test.ts` SNA tests from 3.3 pass and the existing series tests stay green
- [ ] 1.5 Map raw points, neighbors and buckets onto the S4 payload in `querySeries`, pass `catalog.snaRanges(id)` from the series route, and answer 503 `catalog_unavailable` (signal and range named) before the catalog has ever loaded; verify the `series.http.test.ts` tests from 3.4 pass and `curl -s 'localhost:7310/api/series?signal=smart451/COMBI_412h.V_ANZ&from=2026-10-13T09:56:59Z&to=2026-10-13T09:57:01Z' | jq -c '.v'` prints 8 zeros, 3 `null`, 9 zeros

## 2. apps/web/src

- [ ] 2.1 In `chart/build.ts`: nullable `SignalPoints`, `toPoints` with SNA nulls (neighbors included), `snaPeriods`, `snaShare`, `formatSnaShare`, `isolatedPoints`, `ChartModel.sna` lanes, step-mode hold points and null-skipping `yRange`, all per design S7; verify the `build.test.ts` tests from 3.5 pass
- [ ] 2.2 In `chart/TimeseriesWindow.tsx`: join with null mode 2 for every y column, `spanGaps: false`, `stepped({align: 1})`, `points.filter` with `isolatedPoints` for line paths, and a `draw` hook painting the SNA lanes (6 px strips, ≥ 2 px wide, 60 % opacity) per S7; verify by UI check that V_ANZ in 2026-10-13T09:56:59Z–09:57:01Z shows no line to 511 and marks for both V_ANZ and DVL
- [ ] 2.3 Show `formatSnaShare(snaShare(result))` per signal in the window's signal list, and the `SNA <values> <unit>` line with raw-hex tooltip in `SignalExplorer.tsx` per S7; verify by UI check: `SNA 15.0 %` / `SNA 23.0 %` in the engine-start window and `SNA 511 km/h` for `COMBI_412h.V_ANZ` in the explorer

## 3. Tests (apps/*/test, fixtures, seed script)

- [ ] 3.1 Add message `Sna_800h` with nine signals (six seeded, plus DBC-only `FLAG`, `LEVEL`, `CRC_800h`), `BA_DEF_`/`BA_DEF_DEF_` and the `GenSigSNA`/`VAL_` lines to `apps/server/test/fixtures/test-a.dbc`, and the six `Sna_800h.*` series plus updated spot checks (21,613,857 rows, 1,013 signals, 203 SPEED values of 511) to `apps/server/scripts/seed-test-db.ts`, all per design S8; verify `pnpm --filter @letsview/server seed:test` prints only `ok` lines
- [ ] 3.2 Write `dbc.test.ts` tests "unites GenSigSNA and VAL_ SNA/SNV labels" (MODE {6, 7}), "lets a valid VAL_ label beat GenSigSNA" (LEVEL {7}), "ignores GenSigSNA on 1-bit and checksum signals" (FLAG, CRC_800h no `sna`), "treats GenSigSNA 0h as no SNA", "converts signed SNA codes with two's complement" (fixture) and "derives SNA values from the real h-can.dbc" (runs if the file exists: V_ANZ {511→511}, DVL {16383→8191.5}, DNMOT {255→128}, OC_P_Fast_SRS raws {0}, ESP_DSPL raws {30, 31}, CLU_TYPE raws {15}, no `sna` on `YRG_156h.MSG_CNT_7`, `BS_208h.SZS`, `BS_328h.BS`, `SAS_0C2h.LWS_CHKSUM`, `BS_119h.CRC_0`; 161 signals with `sna`); verify each runs and fails against the current parser
- [ ] 3.3 Write `series.test.ts` tests "flags SNA raw points without value", "flags signed SNA points", "returns SNA edge neighbors as SNA", "matches SNA within half a raw step", "aggregates only valid points and counts SNA per bucket", "returns all-SNA buckets without mean, min and max" and "returns 0 of a 0h counter as a valid value", using `SeriesRef` with ranges from a catalog over the test DBCs; update the catalog size assertion (1007 → 1013) and any assertion that reads `count` as all points; verify each new test fails before 1.4/1.5 and passes after
- [ ] 3.4 Write `series.http.test.ts` test "answers 503 for series before the catalog was ever loaded", and change the "database unavailable" setup so its catalog is loaded from the test DB while `source` is unreachable (it must still return 502 `source_error`); verify both run
- [ ] 3.5 Write `apps/web/test/build.test.ts` tests "keeps SNA as null and never spans it", "holds the last valid value up to the SNA point in step mode", "breaks mean and envelope at all-SNA buckets", "joins several signals without spanning SNA" (via `uPlot.join` with null mode 2), "finds isolated valid points", "ignores SNA in the y range", "draws nothing from an SNA neighbor", "derives SNA periods from raw points and neighbors", "derives SNA periods from buckets", "computes the SNA share of raw and bucket results" and "formats SNA shares without rounding to 0 or 100" (0.024 % → `SNA < 0.1 %`, 0.9995 → `SNA > 99.9 %`, 0.15 → `SNA 15.0 %`); update existing fixtures to the new bucket shape (`sna` array); verify each runs

## 4. Integration check (real carserver data)

- [ ] 4.1 UI user walks through every UI check in `specs/timeseries-window/spec.md` and `specs/signal-catalog/spec.md` on `smart451` (engine-start window 2026-10-13T09:56:59Z–09:57:01Z in line, step and markers mode; V_ANZ full-extent overview with envelope; DVL full extent; DNMOT); verify by one screenshot per scenario
- [ ] 4.2 Run the `curl` commands named in `specs/series-query/spec.md` and `specs/signal-catalog/spec.md` against the dev server; verify outputs `71` / `4411`, the 8-3-9 null pattern and the V_ANZ `sna` entry

## Workflow follow-up

- Lead shows Jan the result (open questions resolved by D-014).
- Archive the change after Jan's approval; copy project-wide decisions (S2 tolerance, S4 null-means-SNA) into docs/decisions.md.
