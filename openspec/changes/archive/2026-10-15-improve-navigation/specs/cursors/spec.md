## ADDED Requirements

### Requirement: Readout cells in the legend
While A is on, each signal's legend row in a timeseries window SHALL show its value at A, while B is on also at B, and in diff mode Δ = B−A, in columns aligned across rows. Cells use number-format without the unit but with its SI prefix (the row names `[unit]` once) and no tag; the kind (`lin`, `hold`, `avg`) is the tooltip. SNA reads `SNA`, a missing value `—` with the reason, a loading value the values window's loading state. Origin: D-027; concept §6; design N3; D-030; D-031.

#### Scenario: Speed difference on the chart
- **WHEN** a window shows `COMBI_412h.V_ANZ`, `BS_200h.DVL` and `CPC_448h.PTC_HV_Volt` from 2026-10-13T13:08:00Z to 13:08:03Z in line mode, diff mode is on, A is at 13:08:00.093Z and B at 13:08:00.995Z
- **THEN** the V_ANZ row reads `[km/h]`, A `23.0`, B `18.0`, Δ `-5.00`; the DVL row reads A `180` with tooltip "linear between points (lin)"; the PTC_HV_Volt row reads A `363` and Δ `500 m`
- **Evidence:** UI check (screenshot of the window); `apps/web/test/readout.test.ts` › "evaluates raw results like evaluateAt, with edge neighbours", "computes Δ only from numbers and marks it avg > lin > hold"

#### Scenario: A only
- **WHEN** diff mode is off, A is on and B is off in the window above; then B is set to 13:08:00.995Z
- **THEN** each row shows only the A column; then the A and B columns without Δ, and the readout row `A …` and `B …` without `Δt`
- **Evidence:** UI check (screenshot)

#### Scenario: Cursors off
- **WHEN** A and B are off
- **THEN** the legend rows show no value columns
- **Evidence:** UI check (screenshot)

### Requirement: Readout row
While a cursor is on, a readout row directly above a timeseries window's legend rows SHALL show `A` with A's local clock time (values-window format without the date, which the tooltip keeps), `B` with B's clock time while B is on (`B off` in diff mode) and, in diff mode, `Δt` with sign. The readout SHALL cover no part of the plot except the Δt label ("Δt between the cursor flags"). Origin: D-027 (the values window stays for many signals); concept §6 (Δt); clock only: D-030.

#### Scenario: Times and Δt
- **WHEN** the window of "Speed difference on the chart" is shown, then diff mode is switched off, then B is switched off, then A
- **THEN** the row reads `A 15:08:00.093` (tooltip `2026-10-13 15:08:00.093`), `B 15:08:00.995`, `Δt +902 ms`; then `A 15:08:00.093`, `B 15:08:00.995`; then only `A 15:08:00.093`; then the row is gone
- **Evidence:** UI check (three screenshots)

#### Scenario: Nothing over the curves
- **WHEN** a window shows six signals in at most four units (the unit limit, D-019) with A and B on in diff mode
- **THEN** the plot shows the curves, the cursor lines with their flags and the Δt label only; all values are in the legend rows
- **Evidence:** UI check (screenshot)

