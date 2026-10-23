# time-strip delta

T1 = 2026-10-01T01:00:00Z = `1790816400000000000`, T2 = 02:00:00Z = `1790820000000000000` (test DB `testcar`).

## ADDED Requirements

### Requirement: Density of a scope
While the workspace has a scope, `GET /api/density?dataRef=<scope's data ref>` SHALL cover the scope only (design Z9). `first` is the scope's `from`, `last` is its `to` − 1 ns, and `scope` carries `{from, to}`. Width, grid, counts and drives follow the existing rules over that span. The answer SHALL come from one `refBuckets` query with that scope and no `refExtent` query, and SHALL be cached per scope. Origin: the ADX feedback item 4 („The time strip … cover[s] only the scope's range"); D-078.

#### Scenario: One hour of testcar
- **WHEN** the test server has scope {testcar, T1, T2} and `GET /api/density?dataRef=testcar` is sent
- **THEN** 200 with `first` `"1790816400000000000"`, `last` `"1790819999999999999"`, `scope` `{from: T1, to: T2}`, `width` `"30000000000"` (15 s would need 240 bars), 120 `counts` whose sum equals `SELECT count() FROM sdlog.signals WHERE vehicle = 'testcar' AND utc >= T1 AND utc < T2`, and `drives` within [T1, T2)
- **Evidence:** `apps/server/test/density.http.test.ts` › "covers only the scope"

#### Scenario: One query per scope
- **WHEN** a stub source records its calls, the scope {testcar, T1, T2} is set, and `/api/density?dataRef=testcar` is sent twice
- **THEN** the source got exactly one `refBuckets` call with that scope and no `refExtent` call
- **Evidence:** `apps/server/test/density.test.ts` › "computes a scope's density from one bucket query"

### Requirement: Strip shows the scope
While the workspace has a scope, the strip SHALL show the scope's data ref whatever the windows hold, and its right label SHALL read `<shown> of <span> in scope · 1 bar = <width>`; in scoped mode without a scope it SHALL show `No scope set`. Double-click, drive clicks and drive keys then act within the scope. Origin: the ADX feedback item 4 („The time strip … cover[s] only the scope's range"); D-078.

#### Scenario: Label with a scope
- **WHEN** `stripLabel` gets the range [T1 + 10 min, T1 + 20 min), a density with `scope` [T1, T2) and width 30 s
- **THEN** it reads `10 min of 1 h in scope · 1 bar = 30 s`; without `scope` the label is the existing `… recorded …` text
- **Evidence:** `apps/web/test/strip.test.ts` › "labels the shown span within the scope"

#### Scenario: Data ref of the strip
- **WHEN** the strip's data-ref choice gets a workspace with scope on `testcar` whose only window shows `othercar/Fast_100h.SIG_A`, and the same workspace without scope
- **THEN** it gives `testcar`, then `othercar`
- **Evidence:** `apps/web/test/strip.test.ts` › "takes the scope's data ref"

### Requirement: Strip scope controls
With a scope, the strip head SHALL read `SCOPE <ref> · <from> – <to>` in local time, with **Widen** (one `scope.set`, scope "Widen") and, in full mode only, **Clear** (`scope.clear`), all on one line, and the strip SHALL stay at most 56 px tall ("Time strip states"). Origin: D-078 („widening it is an explicit step"); Clear: design Q-1 (a).

#### Scenario: Scope on smart451
- **WHEN** Jan's view is open on smart451 in full mode with a scope of 2026-10-13 14:00 – 16:00 local, at 1440×900 and at 1000×557; the user double-clicks the strip, clicks **Widen**, then **Clear**
- **THEN** the head shows `SCOPE smart451 · 2026-10-13 14:00 – 2026-10-13 16:00` with Widen and Clear on one line and the strip ≤ 56 px tall at both sizes; the double-click shows 14:00 – 16:00 in the header; after Widen the head reads 12:00 – 18:00 and the explorer reloaded; after Clear the head shows no scope and the bars span the whole recording again
- **Evidence:** UI check on smart451 (one screenshot per step, strip height at both sizes)
