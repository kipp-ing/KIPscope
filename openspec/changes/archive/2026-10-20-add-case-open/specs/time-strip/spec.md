# Spec Delta

## MODIFIED Requirements

### Requirement: Density of a scope
While the workspace has a scope, `GET /api/density?dataRef=<scope's data ref>` SHALL cover the scope only (design Z9). `first` is the scope's `from`, `last` is its `to` − 1 ns, and `scope` carries `{from, to}`. Width, grid, counts and drives follow the existing rules over that span. The answer SHALL come from one `refBuckets` query with that scope and no `refExtent` query, and SHALL be cached per scope. In an object scope the answer SHALL be coarse, and with `from` and `to` it SHALL cover `[from, to) ∩ scope` (object-view "Coarse strip over the vehicle", "Detail around the view"). Origin: issue #1 item 4 („The time strip … cover[s] only the scope's range"); D-078; object scope: D-086.

#### Scenario: One hour of testcar
- **WHEN** the test server has scope {testcar, T1, T2} and `GET /api/density?dataRef=testcar` is sent
- **THEN** 200 with `first` `"1790816400000000000"`, `last` `"1790819999999999999"`, `scope` `{from: T1, to: T2}`, `width` `"30000000000"` (15 s would need 240 bars), 120 `counts` whose sum equals `SELECT count() FROM sdlog.signals WHERE vehicle = 'testcar' AND utc >= T1 AND utc < T2`, and `drives` within [T1, T2)
- **Evidence:** `apps/server/test/density.http.test.ts` › "covers only the scope"

#### Scenario: One query per scope
- **WHEN** a stub source records its calls, the scope {testcar, T1, T2} is set, and `/api/density?dataRef=testcar` is sent twice
- **THEN** the source got exactly one `refBuckets` call with that scope and no `refExtent` call
- **Evidence:** `apps/server/test/density.test.ts` › "computes a scope's density from one bucket query"

#### Scenario: Part of a scope
- **WHEN** the scope is {testcar, T1, T2} and `GET /api/density?dataRef=testcar&from=2026-10-01T01:30:00Z&to=2026-10-01T03:00:00Z` is sent, then the same with only `from`
- **THEN** the first answers `first` 01:30:00 and `last` T2 − 1 ns (cut to the scope) with drives inside it; the second answers 400 `invalid_request`
- **Evidence:** `apps/server/test/density.http.test.ts` › "covers part of the scope"

### Requirement: Strip scope controls
With a scope and no open catalog, the strip head SHALL read `SCOPE <ref> · <from> – <to>` in local time, with **Widen** (one `scope.set`, scope "Widen") and, in full mode only, **Clear** (`scope.clear`), all on one line, and the strip SHALL stay at most 56 px tall ("Time strip states"). While a catalog is open, the head SHALL show the session bar instead (case-navigation "Session bar"), with no Widen and no Clear. Origin: D-078 („widening it is an explicit step"); Clear: design Q-1 (a); session bar: D-086, Q-6 (a).

#### Scenario: Scope on smart451
- **WHEN** Jan's view is open on smart451 in full mode with a scope of 2026-10-13 14:00 – 16:00 local, at 1440×900 and at 1000×557; the user double-clicks the strip, clicks **Widen**, then **Clear**
- **THEN** the head shows `SCOPE smart451 · 2026-10-13 14:00 – 2026-10-13 16:00` with Widen and Clear on one line and the strip ≤ 56 px tall at both sizes; the double-click shows 14:00 – 16:00 in the header; after Widen the head reads 12:00 – 18:00 and the explorer reloaded; after Clear the head shows no scope and the bars span the whole recording again
- **Evidence:** UI check on smart451 (one screenshot per step, strip height at both sizes)

#### Scenario: Head with a catalog
- **WHEN** the strip head renders a workspace with a scope and an open catalog, linked and unlinked
- **THEN** it renders the session bar in both cases and neither Widen nor Clear
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "describes the session"
