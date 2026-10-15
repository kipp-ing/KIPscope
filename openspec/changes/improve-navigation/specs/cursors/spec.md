## ADDED Requirements

### Requirement: Readout cells in the legend
While A is on, each signal's legend row in a timeseries window SHALL show its value at A, and in diff mode also at B and Δ = B−A, in columns aligned across the window's rows. Cells use number-format and the tags `lin`, `hold`, `avg`; SNA reads `SNA`, a missing value `—` with the reason as tooltip, a loading value the values window's loading state. Origin: D-027 („A/B values and Δt/Δ readout on the chart next to the cursors"); concept §6; placement: design N3, Jan's call Q1.

#### Scenario: Speed difference on the chart
- **WHEN** a window shows `COMBI_412h.V_ANZ`, `BS_200h.DVL` and `CPC_448h.PTC_HV_Volt` from 2026-10-13T13:08:00Z to 13:08:03Z in line mode, diff mode is on, A is at 13:08:00.093Z and B at 13:08:00.995Z
- **THEN** the V_ANZ row reads A `23.0 km/h`, B `18.0 km/h`, Δ `-5.00 km/h`; the DVL row reads A `180 1/min lin`; the PTC_HV_Volt row reads A `363 V lin` and Δ `500 mV lin`
- **Evidence:** UI check (screenshot of the window); `apps/web/test/readout.test.ts` › "evaluates raw results like evaluateAt, with edge neighbours", "computes Δ only from numbers and tags it avg > lin > hold"

#### Scenario: A only
- **WHEN** diff mode is off and A is on in the window above
- **THEN** each row shows only the A column
- **Evidence:** UI check (screenshot)

#### Scenario: Cursors off
- **WHEN** A and B are off
- **THEN** the legend rows show no value columns
- **Evidence:** UI check (screenshot)

### Requirement: Readout row
While a cursor is on, a readout row directly above a timeseries window's legend rows SHALL show `A` with A's local time and, in diff mode, `B` with B's time (or `B off`) and `Δt` with sign, in the values window's time formats. The readout SHALL cover no part of the plot except the Δt label ("Δt between the cursor flags"). The values window stays the place for many signals. Origin: D-027 („Δt/Δ readout on the chart … (the values window stays for many signals)"); concept §6 (Δt).

#### Scenario: Times and Δt
- **WHEN** the window of "Speed difference on the chart" is shown, then diff mode is switched off, then A is switched off
- **THEN** the row reads `A 2026-10-13 15:08:00.093`, `B 2026-10-13 15:08:00.995`, `Δt +902 ms`; then only `A 2026-10-13 15:08:00.093`; then the row is gone
- **Evidence:** UI check (three screenshots)

#### Scenario: Nothing over the curves
- **WHEN** a window shows six signals in at most four units (the unit limit, D-019) with A and B on in diff mode
- **THEN** the plot shows the curves, the cursor lines with their flags and the Δt label only; all values are in the legend rows
- **Evidence:** UI check (screenshot)

### Requirement: Readout values from the drawn data
Readout values SHALL come from the window's loaded data at its current range and zoom: in a raw view by the values-window evaluation with edge neighbours, linear in line and markers mode, holding in step mode; in an aggregated view the mean of the bucket containing the cursor time, tagged `avg`. The readout SHALL follow the cursor line as drawn, also during a drag. Origin: D-024 („Concept §6's zoom-dependent cursor value stays for the charts"); concept §6; markers mode: design N4.

#### Scenario: Same as the values window in a raw view
- **WHEN** a values window and the window of "Speed difference on the chart" both list `COMBI_412h.V_ANZ`, both in linear mode, and A is set to 2026-10-13T13:08:00.1435Z
- **THEN** both read `22.5 km/h lin`; after switching the timeseries window to step mode its row reads `23.0 km/h hold`
- **Evidence:** UI check (screenshots); `apps/web/test/readout.test.ts` › "evaluates raw results like evaluateAt, with edge neighbours"

#### Scenario: Aggregated overview
- **WHEN** the timeseries window shows V_ANZ at its full extent (aggregated) and A stays at 2026-10-13T13:08:00.093Z, while a values window lists V_ANZ too
- **THEN** the chart's A cell carries the tag `avg` and the values window still reads `23.0 km/h` without tag
- **Evidence:** UI check (screenshot of both windows); `apps/web/test/readout.test.ts` › "takes the bucket mean in aggregated views, tagged avg"

#### Scenario: Follows a dragged line
- **WHEN** the user drags A's line slowly across the V_ANZ window of "Speed difference on the chart"
- **THEN** the chart's A cell changes while dragging, and a values window showing V_ANZ keeps its committed value, dimmed, until release
- **Evidence:** UI check (two screenshots during the drag)

### Requirement: Readout without a value
A bucket with SNA points only SHALL read `SNA`; a cursor time where no bucket lies `—` "no points in this bucket"; a cursor outside the window's range `—` "outside this window's range". Δ SHALL be computed only from two numbers and tagged `avg` if either value is aggregated, else `lin` if either is interpolated, else `hold` if either is held. Origin: D-010 (SNA never a number); concept §5 (no invented values) and §6 (value kinds stay recognisable).

#### Scenario: SNA and outside the range
- **WHEN** a window shows V_ANZ from 2026-10-13T09:56:59Z to 09:57:01Z and A is set to 09:57:00Z; then a second, unlinked window shows 13:09:00Z–13:09:10Z
- **THEN** the first window's V_ANZ cell reads `SNA`, and the second window's cells read `—` with the tooltip "outside this window's range"
- **Evidence:** UI check (screenshots); `apps/web/test/readout.test.ts` › "reads SNA, empty buckets and cursors outside the range without a number"

### Requirement: Δt between the cursor flags
While diff mode is on and both cursor lines are drawn in a window, a label `Δt` with the signed exact Δt SHALL be drawn at the top of the plot between the flags "A" and "B"; when the gap is narrower than the label, it SHALL sit beside the right-hand flag. It SHALL NOT cover a flag. Origin: D-027 („Δt … readout on the chart next to the cursors").

#### Scenario: Wide and narrow gap
- **WHEN** diff mode is on in a window showing 2026-10-13T13:08:00Z–13:08:03Z, A is at 13:08:00.093Z and B at 13:08:00.995Z; then B is set to 13:08:00.100Z
- **THEN** the label `Δt +902 ms` sits between the flags; then `Δt +7 ms` sits right of the right-hand flag without covering either flag
- **Evidence:** UI check (two screenshots); `apps/web/test/cursors.test.ts` › "places the Δt label between the flags or beside the right one"
