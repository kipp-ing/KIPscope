# Spec Delta: timeseries-window

UI checks below use real carserver data, vehicle `smart451`. Times are UTC; the UI shows local time. A window can be opened by command, e.g. `POST /api/commands` with `{"type":"window.create","from":"2026-10-13T09:56:59Z","to":"2026-10-13T09:57:01Z"}` followed by `window.addSignal`.

## ADDED Requirements

### Requirement: SNA never drawn as a value
The window SHALL NOT draw an SNA point or an all-SNA bucket as a value: no line, step, marker or envelope reaches it, and no segment is interpolated or connected through it. In step mode the last valid value SHALL be held up to the timestamp of the following SNA point and end there. Origin: D-010.

#### Scenario: Speed SNA in raw view
- **WHEN** a window shows `ICL_3A2h.SPEED_DISP` from 2026-10-13T09:56:59Z to 09:57:01Z in line mode
- **THEN** the curve is a flat line at 0 that stops at 09:56:59.737 and resumes at 09:57:00.138; nothing is drawn at 511
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "keeps SNA as null and never spans it"

#### Scenario: Step mode holds until SNA
- **WHEN** step mode is selected and a valid point at t1 is followed by an SNA point at t2
- **THEN** the value of t1 is held until t2 and nothing is drawn from t2 until the next valid point
- **Evidence:** `apps/web/test/build.test.ts` › "holds the last valid value up to the SNA point in step mode"; UI check with `BRK_1A0h.WSPD_FL` in the same window in step mode

#### Scenario: Markers mode
- **WHEN** markers mode is selected on the window above
- **THEN** no marker appears for the three SNA points
- **Evidence:** UI check (screenshot)

#### Scenario: Aggregated overview
- **WHEN** a window shows the full extent of `ICL_3A2h.SPEED_DISP` (2026-10-11T12:34:24.824Z to 2026-10-13T13:17:33.220Z) aggregated, with the min/max envelope on
- **THEN** neither the mean curve nor the envelope reaches 511; the highest drawn value is 71 km/h
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "breaks mean and envelope at all-SNA buckets"

#### Scenario: Several signals in one window
- **WHEN** `ICL_3A2h.SPEED_DISP` and `BRK_1A0h.WSPD_FL` share the window from 2026-10-13T09:56:59Z to 09:57:01Z, so their timestamps interleave
- **THEN** neither curve is drawn across its own SNA period, and each curve still connects its consecutive valid points
- **Evidence:** `apps/web/test/build.test.ts` › "joins several signals without spanning SNA"; UI check (screenshot)

### Requirement: Isolated valid points stay visible
In line mode and in aggregated mean curves, a valid point or bucket whose neighbors on both sides are SNA or absent, with at least one of them SNA, SHALL be drawn as a marker, so that breaking the curve at SNA never hides a valid measurement. Origin: necessary consequence of D-010's curve break.

#### Scenario: One valid point between SNA points
- **WHEN** `testcar/Sna_800h.SPEED` shows point 601 (value 42) between the SNA points 600 and 602 in line mode
- **THEN** a marker is drawn at value 42
- **Evidence:** `apps/web/test/build.test.ts` › "finds isolated valid points"

### Requirement: y range excludes SNA
The automatic y range of a scale SHALL be computed from valid values only; SNA points and all-SNA buckets SHALL NOT widen it. Origin: proposal (window never draws SNA as a value).

#### Scenario: Speed window around SNA
- **WHEN** a window shows `ICL_3A2h.SPEED_DISP` from 2026-10-13T09:56:59Z to 09:57:01Z
- **THEN** the y axis covers the flat 0 line (about −1 to 1) and does not extend to 511
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "ignores SNA in the y range"

### Requirement: SNA periods marked
The window SHALL mark each signal's SNA periods as a thin strip per signal at the bottom of the plot, in the signal's color, so the user sees which signal is unavailable when. Raw: from an SNA point to the next point. Aggregated: each bucket that contains at least one SNA point. A period too short to see SHALL still be visible. Origin: D-010, D-014.

