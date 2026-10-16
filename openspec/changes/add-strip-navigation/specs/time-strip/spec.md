## MODIFIED Requirements

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

## ADDED Requirements

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
A press on the strip SHALL hit, in this order: a drive (drive row), a window edge (±4 px of a drawn edge, only on windows drawn at least 16 px wide), the window body (its grab area, unless the window spans the whole track), else the bars. The pointer SHALL show `ew-resize` on edges, `grab` on the body (`grabbing` while panning), `pointer` on bars and drives, `crosshair` while dragging a range. Origin: D-057 („slide = pan, edges = zoom"); zones: design S7.

#### Scenario: Zones
- **WHEN** on the track of "Geometry" the window is [5 h, 5 h 20 min) and the pointer is at x 62, 57 and 55 in the bars area and at x 62 in the drive row without drives; then the window is [5 h, 10 h) and x is 57, 64, 65, 123 and 125; then the window is [0, 120 h) and x is 700, 2 and 1436
- **THEN** body, body, bars, bars; then edge from, edge from, body, edge to, bars; then bars, edge from, edge to
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "finds the hit zone"

#### Scenario: Pointer shapes
- **WHEN** window 1 shows a 2 h range on smart451 and the pointer moves over a bar outside the window, the window's middle, its left edge and a drive segment
- **THEN** the computed `cursor` of the strip's track is `pointer`, `grab`, `ew-resize` and `pointer`
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
A press on the bars (or on a drive, or on the body of a window spanning the whole track) moved at least 4 px SHALL draw an accent range and, on release, set the range between press and release, both ends rounded to the strip unit; a release less than 4 px left or right of the press SHALL send nothing. Origin: D-057 („drag across the strip zooms to that range").

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
