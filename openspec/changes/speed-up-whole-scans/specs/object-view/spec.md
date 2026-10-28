## MODIFIED Requirements

### Requirement: Unlink is the whole vehicle
`case.unlink` SHALL set the scope to the span of the open catalog's sessions of the current session's vehicle: the union of `caseScope(entry, pad)` over the catalog's entries on that data ref, widened to keep the current scope inside, marked `object: true`. It SHALL send no source query. Windows and cursors SHALL stay, the catalog SHALL stay, and each window's offset from the alignment point SHALL be kept for Link. Origin: D-117 („An overview across a whole vehicle (its sessions, extent, drives) comes from the search tool's catalog, not from raw data"), which supersedes D-086's extent („unlink ist für den user unbegrenzt") for the source; D-113 (the slow extent query, 12–18 s on 490 M rows, now 19.5 s on 768 M); Questions for Jan Q-3 (default).

#### Scenario: Unlink on testcar
- **WHEN** at entry 0 of C4 with `w1` at [01:02:00, 01:04:00) `case.unlink` is posted
- **THEN** the scope is `{dataRef: "testcar", from: F, to: T, object: true}`, where F is the earliest and T the latest bound of `caseScope` of entries 0, 2 and 3 with C4's pad (entry 1 is on othercar). `w1` is unchanged, `case.linked` is false and `case.linkedRanges.w1` is `{from: "120000000000", to: "240000000000"}`. The source got no call between the command and its answer.
- **Evidence:** `apps/server/test/objectScope.http.test.ts` › "unlinks to the span of the catalog's sessions without a query"

#### Scenario: Extent cached
- **WHEN** within 5 min the same workspace links and unlinks again, and another workspace with C4 open unlinks on `testcar`
- **THEN** no `refExtent` call is made at all, and both unlinked scopes are equal
- **Evidence:** `apps/server/test/objectScope.http.test.ts` › "unlinks to the span of the catalog's sessions without a query"

#### Scenario: One session of the vehicle
- **WHEN** a catalog with a single testcar entry is open and `case.unlink` is posted
- **THEN** the scope is that entry's `caseScope` with `object: true`
- **Evidence:** `packages/shared/test/apply.test.ts` › "unlinks to the span of the catalog's sessions"

### Requirement: Work window
In an object scope, gaps, events and strip drives SHALL cover the work window of the shown range: the view, one view span on each side, at least 6 h in all (centred on the view), at most `KIPSCOPE_SCAN_SPAN` in all (centred on the view's centre), on whole UTC hours, inside the scope. Origin: D-086 consequences („every query follows what is shown"); D-117 (a bound per query); 6 h: design B3.

#### Scenario: Window sizes
- **WHEN** `workWindow` gets, with a 7-day bound in a scope of 400 days: a 10-minute view at 2026-06-10 12:00Z; a 3-day view from 2026-06-10 00:00Z; a 90-day view; and a 10-minute view 2 h after the scope's start
- **THEN** it gives:
  - [06-10 09:00, 06-10 16:00)
  - [06-08 01:00, 06-14 23:00) (166 h, centred on the view's centre)
  - a window of at most 7 d on whole hours around the view's centre
  - a window starting at the scope's `from`
- **Evidence:** `packages/shared/test/case.test.ts` › "computes the work window"

#### Scenario: Object scope keyed apart
- **WHEN** `scopeKey` gets `{testcar, F, T}` and `{testcar, F, T, object: true}`
- **THEN** the keys differ, the second ending in `|object`
- **Evidence:** `packages/shared/test/case.test.ts` › "keys an object scope apart"

### Requirement: Detail around the view
`GET /api/density?dataRef=<ref>&from&to` SHALL answer bars, grid and drives over `[from, to) ∩ scope` by the existing rules, cached per window, within the scan bound. In an object scope, `/api/density` without `from` and `to` SHALL answer 400 `invalid_request` (`from and to are required in an object scope (the work window)`). The strip SHALL draw the drives of the work window from the detail density and step `,` `.` through them. Origin: D-086 („finer on zoom"); D-057 (drives); D-117 (no coarse density over the whole vehicle).

#### Scenario: Detail density
- **WHEN** unlinked on `testcar`, `/api/density?dataRef=testcar&from=2026-10-01T00:00:00Z&to=2026-10-02T00:00:00Z` is sent, then `/api/density?dataRef=testcar`
- **THEN** the first answers without `coarse`, with `drives` inside that day and counts over that day only; the second answers 400 `invalid_request`
- **Evidence:** `apps/server/test/objectScope.http.test.ts` › "answers a detail density for a work window"

#### Scenario: Strip asks for the work window
- **WHEN** the strip renders an object scope with the bar target at a 10-minute range, then the range pans by 1 h, then jumps 10 days
- **THEN** it never asks a density without `from` and `to`; it asks the detail density for the work window, nothing new after the 1-h pan (still inside), and a new detail density after the jump
- **Evidence:** `apps/web/test/strip.test.ts` › "asks the detail density for the work window"

### Requirement: Gaps and events follow the view
In an object scope, `GET /api/gaps` and `GET /api/events` SHALL require `from` and `to` (400 `invalid_request` without them) and SHALL compute over that window only, within the scan bound (422 `too_wide` above it), cached per window. `GET /api/value` SHALL use the gap info of the work window around its time. The 5-min poll SHALL count only held windows. When the work window of the gaps, the events or the detail density answers `too_wide`, the web SHALL ask once more with the shown range itself, and only a second `too_wide` SHALL show as the answer. Origin: D-086 consequences; D-062 (no value across a gap); D-117; the fallback: necessary consequence of a work window larger than the view.

#### Scenario: Gaps and events in an object scope
- **WHEN** unlinked on `testcar`, `/api/gaps?dataRef=testcar` and `/api/events?dataRef=testcar` are sent without a range, then with a 10-day range, then with [2026-10-01T00:00Z, 2026-10-02T00:00Z)
- **THEN** the first of each answers 400 `invalid_request`, the second 422 `too_wide` (span over 7 d); the last answer the same logger gaps and events as a linked scope of that day, and every source call carried a scope inside that day
- **Evidence:** `apps/server/test/objectScope.http.test.ts` › "needs a bounded work window for gaps and events in an object scope"

#### Scenario: Shown range after a too-wide work window
- **WHEN** a gap info store in an object scope asks for the work window of a 10-minute view, the stub answers `too_wide`, the store asks again, and the stub answers that request
- **THEN** the second request carries exactly the shown range; the window's gap state is settled with that answer and no error; had the second answered `too_wide` too, the state would carry that error
- **Evidence:** `apps/web/test/gaps.test.ts` › "falls back to the shown range after a too-wide work window"

#### Scenario: Events panel nearby
- **WHEN** the events panel renders in an object scope with the bar target at a 10-minute range
- **THEN** it asks `/api/events` with the work window, the switch reads `In view | Nearby` (`All` outside an object scope), and the Events tab's count is the shown number with the tooltip `Events within <span> around the view`
- **Evidence:** `apps/web/test/eventsPanel.test.ts` › "asks events for the work window in an object scope"

### Requirement: Bounded queries while unlinked
In scoped mode with an object scope, every source call except `ping` SHALL carry a scope no wider than the scan bound's span, and every `raw`, `buckets` and `count` SHALL lie inside a held scope. Unlink, Link and the strip SHALL cause no `refExtent` and no call over the whole object scope. Origin: D-082 („a guard refuses any query without one"); D-117 („KIPscope never scans the whole data of a source").

#### Scenario: Unlinked in scoped mode
- **WHEN** a scoped-mode server on a recording adapter opens C4, unlinks, reads a detail density for one day, a series over one hour, gaps and events for one day, and the catalog
- **THEN** every recorded call is `ping` or carries a scope on `testcar` of at most 7 d with `raw`/`buckets`/`count` ranges inside the object scope; there is no `refExtent` call and no `listSignals` call with the object scope
- **Evidence:** `apps/server/test/objectScope.http.test.ts` › "sends no query over the whole vehicle while unlinked"

### Requirement: Label of an object scope
In an object scope, the strip's info text (the track's tooltip) SHALL read `<shown> of <span> in catalog`, `<span>` being the object scope's span. The clamp message SHALL read `Stopped at the end of the catalog's sessions.` Origin: necessary consequence of D-117 (the object scope is the span of the catalog's sessions, not of the recorded rows); D-094 (no `1 bar =`).

#### Scenario: Label
- **WHEN** `stripLabel` gets a 10-minute range in an object scope of 400 days, and the same range in a non-object scope of 1 h
- **THEN** it reads `10 min of 1.1 y in catalog`, then `10 min of 1 h in scope`
- **Evidence:** `apps/web/test/strip.test.ts` › "labels an object scope"

### Requirement: Catalog marks on the strip
In an object scope, the strip SHALL mark each catalog session of this vehicle in the drive row:
- each mark is a segment in the text colour (slate-900, not the accent, which marks only the shown range), at least 4 px wide (hit width ≥ 8 px), hit before drives, the session left outlined
- the tooltip is `Session <k> of <n> · <kind> · <start and duration> · <title>`, absent parts left out, start and duration as range-picker "Start and duration" (for example `26-10-01 06:50  0:20 h`)
- a click SHALL send `case.go`

Outside the work window, the marks are all the strip draws: no presence line and no drives there. Origin: exploration UX sketch („the catalog's sessions of this object show as marks"), accepted by D-086; D-117 (vehicle overview from the catalog's sessions); tooltip: D-093; colour: D-095, `apps/web/src/time/strip.css:409-429`.

#### Scenario: Marks
- **WHEN** the strip renders C4 unlinked from entry 0 on `testcar`
- **THEN** it draws three marks (entries 0, 2, 3; not 1, othercar), entry 0's outlined, each at least 4 px wide with a hit width of at least 8 px; entry 2's tooltip starts `Session 3 of 4 · charging · ` and holds `26-10-01 06:50  0:20 h` (Europe/Berlin) but not `07:10`; a click on entry 2's mark sends `case.go {index: 2}`; the presence line is drawn only inside the work window
- **Evidence:** `apps/web/test/strip.test.ts` › "draws catalog marks of the vehicle"

#### Scenario: Unlinked on smart451
- **WHEN** on the scoped dev server, with a catalog from `kipscope case drives smart451 2026-10-20T00:00:00Z 2026-10-28T00:00:00Z`, the user clicks **Unlink**, double-clicks the strip, then clicks a mark
- **THEN** Unlink answers within 1 s without the patience hint. The bar reads `VEHICLE`. The strip spans from the first to the last drive of the catalog (padded) with a mark for every drive; this span (7 d 5 h) is over the 7 d bound, so the track reads `Range too wide for the strip` and draws no presence line (D-117: the vehicle level comes from the catalog's sessions, not from raw data); a span within the bound draws the presence line. After the double-click the windows show that span with curves drawn, and no window shows an error box. The mark click links to that drive with the layout kept.
- **Evidence:** UI check on smart451 (one screenshot per step)

## REMOVED Requirements

### Requirement: Coarse strip over the vehicle
**Reason:** One bucket query over the whole object scope is a whole-vehicle scan, which D-117 forbids. The strip over an object scope shows the catalog's sessions and the detail of the work window instead ("Catalog marks on the strip", "Detail around the view").
**Migration:** `/api/density` in an object scope needs `from` and `to`. The `coarse` field of `Density` stays in the type for one release and is never set; the web stops asking for it.

### Requirement: Signal list loads lazily
**Reason:** The vehicle's own list is a `listSignals` over the whole object scope, a whole-vehicle scan (D-117). Replaced by "Session's signal list while unlinked".
**Migration:** none; `partial: true` stays set for the whole time unlinked.

## ADDED Requirements

### Requirement: Session's signal list while unlinked
In an object scope, `/api/catalog`, `/api/signals` and command checks SHALL use the last linked session's list with `partial: true` while unlinked, and SHALL load no list over the object scope. Origin: D-117 (no whole-vehicle scan); Questions for Jan Q-4 (default: the session's list only).

#### Scenario: Session list only
- **WHEN** unlinked on `testcar` from entry 0 with a recording source, `/api/catalog` is read, 1 s passes and it is read again
- **THEN** both reads have `partial: true` and entry 0's signals, and the source got no `listSignals` call after the unlink
- **Evidence:** `apps/server/test/objectScope.http.test.ts` › "keeps the session's signal list while unlinked"
