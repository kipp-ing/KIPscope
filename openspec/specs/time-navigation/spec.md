# time-navigation Specification

## Purpose
Lets the user reach a point in time without repeated zooming: type a time or range, pick a span, or use keys to zoom, pan and jump to the data extent. Every navigation is an ordinary range change of the target window(s) and can be undone with "Back".

Conventions for the evidence below: real smart451 data, Europe/Berlin (CEST, UTC+2 on 2026-10-13). `ICL_3A2h.SPEED_DISP` has data from 2026-10-11T12:34:24.824Z to 2026-10-13T13:17:33.220Z; its extent view is 2026-10-11 14:34:24.824 – 2026-10-13 15:17:33.221 local.

## Requirements

### Requirement: Go to field
The option bar SHALL have a "Go to" field. Enter SHALL resolve its text against the bar target's current range ("Navigation targets") and set the resulting range with one command; the field keeps the text, selected. Origin: D-027 („type a time or range").

#### Scenario: Minute from the extent view
- **WHEN** one window shows `ICL_3A2h.SPEED_DISP` at its extent view and the user types `15:08` into "Go to" and presses Enter
- **THEN** the header reads `2026-10-13 15:08:00 – 2026-10-13 15:09:00` and the revision rose by exactly one
- **Evidence:** UI check (screenshot of header and revision); `packages/shared/test/timenav.test.ts` › "takes the latest occurrence of a time of day inside the view"

### Requirement: Input forms
The field SHALL accept, in local time unless the text carries `Z` or an offset: an instant alone (a date shows that day, a time the period its last digit names, `a` or `b` centres the current span on that cursor); `INSTANT +DUR`, `INSTANT -DUR`, `INSTANT ±DUR`; `INSTANT .. INSTANT` or `INSTANT – INSTANT`; `DUR` alone (span around the anchor); `+DUR` or `-DUR` alone (pan). Durations are the CLI's plus `d`. Origin: D-027; forms from the testers (feedback 2026-10-15 item 1); add-cli "Durations".

#### Scenario: Range forms
- **WHEN** the view is 2026-10-13 15:08:00 – 15:09:00 local, A is at 15:08:00.093 and B at 15:08:00.995, and the texts `15:07:15 +60s`, `15:08 ±30s`, `15:07 .. 15:09`, `a..b`, `2026-10-13`, `1h` and `+10min` are resolved one at a time against that view
- **THEN** they give 15:07:15–15:08:15, 15:07:30–15:08:30, 15:07:00–15:09:00, 15:08:00.093–15:08:00.995, 2026-10-13 00:00 – 2026-10-14 00:00, 14:38:00.093–15:38:00.093 (`1h` centres on A, which lies in the view) and 15:18:00–15:19:00
- **Evidence:** `packages/shared/test/timenav.test.ts` › "resolves every input form"

#### Scenario: Header text pasted back
- **WHEN** the user copies a header range such as `2026-10-13 15:08:00 – 2026-10-13 15:08:03` into "Go to" and presses Enter
- **THEN** the window shows exactly that range
- **Evidence:** `packages/shared/test/timenav.test.ts` › "accepts the header's own range text"

### Requirement: Time of day without date
A time of day without date SHALL take the date of its latest occurrence inside the target's current range, else of its occurrence nearest the range's centre; in a range of two times of day the end is the first occurrence after the start. Origin: necessary consequence of typing `15:08` into a multi-day view (data fact: the smart451 extent spans three local dates); rule in design N2, Jan's call Q2.

#### Scenario: Date of a time of day
- **WHEN** `15:08` is resolved against the SPEED_DISP extent view, against 2026-10-12 10:00 – 11:00, and `23:00 .. 01:00` against 2026-10-12 20:00 – 21:00
- **THEN** the first gives 2026-10-13 15:08, the second 2026-10-12 15:08 (nearest the centre), the third 2026-10-12 23:00 – 2026-10-13 01:00
- **Evidence:** `packages/shared/test/timenav.test.ts` › "takes the latest occurrence of a time of day inside the view"

### Requirement: Invalid input changes nothing
Text that does not parse, a nonexistent or ambiguous local time, an empty or reversed range, a span below 100 ns, or an anchor whose cursor is off SHALL send no command; the field SHALL be marked invalid with the reason in the message area. A range beyond 1900 … 2262 SHALL be clamped into the bounds. Origin: D-021 (bounds); timeseries-window "Minimum zoom span"; add-cli "Time arguments" (DST refused, not guessed; concept §8).

