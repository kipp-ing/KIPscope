## MODIFIED Requirements

### Requirement: Event pins
The strip SHALL draw the shown events of its data ref as pins in a 6 px lane at the top of the bars: events less than 6 px from a group's first form one pin, centred, 3 px wide alone and at least 5 px for several or for fault memory reads, hit width at least 8 px, coloured by the group's most severe category (add-events design V1–V3) and hollow (panel fill, 1 px inset outline in that colour) when all its events are DTCs (improve-events design P5); the strip SHALL stay 55 px. Origin: D-058 („marks on the time strip"; „it can get super overwhelming"); D-056 (≤ 56 px); hollow: data fact (DTC times are readout times), proposal E-3.

#### Scenario: Pin geometry
- **WHEN** on the track of "Geometry" pins are built from events at 5 h (active), 5 h 20 min (change), 5 h 40 min (snapshot) and 130 h
- **THEN** two pins: [58.5, 65.5] px with 2 events coloured as a fault, hit [58, 66]; [66.5, 69.5] with 1 event coloured as info, hit [64, 72]; nothing for 130 h
- **Evidence:** `apps/web/test/eventMarks.test.ts` › "clusters events into pins"

#### Scenario: Pins on smart451
- **WHEN** smart451's whole recording is shown at 1440×900 with the shipped project file and the default filter
- **THEN** the strip shows pins, among them a hollow one at 2026-10-15 07:27 local with a `rgb(190, 18, 60)` outline whose tooltip starts `13 events · 13 active faults`, and filled ones elsewhere; the strip measures 55 px
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, tooltip text, strip height)

### Requirement: Pin tooltips
A pin of one event SHALL have the tooltip `<local time to the ms> · <category> · <source> <name>`, then the text (a change: `<from> → <to>`), then for a DTC its status text and the line `Fault memory read at this time; when a fault first occurred is unknown`, and for an inferred change `seen after a gap; last seen <from> at <local time>`; a pin of several `<n> events · <count> <category plural>, …` (categories most severe first), then that readout line when any of its events is a DTC, then one line per event (at most 8) and `… and <k> more`. Origin: D-058 (brief: „hover shows code + description + category + time"); add-events design V4; readout line: data fact (DTC times are readout times), proposal E-3.

#### Scenario: Tooltip text
- **WHEN** the tooltips of the testcar event `P0CA700`, of the inferred `VCU.door` change at 02:00 and of a pin holding the nine DTCs of testcar are formatted in Europe/Berlin
- **THEN** `2026-10-01 07:00:00.000 · Active fault · BMS P0CA700` / `Discharge current too high` / `Status 0x29 failing now · confirmed · failed since clear` / `Fault memory read at this time; when a fault first occurred is unknown`; `2026-10-01 04:00:00.000 · State change · VCU VCU.door` / `open → closed` / `seen after a gap; last seen open at 2026-10-01 03:04:30.000`; `9 events · 2 active faults, 1 pending fault, 2 stored faults, 2 untested DTCs, 1 passed DTC, 1 other event`, the readout line, 8 lines and `… and 1 more`
- **Evidence:** `apps/web/test/eventMarks.test.ts` › "formats pin tooltips"

### Requirement: Events count in the strip head
While the strip's data ref has events, the strip head SHALL show after the range a button `<shown> of <total> events` (11 px) whose tooltip says how many events match the filter in words and how many the recording holds (wording: add-guidance `HINTS.eventsCount`); its click SHALL open the sidebar on the Events tab with the `Refine` section open and the filter field focused. It SHALL NOT be cut: the range and the info truncate first. Origin: D-058 (brief: „count of hidden events visible so filtering never hides silently"); add-events design V5; tooltip: persona test 2026-10-17 (novice: "13 of 669 events" unclear).

#### Scenario: Count on smart451
- **WHEN** smart451 is shown at 1440×900 with the shipped project file and the default filter, then at 1000×557 with the sidebar open, and the user clicks the count
- **THEN** the head shows `43 of 629 events` (by `/api/events` on 2026-10-17, lead's headless check) at both sizes, fully visible, with the tooltip `43 events match the filter (active faults and state changes), 629 in the recording · click to open the list · e` (sentence lower-cased inside the parentheses, add-guidance H5); after the click the sidebar shows the Events tab with `Refine` open and the field focused
- **Evidence:** UI check on smart451 (screenshots at both sizes, tooltip text)
