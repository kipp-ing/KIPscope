# number-format Specification

## Purpose
Prints measured values for people in one consistent form: a fixed number of significant digits with an SI prefix on the unit, the same in every place of the UI, while machine output (API, CLI JSON) stays exact.

## Requirements

### Requirement: Significant digits with SI prefix
A measured value shown to people SHALL be printed with exactly N significant digits (N = 3, or 4 with the digits option), trailing zeros kept, then a space and the unit. A unit that takes a prefix SHALL get the SI prefix (p … T) that puts the scaled value in [1, 1000), written directly before the unit. Zero reads `0`, negatives start with `-`; `SNA` and `—` keep their texts. Origin: D-026 („3 significant digits … SI prefix (k, M, m, µ, …), e.g. 13 970 1/min → `14.0 k1/min`").

#### Scenario: Pinned values
- **WHEN** the shared formatter prints, with 3 digits: 13970 `1/min`, 0.00123 `V`, 179.75 `1/min`, 362.40000000000003 `V`, 0.5 `V`, -5 `km/h`, 0 `km/h`, 999.96 `V`, 13970 without unit, -127 `rpm/10ms`
- **THEN** it returns `14.0 k1/min`, `1.23 mV`, `180 1/min`, `362 V`, `500 mV`, `-5.00 km/h`, `0 km/h`, `1.00 kV`, `14.0 k`, `-127 rpm/10ms`
- **Evidence:** `packages/shared/test/numfmt.test.ts` › "formats the pinned values with 3 digits"

#### Scenario: Four digits
- **WHEN** the same formatter prints 13970 `1/min`, 179.75 `1/min` and 362.40000000000003 `V` with 4 digits
- **THEN** it returns `13.97 k1/min`, `179.8 1/min` and `362.4 V`
- **Evidence:** `packages/shared/test/numfmt.test.ts` › "formats the pinned values with 4 digits"

### Requirement: Units that take no prefix
A unit that already starts with an SI prefix of a base unit (e.g. `km/h`, `kW`, `mA`, `ms`, `mbar`) and the units `%`, `‰`, `°`, `°C`, `°F`, `dB`, `h`, `min`, `d` SHALL NOT get a prefix; their values SHALL be printed as a plain decimal with N significant digits, and in exponent form (`1.00e+7`) only below 0.001 or from 1 000 000 in magnitude. Origin: necessary consequence of D-026's prefix rule: `Mm/h`, `k°C` or `m%` would be wrong or unreadable.

#### Scenario: Prefixed and prefix-free units
- **WHEN** the formatter prints with 3 digits: 45 `km/h`, 1234 `km/h`, -40 `°C`, 0.001 `°C`, 12.5 `%`, 10000000 `%`, 1500 `kW`
- **THEN** it returns `45.0 km/h`, `1230 km/h`, `-40.0 °C`, `0.00100 °C`, `12.5 %`, `1.00e+7 %`, `1500 kW`
- **Evidence:** `packages/shared/test/numfmt.test.ts` › "does not prefix prefixed or prefix-free units"

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

### Requirement: Exact texts kept
Times, Δt, SNA shares, DBC scaling factors and raw steps, and the tooltips naming neighbour points SHALL keep their exact formats. Origin: design N9, Jan's call Q7: they are timestamps, definitions or the exact drill-down behind a rounded reading, not readings.

#### Scenario: Rounded cell, exact tooltip
- **WHEN** a values window lists `BS_200h.DVL` and A is at 2026-10-13T13:08:00.093Z
- **THEN** the cell reads `180 1/min lin` and its tooltip names `2026-10-13 15:08:00.083 → 179.5` and `2026-10-13 15:08:00.103 → 180`
- **Evidence:** UI check (screenshot with the tooltip); `apps/web/test/values.test.ts` › "formats raw, interpolated and held values with their tags"

### Requirement: Digits option
The workspace's digits option (3 or 4, default 3) SHALL apply to every place of "One format in every human-readable place" in every connected UI within 1 s of the change. The option bar SHALL show and set it. Origin: D-026 („4 significant digits are an option"); concept §8 (user options belong to the workspace state).

#### Scenario: Switch to four digits
- **WHEN** the scenario "Same value, same text" is shown and the user sets the option bar's digits to 4
- **THEN** both cells read `362.8 V lin`, and `curl -s localhost:7310/api/workspace | jq .workspace.options.digits` prints `4`
- **Evidence:** UI check (screenshot after the switch); the `curl` command

#### Scenario: Set from the CLI
- **WHEN** a caller runs `kipscope digits 3` while the UI shows four digits
- **THEN** within 1 s the cells read `363 V lin` again
- **Evidence:** UI check (screenshot after the command); CLI output with `"accepted":true`

### Requirement: Machine output stays exact
API responses and the CLI's JSON output SHALL carry values unrounded, as before this change. Origin: D-026 („Machine output (JSON, API) stays exact").

#### Scenario: Value over HTTP and CLI
- **WHEN** a caller runs `curl -s 'localhost:7310/api/value?signal=smart451/BS_200h.DVL&t=2026-10-13T13:08:00.093Z' | jq -c .value` and `kipscope value smart451/BS_200h.DVL "2026-10-13 15:08:00.093"` with the digits option at 3
- **THEN** both print the value `179.75` (`{"kind":"interpolated","value":179.75}`), not `180`
- **Evidence:** the two commands
