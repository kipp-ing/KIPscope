## MODIFIED Requirements

### Requirement: Raw display modes
When a window shows raw points, each signal SHALL be drawable as lines between points, as steps holding the previous value, or with point markers, as chosen in the window's display options. A step SHALL hold a value until the next point's timestamp, or only up to its hold end where the two points are split (data-gaps "Split between two points"). Origin: concept §5; hold end: D-062.

#### Scenario: Step mode
- **WHEN** step mode is selected
- **THEN** the curve holds each value until the next point's timestamp, or up to the hold end where the next point is split off

### Requirement: No invented values
The window SHALL NOT draw a curve segment where no measured point exists on at least one side; it SHALL use edge neighbors from the query to draw segments that cross the visible range edges. An SNA point SHALL count as no measured value for this purpose. Two split points (data-gaps) SHALL count as having no measured value between them beyond the earlier one's hold end. Origin: concept §5; split: D-062.

#### Scenario: Window inside a gap between points
- **WHEN** the visible range contains no point but has neighbors on both sides that are not split
- **THEN** the line or step through the window is drawn from those neighbors

#### Scenario: Window inside a split
- **WHEN** a window shows `gapcar/Evt_B11h.EVT` from 2026-10-03T00:05:10Z to 00:05:50Z (inside the logger gap; neighbours 2 at 00:04:00Z and 3 at 00:07:00Z) in line mode, then in step mode
- **THEN** nothing is drawn in either mode
- **Evidence:** `apps/web/test/build.test.ts` › "breaks lines and steps at gaps"

#### Scenario: Before the first point
- **WHEN** the visible range starts before the signal's first point
- **THEN** nothing is drawn before that point

#### Scenario: SNA neighbor
- **WHEN** the visible range contains no point and its leading neighbor is SNA
- **THEN** no line or step is drawn through the window, and the SNA period is marked
- **Evidence:** `apps/web/test/build.test.ts` › "draws nothing from an SNA neighbor"

### Requirement: SNA periods marked
The window SHALL mark each signal's SNA periods as a thin strip per signal at the bottom of the plot, in the signal's color, so the user sees which signal is unavailable when. Raw: from an SNA point to the next point, or to its hold end where the next point is split off (data-gaps). Aggregated: each bucket that contains at least one SNA point. A period too short to see SHALL still be visible. Origin: D-010, D-014; hold end: D-062.

#### Scenario: Two signals with SNA at engine start
- **WHEN** a window shows `COMBI_412h.V_ANZ` and `BS_200h.DVL` from 2026-10-13T09:56:59Z to 09:57:01Z
- **THEN** a mark in the V_ANZ color covers 09:56:59.837 to 09:57:00.138 and a mark in the DVL color covers 09:56:59.791 to 09:57:00.072
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "derives SNA periods from raw points and neighbors"

#### Scenario: SNA in the overview
- **WHEN** a window shows the full extent of `COMBI_412h.V_ANZ` aggregated
- **THEN** SNA is marked from 2026-10-11 13:41 to 2026-10-13 09:07 UTC wherever the signal has points, and at the other three SNA runs
- **Evidence:** UI check (screenshot); `apps/web/test/build.test.ts` › "derives SNA periods from buckets"

#### Scenario: Single SNA point at the end of the data
- **WHEN** the last point of `testcar/Sna_800h.SPEED` (point 999) is SNA and has no successor
- **THEN** its mark is still visible, at least 2 px wide
- **Evidence:** `apps/web/test/build.test.ts` › "derives SNA periods from raw points and neighbors"

#### Scenario: SNA point before a split
- **WHEN** a signal with period 20 ms has an SNA point at 0 ms and its next point at 1 s
- **THEN** its SNA mark covers 0 to 20 ms, not up to 1 s
- **Evidence:** `apps/web/test/build.test.ts` › "ends an SNA mark at the hold end"

### Requirement: Isolated valid points stay visible
In line mode and in aggregated mean curves, a valid point or bucket whose neighbors on both sides are SNA, split off (data-gaps) or absent, with at least one of them SNA or split off, SHALL be drawn as a marker, so that breaking the curve never hides a valid measurement. Origin: necessary consequence of D-010's and D-062's curve breaks.

#### Scenario: One valid point between SNA points
- **WHEN** `testcar/Sna_800h.SPEED` shows point 601 (value 42) between the SNA points 600 and 602 in line mode
- **THEN** a marker is drawn at value 42
- **Evidence:** `apps/web/test/build.test.ts` › "finds isolated valid points"

