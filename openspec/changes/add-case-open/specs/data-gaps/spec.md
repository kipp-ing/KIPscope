# Spec Delta

## MODIFIED Requirements

### Requirement: Gap info of a scope
While the workspace has a scope, `GET /api/gaps` for its data ref SHALL answer the gap info of the scope only (design Z9): logger gaps between rows in the scope, `through` the last row in it, periods measured from its rows. The info SHALL be cached per scope, and the 5-min poll SHALL count only the active scope's rows. In an object scope the same SHALL hold for the asked work window `[from, to)` instead of the whole scope (object-view "Gaps and events follow the view"). Origin: issue #1 item 4; D-078 („nothing scans a data ref's whole history"); object scope: D-086.

#### Scenario: A scope that cuts a logger gap
- **WHEN** the test server has scope {gapcar, `1790985900000000000`, `1790986200000000000`} and `GET /api/gaps?dataRef=gapcar` is sent
- **THEN** `logger` is exactly `[{"from":"1790986180000000000","to":"1790986182000000000"}]` (the 60.02 s pause starts before the scope's first row and is no gap in it) and `through` is `"1790986199980000000"`
- **Evidence:** `apps/server/test/gaps.http.test.ts` › "lists the logger gaps of a scope"

#### Scenario: Scoped queries and poll
- **WHEN** a stub source records its calls, the scope {gapcar, F, T} is set (F = `1790985900000000000`, T = `1790986200000000000`), `/api/gaps?dataRef=gapcar` is sent twice, and one poll runs (fake timers)
- **THEN** the source got one `loggerGaps`, one `firstTimes` and, from the poll, one `refCount` call, each with scope {gapcar, F, T}, and no call without a scope
- **Evidence:** `apps/server/test/gaps.test.ts` › "computes and polls the gap info of a scope"

#### Scenario: Work window in an object scope
- **WHEN** a stub source records its calls, a workspace is unlinked on `gapcar` (object scope), `/api/gaps?dataRef=gapcar&from=2026-10-03T00:00:00Z&to=2026-10-04T00:00:00Z` is sent twice, and one poll runs
- **THEN** the source got one `loggerGaps` and one `firstTimes` call with the scope {gapcar, 2026-10-03, 2026-10-04} and a poll `refCount` with the same scope, and no call with the whole object scope
- **Evidence:** `apps/server/test/gaps.test.ts` › "computes and polls the gap info of a work window"
