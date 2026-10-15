## MODIFIED Requirements

### Requirement: One format in every human-readable place
The values window (A, B, Δ, L), the chart readout (A, B, Δ, L), the highlight label at the pointer, the y-axis ticks and the hover card's DBC range and SNA values SHALL use this format with the workspace's digits option; the chart readout drops the unit and keeps the SI prefix (D-030), the highlight label keeps the unit. Origin: D-026 („everywhere (values window, readouts on charts, axes, hover card, human-readable CLI output)"); the CLI prints only JSON (add-cli "One JSON result per call"), so it has no text to format; L cells and label: D-032.

#### Scenario: Same value, same text
- **WHEN** a values window lists `CPC_448h.PTC_HV_Volt`, a timeseries window shows it zoomed to 2026-10-13T13:08:00Z–13:08:03Z in line mode, and A is set to 2026-10-13T13:08:00.093Z
- **THEN** the values window cell reads `363 V lin` and the chart readout cell `363` under the row's `[V]`, with the tooltip "linear between points (lin)" (the chart names the unit once, D-030)
- **Evidence:** UI check (one screenshot of both windows)

#### Scenario: Label and L cell in four digits
- **WHEN** the digits option is 4, the window above is hovered at 13:08:00.093Z with the pointer on the PTC_HV_Volt curve
- **THEN** the label reads `362.8 V`, the chart L cell `362.8` and, once the pointer rests, the values window's L cell `362.8 V lin`
- **Evidence:** UI check (screenshot); `apps/web/test/live.test.ts` › "places the label beside the curve point, inside the plot" (label text with digits)
