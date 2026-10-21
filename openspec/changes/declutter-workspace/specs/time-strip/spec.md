## MODIFIED Requirements

### Requirement: Time strip
Below the context row (below the top row when there is none), sticking with them, the page SHALL show the time strip for the data ref of the bar target's first signal, else of the first signal in any window, as one row of 28 px (27 px track and 1 px border) in every state, session, unlinked, scoped and loading: event pins at the top (y 2–9), the data presence line ("Data presence line", y 12–15), drives ("Drive row"), the shown-range window, and the cursor lines with their flags ("Cursor markers on the strip", y 16–26); no head line, no `TIME` label, no range text and no density bars or area. Its info `<shown> of <recorded> recorded`, spans in the largest of y (365 d), d, h, min, s, ms they reach, one decimal at most, no `.0`, SHALL be the first line of the track's tooltip, its second line the hint `Time strip: …`. While a signal is dragged over the strip, its drop text ("Signal drop on the strip") SHALL show inside the track's box. Where other requirements of this capability name "the bars", they mean the track's line area (hit zone `bars`). Origin: D-055 (time strip on); D-057 supersedes "Clicking does nothing"; no head line: D-092 (1) and the designer's finding (range label collapsed to 0 px at 1000 px); one row, presence instead of bars: D-094 (Jan: „die balken wirken aktuell komisch"; „density would be just strip or no strip? thats probably good enough"), supersedes D-055/D-057's density bars on the strip; 28 px and the lanes: mock `Strip.dc.html` row "Recommended" (×½ = 14 px holds pins or flags, not both; ×2 = 56 px is the old ceiling and costs plot share, "Screen use").