#### Scenario: One valid point between two splits
- **WHEN** `gapcar/TBMS.current` (period 10 s) shows its point at 2026-10-03T00:01:40Z, 40 s after the previous and before the next point, in line mode
- **THEN** a marker is drawn at 12.5
- **Evidence:** `apps/web/test/build.test.ts` › "draws a point between two splits as a marker"

## ADDED Requirements

### Requirement: Lines break at gaps
In a raw view the window SHALL draw no line between two split points (data-gaps) and, in step mode, hold the earlier valid value up to its hold end and draw nothing from there to the next point. Gaps SHALL stay blank. Origin: D-062 („A line breaks where the logger recorded nothing … and where a cyclic signal skips more than 3 of its periods"; „Gaps stay blank").

#### Scenario: Breaks in raw data
- **WHEN** raw points with period 20 ms at 0, 20, 40 ms and 500, 520 ms are drawn in line mode and in step mode, and points without a period at 0 and 10 s around a logger gap 1 s–9 s
- **THEN** the line has no segment from 40 to 500 ms; the step holds the 40 ms value to 60 ms and nothing until 500 ms; around the logger gap the line has no segment and the step holds the first value to 1 s
- **Evidence:** `apps/web/test/build.test.ts` › "breaks lines and steps at gaps"

#### Scenario: Dropout in a drive
- **WHEN** on smart451 at 1440×900 a window shows `SAS_0C2h.LWS_ANGLE` and `COMBI_412h.V_ANZ` from 2026-10-13 11:34:34 to 11:34:39 local in line mode
- **THEN** both curves stop at about 11:34:36.2 and resume at about 11:34:37.0, nothing is drawn in between, and no grey band shows there (the logger was not silent for 2 s)
- **Evidence:** UI check (screenshot)

