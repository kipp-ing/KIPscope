## MODIFIED Requirements

### Requirement: Values window
The dashboard SHALL offer a window kind "values" with a header (title, "Between points" select, Remove) and one row per signal: drag grip, colour swatch, name and the value cells, each value carrying its unit (number-format); there is no separate unit column. It SHALL have no plot, time range or zoom. It SHALL be created by "+ Values window" in the option bar or by `window.create {kind: "values"}`. An untitled one SHALL be named "Values <n>" after its ID `w<n>`. Origin: D-023; concept §2, §4 (Einzelwertfenster); unit in the cell from D-026 („the unit may carry an SI prefix", e.g. `14.0 k1/min`), so a separate column would repeat it.

#### Scenario: Create from the bar
- **WHEN** the user clicks "+ Values window" in the option bar
- **THEN** a window "Values <n>" appears last, showing "Drop a signal here", without plot or range
- **Evidence:** UI check (screenshot); `packages/shared/test/apply.test.ts` › "creates a values window without range"

#### Scenario: Create from the CLI
- **WHEN** a caller posts `{"type":"window.create","kind":"values"}` to `/api/commands`
- **THEN** the result is accepted with `created` `w<n>`, `curl -s localhost:7310/api/workspace | jq -c '.workspace.windows[-1] | {kind, range}'` prints `{"kind":"values","range":null}`, and the browser shows the window within 1 s
- **Evidence:** the `curl` commands; UI check (screenshot)

#### Scenario: Rename
- **WHEN** the user clicks the values window's title, types `Drive` and presses Enter
- **THEN** the header and the explorer's "Add to" list show `Drive`
- **Evidence:** UI check (screenshot)

#### Scenario: No unit column
- **WHEN** a values window lists `BS_200h.DVL` and A is off
- **THEN** the row shows grip, swatch, `DVL` and `—`, and no `[1/min]` column
- **Evidence:** UI check (screenshot)

### Requirement: Value at cursor A
Each row SHALL show its signal's value at cursor A. The value is evaluated from the signal's raw points around A by the series-query "Value at a time" in the window's "Between points" mode: "linear" or "hold", default "linear". The value SHALL NOT depend on any timeseries window's zoom. While A is off, the rows SHALL show `—` and the header "Cursor A off". Origin: D-023 („lists signals with their value at cursor A"); concept §6 (line → linear, step → hold); D-024 (raw values from the server); texts in number-format (D-026).

#### Scenario: Raw point under the cursor
- **WHEN** the values window lists `COMBI_412h.V_ANZ`, `BS_200h.DVL` and `CPC_448h.PTC_HV_Volt`, and `cursor.set {cursor: "a", t: "2026-10-13T13:08:00.093Z"}` is posted
- **THEN** within 1 s the rows read `23.0 km/h` (V_ANZ, raw), `180 1/min lin` (DVL) and `363 V lin` (PTC_HV_Volt), and the header reads `A 2026-10-13 15:08:00.093`
- **Evidence:** UI check (screenshot); `curl -s 'localhost:7310/api/value?signal=smart451/COMBI_412h.V_ANZ&t=2026-10-13T13:08:00.093Z' | jq -c .value` prints `{"kind":"raw","value":23}`

#### Scenario: Between points, linear and hold
- **WHEN** A is set to `2026-10-13T13:08:00.1435Z`, first with "Between points: linear", then with "hold"
- **THEN** V_ANZ reads `22.5 km/h lin`, then `23.0 km/h hold`
- **Evidence:** UI check (two screenshots); `curl -s 'localhost:7310/api/value?signal=smart451/COMBI_412h.V_ANZ&t=2026-10-13T13:08:00.1435Z&mode=step' | jq -c .value` prints `{"kind":"held","value":23}`

#### Scenario: Independent of zoom
- **WHEN** A stays at 13:08:00.1435Z and the user zooms the timeseries windows from 3 s to 2 days
- **THEN** the values window still reads `22.5 km/h lin` for V_ANZ
- **Evidence:** UI check (screenshot after the zoom)

#### Scenario: Cursor A off
- **WHEN** the user unchecks "A" in the option bar
- **THEN** every row shows `—` and the header reads "Cursor A off"
- **Evidence:** UI check (screenshot)

### Requirement: SNA and missing values at a cursor
A value that is SNA at the cursor SHALL be shown as `SNA` in the SNA style, never as a number. Where no value can be evaluated without inventing one, `—` SHALL be shown with the reason as tooltip: before the first point, after the last point, or (in "linear") the next point is SNA. Origin: D-010 (SNA never shown as valid), D-016 (null = SNA); concept §5 („Ohne verfügbare Messgrundlage darf kein Wert erfunden werden").

#### Scenario: SNA run
- **WHEN** the window lists V_ANZ and A is set to `2026-10-13T09:57:00Z` (between the SNA points at 09:56:59.937 and 09:57:00.037 UTC)
- **THEN** the row reads `SNA` in both modes, and no number appears
- **Evidence:** UI check (screenshot); `curl -s 'localhost:7310/api/value?signal=smart451/COMBI_412h.V_ANZ&t=2026-10-13T09:57:00Z' | jq -c .value` prints `{"kind":"sna"}`

#### Scenario: Next point is SNA
- **WHEN** A is set to `2026-10-13T09:56:59.787Z` (between the valid 0 at 09:56:59.737 and the SNA point at 09:56:59.837)
- **THEN** the row reads `—` with tooltip "next point is SNA" in "linear", and `0 km/h hold` in "hold"
- **Evidence:** UI check (two screenshots); `curl -s 'localhost:7310/api/value?signal=smart451/COMBI_412h.V_ANZ&t=2026-10-13T09:56:59.787Z' | jq -c .value` prints `{"kind":"none","reason":"next_sna"}`

#### Scenario: Before the first point
- **WHEN** A is set to `2026-10-11T12:00:00Z`, before V_ANZ's first point (12:34:24.824Z)
- **THEN** the row reads `—` with tooltip "before the first point"
- **Evidence:** UI check (screenshot); `apps/web/test/values.test.ts` › "formats SNA and missing values without a number"

### Requirement: Diff columns
While diff mode is on, each row SHALL show the value at A, the value at B and Δ = B−A. The header SHALL show both cursor times and Δt = B−A, with sign. Δ SHALL be computed only when both values are numbers, else it SHALL show `—`. Δ SHALL carry the tag `lin` if either value is interpolated, else `hold` if either is held. While B is off, B and Δ SHALL show `—`. Origin: D-023; concept §6 (values at A and B, Δt and ΔWert, B−A); texts in number-format (D-026).

#### Scenario: Speed difference
- **WHEN** diff mode is on, A is at 2026-10-13T13:08:00.093Z and B at 13:08:00.995Z
- **THEN** V_ANZ reads A `23.0 km/h`, B `18.0 km/h`, Δ `-5.00 km/h`; PTC_HV_Volt reads Δ `500 mV lin`; the header shows `Δt +902 ms`
- **Evidence:** UI check (screenshot); `apps/web/test/values.test.ts` › "computes Δ only from numeric values and tags it by the weaker kind", "formats Δt exactly with sign"

#### Scenario: SNA at one cursor
- **WHEN** diff mode is on, A is at 2026-10-13T09:57:00Z (V_ANZ SNA) and B at 09:57:00.5Z (V_ANZ valid 0)
- **THEN** V_ANZ reads A `SNA`, B `0 km/h lin` (between two valid zeros), Δ `—`
- **Evidence:** UI check (screenshot); `apps/web/test/values.test.ts` › "computes Δ only from numeric values and tags it by the weaker kind"

#### Scenario: B off
- **WHEN** diff mode is on and B is off
- **THEN** the B and Δ columns show `—` and the header shows `B off`
- **Evidence:** UI check (screenshot)

### Requirement: Value and time formats
Values and Δ SHALL be printed by number-format with the workspace's digits option, each followed by its unit with SI prefix. The tooltip naming the neighbour points SHALL keep the exact stored values (at most 9 significant digits, trailing zeros dropped). Cursor times SHALL be shown in local time as `YYYY-MM-DD HH:MM:SS`, with the fraction down to nanoseconds and trailing zero groups of three dropped. Δt SHALL be exact, with sign, in ns, µs, ms or s below one minute, else as `h:mm:ss` with fraction. Origin: D-026 (3 significant digits, SI prefix, option 4); exact tooltips and times: design N9 (Jan's call Q7); data fact for the 9-digit tooltip: `CPC_448h.PTC_HV_Volt` stores `362.40000000000003`.

#### Scenario: Float noise
- **WHEN** a value of `CPC_448h.PTC_HV_Volt` is 362.40000000000003 and a Δ is 0.5000000000000568, with 3 and then 4 digits
- **THEN** they are printed `362 V` and `500 mV`, then `362.4 V` and `500.0 mV`; the neighbour tooltip shows `362.4`
- **Evidence:** `apps/web/test/values.test.ts` › "formats values with the digits option and the unit"; `packages/shared/test/cursor.test.ts` › "formats cursor numbers with at most 9 significant digits"

#### Scenario: Time and Δt formats
- **WHEN** a cursor is at 1791896880093000000 in Europe/Berlin, and Δt values are 902000000, −1500, 3723500000000 and 0 ns
- **THEN** the time reads `2026-10-13 15:08:00.093`, and the Δt values read `+902 ms`, `-1.5 µs`, `+1:02:03.5` and `0 ns`
- **Evidence:** `apps/web/test/values.test.ts` › "formats cursor times in local time down to nanoseconds", "formats Δt exactly with sign"
