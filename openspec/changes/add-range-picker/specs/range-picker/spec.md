# range-picker Specification

## Purpose

The range button in the top row and the picker it opens: the bar target's range in one readable line, a calendar of two months whose days show the data density and the drives, day and time selection, presets and the typed "Go to" field, all applied as one range command; plus the `/api/calendar` route that feeds the calendar.

Conventions for the evidence below: tests run with `TZ=Europe/Berlin` (CEST, UTC+2 until 2026-10-25 03:00 local, then CET, UTC+1). `drivecar` is the test DB vehicle of `add-strip-navigation` design S4 (rows on 2026-10-02 between 00:00Z and 06:00Z). M10 = the local month October 2026: `from` 2026-09-30T22:00:00Z, `to` 2026-10-31T23:00:00Z (31 d + 1 h).

## ADDED Requirements

### Requirement: Calendar density
`GET /api/calendar?dataRef&from&to` SHALL answer `CalendarDensity` (design R2): rows per hour from `from`, and the drives of `[from, to)` found by the rule of time-strip "Drives of a recording" on a 60 s grid. `from` and `to` are the asked ones, unchanged. Origin: D-092 („date pickers with underlayed data density"); grid and hours: design R3.

#### Scenario: One month of drivecar
- **WHEN** the server runs on the test DB without a scope and `GET /api/calendar?dataRef=drivecar&from=2026-09-30T22:00:00Z&to=2026-10-31T23:00:00Z` is sent
- **THEN** 200 with `from` `"1790805600000000000"`, `to` `"1793487600000000000"`, 745 `hours` summing to 233,161, `hours[26]` 360, `hours[27]` 177,360, `hours[28]` 3,360, `hours[29]` 51,360, `hours[30]` 360, `hours[31]` 360, `hours[32]` 1 and all others 0, no `scope`, and `drives` exactly `[{from "1790902800000000000", to "1790904600000000000", rows 177180}, {from "1790910000000000000", to "1790910600000000000", rows 51060}]` (on the 60 s grid the 90 s pause of the strip's third drive is one empty minute and merges)
- **Evidence:** `apps/server/test/calendar.http.test.ts` › "counts drivecar rows per hour and finds its drives on the minute grid"

### Requirement: Calendar request rules
`from` and `to` SHALL both be given, be multiples of 60 s, `to` after `from`, at most 32 days apart; else 400 `invalid_request`. A data ref the loaded catalog does not know SHALL answer 404 `unknown_data_ref`; a window without rows 200 with zero `hours`; a source failure 502 `source_error`. The route SHALL pass the access guard like `/api/density`. Origin: necessary consequence; 32 d: D-089 (work window ≤ 32 days); codes as `/api/density`.

#### Scenario: Errors
- **WHEN** `/api/calendar?dataRef=drivecar` is sent without `from`; with `from=2026-10-01T00:00:30Z&to=2026-10-02T00:00:00Z`; with `to` equal to `from`; with a span of 33 days; with `dataRef=nocar` after the catalog loaded; with `dataRef=testcar` over 2025-10-01 … 2025-10-02; and with the source unreachable
- **THEN** 400 `invalid_request` four times; 404 `unknown_data_ref`; 200 with 24 `hours` all 0 and `drives` `[]`; 502 `source_error`
- **Evidence:** `apps/server/test/calendar.http.test.ts` › "answers 400, 404, empty windows and 502"

### Requirement: Calendar bounded by window and scope
Every calendar computation SHALL run as exactly one `refBuckets` call on the 60 s grid with a source scope of `[from, to)`, cut to the workspace's scope if any, and no `refExtent`; when that cut is empty it SHALL answer zero `hours` and no drives without a source call. With a scope the answer SHALL carry `scope`; a data ref other than the scope's SHALL answer 409 `out_of_scope`. Origin: D-082 („every source query is bounded"); D-089 (queries bounded by what is shown).

#### Scenario: Scope on testcar
- **WHEN** a recording source is behind the test server, the scope is {testcar, 2026-10-01T01:00:00Z, 2026-10-01T02:00:00Z}, and `/api/calendar` is sent for `testcar` over M10, for `testcar` over the local month November 2026, and for `othercar` over M10
- **THEN** the first answers `scope` with those bounds, nonzero `hours` only at index 3 (equal to `SELECT count() FROM sdlog.signals WHERE vehicle = 'testcar' AND utc >= T1 AND utc < T2`), and the source got one `refBuckets` with width 60 s and scope {testcar, T1, T2}; the second answers 720 zero `hours` and `drives` `[]` with no source call; the third 409 `out_of_scope`
- **Evidence:** `apps/server/test/calendar.http.test.ts` › "cuts the window to the scope and skips an empty cut"

#### Scenario: Unlinked case
- **WHEN** a workspace is unlinked on `testcar` (object scope) and `/api/calendar?dataRef=testcar` is sent over M10, then over 33 days
- **THEN** the first answers 200 with `scope` equal to the object scope's bounds and every source call carried a scope inside M10; the second answers 400 `invalid_request`
- **Evidence:** `apps/server/test/objectScope.http.test.ts` › "answers the calendar of a month while unlinked"

#### Scenario: Scoped mode
- **WHEN** a scoped-mode server without a scope gets `/api/calendar?dataRef=testcar` over M10, then with scope {testcar, T1, T2} the same request
- **THEN** the first answers 409 `scope_required` with no source call; after the second every recorded adapter call is `ping` or carries scope {testcar, T1, T2}
- **Evidence:** `apps/server/test/scope.http.test.ts` › "bounds the calendar by the scope in scoped mode"

### Requirement: Calendar cached and classed
The server SHALL compute one calendar per scope (or data ref) and window at most once per catalog load: concurrent requests share one computation, a failed one is not cached, a catalog reload computes again, at most 12 windows are kept (least recently used dropped). Its query SHALL run in the class of the request that started it, raised by any joining request. Origin: necessary consequence of carserver's 2 GB RAM (D-007) and paging back and forth; classes: D-081.

#### Scenario: Cache
- **WHEN** a stub source counts its `refBuckets` calls, three calendar requests for `testcar` over M10 arrive at once, then one more, then the catalog is refreshed and one more arrives; separately the first computation fails and a second request follows; separately 13 different months are asked and then the first again
- **THEN** one call for the first four, one more after the refresh, one more after the failure, and the 14th request computes again
- **Evidence:** `apps/server/test/calendar.test.ts` › "computes once per window and catalog load, shares, drops failures and the least recent"

#### Scenario: Interactive class
- **WHEN** a stub source records the class of each call and a calendar request arrives over HTTP
- **THEN** its `refBuckets` call records `interactive`
- **Evidence:** `apps/server/test/calendar.test.ts` › "runs in the request's class"

### Requirement: Calendar cost
The calendar of one month SHALL be measured on carserver, first and second call, in full mode and in a session scope. Goals, measured and reported, not pass/fail: full mode first ≤ 10 s (the strip's first density took 9.2 s, D-055 Q4), session scope first ≤ 1 s, any second ≤ 0.1 s. A result over twice its goal goes to Jan with the fallbacks of design R3. Origin: D-055 Q4 (data fact 9.2 s); D-081.

#### Scenario: Cost on carserver
- **WHEN** the dev server runs against carserver without a scope and `curl -s -o /dev/null -w '%{time_total}\n' 'localhost:7310/api/calendar?dataRef=smart451&from=2026-09-30T22:00:00Z&to=2026-10-31T23:00:00Z'` runs twice, then the same twice in a workspace opened on one drive of `kipscope case drives smart451`
- **THEN** all four answer 200; the four times are reported against their goals
- **Evidence:** the commands (four times in the report)

### Requirement: Range button
The top row SHALL show, in the slot of the former "Go to" field, a 318 px button (name "Go to") with the bar target's range ("Range line") and its short duration (design R6). Text changes SHALL move nothing; the text truncates with the full range as tooltip. Origin: D-092 (1) („one range button replaces the Go to field"); D-092 („Layout never moves", tabular numbers, truncation with a tooltip); 318 px: mock `GoTo.dc.html`.

#### Scenario: Button text
- **WHEN** the bar target shows 2026-10-13 15:06:03 – 15:18:33 local
- **THEN** the button reads `Tue 2026-10-13`, `15:06:03 – 15:18:33` and `12.5 min`; its tooltip holds the full range text with its duration and `Go to: pick a range or type one · t`
- **Evidence:** `apps/web/test/rangeLine.test.ts` › "formats a range on one day"; UI check on smart451 (screenshot of the button)

#### Scenario: No reflow
- **WHEN** at 1440×900 and at 1000×557 the left x and width of the range button and of every other top-row control are read with the bar target at a 20 min range, after zooming to 2026-10-13T13:08:00.093Z – 13:08:00.995Z, after typing `2026-10-13 .. 2026-10-16`, and while a reload is pending
- **THEN** every value is the same in all four states (±0.5 px), the button is 318 px wide, and the cut text shows its full range as tooltip
- **Evidence:** UI check on smart451 (the x and width values per state and viewport, one screenshot each)

#### Scenario: No timeseries window
- **WHEN** the workspace holds only a values window, and before the first workspace state arrived
- **THEN** the button is disabled and reads `No time window`, then shows `…`, in the same box as when enabled; `t` opens nothing
- **Evidence:** `apps/web/test/rangeLine.test.ts` › "names the button state without a range"; UI check (screenshot, button rect equal to the enabled one)

### Requirement: Range line
A range SHALL read `<Www> <YYYY-MM-DD> <from> – <to>` in local time with seconds, cut milliseconds when needed, ⁺¹ for an end on the next date, `24:00:00` for an end at the next midnight, and the end's weekday and date two or more dates later; the duration long in the picker, short on the button (design R6). Origin: D-092 (4) („full end date, one day a small ⁺¹"); Jan („the result shall be date and to times"); `24:00:00`: Q-2.

#### Scenario: Range lines
- **WHEN** `rangeLine` gets 2026-10-13T13:06:03Z–13:18:33Z; 2026-10-20T21:30:00Z–23:52:43Z; 2026-10-12T22:00:00Z–2026-10-13T22:00:00Z; 2026-10-13T13:06:03Z–2026-10-15T13:18:33Z; 2026-10-13T13:08:00.093Z–13:08:00.995Z; 2026-10-13T09:12:00.999999999Z–09:13:00Z; 2026-10-24T22:00:00Z–2026-10-25T23:00:00Z
- **THEN** the texts are `Tue 2026-10-13 15:06:03 – 15:18:33` (`12 min 30 s`, `12.5 min`); `Tue 2026-10-20 23:30:00 – 01:52:43⁺¹` with `plusOne` (`2 h 22 min`); `Tue 2026-10-13 00:00:00 – 24:00:00` without `plusOne` (`1 d`); `Tue 2026-10-13 15:06:03 – Thu 2026-10-15 15:18:33` (`2 d`); `Tue 2026-10-13 15:08:00.093 – 15:08:00.995` (`902 ms`); `Tue 2026-10-13 11:12:00.999 – 11:13:00.000`; `Sun 2026-10-25 00:00:00 – 24:00:00` (`1 d 1 h`)
- **Evidence:** `apps/web/test/rangeLine.test.ts` › "formats a range on one day", "marks the next day, midnight and later days", "shows milliseconds cut"

### Requirement: Picker opens
A click on the range button or `t` SHALL open the picker under the button, focus its typed field with the last typed text selected, select the shown range (start and end day, From and To) and show the month of the range's start on the right and the month before on the left. The picker SHALL keep its size whatever it shows and lie inside the viewport. Origin: D-092 (mock `GoTo.dc.html`; „Layout never moves"); `t`: time-navigation "Navigation keys".

#### Scenario: Open on smart451
- **WHEN** the bar target shows 2026-10-13 15:06:03 – 15:18:33 local and the user presses `t`
- **THEN** the picker shows September 2026 and October 2026, days 13 marked as start and end, From `15:06:03`, To `15:18:33`, the typed field focused with its last text selected, and the result line `Tue 2026-10-13 15:06:03 – 15:18:33` with `12 min 30 s`
- **Evidence:** UI check on smart451 at 1440×900 (screenshot)

#### Scenario: Draft from a range
- **WHEN** `draftOf` gets 2026-10-12T22:00:00Z – 2026-10-13T22:00:00Z and 2026-10-20T21:30:00Z – 23:52:43Z
- **THEN** `{start "2026-10-13", end "2026-10-13", from "00:00:00", to "24:00:00"}` and `{start "2026-10-20", end "2026-10-21", from "23:30:00", to "01:52:43"}`
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "drafts the shown range"

#### Scenario: Fits and keeps its size
- **WHEN** the picker is opened at 1440×900 and at 1000×557 with the sidebar open, and paged from a month pair with 5 week rows to one with 6
- **THEN** its rect lies inside the viewport at both sizes, and its height and width are the same before and after paging (±0.5 px)
- **Evidence:** UI check on smart451 (picker rect per viewport and per month pair, one screenshot each)

### Requirement: Calendar months
The picker SHALL show two months side by side, each titled `<Month> <YYYY>`, with the weekday heads `Mo Tu We Th Fr Sa Su` and 6 week rows of day cells (days of other months left empty). ‹ and › SHALL page by one month; ‹ is disabled when no data lies before the left month, › when none lies after the right month (the strip's density). Origin: D-092 (11) („calendar weeks start on Monday, English day names"); two months, paging: mock `GoTo.dc.html`.

#### Scenario: October 2026
- **WHEN** `monthCells(2026, 10)` and `localMonth(2026, 10)` are computed
- **THEN** 42 cells, cells 0–2 and 34–41 empty, cell 3 `2026-10-01` (`Thu`) and cell 33 `2026-10-31`; the month is 2026-09-30T22:00:00Z – 2026-10-31T23:00:00Z
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "lays out a month Monday first"

#### Scenario: Paging bounds
- **WHEN** `canPage` gets a density with `first` 2026-10-11T12:34:24Z and `last` 2026-10-21T00:52:43Z and right month October 2026; then right month November 2026; then a density whose `first` lies in August 2026 with right month October
- **THEN** ‹ off and › off; ‹ on and › off; ‹ on and › off
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "pages only towards data"

### Requirement: Day density
Each day cell SHALL show its number and 12 bars of two local hours from local midnight (the last 1 h or 3 h on DST days), log-scaled over the shown months' largest bar, in the accent where a drive overlaps, none for 0 rows, and a tooltip with rows and drives (design R5). Origin: D-092 („date pickers with underlayed data density"); 12 two-hour bars, drives in the accent: mock `GoTo.dc.html`.

#### Scenario: Bars of a day
- **WHEN** `dayBars` gets the drivecar answer of "One month of drivecar" and the day 2026-10-02; and an answer of M10 with every hour 1 and the day 2026-10-25
- **THEN** counts `[0, 177720, 54720, 720, 1, 0, 0, 0, 0, 0, 0, 0]` with drive marks only on bars 1 and 2; and counts of 2 on bars 0–10 and 3 on bar 11
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "sums local two-hour bars and marks drives"

#### Scenario: Bar heights
- **WHEN** `dayBarHeight` gets counts 0, 1,000, 100, 10 and 1 with a largest bar of 1,000; and 1 with a largest of 10⁹
- **THEN** 0, 12, 9, 6, 3 and 2 (clamped)
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "scales bar heights by decades"

#### Scenario: Calendar on smart451
- **WHEN** the picker is opened on smart451 (no scope) showing September and October 2026
- **THEN** October 11 … 21 show bars, accent bars on the days with drives (e.g. 13 and 17), days without rows are muted and disabled, and a day's tooltip names its rows and drives
- **Evidence:** UI check on smart451 at 1440×900 (screenshot with one tooltip)

### Requirement: Day selection
A click on a day with data SHALL set start and end to that day and wait for the end; a second click on the same or a later day SHALL set the end; a click on an earlier day starts again. From and To keep their times. Days between start and end SHALL be shaded, start and end filled in the accent. Origin: D-092 (Jan: „date pickers"); keep times: mock `GoTo.dc.html`, design R7.

#### Scenario: Two clicks
- **WHEN** `pickDay` gets the draft of 2026-10-13 15:06:03 – 15:18:33 and `2026-10-15`, then `2026-10-17`, then `2026-10-16`, then `2026-10-14`
- **THEN** start and end 15, waiting for the end; 15 to 17; start and end 16, waiting; start and end 14, waiting (14 lies before the start); From `15:06:03` and To `15:18:33` throughout
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "picks a start and an end day"

### Requirement: Time fields
From and To SHALL show their day's weekday and date and take `hh:mm`, `hh:mm:ss` or `hh:mm:ss.fff` in local time; To also `24:00` or `24:00:00`, the next local midnight. A bad time, an end not after the start, or a nonexistent or ambiguous local time SHALL show its reason in the result line and disable Go. Enter in a field SHALL act as Go. Origin: Jan („the result shall be date and to times"); DST refused, not guessed: time-navigation "Invalid input changes nothing".

#### Scenario: Draft to range
- **WHEN** `draftRange` gets {13, 13, `15:06:03`, `15:18:33`}, {13, 13, `00:00`, `24:00`}, {13, 13, `15:18`, `15:06`}, {13, 13, `25:00`, `26:00`} and {2026-10-25, 2026-10-25, `02:30`, `04:00`}
- **THEN** 2026-10-13T13:06:03Z–13:18:33Z; 2026-10-12T22:00:00Z–2026-10-13T22:00:00Z; error `To lies before From`; error `Time as hh:mm:ss`; an error naming `+02:00 or +01:00`
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "turns the draft into a range or a reason"

### Requirement: Presets
The picker SHALL offer one chip per drive of the start day (`no drive` when none), **Whole day** (00:00:00 – 24:00:00) and the whole span the strip's double-click sets, labelled **Whole recording**, **Whole scope** (plain scope) or **Whole session** (linked catalog) (design R8). A preset fills the draft; Go applies it. Origin: D-092 (3) („that day's drives, Whole day, Whole recording"); labels: Q-3.

#### Scenario: Presets of a day
- **WHEN** `dayDrives` gets the drivecar answer and 2026-10-02, then 2026-10-03; and `wholeLabel` gets a workspace without scope, with a plain scope, with a linked catalog and unlinked
- **THEN** the chips `03:00–03:30 · 30 min` and `05:00–05:10 · 10 min`, then none; the labels `Whole recording`, `Whole scope`, `Whole session`, `Whole recording`
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "lists the day's drives and names the whole span"

#### Scenario: Drive preset on smart451
- **WHEN** the user opens the picker, clicks 2026-10-17, clicks the chip of its first drive and Go
- **THEN** the button shows that drive's range (starting about 10:01 local), the strip marks it, and Back returns to the range before
- **Evidence:** UI check on smart451 (button and strip after Go and after Back)

### Requirement: Apply and cancel
Go and Enter in the typed field SHALL set the range with one command for the bar target, as "Go to" did (all windows while linked, the target only while unlinked, one zoom history entry), and close the picker. Cancel, Esc and a click outside SHALL close it without a command. While it is open the navigation keys SHALL do nothing. Origin: D-092 (mock: Go, Cancel); time-navigation "Navigation targets", "Navigation in the zoom history".

#### Scenario: Go and Back
- **WHEN** two linked windows show smart451 at a 20 min range, the user opens the picker, clicks **Whole day** and Go, then clicks "Back"
- **THEN** after Go both windows show the start day 00:00 – 24:00 and the revision rose by exactly one; after Back both show the 20 min range
- **Evidence:** UI check on smart451 (revision and button text after each step)

#### Scenario: Cancel, Esc and keys
- **WHEN** the user opens the picker, clicks a day and presses Esc; opens it, clicks a day and clicks Cancel; opens it, clicks a day cell and presses `-`, `→` and `Home`; and the key handler gets `+` while the picker is open
- **THEN** the revision and the shown range never change and the picker is closed after Esc and Cancel; the handler returns no action
- **Evidence:** `apps/web/test/keys.test.ts` › "ignores navigation keys while the range picker is open"; UI check (revision before and after)

### Requirement: Picker in a scope and a case
The calendar SHALL show the strip's data ref and only rows inside the workspace's scope: in a linked catalog the session's scope, unlinked the vehicle's months. Days without rows in the scope SHALL be disabled with the tooltip `· outside the session`, `· outside the scope` or `· no data`. Applied ranges are clamped as every navigation is. Origin: D-082 (scope); D-086, D-089 (Unlink is the whole vehicle, queries bounded by what is shown).

#### Scenario: Linked and unlinked on smart451
- **WHEN** a catalog from `kipscope case drives smart451` is open on a drive of 2026-10-17, the user opens the picker, then clicks **Unlink** and opens it again
- **THEN** linked, only 2026-10-17 has bars, the other days are disabled with `outside the session`, and the whole-span chip reads `Whole session`; unlinked, every day of smart451 with rows shows bars and the chip reads `Whole recording`
- **Evidence:** UI check on smart451 (one screenshot each)

### Requirement: Picker states
While a month loads, its days in the scope SHALL be enabled without bars, the drive line SHALL read `Loading…`; after a failure the hint SHALL read `Density unavailable` and the next open asks again; without a data ref the calendar shows no bars and every day is enabled. Typed input, Whole day and Go SHALL work in every state, and no state SHALL change the picker's size. Origin: D-092 („a loading state in the loaded state's box").

#### Scenario: Slow and failing source
- **WHEN** the picker's month requests are held, then fail, then the picker is closed and opened with the source back
- **THEN** held: no bars, `Loading…`, the typed `15:08` and Enter still apply; failed: `Density unavailable`; reopened: bars; the picker's rect is the same in all three (±0.5 px)
- **Evidence:** UI check with the source stopped and restarted by the lead (rects and screenshots); `apps/web/test/rangePicker.test.ts` › "keeps the picker usable while the calendar loads or fails"
