# Proposal

## Why

Jan (2026-10-16): „we hav the "sky" where we have data. thats good. but not interactive. will you give it more reason?" (D-057). The time strip shows the density of the whole recording but does nothing (D-056 „no click action"). On smart451 it spans ~4.9 d at 1 bar = 1 h: five drives (up to 50.7 M rows/h), a steady trickle of ~160 k rows/h between them, many empty hours; a 20 min view is less than one bar, so the accent bars cannot say where the view is. D-057 supersedes "no click action" with three parts Jan chose: navigate, hover and markers, drives.

## What Changes

- **Navigate (D-057):** a click on the strip centres the bar target's span on the clicked time; a drag across the strip zooms to the dragged range; the shown range is drawn as a pixel-exact window (at least 2 px wide, at least 12 px to grab) that pans when its body is dragged and resizes when an edge is dragged; a double-click shows the whole recording.
- **Hover and markers (D-057):** a bar's tooltip gives its local time range and row count; cursors A and B (flags as in the windows) and the live cursor L (slate-500 line) are marked on the strip.
- **Drives (D-057):** the server finds the drives of a recording, the trickle and short wake-ups are not drives; a drive row under the bars shows them; a click fits a drive; `,` and `.` step to the previous and next drive.
- **Density DTO:** `Density` gains `grid` and `drives`. The server groups the data ref's rows on a grid 400 times finer than the bars (9 s at 1 h bars) instead of on the bars, sums the bars from it and finds the drives in it. Still two queries per catalog load, both on the data-ref and time columns only (measured: same cost as today).
- **Commands:** every strip action is one `window.setRange` through the same path as "Go to": it acts on the bar target, all windows follow while linked, each action is one entry of the zoom history ("Back", Backspace). No new workspace command.
- **Layout:** the strip stays 55 px (≤ 56 px, D-056): 2 px less top padding, 1 px less gap, the 4 px bottom padding become part of a 7 px drive row; bars stay 24 px.

**Out of scope:** signal coverage per signal (D-057); strip zoom levels or a context view; persistence of anything new (drives are recomputed per catalog load, the history stays per tab); the windows following live during a strip drag (they follow on release; design Q3); dragging cursors from the strip; drives in the CLI or a CLI command for them; a drive list or names; editable drive rules in `kipscope.yaml`; touch gestures on the strip.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `time-strip`: density payload with `grid` and `drives` (detection rule), query grid; strip interactions (click, drag, window, double-click), drive row and keys, tooltips, cursor markers; "Clicking does nothing" goes (D-057).
- `timeseries-window`: "Zoom history" lists the strip actions among the recorded steps.

## Impact

- `packages/shared/src`: `series.ts` (`Density.grid`, `Density.drives`, `Drive`), new `drives.ts` (`driveGrid`, `findDrives`, constants), `index.ts`.
- `apps/server/src`: `density.ts` (groups on the grid, sums bars, finds drives). `datasource.ts`, `clickhouse.ts`, routes unchanged.
- `apps/server/scripts/seed-test-db.ts`: new data ref `drivecar` (tester).
- `apps/web/src`: new `time/stripGeometry.ts` (pure geometry, hit zones, gesture, drive steps, titles), `time/TimeStrip.tsx` (track, window, brush, drive row, markers, pointer handling, `loadedDensity`), `time/strip.css`, `keys.ts` (`prevDrive`, `nextDrive`), `App.tsx` (strip `navigate` prop, drive keys, `navigate` returns whether it sent).
- Payloads: `/api/density` gains two fields (additive). No new endpoint, no new command, no dependency, no stored data, no migration.