#### Scenario: Two signals with SNA at engine start
- **WHEN** a window shows `ICL_3A2h.SPEED_DISP` and `BRK_1A0h.WSPD_FL` from 2026-10-13T09:56:59Z to 09:57:01Z
- **THEN** a mark in the SPEED_DISP color covers 09:56:59.837 to 09:57:00.138 and a mark in the WSPD_FL color covers 09:56:59.791 to 09:57:00.072
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "derives SNA periods from raw points and neighbors"

#### Scenario: SNA in the overview
- **WHEN** a window shows the full extent of `ICL_3A2h.SPEED_DISP` aggregated
- **THEN** SNA is marked from 2026-10-11 13:41 to 2026-10-13 09:07 UTC wherever the signal has points, and at the other three SNA runs
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "derives SNA periods from buckets"

#### Scenario: Single SNA point at the end of the data
- **WHEN** the last point of `testcar/Sna_800h.SPEED` (point 999) is SNA and has no successor
- **THEN** its mark is still visible, at least 2 px wide
- **Evidence:** `apps/web/test/build.test.ts` › "derives SNA periods from raw points and neighbors"

### Requirement: SNA share in the signal list
The window's signal list SHALL show per signal the share of SNA points among all points of the loaded range, edge neighbors excluded. A non-zero share SHALL never be displayed as 0 %, and a share below 100 % never as 100 %. No share is shown when it is 0 or nothing is loaded. Origin: D-010 ("show its share"); proposal.

#### Scenario: Engine start window
- **WHEN** a window shows `ICL_3A2h.SPEED_DISP` and `BRK_1A0h.WSPD_FL` from 2026-10-13T09:56:59Z to 09:57:01Z
- **THEN** the list shows `SNA 15.0 %` for SPEED_DISP (3 of 20) and `SNA 23.0 %` for WSPD_FL (14 of 61)
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "computes the SNA share of raw and bucket results"

#### Scenario: Rare SNA
- **WHEN** a window shows the full extent of `BRK_1A0h.WSPD_FL` (56 SNA of 232,644 points)
- **THEN** the list shows `SNA < 0.1 %`
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "formats SNA shares without rounding to 0 or 100"

#### Scenario: Valid constant, no SNA
- **WHEN** a window shows `ENG_2E8h.MOT_SPD_D` (constant −127, which is raw 0 and valid; D-012)
- **THEN** the curve is drawn at −127 and the list shows no SNA share
- **Evidence:** UI check (screenshot)

## MODIFIED Requirements

### Requirement: Min/max envelope
A window SHALL offer an envelope option, off by default, that draws the minimum and maximum of each bucket around the mean curve.

#### Scenario: Spike in overview
- **WHEN** the envelope is on and a single raw spike lies inside one bucket
- **THEN** the envelope reaches the spike's value

#### Scenario: SNA inside a bucket
- **WHEN** the envelope is on and a bucket contains valid points and SNA points
- **THEN** the envelope spans only the valid points' minimum and maximum, and for an all-SNA bucket no envelope is drawn
- **Evidence:** `apps/web/test/build.test.ts` › "breaks mean and envelope at all-SNA buckets"; UI check in the SPEED_DISP overview above

### Requirement: No invented values
The window SHALL NOT draw a curve segment where no measured point exists on at least one side; it SHALL use edge neighbors from the query to draw segments that cross the visible range edges. An SNA point SHALL count as no measured value for this purpose.

#### Scenario: Window inside a gap between points
- **WHEN** the visible range contains no point but has neighbors on both sides
- **THEN** the line or step through the window is drawn from those neighbors

#### Scenario: Before the first point
- **WHEN** the visible range starts before the signal's first point
- **THEN** nothing is drawn before that point

#### Scenario: SNA neighbor
- **WHEN** the visible range contains no point and its leading neighbor is SNA
- **THEN** no line or step is drawn through the window, and the SNA period is marked
- **Evidence:** `apps/web/test/build.test.ts` › "draws nothing from an SNA neighbor"
