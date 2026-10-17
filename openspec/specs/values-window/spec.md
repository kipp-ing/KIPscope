# values-window Specification

## Purpose
A values window is a dashboard window without a plot. It lists its own signals with their values at cursor A, and at B whenever B is on; diff mode adds Δ = B−A and Δt (D-031). It answers the concept's open question on single-value windows (D-023).

## Requirements

### Requirement: Values window
The dashboard SHALL offer a window kind "values" with a header (title, "Between points" select, "⋯" menu) and one row per signal: drag grip, colour swatch, name and the value cells, each value carrying its unit (number-format); there is no separate unit column. It SHALL have no plot, time range or zoom. Origin: D-023; concept §2, §4; unit in the cell: D-026; menu: workspace-layout "Window menu".

#### Scenario: No unit column
- **WHEN** a values window lists `BRK_1A0h.WSPD_FL` and A is off
- **THEN** the row shows grip, swatch, `WSPD_FL` and `—`, and no `[1/min]` column
- **Evidence:** UI check (screenshot)

### Requirement: Creating a values window
A values window SHALL be created by "+ Values window" in the option bar or by `window.create {kind: "values"}`. An untitled one SHALL be named "Values <n>" after its ID `w<n>`. Origin: D-023.

#### Scenario: Create from the bar
- **WHEN** the user clicks "+ Values window" in the option bar
- **THEN** a window "Values <n>" appears last, showing "Drop a signal here", without plot or range
- **Evidence:** UI check (screenshot); `packages/shared/test/apply.test.ts` › "creates a values window without range"

#### Scenario: Create from the CLI
- **WHEN** a caller posts `{"type":"window.create","kind":"values"}` to `/api/commands`
- **THEN** the result is accepted with `created` `w<n>`, `curl -s localhost:7310/api/workspace | jq -c '.workspace.windows[-1] | {kind, range}'` prints `{"kind":"values","range":null}`, and the browser shows the window within 1 s
- **Evidence:** the `curl` commands; UI check (screenshot)

#### Scenario: Rename
- **WHEN** the user double-clicks the values window's title, types `Drive` and presses Enter
- **THEN** the header and the explorer's "Add to" list show `Drive`
- **Evidence:** UI check (screenshot)