#### Scenario: State signal holds stop at gaps
- **WHEN** a signal with named states and period 100 ms is drawn (as steps) from raw points at 0, 100, 200 ms and 10 s with a logger gap 250 ms–9.9 s; and a view 1 s–9 s of it contains no point, with edge neighbours at 200 ms and 10 s
- **THEN** the step of the 200 ms value ends at 250 ms (the logger gap's start, before 300 ms) and nothing is drawn until 10 s; in the empty view no synthetic edge hold is drawn and the view stays blank
- **Evidence:** `apps/web/test/build.test.ts` › "ends state signal holds at gaps"

### Requirement: Gaps in aggregated views
In an aggregated view the mean curve and the min/max envelope SHALL break between two split buckets (data-gaps "Split between two buckets") and stay joined across other empty buckets. Origin: D-062 („The same holds for buckets when zoomed out").

#### Scenario: Buckets of a dropout and of a slow signal
- **WHEN** bucket results are drawn: width 5 ms of a signal with period 30 s whose buckets are 30 s apart; width 5 ms of a 20 ms signal with an empty stretch of 100 ms; and width 1 min of a signal without a period whose buckets around a logger gap are adjacent
- **THEN** the first stays one line; the second breaks in the empty stretch; the third breaks between the two buckets next to the logger gap, mean and envelope alike
- **Evidence:** `apps/web/test/build.test.ts` › "breaks buckets only where a gap is certain"

#### Scenario: Day overview
- **WHEN** on smart451 a window shows `CPC_448h.PTC_HV_Volt` over 2026-10-13 00:00–24:00 local, aggregated, envelope on
- **THEN** neither mean nor envelope crosses any of the grey bands (00:00–06:05, 06:05:45–10:30:23, 10:31:12–11:06:56, 12:13:07–12:42:29, 12:42:59–13:42:28, 13:42:58–15:07:03, 15:17:33–24:00 and the thin one at 11:27:54)
- **Evidence:** UI check (screenshot)

### Requirement: Logger gap bands
Every timeseries window SHALL paint each logger gap of its signals' data refs that meets its view and holds no drawn sample of that data ref, as a faint grey band over the plot's full height, under the grid, the event marks and the curves, at least 1 CSS px wide. Origin: D-062 („logger gaps also get a faint grey band so "no data" reads as intended"; „in every timeseries window" as a consequence of „every signal"); stale gaps: design G9 (a).

#### Scenario: Band in a drive
- **WHEN** on smart451 at 1440×900 a window shows `CPC_448h.PTC_HV_Volt` and `SAS_0C2h.LWS_ANGLE` from 2026-10-13 11:27:45 to 11:28:05 local
- **THEN** a faint grey band covers 11:27:53.936 to 11:27:56.982; both curves end at its left edge and resume at its right edge; grid lines show over the band
- **Evidence:** UI check (screenshot)

#### Scenario: Bands of a view
- **WHEN** the bands of the view 2026-10-03T00:04:00Z–00:09:41Z are listed from gapcar's logger gaps
- **THEN** they are 00:04:59.980–00:06:00.000 and 00:09:40.000–00:09:41 (clipped to the view)
- **Evidence:** `apps/web/test/gaps.test.ts` › "lists the logger gaps a view shows"

### Requirement: Drawn data beats a stale logger gap
A window SHALL draw the curves, envelopes and bands of a stretch whose logger gap holds drawn samples as if the gap were absent: no break and no band there, and the drawn value (L, drags) a value, not `logger_gap`. Origin: Jan 2026-10-17 („same values are cluttered as dots, which should have a hüllkurve instead? looks strange"); design G9 (a).

#### Scenario: Repro of the stale gap
- **WHEN** with the logger gap 1792176671171000000–1792176763235000000 (2026-10-16 18:51:11.171–18:52:43.235 UTC) the view 18:51:11.385–18:51:20.691 is built from 500 buckets of 20 ms of `SAS_0C2h.LWS_ANGLE` (period 10 ms, means alternating −1,400 and 1,400, all inside the gap) and 95 raw points of `CPC_448h.PTC_HV_Volt` (period 100 ms, 100 ms apart, edge neighbours inside the gap); the bands of the view are listed with and without these results; and the drawn values are read at 18:51:15.000
- **THEN** mean, min and max hold no inserted null and no bucket is isolated (was 499 breaks, 500 isolated); PTC_HV_Volt has no break (was 94); the bands are `[]` with the results and the one clipped gap without them; LWS_ANGLE reads `aggregated` and PTC_HV_Volt `interpolated`
- **Evidence:** `apps/web/test/build.test.ts` › "draws through a logger gap that holds samples"; `apps/web/test/gaps.test.ts` › "leaves out a band that holds samples"; `apps/web/test/readout.test.ts` › "reads drawn data inside a stale logger gap"

#### Scenario: Steering angle on 2026-10-16
- **WHEN** on smart451 at 1440×900 a window shows `CPC_448h.PTC_HV_Volt`, `SAS_0C2h.LWS_ANGLE` and `COMBI_412h.V_ANZ` from 2026-10-16 20:51:11.385 to 20:51:20.691 local
- **THEN** LWS_ANGLE is a mean curve with its min/max envelope (or a line when raw), the other two are lines, no point markers stand alone and no grey band shows
- **Evidence:** UI check (screenshot)

### Requirement: Gap info loads with the window
A window SHALL fetch the gap info of each data ref of its signals once per browser tab (and again as in "Gap info refetched"), draw its data meanwhile without breaks, and count as settled only when every needed gap info has loaded or failed. A failure SHALL be a render error of the window and SHALL be retried every 30 s while the window shows that data ref. Origin: necessary consequence of D-062 (breaks and bands need it) and D-011 (`--wait` reports the drawn state).

#### Scenario: Once per tab, failure retried
- **WHEN** two windows of one data ref ask for its gap info, the first fetch fails, and 30 s pass
- **THEN** one request is sent first, both windows report a render error naming the data ref, one more request is sent after 30 s, and after its success no window reports the error
- **Evidence:** `apps/web/test/gaps.test.ts` › "fetches gap info once per data ref and retries a failure"

#### Scenario: Settled with breaks
- **WHEN** on smart451 `kipscope --wait window range <w> "2026-10-13 11:27:45" "2026-10-13 11:28:05"` runs on a window showing `CPC_448h.PTC_HV_Volt` in a fresh browser tab
- **THEN** it reports `complete`, and a screenshot taken right after shows the band and the break
- **Evidence:** UI check (CLI output and screenshot)

### Requirement: Gap info refetched
A loaded gap info SHALL be fetched again every 5 min while a window shows its data ref, replaced only when the answer differs, and kept without a render error when that fetch fails. Origin: necessary consequence of D-062 (the server's gap info follows new rows, data-gaps); design G9 (c).

#### Scenario: Refetch every 5 min
- **WHEN** a window shows a data ref whose gap info has loaded, 5 min pass with the same answer, 5 min more with one logger gap less, then 5 min more with a failing fetch
- **THEN** one request is sent at each 5 min mark; the info object stays the same after the first, is replaced after the second, and stays after the third with no render error, the window settled throughout
- **Evidence:** `apps/web/test/gaps.test.ts` › "refetches gap info every 5 min and keeps it on failure"
