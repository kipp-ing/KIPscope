## MODIFIED Requirements

### Requirement: Event marks in the plot
Each timeseries window SHALL mark the shown events of its signals' data refs within its range: a 1 px line over the plot behind the curves in the category colour at half opacity (faults solid, changes dashed, others dotted) and a 6 px glyph above the plot area, grouped, coloured and filled or hollow like the strip's pins (hollow when all its events are DTCs, fault memory reads), with the pin tooltip; both SHALL follow zoom and pan. Origin: D-058 („marks … in the chart windows"); add-events design V6; hollow: data fact (DTC times are readout times), proposal E-3.

#### Scenario: Marks on smart451
- **WHEN** window 1 shows `CPC_448h.PTC_HV_Volt` on smart451 over 2026-10-14 18:55–19:15 local with the default filter, then the filter `none`
- **THEN** first the window shows filled glyphs and lines at the isolation changes of 18:59:47–19:08:32 (more than one glyph; the glyph at 18:59:47 lists `BMS.contactor` `closed → open`), and the plot height is the same as without events; with `none` no glyph or line remains
- **Evidence:** UI check on smart451 at 1440×900 (screenshots, plot height)

#### Scenario: Glyph groups
- **WHEN** chart glyphs are built for a plot 600 px wide over [0, 60 s) from events at 10 s, 10.5 s, 30 s and 75 s
- **THEN** two glyphs: one at x 100–105 holding 2 events, one at x 300 holding 1; none for 75 s
- **Evidence:** `apps/web/test/eventMarks.test.ts` › "groups events into chart glyphs"

#### Scenario: Hollow marks
- **WHEN** `markStyle` runs for a mark of one active DTC, a mark of two DTCs, a mark of a DTC and a state change, and a mark of one state change; and `groupMarks` builds a mark of one DTC alone
- **THEN** hollow (background `var(--panel)`, inset 1 px outline in `#be123c`), hollow, filled `#be123c`, filled `#7c3aed`; the lone DTC mark is at least 5 px wide
- **Evidence:** `apps/web/test/eventMarks.test.ts` › "draws fault memory reads hollow"