#### Scenario: Bad inputs
- **WHEN** the user enters `25:00`, `2026-10-13 15:09 .. 2026-10-13 15:08`, `2026-10-25 02:30` and `a` (with A off) one after another
- **THEN** each marks the field invalid with a reason (invalid time, reversed range, ambiguous local time naming `+02:00 or +01:00`, cursor A is off), and the revision does not change
- **Evidence:** `packages/shared/test/timenav.test.ts` › "refuses invalid, reversed, ambiguous and cursor-off input"; UI check (screenshot with the message, revision before and after)

### Requirement: Span presets
The option bar SHALL offer the spans 1 s, 10 s, 1 min, 10 min, 1 h and 1 day. Choosing one SHALL set the target's span to it around the navigation anchor, as typing that duration would. Origin: D-027 („presets"); the testers' „1 h, 1 day" (feedback 2026-10-15 item 1, T3).

#### Scenario: One day around the view
- **WHEN** the view is 2026-10-13 15:08:00 – 15:09:00 local, A is off, and the user picks "1 day"
- **THEN** the header reads `2026-10-13 03:08:30 – 2026-10-14 03:08:30` (one day centred on the view centre 15:08:30, design S2)
- **Evidence:** UI check (screenshot of the header); `packages/shared/test/timenav.test.ts` › "resolves every input form" (the `1d` case)

### Requirement: Navigation anchor
The navigation anchor is cursor A if it lies inside the target's range, else the range's centre. Zoom keys SHALL keep the anchor at its place in the plot; span presets and a bare duration SHALL centre the new span on it. Origin: necessary consequence of D-027's zoom keys and the cursor workflow (concept §6: zooming into the spot the user marked); the wheel already zooms around the pointer.

#### Scenario: Zoom in around A
- **WHEN** the view is 2026-10-13T13:08:00Z–13:08:04Z, A is at 13:08:01Z and the user presses `+`
- **THEN** the view becomes 13:08:00.5Z–13:08:02.5Z (A stays a quarter into the plot)
- **Evidence:** `packages/shared/test/timenav.test.ts` › "zooms around the anchor and pans by fractions of the span"

### Requirement: Navigation keys
Outside text fields and selects, without Ctrl, Meta or Alt and while no drag runs, `+` or `=` SHALL halve the key target's span, `-` double it, `←`/`→` pan by half the span, Shift+`←`/`→` by the whole span, `Home` do what "Reset" does for that target, and `t` focus and select "Go to". Origin: D-027 („zoom/pan keys, jump to the data extent"); the keyboard tester's +/−, ←/→ (feedback 2026-10-15 item 1); text-field rule as for Backspace (D-020).

#### Scenario: Keys on a 4 s view
- **WHEN** the view is 2026-10-13T13:08:00Z–13:08:04Z, A is off, and the user presses `+`, then `-`, then `→`, then Shift+`←`
- **THEN** the view is 13:08:01–13:08:03, then 13:08:00–13:08:04, then 13:08:02–13:08:06, then 13:07:58–13:08:02 (UTC), each with one command
- **Evidence:** `packages/shared/test/timenav.test.ts` › "zooms around the anchor and pans by fractions of the span"; `apps/web/test/keys.test.ts` › "maps navigation keys outside text fields"; UI check (header after each key)

#### Scenario: Home
- **WHEN** a SPEED_DISP window is zoomed to 13:08:00Z–13:08:04Z and the user presses `Home` with the pointer over it
- **THEN** the header reads the extent `2026-10-11 14:34:24.824 – 2026-10-13 15:17:33.221`
- **Evidence:** UI check (screenshot of the header)

#### Scenario: Keys in a text field
- **WHEN** the explorer search has focus and the user types `+`, `-` and `t`, and presses `←` and `Home`
- **THEN** only the search text and its caret change; no range changes and the revision is unchanged
- **Evidence:** `apps/web/test/keys.test.ts` › "maps navigation keys outside text fields"; UI check (revision before and after)

#### Scenario: Focus the field
- **WHEN** no text field has focus and the user presses `t`, types `15:08` and Enter
- **THEN** the field had focus with its old text selected, and the view goes to 15:08 as in "Minute from the extent view"
- **Evidence:** UI check (screenshot after `t`, header after Enter)

### Requirement: Navigation targets
"Go to" and the presets SHALL act on the bar target (the window zoomed last, else the first timeseries window); the keys on the timeseries window under the pointer, else the bar target. While linked, all windows follow (`window.setRange`); while unlinked only the target changes, and the field's tooltip names it. Origin: D-024 (the bar acts on the window zoomed last, named in the tooltip); D-021 (linked ranges); key target as for Backspace.

