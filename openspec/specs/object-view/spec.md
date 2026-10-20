# object-view Specification

## Purpose
The unlinked state of a case: the scope becomes the current vehicle's whole recorded series with no bound the user meets, while every source query still follows what is shown (series by view range, a coarse strip with finer detail around the view, gaps and events for a work window, the signal list lazily), so no query scans without bounds.

Test data: catalog C4 of design "Test fixtures"; `testcar` rows lie in [2026-10-01T00:00:00Z, 10:00:00Z). `longcar` (design K17) for the measurement.

## Requirements

### Requirement: Unlink is the whole vehicle
`case.unlink` SHALL set the scope to the current session's vehicle's full extent, `[first row, last row + 1 ns)` widened to keep the session's scope inside, marked `object: true`, with no default span and no cap; windows and cursors SHALL stay, the catalog SHALL stay, and each window's offset from the alignment point SHALL be kept for Link. Origin: D-086 („unlink ist aktuelles fahrzeug. unlink ist für den user unbegrenzt").

#### Scenario: Unlink on testcar
- **WHEN** at entry 0 of C4 with `w1` at [01:02:00, 01:04:00) `case.unlink` is posted
- **THEN** the scope is `{dataRef: "testcar", from: <first testcar row>, to: <last testcar row + 1 ns>, object: true}` (from `SELECT min(utc), max(utc) FROM sdlog.signals WHERE vehicle = 'testcar'`), `w1` is unchanged, `case.linked` is false, `case.linkedRanges.w1` is `{from: "120000000000", to: "240000000000"}`, and the source got exactly one `refExtent` call, with the data ref and the scope `{testcar, TIME_MIN, TIME_MAX}`
- **Evidence:** `apps/server/test/objectScope.http.test.ts` › "unlinks to the vehicle's extent with one extent query"

#### Scenario: Extent cached
- **WHEN** within 5 min the same workspace links and unlinks again, and another workspace unlinks on `testcar`
- **THEN** no further `refExtent` call is made
- **Evidence:** `apps/server/test/objectScope.http.test.ts` › "unlinks to the vehicle's extent with one extent query"

### Requirement: Link returns to a session
`case.go {index}` while unlinked SHALL link to that session and give each window that has a kept offset its old offset from the new alignment point, and each window created while unlinked the session's whole scope; `case.link` in UI and CLI SHALL be `case.go` to the session left. Origin: Jan („mit "unlink" … man bleibt im objekt"); Q-4 (a).

#### Scenario: Link to another session
- **WHEN** after the unlink above `w1` was zoomed to [06:00:00, 07:00:00), a window `w2` was created, and `case.go {index: 2}` is posted (align start)
- **THEN** the scope is `{testcar, 04:49:00, 05:11:00}` without `object`, `w1` shows [04:52:00, 04:54:00), `w2` shows [04:49:00, 05:11:00), `case.linked` is true and `linkedRanges` is gone
- **Evidence:** `packages/shared/test/apply.test.ts` › "unlinks to the vehicle's extent and links back"

### Requirement: Work window
In an object scope, gaps, events and strip drives SHALL cover the work window of the shown range (design K11): one view span on each side, at least one day, at most 32 days in all, on whole UTC days, inside the scope. Origin: D-086 consequences („every query follows what is shown"); D-082 („no query scans without bounds").

#### Scenario: Window sizes
- **WHEN** `workWindow` gets, in a scope of 400 days, a 10-minute view at 2026-06-10 12:00Z, a 3-day view from 2026-06-10 00:00Z, a 90-day view, and a 10-minute view 2 h after the scope's start
- **THEN** it gives [06-09 00:00, 06-12 00:00), [06-07 00:00, 06-16 00:00), a window of 31 or 32 days on day edges around the view's centre (30 days before rounding), and a window starting at the scope's `from`
- **Evidence:** `packages/shared/test/case.test.ts` › "computes the work window"

#### Scenario: Object scope keyed apart
- **WHEN** `scopeKey` gets `{testcar, F, T}` and `{testcar, F, T, object: true}`
- **THEN** the keys differ, the second ending in `|object`
- **Evidence:** `packages/shared/test/case.test.ts` › "keys an object scope apart"

### Requirement: Coarse strip over the vehicle
In an object scope, `GET /api/density?dataRef=<ref>` without `from`/`to` SHALL answer bars only over the whole scope from one bucket query at the bar width (≤ 120 buckets), with `drives: []` and `coarse: true`, cached per scope. Origin: D-086 („the strip coarse first and finer on zoom"); time-strip "Bucket widths".

#### Scenario: Coarse density
- **WHEN** the workspace is unlinked on `testcar` and `/api/density?dataRef=testcar` is sent twice
- **THEN** both answer `coarse: true`, `drives` `[]`, `first`/`last` the scope's bounds, at most 120 `counts` summing to testcar's row count, and the source got one `refBuckets` call at the bar width and no grid query
- **Evidence:** `apps/server/test/objectScope.http.test.ts` › "answers a coarse density over the whole vehicle"

### Requirement: Detail around the view
`GET /api/density?dataRef=<ref>&from&to` SHALL answer bars, grid and drives over `[from, to) ∩ scope` by the existing rules, cached per window; in an object scope the strip SHALL draw the drives of the work window from it and step `,` `.` through them. Origin: D-086 („finer on zoom"); D-057 (drives).

#### Scenario: Detail density
- **WHEN** unlinked on `testcar`, `/api/density?dataRef=testcar&from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z` is sent
- **THEN** it answers without `coarse`, with `drives` inside that day and counts over that day only
- **Evidence:** `apps/server/test/objectScope.http.test.ts` › "answers a detail density for a work window"

#### Scenario: Strip asks for the work window
- **WHEN** the strip renders an object scope with the bar target at a 10-minute range, then the range pans by 1 h, then jumps 10 days
- **THEN** it asks the coarse density once, the detail density for the work window, nothing new after the 1-h pan (still inside), and a new detail density after the jump
- **Evidence:** `apps/web/test/strip.test.ts` › "asks the detail density for the work window"

### Requirement: Gaps and events follow the view
In an object scope, `GET /api/gaps` and `GET /api/events` SHALL require `from` and `to` (400 `invalid_request` without them or when wider than 32 days) and SHALL compute over that window only, cached per window; `GET /api/value` SHALL use the gap info of the work window around its time; the 5-min poll SHALL count only held windows. Origin: D-086 consequences; D-062 (no value across a gap); D-082.

#### Scenario: Gaps and events in an object scope
- **WHEN** unlinked on `testcar`, `/api/gaps?dataRef=testcar` and `/api/events?dataRef=testcar` are sent without a range, then with a 40-day range, then with [2026-10-01T00:00Z, 2026-10-02T00:00Z)
- **THEN** the first two of each answer 400 `invalid_request`; the last answer the same logger gaps and events as a linked scope of that day, and every source call carried a scope inside that day
- **Evidence:** `apps/server/test/objectScope.http.test.ts` › "needs a work window for gaps and events in an object scope"

#### Scenario: Events panel nearby
- **WHEN** the events panel renders in an object scope with the bar target at a 10-minute range
- **THEN** it asks `/api/events` with the work window, the switch reads `In view | Nearby`, and the strip count reads `<shown> of <total> events nearby`
- **Evidence:** `apps/web/test/eventsPanel.test.ts` › "asks events for the work window in an object scope"

### Requirement: Signal list loads lazily
In an object scope, `/api/catalog`, `/api/signals` and command checks SHALL use the last linked session's list with `partial: true` at once and SHALL load the vehicle's own list in the `background` class, replacing it when loaded; Unlink SHALL NOT wait for a list. Origin: D-086 consequences („signal list and events lazily"); D-081 (`background`).

#### Scenario: Partial then full
- **WHEN** unlinked on `testcar` with a source whose object-scope `listSignals` is held back, `/api/catalog` is read, the call is released, and `/api/catalog` is read again
- **THEN** the unlink answered before the list call ended; the first read has `partial: true` and entry 0's signals; the object-scope `listSignals` ran in the `background` class; the second read has no `partial` and every testcar signal
- **Evidence:** `apps/server/test/objectScope.http.test.ts` › "loads the object's signal list lazily"

### Requirement: Bounded queries while unlinked
In scoped mode with an object scope, every source call except `ping` SHALL carry a scope, and every `raw`, `buckets` and `count` SHALL lie inside a held scope; the extent call SHALL be the only one bounded by its data ref alone. Origin: D-082 („a guard refuses any query without one"); D-086 („must still keep D-082's rule").

#### Scenario: Unlinked in scoped mode
- **WHEN** a scoped-mode server on a recording adapter opens C4, unlinks, reads the coarse and a detail density, a series over the whole scope, gaps and events for one day, and the catalog
- **THEN** every recorded call is `ping`, the one `refExtent` with `{testcar, TIME_MIN, TIME_MAX}`, or carries a scope on `testcar` with `raw`/`buckets`/`count` ranges inside the object scope
- **Evidence:** `apps/server/test/objectScope.http.test.ts` › "sends no query without a data ref and a time range while unlinked"

### Requirement: Catalog marks on the strip
In an object scope, the strip SHALL mark each catalog session of this vehicle in the drive row as an accent segment at least 4 px wide (hit width ≥ 8 px), hit before drives, the session left outlined, with the tooltip `Session <k> of <n> · <kind> · <local from> – <local to> · <title>`; a click SHALL send `case.go`. Origin: exploration UX sketch („the catalog's sessions of this object show as marks"), accepted by D-086.

#### Scenario: Marks
- **WHEN** the strip renders C4 unlinked from entry 0 on `testcar`
- **THEN** it draws three marks (entries 0, 2, 3; not 1, othercar), entry 0's outlined; a click on entry 2's mark sends `case.go {index: 2}`
- **Evidence:** `apps/web/test/strip.test.ts` › "draws catalog marks of the vehicle"

#### Scenario: Unlinked on smart451
- **WHEN** on smart451 with a catalog from `kipscope case drives smart451` the user clicks **Unlink**, double-clicks the strip, then clicks a mark
- **THEN** the bar reads `VEHICLE`, the strip spans the whole recording with marks for every drive, the windows show the whole recording after the double-click (curves drawn), and the mark click links to that drive with the layout kept
- **Evidence:** UI check on smart451 (one screenshot per step)

### Requirement: Label of an object scope
In an object scope, the strip's right label SHALL read `<shown> of <span> recorded · 1 bar = <width>` and the clamp message SHALL read `Stopped at the end of the vehicle's data.` Origin: necessary consequence of an unbounded scope (no "in scope" edge for the user, D-086).

#### Scenario: Label
- **WHEN** `stripLabel` gets a 10-minute range and a coarse density over 400 days with width 7 d in an object scope
- **THEN** it reads `10 min of 1.1 y recorded · 1 bar = 7 d`
- **Evidence:** `apps/web/test/strip.test.ts` › "labels an object scope"

### Requirement: Measured on a large history
The change SHALL measure M1–M7 of design K11 on ClickHouse and on the Kusto emulator with the synthetic `longcar` history and report each median against its goal; a query more than twice over its goal SHALL be reported to Jan with its named fallback. Origin: D-086 consequences („Cost on a large ADX table is unmeasured; add-case-open must measure it on the emulator and name a fallback").

#### Scenario: Measurement run
- **WHEN** the lead runs `pnpm --filter @kipscope/server seed:long` and `seed:long -- --adx`, then `measure:object -- --source clickhouse --ref longcar` and `-- --source adx --ref longcar`
- **THEN** each run prints the row count and seven lines `M<n> <name> <median ms> goal <ms> <ok|over|2x over>` and exits 0; the pacer records both tables in `rounds.md`, and every `2x over` line has a finding naming its fallback (F1–F5)
- **Evidence:** command output of both runs (shortened in `rounds.md`)
