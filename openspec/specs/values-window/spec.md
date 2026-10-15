# values-window Specification

## Purpose
A values window is a dashboard window without a plot. It lists its own signals with their values at cursor A, and in diff mode at A and B with Δ = B−A and Δt. It answers the concept's open question on single-value windows (D-023).

## Requirements

### Requirement: Values window
The dashboard SHALL offer a window kind "values" with a header (title, "Between points" select, Remove) and one row per signal: drag grip, colour swatch, name, unit and the value cells. It SHALL have no plot, time range or zoom. It SHALL be created by "+ Values window" in the option bar or by `window.create {kind: "values"}`. An untitled one SHALL be named "Values <n>" after its ID `w<n>`. Origin: D-023; concept §2, §4 (Einzelwertfenster).

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

### Requirement: Signals into a values window
A values window SHALL take a signal by explorer "Add to" (listed by name), explorer drag, or a dragged legend or values row; rows move on a plain drop and copy with Alt/Ctrl, as between timeseries windows. Any number of units SHALL be accepted. A window already showing the signal SHALL refuse it; the 50-signal limit still applies. Origin: D-023 („Signals get into it by drag or "Add to", like any window"; the unit limit does not apply there).

#### Scenario: Five units
- **WHEN** a values window holds `CPC_448h.PTC_HV_Volt` (V), `COMBI_412h.V_ANZ` (km/h), `MS_608h.T_MOT` (°C) and `BS_200h.DVL` (1/min), and the user drags `MS_312h.DNMOT` (rpm/10ms) from the explorer over it and releases
- **THEN** the window is highlighted with "Drop to add" (not refused) while dragging, and after the drop it lists five signals
- **Evidence:** `packages/shared/test/apply.test.ts` › "adds any number of units to a values window"; `apps/web/test/drag.test.ts` › "accepts any unit on a values window"; UI check (screenshot while dragging and after)

#### Scenario: Add to
- **WHEN** the explorer's "Add to" target is set to `Values <n>` and the user adds `COMBI_412h.V_ANZ` with Enter
- **THEN** V_ANZ is listed in the values window with its colour swatch and unit `km/h`
- **Evidence:** UI check (screenshot)

#### Scenario: Legend row into a values window
- **WHEN** window 1 shows V_ANZ and DVL, and the user drags the DVL legend row onto the values window with Alt held, then the V_ANZ legend row without a modifier
- **THEN** DVL is listed in the values window and still drawn in window 1; V_ANZ is listed in the values window and no longer drawn in window 1
- **Evidence:** `apps/web/test/drag.test.ts` › "moves and copies legend rows into a values window"; UI check (screenshot after both drops)

### Requirement: Values rows are a drag source
Pressing a values row's grip and moving the pointer SHALL start the app's signal drag. A plain drop SHALL move the signal, and Alt/Ctrl SHALL copy it, into a timeseries window, another values window or "+ New window". Drops into a timeseries window follow that window's rules, including the refused fifth unit. Origin: D-023 („every place that lists a signal is a drag source … the cursor value window"); D-022 (one drag machinery).

#### Scenario: Row onto a timeseries window
- **WHEN** a values window lists `BS_200h.DVL` and the user drags its row onto timeseries window 2, which does not show DVL
- **THEN** window 2 is highlighted with "Drop to move · Alt/Ctrl+drop to copy" while dragging; after the drop DVL is drawn in window 2 in its colour, gone from the values window, and the revision rose by exactly one
- **Evidence:** `apps/web/test/drag.test.ts` › "drags a values row like a legend row"; UI check (screenshot while dragging and after)

#### Scenario: Row onto "+ New window"
- **WHEN** the user drags a values row onto "+ New window" while timeseries window 1 exists and was zoomed last
- **THEN** a new timeseries window "Window <n>" with window 1's range shows the signal, and the values row is gone
- **Evidence:** `packages/shared/test/apply.test.ts` › "moves a signal from a values window into a new timeseries window"; UI check (screenshot)

### Requirement: Value at cursor A
Each row SHALL show its signal's value at cursor A. The value is evaluated from the signal's raw points around A by the series-query "Value at a time" in the window's "Between points" mode: "linear" or "hold", default "linear". The value SHALL NOT depend on any timeseries window's zoom. While A is off, the rows SHALL show `—` and the header "Cursor A off". Origin: D-023 („lists signals with their value at cursor A"); concept §6 (line → linear, step → hold); resolution per design C4.

#### Scenario: Raw point under the cursor
- **WHEN** the values window lists `COMBI_412h.V_ANZ`, `BS_200h.DVL` and `CPC_448h.PTC_HV_Volt`, and `cursor.set {cursor: "a", t: "2026-10-13T13:08:00.093Z"}` is posted
- **THEN** within 1 s the rows read `23` (V_ANZ, raw), `179.75 lin` (DVL) and `362.8 lin` (PTC_HV_Volt), and the header reads `A 2026-10-13 15:08:00.093`
- **Evidence:** UI check (screenshot); `curl -s 'localhost:7310/api/value?signal=smart451/COMBI_412h.V_ANZ&t=2026-10-13T13:08:00.093Z' | jq -c .value` prints `{"kind":"raw","value":23}`

#### Scenario: Between points, linear and hold
- **WHEN** A is set to `2026-10-13T13:08:00.1435Z`, first with "Between points: linear", then with "hold"
- **THEN** V_ANZ reads `22.5 lin`, then `23 hold`
- **Evidence:** UI check (two screenshots); `curl -s 'localhost:7310/api/value?signal=smart451/COMBI_412h.V_ANZ&t=2026-10-13T13:08:00.1435Z&mode=step' | jq -c .value` prints `{"kind":"held","value":23}`

#### Scenario: Independent of zoom
- **WHEN** A stays at 13:08:00.1435Z and the user zooms the timeseries windows from 3 s to 2 days
- **THEN** the values window still reads `22.5 lin` for V_ANZ
- **Evidence:** UI check (screenshot after the zoom)

#### Scenario: Cursor A off
- **WHEN** the user unchecks "A" in the option bar
- **THEN** every row shows `—` and the header reads "Cursor A off"
- **Evidence:** UI check (screenshot)

### Requirement: Value kinds are marked
A raw value (a point exactly at the cursor) SHALL be shown plain, an interpolated value with the tag `lin`, and a held value with the tag `hold`. The tooltip of a value SHALL name the neighbour points it came from (local time and value). Origin: concept §6 („Rohwerte, interpolierte Werte und verdichtete Werte sollen erkennbar bleiben"); aggregated values do not occur in this window (design C4).

#### Scenario: Three kinds
- **WHEN** the window shows the values of the scenario "Raw point under the cursor"
- **THEN** V_ANZ shows no tag, DVL and PTC_HV_Volt show `lin`, and DVL's tooltip names 15:08:00.083 → 179.5 and 15:08:00.103 → 180
- **Evidence:** `apps/web/test/values.test.ts` › "formats raw, interpolated and held values with their tags"; UI check (screenshot with the tooltip)

### Requirement: SNA and missing values at a cursor
A value that is SNA at the cursor SHALL be shown as `SNA` in the SNA style, never as a number. Where no value can be evaluated without inventing one, `—` SHALL be shown with the reason as tooltip: before the first point, after the last point, or (in "linear") the next point is SNA. Origin: D-010 (SNA never shown as valid), D-016 (null = SNA); concept §5 („Ohne verfügbare Messgrundlage darf kein Wert erfunden werden").

#### Scenario: SNA run
- **WHEN** the window lists V_ANZ and A is set to `2026-10-13T09:57:00Z` (between the SNA points at 09:56:59.937 and 09:57:00.037 UTC)
- **THEN** the row reads `SNA` in both modes, and no number appears
- **Evidence:** UI check (screenshot); `curl -s 'localhost:7310/api/value?signal=smart451/COMBI_412h.V_ANZ&t=2026-10-13T09:57:00Z' | jq -c .value` prints `{"kind":"sna"}`

#### Scenario: Next point is SNA
- **WHEN** A is set to `2026-10-13T09:56:59.787Z` (between the valid 0 at 09:56:59.737 and the SNA point at 09:56:59.837)
- **THEN** the row reads `—` with tooltip "next point is SNA" in "linear", and `0 hold` in "hold"
- **Evidence:** UI check (two screenshots); `curl -s 'localhost:7310/api/value?signal=smart451/COMBI_412h.V_ANZ&t=2026-10-13T09:56:59.787Z' | jq -c .value` prints `{"kind":"none","reason":"next_sna"}`

#### Scenario: Before the first point
- **WHEN** A is set to `2026-10-11T12:00:00Z`, before V_ANZ's first point (12:34:24.824Z)
- **THEN** the row reads `—` with tooltip "before the first point"
- **Evidence:** UI check (screenshot); `apps/web/test/values.test.ts` › "formats SNA and missing values without a number"

### Requirement: Diff columns
While diff mode is on, each row SHALL show the value at A, the value at B and Δ = B−A. The header SHALL show both cursor times and Δt = B−A, with sign. Δ SHALL be computed only when both values are numbers, else it SHALL show `—`. Δ SHALL carry the tag `lin` if either value is interpolated, else `hold` if either is held. While B is off, B and Δ SHALL show `—`. Origin: D-023; concept §6 (values at A and B, Δt and ΔWert, B−A).

#### Scenario: Speed difference
- **WHEN** diff mode is on, A is at 2026-10-13T13:08:00.093Z and B at 13:08:00.995Z
- **THEN** V_ANZ reads A `23`, B `18`, Δ `-5`; PTC_HV_Volt reads Δ `0.5 lin`; the header shows `Δt +902 ms`
- **Evidence:** UI check (screenshot); `apps/web/test/values.test.ts` › "computes Δ only from numeric values and tags it by the weaker kind", "formats Δt exactly with sign"

#### Scenario: SNA at one cursor
- **WHEN** diff mode is on, A is at 2026-10-13T09:57:00Z (V_ANZ SNA) and B at 09:57:00.5Z (V_ANZ valid 0)
- **THEN** V_ANZ reads A `SNA`, B `0 lin` (between two valid zeros), Δ `—`
- **Evidence:** UI check (screenshot); `apps/web/test/values.test.ts` › "computes Δ only from numeric values and tags it by the weaker kind"

#### Scenario: B off
- **WHEN** diff mode is on and B is off
- **THEN** the B and Δ columns show `—` and the header shows `B off`
- **Evidence:** UI check (screenshot)

### Requirement: Value and time formats
Values and Δ SHALL be printed with at most 9 significant digits, trailing zeros dropped, followed by the unit in the row. Cursor times SHALL be shown in local time as `YYYY-MM-DD HH:MM:SS`, with the fraction down to nanoseconds and trailing zero groups of three dropped. Δt SHALL be exact, with sign, in ns, µs, ms or s below one minute, else as `h:mm:ss` with fraction. Origin: necessary consequence of stored float noise (data fact: `CPC_448h.PTC_HV_Volt` stores `362.40000000000003`).

#### Scenario: Float noise
- **WHEN** a value or Δ is 362.40000000000003 or 0.5000000000000568
- **THEN** it is printed `362.4` and `0.5`
- **Evidence:** `packages/shared/test/cursor.test.ts` › "formats cursor numbers with at most 9 significant digits"

#### Scenario: Time and Δt formats
- **WHEN** a cursor is at 1791896880093000000 in Europe/Berlin, and Δt values are 902000000, −1500, 3723500000000 and 0 ns
- **THEN** the time reads `2026-10-13 15:08:00.093`, and the Δt values read `+902 ms`, `-1.5 µs`, `+1:02:03.5` and `0 ns`
- **Evidence:** `apps/web/test/values.test.ts` › "formats cursor times in local time down to nanoseconds", "formats Δt exactly with sign"

### Requirement: Values follow the cursors
After every accepted cursor or values-window change, from the UI or the CLI, the rows SHALL show the new values once loaded, and a response for an older cursor time or mode SHALL NOT replace a newer one. While a cursor line is being dragged, the rows SHALL keep their committed values, dimmed. Origin: concept §7 (the open view follows remote control); timeseries-window "Stale responses discarded" applied to values.

#### Scenario: Quick moves
- **WHEN** a caller posts three `cursor.move {cursor: "a", by: "100000000"}` commands in quick succession
- **THEN** the rows end with the values at the third position, never at the first or second
- **Evidence:** `apps/web/test/values.test.ts` › "discards stale value responses"; UI check (screenshot after the third command)

#### Scenario: Dimmed during a drag
- **WHEN** the user drags A's line in a timeseries window
- **THEN** the values window shows the values of A's last committed time, dimmed, until release, then the values at the new time
- **Evidence:** UI check (screenshot while dragging and after release)

### Requirement: Values window in the render acknowledgement
A values window SHALL report a revision as rendered once its values for that revision are loaded. A failed value request SHALL mark its row as failed with the error message, keep the other rows, and make the revision count as rendered with an error. Origin: workspace-state "Render acknowledgement"; concept §7 (a caller must see whether the data is available and drawn).

#### Scenario: Cursor set from the CLI
- **WHEN** a caller posts `cursor.set` for A while the values window lists V_ANZ, and then reads `curl -s localhost:7310/api/render-status`
- **THEN** within 2 s the browser's client reports that revision with status `complete`
- **Evidence:** the `curl` commands

#### Scenario: One value fails
- **WHEN** the value request for one row fails (for example the server answers 502)
- **THEN** that row shows the error and the others their values, and the revision is reported with status `error` naming that signal
- **Evidence:** `apps/web/test/values.test.ts` › "reports failed value requests per row"

### Requirement: Values window has no time range
Range, zoom and plot settings SHALL NOT apply to a values window: linked ranges, zoom history, Backspace, plot insets and height ignore it. Backspace with the pointer over a values window SHALL act on the window zoomed last. Origin: necessary consequence of a window kind without a time axis (D-023).

#### Scenario: Backspace over the values window
- **WHEN** window 1 was zoomed twice and the pointer rests over the values window when the user presses Backspace
- **THEN** window 1 goes back one step and the values window is unchanged
- **Evidence:** UI check (header of window 1 before and after)

### Requirement: Loading state in value cells
While the value for a cell's current cursor time and mode is loading, the cell SHALL show a state distinct from `—` (the form is free), with the tooltip "loading"; `—` SHALL mean only "no value". Whenever diff mode is on and B is on, the B cells SHALL be requested and filled like the A cells. Origin: power-user bug (feedback 2026-10-15, item 3: `—` for 1–3 s read as "no data"; B once stayed `—` with data).

#### Scenario: Cursor moved from the CLI
- **WHEN** the values window lists V_ANZ and a caller posts `cursor.move {cursor: "a", by: "100000000"}`
- **THEN** until the new value arrives the cell shows the loading state with tooltip "loading", never `—`, and then the value
- **Evidence:** `apps/web/test/values.test.ts` › "shows a loading state distinct from no value"; UI check (screenshot right after the command)

#### Scenario: B always fills
- **WHEN** diff mode is on and B is set five times with `cursor.set` to times where V_ANZ has data (2026-10-13T13:08:00.1Z … 13:08:00.5Z)
- **THEN** after each command the B cell shows a number, never `—`
- **Evidence:** `apps/web/test/values.test.ts` › "requests B whenever diff mode and B are on"; UI check (screenshot after the last command)