#### Scenario: Unlinked go to
- **WHEN** "Link time axes" is off, window 2 was zoomed last, and the user enters `15:08`
- **THEN** the field's tooltip named "Window 2", window 2 shows 15:08:00–15:09:00 and window 1 keeps its range
- **Evidence:** UI check (screenshot of both headers and the tooltip)

#### Scenario: Linked keys
- **WHEN** "Link time axes" is on, two windows exist and the user presses `-` with the pointer over window 1
- **THEN** both windows show the doubled span, sent as one `window.setRange` (one revision)
- **Evidence:** UI check (both headers, revision before and after)

### Requirement: Navigation in the zoom history
Each "Go to", preset and key step SHALL push the range shown before it to the target's zoom history, so "Back" and Backspace return to it. Steps of a held key SHALL join the entry of the press that started them and come at most every 100 ms. Each step SHALL start from the previous step's range, even before the server confirmed it. Origin: D-025 (one "Back"); timeseries-window "Zoom history"; rate in design N6.

#### Scenario: Back through typed and key steps
- **WHEN** a SPEED_DISP window at its extent view gets `15:08` entered, then `+` pressed twice quickly, then Backspace three times
- **THEN** after the presses the span is 15 s (15:08:22.5–15:08:37.5), and the three Backspaces show 15:08:15–15:08:45, then 15:08:00–15:09:00, then the extent
- **Evidence:** UI check (header after each step); `apps/web/test/keys.test.ts` › "joins auto-repeat steps to one history entry"

#### Scenario: Held key
- **WHEN** the user holds `-` for about one second on a 4 s view, then clicks "Back"
- **THEN** the span grew by at most 2^11 (at most 10 repeat steps plus the first), and "Back" returns to the 4 s view in one step
- **Evidence:** UI check (header before, after the hold and after Back)

### Requirement: Navigation stops at the scope edge
While the workspace has a scope, every navigation (keys, wheel, "Go to", presets, Home, Back, strip actions, drive keys) SHALL end inside it through the server's clamp, and none SHALL change the scope. When a result carries `clamped`, the message line SHALL show `Stopped at the scope edge. Widen shows more.` Origin: D-078 („navigation stops there, widening it is an explicit step"); issue #1 item 4.

#### Scenario: Message on a clamped result
- **WHEN** the UI's command handler gets `{ok: true, revision: 9, clamped: true}` for a `window.setRange`, and then `{ok: true, revision: 10}`
- **THEN** the first sets the message `Stopped at the scope edge. Widen shows more.`, and the second sets none
- **Evidence:** `apps/web/test/zoom.test.ts` › "reports a range stopped at the scope edge"

#### Scenario: Zoom out and pan on smart451
- **WHEN** a smart451 window shows 14:50 – 15:10 local inside a scope of 14:00 – 16:00, and the user presses `-` three times, then Shift+`→` twice, then types `2026-10-12` into "Go to"
- **THEN** the header shows 14:40 – 15:20, 14:20 – 15:40, then 14:00 – 16:00 with the message; the pans leave it at 14:00 – 16:00 (span kept, at the edge); "Go to" also gives 14:00 – 16:00 with the message; the scope in the strip head is unchanged throughout
- **Evidence:** UI check on smart451 (header and message after each step)

### Requirement: Windows load again on a scope change
When the workspace's scope key changes (Widen, Clear, open, `scope set`), every window SHALL request its data again, failed, loading and complete keys alike, SHALL keep what it shows until the new answer arrives, and SHALL drop a late answer of the old request. Origin: necessary consequence of scope "Routes are bounded by the scope" (data cut to the old scope, or a 409 `out_of_scope` under it, is wrong under the new one); finding of round 2 (windows did not re-query after Widen/Clear).

#### Scenario: Windows recover after Widen, Clear or open
- **WHEN** a series loader holds one key that failed (server down) and one complete key, and the scope changes, and both new requests answer
- **THEN** both keys are fetched again (4 calls in all), both end `complete` without an error, and the loader is settled; in the UI on smart451 a window that showed an error or the old scope's data shows the new scope's data after Widen and after Clear, without a reload
- **Evidence:** `apps/web/test/rescope.test.ts` › "windows recover after Widen, Clear or open"; UI check on smart451 (window after Widen and after Clear)