### Requirement: Exact readout values
A chart readout cell SHALL show the values window's exact value at the committed cursor time, fetched from the server for the window's mode (markers as line), inside or outside the zoom and at any zoom level. While that value loads, the cell SHALL show the value of the drawn curve, or outside the zoom the previous value, dimmed. A render is acknowledged once these values are in. Origin: D-031 (Jan's pick "Always exact"); supersedes D-024's zoom-dependent chart value.

#### Scenario: Same as the values window
- **WHEN** a values window and the window of "Speed difference on the chart" both list `COMBI_412h.V_ANZ`, both in linear mode, and A is set to 2026-10-13T13:08:00.1435Z; then the timeseries window is zoomed out to V_ANZ's full extent (aggregated)
- **THEN** the values window reads `22.5 km/h lin` and the chart `22.5` with tooltip "linear between points (lin)", also when zoomed out
- **Evidence:** UI check (screenshots); `apps/web/test/readout.test.ts` › "shows the exact server value, inside or outside the zoom"

#### Scenario: Zoom past A
- **WHEN** a window shows `COMBI_412h.V_ANZ` with A at 2026-10-13T13:08:00.093Z in line mode, and the window is zoomed to 13:08:01Z–13:08:03Z
- **THEN** the A cell still reads `23.0` without a loading state in between
- **Evidence:** UI check (screenshot before and after the zoom); `apps/web/test/readout.test.ts` › "shows the drawn value, dimmed, while the exact one loads; outside the zoom the previous one"

### Requirement: Live readout during a drag
While a cursor line is dragged, or a click waits for its double-click, its cells SHALL follow the drawn curve at the shown time (a bucket mean in an aggregated view); on release the exact value replaces it. Origin: D-031; concept §6 (values follow the cursor); design N4.

#### Scenario: Follows a dragged line
- **WHEN** the user drags A's line slowly across the V_ANZ window of "Speed difference on the chart"
- **THEN** the chart's A cell changes while dragging, and a values window showing V_ANZ keeps its committed value, dimmed, until release; after release both read the same value
- **Evidence:** UI check (two screenshots during the drag, one after); `apps/web/test/readout.test.ts` › "follows the drawn curve live while a line is dragged"

### Requirement: Readout without a value
A cursor at an SNA value SHALL read `SNA`, a cursor without a value `—` with the values window's reason, a failed request `—` with the message. Δ SHALL be computed only from two numbers and marked `lin` if either value is interpolated, else `hold` if either is held (`avg` only during a drag in an aggregated view). Origin: D-010 (SNA never a number); concept §5 (no invented values) and §6 (value kinds stay recognisable).

#### Scenario: SNA in and outside the range
- **WHEN** a window shows V_ANZ from 2026-10-13T09:56:59Z to 09:57:01Z and A is set to 09:57:00Z; then a second, unlinked window shows 13:09:00Z–13:09:10Z
- **THEN** both windows' V_ANZ cells read `SNA`, the server's value at 09:57:00Z
- **Evidence:** UI check (screenshots); `apps/web/test/readout.test.ts` › "reads SNA, empty buckets and cursors outside the range without a number", "shows a failed request as — with the message, and Δ as —"

### Requirement: Δt between the cursor flags
While diff mode is on and both cursor lines are drawn in a window, a label `Δt` with the signed exact Δt SHALL be drawn at the top of the plot between the flags "A" and "B"; when the gap is narrower than the label, it SHALL sit beside the right-hand flag. It SHALL NOT cover a flag. Origin: D-027 („Δt … readout on the chart next to the cursors").

#### Scenario: Wide and narrow gap
- **WHEN** diff mode is on in a window showing 2026-10-13T13:08:00Z–13:08:03Z, A is at 13:08:00.093Z and B at 13:08:00.995Z; then B is set to 13:08:00.100Z
- **THEN** the label `Δt +902 ms` sits between the flags; then `Δt +7 ms` sits right of the right-hand flag without covering either flag
- **Evidence:** UI check (two screenshots); `apps/web/test/cursors.test.ts` › "places the Δt label between the flags or beside the right one"

### Requirement: Compact legend rows
A timeseries window's legend row SHALL show the signal, its `[unit]` (tooltip: its y axis side), the readout cells, the loading state only while loading or failed, and the SNA share; nothing for a complete load. Removing a signal SHALL be a `×` at the row's end, visible while the pointer is on the row or on the `×` itself, or the button has keyboard focus. Origin: D-030 (Jan on the diff legend: "the hint wich axes can go", "the "complete" can go", "the remove can go"; × on row hover his pick).

#### Scenario: Diff legend on one line
- **WHEN** a window shows `CPC_168h.EAC_HV_Volt`, `MS_312h.DNMOT` and `BS_200h.DVL` from 2026-10-13 15:06:30 to 15:18:20 local, all loaded, with A at 15:10:50.3, B at 15:13:34.2 and diff mode on
- **THEN** each row reads name, `[unit]`, A, B, Δ and the SNA share, with no axis side, no `complete`, no `avg` and no `remove`; hovering a row shows its `×`, it stays while the pointer moves along the row onto it, and clicking it removes that signal
- **Evidence:** UI check (screenshot, and one with the pointer on a row)
