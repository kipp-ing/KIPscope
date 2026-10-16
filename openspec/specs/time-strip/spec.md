# time-strip Specification

## Purpose
The time strip under the option bar: data density over the whole recording of the shown data ref as bars (grey where data exists, accent for the shown range), its label and states, the drives found in the data, navigation by pointer and keys (jump, brush, pan, resize, fit a drive, whole recording, `,`/`.`), A/B/L markers, and the `/api/density` endpoint with drives, cache and prefetch after each catalog load.

## Requirements

### Requirement: Density of a recording
`GET /api/density?dataRef=<ref>` SHALL answer the rows with a timestamp of all the ref's signals per bucket over its whole extent: `first`, `last` (decimal ns), `width` ("Bucket widths"), `start` (`first` floored to a multiple of `width`, also before 1970), `counts` from `start` to the bucket holding `last`, empty ones 0, `grid` ("Drive grid") and `drives` ("Drives of a recording") (design T6 of `adopt-design-language`, S1). Origin: D-055 („data density over the whole recording"); a data ref is one recording (`smart451`); `grid` and `drives`: D-057 („the server finds drives").

#### Scenario: Ten hours of test data
- **WHEN** the server runs on the test DB and `GET /api/density?dataRef=testcar` is sent
- **THEN** 200 with `first` 2026-10-01T00:00:00Z and `last` 2026-10-01T10:00:00Z in ns, `width` `"600000000000"` (10 min; 5 min would need 121 buckets), `grid` `"1500000000"`, `start` equal to `first`, 61 `counts`, their sum equal to `SELECT count() FROM sdlog.signals WHERE vehicle = 'testcar' AND utc IS NOT NULL`, and `counts[0]` equal to the same count for [00:00, 00:10)
- **Evidence:** `apps/server/test/density.http.test.ts` › "counts testcar rows in 10 min buckets"

#### Scenario: Short and pre-1970 recordings
- **WHEN** `GET /api/density` is sent for `othercar` (10 points 5 ms apart) and for `spancar` (5 points from 1969-12-31T23:59:58.5Z to 2026-10-01T00:00:00Z)
- **THEN** `othercar` has `width` `"1000000"` (1 ms), `grid` `"2500"` and 46 counts, ten of them 1 and the rest 0; `spancar` has `width` 180 d in ns, `grid` `"38880000000000"`, `start` `"-15552000000000000"`, 117 counts with 2 at index 0, 1 at index 1, 1 at index 114, 1 at index 116 and 0 elsewhere
- **Evidence:** `apps/server/test/density.http.test.ts` › "picks the width for short and pre-1970 extents"

### Requirement: Density errors
A missing or empty `dataRef` SHALL answer 400 `invalid_request`; a data ref the loaded catalog does not know 404 `unknown_data_ref`; one without rows 404 `no_data`; a source failure 502 `source_error`. The route SHALL pass the `server-access` guard like every route. Origin: necessary consequence; codes as `/api/extent` (`series-query`).

#### Scenario: Errors
- **WHEN** `/api/density` is sent without `dataRef`, with `dataRef=nocar` after the catalog loaded, and with `dataRef=testcar` while the source is unreachable
- **THEN** 400 `invalid_request`, 404 `unknown_data_ref`, and 502 `source_error`
- **Evidence:** `apps/server/test/density.http.test.ts` › "answers 400, 404 and 502"

### Requirement: Bucket widths
The bucket width SHALL be the smallest of 1, 2, 5, 10, 20, 50, 100, 200, 500 ms; 1, 2, 5, 10, 15, 30 s; 1, 2, 5, 10, 15, 30 min; 1, 2, 3, 6, 12 h; 1, 2, 7, 14, 30, 90, 180 d; 1, 2, 5, 10, 20, 50, 100 × 365 d with `floor(last / w) − floor(first / w) + 1 ≤ 120`. Origin: necessary consequence of a label `1 bar = <width>` that reads as a round duration; 120: design T6; 100 × 365 d is the widest that fits a signed 64-bit ns value and still covers every allowed time.

#### Scenario: Width choice
- **WHEN** `densityWidth(first, last)` gets 0 and 0; 0 and 36,000 s; 0 and 35,999.999 s; −1.5 s and 2026-10-01T00:00:00Z; 1900-01-01 and 2262-04-11
- **THEN** 1 ms; 10 min; 5 min; 180 d; 5 × 365 d
- **Evidence:** `packages/shared/test/time.test.ts` › "picks the smallest round density width for at most 120 buckets"

