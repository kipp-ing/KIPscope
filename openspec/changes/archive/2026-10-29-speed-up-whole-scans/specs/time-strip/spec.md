## MODIFIED Requirements

### Requirement: Density cached
The server SHALL compute a data ref's density at most once per catalog load: concurrent requests share one computation, a failed or `too_wide` one is not cached, and a catalog reload makes the next request compute it again. After each successful catalog load in full mode the server SHALL start the computation, without a request and one ref after another, only for the data refs whose `refCount` is within the scan bound's rows (scope "Scan bound"); the others are left to a request, which answers `too_wide`. Origin: necessary consequence of carserver's 2 GB RAM (D-007) and of a strip shown on every page load; prefetch: D-055 Q4; bound: D-117.

#### Scenario: Cache
- **WHEN** a test source counts its queries, three `/api/density?dataRef=testcar` requests arrive at once, then one more, then the catalog is refreshed and one more arrives; separately the first computation fails and a second request follows
- **THEN** the first four requests cause three source queries in all (the row count of the bound, the extent and the bucket query) and get the same body; after the refresh two more (the extent and the bucket query; the count is still held, being younger than 5 min); after the failure the second request queries again
- **Evidence:** `apps/server/test/density.test.ts` › "computes once per catalog load, shares and does not cache failures"

#### Scenario: Prefetch
- **WHEN** a test source counts its queries and records their data refs, the catalog loads with data refs `testcar` and `othercar` and no request is sent; then `/api/density?dataRef=testcar` is sent; separately the prefetch of `testcar` fails and a request for `testcar` follows; separately the bound's rows are set below testcar's row count and the catalog loads again
- **THEN** after the load the source gets the density queries of both refs without a request, the second ref's only after the first ref's finished; the later request causes no further source query and gets the prefetched body; after the failed prefetch the request queries again; with the lower bound the prefetch sends only testcar's `refCount` and no extent or bucket query for it
- **Evidence:** `apps/server/test/density.http.test.ts` › "computes after the catalog load without a request, and a request does not recompute"

### Requirement: Density queries cheap
A density computation SHALL run through the query queue as one row count for the scan bound (shared with the other checks of the same range) and then two queries that read only the data-ref and time columns, the second grouping on the drive grid into at most 48,000 buckets (120 bars × 400), with nothing sorted per row; the bars are summed from the grid buckets on the server (design T7 of `adopt-design-language`, S3). A scope's density needs no extent query ("Density of a scope"). Origin: necessary consequence of carserver's 2 GB RAM (D-007); queue: `series-query` concurrency; grid: D-057 (drives need a finer resolution than the bars); count: D-117.

#### Scenario: Cost on carserver
- **WHEN** the dev server runs scoped against carserver in a workspace with scope `smart451 2026-10-27T00:00:00Z 2026-10-28T00:00:00Z`, and `curl -s -o /dev/null -w '%{time_total}\n' 'localhost:7310/api/w/<id>/density?dataRef=smart451'` runs twice; then the same with a 1 h scope 2026-10-27T10:00:00Z … 11:00:00Z
- **THEN** all four answer 200. Goals, measured and reported but not pass/fail: the first call of the day ≤ 15 s, of the hour ≤ 2 s, any second ≤ 0.1 s.
- **Evidence:** the commands (four times in `rounds.md`)

#### Scenario: Grid query
- **WHEN** a test source records the widths it is asked to group on and `/api/density?dataRef=testcar` is sent
- **THEN** the source gets one extent query and one bucket query with width 1.5 s (the grid, not the 10 min bars), and the answered `counts` equal the grid buckets summed per bar
- **Evidence:** `apps/server/test/density.test.ts` › "groups on the grid and sums the bars"

