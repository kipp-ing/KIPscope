# Tasks

Every task has its own files; all build in one round against the interfaces pinned in design T1–T8. Group 1 lands types the others import; server and web engineers may stub `Density`, `densityWidth` and the new `SIGNAL_COLORS` until it is in. The tester writes group 4 test-first, in parallel. Group 5 is the lead's. Q1–Q3 are Jan's; the tasks follow the spec defaults (no explorer primary, ring frame and pill without the top bar, L line in the accent).

- 1.1: `packages/shared/src/workspace.ts`
- 1.2: `packages/shared/src/series.ts`, `time.ts`, `index.ts`
- 2.1: `apps/server/src/datasource.ts`, `clickhouse.ts`, `queue.ts`
- 2.2: `apps/server/src/density.ts` (new), `routes/series.ts`
- 3.1: `apps/web/src/styles.css`, `explorer/SignalExplorer.tsx`, `footer/StatusBar.tsx`
- 3.2: `apps/web/src/bar/bar.css`, `bar/OptionBar.tsx`
- 3.3: `apps/web/src/chart/window.css`, `values/values.css`, `chart/TimeseriesWindow.tsx`, `values/ValuesWindow.tsx`
- 3.4: `apps/web/src/time/strip.ts` (new), `time/TimeStrip.tsx` (new), `time/strip.css` (new), `api.ts`, `App.tsx`
- 4.1: `packages/shared/test/workspace.test.ts`, `time.test.ts`
- 4.2: `apps/server/test/density.http.test.ts` (new), `density.test.ts` (new), test fakes of `DataSource`
- 4.3: `apps/web/test/strip.test.ts` (new)

## 1. packages/shared

- [ ] 1.1 Series palette (T5): `SIGNAL_COLORS` = the ten colours in order, comment cites D-055. Verify: scenario "Palette content".
- [ ] 1.2 Density types (T6): `Density` in `series.ts`; `MAX_DENSITY_BARS`, `DENSITY_WIDTHS`, `densityWidth()` in `time.ts` (floor toward −∞ for negative times); exported from the index. Verify: `pnpm --filter @kipscope/shared build`; scenario "Width choice".

## 2. apps/server/src

- [ ] 2.1 Data-ref queries (T7): `refExtent`, `refBuckets` on `DataSource`, the two SQL queries in `ClickHouseSource`, both wrapped in `queuedSource`. Verify: scenarios "Ten hours of test data", "Short and pre-1970 recordings".
- [ ] 2.2 Cache and route (T7): `DensityCache` in new `density.ts` (per data ref and `catalog.loadedAt`, shared promise, failures dropped, zero-filled counts from `densityWidth`); `GET /api/density` in `routes/series.ts` with 400 / 404 `unknown_data_ref` / 404 `no_data` / 502. Verify: scenarios "Errors", "Cache", "Cost on carserver" (after the lead restarts the server).

## 3. apps/web/src

- [ ] 3.1 Tokens, explorer, footer, top-row slot (T1, T2, T3 slot and sidebar toggle, T4 explorer and footer, T8 slot change): `:root` tokens and global `font: inherit`; every literal accent/error colour in `styles.css` to tokens or `color-mix`; `.section-label`; explorer `h2` gets the class; explorer, group header, row, add-button looks; `.window` tile border and radius; `.option-bar-slot` white with 4 px padding, no longer sticky (the wrapper of 3.4 is); `.sidebar-toggle` pressed look; top-row control boxes; footer band, `.conn.ok` dot (StatusBar only if the measuring copy needs the class). Verify: scenarios "Token values", "No old accent left" (with 3.3), "Computed type", "Control boxes", "At most one primary per surface", "Signals toggle", "Bands and active row", "Footer band", "Numbers re-measured".
- [ ] 3.2 Option bar (T3): `toggle pill` class on A, B, Diff; hidden-checkbox pill CSS with on, off, disabled and focus states; "Link time axes" `accent-color`; `.go-to.invalid` with tokens; one line at 1000×557. Verify: scenarios "Pills on and off", "One line at both viewports".
- [ ] 3.3 Windows and legend (T2, T4): header divider inside 24 px, title 12/600, badge pill, `.mark-pill` "Add to" in both kinds (values header room counts it), marked ring frame (bar and accent title removed), cursor colour and flags, accent L line, live label, `AXIS_FONT` 11 px, `GRID_STROKE`, `AXIS_STROKE`, line swatch, legend name and value fonts, status and SNA pills, SNA ink, drop and error tints to tokens; values window swatch and pills. Verify: scenarios "Header and badge", "Cursors and L line", "Pills in the legend", "Live cells keep their column", "Colours on screen", `workspace-layout` "Header height", "No reflow on zoom", "Short badge", "Mark and add", "Values window marked".
- [ ] 3.4 Time strip (T8): `strip.ts` functions, `fetchDensity` in `api.ts`, `TimeStrip.tsx` with states and retry, `strip.css` (strip and `.top-area`), `App.tsx` wraps the slot and the strip in `.top-area` and moves `barRef` to it. Verify: scenarios "Bars and label", "Strip on real data", "Strip states", "Screen use with the strip".

## 4. Tests

- [ ] 4.1 Shared tests: `workspace.test.ts` › "uses Okabe-Ito first, ten distinguishable colours" (exact list; WCAG contrast of the last four ≥ 3 on white; CIE76 ΔE of every pair ≥ 25, computed in the test); `time.test.ts` › "picks the smallest round density width for at most 120 buckets" (the five cases of "Width choice"). Verify: `pnpm --filter @kipscope/shared test`.
- [ ] 4.2 Server tests on the test DB: `density.http.test.ts` › "counts testcar rows in 10 min buckets", "picks the width for short and pre-1970 extents", "answers 400, 404 and 502"; `density.test.ts` › "computes once per catalog load, shares and does not cache failures" (fake source counting calls); existing fakes of `DataSource` gain `refExtent`/`refBuckets` stubs where the type requires them. Verify: `pnpm --filter @kipscope/server test`.
- [ ] 4.3 Web tests: `strip.test.ts` › "sizes and marks the bars", "labels the shown and recorded spans", "takes the data ref of the target window, else of any window". Verify: `pnpm --filter @kipscope/web test`.

## 5. Lead

- [ ] 5.1 Screenshot next to the mock for Jan (design "Manual checks"); restart the server before the UI check of 2.2 and 3.4.

## Workflow follow-up

- On archive: copy the ledger entry of design.md into `docs/decisions.md`.