### Requirement: Density cached
The server SHALL compute a data ref's density at most once per catalog load: concurrent requests share one computation, a failed one is not cached, and a catalog reload makes the next request compute it again. After each successful catalog load the server SHALL start the computation for every data ref of the catalog without a request, one ref after another. Origin: necessary consequence of carserver's 2 GB RAM (D-007) and of a strip shown on every page load; prefetch: D-055 Q4.

#### Scenario: Cache
- **WHEN** a test source counts its queries, three `/api/density?dataRef=testcar` requests arrive at once, then one more, then the catalog is refreshed and one more arrives; separately the first computation fails and a second request follows
- **THEN** the first four requests cause two source queries in all and get the same body; after the refresh two more; after the failure the second request queries again
- **Evidence:** `apps/server/test/density.test.ts` › "computes once per catalog load, shares and does not cache failures"

#### Scenario: Prefetch
- **WHEN** a test source counts its queries and records their data refs, the catalog loads with data refs `testcar` and `othercar` and no request is sent; then `/api/density?dataRef=testcar` is sent; separately the prefetch of `testcar` fails and a request for `testcar` follows
- **THEN** after the load the source gets the density queries of both refs without a request, the second ref's only after the first ref's finished; the later request causes no further source query and gets the prefetched body; after the failed prefetch the request queries again
- **Evidence:** `apps/server/test/density.http.test.ts` › "computes after the catalog load without a request, and a request does not recompute"

### Requirement: Density queries cheap
A density computation SHALL run through the query queue as two queries that read only the data-ref and time columns, the second grouping on the drive grid into at most 48,000 buckets (120 bars × 400), with nothing sorted per row; the bars are summed from the grid buckets on the server (design T7 of `adopt-design-language`, S3). Origin: necessary consequence of carserver's 2 GB RAM (D-007); queue: `series-query` concurrency; grid: D-057 (drives need a finer resolution than the bars).

#### Scenario: Cost on carserver
- **WHEN** the dev server runs against carserver and `curl -s -o /dev/null -w '%{time_total}\n' 'localhost:7310/api/density?dataRef=smart451'` runs twice
- **THEN** both answer 200; goal, measured and reported but not pass/fail: the first ≤ 5 s, the second ≤ 0.1 s
- **Evidence:** the command (both times)

#### Scenario: Grid query
- **WHEN** a test source records the widths it is asked to group on and `/api/density?dataRef=testcar` is sent
- **THEN** the source gets one extent query and one bucket query with width 1.5 s (the grid, not the 10 min bars), and the answered `counts` equal the grid buckets summed per bar
- **Evidence:** `apps/server/test/density.test.ts` › "groups on the grid and sums the bars"

### Requirement: Time strip
Below the option bar, sticking with it, the page SHALL show the time strip for the data ref of the bar target's first signal, else of the first signal in any window: `TIME`, the target's range as in its header (during a strip drag the previewed range), and at the right `<shown> of <recorded> recorded · 1 bar = <width>`, spans in the largest of y (365 d), d, h, min, s, ms they reach, one decimal at most, no `.0`. Pointer and keys act as "Strip actions are range commands" says. Origin: D-055 (time strip on; mock label); D-057 supersedes "Clicking does nothing".

#### Scenario: Strip on real data
- **WHEN** the six-window setup is shown on smart451 at 1440×900 and window 1 is zoomed from its full extent to a 20 min range
- **THEN** the strip shows `TIME`, window 1's header range and `… recorded · 1 bar = …`; its bars are grey where smart451 has data; after the zoom only the bars overlapping those 20 min are in `rgb(2, 132, 199)` (one or a few), the label's left part equals the new header range, and the strip is ≤ 56 px tall in both states
- **Evidence:** UI check on smart451 at 1440×900 (screenshot before and after the zoom, strip height)

