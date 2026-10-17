## ADDED Requirements

### Requirement: Event marks in the plot
Each timeseries window SHALL mark the shown events of its signals' data refs within its range: a 1 px line over the plot behind the curves in the category colour at half opacity (faults solid, changes dashed, others dotted) and a 6 px glyph above the plot area, grouped and coloured like the strip's pins, with the pin tooltip; both SHALL follow zoom and pan. Origin: D-058 („marks … in the chart windows"); design V6.

#### Scenario: Marks on smart451
- **WHEN** window 1 shows `DCU_2B8h.HTR_HV_Volt` on smart451 over 2026-10-14 18:55–19:15 local with the default filter, then the filter `none`
- **THEN** first the window shows glyphs and lines at the isolation changes of 18:59:47–19:08:32 (more than one glyph; the glyph at 18:59:47 lists `BMS.contactor` `closed → open`), and the plot height is the same as without events; with `none` no glyph or line remains
- **Evidence:** UI check on smart451 at 1440×900 (screenshots, plot height)

#### Scenario: Glyph groups
- **WHEN** chart glyphs are built for a plot 600 px wide over [0, 60 s) from events at 10 s, 10.5 s, 30 s and 75 s
- **THEN** two glyphs: one at x 100–105 holding 2 events, one at x 300 holding 1; none for 75 s
- **Evidence:** `apps/web/test/eventMarks.test.ts` › "groups events into chart glyphs"

### Requirement: Event glyph click places a cursor
A click on an event glyph SHALL place cursor A at the exact time of the glyph's first event, Shift+click cursor B, with one `cursor.set` sent at once; a glyph click SHALL NOT zoom or start a drag. Origin: D-058 (brief: „click jumps/centres"; in a plot the event is already in view, and a cursor on it gives the values at that moment, `cursors` "Placing cursors by click"); design V7.

#### Scenario: Glyph click on smart451
- **WHEN** window 1 shows 2026-10-14 18:55–19:15 local on smart451 and the user clicks the glyph at 18:59:47, then Shift+clicks the glyph at 19:01:47
- **THEN** A is at 2026-10-14 18:59:47.679 and B at 19:01:47.966 (values window header), the revision rose by two, and the range is unchanged
- **Evidence:** UI check on smart451 at 1440×900 (values window header, revision, screenshot)
