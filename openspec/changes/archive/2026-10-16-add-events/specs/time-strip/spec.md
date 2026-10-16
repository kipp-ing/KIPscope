## MODIFIED Requirements

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

## ADDED Requirements

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
