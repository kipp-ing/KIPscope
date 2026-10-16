# Design

## Open questions for Jan (defaults used throughout)

D-057 settles navigate, hover and markers, and drives. Three points it does not settle; the spec and tasks are written with the recommended default, and each answer changes one constant or one sentence.

- **Q1: Are short wake-ups drives?** smart451 has 17 bursts of 17–71 s at ~8.8 k rows/s (about half the drive rate), most of them about 29 and 59 min after a drive ends (ECUs waking, S2). D-057 says the trickle is not a drive („only real bursts"); wake-ups are bursts, but not driving. **Default: not drives** (a drive must last longer than 2 min). Alternative: count them (`DRIVE_MIN` = 0): 22 "drives", most of them 1–2 min long, and `,`/`.` mostly land on them.
- **Q2: Keys for previous/next drive.** **Default `,` and `.`**: free, no modifier on US and German layouts. `[`/`]` would need Option on a German Mac, which the navigation keys refuse; `PageUp`/`PageDown` are missing on Mac laptops; `n`/`p` would also be free.
- **Q3: Do the windows follow while the strip window is dragged?** **Default: no.** The strip previews the window and range label; the windows change once, on release (one command, one history entry). Alternative: publish the preview like wheel gestures do (`linkedPreview`, D-041). Every frame then becomes a jump of hours that the windows load. It can be added later without changing the strip's geometry.

## Context

See proposal.md (Why). Facts that shape the approach:

- **Strip today** (`apps/web/src/time/`): `TimeStrip.tsx` fetches `/api/density` once per data ref (module `Map`), draws `div.time-strip-bars` (24 px, flex bars, 2 px gap, `aria-hidden`), with no handlers; `strip.ts` holds `stripDataRef`, `stripBars`, `stripLabel`, `formatSpan`; `strip.css` gives 6 + 16 + 4 + 24 + 4 + 1 = 55 px.
- **Navigation path** (`App.tsx`): `navigate(windowId, range, push)` clamps (`clampRange`), pushes the view it leaves to the zoom history when `push` (`historyKey`: one shared stack while linked), keeps a pending range for the next step (design N6 of `improve-navigation`) and sends one `window.setRange`; `navView(windowId)` returns the pending range, else the server range. "Go to", presets, keys and Reset all use it. `apply.ts` `window.setRange` gives every timeseries window the range while `linkTime`, else only the target, and sets `lastZoomed` (so the target stays the bar target). No new workspace command is needed.
- **Keys** (`keys.ts` `navKey`, `App.tsx`): `+ = - ← → (Shift) Home t` for navigation, `s` sidebar, `/` search, Backspace back, Escape cancels drags; nothing with Ctrl, Meta or Alt, nothing in text fields. `,` and `.` are free.
- **Gesture constants:** `DRAG_THRESHOLD_PX = 4` (`chart/drag.ts`), `DOUBLE_CLICK_MS = 500` and `ClickGate` (`chart/cursors.ts`), `holdNoSelect()` (`noselect.ts`), `useLiveCursor()` (`chart/live.ts`, `t` in ns).
- **Server** (`apps/server/src/density.ts`): `DensityCache.compute` runs `refExtent`, then `refBuckets(dataRef, width)` (`GROUP BY x − positiveModulo(x, w)`), zero-fills the bars; cached per data ref and catalog load, prefetched after each load. `refBuckets` takes any width.
- **Data (smart451 on carserver, measured 2026-10-16 with read-only queries as `letsview` through the tunnel):** 128.0 M rows from 2026-10-11T12:34:24.811Z to 2026-10-16T09:52:26.850Z; bars of 1 h, 118 of them. Details and the rule's replay: S2.

## Goals / Non-Goals

**Goals:** the scenarios of the two delta specs; every interface between `packages/shared`, `apps/server/src` and `apps/web/src` pinned below so all areas build in one round; no extra source query (the drive grid replaces the bar grouping); existing density, strip and navigation tests stay green (with the new fields added where they compare whole bodies).

**Non-Goals:** the out-of-scope list of proposal.md; exact drive edges below one grid step; a drive model beyond row density (speed, ignition and other signals are not read).

## Decisions

### S1: Density DTO (pinned, `packages/shared/src/series.ts`)

```ts
/** One drive of a recording (spec time-strip "Drives of a recording"). Decimal ns. */
export interface Drive {
  from: string;
  to: string;
  /** All rows of the data ref in [from, to), active grid buckets or not. */
  rows: number;
}

export interface Density {
  dataRef: string;
  first: string;
  last: string;
  width: string;
  start: string;
  counts: number[];
  /** Drive grid in ns: width / DRIVE_GRID_PER_BAR (S2). */
  grid: string;
  /** In time order, not overlapping; [] when none. */
  drives: Drive[];
}
```

`Drive` is exported from the package index. The fields are additive; `/api/density` keeps its URL, errors and cache.

### S2: Drive grid and rule (pinned, new `packages/shared/src/drives.ts`)

```ts
/** Grid buckets per bar: the grid is width / 400 (9 s at 1 h bars). Exact for every DENSITY_WIDTHS member (all are multiples of 1 ms = 2^6·5^6 ns). */
export const DRIVE_GRID_PER_BAR = 400n;
/** A grid bucket is active when count * DRIVE_ACTIVE_DIVISOR >= the fullest bucket's count (a tenth of the peak). */
export const DRIVE_ACTIVE_DIVISOR = 10;
/** Active runs at most this far apart (end of one to start of the next) merge: 60 s. */
export const DRIVE_MERGE_GAP = 60_000_000_000n;
/** A merged run is a drive when to − from is strictly longer than this: 2 min. */
export const DRIVE_MIN = 120_000_000_000n;

export interface GridBucket { start: bigint; count: number }

/** width / DRIVE_GRID_PER_BAR. */
export function driveGrid(width: bigint): bigint;

/** Drives from the non-empty grid buckets of one data ref, in any order (spec time-strip "Drives of a recording"). */
export function findDrives(
  buckets: readonly GridBucket[],
  grid: bigint,
): { from: bigint; to: bigint; rows: number }[];
```

`findDrives`: no buckets → `[]`. `peak` = the largest count. Active buckets (`count * 10 >= peak`) sorted by `start` (at most 48,000 buckets are sorted, never rows). Walk them: a bucket joins the current run when `bucket.start − run.to ≤ DRIVE_MERGE_GAP`, else it starts a new run; `run.to = bucket.start + grid`. Keep runs with `to − from > DRIVE_MIN`. `rows` = sum of the counts of all buckets with `from ≤ start < to`.

**Why row density, relative to the peak:** density is all the strip has without reading signal values (D-007: data-ref and time columns only). A threshold relative to the recording's fullest bucket needs no per-vehicle number. smart451's three classes lie far apart (table below); a tenth of the peak sits a factor 36 above the trickle and 5 below the wake-ups, so the threshold separates bursts from the trickle, and the 2 min minimum separates drives from wake-ups (Q1). Rejected: a fixed rows/s threshold (needs a number per vehicle and logger setup); a threshold relative to the median (fails on a recording without trickle, where drives are the median); a third query at fine resolution (one more full scan of 128 M rows, ~5.7 s on carserver).

**Measurements (smart451, per-second and per-minute `GROUP BY` of `toUnixTimestamp(utc)`, 93,220 non-empty seconds, 4.9 s per query):**

| Class | rows/s | Duration | Count | Notes |
|---|---|---|---|---|
| Trickle | 30–60 (≈ 45; 2,700 per min; 162 k per h) | 2026-10-14 16:56 – 10-15 16:33 UTC without a break (1,417 min) | 84,897 of 93,220 non-empty seconds | Jan: not a drive (D-057) |
| Wake-up | 8.8–10.7 k (median per run) | 17–71 s (18–81 s on the 9 s grid) | 17 | 10-11 12:34:24 (49 s), 16:28:46 (60 s), 22:44:49 (57 s); 10-12 14:44:09 (37 s), 18:47:29 (17 s); 10-13 04:05:04 (42 s), 08:30:23 (50 s), 10:42:29 (17 s), 11:42:28 (18 s); 10-15 17:51:26 (19 s), 18:51:27 (18 s), 20:03:41 (64 s), 21:05:21 (24 s), 23:07:02 (43 s); 10-16 03:38:58 (47 s), 07:48:12 (41 s), 09:51:16 (71 s) (UTC) |
| Drive | 15.9–16.2 k (peak 9 s bucket 145,953 rows = 16,217 rows/s) | 3.9–66.3 min | 5 | below |

Pauses inside drives: 1–9 s. Shortest pause between two active runs: 1,242 s. On the 9 s grid the threshold is 14,596 rows per bucket; the trickle has ≈ 405 (0.3 % of the peak), a wake-up ≈ 79 k (54 %).

**Drives found** (9 s grid, UTC; the scenario "Drives on smart451" checks these within 9 s):

| # | from | to | Length | rows |
|---|---|---|---|---|
| 1 | 2026-10-11 13:38:51 | 13:42:45 | 3.9 min | 2,870,327 (includes a 63 s after-run 9 s after the burst) |
| 2 | 2026-10-13 09:06:54 | 10:13:12 | 66.3 min | 63,514,839 |
| 3 | 2026-10-13 13:07:03 | 13:17:33 | 10.5 min | 9,903,073 |
| 4 | 2026-10-15 16:59:06 | 17:22:03 | 22.9 min | 21,497,801 |
| 5 | 2026-10-15 19:12:27 | 19:34:21 | 21.9 min | 20,264,560 |

**Replay of the rule on the per-second counts** (each number varied alone): grid 1, 5, 9, 10, 18, 30 and 60 s → the same 5 drives (60 s moves edges by up to a minute); active share 5 % or 20 % → 5; merge gap 30 s or 120 s → 5; minimum 60 s → 8 (the wake-ups of 10-11 16:28, 10-15 20:03 and 10-16 09:51 join); minimum 240 s → 4 (drive 1, 234 s, is lost).

### S3: Server (pinned, `apps/server/src/density.ts`)

`compute(dataRef)`: `refExtent` as today; `width = densityWidth(first, last)`, `grid = driveGrid(width)`, `start` and `length` as today; `buckets = await refBuckets(dataRef, grid)`, keeping those with `start ≤ b.start < start + length × width` (rows written between the two queries are left out, as today); `counts[(b.start − start) / width] += b.count`; `drives = findDrives(kept, grid)` mapped to decimal strings; the result adds `grid: grid.toString()` and `drives`. Nothing else changes: `DataSource`, `ClickHouseSource`, the queue, the route, the cache, the prefetch.

Cost, measured directly on carserver (two runs each): the bucket query on smart451 at 1 h took 5.75 / 5.66 s (1.9 KB, 118 groups), at 10 s 5.76 / 5.78 s (302 KB JSONCompact, 9,344 groups; 10,383 at 9 s). ClickHouse holds at most 48,000 groups (a few MB); the server parses at most ~1.5 MB once per data ref and catalog load; the browser gets the drives only (smart451: 5 × ~70 bytes more).

### S4: Seed data `drivecar` (pinned, `apps/server/scripts/seed-test-db.ts`, tester)

Vehicle `drivecar`, device `drive-dev`, chunk `c10`, table `sdlog.signals`; base B = 2026-10-02T00:00:00Z (1,790,899,200 s). Values free (e.g. `number % 100`).

| Signal | Rows | Times |
|---|---|---|
| `Drv_A10h.TRICKLE` | 2,161 | B + k × 10 s, k = 0 … 2,160 (to B + 6 h) |
| `Drv_A10h.FAST` | 120,000 + 57,000 + 30,000 + 21,000 | every 10 ms in [01:00:00, 01:20:00), [01:20:30, 01:30:00), [03:00:00, 03:05:00), [03:06:30, 03:10:00) after B |
| `Drv_A10h.WAKE` | 3,000 | every 20 ms in [02:00:00, 02:01:00) after B |

Total 233,161 rows; width 5 min (73 bars), grid 750 ms; peak bucket 76 (75 FAST + 1 TRICKLE), active from 8. Expected drives: [01:00, 01:30) with 177,180 rows (30 s pause merges; 180 trickle rows), [03:00, 03:05) with 30,030, [03:06:30, 03:10) with 21,021 (90 s pause splits); the 60 s WAKE burst is active but not longer than 2 min; trickle buckets (1 row) are not active. The seed's header comment lists the new data. `signals.http.test.ts` expects 1,014 signals (becomes 1,017); `globalSetup.ts` checks the newest seed data (`spancar`) to catch a stale test DB and checks `drivecar` instead.

### S5: Strip layout and looks (pinned, `apps/web/src/time/strip.css`)

Box: `.time-strip` `padding: 4px 16px 0; gap: 3px`; head 16 px; `div.time-strip-track` 31 px; border 1 px: 4 + 16 + 3 + 31 + 0 + 1 = **55 px** in every state (D-056 ≤ 56 px; the track keeps its height while empty).

```
div.time-strip-track            position: relative; height: 31px; touch-action: none; user-select: none; cursor from S7
  div.time-strip-bars           height: 24px (unchanged rules, bars keep title per S10)
  div.time-strip-window         absolute; top 0; height 24px; box-sizing border-box; border 1px solid var(--accent);
                                border-radius 2px; background color-mix(in srgb, var(--accent) 12%, transparent); pointer-events none
  div.time-strip-brush          absolute; top 0; height 24px; background color-mix(in srgb, var(--accent) 20%, transparent);
                                border-left/right 1px solid var(--accent); pointer-events none
  div.time-strip-marker.a|.b|.l absolute; top 0; height 24px; width 0; border-left 1px solid var(--text) (.l: var(--muted)); pointer-events none
    span.time-strip-flag        (.a, .b only) absolute; top 0; left 0 (class flip: right 0 when x + 10 > track width); height 10px;
                                min-width 10px; font 600 9px/10px var(--font-sans); text-align center; border-radius 2px; box-sizing border-box;
                                .a: background var(--text), colour #fff; .b: background var(--panel), colour var(--text), border 1px solid var(--text)
  div.time-strip-drives         position: relative; height: 7px
    span.time-strip-drive       absolute at the hit rect (S6), top 0, height 7px, transparent, title per S10; class hover from S7
      span.time-strip-drive-bar absolute at the drawn rect relative to its parent; top 1px; height 4px; border-radius 2px;
                                background var(--soft-ink); .hover > it: var(--text)
```

Colours are tokens only (design-language "No old accent left" stays empty); `#fff` as in the pills (T3 of `adopt-design-language`). Order on top of the bars: window, brush, markers. Bars overlapping the shown range stay `.shown` (accent).

### S6: Geometry (pinned, new `apps/web/src/time/stripGeometry.ts`, pure)

```ts
import type { Density, Drive } from "@kipscope/shared";
import type { Range } from "../chart/zoom.ts";

export const GAP_PX = 2;          // bar gap (strip.css)
export const BARS_PX = 24;        // bars area height; y ≥ BARS_PX is the drive row
export const DRIVE_ROW_PX = 7;
export const EDGE_PX = 4;         // an edge zone reaches 4 px to each side of a drawn edge
export const EDGES_MIN_PX = 16;   // windows drawn narrower have no edge zones
export const MIN_GRAB_PX = 12;    // grab area of the window body
export const MIN_WINDOW_PX = 2;   // drawn window
export const MIN_DRIVE_PX = 4;    // drawn drive
export const DRIVE_HIT_PX = 8;    // drive hit width
export const MIN_SPAN = 100n;     // ns, timeseries-window "Minimum zoom span"

export interface Track { start: bigint; width: bigint; n: number; px: number; first: bigint; last: bigint }
export interface Rect { left: number; right: number }

/** start, width, n = counts.length, first, last (the recording's first and last row) from the density; px = the track's clientWidth. */
export function trackOf(d: Density, px: number): Track;
/** pitch = (px + GAP_PX) / n; x = Number(t − start) / Number(width) × pitch (not clamped). Bar i covers [i·pitch, i·pitch + pitch − GAP_PX]. */
export function xOf(tr: Track, t: bigint): number;
/** Inverse of xOf with x clamped to [0, px]; rounded to whole ns. */
export function tOf(tr: Track, x: number): bigint;
/** Largest power of ten in ns that is ≤ n × width / 1000, at least 1 ns. */
export function stripUnit(tr: Track): bigint;
/** Nearest multiple of unit (ties up). */
export function snap(t: bigint, unit: bigint): bigint;
/** drawn: [xOf(from), xOf(to)] clamped to [0, px], widened about its centre to MIN_WINDOW_PX and shifted inside [0, px];
 *  grab: drawn widened the same way to MIN_GRAB_PX. Undefined when the range does not meet [start, start + n·width). */
export function windowRects(tr: Track, range: Range): { drawn: Rect; grab: Rect } | undefined;
/** Per drive: drawn widened to MIN_DRIVE_PX, hit widened to DRIVE_HIT_PX, both about the drive's centre. */
export function driveRects(tr: Track, drives: readonly Drive[]): { drawn: Rect; hit: Rect }[];
/** undefined when t < start or t > start + n·width; else min(xOf(t), px). */
export function markerX(tr: Track, t: bigint): number | undefined;
```

All conversions to `Number` are of offsets from `start` (exact below 2^53 ns ≈ 104 d; beyond, sub-µs errors, far below a pixel).

### S7: Hit zones and pointer (pinned, `stripGeometry.ts`)

```ts
export type Zone =
  | { kind: "drive"; index: number }
  | { kind: "edge"; side: "from" | "to" }
  | { kind: "body" }
  | { kind: "bars" };
/** x, y relative to the track's top left. range: the bar target's range; undefined without a target. */
export function hitZone(tr: Track, x: number, y: number, range: Range | undefined, drives: readonly Drive[]): Zone;
```

Order: (1) `y ≥ BARS_PX`: the drive whose hit rect holds x, nearest centre on overlap → `drive`, else `bars`. (2) With `windowRects`: if `drawn` is at least `EDGES_MIN_PX` wide, `|x − drawn.left| ≤ EDGE_PX` → edge `from`, `|x − drawn.right| ≤ EDGE_PX` → edge `to` (the nearer one if both). (3) x in `grab` and the window is not full (`drawn.left ≤ xOf(first) + EDGE_PX && drawn.right ≥ xOf(last) − EDGE_PX` is full) → `body`. (4) Else `bars`. A full window brushes from its body, since panning a window that spans the track moves nothing useful, while a drag across the strip from the whole-recording view is the most common first zoom. Full means covering the recorded data to within `EDGE_PX` at both ends, in pixels and not exact times: the whole-recording view is the loaded signals' extent, which differs from the density's `first`/`last` (smart451: 13 ms after `first`, 5.6 s before `last`, at ~5 min/px), and a signal starting in a later drive is a real sub-range and still pans; off by a factor of two, 2 px calls a whole view with a few seconds of slack not full, 8 px calls a view missing 40 min of the recording full.

Pointer (`style.cursor` on the track, set on pointer move when no gesture runs): `bars` and `drive` → `pointer`, `body` → `grab`, `edge` → `ew-resize`; during a gesture: pan `grabbing`, resize `ew-resize`, brush `crosshair`. Without a target (`navigate` prop absent) or without a density: `default`, no handlers.

### S8: Gesture and actions (pinned, `stripGeometry.ts`)

```ts
export type StripAction =
  | { kind: "jump"; x: number }
  | { kind: "fit"; drive: number }
  | { kind: "whole" }
  | { kind: "brush"; x0: number; x1: number }
  | { kind: "pan"; dx: number }
  | { kind: "resize"; side: "from" | "to"; dx: number };

/** One pointer gesture on the track; the caller passes the zone of the press (S7) and event times in ms. */
export class StripGesture {
  down(x: number, y: number, zone: Zone, now: number): void;
  /** Once moved ≥ DRAG_THRESHOLD_PX (hypot) from the press: the preview (brush, pan or resize); before that undefined. */
  move(x: number, y: number): StripAction | undefined;
  /** The action to commit, or undefined (no press, cancelled, or a brush with |x1 − x0| < DRAG_THRESHOLD_PX). */
  up(x: number, y: number, now: number): StripAction | undefined;
  /** Escape or pointercancel: the running gesture yields nothing. */
  cancel(): void;
}
```

- Drag kind from the press zone: `edge` → resize, `body` → pan, `bars` and `drive` → brush (`x0` press x, `x1` current x).
- A click (released before the threshold): if the previous click ended within `DOUBLE_CLICK_MS` (500) and `DRAG_THRESHOLD_PX` (4) of this release → `whole` (and the pair is used up); else `drive` → `fit`, any other zone → `jump` at the release x.
- Ranges (pure, `stripGeometry.ts`; App clamps them through `navigate`):

```ts
/** snap(tOf(x)) as centre, the view's span kept: from = c − span / 2, to = from + span. */
export function jumpRange(tr: Track, x: number, view: Range): Range;
/** [snap(tOf(min)), snap(tOf(max))); undefined when |x1 − x0| < DRAG_THRESHOLD_PX or the ends coincide. */
export function brushRange(tr: Track, x0: number, x1: number): Range | undefined;
/** dt = round(dx / pitch × width / unit) × unit; view + dt with its centre clamped into [start, start + n·width]. */
export function panRange(tr: Track, view: Range, dx: number): Range;
/** from' = min(max(from + dt, start), to − MIN_SPAN) or to' = max(min(to + dt, start + n·width), from + MIN_SPAN). */
export function resizeRange(tr: Track, view: Range, side: "from" | "to", dx: number): Range;
/** extentRange([{ first, last }]): first to just after last, rounded up to the next ms. */
export function wholeRange(d: Density): Range;
```

- Pan and resize compute from the view at the press (not cumulatively); the preview window and the head's range text show the previewed range; `holdNoSelect()` runs while a drag runs; Escape (a capturing `keydown` listener while dragging) and `pointercancel` call `cancel()` and drop the preview.
- **Double-click replace rule:** the first click commits at once (no 500 ms wait as the cursors' `ClickGate` has, since a jump must feel immediate). The second click sends `wholeRange` with `push = !firstSent`, where `firstSent` is what `navigate` returned for the first click, so one "Back" returns to the range before the first click (spec "Double-click shows the whole recording"). Cost: one extra command and render per double-click.
- The preview stays until the bar target's server range changes or `navigate` returns `false`.

### S9: App wiring (pinned)

- `App.tsx` `navigate(windowId, r, push): boolean` returns whether it sent a command (false: no timeseries window, or the clamped range equals the view). Existing callers ignore the result.
- `TimeStrip` props: `{ workspace: Workspace; navigate?: StripNavigate }` with

```ts
/** App → TimeStrip (S9): runs one strip step on the bar target; `next` maps its current view (pending or server) to the new range. Returns whether a command was sent. */
export type StripNavigate = (next: (view: Range) => Range | undefined, push: boolean) => boolean;
```

  exported from `TimeStrip.tsx`. App passes `navigate` only while `barTarget(workspace)` exists; its body: target = `barTarget(liveRef.current.workspace)`, view = `navView(target.id)`, `r = next(view)`, `r ? navigate(target.id, r, push) : false`. Strip actions use `push = true`, except the double-click rule of S8.
- `TimeStrip.tsx` exports `loadedDensity(dataRef: string): Density | undefined` (reads the module `Map`).
- `keys.ts`: `NavKey` gains `"prevDrive"` (`,`) and `"nextDrive"` (`.`), same modifier and text-field rules. In `App.tsx`'s `onNavKey`: a drive key with `e.repeat` does nothing; else target = `barTarget(ws)` (not the hovered window: the drives belong to the strip, which shows the bar target), `d = loadedDensity(stripDataRef(ws))`, `drive = stepDrive(d.drives, navView(target.id), dir)`, and `navigate(target.id, { from: BigInt(drive.from), to: BigInt(drive.to) }, true)` when found. A running signal drag blocks them like the other keys.

```ts
/** stripGeometry.ts. centre(r) = from + (to − from) / 2. dir 1: first drive (time order) with centre > centre(view); dir −1: last with centre < centre(view). */
export function stepDrive(drives: readonly Drive[], view: Range, dir: 1 | -1): Drive | undefined;
```

- The strip measures its track width with a `ResizeObserver`; pointer x, y are relative to the track's bounding rect; it uses pointer capture from `pointerdown` (button 0) to `pointerup`.

### S10: Tooltips and markers (pinned, `stripGeometry.ts`, `TimeStrip.tsx`)

```ts
/** "no rows", "1 row", else en-US thousands commas + " rows". */
export function rowsText(n: number): string;
/** `${formatRange(start_i, start_i + width)} · ${rowsText(counts[i])}` (formatRange of time/axis.ts: local time as the header). */
export function barTitle(d: Density, i: number): string;
/** `Drive ${i + 1} of ${n} · ${formatRange(from, to)} · ${formatSpan(to − from)} · ${rowsText(rows)}`. */
export function driveTitle(d: Density, i: number): string;
```

Native `title` attributes on each bar span and each `span.time-strip-drive`; the window, brush and markers have `pointer-events: none`, so the bar under them keeps its tooltip. Markers: A and B from the workspace cursors (present only while on), L from `useLiveCursor()?.t`; x from `markerX`; flags as S5.

### Numbers: what if off by a factor of two

- **Grid 400 per bar (9 s at 1 h):** 200 → 18 s grid, same 5 drives on smart451 (replayed), edges up to 18 s loose, ≤ 24,000 buckets; 800 → 4.5 s, same drives, ≤ 96,000 buckets (~3 MB per load from ClickHouse).
- **Active share 1/10 of the peak:** 1/20 or 1/5 → same 5 drives; the trickle stays at 0.3 % and the wake-ups at 54 % of the peak, so the share only matters below 0.6 % or above 54 %.
- **Merge gap 60 s:** 30 s or 120 s → same drives; pauses inside drives are ≤ 9 s, gaps between runs ≥ 1,242 s.
- **Minimum 2 min:** 1 min → 8 drives (three wake-ups of 63–81 s join); 4 min → 4 drives (drive 1, 234 s, is lost). The tightest number; it is Q1's.
- **4 px click/drag threshold, 500 ms double-click** (existing constants): 2 px → hand jitter turns clicks into brushes; 8 px → small brushes impossible on 12 px bars. 250 ms → slow double-clicks become two jumps; 1 s → two separate clicks 1 s apart become "whole".
- **EDGE_PX 4:** 2 → 4 px edge targets, hard to hit; 8 → 16 px edge zones; a window under 32 px would have no body (EDGES_MIN_PX would need to double too).
- **EDGES_MIN_PX 16:** 8 → the edge zones (8 px each) cover the whole window, no body; 32 → windows of 16–32 px (about 1.3–2.7 h on smart451) resize only by brushing.
- **MIN_GRAB_PX 12:** 6 → a 20 min window (4 px) is hard to grab; 24 → a small window blocks clicks on the two bars beside it.
- **MIN_WINDOW_PX 2:** 1 → a sub-pixel range can vanish into the accent bar under it; 4 → a 20 min window (4 px exact) still exact, a 5 min one drawn 4× too wide.
- **MIN_DRIVE_PX 4, DRIVE_HIT_PX 8:** 2 / 4 → drive 1 (0.8 px exact) barely visible and hard to hit; 8 / 16 → neighbouring drives 1–2 h apart (12–24 px) overlap; the nearest-centre rule still separates them.
- **Drive row 7 px:** 3.5 → 2 px segments; 14 → strip 62 px, over D-056's 56 px.
- **Strip unit n·width/1000 (100 s on smart451):** /500 or /2000 → still 100 s on smart451 (432 s and 216 s round down to the same power of ten); elsewhere one power of ten coarser or finer rounding.
- **55 px strip:** unchanged from today; the plot share at 1000×557 stays as last measured (time-strip "Screen use with the strip").

## Risks / Trade-offs

- [A recording without bursts (only trickle) or with one outlier bucket far above its drives] → the trickle shows as drives, or the drives drop below a tenth of the outlier. Mitigation: all four constants sit in `drives.ts`; a finding goes to Jan with the measured counts.
- [Recordings longer than ~60 d (bars ≥ 1 d, grid ≥ 3.6 min)] → every active bucket is longer than 2 min, so wake-ups and isolated points count as drives (`spancar`'s scenario shows grid-wide drives). Accepted: such spans are far beyond the concept's recordings (§3: up to about ten hours per view).
- [Drive edges] → up to one grid step (9 s on smart451) outside the first and last burst row; `rows` includes the trickle rows inside. Fit shows the whole drive either way.
- [Data still arriving] → drives and bars update after the next catalog load only (as the bars today).
- [Bar layout] → pixel exactness assumes the flex bars sit on the pitch `(px + 2) / n`, true while `px ≥ 3n − 2` (358 px at 120 bars); the strip is ≥ 700 px wide at 1000 px with the sidebar open.
- [Full window] → its body brushes instead of panning (S7); edges still resize. A user who wants to pan a nearly full window drags just inside it.
- [First click of a double-click is sent] → one extra command; history stays right through the replace rule (S8).
- [Drag checks] → the browser tool cannot hold a drag; brush, pan, resize and Escape are covered by pure tests (S6–S8) and checked by hand (Manual checks).

## Migration Plan

None. The DTO fields are additive; restart the server to serve them; reseed the test DB for `drivecar` (`pnpm --filter @kipscope/server seed:test`).

## Manual checks (lead)

- By hand with a real mouse on smart451 at 1440×900: brush a day, pan the window, drag both edges, press Escape during a pan, double-click; check no text gets selected. Send Jan one screenshot of the strip with drives, window and A/B/L markers.

## Ledger entries on archive (proposed for `docs/decisions.md`)

- D-0xx Strip navigation conventions: drive grid = bar width / 400; drive = run of grid buckets with ≥ 1/10 of the peak count, runs ≤ 60 s apart merged, longer than 2 min (Q1); `Density.grid`, `Density.drives`; click jumps (span kept, strip unit), drag zooms, window body pans and edges resize (zones S7: edges ±4 px from 16 px windows, grab ≥ 12 px, full window brushes), double-click whole recording replacing the first click's step; drive row 7 px under the bars, keys `,`/`.` (Q2) on the bar target; windows follow on release (Q3); every action one `window.setRange` with one history entry.
