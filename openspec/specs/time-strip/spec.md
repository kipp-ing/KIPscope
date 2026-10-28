# time-strip Specification

## Purpose
The time strip under the option bar: one 28 px row over the whole recording of the shown data ref (or over the scope) with a data presence line (slate where data exists, accent inside the shown range, broken at data gaps), event pins, drives, end labels and day labels, its info as tooltip and its states, navigation by pointer and keys (jump, brush, pan, resize, fit a drive, whole recording, `,`/`.`), A/B/L markers with flags, and the `/api/density` endpoint (bars, drives, cache and prefetch after each catalog load) that feeds it.

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
Below the context row (below the top row when there is none), sticking with them, the page SHALL show the time strip for the data ref of the bar target's first signal, else of the first signal in any window, as one row of 28 px (27 px track and 1 px border) in every state, session, unlinked, scoped and loading: a 48 px end-label slot at each end ("Strip end labels") and the track between them holding the event pins at the top (y 2–9, "Event pins"), the data presence line ("Data presence line", y 12–15), drives ("Drive row"), the shown-range window, the cursor lines with their flags ("Cursor markers on the strip") and the day labels ("Strip day labels and hover time"); no head line, no `TIME` label, no range text and no density bars or area. Its info `<shown> of <recorded> recorded`, spans in the largest of y (365 d), d, h, min, s, ms they reach, one decimal at most, no `.0`, SHALL be the first line of the track's tooltip, its second line the hint `Time strip: …`. While a signal is dragged over the strip, its drop text ("Signal drop on the strip") SHALL show inside the track's box. Where other requirements of this capability name "the bars", they mean the track's line area (hit zone `bars`). Origin: D-055 (time strip on); D-057 supersedes "Clicking does nothing"; no head line: D-092 (1) and the designer's finding (range label collapsed to 0 px at 1000 px); one row, presence instead of bars: D-094 (Jan: „die balken wirken aktuell komisch"; „density would be just strip or no strip? thats probably good enough"), supersedes D-055/D-057's density bars on the strip; end labels: D-095 (critic 6: the strip has no time scale); 28 px and the lanes: mock `Strip.dc.html` row "Recommended" (×½ = 14 px holds pins or flags, not both; ×2 = 56 px is the old ceiling and costs plot share, "Screen use").

#### Scenario: Strip on real data
- **WHEN** the six-window setup is shown on smart451 at 1440×900 and window 1 is zoomed from its full extent to a 20 min range
- **THEN** the strip shows no `TIME` label, no range text and no bars; the end slots read `10-11` and `10-21`, each 48 px wide; the track's `title` starts with `… recorded` (or `… in scope` with a scope) and holds no `1 bar =`; before the zoom the whole line is in the accent `rgb(2, 132, 199)` (window 1 at its full extent covers all data, "Data presence line"), running where smart451 has data and broken where it has none; after the zoom the line is in `rgb(100, 116, 139)` outside the window and in `rgb(2, 132, 199)` inside it, and the track's `title` starts with `20 min of`; the strip is 28 px tall (±0.5 px) in both states
- **Evidence:** UI check on smart451 at 1440×900 (screenshot before and after the zoom, the track's `title`, the end slots' texts and widths, strip height)

### Requirement: Time strip states
Without a signal the track SHALL show `No signal shown` in the muted colour inside its box; while loading (and while a session step is on its way, case-navigation "Stepping shows the target at once") `Loading recording…` at the track's left over the 1 px baseline, with no presence line, drives or pins, and the track tooltip `Loading recording…`; after a failure `Recording unavailable` in the muted colour inside the track's box, the failure as tooltip, retrying every 30 s; without a timeseries window no accent and no window. The strip SHALL be 28 px tall and its end-label slots 48 px wide in every state (empty while their times are unknown), and it SHALL keep the plot share of `workspace-layout` "Screen use". Goal (reported, not pass/fail): while loading in a scope, the end labels, the shown range, the cursor lines and their flags are already drawn (mock row "Recommended", loading strip). Origin: necessary consequence (the strip must not move windows or hide data); 30 s: the load retry cap of D-042; one box in every state: D-092 („Layout never moves"), D-094 („same in a session, unlinked, scoped or loading").

#### Scenario: Strip states
- **WHEN** the workspace has no window; then only a values window with one signal; then the source is unreachable at page load
- **THEN** the track shows `No signal shown`; then the presence line with a track tooltip `<recorded> recorded` and no accent; then `Recording unavailable` in the muted colour, and the line appears without a reload within 30 s after the source is back; the strip is 28 px tall and each end slot 48 px wide in all three states (±0.5 px) and no window moves when it changes
- **Evidence:** UI check (screenshot per state, strip heights, end slot widths); `apps/web/test/strip.test.ts` › "takes the data ref of the target window, else of any window"

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
The strip SHALL draw the bar target's range as a window over the track, at its exact pixel position on the track's bucket pitch, at least 3 px wide (centred when wider than the range), clipped to the track: 1 px accent edges, accent fill at 8–12 %; the presence line inside it in the accent ("Data presence line"). When the window is drawn wider than the range, an 8 × 5 px accent caret SHALL point down at it from the track's top. Its grab area SHALL be at least 12 px wide. The accent SHALL mark nothing else on the strip. Origin: D-057 („the shown range is a grabbable window … pixel-exact with a minimum width"); sizes: design S6; the line in the accent: D-094 („the shown range in the accent"); 3 px, caret, accent only for the range: D-095 (critic 7, 8: a 0:12 range out of 227 h is < 1 px).

