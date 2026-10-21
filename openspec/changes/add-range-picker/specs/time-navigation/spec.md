## MODIFIED Requirements

### Requirement: Go to field
The range picker (range-picker) SHALL have a typed field "Go to" at its top. Enter SHALL resolve its text against the bar target's current range ("Navigation targets"), set the resulting range with one command and close the picker; the field keeps the text for the next open. Origin: D-027 („type a time or range"); D-092 (1) (the field moves into the picker, typed input keeps working).

#### Scenario: Minute from the extent view
- **WHEN** one window shows `ICL_3A2h.SPEED_DISP` at its extent view and the user opens the picker, types `15:08` into "Go to" and presses Enter
- **THEN** the range button reads `Tue 2026-10-13 15:08:00 – 15:09:00`, the picker is closed and the revision rose by exactly one
- **Evidence:** UI check (screenshot of the button and the revision); `packages/shared/test/timenav.test.ts` › "takes the latest occurrence of a time of day inside the view"

### Requirement: Input forms
The field SHALL accept, in local time unless the text carries `Z` or an offset: an instant alone (a date shows that day, a time the period its last digit names, `a` or `b` centres the current span on that cursor); `INSTANT +DUR`, `INSTANT -DUR`, `INSTANT ±DUR`; `INSTANT .. INSTANT` or `INSTANT – INSTANT`; `DUR` alone (span around the anchor); `+DUR` or `-DUR` alone (pan). Durations are the CLI's plus `d`. Origin: D-027; testers (feedback 2026-10-15 item 1); add-cli "Durations".

#### Scenario: Range forms
- **WHEN** the view is 2026-10-13 15:08:00 – 15:09:00 local, A is at 15:08:00.093 and B at 15:08:00.995, and the texts `15:07:15 +60s`, `15:08 ±30s`, `15:07 .. 15:09`, `a..b`, `2026-10-13`, `1h` and `+10min` are resolved one at a time against that view
- **THEN** they give 15:07:15–15:08:15, 15:07:30–15:08:30, 15:07:00–15:09:00, 15:08:00.093–15:08:00.995, 2026-10-13 00:00 – 2026-10-14 00:00, 14:38:00.093–15:38:00.093 (`1h` centres on A, which lies in the view) and 15:18:00–15:19:00
- **Evidence:** `packages/shared/test/timenav.test.ts` › "resolves every input form"

#### Scenario: Header text pasted back
- **WHEN** the user types a range in the header form such as `2026-10-13 15:08:00 – 2026-10-13 15:08:03` into "Go to" and presses Enter
- **THEN** the window shows exactly that range
- **Evidence:** `packages/shared/test/timenav.test.ts` › "accepts the header's own range text"

### Requirement: Invalid input changes nothing
Text that does not parse, a nonexistent or ambiguous local time, an empty or reversed range, a span below 100 ns, or an anchor whose cursor is off SHALL send no command; the field SHALL be marked invalid with the reason in the picker's result line, and the picker stays open. A range beyond 1900 … 2262 SHALL be clamped into the bounds. Origin: D-021 (bounds); timeseries-window "Minimum zoom span"; add-cli "Time arguments" (DST refused, not guessed; concept §8).

#### Scenario: Bad inputs
- **WHEN** the user enters `25:00`, `2026-10-13 15:09 .. 2026-10-13 15:08`, `2026-10-25 02:30` and `a` (with A off) one after another into "Go to"
- **THEN** each marks the field invalid with a reason in the result line (invalid time, reversed range, ambiguous local time naming `+02:00 or +01:00`, cursor A is off), the picker stays open, and the revision does not change
- **Evidence:** `packages/shared/test/timenav.test.ts` › "refuses invalid, reversed, ambiguous and cursor-off input"; UI check (screenshot with the reason, revision before and after)

### Requirement: Navigation keys
Outside text fields and selects, without Ctrl, Meta or Alt, while no drag runs and while the range picker is closed, `+` or `=` SHALL halve the key target's span, `-` double it, `←`/`→` pan by half the span, Shift+`←`/`→` by the whole span, `Home` do what "Reset" does for that target, and `t` open the range picker with "Go to" focused and its text selected. Origin: D-027; keyboard tester (feedback 2026-10-15 item 1); text-field rule as for Backspace (D-020); picker: D-092 (1).

#### Scenario: Keys on a 4 s view
- **WHEN** the view is 2026-10-13T13:08:00Z–13:08:04Z, A is off, and the user presses `+`, then `-`, then `→`, then Shift+`←`
- **THEN** the view is 13:08:01–13:08:03, then 13:08:00–13:08:04, then 13:08:02–13:08:06, then 13:07:58–13:08:02 (UTC), each with one command
- **Evidence:** `packages/shared/test/timenav.test.ts` › "zooms around the anchor and pans by fractions of the span"; `apps/web/test/keys.test.ts` › "maps navigation keys outside text fields"; UI check (range button after each key)

#### Scenario: Home
- **WHEN** a SPEED_DISP window is zoomed to 13:08:00Z–13:08:04Z and the user presses `Home` with the pointer over it
- **THEN** the range shown is the extent 2026-10-11 14:34:24.824 – 2026-10-13 15:17:33.221 (range button `Sun 2026-10-11 14:34:24.824 – Tue 2026-10-13 15:17:33.221`)
- **Evidence:** UI check (screenshot of the range button)

