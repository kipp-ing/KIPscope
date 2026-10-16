# Tasks

Every task has its own files; all build in one round against the interfaces pinned in design S1–S10. Group 1 lands types and the drive rule the others import; the server and web engineers may stub `Drive`, `Density.grid`/`drives`, `driveGrid` and `findDrives` until it is in. Task 3.2 builds on 3.1's pinned signatures (stub them until 3.1 lands); 3.3 on `StripNavigate` and `loadedDensity` of 3.2 (pinned in S9). The tester writes group 4 test-first, in parallel. Group 5 is the lead's. Q1–Q3 of design.md are Jan's; the tasks use their defaults (wake-ups are not drives, keys `,`/`.`, windows follow on release), each a one-constant or one-sentence change.

- 1.1: `packages/shared/src/series.ts`, `drives.ts` (new), `index.ts`
- 2.1: `apps/server/src/density.ts`
- 3.1: `apps/web/src/time/stripGeometry.ts` (new)
- 3.2: `apps/web/src/time/TimeStrip.tsx`, `time/strip.css`
- 3.3: `apps/web/src/App.tsx`, `keys.ts`
- 4.1: `packages/shared/test/drives.test.ts` (new)
- 4.2: `apps/server/scripts/seed-test-db.ts`, `apps/server/test/globalSetup.ts`, `density.http.test.ts`, `density.test.ts`, `signals.http.test.ts`
- 4.3: `apps/web/test/stripGeometry.test.ts` (new), `keys.test.ts`

## 1. packages/shared

- [x] 1.1 Drive types and rule (S1, S2): `Drive`, `Density.grid`, `Density.drives` in `series.ts`; `DRIVE_GRID_PER_BAR`, `DRIVE_ACTIVE_DIVISOR`, `DRIVE_MERGE_GAP`, `DRIVE_MIN`, `GridBucket`, `driveGrid()`, `findDrives()` in new `drives.ts` (comments cite D-057 and design S2); all exported from the index. Verify: `pnpm --filter @kipscope/shared build`; scenarios "Grid from the width", "Rule on grid buckets".

## 2. apps/server/src

- [x] 2.1 Density on the grid (S3): `DensityCache.compute` asks `refBuckets` for `driveGrid(width)`, sums the kept grid buckets into the bars, adds `grid` and `drives` (`findDrives`, decimal strings). Nothing else on the server changes. Verify: scenarios "Ten hours of test data", "Short and pre-1970 recordings", "Grid query", "Drives in the test DB", "Uniform, short and sparse recordings"; after the lead restarts the dev server: "Drives on smart451", "Cost on carserver".

## 3. apps/web/src

- [x] 3.1 Strip geometry (S6, S7, S8 ranges and gesture, S9 `stepDrive`, S10 titles): new pure `time/stripGeometry.ts` with every pinned constant and function (`trackOf`, `xOf`, `tOf`, `stripUnit`, `snap`, `windowRects`, `driveRects`, `markerX`, `hitZone`, `StripGesture`, `jumpRange`, `brushRange`, `panRange`, `resizeRange`, `wholeRange`, `stepDrive`, `rowsText`, `barTitle`, `driveTitle`); reuses `DRAG_THRESHOLD_PX`, `DOUBLE_CLICK_MS`, `extentRange`, `formatRange`, `formatSpan`. Verify: scenarios "Geometry", "Zones", "Jump math", "Brush math", "Pan and resize math", "Gesture to action", "Cancelled drag", "Drive geometry", "Step math", "Tooltip text", "Marker positions".
- [x] 3.2 Interactive strip (S5, S7 pointer, S8, S9 props, S10): `TimeStrip.tsx` gets the `navigate?: StripNavigate` prop and exports `StripNavigate` and `loadedDensity`; renders `.time-strip-track` with bars (with `title`), window, brush, A/B/L markers and the drive row (hit spans with `title` and `.hover`, drawn bars); measures the track (`ResizeObserver`); pointer capture, `StripGesture`, preview of window and range label, `holdNoSelect()` during drags, Escape and `pointercancel` cancel; `style.cursor` per zone; the double-click replace rule; no handlers and `default` cursor without `navigate` or density. `strip.css` per S5 (55 px). Verify: scenarios "Strip on real data", "Shown-range window" › "20 min on smart451", "Pointer shapes", "Jump on smart451", "Brush on smart451", "Escape cancels", "Double-click and Back", "Fit a drive on smart451", "Tooltip under the window", "Markers on smart451", `time-strip` "Strip states" and "Screen use with the strip" (unchanged numbers).
- [x] 3.3 App wiring and keys (S9): `navigate` returns `boolean`; `stripNavigate` passed to `<TimeStrip>` only while a bar target exists; `keys.ts` `NavKey` `prevDrive` (`,`) and `nextDrive` (`.`); `onNavKey` steps drives on the bar target with `stepDrive` and `loadedDensity(stripDataRef(ws))`, repeats ignored. Verify: scenarios "Linked click and Back", "Unlinked click", "No timeseries window", "Keys on smart451", `timeseries-window` "Strip steps back"; existing `keys.test.ts` and `bar.test.ts` stay green.

## 4. Tests

- [x] 4.1 Shared tests: `drives.test.ts` › "derives the drive grid from the bar width" (1 h, 10 min, 1 ms, 180 d), "finds drives: threshold, merge gap, minimum length, rows" (the buckets of "Rule on grid buckets", shuffled; and `[]`). Verify: `pnpm --filter @kipscope/shared test`.
- [x] 4.2 Server tests on the test DB: seed `drivecar` exactly as design S4 (header comment updated); `globalSetup.ts` checks `drivecar` as the newest seed data; `density.http.test.ts` adds `grid` to "counts testcar rows in 10 min buckets" and "picks the width for short and pre-1970 extents", and new "finds the drives of drivecar", "finds one drive in testcar, none in othercar, grid-wide ones in spancar"; `density.test.ts` updates the whole-body expectation (`grid` `"2500"`, `drives` `[]`) and adds "groups on the grid and sums the bars" (fake source recording the requested width); `signals.http.test.ts` total 1,014 → 1,017. Verify: `pnpm --filter @kipscope/server seed:test && pnpm --filter @kipscope/server test`.
- [x] 4.3 Web tests: `stripGeometry.test.ts` › "maps times to pixels and back on the bar pitch", "draws the window pixel-exact with minimum widths", "finds the hit zone", "computes jump, brush, pan and resize ranges", "turns pointer sequences into strip actions", "draws drives with a minimum width and hit width", "steps to the previous and next drive", "formats bar and drive tooltips", "places markers inside the track only" (the track of "Geometry": start 0, width 1 h, 120 bars, 1,438 px); `keys.test.ts` › "maps the drive keys outside text fields" (`,` → prevDrive, `.` → nextDrive; nothing with Ctrl, Meta, Alt or in a text field). Verify: `pnpm --filter @kipscope/web test`.

## 5. Lead

- [x] 5.1 Reseed the test DB and restart the dev server before the checks of 2.1 and 3.2–3.3; do the hand checks of design "Manual checks" (brush, pan, resize, Escape, double-click with a real mouse) and send Jan one screenshot of the strip with drives, window and markers, together with Q1–Q3 if still open.

## Workflow follow-up

- On archive: copy the ledger entry of design.md into `docs/decisions.md` with Jan's answers to Q1–Q3.