#### Scenario: Strip on real data
- **WHEN** the six-window setup is shown on smart451 at 1440×900 and window 1 is zoomed from its full extent to a 20 min range
- **THEN** the strip shows no `TIME` label, no range text and no bars; the track's `title` starts with `… recorded` (or `… in scope` with a scope) and holds no `1 bar =`; a slate-400 line runs where smart451 has data, broken where it has none; after the zoom the line inside the window is in `rgb(2, 132, 199)` and the track's `title` starts with `20 min of`; the strip is 28 px tall (±0.5 px) in both states
- **Evidence:** UI check on smart451 at 1440×900 (screenshot before and after the zoom, the track's `title`, strip height)

### Requirement: Time strip states
Without a signal the track SHALL show `No signal shown` in the muted colour inside its box; while loading (and while a session step is on its way, case-navigation "Stepping shows the target at once") `Loading recording…` at the track's left over the 1 px baseline, with no presence line, drives or pins, and the track tooltip `Loading recording…`; after a failure `Recording unavailable` in the muted colour inside the track's box, the failure as tooltip, retrying every 30 s; without a timeseries window no accent and no window. The strip SHALL be 28 px tall in every state and SHALL keep the plot share of `workspace-layout` "Screen use". Goal (reported, not pass/fail): while loading in a scope, the shown range, the cursor lines and their flags are already drawn (mock row "Recommended", loading strip). Origin: necessary consequence (the strip must not move windows or hide data); 30 s: the load retry cap of D-042; one box in every state: D-092 („Layout never moves"), D-094 („same in a session, unlinked, scoped or loading").

#### Scenario: Strip states
- **WHEN** the workspace has no window; then only a values window with one signal; then the source is unreachable at page load
- **THEN** the track shows `No signal shown`; then the presence line with a track tooltip `<recorded> recorded` and no accent; then `Recording unavailable` in the muted colour, and the line appears without a reload within 30 s after the source is back; the strip is 28 px tall in all three states (±0.5 px) and no window moves when it changes
- **Evidence:** UI check (screenshot per state, strip heights); `apps/web/test/strip.test.ts` › "takes the data ref of the target window, else of any window"

#### Scenario: Screen use with the strip
- **WHEN** the six-window setup is shown at 1000×557 with the sidebar open and the strip loaded
- **THEN** the plot share from design M1's snippet is at least 30 % (`workspace-layout` "Screen use")
- **Evidence:** UI check on smart451 at 1000×557 (snippet output, screenshot)

### Requirement: Shown-range window
The strip SHALL draw the bar target's range as a window over the track, at its exact pixel position on the track's bucket pitch, at least 2 px wide (centred when wider than the range), clipped to the track: 1 px accent edges, accent fill at 8–12 %; the presence line inside it in the accent ("Data presence line"). Its grab area SHALL be at least 12 px wide. Origin: D-057 („the shown range is a grabbable window … pixel-exact with a minimum width"); sizes: design S6; the line in the accent: D-094 („the shown range in the accent").

#### Scenario: Geometry
- **WHEN** a track of 1,438 px shows 120 buckets of 1 h from 0 (pitch 12 px) and the range is [5 h, 5 h 20 min), then [5 h, 10 h), then [0, 120 h)
- **THEN** the window is drawn at [60, 64] px with a grab area [56, 68]; then [60, 120] with grab = drawn; then [0, 1438]
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "maps times to pixels and back on the bar pitch", "draws the window pixel-exact with minimum widths"

#### Scenario: 20 min on smart451
- **WHEN** window 1 shows a 20 min range on smart451 at 1440×900
- **THEN** the strip's window element is 20/60 of a bucket pitch wide (`(trackWidth + 2) / counts.length / 3`, ±0.5 px, but at least 2 px) and its left edge is within 0.5 px of the range start's position on the track; the presence line under it is in the accent
- **Evidence:** UI check on smart451 at 1440×900 (the measured widths and lefts, one screenshot)

### Requirement: Strip hit zones and pointer
A press on the strip SHALL hit, in this order: an event pin, a drive, a window edge (±4 px of a drawn edge, on windows drawn at least 16 px wide), the window body (its grab area, unless the window covers the recorded data to within 4 px), else the track (zone `bars`). A cursor flag is its own button above the track and starts no strip gesture ("Cursor markers on the strip"). The pointer SHALL show `ew-resize` on edges, `grab` on the body (`grabbing` while panning), `pointer` on the track, drives, pins and flags, `crosshair` while dragging a range. Origin: D-057; design S7 of `add-strip-navigation`; pins: D-058, design V3; flags: D-094.

#### Scenario: Zones
- **WHEN** on the track of "Geometry" the window is [5 h, 5 h 20 min) and the pointer is at x 62, 57 and 55 in the line area and at x 62 in the drive row without drives; then the window is [5 h, 10 h) and x is 57, 64, 65, 123 and 125; then the window is [0, 120 h) and x is 700, 2 and 1436
- **THEN** body, body, bars, bars; then edge from, edge from, body, edge to, bars; then bars, edge from, edge to
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "finds the hit zone"

#### Scenario: Pin zones
- **WHEN** on the track of "Geometry" the window is [5 h, 10 h), pins are built from events at 5 h, 5 h 20 min and 5 h 40 min, and the pointer is at (62, 3), (64.5, 3), (69, 3), (62, 12) and (90, 3)
- **THEN** pin 0, pin 0, pin 1, edge from, body
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "finds the hit zone" (pin cases)

#### Scenario: Pointer shapes
- **WHEN** window 1 shows a 2 h range on smart451 and the pointer moves over the line outside the window, the window's middle, its left edge, a drive segment, the event pin of 2026-10-15 07:27 local and cursor A's flag
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
- **THEN** the range button shows a start within 11:00–12:00 minus 10 min and `0:20`, the revision rose by one, and the window element moved under the click
- **Evidence:** UI check on smart451 at 1440×900 (range button and revision before and after, screenshot)

### Requirement: Drag zooms to the range
A press on the track (or on a drive, or on the body of a window covering the recorded data to within 4 px) moved at least 4 px SHALL draw an accent range and, on release, set the range between press and release, both ends rounded to the strip unit; a release less than 4 px left or right of the press SHALL send nothing. Origin: D-057 („drag across the strip zooms to that range"); the track instead of bars: D-094.

#### Scenario: Brush math
- **WHEN** on the track of "Geometry" a range is dragged from x 60 to x 120, from 120 to 60, and from 60 to 62 (with 10 px vertical movement)
- **THEN** [5 h, 10 h) twice and nothing the third time
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "computes jump, brush, pan and resize ranges", "turns pointer sequences into strip actions"

#### Scenario: Brush on smart451
- **WHEN** the user drags across the strip from the start to the end of 2026-10-13's line (left_click_drag of the browser tool)
- **THEN** the range button shows about that local day (`26-10-13 00:…` and about `24:00`), rounded to the strip unit, one revision; if the tool cannot drag, `not_run` and Jan checks it by hand
- **Evidence:** UI check on smart451 at 1440×900 (range button and revision), else `not_run`

### Requirement: Drive row
Each drive SHALL be drawn as a 5 px slate-600 segment over the presence line (y 11–16), at least 4 px wide, the drive overlapping the shown range in the accent, slate-900 on hover, with a hit width of at least 8 px; a click on a drive SHALL set the range to the drive's `from`–`to`. Overlapping hit widths go to the nearest drive centre. While a catalog is linked the strip SHALL draw no drives (the session is the drive). Origin: D-057 („clicking a drive fits it"); widths: design S5; slate, 5 px, accent in the shown range, none in a linked session: D-094 („drives in slate"), mock `Strip.dc.html` row "Recommended" (vehicle strip draws drives, session strips none).

#### Scenario: Drive geometry
- **WHEN** on the track of "Geometry" a drive spans [5 h, 5 h 4 min)
- **THEN** its segment is drawn at [58.4, 62.4] px and its hit width is [56.4, 64.4]
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "draws drives with a minimum width and hit width"

#### Scenario: Fit a drive on smart451
- **WHEN** smart451 is shown at 1440×900 without a scope and the user clicks the second drive segment; then a catalog from `kipscope case drives smart451` is opened
- **THEN** the strip shows one segment per entry of `/api/density`'s `drives` (five at least) in slate, the range button shows the second drive's start and duration, and that drive's segment turns to the accent; in the linked session the strip shows no drive segment
- **Evidence:** UI check on smart451 at 1440×900 (screenshots, range button, the `curl` of `drives`)

### Requirement: Strip tooltips
A drive SHALL have the tooltip `Drive <k> of <n> · <start and duration> · <rows>`, a break of the presence line `No data · <start and duration>` ("Data presence line"), the line itself the track's tooltip ("Time strip"); start and duration by range-picker "Start and duration", rows as `no rows`, `1 row` or `<count with thousands commas> rows`. The window and markers SHALL NOT hide a drive's tooltip. Origin: D-057 (tooltips give time range and rows); drive tooltip: necessary consequence of drives without names; no bar tooltips: D-094 (no bars); start and duration: D-093.

#### Scenario: Tooltip text
- **WHEN** the tooltip of `drivecar`'s drive 1 is formatted in Europe/Berlin, and `rowsText` gets 0, 1 and 30,030
- **THEN** `Drive 1 of 3 · 26-10-02 03:00  0:30 · 177,180 rows`; `no rows`, `1 row`, `30,030 rows`
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "formats drive tooltips"

#### Scenario: Tooltip under the window
- **WHEN** smart451 is shown without a scope, the user clicks a drive segment (the window then covers it) and the pointer rests on that segment inside the window
- **THEN** the drive's tooltip shows (the `title` of the element under the pointer starts `Drive <k> of <n> · 26-`)
- **Evidence:** UI check on smart451 at 1440×900 (`document.elementFromPoint` at the segment's centre and its `title`, screenshot)

### Requirement: Cursor markers on the strip
While cursor A or B is on, the strip SHALL draw it as a 1 px slate-900 line over the whole track height (B dashed) with a flag at y 16–26: 11 × 10 px, radius 2, the letter `A` or `B` in 9 px bold, A filled slate-900 with a white letter, B white with a 1 px slate-900 outline; on hover the flag fills with the accent and shows the tooltip `HINTS.stripFlag` (`A 15:09:12.000: click centres the view on A, span kept`, with `, outside the view` after the time when the cursor lies outside the shown range). Each flag SHALL be a `<button>` (`aria-label` `Bring cursor A into view`) whose hit area is 16 × 12 px at y 15–27 centred on the flag; when A and B lie less than 12 px apart, B's flag and button SHALL sit 12 px right of A's while B's line stays. A click on a flag SHALL centre the bar target's span on that cursor (span kept) with one `window.setRange` and one history entry, as "Pin click centres" does, and start no strip gesture. While L exists, a 1 px slate-500 line without a flag. Markers outside the track are not drawn; lines take no pointer input. Origin: D-057 („cursors A, B and L are marked on the strip"); D-055 Q3; flags that jump back: D-094 (Jan: „a/b labels should be on the strip to jump back to it"); sizes, overlap and hit area: mock `Strip.dc.html` row "Recommended".

#### Scenario: Marker positions
- **WHEN** on the track of "Geometry" markers are placed at 5 h, at −1 s and at 120 h
- **THEN** at x 60, not drawn, and at x 1438 (the track end)
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "places markers inside the track only"

#### Scenario: Flag positions
- **WHEN** on the track of "Geometry" `flagXs` gets A at 7 h and B at 7 h 20 min; A at 7 h and B at 9 h; A at 7 h and B at 6 h 40 min; A off and B at 7 h 20 min; A at −1 s and B at 7 h 20 min
- **THEN** A line and flag 84, B line 88 and flag 96; A 84/84, B 108/108; A 84/84, B line 80 and flag 96; no A, B 88/88; no A, B 88/88
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "places the cursor flags, B right of a near A"

#### Scenario: Flag click
- **WHEN** the view is [0, 20 min) and the flag of cursor A at 5 h 0 min 0.135 s is clicked; and `HINTS.stripFlag` gets `A`, `15:09:12.000` inside the view and `A`, `11:31:10.000` outside it
- **THEN** one centre action with [4 h 50 min 0.135 s, 5 h 10 min 0.135 s); `A 15:09:12.000: click centres the view on A, span kept` and `A 11:31:10.000, outside the view: click centres the view on A, span kept`, both within the wording rule
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "centres the view on a clicked cursor flag"; `apps/web/test/hints.test.ts` › "keeps every hint within the wording rule"

#### Scenario: Markers on smart451
- **WHEN** A and B are on in window 1 of smart451 at its whole recording, the user zooms to a 20 min range away from both, hovers A's flag and clicks it; then the pointer hovers window 2's plot
- **THEN** the strip shows an A and a B line with flags at the x of their times (±1 px), the flags 11 × 10 px at y 16–26 and their buttons 16 × 12 px; on hover A's flag is in the accent with the tooltip naming `outside the view`; after the click the range button shows a 20 min range centred on A (`0:20`), one revision more, and one Back returns to the range before; while hovering the plot an L line follows the pointer's time and is gone after the pointer leaves the plots
- **Evidence:** UI check on smart451 at 1440×900 (screenshots, flag and button rects, range button and revision)

### Requirement: Event pins
The strip SHALL draw the shown events of its data ref as pins in the lane at the top of the track (y 2–9): events less than 6 px from a group's first form one pin, centred, 3 × 7 px alone and 5 × 7 px for several or for fault memory reads, hit width at least 8 px, coloured by the group's most severe category (add-events design V1–V3) and hollow (panel fill, 1 px inset outline in that colour) when all its events are DTCs (improve-events design P5); the strip SHALL stay 28 px. Origin: D-058 („marks on the time strip"; „it can get super overwhelming"); hollow: data fact (DTC times are readout times), proposal E-3; lane and height: D-094, mock `Strip.dc.html` row "Recommended".

#### Scenario: Pin geometry
- **WHEN** on the track of "Geometry" pins are built from events at 5 h (active), 5 h 20 min (change), 5 h 40 min (snapshot) and 130 h
- **THEN** two pins: [58.5, 65.5] px with 2 events coloured as a fault, hit [58, 66]; [66.5, 69.5] with 1 event coloured as info, hit [64, 72]; nothing for 130 h
- **Evidence:** `apps/web/test/eventMarks.test.ts` › "clusters events into pins"

#### Scenario: Pins on smart451
- **WHEN** smart451's whole recording is shown at 1440×900 with the shipped project file and the default filter
- **THEN** the strip shows pins at y 2–9 of the track, among them a hollow one at 2026-10-15 07:27 local with a `rgb(190, 18, 60)` outline whose tooltip starts `13 events · 13 active faults`, and filled ones elsewhere; the strip measures 28 px
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, tooltip text, pin rect, strip height)

### Requirement: Strip shows the scope
While the workspace has a scope, the strip SHALL show the scope's data ref whatever the windows hold, and its info (the tooltip line of "Time strip") SHALL read `<shown> of <span> in scope`; in scoped mode without a scope the track SHALL show `No scope set`. Double-click, drive clicks and drive keys then act within the scope. Origin: issue #1 item 4 („The time strip … cover[s] only the scope's range"); D-078; info as tooltip: D-092; no `1 bar =`: D-094 (no bars).

#### Scenario: Label with a scope
- **WHEN** `stripLabel` gets the range [T1 + 10 min, T1 + 20 min) and a density with `scope` [T1, T2) and width 30 s; and the same range with a density without `scope` whose `first` is T1 and `last` 6 d later
- **THEN** it reads `10 min of 1 h in scope`; then `10 min of 6 d recorded`
- **Evidence:** `apps/web/test/strip.test.ts` › "labels the shown span within the scope", "labels the shown and recorded spans"

#### Scenario: Data ref of the strip
- **WHEN** the strip's data-ref choice gets a workspace with scope on `testcar` whose only window shows `othercar/Fast_100h.SIG_A`, and the same workspace without scope
- **THEN** it gives `testcar`, then `othercar`
- **Evidence:** `apps/web/test/strip.test.ts` › "takes the scope's data ref"

### Requirement: Strip scope controls
With a scope and no open catalog, the context row SHALL show the scope in the session bar's slots: label `SCOPE`, the data ref in the title slot, the scope's start in the start slot and its duration in the duration slot (case-navigation "Session bar", range-picker "Start and duration"), **Widen** (one `scope.set`, scope "Widen") in the action slot and, in full mode only, **Clear** (`scope.clear`) in a second 64 px action slot after it; no arrows and no position. While a catalog is open, the row SHALL show the session bar instead, with no Widen and no Clear. Without scope and catalog there SHALL be no context row. Origin: D-078 („widening it is an explicit step"); Clear: design Q-1 (a) of `add-scope`; session bar: D-086, Q-6 (a); same row and slots: D-092; start and duration: D-093.

#### Scenario: Scope on smart451
- **WHEN** Jan's view is open on smart451 in full mode with a scope of 2026-10-13 14:00 – 16:00 local, at 1440×900 and at 1000×557; the user double-clicks the strip, clicks **Widen**, then **Clear**
- **THEN** the context row reads `SCOPE smart451 26-10-13 14:00` and the duration tag `2:00`, then `Widen Clear`, on one line (`SCOPE` left out at 1000×557) and the strip is 28 px tall at both sizes; the double-click makes the shown range 14:00 – 16:00; after Widen the row reads `26-10-13 12:00` and `6:00` with Widen at the same x (±1 px) and the explorer reloaded; after Clear the context row is gone and the presence line spans the whole recording again
- **Evidence:** UI check on smart451 (one screenshot per step, strip height at both sizes)

#### Scenario: Head with a catalog
- **WHEN** the context row renders a workspace with a scope and an open catalog, linked and unlinked, and a workspace with neither
- **THEN** it renders the session bar in both case states and neither Widen nor Clear; for the third it renders nothing
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "renders the context row for a case, a scope or neither"

## ADDED Requirements

### Requirement: Data presence line
The strip SHALL show where its data ref has rows as a 3 px slate-400 line (y 12–15) on a 1 px baseline, in the accent inside the shown range, from `first` to `last` of `/api/density`, broken at runs of empty buckets and at the logger gaps of `/api/gaps` once loaded; each break at least 3 px wide, overlaps merged (design DW19). No density bar or area. Origin: D-094 („data presence as a thin line with breaks at data gaps"); gaps: D-062; 3 px: mock `Strip.dc.html` (×2 in design DW2).

#### Scenario: Presence of a track
- **WHEN** `presence` gets the track of "Geometry" (1,438 px, 120 buckets of 1 h from 0), counts 1 except buckets 10 and 11 at 0, `first` 30 min, `last` 119 h 30 min, the range [20 h, 30 h), and the logger gaps [50 h, 50 h 15 min) and [50 h 17.5 min, 50 h 25 min); and the same without logger gaps, in Europe/Berlin
- **THEN** runs [6, 120], [144, 240], [240, 360] (shown), [360, 600], [605.75, 1434] and breaks [120, 144] `No data · 70-01-01 11:00  2:00` and [600, 605.75] `No data · 2 gaps · 70-01-03 03:00  0:25`; without logger gaps runs [6, 120], [144, 240], [240, 360] (shown), [360, 1434] and the one break [120, 144]
- **Evidence:** `apps/web/test/stripGeometry.test.ts` › "draws data presence with breaks at empty buckets and logger gaps"

#### Scenario: Presence on smart451
- **WHEN** a catalog from `kipscope case drives smart451` is open on the drive of 2026-10-13 11:06 local (the logger gap 11:27:53.936 – 11:27:56.982 local lies in it, data-gaps "smart451 logger gaps") at 1440×900
- **THEN** the strip shows the presence line with one break of 3 px at that time whose tooltip reads `No data · 26-10-13 11:27:53  3 s`, no bars and no density area, and the strip is 28 px tall
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, the break's rect and `title`, strip height)

## REMOVED Requirements

### Requirement: Time strip bars
**Reason**: D-094: „The time strip … shows data presence as a thin line with breaks at data gaps (no density bars, no density area)"; supersedes the density bars of D-055/D-057 on the strip.
**Migration**: "Data presence line" shows where data exists; the shown range colours the line instead of bars; `/api/density` still feeds the track (`first`, `last`, empty buckets, drives); bar tooltips are gone, the track's tooltip gives the info and drives and breaks have their own.

### Requirement: Events count in the strip head
**Reason**: The strip head line is dropped (D-092; mock `Main.dc.html`: „Events 2" on the sidebar tab).
**Migration**: The count moves onto the sidebar's Events tab (`events` "Events count on the Events tab"), with the same tooltip; `e` still opens the list with `Refine` open.