#### Scenario: Geometry
- **WHEN** a track of 1,438 px shows 120 buckets of 1 h from 0 (pitch 12 px) and the range is [5 h, 5 h 20 min), then [5 h, 5 h 5 min), then [5 h, 10 h), then [0, 120 h)
- **THEN** the window is drawn at [60, 64] px with a grab area [56, 68] and no caret; then at [59, 62] with grab [54.5, 66.5] and a caret; then [60, 120] with grab = drawn and no caret; then [0, 1438]
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "maps times to pixels and back on the bar pitch", "draws the window pixel-exact with minimum widths"

#### Scenario: 20 min on smart451
- **WHEN** window 1 shows a 20 min range on smart451 at 1440×900, then a 2 min range
- **THEN** the strip's window element is drawn at the 3 px minimum (±0.5 px) with the accent caret above it, its centre within 0.5 px of the range's middle on the track ("Geometry": centred when wider than the range); the presence line under it is in the accent; the same at 2 min; no other strip element has the colour `rgb(2, 132, 199)`. Derivation (data fact, round 1 of the final rounds): `/api/density` gives smart451 114 buckets of 2 h at this width, pitch `(trackWidth + 2) / counts.length` ≈ 9.4 px, so 20 min is about 1.6 px and 2 min about 0.16 px, both below 3 px; at buckets of 1 h (×½) 20 min would be about 3.1 px, still within 0.5 px of the minimum
- **Evidence:** UI check on smart451 at 1440×900 (the density's bucket count, the measured widths and centres, the caret's rect, one screenshot per range)

### Requirement: Strip hit zones and pointer
A press on the strip SHALL hit, in this order: an event pin (its 10 × 11 px hit area, "Event pins"; where two overlap, the nearer centre), a drive, a window edge (±4 px of a drawn edge, on windows drawn at least 16 px wide), the window body (its grab area, unless the window covers the recorded data to within 4 px), else the track (zone `bars`). A cursor flag is its own button and starts no strip gesture ("Cursor markers on the strip"); its hit area never covers a pin's. The pointer SHALL show `ew-resize` on edges, `grab` on the body (`grabbing` while panning), `pointer` on the track, drives, pins and flags, `crosshair` while dragging a range. Origin: D-057; design S7 of `add-strip-navigation`; pins: D-058, design V3; flags: D-094; hit sizes: D-095 (critic 5, 13).

#### Scenario: Zones
- **WHEN** on the track of "Geometry" the window is [5 h, 5 h 20 min) and the pointer is at x 62, 57 and 55 in the line area and at x 62 in the drive row without drives; then the window is [5 h, 10 h) and x is 57, 64, 65, 123 and 125; then the window is [0, 120 h) and x is 700, 2 and 1436
- **THEN** body, body, bars, bars; then edge from, edge from, body, edge to, bars; then bars, edge from, edge to
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "finds the hit zone"

#### Scenario: Pin zones
- **WHEN** on the track of "Geometry" the window is [5 h, 10 h), pins are built from events at 5 h (active), 5 h 20 min (change) and 5 h 40 min (snapshot), and the pointer is at (62, 3), (64.5, 3), (66, 3), (69, 3), (62, 12) and (90, 3)
- **THEN** pin 0, pin 0, pin 1, pin 1, edge from, body
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "finds the hit zone" (pin cases)

#### Scenario: Pointer shapes
- **WHEN** window 1 shows a 6 h range on smart451 at 1440×900 (drawn about 28 px wide; a range under about 3.5 h is drawn below the 16 px that edges need, "Strip hit zones and pointer", so the scenario needs at least 4 h) and the pointer moves over the line outside the window, the window's middle, its left edge, a drive segment, the event pin of 2026-10-15 07:27 local and cursor A's flag
- **THEN** the computed `cursor` under the pointer is `pointer`, `grab`, `ew-resize`, `pointer`, `pointer` and `pointer`
- **Evidence:** UI check on smart451 at 1440×900 (computed values after each move)

