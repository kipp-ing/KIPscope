## MODIFIED Requirements

### Requirement: Option bar
Above the windows, an option bar SHALL stay visible while the window list scrolls. After the sidebar button it SHALL hold, in this order: "Views" (with the open view's title and the Read-only pill, `saved-views`); a separator; the range control (time-navigation; its content is owned by `add-range-picker`); "Back" and "Reset" as 26 × 26 px icon buttons (`aria-label` `Back` and `Reset`, tooltips naming `Backspace` and `Home`); the "Link time axes" icon toggle ("Link toggle"); a separator; the cursor pills "A", "B" and "Diff" (cursors spec); then, at the row's end, "Share…", the "⋯" menu and "?" (`guidance` "Help panel"). Digits (number-format) and "+ Values window" SHALL always be items of the "⋯" menu, never in the row (`saved-views` "Top-row overflow menu"). Origin: D-023 (cursor toggles, diff mode, "Link time axes", zoom back and reset in a bar); D-025 (one "Back", one "Reset"); D-027 (time navigation); D-026 (digits option); order, icons and the "⋯" items: D-092 (7) (supersedes D-071's width rule for Digits and "+ Values window") and mock `Main.dc.html`.

#### Scenario: Scrolled down
- **WHEN** six windows exist and the list is scrolled to the end
- **THEN** the option bar is fully visible above the windows with its controls in that order
- **Evidence:** UI check (screenshot)

#### Scenario: Order in the row
- **WHEN** the option bar is rendered to static markup for a workspace with a timeseries window, its overflow menu closed
- **THEN** the controls appear in the order `Views`, the `range-control` element, `Back`, `Reset`, `Link time axes`, `A`, `B`, `Diff`, `Share…`, `More`; `Back` and `Reset` hold no visible text; no `Digits` select and no `+ Values` button is in the row
- **Evidence:** `apps/web/test/bar.test.ts` › "renders the top row in order"

### Requirement: Link toggle
The option bar SHALL show "Link time axes" as a 26 × 26 px icon toggle (a link icon, `aria-label` `Link time axes`, `aria-pressed` the workspace's link flag, accent ink while on) directly after "Reset", with a tooltip saying whether it is on; it SHALL reflect and set the workspace's link flag, on by default, and the top bar SHALL no longer show it. Switching it on SHALL show all windows at the range of the window zoomed last. Origin: D-017 ("on by default and can be switched off"); D-023 (the toggle moves out of the top bar into the option bar); icon next to the range control: D-092 (mock `Main.dc.html`, the designer's top-row inventory).

#### Scenario: Default on
- **WHEN** the app is opened after a server restart
- **THEN** the "Link time axes" toggle has `aria-pressed="true"` in the option bar, shows no text, and the top bar shows no such toggle
- **Evidence:** Jan's hand check after a server restart (screenshot of the option bar); `packages/shared/test/apply.test.ts` › "applies a range to all windows while linked" (asserts `linkTime` is `true` on a fresh workspace)

#### Scenario: Re-link
- **WHEN** both windows show different ranges, window 2 was zoomed last, and the user clicks "Link time axes" so that it is pressed
- **THEN** both windows show window 2's range
- **Evidence:** UI check (screenshot); `packages/shared/test/apply.test.ts` › "snaps all windows to the last zoomed window when linking"

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
