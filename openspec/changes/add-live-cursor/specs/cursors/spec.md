## MODIFIED Requirements

### Requirement: Readout cells in the legend
While A is on, each signal's legend row in a timeseries window SHALL show its value at A, while B is on also at B, and in diff mode Δ = B−A, in columns aligned across rows; after them the live column L (live-cursor "L column in every chart legend") SHALL always follow, also while A and B are off. Cells use number-format without the unit but with its SI prefix (the row names `[unit]` once) and no tag; the kind (`lin`, `hold`, `avg`) is the tooltip. SNA reads `SNA`, a missing value `—` with the reason, a loading value the values window's loading state. Origin: D-027; concept §6; design N3 of `improve-navigation`; D-030; D-031; L column: D-032 („Every chart legend gets a 4th column L").

#### Scenario: Speed difference on the chart
- **WHEN** a window shows `COMBI_412h.V_ANZ`, `BS_200h.DVL` and `CPC_448h.PTC_HV_Volt` from 2026-10-13T13:08:00Z to 13:08:03Z in line mode, diff mode is on, A is at 13:08:00.093Z and B at 13:08:00.995Z
- **THEN** the V_ANZ row reads `[km/h]`, A `23.0`, B `18.0`, Δ `-5.00`, then the L cell; the DVL row reads A `180` with tooltip "linear between points (lin)"; the PTC_HV_Volt row reads A `363` and Δ `500 m`
- **Evidence:** UI check (screenshot of the window); `apps/web/test/readout.test.ts` › "evaluates raw results like evaluateAt, with edge neighbours", "computes Δ only from numbers and marks it avg > lin > hold"

#### Scenario: A only
- **WHEN** diff mode is off, A is on and B is off in the window above; then B is set to 13:08:00.995Z
- **THEN** each row shows the A column and the L column; then the A, B and L columns without Δ, and the readout row `A …` and `B …` without `Δt`
- **Evidence:** UI check (screenshot)

#### Scenario: Cursors off
- **WHEN** A and B are off and the pointer is outside every plot
- **THEN** the legend rows show no A, B or Δ column, only the empty L column
- **Evidence:** UI check (screenshot)