### Requirement: Click jumps keeping the span
A click (press and release less than 4 px apart) on the track, the window body or an edge SHALL centre the bar target's current span on the time under the pointer, rounded to the strip unit (the largest power of ten in ns at most 1/1000 of the track's span). Origin: D-057 („click a bar jumps there keeping the span"); click threshold as for cursors (4 px, `cursors` "Placing cursors by click"); the track instead of bars: D-094.

#### Scenario: Jump math
- **WHEN** on the track of "Geometry" the view is [0, 20 min) and the user clicks at x 60
- **THEN** the new range is [4 h 50 min, 5 h 10 min) (unit 100 s)
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "computes jump, brush, pan and resize ranges"

#### Scenario: Jump on smart451
- **WHEN** window 1 shows a 20 min range on smart451 and the user clicks the strip's line at the drive of 2026-10-13 11:00–12:00 local
- **THEN** the range button shows a start within 11:00–12:00 minus 10 min and `0:20 h`, the revision rose by one, and the window element moved under the click
- **Evidence:** UI check on smart451 at 1440×900 (range button and revision before and after, screenshot)

### Requirement: Drag zooms to the range
A press on the track (or on a drive, or on the body of a window covering the recorded data to within 4 px) moved at least 4 px SHALL draw an accent range and, on release, set the range between press and release, both ends rounded to the strip unit; a release less than 4 px left or right of the press SHALL send nothing. Origin: D-057 („drag across the strip zooms to that range"); the track instead of bars: D-094.

#### Scenario: Brush math
- **WHEN** on the track of "Geometry" a range is dragged from x 60 to x 120, from 120 to 60, and from 60 to 62 (with 10 px vertical movement)
- **THEN** [5 h, 10 h) twice and nothing the third time
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "computes jump, brush, pan and resize ranges", "turns pointer sequences into strip actions"

#### Scenario: Brush on smart451
- **WHEN** the user drags across the strip from the start to the end of 2026-10-13's line (left_click_drag of the browser tool)
- **THEN** the range button shows about that local day (`26-10-13 00:…` and about `24:00 h`), rounded to the strip unit, one revision; if the tool cannot drag, `not_run` and Jan checks it by hand
- **Evidence:** UI check on smart451 at 1440×900 (range button and revision), else `not_run`

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
Each drive SHALL be drawn as a 5 px slate-700 (`#334155`) segment over the presence line (y 11–16), at least 4 px wide, slate-900 on hover and never in the accent, with a hit width of at least 8 px; a click on a drive SHALL set the range to the drive's `from`–`to`. Overlapping hit widths go to the nearest drive centre. While a catalog is linked the strip SHALL draw no drives (the session is the drive). In an object scope (unlinked) the drives are those of the work window's detail density, and the catalog's session marks lie in the same row, hit before the drives (object-view "Catalog marks on the strip"). Origin: D-057 („clicking a drive fits it"); widths: design S5; slate, 5 px, none in a linked session: D-094 („drives in slate"), mock `Strip.dc.html` row "Recommended" (vehicle strip draws drives, session strips none); `#334155`, no accent: D-095 (the accent means only the shown range).

#### Scenario: Drive geometry
- **WHEN** on the track of "Geometry" a drive spans [5 h, 5 h 4 min)
- **THEN** its segment is drawn at [58.4, 62.4] px and its hit width is [56.4, 64.4]
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "draws drives with a minimum width and hit width"

#### Scenario: Fit a drive on smart451
- **WHEN** smart451 is shown at 1440×900 without a scope and the user clicks the second drive segment; then a catalog from `kipscope case drives smart451` is opened
- **THEN** the strip shows one segment per entry of `/api/density`'s `drives` (five at least) in `rgb(51, 65, 85)`, the range button shows the second drive's start and duration, the shown-range window covers that drive's segment, which stays `rgb(51, 65, 85)`; in the linked session the strip shows no drive segment
- **Evidence:** UI check on smart451 at 1440×900 (screenshots, range button, the segment's computed background, the `curl` of `drives`)

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
A drive SHALL have the tooltip `Drive <k> of <n> · <start and duration> · <rows>`, a break of the presence line `No data · <start and duration>` ("Data presence line"), the line itself the track's tooltip ("Time strip"); start and duration by range-picker "Start and duration", rows as `no rows`, `1 row` or `<count with thousands commas> rows`. The window and markers SHALL NOT hide a drive's tooltip. Origin: D-057 (tooltips give time range and rows); drive tooltip: necessary consequence of drives without names; no bar tooltips: D-094 (no bars); start and duration: D-093, D-095.

#### Scenario: Tooltip text
- **WHEN** the tooltip of `drivecar`'s drive 1 is formatted in Europe/Berlin, and `rowsText` gets 0, 1 and 30,030
- **THEN** `Drive 1 of 3 · 26-10-02 03:00  0:30 h · 177,180 rows`; `no rows`, `1 row`, `30,030 rows`
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "formats drive tooltips"

#### Scenario: Tooltip under the window
- **WHEN** smart451 is shown without a scope, the user clicks a drive segment (the window then covers it) and the pointer rests on that segment inside the window
- **THEN** the drive's tooltip shows (the `title` of the element under the pointer starts `Drive <k> of <n> · 26-`)
- **Evidence:** UI check on smart451 at 1440×900 (`document.elementFromPoint` at the segment's centre and its `title`, screenshot)

### Requirement: Cursor markers on the strip
While cursor A or B is on and lies inside the track's span, the strip SHALL draw it as a 1 px slate-900 line over the whole track height (B dashed) with a flag: a `<button>` (`aria-label` `Bring cursor A into view`) whose hit area is 24 × 24 px from y 11 of the track (hanging 7 px below the strip, clear of the pin lane), with a 14 × 12 px face at y 15–27, radius 2, the letter `A` or `B` in 9 px bold, A filled slate-900 with a white letter, B white with a 1 px slate-900 outline. When A's and B's lines lie less than 18 px apart, one `A·B` flag (face 26 × 12 px, hit area 32 × 24 px, `aria-label` `Bring cursors A and B into view`) centred between them SHALL replace both. A cursor outside the track's span SHALL draw no line and its flag at that track edge with a caret beside it (`◂ A` at the start, `B ▸` at the end, `aria-label` `Cursor B lies after the strip: bring it into view`); two on the same edge merge to `A·B`. Hover SHALL add a 2 px slate-400 outline to the face, never the accent; the tooltip is `HINTS.stripFlag` (design DW18). A click on a flag SHALL centre the bar target's span on its cursor (span kept; for `A·B` on the midpoint with a span of at least twice their distance) with one `window.setRange` and one history entry, as "Pin click centres" does, and start no strip gesture. While L exists, a 1 px slate-500 line without a flag. Lines take no pointer input. Origin: D-057 („cursors A, B and L are marked on the strip"); D-055 Q3; flags that jump back: D-094 (Jan: „a/b labels should be on the strip to jump back to it"); 14 × 12 face, 24 × 24 hit, `A·B` under 18 px, edge caret, no accent: D-095 (critic 7, 8, 13); sizes: mock `Strip.dc.html` row "Recommended" (×2 in design DW2).

#### Scenario: Marker positions
- **WHEN** on the track of "Geometry" markers are placed at 5 h, at −1 s and at 120 h
- **THEN** at x 60, not drawn, and at x 1438 (the track end)
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "places markers inside the track only"

#### Scenario: Flag positions
- **WHEN** on the track of "Geometry" `stripFlags` gets A at 7 h and B at 9 h; A at 7 h and B at 8 h 30 min; A at 7 h and B at 7 h 20 min; A off and B at 7 h 20 min; A at −1 s and B at 7 h 20 min; A at 7 h and B at 121 h; A at −1 s and B at −2 s
- **THEN** lines A 84 and B 108, flags A at 84 with hit [72, 96] and B at 108 with hit [96, 120]; lines 84 and 102, two flags (18 px apart); lines 84 and 88, one `A·B` flag at 86 with hit [70, 102]; line B 88, flag B at 88 with hit [76, 100]; no A line, an A edge flag `before` at 14 with hit [0, 24], line and flag B at 88; line and flag A at 84, no B line, a B edge flag `after` at 1424 with hit [1414, 1438]; no lines, one `A·B` edge flag `before` at 20 with hit [0, 36]
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "places and merges the cursor flags, edge flags outside the track"

#### Scenario: Flag click
- **WHEN** the view is [0, 20 min) and the flag of cursor A at 5 h 0 min 0.135 s is clicked; the `A·B` flag with A at 5 h and B at 5 h 1 min is clicked with that view, and with the view [0, 1 min); and `HINTS.stripFlag` and `HINTS.stripFlagAB` get the samples of design DW18
- **THEN** one centre action with [4 h 50 min 0.135 s, 5 h 10 min 0.135 s); [4 h 50 min 30 s, 5 h 10 min 30 s); [4 h 59 min 30 s, 5 h 1 min 30 s); the hint texts of DW18, each within the wording rule
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "centres the view on a clicked cursor flag"; `apps/web/test/hints.test.ts` › "keeps every hint within the wording rule"

#### Scenario: Markers on smart451
- **WHEN** A and B are on in window 1 of smart451 at its whole recording, a few minutes apart, the user zooms to a 20 min range away from both, hovers the flag and clicks it; then the pointer hovers window 2's plot
- **THEN** the strip shows an A and a B line at the x of their times (±1 px) and one `A·B` flag (their lines lie under 18 px apart at the whole recording), face 26 × 12 px, button 32 × 24 px whose top is 11 px below the track's top; on hover the face keeps its fill (no `rgb(2, 132, 199)`) with an outline, its tooltip names both times; after the click the range button shows a 20 min range (`0:20 h`) holding A and B, one revision more, and one Back returns to the range before; while hovering the plot an L line follows the pointer's time and is gone after the pointer leaves the plots
- **Evidence:** UI check on smart451 at 1440×900 (screenshots, flag and button rects, computed fill on hover, range button and revision)

#### Scenario: Edge flag on smart451
- **WHEN** at 1440×900 A is placed on smart451 at 2026-10-13 15:09 local at the whole recording, then a scope of 2026-10-17 10:00 – 12:00 local is set (CLI or API, as in "Scope on smart451"), and the user clicks A's flag
- **THEN** the strip draws no A line and A's flag at the track's start with a caret left of the face, black as before (`rgb(15, 23, 42)` fill), with the tooltip naming `before the strip's start`; the click sends one `window.setRange` that ends at the scope's start (the message names the scope edge); setting the scope drops a cursor outside it (scope "Ranges and cursors stay in the scope"), so this UI setup cannot be built with a scope and the UI part is `not_run`; the unit test carries the scenario
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "places and merges the cursor flags, edge flags outside the track" (carries the scenario)

### Requirement: Strip drag cancel
A strip drag SHALL end on release, on pointer cancel or on Escape; Escape and pointer cancel send nothing. While it runs the page SHALL select no text. Origin: necessary consequence of drags that must always end (`timeseries-window` "Height drag always ends", "No text selection while dragging").

#### Scenario: Cancelled drag
- **WHEN** a strip gesture is pressed on the bars, moved 40 px, then cancelled
- **THEN** it yields no action, and a following release yields none either
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "turns pointer sequences into strip actions"

### Requirement: Event pins
The strip SHALL draw the shown events of its data ref as pins in the lane at the top of the track: events less than 6 px from a group's first form one pin, centred, with one shape per kind of the group's most severe category (add-events design V1–V3): a fault (active, pending) a 2 px tick over the full track height with a 7 × 4 px head at y 0–4; a change a short tick at y 2–9, 2 px wide alone and 4 px for several; a stored event or a group of DTC reads (improve-events design P5) hollow, 6 × 7 px (8 px for several) at y 2–9 with a 1.5 px inset outline in its colour on the panel fill; any other a 4 × 4 px dot at y 4–8. Colours: fault `#be123c`, stored `#b45309`, change `#7c3aed`, other `#64748b`. Each pin SHALL have a hit area of at least 10 × 11 px (y 0–11) centred on it before trimming at the bisector to a neighbouring pin (where two hit areas overlap the nearest centre decides, "Strip hit zones and pointer", so a pin less than 10 px from its neighbour gets a narrower hit; design DW20); the strip SHALL stay 28 px. Origin: D-058 („marks on the time strip"; „it can get super overwhelming"); hollow: data fact (DTC times are readout times), proposal E-3; lane and height: D-094, mock `Strip.dc.html` row "Recommended"; shapes and hit area: D-095 (critic 5: 3 × 7 px pins told apart by colour only, fault vs stored under deuteranopia; 3 px cannot be hovered).

#### Scenario: Pin geometry
- **WHEN** on the track of "Geometry" strip pins are built from events at 5 h (active), 5 h 20 min (change), 5 h 40 min (snapshot) and 130 h; and separately from one change at 10 h, two changes at 15 h and 15 h 10 min, and an active DTC read at 20 h
- **THEN** two pins: shape `fault` in `#be123c` drawn [58.5, 65.5] with 2 events, hit [57, 67]; shape `dot` in `#64748b` drawn [66, 70] with 1 event, hit [63, 73]; nothing for 130 h; then `change` [119, 121] hit [115, 125]; `change` with 2 events [179, 183] hit [176, 186]; `hollow` in `#be123c` [237, 243] hit [235, 245]
- **Evidence:** `apps/web/test/eventMarks.test.ts` › "clusters events into pins" (unchanged), "shapes strip pins by kind"

#### Scenario: Pins on smart451
- **WHEN** smart451's whole recording is shown at 1440×900 with the shipped project file and the default filter
- **THEN** the strip shows pins in the top lane of the track, among them a hollow one at 2026-10-15 07:27 local with a `rgb(190, 18, 60)` outline whose tooltip starts `13 events · 13 active faults`, short ticks in `rgb(124, 58, 237)` for changes, and every pin's hit element 11 px tall and at least 10 px wide before trimming at the bisector to a neighbouring pin (a narrower hit element ends, ±0.5 px, at the midpoint between its pin's centre and the neighbour's; round 1 of the final rounds measured 6 of 21 at 8.9–9.8 px, centres 9–9.8 px apart); the strip measures 28 px
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, tooltip text, pin and hit rects, strip height)

### Requirement: Pin tooltips
A pin of one event SHALL have the tooltip `<local time to the ms> · <category> · <source> <name>`, then the text (a change: `<from> → <to>`), then for a DTC its status text and the line `Fault memory read at this time; when a fault first occurred is unknown`, and for an inferred change `seen after a gap; last seen <from> at <local time>`; a pin of several `<n> events · <count> <category plural>, …` (categories most severe first), then that readout line when any of its events is a DTC, then one line per event (at most 8) and `… and <k> more`. Origin: D-058 (brief: „hover shows code + description + category + time"); add-events design V4; readout line: data fact (DTC times are readout times), proposal E-3.

#### Scenario: Tooltip text
- **WHEN** the tooltips of the testcar event `P0CA700`, of the inferred `VCU.door` change at 02:00 and of a pin holding the nine DTCs of testcar are formatted in Europe/Berlin
- **THEN** `2026-10-01 07:00:00.000 · Active fault · BMS P0CA700` / `Discharge current too high` / `Status 0x29 failing now · confirmed · failed since clear` / `Fault memory read at this time; when a fault first occurred is unknown`; `2026-10-01 04:00:00.000 · State change · VCU VCU.door` / `open → closed` / `seen after a gap; last seen open at 2026-10-01 03:04:30.000`; `9 events · 2 active faults, 1 pending fault, 2 stored faults, 2 untested DTCs, 1 passed DTC, 1 other event`, the readout line, 8 lines and `… and 1 more`
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

### Requirement: Signal drop on the strip
While a signal is dragged over the strip, the strip SHALL show as a drop target: for a signal with states not yet on the events line an accent outline and `Drop to mark state changes of <name>`, and a drop sends `events.addSignal`; else the refused look with `<name> has no named states` or `<name> is already on the events line`, and a drop sends nothing. Origin: D-059 („drags a signal with stats to horizon"; horizon = the events line).

#### Scenario: Drop on smart451
- **WHEN** the user drags `BRK_1A0h.BRK_LMP` from the explorer onto the strip and drops it, then drags `BCM_42Eh.IGN_15` over the strip and drops it
- **THEN** during the first drag the strip shows `Drop to mark state changes of BRK_LMP`; after the drop the revision rose by one, the Events tab lists BRK_LMP among the events-line signals and the count's total rose by 156; during the second drag it shows `IGN_15 has no named states` and the drop changes nothing (revision unchanged)
- **Evidence:** UI check on smart451 at 1440×900 (screenshots during both drags, revision and count after)

#### Scenario: Drop target mapping
- **WHEN** drop targets are resolved for an element with `data-drop="events"` and a dragged signal with `states` `labels`, one without `states`, and one already in `eventSignals`
- **THEN** `{kind: "events"}` allowed, refused `no_states`, refused `already_listed`
- **Evidence:** `apps/web/test/drag.test.ts` › "maps drop elements to targets" (events cases)

### Requirement: Selection drop on the strip
While an explorer selection of two or more signals is dragged over the strip and some of them have named states and are not on the events line, the strip SHALL show the accent outline and `Drop to mark state changes of <name>` (the shown name of the only such signal, else `<k> signals`); a drop SHALL send `events.addSignal` for each such signal in list order, skip the others, and stop at the first refusal. Origin: D-059 with D-066; skipping: lead default L5.

#### Scenario: Selection with one state signal
- **WHEN** on smart451 at 1440×900 `BRK_1A0h.BRK_LMP` is not on the events line, the user types `BRK_LMP`, clicks `BRK_LMP` and Shift-clicks `FULL_BRK` (BRK_LMP, BRK_LMP_PA, BRK_LMP_RAW, FULL_BRK; only BRK_LMP has states) and drags the selection onto the strip
- **THEN** while dragging the strip shows `Drop to mark state changes of BRK_LMP`; after the drop the revision rose by one and the Events tab lists BRK_LMP among the events-line signals
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while dragging, revision after)

### Requirement: Selection without new state signals
When no signal of a dragged selection has named states and is off the events line, the strip SHALL show the refused look with `None of <N> signals has new named states`, and a drop SHALL send nothing. Origin: D-059 with D-066; lead default L5.

#### Scenario: Strip helpers
- **WHEN** `eventsDropMany` gets IDs of a signal with states, one without, one already in `eventSignals` and a second with states; and `stripDropText` gets `{name: "4 signals", ok: false, reason: "none_new"}`
- **THEN** the two signals with states that are not listed, in input order; `None of 4 signals has new named states`
- **Evidence:** `apps/web/test/drag.test.ts` › "adds the selection's new state signals on the strip"; `apps/web/test/strip.test.ts` › "names a selection that has no new state signals"

### Requirement: Density of a scope
While the workspace has a scope, `GET /api/density?dataRef=<scope's data ref>` SHALL cover the scope only (design Z9). `first` is the scope's `from`, `last` is its `to` − 1 ns, and `scope` carries `{from, to}`. Width, grid, counts and drives follow the existing rules over that span. The answer SHALL come from one `refBuckets` query with that scope and no `refExtent` query, and SHALL be cached per scope; after a scope's signal list loads, the server SHALL compute that density in the background (an object scope's coarse one). In an object scope the answer SHALL be coarse, and with `from` and `to` it SHALL cover `[from, to) ∩ scope` (object-view "Coarse strip over the vehicle", "Detail around the view"). Origin: the ADX feedback item 4 („The time strip … cover[s] only the scope's range"); D-078; object scope: D-086.

#### Scenario: One hour of testcar
- **WHEN** the test server has scope {testcar, T1, T2} and `GET /api/density?dataRef=testcar` is sent
- **THEN** 200 with `first` `"1790816400000000000"`, `last` `"1790819999999999999"`, `scope` `{from: T1, to: T2}`, `width` `"30000000000"` (15 s would need 240 bars), 120 `counts` whose sum equals `SELECT count() FROM sdlog.signals WHERE vehicle = 'testcar' AND utc >= T1 AND utc < T2`, and `drives` within [T1, T2)
- **Evidence:** `apps/server/test/density.http.test.ts` › "covers only the scope"

#### Scenario: One query per scope
- **WHEN** a stub source records its calls, the scope {testcar, T1, T2} is set, and `/api/density?dataRef=testcar` is sent twice
- **THEN** the source got exactly one `refBuckets` call with that scope and no `refExtent` call
- **Evidence:** `apps/server/test/density.test.ts` › "computes a scope's density from one bucket query"

#### Scenario: Part of a scope
- **WHEN** the scope is {testcar, T1, T2} and `GET /api/density?dataRef=testcar&from=2026-10-01T01:30:00Z&to=2026-10-01T03:00:00Z` is sent, then the same with only `from`
- **THEN** the first answers `first` 01:30:00 and `last` T2 − 1 ns (cut to the scope) with drives inside it; the second answers 400 `invalid_request`
- **Evidence:** `apps/server/test/density.http.test.ts` › "covers part of the scope"

### Requirement: Strip shows the scope
While the workspace has a scope, the strip SHALL show the scope's data ref whatever the windows hold, and its info (the tooltip line of "Time strip") SHALL read `<shown> of <span> in scope`; in scoped mode without a scope the track SHALL show `No scope set`. Double-click, drive clicks and drive keys then act within the scope. Origin: the ADX feedback item 4 („The time strip … cover[s] only the scope's range"); D-078; info as tooltip: D-092; no `1 bar =`: D-094 (no bars).

#### Scenario: Label with a scope
- **WHEN** `stripLabel` gets the range [T1 + 10 min, T1 + 20 min) and a density with `scope` [T1, T2) and width 30 s; and the same range with a density without `scope` whose `first` is T1 and `last` 6 d later
- **THEN** it reads `10 min of 1 h in scope`; then `10 min of 6 d recorded`
- **Evidence:** `apps/web/test/strip.test.ts` › "labels the shown span within the scope", "labels the shown and recorded spans"

#### Scenario: Data ref of the strip
- **WHEN** the strip's data-ref choice gets a workspace with scope on `testcar` whose only window shows `othercar/Fast_100h.SIG_A`, and the same workspace without scope
- **THEN** it gives `testcar`, then `othercar`
- **Evidence:** `apps/web/test/strip.test.ts` › "takes the scope's data ref"

### Requirement: Strip scope controls
With a scope and no open catalog, the context row SHALL show the scope in the session bar's slots: label `SCOPE`, the data ref in the title slot with the tooltip `<data ref> · <full start> · <duration>` (range-picker "Start and duration"), the scope's duration in the duration slot, **Widen** (one `scope.set`, scope "Widen") in the action slot and, in full mode only, **Clear** (`scope.clear`) in a second 64 px action slot after it; no arrows and no position. While a catalog is open, the row SHALL show the session bar instead, with no Widen and no Clear. Without scope and catalog there SHALL be no context row. Origin: D-078 („widening it is an explicit step"); Clear: design Q-1 (a) of `add-scope`; session bar: D-086, Q-6 (a); same row and slots: D-092; start and duration: D-093; start only in the tooltip: D-095 (critic 10, the session bar's slots).

#### Scenario: Scope on smart451
- **WHEN** Jan's view is open on smart451 in full mode with a scope of 2026-10-13 14:00 – 16:00 local, at 1440×900 and at 1000×557; the user double-clicks the strip, clicks **Widen**, then **Clear**
- **THEN** the context row reads `SCOPE smart451`, the duration tag `2:00 h`, then `Widen Clear`, on one line (`SCOPE` left out at 1000×557), the title's tooltip contains `Tue 2026-10-13 14:00`, and the strip is 28 px tall at both sizes; the double-click makes the shown range 14:00 – 16:00; after Widen the duration reads `6:00 h` and the tooltip `Tue 2026-10-13 12:00` with Widen at the same x (±1 px) and the explorer reloaded; after Clear the context row is gone and the presence line spans the whole recording again
- **Evidence:** UI check on smart451 (one screenshot per step, the title's `title`, strip height at both sizes)

#### Scenario: Head with a catalog
- **WHEN** the context row renders a workspace with a scope and an open catalog, linked and unlinked, and a workspace with neither
- **THEN** it renders the session bar in both case states and neither Widen nor Clear; for the third it renders nothing
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "renders the context row for a case, a scope or neither"

### Requirement: Data presence line
The strip SHALL show where its data ref has rows as a 3 px slate-500 line (y 12–15) on a 1 px baseline, in the accent inside the shown range, from `first` to `last` of `/api/density`, broken at empty buckets and at the logger gaps of `/api/gaps`; breaks at least 3 px, merged (design DW19). The logger gaps come from the gap info the windows share, so the strip asks for none of its own and, while no window shows a signal of the strip's data ref, only empty buckets break the line (design DW10). No density bar or area. Origin: D-094 („data presence as a thin line with breaks at data gaps"); gaps: D-062; 3 px: mock `Strip.dc.html`; slate-500: D-095 (critic 8).

#### Scenario: Presence of a track
- **WHEN** `presence` gets the track of "Geometry" (1,438 px, 120 buckets of 1 h from 0), counts 1 except buckets 10 and 11 at 0, `first` 30 min, `last` 119 h 30 min, the range [20 h, 30 h), and the logger gaps [50 h, 50 h 15 min) and [50 h 17.5 min, 50 h 25 min); and the same without logger gaps, in Europe/Berlin
- **THEN** runs [6, 120], [144, 240], [240, 360] (shown), [360, 600], [605.75, 1434] and breaks [120, 144] `No data · 70-01-01 11:00  2:00 h` and [600, 605.75] `No data · 2 gaps · 70-01-03 03:00  0:25 h`; without logger gaps runs [6, 120], [144, 240], [240, 360] (shown), [360, 1434] and the one break [120, 144]
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "draws data presence with breaks at empty buckets and logger gaps"

#### Scenario: Presence on smart451
- **WHEN** a catalog from `kipscope case drives smart451` is open on the drive of 2026-10-13 11:06 local (the logger gap 11:27:53.936 – 11:27:56.982 local lies in it, data-gaps "smart451 logger gaps") at 1440×900
- **THEN** the strip shows the presence line in `rgb(100, 116, 139)` with one break of 3 px at that time whose tooltip reads `No data · 26-10-13 11:27:53  3 s`, no bars and no density area, and the strip is 28 px tall
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, the line's colour, the break's rect and `title`, strip height)

### Requirement: Strip end labels
Each end-label slot (48 px) SHALL show the strip span's end time in 10 px slate-500 tabular figures: the scope's bounds with a scope, else `first` and `last` of the density; `HH:MM` when the span is shorter than 24 h, else `MM-DD`, cut; the full local time with seconds as tooltip (`fullTime`). While the span is unknown the slots stay empty in their box. Origin: D-095 (critic 6: the strip has no time scale); slots, size, colour: mock `Strip.dc.html` row "Recommended".

#### Scenario: End label texts
- **WHEN** `endLabels` gets 2026-10-13T13:06:03Z – 13:18:33Z, 2026-10-11T12:34:24Z – 2026-10-20T23:52:43Z and 2026-10-20T21:31:05Z – 23:52:43Z in Europe/Berlin
- **THEN** `15:06` (`Tue 2026-10-13 15:06:03`) and `15:18` (`Tue 2026-10-13 15:18:33`); `10-11` (`Sun 2026-10-11 14:34:24`) and `10-21` (`Wed 2026-10-21 01:52:43`); `23:31` and `01:52`
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "labels the strip's ends"

#### Scenario: End labels on smart451
- **WHEN** at 1440×900 a catalog from `kipscope case drives smart451` is open on the drive of 2026-10-13 15:06 local, then the user clicks **Unlink**
- **THEN** linked, the left slot reads the session scope's start as `HH:MM` with a tooltip starting `Tue 2026-10-13 ` and the right its end; unlinked, `10-11` and `10-21`; both slots 48 px wide, text colour `rgb(100, 116, 139)`, 10 px, in both states
- **Evidence:** UI check on smart451 (texts, tooltips, rects and computed style per state, one screenshot each)

### Requirement: Strip day labels and hover time
While no catalog is linked, the track SHALL mark local midnights in its span with a hairline and a `MM-DD` label, drawn labels at least 32 px apart and none within 24 px of the track's end (design DW19). While the pointer rests on the track and no gesture runs, a hairline SHALL follow it with its time below the strip (`HH:MM:SS` for a span under 24 h, else `MM-DD HH:MM`), moving nothing. Origin: D-095 (critic 6: day labels when unlinked, a readout on hover); mock `Strip.dc.html`.

#### Scenario: Day ticks and hover text
- **WHEN** `dayTicks` gets the track of "Geometry" (from 0 to 120 h, Europe/Berlin, local midnights at 23 h, 47 h, 71 h, 95 h and 119 h); then the same buckets on a 142 px track (pitch 1.2 px); and `hoverText` gets 2026-10-13T13:13:48.700Z with a span of 12 min and of 9 d
- **THEN** labels at 276 `01-02`, 564 `01-03`, 852 `01-04` and 1140 `01-05` (119 h lies within 24 px of the end); then at 27.6 `01-02` and 85.2 `01-04`; `15:13:48` and `10-13 15:13`
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "marks local midnights and words the hover time"

#### Scenario: Day labels and hover on smart451
- **WHEN** at 1440×900 smart451 is shown without a catalog, the pointer rests on the track, then leaves it; then a catalog from `kipscope case drives smart451` is opened (linked)
- **THEN** the track shows day labels from `10-12` on with hairlines at local midnight; while resting, a hairline at the pointer and a time below the strip, gone after the pointer leaves, and the layout probe (design DW1) reports at most 1 px over the hover; in the linked session no day label
- **Evidence:** UI check on smart451 (screenshots, label texts, probe output)
