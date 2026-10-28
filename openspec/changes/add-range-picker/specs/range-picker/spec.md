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
The top row SHALL show, in the former "Go to" field's slot, a 212 px button (name "Go to") with a calendar icon, the bar target's start date and time and the duration tag at its right end ("Start and duration", design R6), with the tooltips of design R6. Text changes SHALL move nothing; the worst-case texts fit uncut, the duration is never cut. Origin: D-092 (1), („Layout never moves"); D-093; tooltips, worst cases: D-095 (critic 1, 15); 212 px: mock `GoTo.dc.html` (design "Numbers").

#### Scenario: Button text
- **WHEN** the bar target shows 2026-10-13 15:06:03 – 15:18:33 local
- **THEN** the button reads `26-10-13`, `15:06`, the stopwatch icon and `0:12 h`, with no weekday, no end time and no ⁺¹; the date's and the time's tooltip is `Tue 2026-10-13 15:06`, the duration's `Duration 12 min`, the button's own `Go to: pick a range or type one · t`
- **Evidence:** `apps/web/test/rangeLine.test.ts` › "gives start and duration"; UI check on smart451 (screenshot of the button, the three `title` values)

#### Scenario: No reflow
- **WHEN** at 1440×900 and at 1000×557 the left x and width of the range button and of every other top-row control are read with the bar target at a 20 min range, after zooming to 2026-10-13T13:08:00.093Z – 13:08:00.995Z, after typing `2026-10-13 .. 2026-10-16`, and while a reload is pending
- **THEN** every value is the same in all four states (±0.5 px), the button is 212 px wide, and its texts read a start with `0:20 h`, `26-10-13 15:08:00` with `902 ms`, and `26-10-13 00:00` with `3 d 0 h`
- **Evidence:** UI check on smart451 (the x and width values per state and viewport, one screenshot each)

#### Scenario: Worst cases fit
- **WHEN** at 1440×900 the user types `2026-10-13 15:06:03 +41s`, then `2026-10-13 15:06 +2879min`, then `2026-10-11 14:34 +227h` into "Go to" (one unit per duration, time-navigation "Input forms"), each with Enter
- **THEN** the button reads `26-10-13 15:06:03` with `41 s`, `26-10-13 15:06` with `47:59 h`, and `26-10-11 14:34` with `9 d 11 h`; in each state the button is 212 px wide and no text element inside it is cut (`scrollWidth ≤ clientWidth` for the date-and-time span and the duration tag)
- **Evidence:** UI check on smart451 (button width, the two `scrollWidth`/`clientWidth` pairs per state, one screenshot each)

#### Scenario: No timeseries window
- **WHEN** the workspace holds only a values window, and before the first workspace state arrived
- **THEN** the button is disabled and reads `No time window`, then shows `…`, in the same box as when enabled; `t` opens nothing
- **Evidence:** `apps/web/test/rangeLine.test.ts` › "names the button state without a range"; UI check (screenshot, button rect equal to the enabled one)

### Requirement: Start and duration
Every range and session time people read SHALL come from one formatter (`startDuration`, design R6) as `<YY-MM-DD> <HH:MM>  <duration>`, local, start cut to the minute, the duration with its unit (`0:10 h`; from 48 h `9 d 11 h`; under 1 min `41 s`, the start then to the second); no weekday, end time or ⁺¹. Its full start and the duration in words SHALL be the tooltips. Cursor readouts and typed input keep their precision. Origin: D-093; unit, days, words, full date: D-095 (critic 1, 15).

#### Scenario: Start and duration texts
- **WHEN** `startDuration` gets 2026-10-13T13:06:03Z–13:18:33Z; 2026-10-20T21:30:00Z–23:52:43Z; 2026-10-12T22:00:00Z–2026-10-13T22:00:00Z; 2026-10-13T00:00:00Z–2026-10-14T23:59:30Z; 2026-10-13T00:00:00Z–2026-10-15T00:00:00Z; 2026-10-13T13:06:03Z–2026-10-15T13:18:33Z; 2026-10-11T12:34:24Z–2026-10-20T23:52:43Z; 2026-10-24T22:00:00Z–2026-10-25T23:00:00Z; 2026-10-13T13:08:00Z–13:09:00Z; 2026-10-13T13:06:03Z–13:06:44.600Z; 2026-10-13T09:12:00.999999999Z–09:13:00Z; 2026-10-13T13:08:00.093Z–13:08:00.995Z
- **THEN** the texts are `26-10-13 15:06  0:12 h`; `26-10-20 23:30  2:22 h`; `26-10-13 00:00  24:00 h`; `26-10-13 02:00  47:59 h`; `26-10-13 02:00  2 d 0 h`; `26-10-13 15:06  2 d 0 h`; `26-10-11 14:34  9 d 11 h`; `26-10-25 00:00  25:00 h`; `26-10-13 15:08  0:01 h`; `26-10-13 15:06:03  41 s`; `26-10-13 11:12:00  59 s`; `26-10-13 15:08:00  902 ms`; the `durationTip`s are `Duration 12 min`, `Duration 2 h 22 min`, `Duration 24 h`, `Duration 47 h 59 min`, `Duration 2 d`, `Duration 2 d 12 min`, `Duration 9 d 11 h 18 min`, `Duration 25 h`, `Duration 1 min`, `Duration 41 s`, `Duration 59 s`, `Duration 902 ms`; `date`, `time` and `duration` are the three parts (`26-10-13`, `15:06`, `0:12 h` for the first); `full` is `Tue 2026-10-13 15:06` for the first, `Sun 2026-10-11 14:34` for the seventh, `Tue 2026-10-13 15:06:03` for the tenth and `Tue 2026-10-13 15:08:00` for the last; `tip` is `Tue 2026-10-13 15:06 · Duration 12 min` for the first
- **Evidence:** `apps/web/test/rangeLine.test.ts` › "gives start and duration", "cuts to the second and below a minute", "switches to days from 48 hours and words the tooltip"

#### Scenario: Full time with seconds
- **WHEN** `fullTime` gets 2026-10-13T13:06:03.700Z with and without seconds, and 2026-10-20T23:52:43Z with seconds
- **THEN** `Tue 2026-10-13 15:06:03`, `Tue 2026-10-13 15:06` and `Wed 2026-10-21 01:52:43`
- **Evidence:** `apps/web/test/rangeLine.test.ts` › "writes the full local time with its weekday"

### Requirement: Duration tag
A duration in a slot (range button, result line, drive chips; in `declutter-workspace` the session bar, scope row and catalog list) SHALL carry the stopwatch icon and, as tooltip, that duration in words (`durationTip`, `DurationTag`, design R6). Origin: D-093; words: D-095 (critic 1: a bare `0:10` beside a stopwatch reads as seconds); mocks `GoTo.dc.html`, `Main.dc.html`, `SessionBar.dc.html`.

#### Scenario: Duration tag
- **WHEN** `DurationTag` with the text `0:12 h` and the title `Duration 12 min` is rendered to static markup
- **THEN** it holds one `svg.duration-icon` with `aria-hidden="true"`, the text `0:12 h` and `title="Duration 12 min"`
- **Evidence:** `apps/web/test/rangeLine.test.ts` › "renders the duration with its icon and tooltip"

### Requirement: Picker opens
A click on the range button or `t` SHALL open the picker under the button, focus its typed field with the last typed text selected, select the shown range (start and end day, From and To) and show the month of the range's start on the right and the month before on the left. The picker SHALL keep its size whatever it shows and lie inside the viewport. Origin: D-092 (mock `GoTo.dc.html`; „Layout never moves"); `t`: time-navigation "Navigation keys".

#### Scenario: Open on smart451
- **WHEN** the bar target shows 2026-10-13 15:06:03 – 15:18:33 local and the user presses `t`
- **THEN** the picker shows September 2026 and October 2026, days 13 marked as start and end, From `26-10-13` `15:06`, To `26-10-13` `15:18`, the typed field focused with its last text selected, and the result line `26-10-13 15:06` with the stopwatch and `0:12 h` (tooltips `Tue 2026-10-13 15:06` and `Duration 12 min`); Go without an edit applies 15:06:03 – 15:18:33 unchanged
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
The picker SHALL show two months side by side, each titled `<Month> <YYYY>`, with the weekday heads `Mo Tu We Th Fr Sa Su` and 6 week rows of day cells (days of other months left empty). ‹ and › SHALL page by one month; ‹ is disabled when no data lies before the right month (the left month and earlier hold none), › when none lies after the right month (the strip's density). Origin: D-092 (11) („calendar weeks start on Monday, English day names"); two months, paging: mock `GoTo.dc.html`.

#### Scenario: October 2026
- **WHEN** `monthCells(2026, 10)` and `localMonth(2026, 10)` are computed
- **THEN** 42 cells, cells 0–2 and 34–41 empty, cell 3 `2026-10-01` (`Thu`) and cell 33 `2026-10-31`; the month is 2026-09-30T22:00:00Z – 2026-10-31T23:00:00Z
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "lays out a month Monday first"

#### Scenario: Paging bounds
- **WHEN** `canPage` gets a density with `first` 2026-10-11T12:34:24Z and `last` 2026-10-21T00:52:43Z and right month October 2026; then right month November 2026; then a density whose `first` lies in August 2026 with right month October
- **THEN** ‹ off and › off; ‹ on and › off; ‹ on and › off
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "pages only towards data"

### Requirement: Day density
Each day cell SHALL show its number and 12 bars of two local hours from local midnight (the last 1 h or 3 h on DST days), log-scaled over the shown months' largest bar, slate-700 where a drive overlaps, slate-400 elsewhere, none for 0 rows, and a tooltip with rows and drives (design R5). The accent SHALL mark only the selection. Origin: D-092 („date pickers with underlayed data density"); bars: mock `GoTo.dc.html`; slate drives: D-095 (critic 3).

#### Scenario: Bars of a day
- **WHEN** `dayBars` gets the drivecar answer of "One month of drivecar" and the day 2026-10-02; and an answer of M10 with every hour 1 and the day 2026-10-25
- **THEN** counts `[0, 177720, 54720, 720, 1, 0, 0, 0, 0, 0, 0, 0]` with drive marks only on bars 1 and 2; and counts of 2 on bars 0–10 and 3 on bar 11
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "sums local two-hour bars and marks drives"

#### Scenario: Bar heights
- **WHEN** `dayBarHeight` gets counts 0, 1,000, 100, 10 and 1 with a largest bar of 1,000; and 1 with a largest of 10⁹
- **THEN** 0, 12, 9, 6, 3 and 2 (clamped)
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "scales bar heights by decades"

#### Scenario: Day tooltip
- **WHEN** `dayTip` gets the drivecar answer of "One month of drivecar" with the day 2026-10-02 and 2026-10-03 (kind `none`), and that answer with `scope` 2026-10-02T01:00:00Z – 02:00:00Z with the day 2026-10-10 (kind `session`)
- **THEN** `Fri 26-10-02 · 233,161 rows · 2 drives` (the calendar's weekday stays, the date is `YY-MM-DD`), `Sat 26-10-03 · no data` and `Sat 26-10-10 · outside the session`
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "words the day tooltip with rows, drives and the reason for no rows"

#### Scenario: Calendar on smart451
- **WHEN** the bar target shows 2026-10-13 15:06:03 – 15:18:33 local on smart451 (no scope) and the picker is opened, showing September and October 2026 with 13 selected
- **THEN** October 11 … 21 show bars (data fact, `GET /api/calendar` on 2026-10-21: rows on 11 … 21, drives on 11, 13 and 15 … 20), drive bars in `rgb(51, 65, 85)` on the unselected days with drives (e.g. 15 and 17), the selected 13's bars in white on the accent, and no bar outside the selected days in `rgb(2, 132, 199)`, days without rows are muted and marked `aria-disabled="true"`, and a day's tooltip names its rows and drives (`Tue 26-10-13 · … rows · … drives`)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot with one tooltip)

### Requirement: Day selection
A click on a day with data SHALL set start and end to that day and wait for the end; a second click on the same or a later day SHALL set the end; a click on an earlier day starts again. From and To keep their times. Days between start and end SHALL be shaded, start and end filled in the accent. Origin: D-092 (Jan: „date pickers"); keep times: mock `GoTo.dc.html`, design R7.

#### Scenario: Two clicks
- **WHEN** `pickDay` gets the draft of 2026-10-13 15:06:03 – 15:18:33 and `2026-10-15`, then `2026-10-17`, then `2026-10-16`, then `2026-10-14`
- **THEN** start and end 15, waiting for the end; 15 to 17; start and end 16, waiting; start and end 14, waiting (14 lies before the start); From `15:06:03` and To `15:18:33` throughout
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "picks a start and an end day"

### Requirement: Calendar as a grid
Each shown month SHALL be a `role="grid"` labelled `<Month> <YYYY>` with weekday column heads named in full, gridcells whose `aria-selected` marks the start, end and days between, and day buttons labelled `<Ddd> <d>, <n> drives` or the day's reason for no data (design R5). Days without rows SHALL be `aria-disabled` and stay focusable. Origin: D-095 (critic 14: no grid semantics); labels: mock `GoTo.dc.html` after D-095.

#### Scenario: Day names for screen readers
- **WHEN** `dayLabel` gets the drivecar answer of "One month of drivecar" with the days 2026-10-02 and 2026-10-03 (kind `none`); that answer with `scope` 2026-10-02T01:00:00Z – 02:00:00Z and the day 2026-10-10 (kind `session`); an M10 answer with every hour 1 and no drives with 2026-10-25; and no answer with 2026-10-02
- **THEN** `Fri 2, 2 drives`, `Sat 3, no data`, `Sat 10, outside the session`, `Sun 25, no drives` and `Fri 2`
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "names each day for screen readers"

#### Scenario: Grid markup
- **WHEN** the picker is rendered to static markup for the range 2026-10-13 15:06:03 – 15:18:33 local with the drivecar answers of September and October 2026
- **THEN** it holds two `role="grid"` elements labelled `September 2026` and `October 2026`, each with 7 `role="columnheader"` (the first labelled `Monday`) and 6 `role="row"` week rows below the head row; exactly one day button has `tabindex="0"`, the one of October 13; the cell of October 13 has `aria-selected="true"` and every other cell `"false"`; the button of October 2 has the `aria-label` `Fri 2, 2 drives` and the one of October 3 `aria-disabled="true"`
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "renders each month as a keyboard grid"

### Requirement: Calendar by keyboard
Both grids together SHALL be one tab stop (roving tabindex, on open the start day when shown). ← and → SHALL move focus one day, ↑ and ↓ one week, PageUp and PageDown one month, paging the calendar when allowed ("Calendar months"), else focus stays; Enter or Space SHALL act as a click on the focused day. The legend SHALL name the keys. Origin: D-095 (critic 14: every day cell was a tab stop); keys: mock `GoTo.dc.html` after D-095.

#### Scenario: Grid steps
- **WHEN** `gridStep` gets `2026-10-13` with ←, →, ↑, ↓, PageUp, PageDown and Home; `2026-10-31` with → and PageDown; and `pageFor` gets left month September 2026 with the days `2026-10-05`, `2026-11-01` (next allowed), `2026-11-01` (next not allowed) and `2026-08-31` (previous allowed)
- **THEN** `2026-10-12`, `2026-10-14`, `2026-10-06`, `2026-10-20`, `2026-09-13`, `2026-11-13` and undefined; `2026-11-01` and `2026-11-30`; left September (unchanged), left October, undefined (focus stays), left August
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "steps the focused day and pages to it"

#### Scenario: Keyboard on smart451
- **WHEN** at 1440×900 the bar target shows 2026-10-13 15:06 – 15:18 local, the user presses `t`, presses Tab until a day has focus, then →, →, Enter, →, →, Enter, ↓, Enter, then PageUp
- **THEN** focus lands on October 13 after the Tabs (one Tab stop for both grids); the first Enter makes the 15th start and end day, the second makes the 17th the end day; ↓ moves focus to October 24 (`Sat 24, no data`, `aria-disabled`) and Enter there changes nothing; PageUp moves focus to September 24; the picker's rect is the same throughout (±0.5 px)
- **Evidence:** UI check on smart451 (`document.activeElement`'s `aria-label` after each key, the From/To dates after each Enter, one screenshot after the second Enter)

### Requirement: Time fields
From and To SHALL show their date as `YY-MM-DD` and a time field taking `hh:mm` (also `hh:mm:ss[.fff]`), local; To also `24:00`, the next local midnight. A bad time, an end not after the start, or a nonexistent or ambiguous local time SHALL show its reason in the result line and disable Go. Origin: Jan („date and to times"); D-093 (HH:MM fields, typed precision kept); DST: time-navigation "Invalid input changes nothing".

#### Scenario: Draft to range
- **WHEN** `draftRange` gets {13, 13, `15:06:03`, `15:18:33`}, {13, 13, `00:00`, `24:00`}, {13, 13, `15:18`, `15:06`}, {13, 13, `25:00`, `26:00`} and {2026-10-25, 2026-10-25, `02:30`, `04:00`}
- **THEN** 2026-10-13T13:06:03Z–13:18:33Z; 2026-10-12T22:00:00Z–2026-10-13T22:00:00Z; error `To lies before From`; error `Time as hh:mm`; an error naming `+02:00 or +01:00`
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "turns the draft into a range or a reason"

### Requirement: Filled times show the minute
A time filled into From or To (from the shown range, a day pick keeping it, or a preset) SHALL show cut to the minute while the draft keeps it exact, so Go without an edit applies the exact time; a field the user typed in shows the typed text. Origin: D-093 (HH:MM fields); exact until edited: mock `GoTo.dc.html` (else a 41 s range would open as 15:06 – 15:06 and be refused).

#### Scenario: Field text
- **WHEN** `fieldText` gets `15:06:03`, `24:00:00`, `15:08:00.093` and `00:00:00`
- **THEN** `15:06`, `24:00`, `15:08` and `00:00`
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "shows filled times to the minute"

### Requirement: Presets
The picker SHALL offer one chip per drive of the start day reading its start and duration (`03:00  0:30 h`, its `tip` as tooltip; `no drive` when none), **Whole day** (00:00 – 24:00) and the whole span of the strip's double-click, labelled **Whole recording**, **Whole scope** (plain scope) or **Whole session** (linked catalog) (design R8). A preset fills the draft; Go applies it. Origin: D-092 (3); labels: Q-3; chip text: D-093, D-095.

#### Scenario: Presets of a day
- **WHEN** `dayDrives` gets the drivecar answer and 2026-10-02, then 2026-10-03; and `wholeLabel` gets a workspace without scope, with a plain scope, with a linked catalog and unlinked
- **THEN** the chips `03:00  0:30 h` (tooltip `Fri 2026-10-02 03:00 · Duration 30 min`) and `05:00  0:10 h`, then none; the labels `Whole recording`, `Whole scope`, `Whole session`, `Whole recording`
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "lists the day's drives and names the whole span"

#### Scenario: Drive preset on smart451
- **WHEN** the user opens the picker, clicks 2026-10-17, clicks the chip of its first drive and Go
- **THEN** the button shows that drive's start and duration (`26-10-17 10:01` and `2:06 h`; data fact, `GET /api/calendar?dataRef=smart451` for 2026-10-17 on 2026-10-21: drives 10:01 – 12:07, 12:41 – 12:50 and 13:05 – 13:15 local), the strip marks it, and Back returns to the range before
- **Evidence:** UI check on smart451 (button and strip after Go and after Back)

### Requirement: Apply and cancel
Go and Enter in any of the picker's fields SHALL apply what "Go on typed text" names with one command for the bar target, as "Go to" did (all windows while linked, the target only while unlinked, one zoom history entry), and close the picker. Cancel, Esc and a click outside SHALL close it without a command. While it is open the navigation keys SHALL do nothing. Origin: D-092 (mock: Go, Cancel); time-navigation "Navigation targets", "Navigation in the zoom history".

#### Scenario: Go and Back
- **WHEN** two linked windows show smart451 at a 20 min range, the user opens the picker, clicks **Whole day** and Go, then clicks "Back"
- **THEN** after Go both windows show the start day 00:00 – 24:00, the button reads `<YY-MM-DD> 00:00` and `24:00 h`, and the revision rose by exactly one; after Back both show the 20 min range (`0:20 h`)
- **Evidence:** UI check on smart451 (revision and button text after each step)

#### Scenario: Cancel, Esc and keys
- **WHEN** the user opens the picker, clicks a day and presses Esc; opens it, clicks a day and clicks Cancel; opens it, clicks a day cell and presses `-`, `→` and `Home`; and the key handler gets `+` while the picker is open
- **THEN** the revision and the shown range never change and the picker is closed after Esc and Cancel; the handler returns no action
- **Evidence:** `apps/web/test/keys.test.ts` › "ignores navigation keys while the range picker is open"; UI check (revision before and after)

### Requirement: Go on typed text
The last edit of this open SHALL decide what Go applies: while typing non-blank text is the latest edit, Go SHALL apply that text (refused: reason in the result line, no command) and stay enabled. A later draft change (day, chip, preset, From or To) SHALL hand Go back to the draft and clear the reason; typing again leads again; paging changes neither. Origin: lead's default of 2026-10-21, refined after round 6 (design Q-7, Jan may veto); "this open": the field keeps its text.

#### Scenario: Go takes the typed text
- **WHEN** `goSource` gets (`15:08`, typed in this open), (`15:08`, not typed in this open), (`  `, typed in this open) and (``, typed in this open)
- **THEN** `typed`, `draft`, `draft`, `draft`
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "lets Go apply text typed in this open"

#### Scenario: Typed then clicked
- **WHEN** from `GO_OPENED` the field gets `15:08` (`goAfter` with `typed`), then **Whole day** changes the draft of 2026-10-13 15:06:03 – 15:18:00 to 00:00 – 24:00 (`goAfter` with `draft`), and `goAction` is asked before and after; and on smart451 with the bar target at 2026-10-13 15:06:03 – 15:18:33 local the user opens the picker, types `15:08`, clicks **Whole day** and Go
- **THEN** before the click `{typed: "15:08"}`; after it the state is `{typedThisOpen: false, typedError: undefined}` and `goAction` gives the range 2026-10-12T22:00:00Z – 2026-10-13T22:00:00Z; in the UI the result line reads `26-10-13 00:00` and `24:00 h` after the click, and Go closes the picker with the button reading the same and the revision one higher
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "applies the whole day after 15:08 was typed and Whole day clicked"; UI check on smart451 (result line after the click, button text and revision after Go)

#### Scenario: Refused then clicked
- **WHEN** from `GO_OPENED` the field gets `25:00`, Go is refused with a reason (`goAfter` with `refused`), then **Whole day** changes the draft; and on smart451 as in "Typed then clicked" the user types `25:00`, clicks Go, then clicks **Whole day** and Go
- **THEN** after the refusal the state keeps `typedThisOpen: true` with the reason and `goAction` still gives `{typed: "25:00"}`; after the click the reason is gone and `goAction` gives the whole day 2026-10-12T22:00:00Z – 2026-10-13T22:00:00Z; in the UI the first Go shows the reason in the result line only (the app's message line shows none), the picker stays open and the revision is unchanged; the click replaces the reason with `26-10-13 00:00` and `24:00 h`; the second Go applies that day, one revision more
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "applies the day after a refused 25:00 and Whole day, and drops the reason"; UI check on smart451 (screenshot with the reason, result line after the click, revision after each Go)

#### Scenario: Typing leads again
- **WHEN** from `GO_OPENED` a draft change, a refusal and then a change in the typed field follow (`goAfter` with `draft`, `refused`, `typed`)
- **THEN** the state is `{typedThisOpen: true, typedError: undefined}`
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "lets typing after a draft change lead again and clears a reason"

#### Scenario: Go enabled with typed text and a draft error
- **WHEN** `goAction` gets the draft 13, 13, `15:06:03`, `25:00` (an error) with (`15:08`, typed in this open), (`15:08`, not typed in this open) and (``, typed in this open)
- **THEN** `{typed: "15:08"}` (Go enabled), `undefined` and `undefined` (Go disabled)
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "keeps Go enabled with typed text while the draft has an error"

#### Scenario: Go with typed text on smart451
- **WHEN** the bar target shows 2026-10-13 15:06:03 – 15:18:33 local; the user opens the picker, types `15:08` and clicks Go; opens it, types `25:00` and clicks Go, then presses Esc; opens it again (the field holds `25:00`, untouched), clicks **Whole day** and Go
- **THEN** the first Go closes the picker with `26-10-13 15:08` and `0:01 h` and the revision rose by exactly one; the second shows the invalid-time reason in the result line, the picker stays open and the revision is unchanged; the third applies the whole day (`26-10-13 00:00` and `24:00 h`), one revision more
- **Evidence:** UI check on smart451 (button text and revision after each Go, screenshot with the reason)

### Requirement: Enter as Go
Enter in the typed field, in From and in To SHALL act exactly as the Go button (same source, "Go on typed text"). So Enter in the typed field right after opening, without typing in this open, SHALL apply the draft (normally the range shown), not the text kept from an earlier open. Origin: design Q-7 (refined 2026-10-21; reviewer: Enter and Go had different sources).

#### Scenario: Enter as Go
- **WHEN** `goAction` gets (`15:08`, typed in this open, the draft 2026-10-13 15:06:03 – 15:18:00) and (`15:08`, not typed in this open, that draft); and on smart451 with the bar target at 2026-10-13 15:06:03 – 15:18:33 local the user opens the picker, types `15:08`, clicks into the From field without changing it and presses Enter; then clicks Back (the field still holds `15:08`), opens the picker and presses Enter at once
- **THEN** `{typed: "15:08"}` and the range 2026-10-13T13:06:03Z – 13:18:00Z (the kept text is not applied); in the UI the first Enter closes the picker with the button reading `26-10-13 15:08` and `0:01 h`, one revision more; after Back the button reads `26-10-13 15:06` and `0:12 h`, and the second Enter applies the draft, so it still reads that, not `15:08`
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "gives Enter in a field the same source as Go"; UI check on smart451 (button text and revision after each Enter)

### Requirement: Picker in a scope and a case
The calendar SHALL show the strip's data ref and only rows inside the workspace's scope: in a linked catalog the session's scope, unlinked the vehicle's months. Days without rows in the scope SHALL be disabled with the tooltip `· outside the session`, `· outside the scope` or `· no data`. Applied ranges are clamped as every navigation is. Origin: D-082 (scope); D-086, D-089 (Unlink is the whole vehicle, queries bounded by what is shown).

#### Scenario: Linked and unlinked on smart451
- **WHEN** a catalog from `kipscope case drives smart451` is open on one of its sessions (e.g. the case workspace of the UI checks on 2026-10-21: 2026-10-15 20:58:06 – 21:23:12 local, `kipscope scope show`), the user opens the picker, then clicks **Unlink** and opens it again
- **THEN** linked, only the session's day (there 2026-10-15) has bars, the other days are disabled with `outside the session`, and the whole-span chip reads `Whole session`; unlinked, every day of smart451 with rows shows bars and the chip reads `Whole recording`
- **Evidence:** UI check on smart451 (one screenshot each)

### Requirement: Picker states
While a month loads, its days in the scope SHALL be enabled without bars, the drive line SHALL read `Loading…`; after a failure the hint SHALL read `Density unavailable` and the next open asks again; without a data ref the calendar shows no bars and every day is enabled. Typed input, Whole day and Go SHALL work in every state, and no state SHALL change the picker's size. Origin: D-092 („a loading state in the loaded state's box").

#### Scenario: Slow and failing source
- **WHEN** the picker's month requests are held, then fail, then the picker is closed and opened with the source back
- **THEN** held: no bars, `Loading…`, the typed `15:08` and Enter still apply; failed: `Density unavailable`; reopened: bars; the picker's rect is the same in all three (±0.5 px)
- **Evidence:** UI check with the source stopped and restarted by the lead (rects and screenshots); `apps/web/test/rangePicker.test.ts` › "keeps the picker usable while the calendar loads or fails"
