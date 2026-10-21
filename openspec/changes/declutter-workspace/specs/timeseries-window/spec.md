## MODIFIED Requirements

### Requirement: Option bar
Above the windows, an option bar SHALL stay visible while the window list scrolls. After the sidebar button it SHALL hold, in this order: "Views" (with the open view's title and the Read-only pill, `saved-views`); a separator; the range control (time-navigation; its content is owned by `add-range-picker`); "Back" and "Reset" as 26 × 26 px icon buttons (`aria-label` `Back` and `Reset`, tooltips naming `Backspace` and `Home`); the "Link time axes" icon toggle ("Link toggle"); a separator; the cursor pills "A", "B" and "Diff" (cursors spec); then, at the row's end and at every width, "Share…", the "⋯" menu and "?" (`guidance` "Help panel"). Digits (number-format) and "+ Values window" SHALL always be items of the "⋯" menu, never in the row (`saved-views` "Top-row overflow menu"). Origin: D-023 (cursor toggles, diff mode, "Link time axes", zoom back and reset in a bar); D-025 (one "Back", one "Reset"); D-027 (time navigation); D-026 (digits option); order, icons and the "⋯" items: D-092 (7) (supersedes D-071's width rule for Digits and "+ Values window") and mock `Main.dc.html`; Share in the row at every width: D-095 (critic 15, supersedes the compact-width move of D-092's mock).

#### Scenario: Scrolled down
- **WHEN** six windows exist and the list is scrolled to the end
- **THEN** the option bar is fully visible above the windows with its controls in that order
- **Evidence:** UI check (screenshot)

#### Scenario: Order in the row
- **WHEN** the option bar is rendered to static markup for a workspace with a timeseries window, its overflow menu closed
- **THEN** the controls appear in the order `Views`, the `range-control` element, `Back`, `Reset`, `Link time axes`, `A`, `B`, `Diff`, `Share…`, `More`; `Back` and `Reset` hold no visible text; no `Digits` select and no `+ Values` button is in the row
- **Evidence:** `apps/web/test/bar.test.ts` › "renders the top row in order"

### Requirement: Link toggle
The option bar SHALL show "Link time axes" as a 26 × 26 px icon toggle (a link icon, `aria-label` `Link time axes`, `aria-pressed` the workspace's link flag, the pressed style of design-language "Cursor toggles as pills" while on) directly after "Reset", with a tooltip saying whether it is on; it SHALL reflect and set the workspace's link flag, on by default, and the top bar SHALL no longer show it. Switching it on SHALL show all windows at the range of the window zoomed last. Origin: D-017 ("on by default and can be switched off"); D-023 (the toggle moves out of the top bar into the option bar); icon next to the range control: D-092 (mock `Main.dc.html`, the designer's top-row inventory).

#### Scenario: Default on
- **WHEN** the app is opened after a server restart
- **THEN** the "Link time axes" toggle has `aria-pressed="true"` in the option bar, shows no text, and the top bar shows no such toggle
- **Evidence:** Jan's hand check after a server restart (screenshot of the option bar); `packages/shared/test/apply.test.ts` › "applies a range to all windows while linked" (asserts `linkTime` is `true` on a fresh workspace)

#### Scenario: Re-link
- **WHEN** both windows show different ranges, window 2 was zoomed last, and the user clicks "Link time axes" so that it is pressed
- **THEN** both windows show window 2's range
- **Evidence:** UI check (screenshot); `packages/shared/test/apply.test.ts` › "snaps all windows to the last zoomed window when linking"

### Requirement: One y-axis per unit
Signals with the same unit SHALL share one y scale and axis; each unit SHALL have its own. A signal without unit SHALL have its own scale, titled with its name. The axis title SHALL be the unit in slate-700 (`#334155`), preceded by an 8 × 2 px swatch in the signal's colour when it is the only signal on that axis. Origin: D-018 ("'Same value range' means **same unit**: one y-axis per unit, nothing more."); D-017 („gleiche signalbereich gleiche achse“); the series' colour on the axis: power-user expectations (feedback 2026-10-14, point 2); swatch instead of coloured text: D-095 (critic 11: tick labels in series colours fail contrast, `#E69F00` 2.2:1).

#### Scenario: Two signals, same unit
- **WHEN** a window shows `DCU_1F4h.COMP_HV_Volt` and `DCU_2B8h.HTR_HV_Volt` (both `V`)
- **THEN** one axis is drawn on the left titled `V` in `rgb(51, 65, 85)` with no swatch, and the `[V]` of both legend rows has the tooltip "y axis L"
- **Evidence:** UI check (screenshot, the title's computed colour); `apps/web/test/axes.test.ts` › "puts signals with the same unit on one axis"

### Requirement: Stacked axes
Every unit SHALL get a drawn y axis, stacked up to two per side in signal order: first unit inner left (`L`), second inner right (`R`), third outer left (`L2`), fourth outer right (`R2`); the plot narrows. Each legend row's `[unit]` SHALL name its axis side as tooltip (D-030: the side column is gone). Origin: D-019 ("stacked axes, up to two per side (at most four units), the plot area gets narrower. Every value stays readable."); legend sides from feedback 2026-10-14, point 2.

#### Scenario: Second unit
- **WHEN** `ICL_3A2h.SPEED_DISP` (`km/h`) is added to that window
- **THEN** a right axis titled `km/h` appears with a swatch in SPEED_DISP's colour, SPEED_DISP's `[km/h]` has the tooltip "y axis R", and the `V` axis stays left
- **Evidence:** UI check (screenshot); `apps/web/test/axes.test.ts` › "stacks axes L, R, L2, R2 in signal order", "colours an axis like its only signal"

#### Scenario: Third and fourth unit
- **WHEN** `ENG_5E0h.T_ENG` (`°C`) and then `BRK_1A0h.WSPD_FL` (`1/min`) are added as well
- **THEN** a `°C` axis appears outer left and a `1/min` axis outer right, each with its signal's swatch and readable tick labels, the plot is narrower, and their `[unit]` tooltips name `L2` and `R2`
- **Evidence:** UI check (screenshot); `apps/web/test/axes.test.ts` › "stacks axes L, R, L2, R2 in signal order"

#### Scenario: Unit-less signal and stable sides
- **WHEN** a window lists a signal without unit before a `V` signal, and only the `V` signal's data has loaded
- **THEN** the unit-less signal has its own scale titled with its name on the left and `V` is on the right, before and after the other data arrives
- **Evidence:** `apps/web/test/axes.test.ts` › "gives unit-less signals their own axis titled by name", "keeps sides stable before data loads"

### Requirement: Readable axis titles
Axis titles SHALL be horizontal text on their own line above their axis, showing the unit exactly as in the signal metadata, preceded by the axis' SI prefix when its ticks are scaled ("Axis tick numbers"), at least 8 px clear of the top tick label; tick labels and tick marks SHALL be slate-700 (`#334155`) on every axis, never the series colour, and SHALL NOT be cut. Origin: bug "°C garbled in the rotated axis title" (feedback 2026-10-14); prefix: D-026; dark ticks, own line, 8 px: D-095 (critic 11: coloured ticks fail contrast, unit labels overlapped the top tick).

#### Scenario: Degree sign
- **WHEN** a window shows only `CLIM_A1.T_SET`
- **THEN** the left axis title reads `°C` with T_SET's swatch, and the tick labels are fully visible
- **Evidence:** UI check (zoomed screenshot of the axis)

#### Scenario: Axis colours on smart451
- **WHEN** at 1440×900 a window shows `ICL_3A2h.SPEED_DISP` and `DCU_2B8h.HTR_HV_Volt` (two units, two axes)
- **THEN** each axis title row element has the colour `rgb(51, 65, 85)` and holds one swatch whose background is its signal's colour; the plot's top minus the title row's bottom is at least 8 px (`getBoundingClientRect()`); the canvas' tick labels are dark slate in a zoomed screenshot, not the series colours; the window's plot top minus its top stays ≤ 48 px (goal of `workspace-layout` "Header height")
- **Evidence:** UI check on smart451 at 1440×900 (computed colours, rects, zoomed screenshot); `apps/web/test/axes.test.ts` › "colours an axis like its only signal" (the swatch colour)

## ADDED Requirements

### Requirement: Missing signals read calm
A signal whose series request answers 404 `unknown_signal` (the shown vehicle lacks it, as after a step) SHALL read `missing` in its legend status as a muted pill, tooltip `Missing: <dataRef> has no signal <shown name>`, its readout cells `—` with that tooltip; it SHALL add no y axis or axis title and not be retried for the same view; its row stays. Other failures keep `failed: <message>`. Origin: D-092 (designer: red `failed: unknown_signal: …`); D-089 (missing signals stay).

#### Scenario: Status and axes
- **WHEN** the loader gets for a signal a fetch that fails with the API error built from a 404 answer `{error: {code: "unknown_signal", message: "unknown signal: othercar/X"}}`, outside and inside a case; and `layoutAxes` gets that signal marked missing beside `SIG_A` (unit `V`)
- **THEN** `loadStatusText` gives `missing` in both cases and the state is not retried; `layoutAxes` gives one axis (`V`) and no scale or side for the missing signal; a readout cell for a value request failing the same way reads `—` with the tooltip `Missing: othercar has no signal X`
- **Evidence:** `apps/web/test/loader.test.ts` › "reads an unknown signal as missing"; `apps/web/test/axes.test.ts` › "leaves missing signals out of the axes"; `apps/web/test/readout.test.ts` › "reads an unknown signal as missing"

#### Scenario: Step to a vehicle without the signal on smart451
- **WHEN** a catalog with one smart451 drive and one session of a second vehicle that lacks `ICL_3A2h.SPEED_DISP` (the UI user picks one from `/api/objects`, else `not_run`) is open, a window shows SPEED_DISP beside a signal both have, and the user presses `]`
- **THEN** the SPEED_DISP legend row reads `missing` in a grey pill with the tooltip `Missing: <vehicle> has no signal SPEED_DISP`, no axis title shows `failed` or `unknown_signal`, the other signal is drawn; `[` draws SPEED_DISP again
- **Evidence:** UI check (screenshot after `]` with the tooltip, after `[`)