### Requirement: Density of a scope
While the workspace has a scope, `GET /api/density?dataRef=<scope's data ref>` SHALL cover the scope only (design Z9): `first` is the scope's `from`, `last` its `to` − 1 ns, and `scope` carries `{from, to}`. Width, grid, counts and drives follow the existing rules over that span. The answer SHALL come from one `refBuckets` query with that scope after the scan bound passed, with no `refExtent` query, and SHALL be cached per scope. After a scope's signal list loads, the server SHALL compute that density in the background; an object scope has none ("Detail around the view" of object-view). With `from` and `to` it SHALL cover `[from, to) ∩ scope`. Origin: the ADX feedback item 4 („The time strip … cover[s] only the scope's range"); D-078; object scope: D-086, D-117.

#### Scenario: One hour of testcar
- **WHEN** the test server has scope {testcar, T1, T2} and `GET /api/density?dataRef=testcar` is sent
- **THEN** 200 with `first` `"1790816400000000000"`, `last` `"1790819999999999999"`, `scope` `{from: T1, to: T2}`, `width` `"30000000000"` (15 s would need 240 bars), 120 `counts` whose sum equals `SELECT count() FROM sdlog.signals WHERE vehicle = 'testcar' AND utc >= T1 AND utc < T2`, and `drives` within [T1, T2)
- **Evidence:** `apps/server/test/density.http.test.ts` › "covers only the scope"

#### Scenario: One query per scope
- **WHEN** a stub source records its calls, the scope {testcar, T1, T2} is set, and `/api/density?dataRef=testcar` is sent twice
- **THEN** the source got exactly one `refBuckets` call with that scope, at most one `refCount` call with that scope, and no `refExtent` call
- **Evidence:** `apps/server/test/density.test.ts` › "computes a scope's density from one bucket query"

#### Scenario: Part of a scope
- **WHEN** the scope is {testcar, T1, T2} and `GET /api/density?dataRef=testcar&from=2026-10-01T01:30:00Z&to=2026-10-01T03:00:00Z` is sent, then the same with only `from`
- **THEN** the first answers `first` 01:30:00 and `last` T2 − 1 ns (cut to the scope) with drives inside it; the second answers 400 `invalid_request`
- **Evidence:** `apps/server/test/density.http.test.ts` › "covers part of the scope"

### Requirement: Time strip states
The track SHALL show, in each state:
- Without a signal: `No signal shown` in the muted colour inside its box.
- While loading, and while a session step is on its way (case-navigation "Stepping shows the target at once"): `Loading recording…` at the track's left over the 1 px baseline, with no presence line, drives or pins, and the track tooltip `Loading recording…`.
- After a `too_wide` answer: `Range too wide for the strip` in the muted colour inside the track's box, with the answer's message as the tooltip. No retry until the scope or the shown range changes.
- After another failure: `Recording unavailable` in the muted colour inside the track's box, with the failure as the tooltip, retrying every 30 s.
- Without a timeseries window: no accent and no window.

The strip SHALL be 28 px tall and its end-label slots 48 px wide in every state, empty while their times are unknown. It SHALL keep the plot share of `workspace-layout` "Screen use".

Goal (reported, not pass/fail): while loading in a scope, the end labels, the shown range, the cursor lines and their flags are already drawn (mock row "Recommended", loading strip).

Origin: necessary consequence (the strip must not move windows or hide data); 30 s: the load retry cap of D-042; one box in every state: D-092 („Layout never moves") and D-094 („same in a session, unlinked, scoped or loading"); too wide: concept §10 and D-117.

#### Scenario: Strip states
- **WHEN** the workspace has no window; then only a values window with one signal; then the source is unreachable at page load; then the density answers `too_wide`
- **THEN** the track shows `No signal shown`; then the presence line with a track tooltip `<recorded> recorded` and no accent; then `Recording unavailable` in the muted colour, and the line appears without a reload within 30 s after the source is back; then `Range too wide for the strip` with the `too wide:` message as tooltip and no further density request within 60 s. The strip is 28 px tall and each end slot 48 px wide in all four states (±0.5 px), and no window moves when the state changes.
- **Evidence:** UI check (screenshot per state, strip heights, end slot widths); `apps/web/test/strip.test.ts` › "takes the data ref of the target window, else of any window", "shows a too-wide strip without retrying"

#### Scenario: Screen use with the strip
- **WHEN** the six-window setup is shown at 1000×557 with the sidebar open and the strip loaded
- **THEN** the plot share from design M1's snippet is at least 30 % (`workspace-layout` "Screen use")
- **Evidence:** UI check on smart451 at 1000×557 (snippet output, screenshot)