#### Scenario: Keys in a text field
- **WHEN** the explorer search has focus and the user types `+`, `-` and `t`, and presses `←` and `Home`
- **THEN** only the search text and its caret change; no range changes, no picker opens and the revision is unchanged
- **Evidence:** `apps/web/test/keys.test.ts` › "maps navigation keys outside text fields"; UI check (revision before and after)

#### Scenario: Focus the field
- **WHEN** no text field has focus and the user presses `t`, types `15:08` and Enter
- **THEN** the picker opened with "Go to" focused and its old text selected, and the view goes to 15:08 as in "Minute from the extent view"
- **Evidence:** UI check (screenshot after `t`, range button after Enter)

### Requirement: Navigation targets
The range picker SHALL act on the bar target (the window zoomed last, else the first timeseries window); the keys on the timeseries window under the pointer, else the bar target. While linked, all windows follow (`window.setRange`); while unlinked only the target changes, and the range button's tooltip names it. Origin: D-024 (the bar acts on the window zoomed last, named in the tooltip); D-021 (linked ranges); key target as for Backspace; D-092 (1).

#### Scenario: Unlinked go to
- **WHEN** "Link time axes" is off, window 2 was zoomed last, and the user enters `15:08` into "Go to"
- **THEN** the range button's tooltip named "Window 2", window 2 shows 15:08:00–15:09:00 and window 1 keeps its range
- **Evidence:** UI check (screenshot of the range button with its tooltip and of both windows' own ranges)

#### Scenario: Linked keys
- **WHEN** "Link time axes" is on, two windows exist and the user presses `-` with the pointer over window 1
- **THEN** both windows show the doubled span, sent as one `window.setRange` (one revision)
- **Evidence:** UI check (range button, revision before and after)

### Requirement: Navigation in the zoom history
Each range picker apply ("Go", Enter in "Go to") and key step SHALL push the range shown before it to the target's zoom history, so "Back" and Backspace return to it. Steps of a held key SHALL join the entry of the press that started them and come at most every 100 ms. Each step SHALL start from the previous step's range, even before the server confirmed it. Origin: D-025 (one "Back"); timeseries-window "Zoom history"; rate in design N6 of `add-time-navigation`.

#### Scenario: Back through typed and key steps
- **WHEN** a SPEED_DISP window at its extent view gets `15:08` entered in "Go to", then `+` pressed twice quickly, then Backspace three times
- **THEN** after the presses the span is 15 s (15:08:22.5–15:08:37.5), and the three Backspaces show 15:08:15–15:08:45, then 15:08:00–15:09:00, then the extent
- **Evidence:** UI check (range button after each step); `apps/web/test/keys.test.ts` › "joins auto-repeat steps to one history entry"

#### Scenario: Held key
- **WHEN** the user holds `-` for about one second on a 4 s view, then clicks "Back"
- **THEN** the span grew by at most 2^11 (at most 10 repeat steps plus the first), and "Back" returns to the 4 s view in one step
- **Evidence:** UI check (range button before, after the hold and after Back)

### Requirement: Navigation stops at the scope edge
While the workspace has a scope, every navigation (keys, wheel, range picker, Home, Back, strip actions, drive keys) SHALL end inside it through the server's clamp, and none SHALL change the scope. When a result carries `clamped`, the message line SHALL show `Stopped at the scope edge. Widen shows more.`; with a linked catalog `Stopped at the session edge. Unlink shows the whole vehicle.`, and in an object scope `Stopped at the end of the vehicle's data.` Origin: D-078; issue #1 item 4; D-086.

#### Scenario: Message on a clamped result
- **WHEN** the UI's command handler gets `{ok: true, revision: 9, clamped: true}` for a `window.setRange`, and then `{ok: true, revision: 10}`
- **THEN** the first sets the message `Stopped at the scope edge. Widen shows more.`, and the second sets none
- **Evidence:** `apps/web/test/zoom.test.ts` › "reports a range stopped at the scope edge"

#### Scenario: Message in a case workspace
- **WHEN** the handler gets `{ok: true, revision: 9, clamped: true}` for a `window.setRange` in a workspace with a linked catalog, and again with the catalog unlinked
- **THEN** it shows `Stopped at the session edge. Unlink shows the whole vehicle.`, then `Stopped at the end of the vehicle's data.`
- **Evidence:** `apps/web/test/zoom.test.ts` › "reports a range stopped at the session edge"

#### Scenario: Zoom out and pan on smart451
- **WHEN** a smart451 window shows 14:50 – 15:10 local inside a scope of 14:00 – 16:00, and the user presses `-` three times, then Shift+`→` twice, then types `2026-10-12` into "Go to"
- **THEN** the range button shows 14:40 – 15:20, 14:20 – 15:40, then 14:00 – 16:00 with the message; the pans leave it at 14:00 – 16:00 (span kept, at the edge); "Go to" also gives 14:00 – 16:00 with the message; the scope is unchanged throughout (`kipscope scope show`)
- **Evidence:** UI check on smart451 (range button and message after each step, `kipscope scope show` before and after)

## REMOVED Requirements

### Requirement: Span presets
**Reason**: D-092 (2): „the Span select goes (typing `10min` and the zoom keys cover it)". The range picker replaces it.
**Migration**: type a duration (`1s`, `10s`, `1min`, `10min`, `1h`, `1d`) into "Go to" (`t`): it sets that span around the navigation anchor as the preset did; `+` and `-` halve and double the span.
