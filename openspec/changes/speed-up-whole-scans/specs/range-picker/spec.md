## MODIFIED Requirements

### Requirement: Calendar bounded by window and scope
A calendar computation SHALL take one of two paths:
- **Plain scope** (not an object scope): exactly one `refBuckets` call on the 60 s grid, with a source scope of `[from, to)` cut to the workspace's scope, after the scan bound (scope "Scan bound") passed. No `refExtent` call. When that cut is empty, the answer is zero `hours` and no drives, with no source call.
- **Object scope, or full mode without a scope:** from the counted vehicle-days ("Calendar days counted at the lowest priority"), with no other source call. The answer is cut to the object scope if there is one.

With a scope, the answer SHALL carry `scope`, and a data ref other than the scope's SHALL answer 409 `out_of_scope`.

Origin: D-082 („every source query is bounded"); D-089 (queries bounded by what is shown); D-118 (the calendar day by day, the one exception that may cover a vehicle's months).

#### Scenario: Scope on testcar
- **WHEN** a recording source is behind the test server, the scope is {testcar, 2026-10-01T01:00:00Z, 2026-10-01T02:00:00Z}, and `/api/calendar` is sent for `testcar` over M10, for `testcar` over the local month November 2026, and for `othercar` over M10
- **THEN** the first answers `scope` with those bounds and nonzero `hours` only at index 3 (equal to `SELECT count() FROM sdlog.signals WHERE vehicle = 'testcar' AND utc >= T1 AND utc < T2`). The source got one `refBuckets` with width 60 s and scope {testcar, T1, T2}, plus at most one `refCount` with that scope. The second answers 720 zero `hours` and `drives` `[]` with no source call. The third answers 409 `out_of_scope`.
- **Evidence:** `apps/server/test/calendar.http.test.ts` › "cuts the window to the scope and skips an empty cut"

#### Scenario: Unlinked case
- **WHEN** a workspace is unlinked on `testcar` (object scope), the vehicle-days of testcar in M10 are counted, and `/api/calendar?dataRef=testcar` is sent over M10, then over 33 days
- **THEN** the first answers 200 with `scope` equal to the object scope's bounds, the same `hours` inside the scope as a plain scope of those bounds, no `pending`, and no source call during the request; the second answers 400 `invalid_request`
- **Evidence:** `apps/server/test/objectScope.http.test.ts` › "answers the calendar of a month while unlinked"

#### Scenario: Scoped mode
- **WHEN** a scoped-mode server without a scope gets `/api/calendar?dataRef=testcar` over M10, then with scope {testcar, T1, T2} the same request
- **THEN** the first answers 409 `scope_required` with no source call; after the second every recorded adapter call is `ping` or carries scope {testcar, T1, T2}
- **Evidence:** `apps/server/test/scope.http.test.ts` › "bounds the calendar by the scope in scoped mode"

### Requirement: Calendar cached and classed
On the plain-scope path the server SHALL compute one calendar per scope and window at most once per catalog load:
- concurrent requests share one computation
- a failed or `too_wide` one is not cached
- a catalog reload computes again
- at most 12 windows are kept, least recently used dropped
- its query runs in the class of the request that started it, raised by any joining request

On the vehicle-day path a request SHALL answer at once from the counted days and SHALL never raise the class of the day counting.

Origin: necessary consequence of carserver's 2 GB RAM (D-007) and paging back and forth; classes: D-081; never raised: D-118 („immer in niedrigster prio").

#### Scenario: Cache
- **WHEN** a stub source counts its `refBuckets` calls with a scope set; three calendar requests for `testcar` over M10 arrive at once, then one more, then the catalog is refreshed and one more arrives; separately the first computation fails and a second request follows; separately 13 different months are asked and then the first again
- **THEN** one call for the first four, one more after the refresh, one more after the failure, and the 14th request computes again
- **Evidence:** `apps/server/test/calendar.test.ts` › "computes once per window and catalog load, shares, drops failures and the least recent"

#### Scenario: Interactive class
- **WHEN** a stub source records the class of each call, a scope is set, and a calendar request arrives over HTTP; then the workspace is unlinked and a calendar request for a month with uncounted days arrives
- **THEN** the first request's `refBuckets` call records `interactive`; the second answers before any source call and every day-count call afterwards records `idle`
- **Evidence:** `apps/server/test/calendar.test.ts` › "runs in the request's class, days at idle"

### Requirement: Calendar cost
The calendar SHALL be measured on carserver in a session scope and unlinked (first and second call), and the vehicle-day filling for two months of smart451. Goals, measured and reported, not pass/fail:
- a session-scope first call ≤ 1 s, any second ≤ 0.1 s
- an unlinked call ≤ 0.1 s (from the counted days)
- one vehicle-day ≤ 10 s (measured 5.1 s for the hourly counts of one smart451 day, D-118)
- two months of smart451 filled within 10 min of idle source time

A result over twice its goal goes to Jan. Origin: D-118 (5.1 s per day, about 5 min for two months); D-081.

#### Scenario: Cost on carserver
- **WHEN** the scoped dev server runs against carserver with a workspace on one drive of `kipscope case drives smart451 2026-10-20T00:00:00Z 2026-10-28T00:00:00Z`, and `curl -s -o /dev/null -w '%{time_total}\n' 'localhost:7310/api/w/<id>/calendar?dataRef=smart451&from=2026-09-30T22:00:00Z&to=2026-10-31T23:00:00Z'` runs twice linked and twice after **Unlink**; and the server log's day-count lines for smart451 are read
- **THEN** all four answer 200; the four times, the time per counted day and the time until no day of September and October 2026 is pending are reported against their goals
- **Evidence:** the commands and log lines, in `rounds.md`

### Requirement: Day density
Each day cell SHALL show its number and 12 bars of two local hours from local midnight (the last 1 h or 3 h on DST days), log-scaled over the shown months' largest bar, slate-700 where a drive overlaps, slate-400 elsewhere, none for 0 rows, and a tooltip with rows and drives (design R5). A day with any part not counted yet SHALL show no bars but a dotted 1 px baseline in slate-300, and the tooltip `<weekday> <YY-MM-DD> · not counted yet`. The accent SHALL mark only the selection. Origin: D-092 („date pickers with underlayed data density"); bars: mock `GoTo.dc.html`; slate drives: D-095 (critic 3); not counted yet: D-118 („days not counted yet are marked and fill in"), concept §10.

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

#### Scenario: Not counted yet
- **WHEN** `dayBars` and `dayTip` get an M10 answer whose `pending` holds 2026-10-14T00:00:00Z – 2026-10-15T00:00:00Z, for the local days 2026-10-14 and 2026-10-15 (Europe/Berlin)
- **THEN** both days are marked not counted (each overlaps the pending UTC day) and their tips read `Wed 26-10-14 · not counted yet` and `Thu 26-10-15 · not counted yet`; 2026-10-13 is not marked
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "marks days not counted yet"

#### Scenario: Calendar on smart451
- **WHEN** on the scoped dev server, unlinked on smart451 from a catalog of `kipscope case drives smart451 2026-10-11T00:00:00Z 2026-10-28T00:00:00Z`, with the bar target at 2026-10-13 15:06:03 – 15:18:33 local, the picker is opened (September and October 2026, 13 selected) once at once after Unlink and once after the days were counted
- **THEN** the first time, days not counted yet show the dotted baseline and fill in without closing the picker. The second time, October 11 … 27 show bars, drive bars are in `rgb(51, 65, 85)` on the unselected days with drives, the selected 13's bars are in white on the accent, and no bar outside the selected days is in `rgb(2, 132, 199)`. Days without rows are muted and marked `aria-disabled="true"`, and a day's tooltip names its rows and drives (`Tue 26-10-13 · … rows · … drives`).
- **Evidence:** UI check on smart451 at 1440×900 (one screenshot each time, with one tooltip)

## ADDED Requirements

### Requirement: Calendar days counted at the lowest priority
The server SHALL count a vehicle's rows per UTC day ("vehicle-day") as follows:
- One `refBuckets(dataRef, 60 s, false, {dataRef, day, day + 1 d})` call per day. A day whose `refCount` exceeds the scan bound's rows is counted in four 6 h parts instead.
- These calls run in the query class `idle`, below `preload`. An `idle` query SHALL start only while no `interactive` query runs or waits, and at most one `idle` query SHALL run at a time.
- A failed day is retried at the next pass, at most once per 5 min.

The calendar answer of the vehicle-day path SHALL list the UTC days of its window that are not counted yet as `pending` ranges (absent when none). Its `hours` count only counted days; `drives` come from the counted days' 60 s buckets by the time-strip rule.

Origin: D-118 („one day per query, in the lowest priority class (below preload and background, at most one in flight, any interactive query first)"); 6 h parts: a day above the scan bound (scope "Scan bound").

#### Scenario: Idle queue rules
- **WHEN** a queue of limit 4 gets idle tasks D1–D3 and one background task B, then an interactive task I that runs until released, then the test releases every running task one at a time
- **THEN** D1 and B start at once and D2 waits while D1 runs. After D1 ends while I runs, D2 does not start until I has ended. D3 starts only after D2 ended.
- **Evidence:** `apps/server/test/queue.test.ts` › "runs idle tasks one at a time and never beside an interactive one"

#### Scenario: Pending days
- **WHEN** a full-mode test server without a scope has a stub source that records its calls, the day store of `testcar` holds 2026-10-01 counted, and `/api/calendar?dataRef=testcar` is sent over [2026-09-30T22:00Z, 2026-10-02T22:00Z)
- **THEN** the answer comes before any source call, with `pending` the two UTC days 2026-09-30 and 2026-10-02 as `{from, to}` in decimal ns (`1790726400000000000`–`1790812800000000000` and `1790899200000000000`–`1790985600000000000`) and the counted day's hours; the source then gets one `refCount` and one `refBuckets` with width 60 s and the scope of each pending day, in `idle`, one day at a time
- **Evidence:** `apps/server/test/calendar.test.ts` › "answers counted days at once and counts the rest at idle"

### Requirement: Calendar days kept across restarts
The server SHALL keep counted vehicle-days in its state directory, one file per data ref and source (`kind`, `database`, `table`), and read them at start. A day SHALL be final once it was counted when its end lay more than 1 h in the past; a final day is never counted again. Every other counted day (today, or one counted before its end + 1 h) SHALL be counted again at most every 5 min while an open workspace uses its data ref. A file of another source, or one that does not parse, SHALL be ignored with one log line. Origin: D-118 („Finished days are kept on the server across restarts; past days are final, today is rechecked"); 1 h: design B6.

#### Scenario: Restart keeps final days
- **WHEN** a server with an open workspace on testcar counts testcar's days 2026-10-01 and 2026-10-02 with a fake clock at 2026-10-02T12:00Z and stops; a new server starts on the same state directory with the clock at 2026-10-02T12:10Z and the same workspace open, and gets the calendar of those two days; then the clock moves to 2026-10-02T12:20Z
- **THEN** the new server's first answer has no `pending` and comes before any source call. 2026-10-01 is never counted again. 2026-10-02 is counted again once soon after the start (its count is 10 min old) and once more after 12:15Z, each in `idle`.
- **Evidence:** `apps/server/test/calendarDays.test.ts` › "keeps final days across a restart and rechecks today"

#### Scenario: Another source's file
- **WHEN** the state directory holds a day file of testcar written for table `other`
- **THEN** the server logs one line naming the file, ignores it and counts the days again
- **Evidence:** `apps/server/test/calendarDays.test.ts` › "ignores a day file of another source"

### Requirement: Calendar days filled ahead
For each open workspace, the server SHALL count ahead, in `idle`, the vehicle-days of its data ref that the picker would show: the UTC days of the calendar month (UTC) that holds the start of the first timeseries window's range, and of the month before, plus one day on each side. The data ref is the scope's, or else that of the window's first signal. Days the open picker asks for come first, newest first. Origin: D-118 („The months the picker would show are filled ahead for the vehicles of open workspaces").

#### Scenario: Ahead for an open workspace
- **WHEN** a workspace with a live client has a timeseries window on `testcar` at 2026-10-01 01:00–02:00Z and no calendar request arrives, with a stub source
- **THEN** the source gets day counts in `idle` for every UTC day from 2026-08-31 to 2026-11-01, one at a time, newest first, and after a calendar request for M10 the days of M10 not yet counted are counted before the others
- **Evidence:** `apps/server/test/calendarDays.test.ts` › "fills the shown months ahead for open workspaces"

### Requirement: The picker fills in
While the picker is open and its calendar answer has `pending`, the web SHALL fetch it again every 3 s, and stop once `pending` is gone or the picker closes. Each newly counted day SHALL draw its bars without moving the grid. Origin: D-118 („days not counted yet are marked and fill in"); concept §10.

#### Scenario: Refetch while pending
- **WHEN** the picker is open on a stub whose first answer has `pending` and whose second has none; then it is opened again and closed after the first answer with `pending` (fake timers)
- **THEN** the second fetch comes 3 s after the first and no third follows; after the close no fetch follows
- **Evidence:** `apps/web/test/rangePicker.test.ts` › "fetches again while days are pending"