### Requirement: Time strip bars
The strip SHALL draw one bar per density bucket across its width, 2 px apart, at most 24 px high: a bucket with rows at least 3 px and in proportion to the largest count above that, an empty bucket 1 px; bars in slate-300, those overlapping the shown range (half-open) in the accent. Origin: D-055 (bars grey where data exists, the shown range in the accent); 24 px and the 3 px floor: design T8 and its numbers (the mock's 30 px cost plot share).

#### Scenario: Bars and label
- **WHEN** `stripBars` gets counts `[0, 10, 5, 0, 1]`, start 0, width 10 s, and the shown range [12 s, 31 s); and `stripLabel` gets that range, first 0 and last 6 d, width 3 h
- **THEN** heights `[1, 24, 12, 1, 3]` and shown `[false, true, true, true, false]`; the label reads `19 s of 6 d recorded · 1 bar = 3 h`; `formatSpan` gives `20 min`, `2.5 h`, `45 ms`, `5 y`
- **Evidence:** `apps/web/test/strip.test.ts` › "sizes and marks the bars", "labels the shown and recorded spans"

### Requirement: Time strip states
Without a signal the strip SHALL show `No signal shown`; while loading `Loading recording…`; after a failure `Recording unavailable`, retrying every 30 s; without a timeseries window no range and no accent bars. The strip SHALL be at most 56 px tall, the same in every state, and SHALL keep the plot share of `workspace-layout` "Screen use". Origin: necessary consequence (the strip must not move windows or hide data); 30 s: the load retry cap of D-042; 56 px: design T8.

#### Scenario: Strip states
- **WHEN** the workspace has no window; then only a values window with one signal; then the source is unreachable at page load
- **THEN** the strip shows `TIME` and `No signal shown`; then the bars and `<recorded> recorded · 1 bar = …` without a range and without accent bars; then `Recording unavailable` in the muted colour, and the bars appear without a reload within 30 s after the source is back; the strip's height is the same in all three states (±0.5 px) and no window moves when it changes
- **Evidence:** UI check (screenshot per state, strip heights); `apps/web/test/strip.test.ts` › "takes the data ref of the target window, else of any window"

#### Scenario: Screen use with the strip
- **WHEN** the six-window setup is shown at 1000×557 with the sidebar open and the strip loaded
- **THEN** the plot share from design M1's snippet is at least 30 % (`workspace-layout` "Screen use")
- **Evidence:** UI check on smart451 at 1000×557 (snippet output, screenshot)

### Requirement: Drive grid
`grid` SHALL be the bar width divided by 400 (decimal ns), so every grid bucket lies in one bar. Origin: D-057 (drives need a finer resolution than the bars; smart451's shortest drive is 3.9 min, its bars 1 h); 400: design S2 (9 s at 1 h bars; at most 48,000 buckets).

#### Scenario: Grid from the width
- **WHEN** the drive grid is computed for bar widths 1 h, 10 min, 1 ms and 180 d
- **THEN** 9 s, 1.5 s, 2.5 µs and 10.8 h
- **Evidence:** `packages/shared/test/drives.test.ts` › "derives the drive grid from the bar width"

### Requirement: Drives of a recording
`drives` SHALL list, in time order, each run of grid buckets holding at least a tenth of the fullest bucket's rows, runs closer than or exactly 60 s merged, kept if longer than 2 min: `from` (start of its first bucket), `to` (end of its last), `rows` (all rows from `from` to `to`). Origin: D-057 (drives are „only real bursts", the trickle is not a drive); numbers measured on smart451 (design S2); short wake-ups not drives: design Q1.

#### Scenario: Rule on grid buckets
- **WHEN** drives are found on a 10 s grid from buckets (start s: count) 0–290 every 10 s: 100; 310: 5; 360–410 every 10 s: 100; 490–600 every 10 s: 100; 1000: 9; 2000–2120 every 10 s: 10, given in shuffled order; and separately from no buckets
- **THEN** two drives: [0 s, 420 s) with 3,605 rows (the 60 s pause merges, the bucket of 5 counts) and [2000 s, 2130 s) with 130 rows; [490 s, 610 s) is exactly 2 min and is dropped, and the bucket of 9 (below a tenth of 100) is no drive; no buckets give no drives
- **Evidence:** `packages/shared/test/drives.test.ts` › "finds drives: threshold, merge gap, minimum length, rows"

#### Scenario: Drives in the test DB
- **WHEN** the server runs on the test DB seeded with `drivecar` (design S4) and `GET /api/density?dataRef=drivecar` is sent
- **THEN** `width` `"300000000000"`, `grid` `"750000000"`, 73 counts summing to 233,161, and `drives` exactly `[{from "1790902800000000000", to "1790904600000000000", rows 177180}, {from "1790910000000000000", to "1790910300000000000", rows 30030}, {from "1790910390000000000", to "1790910600000000000", rows 21021}]`: the 30 s pause merges, the 90 s pause splits, the 60 s wake-up and the trickle are no drives
- **Evidence:** `apps/server/test/density.http.test.ts` › "finds the drives of drivecar"

#### Scenario: Uniform, short and sparse recordings
- **WHEN** `GET /api/density` is sent for `testcar`, `othercar` and `spancar`
- **THEN** `testcar` has one drive from `first` to `last` (the bucket holding only the 10:00:00 point of `Sparse_300h.SLOW` is below a tenth) with `rows` = sum of `counts` − 1; `othercar` has none (one 45 ms run); `spancar` has three: [−38,880 s, 38,880 s) with 3 rows, [1,767,212,640 s, 1,767,251,520 s) with 1 and [1,790,812,800 s, 1,790,851,680 s) with 1 (in ns)
- **Evidence:** `apps/server/test/density.http.test.ts` › "finds one drive in testcar, none in othercar, grid-wide ones in spancar"

#### Scenario: Drives on smart451
- **WHEN** the dev server runs against carserver and `curl -s 'localhost:7310/api/density?dataRef=smart451' | jq -c '.grid, [.drives[] | [.from, .to]]'` runs
- **THEN** `grid` is `"9000000000"`; the five drives of design S2 are among the drives, each edge within 9 s; no drive starts or ends between 2026-10-14T16:56Z and 2026-10-15T16:33Z (the trickle) and no drive overlaps a wake-up listed in design S2
- **Evidence:** the command (output shortened in the report)

### Requirement: Strip actions are range commands
Every strip action and drive key SHALL set the bar target's range with one `window.setRange`, as "Go to" does: all timeseries windows follow while linked, only the target while unlinked, and the range shown before is one entry of the zoom history ("Back", Backspace). Without a timeseries window the strip SHALL send nothing. Origin: D-057 (lead's default: „strip actions act on the bar target, or on all windows when time is linked (as Go to)"); history: D-025, D-027.

#### Scenario: Linked click and Back
- **WHEN** "Link time axes" is on, two timeseries windows show smart451 at the same 20 min range, the user clicks a strip bar about a day earlier, then clicks "Back"
- **THEN** after the click both headers show the same new 20 min range and the revision rose by exactly one; after "Back" both show the old range
- **Evidence:** UI check on smart451 at 1440×900 (both headers and the revision after each step)

#### Scenario: Unlinked click
- **WHEN** "Link time axes" is off, window 2 was zoomed last, and the user clicks a strip bar
- **THEN** only window 2's range changes, and the strip's range label shows window 2's new header range
- **Evidence:** UI check on smart451 (both headers before and after)

#### Scenario: No timeseries window
- **WHEN** the workspace holds only a values window with a smart451 signal and the user clicks, double-clicks the strip and presses `.`
- **THEN** the revision does not change and the strip's pointer is the default arrow
- **Evidence:** UI check on smart451 (revision before and after, computed `cursor` of the strip's track)

### Requirement: Shown-range window
The strip SHALL draw the bar target's range as a window over the bars, at its exact pixel position on the bar pitch, at least 2 px wide (centred when wider than the range), clipped to the track: 1 px accent border, accent fill at 12 %; bars overlapping the range stay in the accent. Its grab area SHALL be at least 12 px wide. Origin: D-057 („the shown range is a grabbable window … pixel-exact with a minimum width"); sizes: design S6.

#### Scenario: Geometry
- **WHEN** a track of 1,438 px shows 120 bars of 1 h from 0 (pitch 12 px) and the range is [5 h, 5 h 20 min), then [5 h, 10 h), then [0, 120 h)
- **THEN** the window is drawn at [60, 64] px with a grab area [56, 68]; then [60, 120] with grab = drawn; then [0, 1438]
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "maps times to pixels and back on the bar pitch", "draws the window pixel-exact with minimum widths"

#### Scenario: 20 min on smart451
- **WHEN** window 1 shows a 20 min range on smart451 at 1440×900
- **THEN** the strip's window element is 20/60 of a bar pitch wide (`(trackWidth + 2) / counts.length / 3`, ±0.5 px, but at least 2 px) and its left edge is within 0.5 px of the range start's position on the track; one or two bars under it are in the accent
- **Evidence:** UI check on smart451 at 1440×900 (the measured widths and lefts, one screenshot)

### Requirement: Strip hit zones and pointer
A press on the strip SHALL hit, in this order: an event pin, a drive, a window edge (±4 px of a drawn edge, on windows drawn at least 16 px wide), the window body (its grab area, unless the window covers the recorded data to within 4 px), else the bars. The pointer SHALL show `ew-resize` on edges, `grab` on the body (`grabbing` while panning), `pointer` on bars, drives and pins, `crosshair` while dragging a range. Origin: D-057; design S7 of `add-strip-navigation`; pins: D-058, design V3.

#### Scenario: Zones
- **WHEN** on the track of "Geometry" the window is [5 h, 5 h 20 min) and the pointer is at x 62, 57 and 55 in the bars area and at x 62 in the drive row without drives; then the window is [5 h, 10 h) and x is 57, 64, 65, 123 and 125; then the window is [0, 120 h) and x is 700, 2 and 1436
- **THEN** body, body, bars, bars; then edge from, edge from, body, edge to, bars; then bars, edge from, edge to
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "finds the hit zone"

#### Scenario: Pin zones
- **WHEN** on the track of "Geometry" the window is [5 h, 10 h), pins are built from events at 5 h, 5 h 20 min and 5 h 40 min, and the pointer is at (62, 3), (64.5, 3), (69, 3), (62, 12) and (90, 3)
- **THEN** pin 0, pin 0, pin 1, edge from, body
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "finds the hit zone" (pin cases)

#### Scenario: Pointer shapes
- **WHEN** window 1 shows a 2 h range on smart451 and the pointer moves over a bar outside the window, the window's middle, its left edge, a drive segment and the event pin of 2026-10-15 07:27 local
- **THEN** the computed `cursor` of the strip's track is `pointer`, `grab`, `ew-resize`, `pointer` and `pointer`
- **Evidence:** UI check on smart451 at 1440×900 (computed values after each move)

### Requirement: Click jumps keeping the span
A click (press and release less than 4 px apart) on the bars, the window body or an edge SHALL centre the bar target's current span on the time under the pointer, rounded to the strip unit (the largest power of ten in ns at most 1/1000 of the track's span). Origin: D-057 („click a bar jumps there keeping the span"); click threshold as for cursors (4 px, `cursors` "Placing cursors by click").

#### Scenario: Jump math
- **WHEN** on the track of "Geometry" the view is [0, 20 min) and the user clicks at x 60
- **THEN** the new range is [4 h 50 min, 5 h 10 min) (unit 100 s)
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "computes jump, brush, pan and resize ranges"

#### Scenario: Jump on smart451
- **WHEN** window 1 shows a 20 min range on smart451 and the user clicks the strip bar of the drive at 2026-10-13 11:00–12:00 local
- **THEN** the header shows a 20 min range whose centre lies in that hour, the revision rose by one, and the window element moved under the click
- **Evidence:** UI check on smart451 at 1440×900 (header and revision before and after, screenshot)

### Requirement: Drag zooms to the range
A press on the bars (or on a drive, or on the body of a window covering the recorded data to within 4 px) moved at least 4 px SHALL draw an accent range and, on release, set the range between press and release, both ends rounded to the strip unit; a release less than 4 px left or right of the press SHALL send nothing. Origin: D-057 („drag across the strip zooms to that range").

#### Scenario: Brush math
- **WHEN** on the track of "Geometry" a range is dragged from x 60 to x 120, from 120 to 60, and from 60 to 62 (with 10 px vertical movement)
- **THEN** [5 h, 10 h) twice and nothing the third time
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "computes jump, brush, pan and resize ranges", "turns pointer sequences into strip actions"

#### Scenario: Brush on smart451
- **WHEN** the user drags across the strip from the first to the last bar of 2026-10-13 (left_click_drag of the browser tool)
- **THEN** the header shows about that local day, rounded to the strip unit, one revision; if the tool cannot drag, `not_run` and Jan checks it by hand
- **Evidence:** UI check on smart451 at 1440×900 (header and revision), else `not_run`

### Requirement: Window drag pans and resizes
Dragging the window body SHALL move the range by the dragged time, its centre kept on the track; dragging an edge SHALL move that end only, kept on the track and at least 100 ns from the other. The dragged time SHALL be rounded to the strip unit; the strip SHALL preview the moved window and range label and send one command on release. Origin: D-057 („slide = pan, edges = zoom"); 100 ns: `timeseries-window` "Minimum zoom span".

#### Scenario: Pan and resize math
- **WHEN** on the track of "Geometry" the view [5 h, 10 h) is panned by 6 px and by 6.2 px; resized at its end by 12 px and at its start by 100 px; and the view [0, 20 min) is panned by −100 px
- **THEN** [5.5 h, 10.5 h) and [5 h 31 min 40 s, 10 h 31 min 40 s); [5 h, 11 h) and [10 h − 100 ns, 10 h); [−10 min, 10 min) (centre at the track start)
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "computes jump, brush, pan and resize ranges"

#### Scenario: Gesture to action
- **WHEN** pointer sequences are fed to the strip gesture: down on the body at x 100, move to 103, up; down on the body at 100, move to 130, up at 130; down on edge "to" at 120, move to 140, up; down on a drive, up; down on bars, up, then down and up again 300 ms later 2 px away
- **THEN** a jump at 103; a preview and then a pan by 30 px; a resize of "to" by 20 px; a fit of that drive; a jump and then a whole-recording action
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "turns pointer sequences into strip actions"

#### Scenario: Escape cancels
- **WHEN** the user drags the window body and presses Escape before releasing
- **THEN** the window returns to the target's range and no command is sent
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "turns pointer sequences into strip actions" (cancel case); UI check by hand (real mouse), else `not_run`

### Requirement: Double-click shows the whole recording
A second click within 500 ms and 4 px of a first click SHALL set the range from the recording's `first` to just after its `last` (rounded up to the next millisecond) and replace the first click's step: no new history entry, so one "Back" returns to the range before the first click. Origin: D-057 („double-click shows the whole recording"); 500 ms: the double-click interval of `cursors`; replace rule: design S8.

#### Scenario: Double-click and Back
- **WHEN** window 1 shows a 20 min range on smart451 and the user double-clicks the strip, then clicks "Back" once
- **THEN** the header shows smart451's `first` to `last` from `/api/density` (local time, end rounded up to the ms), then the 20 min range again
- **Evidence:** UI check on smart451 at 1440×900 (header after each step, the `curl` of `/api/density` for `first` and `last`)

### Requirement: Drive row
Below the bars the strip SHALL draw each drive as a 4 px slate-600 segment, at least 4 px wide, slate-900 on hover, with a hit width of at least 8 px; a click on a drive SHALL set the range to the drive's `from`–`to`. Overlapping hit widths go to the nearest drive centre. Origin: D-057 („clicking a drive fits it"); sizes: design S5.

#### Scenario: Drive geometry
- **WHEN** on the track of "Geometry" a drive spans [5 h, 5 h 4 min)
- **THEN** its segment is drawn at [58.4, 62.4] px and its hit width is [56.4, 64.4]
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "draws drives with a minimum width and hit width"

#### Scenario: Fit a drive on smart451
- **WHEN** smart451 is shown at 1440×900 and the user clicks the second drive segment
- **THEN** the strip shows one segment per entry of `/api/density`'s `drives` (five at least), and the header shows the second drive's `from`–`to` in local time
- **Evidence:** UI check on smart451 at 1440×900 (screenshot of the strip, header, the `curl` of `drives`)

### Requirement: Drive keys
Outside text fields and selects, without Ctrl, Meta or Alt and while no drag runs, `.` SHALL fit the bar target to the first drive whose centre lies after its range's centre and `,` to the last drive whose centre lies before it; without such a drive nothing is sent. Held keys step once per press. Origin: D-057 („keys step to the previous/next drive"); key choice: design Q2; text-field rule as `time-navigation` "Navigation keys".

#### Scenario: Step math
- **WHEN** drives are [100, 200), [300, 400), [500, 600) and the view is [300, 400), [320, 330), [0, 1000) and [600, 700)
- **THEN** next/previous give the third/first; the second/first; the third/second; nothing/the third
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "steps to the previous and next drive"; `apps/web/test/keys.test.ts` › "maps the drive keys outside text fields"

#### Scenario: Keys on smart451
- **WHEN** window 1 shows smart451's whole recording, the user presses `.`, then `,` twice, then Backspace
- **THEN** the header shows, by `/api/density`'s `drives`, the first drive after the recording's centre, then the drive before it, then the one before that, then (Backspace) the drive of the first `,` again; the revision rose by one per key
- **Evidence:** UI check on smart451 at 1440×900 (header and revision after each key)

### Requirement: Strip tooltips
A bar SHALL have the tooltip `<local start> – <local end> · <rows>` and a drive `Drive <k> of <n> · <local from> – <local to> · <span> · <rows>`, times as in the window header, rows as `no rows`, `1 row` or `<count with thousands commas> rows`. The window and markers SHALL NOT hide a bar's tooltip. Origin: D-057 („a bar's tooltip gives its time range and rows"); drive tooltip: necessary consequence of drives without names.

#### Scenario: Tooltip text
- **WHEN** the tooltips of `drivecar`'s bar 12 and drive 1 are formatted in Europe/Berlin, and of a bar with 0 and with 1 row
- **THEN** `2026-10-02 03:00:00 – 2026-10-02 03:05:00 · 30,030 rows` and `Drive 1 of 3 · 2026-10-02 03:00:00 – 2026-10-02 03:30:00 · 30 min · 177,180 rows`; `… · no rows`, `… · 1 row`
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "formats bar and drive tooltips"

#### Scenario: Tooltip under the window
- **WHEN** window 1 shows a 2 h range on smart451 and the pointer rests on a bar under the window
- **THEN** that bar's tooltip shows (the `title` of the element under the pointer names the bar's hour)
- **Evidence:** UI check on smart451 at 1440×900 (`document.elementFromPoint` at the bar's centre and its `title`, screenshot)

### Requirement: Cursor markers on the strip
While cursor A or B is on, the strip SHALL draw it as a 1 px slate-900 line over the bars with a 10 px flag (A filled, B outlined, as in the windows); while L exists, a 1 px slate-500 line without a flag. Markers outside the track are not drawn, and they take no pointer input. Origin: D-057 („cursors A, B and the live cursor L are marked on the strip"); looks: D-055 Q3, design T4 of `adopt-design-language`.

#### Scenario: Marker positions
- **WHEN** on the track of "Geometry" markers are placed at 5 h, at −1 s and at 120 h
- **THEN** at x 60, not drawn, and at x 1438 (the track end)
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "places markers inside the track only"

#### Scenario: Markers on smart451
- **WHEN** A and B are on in window 1 of smart451 at its whole recording, and then the pointer hovers window 2's plot
- **THEN** the strip shows an A and a B line with flags at the x of their times (±1 px of the track position); while hovering, an L line follows the pointer's time; after the pointer leaves the plots the L line is gone
- **Evidence:** UI check on smart451 at 1440×900 (screenshots with and without hover, positions)

### Requirement: Strip drag cancel
A strip drag SHALL end on release, on pointer cancel or on Escape; Escape and pointer cancel send nothing. While it runs the page SHALL select no text. Origin: necessary consequence of drags that must always end (`timeseries-window` "Height drag always ends", "No text selection while dragging").

#### Scenario: Cancelled drag
- **WHEN** a strip gesture is pressed on the bars, moved 40 px, then cancelled
- **THEN** it yields no action, and a following release yields none either
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "turns pointer sequences into strip actions"

### Requirement: Event pins
The strip SHALL draw the shown events of its data ref as pins in a 6 px lane at the top of the bars: events less than 6 px from a group's first form one pin, centred, 3 px wide alone and at least 5 px for several, hit width at least 8 px, coloured by the group's most severe category (design V1–V3); the strip SHALL stay 55 px. Origin: D-058 („marks on the time strip"; „it can get super overwhelming"); D-056 (≤ 56 px).

#### Scenario: Pin geometry
- **WHEN** on the track of "Geometry" pins are built from events at 5 h (active), 5 h 20 min (change), 5 h 40 min (snapshot) and 130 h
- **THEN** two pins: [58.5, 65.5] px with 2 events coloured as a fault, hit [58, 66]; [66.5, 69.5] with 1 event coloured as info, hit [64, 72]; nothing for 130 h
- **Evidence:** `apps/web/test/eventMarks.test.ts` › "clusters events into pins"

#### Scenario: Pins on smart451
- **WHEN** smart451's whole recording is shown at 1440×900 with the shipped project file and the default filter
- **THEN** the strip shows pins, among them one at 2026-10-15 07:27 local in `rgb(190, 18, 60)` whose tooltip starts `13 events · 13 active faults`; the strip measures 55 px
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, tooltip text, strip height)

### Requirement: Pin tooltips
A pin of one event SHALL have the tooltip `<local time to the ms> · <category> · <source> <name>`, then the text (a change: `<from> → <to>`), then for a DTC its status text and for an inferred change `seen after a gap; last seen <from> at <local time>`; a pin of several `<n> events · <count> <category plural>, …` (categories most severe first), then one line per event (at most 8) and `… and <k> more`. Origin: D-058 (brief: „hover shows code + description + category + time"); design V4.

#### Scenario: Tooltip text
- **WHEN** the tooltips of the testcar event `P0CA700`, of the inferred `VCU.door` change at 02:00 and of a pin holding the nine DTCs of testcar are formatted in Europe/Berlin
- **THEN** `2026-10-01 07:00:00.000 · Active fault · BMS P0CA700` / `Discharge current too high` / `Status 0x29 failing now · confirmed · failed since clear`; `2026-10-01 04:00:00.000 · State change · VCU VCU.door` / `open → closed` / `seen after a gap; last seen open at 2026-10-01 03:04:30.000`; `9 events · 2 active faults, 1 pending fault, 2 stored faults, 2 untested DTCs, 1 passed DTC, 1 other event` and 8 lines and `… and 1 more`
- **Evidence:** `apps/web/test/eventMarks.test.ts` › "formats pin tooltips"

### Requirement: Pin click centres
A click on a pin SHALL centre the bar target's span on the pin's first event (exact time, span kept), as one `window.setRange` with one history entry; a drag that starts on a pin SHALL brush like one on the bars. Origin: D-058 (brief: „click jumps/centres"); range commands as "Strip actions are range commands".

#### Scenario: Centre math and gesture
- **WHEN** the view is [0, 20 min) and a pin's first event is at 5 h 0 min 0.135 s; and a gesture presses on a pin and releases, then presses on a pin and moves 40 px
- **THEN** the range is [4 h 50 min 0.135 s, 5 h 10 min 0.135 s); a centre action for that pin, then a brush
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "computes jump, brush, pan and resize ranges" (centre case), "turns pointer sequences into strip actions" (pin cases)

#### Scenario: Pin click on smart451
- **WHEN** window 1 shows a 20 min range on smart451 and the user clicks the pin of 2026-10-15 07:27 local
- **THEN** the header shows a 20 min range centred on 2026-10-15 07:27:12.135, the revision rose by one, and the chart shows the DTC marks at its centre
- **Evidence:** UI check on smart451 at 1440×900 (header, revision, screenshot)

### Requirement: Events count in the strip head
While the strip's data ref has events, the strip head SHALL show after the range a button `<shown> of <total> events` (11 px) whose click opens the sidebar on the Events tab with the filter field focused. It SHALL NOT be cut: the range and the info truncate first. Origin: D-058 (brief: „count of hidden events visible so filtering never hides silently"); design V5.

#### Scenario: Count on smart451
- **WHEN** smart451 is shown at 1440×900 with the shipped project file and the default filter, then at 1000×557 with the sidebar open, and the user clicks the count
- **THEN** the head shows `51 of 402 events` at both sizes, fully visible; after the click the sidebar shows the Events tab with the field focused
- **Evidence:** UI check on smart451 (screenshots at both sizes)

### Requirement: Signal drop on the strip
While a signal is dragged over the strip, the strip SHALL show as a drop target: for a signal with states not yet on the events line an accent outline and `Drop to mark state changes of <name>`, and a drop sends `events.addSignal`; else the refused look with `<name> has no named states` or `<name> is already on the events line`, and a drop sends nothing. Origin: D-059 („drags a signal with stats to horizon"; horizon = the events line).

#### Scenario: Drop on smart451
- **WHEN** the user drags `BS_200h.BLS` from the explorer onto the strip and drops it, then drags `SAM_423h.KL_15` over the strip and drops it
- **THEN** during the first drag the strip shows `Drop to mark state changes of BLS`; after the drop the revision rose by one, the Events tab lists BLS among the events-line signals and the count's total rose by 156; during the second drag it shows `KL_15 has no named states` and the drop changes nothing (revision unchanged)
- **Evidence:** UI check on smart451 at 1440×900 (screenshots during both drags, revision and count after)

#### Scenario: Drop target mapping
- **WHEN** drop targets are resolved for an element with `data-drop="events"` and a dragged signal with `states` `labels`, one without `states`, and one already in `eventSignals`
- **THEN** `{kind: "events"}` allowed, refused `no_states`, refused `already_listed`
- **Evidence:** `apps/web/test/drag.test.ts` › "maps drop elements to targets" (events cases)