### Requirement: Signals into a values window
A values window SHALL take a signal by explorer "Add to" (listed by name), explorer drag, or a dragged legend or values row; rows move on a plain drop and copy with Alt/Ctrl, as between timeseries windows. Any number of units SHALL be accepted. A window already showing the signal SHALL refuse it; the 50-signal limit still applies. Origin: D-023 („Signals get into it by drag or "Add to", like any window"; the unit limit does not apply there).

#### Scenario: Five units
- **WHEN** a values window holds `DCU_2B8h.HTR_HV_Volt` (V), `ICL_3A2h.SPEED_DISP` (km/h), `ENG_5E0h.T_ENG` (°C) and `BRK_1A0h.WSPD_FL` (1/min), and the user drags `ENG_2E8h.MOT_SPD_D` (rpm/10ms) from the explorer over it and releases
- **THEN** the window is highlighted with "Drop to add" (not refused) while dragging, and after the drop it lists five signals
- **Evidence:** `packages/shared/test/apply.test.ts` › "adds any number of units to a values window"; `apps/web/test/drag.test.ts` › "accepts any unit on a values window"; UI check (screenshot while dragging and after)

#### Scenario: Add to
- **WHEN** the explorer's "Add to" target is set to `Values <n>` and the user adds `ICL_3A2h.SPEED_DISP` with Enter
- **THEN** SPEED_DISP is listed in the values window with its colour swatch and unit `km/h`
- **Evidence:** UI check (screenshot)

#### Scenario: Legend row into a values window
- **WHEN** window 1 shows SPEED_DISP and WSPD_FL, and the user drags the WSPD_FL legend row onto the values window with Alt held, then the SPEED_DISP legend row without a modifier
- **THEN** WSPD_FL is listed in the values window and still drawn in window 1; SPEED_DISP is listed in the values window and no longer drawn in window 1
- **Evidence:** `apps/web/test/drag.test.ts` › "moves and copies legend rows into a values window"; UI check (screenshot after both drops)

### Requirement: Values rows are a drag source
Pressing a values row's grip and moving the pointer SHALL start the app's signal drag. A plain drop SHALL move the signal, and Alt/Ctrl SHALL copy it, into a timeseries window, another values window or "+ New window". Drops into a timeseries window follow that window's rules, including the refused fifth unit. Origin: D-023 („every place that lists a signal is a drag source … the cursor value window"); D-022 (one drag machinery).

#### Scenario: Row onto a timeseries window
- **WHEN** a values window lists `BRK_1A0h.WSPD_FL` and the user drags its row onto timeseries window 2, which does not show WSPD_FL
- **THEN** window 2 is highlighted with "Drop to move · Alt/Ctrl+drop to copy" while dragging; after the drop WSPD_FL is drawn in window 2 in its colour, gone from the values window, and the revision rose by exactly one
- **Evidence:** `apps/web/test/drag.test.ts` › "drags a values row like a legend row"; UI check (screenshot while dragging and after)

#### Scenario: Row onto "+ New window"
- **WHEN** the user drags a values row onto "+ New window" while timeseries window 1 exists and was zoomed last
- **THEN** a new timeseries window "Window <n>" with window 1's range shows the signal, and the values row is gone
- **Evidence:** `packages/shared/test/apply.test.ts` › "moves a signal from a values window into a new timeseries window"; UI check (screenshot)

### Requirement: Value at cursor A
Each row SHALL show its signal's value at cursor A. The value is evaluated from the signal's raw points around A by the series-query "Value at a time" in the window's "Between points" mode: "linear" or "hold", default "linear". The value SHALL NOT depend on any timeseries window's zoom. While A is off, the rows SHALL show `—` and the header "Cursor A off". Origin: D-023; concept §6 (line → linear, step → hold); D-024 (raw values from the server); texts: D-026.

#### Scenario: Raw point under the cursor
- **WHEN** the values window lists `ICL_3A2h.SPEED_DISP`, `BRK_1A0h.WSPD_FL` and `DCU_2B8h.HTR_HV_Volt`, and `cursor.set {cursor: "a", t: "2026-10-13T13:08:00.093Z"}` is posted
- **THEN** within 1 s the rows read `23.0 km/h` (SPEED_DISP, raw), `180 1/min lin` (WSPD_FL) and `363 V lin` (HTR_HV_Volt), and the header reads `A 2026-10-13 15:08:00.093`
- **Evidence:** UI check (screenshot); `curl -s 'localhost:7310/api/value?signal=smart451/ICL_3A2h.SPEED_DISP&t=2026-10-13T13:08:00.093Z' | jq -c .value` prints `{"kind":"raw","value":23}`

#### Scenario: Between points, linear and hold
- **WHEN** A is set to `2026-10-13T13:08:00.1435Z`, first with "Between points: linear", then with "hold"
- **THEN** SPEED_DISP reads `22.5 km/h lin`, then `23.0 km/h hold`
- **Evidence:** UI check (two screenshots); `curl -s 'localhost:7310/api/value?signal=smart451/ICL_3A2h.SPEED_DISP&t=2026-10-13T13:08:00.1435Z&mode=step' | jq -c .value` prints `{"kind":"held","value":23}`

#### Scenario: Independent of zoom
- **WHEN** A stays at 13:08:00.1435Z and the user zooms the timeseries windows from 3 s to 2 days
- **THEN** the values window still reads `22.5 km/h lin` for SPEED_DISP
- **Evidence:** UI check (screenshot after the zoom)

#### Scenario: Cursor A off
- **WHEN** the user unchecks "A" in the option bar
- **THEN** every row shows `—` and the header reads "Cursor A off"
- **Evidence:** UI check (screenshot)

### Requirement: Value kinds are marked
A raw value (a point exactly at the cursor) SHALL be shown plain, an interpolated value with the tag `lin`, and a held value with the tag `hold`. The tooltip of a value SHALL name the neighbour points it came from (local time and value). Origin: concept §6 („Rohwerte, interpolierte Werte und verdichtete Werte sollen erkennbar bleiben"); aggregated values do not occur in this window (design C4).

#### Scenario: Three kinds
- **WHEN** the window shows the values of the scenario "Raw point under the cursor"
- **THEN** SPEED_DISP shows no tag, WSPD_FL and HTR_HV_Volt show `lin`, and WSPD_FL's tooltip names 15:08:00.083 → 179.5 and 15:08:00.103 → 180
- **Evidence:** `apps/web/test/values.test.ts` › "formats raw, interpolated and held values with their tags"; UI check (screenshot with the tooltip)

### Requirement: SNA and missing values at a cursor
A value that is SNA at the cursor SHALL be shown as `SNA` in the SNA style, never as a number. A value inside a gap SHALL be shown as `no data` in the muted style with the gap as tooltip: the logger recorded nothing (`logger_gap`), or more than 3 periods without a point (`period_gap`). Where no other value can be evaluated without inventing one, `—` SHALL be shown with the reason as tooltip: before the first point, after the last point, or (in "linear") the next point is SNA. Origin: D-010 (SNA never shown as valid), D-016 (null = SNA); concept §5 („Ohne verfügbare Messgrundlage darf kein Wert erfunden werden"); `no data`: D-062.

#### Scenario: SNA run
- **WHEN** the window lists SPEED_DISP and A is set to `2026-10-13T09:57:00Z` (between the SNA points at 09:56:59.937 and 09:57:00.037 UTC)
- **THEN** the row reads `SNA` in both modes, and no number appears
- **Evidence:** UI check (screenshot); `curl -s 'localhost:7310/api/value?signal=smart451/ICL_3A2h.SPEED_DISP&t=2026-10-13T09:57:00Z' | jq -c .value` prints `{"kind":"sna"}`

#### Scenario: Next point is SNA
- **WHEN** A is set to `2026-10-13T09:56:59.787Z` (between the valid 0 at 09:56:59.737 and the SNA point at 09:56:59.837)
- **THEN** the row reads `—` with tooltip "next point is SNA" in "linear", and `0 km/h hold` in "hold"
- **Evidence:** UI check (two screenshots); `curl -s 'localhost:7310/api/value?signal=smart451/ICL_3A2h.SPEED_DISP&t=2026-10-13T09:56:59.787Z' | jq -c .value` prints `{"kind":"none","reason":"next_sna"}`

#### Scenario: Before the first point
- **WHEN** A is set to `2026-10-11T12:00:00Z`, before SPEED_DISP's first point (12:34:24.824Z)
- **THEN** the row reads `—` with tooltip "before the first point"
- **Evidence:** UI check (screenshot); `apps/web/test/values.test.ts` › "formats SNA and missing values without a number"

#### Scenario: Inside gaps
- **WHEN** the window lists `DCU_2B8h.HTR_HV_Volt` and `STR_0D4h.STEER_ANGLE`, A is set to `2026-10-13T09:27:55Z` (logger gap 09:27:53.936–09:27:56.982), in "linear" and in "hold"; then to `2026-10-13T09:34:36.6Z` (STEER_ANGLE dropout)
- **THEN** both rows read `no data` in both modes with tooltip "no data: the logger recorded nothing"; then both rows read `no data` with tooltip "no data: more than 3 periods without a point" in both modes (HTR_HV_Volt, 100 ms, has nothing from 09:34:36.162 to 09:34:37.051)
- **Evidence:** UI check (screenshots); `apps/web/test/values.test.ts` › "formats gaps as no data"

### Requirement: Diff columns
While B is on or diff mode is on, each row SHALL show the value at B next to A's, and the header B's time; diff mode adds Δ = B−A to each row and Δt = B−A, with sign, to the header. Δ SHALL be computed only when both values are numbers, else it SHALL show `—`. Δ SHALL carry the tag `lin` if either value is interpolated, else `hold` if either is held. While B is off, B and Δ SHALL show `—`. Origin: D-023; concept §6 (Δt and ΔWert, B−A); texts: D-026; B without Diff: D-031.

#### Scenario: Speed difference
- **WHEN** diff mode is on, A is at 2026-10-13T13:08:00.093Z and B at 13:08:00.995Z
- **THEN** SPEED_DISP reads A `23.0 km/h`, B `18.0 km/h`, Δ `-5.00 km/h`; HTR_HV_Volt reads Δ `500 mV lin`; the header shows `Δt +902 ms`
- **Evidence:** UI check (screenshot); `apps/web/test/values.test.ts` › "computes Δ only from numeric values and tags it by the weaker kind", "formats Δt exactly with sign"

#### Scenario: SNA at one cursor
- **WHEN** diff mode is on, A is at 2026-10-13T09:57:00Z (SPEED_DISP SNA) and B at 09:57:00.5Z (SPEED_DISP valid 0)
- **THEN** SPEED_DISP reads A `SNA`, B `0 km/h lin` (between two valid zeros), Δ `—`
- **Evidence:** UI check (screenshot); `apps/web/test/values.test.ts` › "computes Δ only from numeric values and tags it by the weaker kind"

#### Scenario: B off
- **WHEN** diff mode is on and B is off
- **THEN** the B and Δ columns show `—` and the header shows `B off`
- **Evidence:** UI check (screenshot)

#### Scenario: B without Diff
- **WHEN** diff mode is off, A is at 2026-10-13T13:08:00.093Z and B at 13:08:04.5Z
- **THEN** each row shows A and B but no Δ, and the header shows A's and B's times but no Δt
- **Evidence:** UI check (screenshot); `apps/web/test/values.test.ts` › "shows B without Diff but no Δt, and the off states", "requests B whenever B is on, with or without Diff"

### Requirement: Value formats
Values and Δ SHALL be printed by number-format with the workspace's digits option, each followed by its unit with SI prefix. The tooltip naming the neighbour points SHALL keep the exact stored values (at most 9 significant digits, trailing zeros dropped). Origin: D-026 (3 significant digits, SI prefix, option 4); exact tooltips: design N9 (Jan's call Q7); 9 digits: data fact (scenario "Float noise").

#### Scenario: Float noise
- **WHEN** a value of `DCU_2B8h.HTR_HV_Volt` is 362.40000000000003 (as stored in the data) and a Δ is 0.5000000000000568, with 3 and then 4 digits
- **THEN** they are printed `362 V` and `500 mV`, then `362.4 V` and `500.0 mV`; the neighbour tooltip shows `362.4`
- **Evidence:** `apps/web/test/values.test.ts` › "formats values with the digits option and the unit"; `packages/shared/test/cursor.test.ts` › "formats cursor numbers with at most 9 significant digits"

### Requirement: Time formats
Cursor times SHALL be shown in local time as `YYYY-MM-DD HH:MM:SS`, with the fraction down to nanoseconds and trailing zero groups of three dropped. Δt SHALL be exact, with sign, in ns, µs, ms or s below one minute, else as `h:mm:ss` with fraction. Origin: D-026; exact times: design N9 (Jan's call Q7).

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
- **WHEN** a caller posts `cursor.set` for A while the values window lists SPEED_DISP, and then reads `curl -s localhost:7310/api/render-status`
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
While the value for a cell's current cursor time and mode is loading, the cell SHALL show a state distinct from `—` (the form is free), with the tooltip "loading"; `—` SHALL mean only "no value". Whenever B is on, the B cells SHALL be requested and filled like the A cells (D-031). Origin: power-user bug (feedback 2026-10-15, item 3: `—` for 1–3 s read as "no data"; B once stayed `—` with data).

#### Scenario: Cursor moved from the CLI
- **WHEN** the values window lists SPEED_DISP and a caller posts `cursor.move {cursor: "a", by: "100000000"}`
- **THEN** until the new value arrives the cell shows the loading state with tooltip "loading", never `—`, and then the value
- **Evidence:** `apps/web/test/values.test.ts` › "shows a loading state distinct from no value"; UI check (screenshot right after the command)

#### Scenario: B always fills
- **WHEN** diff mode is on and B is set five times with `cursor.set` to times where SPEED_DISP has data (2026-10-13T13:08:00.1Z … 13:08:00.5Z)
- **THEN** after each command the B cell shows a number, never `—`
- **Evidence:** `apps/web/test/values.test.ts` › "requests B whenever B is on, with or without Diff"; UI check (screenshot after the last command)

### Requirement: L column in the values window
The values table SHALL have a column `L` after A | B | Δ. Once L has stayed at one time for 150 ms, each row SHALL show its signal's exact value at L, evaluated and printed like the A cell. While L moves, the cells SHALL keep their last L values, dimmed; while L is not set, they SHALL be empty. Origin: D-032 („The values window also gets an L column"); exact values: D-024, D-029; rest delay: necessary consequence of a time that changes at frame rate (design L7, Q1).

#### Scenario: Live values in the values window
- **WHEN** a values window ("Between points: linear") lists `ICL_3A2h.SPEED_DISP`, `BRK_1A0h.WSPD_FL` and `DCU_2B8h.HTR_HV_Volt`, and the pointer rests on a timeseries window at 2026-10-13T13:08:00.093Z
- **THEN** within 1 s the `L` column reads `23.0 km/h`, `180 1/min lin` and `363 V lin`, the same as the A cells after a click there without moving
- **Evidence:** UI check (screenshot after the click)

#### Scenario: L visible in a normal-width window
- **WHEN** the values window of "Live values in the values window" is 485 px wide (its width in round 1, where the 621 px table cut L off) and L is set
- **THEN** the `L` header and all three L cells are fully visible without scrolling the table sideways
- **Evidence:** UI check (screenshot at 485 px)

#### Scenario: Requests only at rest
- **WHEN** L changes every 50 ms for 1 s for a values window with three rows, then stays
- **THEN** no value request is sent while it changes, the cells keep their previous values dimmed, and 150 ms after the last change exactly three requests are sent, keyed apart from the A and B requests
- **Evidence:** `apps/web/test/values.test.ts` › "requests L values only after the pointer rests, apart from A and B"

#### Scenario: No hover
- **WHEN** the pointer is outside every plot
- **THEN** the `L` column header is shown and every L cell is empty
- **Evidence:** UI check (screenshot)

### Requirement: L lookups outside the render acknowledgement
L lookups SHALL neither delay a values window's render acknowledgement nor report an error in it; a failed L lookup SHALL show `—` with the message in its cell. Origin: necessary consequence: L is not workspace state (D-032 „no command, no revision").

#### Scenario: Out of the acknowledgement
- **WHEN** a cursor command is accepted while the L lookup for one row fails (the server answers 502)
- **THEN** that row's L cell reads `—` with the message, its A cell its value, and the revision is reported `complete` without an error for that row
- **Evidence:** `apps/web/test/values.test.ts` › "keeps L requests out of the render acknowledgement"
