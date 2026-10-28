# case-preload Specification

## Purpose
Makes the next step through a catalog fast: after the view settles, the server prepares the next and previous catalog entries and the tab fetches the tiles each window will need there, always at the lowest query class, within a budget, and cancelled by any gesture.

Test data: catalog C4 of design "Test fixtures", pad 60 s.

## Requirements

### Requirement: Neighbour preview
`GET /api/case/preview?index=N` SHALL answer `{index, scope, alignAt, alignFallback?}` for entry N (the same scope and point a step there would use) and SHALL warm that session's signal list, density, gap info and events on the server; it SHALL answer 404 `no_case` without a catalog and 400 `invalid_request` for an index ≥ `count`. An entry whose data ref the workspace's effective grant does not cover SHALL be refused with 403 `forbidden_data` and the message `data ref <ref> is not permitted`, as `case.go` and `case.step` refuse it, before any catalog load, cache read, warm-up or source query. Origin: D-078 („die Nachbarn werden im Hintergrund vorgeladen"); exploration "Caching plan" 2, accepted by D-086 Q6; grant check: D-084 („rights limit which data a user can see, in every query, list, view and CLI call, on the server"), review day 2026-10-28 T-03 (the preview checked no grant, so a workspace whose catalog holds an entry outside its grant, e.g. state carried over from identity `none` to a server with sign-in, leaked that entry's alignment point and loaded its source).

#### Scenario: Preview of entry 2
- **WHEN** C4 is open at entry 0 with align `anchor`, and `GET /api/case/preview?index=2` is sent, then `case.go {index: 2}` is posted
- **THEN** the preview answers scope `{testcar, 04:49:00, 05:11:00}` and `alignAt` `"1790830500000000000"`; the step's `listSignals`, density, gap and events reads for that scope are served from the server's caches (no second source call for them)
- **Evidence:** `apps/server/test/case.http.test.ts` › "previews a neighbour in the preload class"

#### Scenario: Bad preview
- **WHEN** `GET /api/case/preview?index=4` is sent with C4 open, and `?index=0` in a workspace without a catalog
- **THEN** the first answers 400 `invalid_request`, the second 404 `no_case`
- **Evidence:** `apps/server/test/case.http.test.ts` › "previews a neighbour in the preload class"

#### Scenario: Preview outside the grant
- **WHEN** on the test server with the test identity, alice's workspace W has an open catalog whose entry 1 has data ref `othercar` while W's effective grant is `["testcar"]` (the tester builds this state: a state dir written by an identity-`none` server and restarted with the test identity, or the grant narrowed through the test app's registry); a recording source notes every call; then `GET /api/w/<W>/case/preview?index=1` and `POST /api/w/<W>/commands {type: "case.go", index: 1}` are sent
- **THEN** both answer 403 `forbidden_data` with the message `data ref othercar is not permitted`; the source received no call naming `othercar` (no `listSignals`, density, gaps or events for its scope); W's revision is unchanged; `GET /api/w/<W>/case/preview?index=0` (a `testcar` entry) still answers 200
- **Evidence:** `apps/server/test/case.http.test.ts` › "refuses a preview outside the grant"

### Requirement: Preload class
A request with `X-KIPscope-Class: preload` to `/api/series`, `/api/extent`, `/api/calendar` or `/api/case/preview` SHALL run its source work in the `preload` class; any other value, or the header on another route, SHALL leave the request `interactive`. Origin: D-081 (`preload`, „D-078 neighbours"; „Background preloading must never delay interactive queries", D-078); `/api/calendar`: D-116 („run in the caller's request class"), named here and in `docs/http-api.md` after the review day 2026-10-28 found both lists without it.

#### Scenario: Class of the source calls
- **WHEN** a recording source notes the class of each call, and the preview, a series request with the header and `case=2`, and a series request without the header are sent
- **THEN** the preview's and the first series request's calls ran as `preload`, the second as `interactive`; with `X-KIPscope-Class: background` a series request also runs `interactive`
- **Evidence:** `apps/server/test/case.http.test.ts` › "previews a neighbour in the preload class"

#### Scenario: Calendar in the preload class
- **WHEN** a stub source records the class of each call, and a calendar request with `X-KIPscope-Class: preload` arrives over HTTP for a month no earlier request computed
- **THEN** its `refBuckets` call records `preload`; `docs/http-api.md` "Request class" names `GET /api/calendar`, and the comment above `withRequestClass` in `apps/server/src/http.ts` names `/api/calendar`
- **Evidence:** `apps/server/test/calendar.test.ts` › "runs in the request's class" (extended by the preload request); `grep -n "api/calendar" docs/http-api.md apps/server/src/http.ts` prints the "Request class" line and the comment line

### Requirement: Series of a catalog entry
`/api/series` and `/api/extent` with `case=N` SHALL be bounded by entry N's scope instead of the workspace's; a signal of another data ref SHALL answer 409 `out_of_scope`. Origin: necessary consequence of preloading tiles for a session the workspace does not show yet (the series route is bounded by one scope, D-082).

#### Scenario: Bounded by the entry
- **WHEN** C4 is open at entry 0 and `/api/series?signal=testcar/Fast_100h.SIG_A&from=2026-10-01T04:00:00Z&to=2026-10-01T06:00:00Z&case=2` is sent, then the same with `othercar/Fast_100h.SIG_A`
- **THEN** every point or bucket start of the first lies in [04:49:00, 05:11:00); the second answers 409 `out_of_scope`
- **Evidence:** `apps/server/test/case.http.test.ts` › "bounds series by a catalog entry"

### Requirement: Tab preloads the neighbours
While a case is linked, 500 ms after the tab's render acknowledgement for the current revision was `complete` with no visible load in flight, the tab SHALL preview the next entry, then the previous one, and fetch for each timeseries window the tiles it will request there (ranges and signals as the step would set them), with `case=N` and the preload header. Origin: D-078 („das nachladen muss für die nächste halt auch noch klappen"); D-085 (neighbours are the list entries before and after).

#### Scenario: Order and tiles
- **WHEN** a fake server answers, C4 is open at entry 2 with one window [04:52:00, 04:54:00) on `testcar/Fast_100h.SIG_A`, and the tab settles
- **THEN** after 500 ms the tab requests the preview of index 3, then the tiles covering [05:00:00, 05:02:00) of `testcar/Fast_100h.SIG_A` with `case=3` and the header, then the preview of index 1 and the tiles covering [23:59:01, 00:01:01) of `othercar/Fast_100h.SIG_A` with `case=1` (align start; nothing before 500 ms)
- **Evidence:** `apps/web/test/preload.test.ts` › "preloads the next and then the previous session"

### Requirement: Preload plan equals the step
The preload SHALL request exactly the tiles (signal, level, index) each window asks for after `case.go {index: N}`, edge tiles included, computed as the loader does (design K13); a window without a known target width SHALL be skipped. Origin: necessary consequence of D-078; round 2 finding (e) (549 s tiles asked after the step, 274 s ones preloaded).

#### Scenario: Plan equals the step's requests
- **WHEN** a fake server answers, C4 is open at entry 2 with two windows on `testcar/Fast_100h.SIG_A`, `w1` [04:52:00, 04:54:00) (inside the session) and `w2` [04:50:00, 05:10:00) (as wide as the session, so its first and last tiles are cut by entry 3's scope), each with a known target width, and the preload for entry 3 runs to its end; then `case.go {index: 3}` is applied and both windows' loaders compute their requests
- **THEN** the set of (signal, level, index) the preload loaded for entry 3 equals the set the two loaders ask for after the step, and no tile is asked twice
- **Evidence:** `apps/web/test/preload.test.ts` › "plans the tiles the step asks for"

#### Scenario: Step after preload draws from memory
- **WHEN** after "Plan equals the step's requests" the step to entry 3 draws both windows; and on smart451, with a catalog of at least 3 drives (`kipscope case drives smart451`, or one the lead supplies), the user waits on drive 2 until the neighbour's preload has finished (its `case=` requests are done; on smart451 this took 0.8–12.7 s in round 5) and presses `]`
- **THEN** in the test no `/api/series` request without `case=` is sent for `w1` or `w2`, edge tiles included, and both loaders end `complete`; on smart451 the network panel shows no `/api/series` request without `case=` for the timeseries windows between the key press and the drawn windows of drive 3 (overview tiles, the loader's prefetch of the next level and of the span after the view (`maybePrefetch`), and extents may load: not preloaded and not drawn, design K13)
- **Evidence:** `apps/web/test/preload.test.ts` › "draws the stepped-to session from the cache" (both windows; it replaces "asks again after a step only for tiles the scope cannot store"); UI check on smart451 (network panel filtered to `/api/series`, one screenshot)

### Requirement: Preload yields and stops
Preload runs SHALL rank below prefetch and share its 2 in-flight slots; a visible load SHALL never wait for them; the tab SHALL stop preloading once 25 % of the cache limit was preloaded since the last step; any pointer down, wheel or key press, any command of the tab and any new revision SHALL abort every preload request. Origin: D-081 („never delay interactive"); exploration "Caching plan" 2 (≤ 25 % of the memory budget, cancelled by any gesture), accepted by D-086 Q6.

#### Scenario: Gesture cancels
- **WHEN** preload requests are in flight and the user presses a key in a window
- **THEN** every preload fetch is aborted, tiles already stored stay, and the preload starts again only after the next settle plus 500 ms
- **Evidence:** `apps/web/test/preload.test.ts` › "cancels the preload on a gesture"

#### Scenario: Budget
- **WHEN** the neighbours' tiles weigh 1.5 M units in all and the cache limit is 4 M
- **THEN** the tab stops before the run that would pass 1,000,000 preloaded units
- **Evidence:** `apps/web/test/preload.test.ts` › "stops at a quarter of the cache"

#### Scenario: Visible first
- **WHEN** two preload runs hold both slots and a window needs a tile not in flight
- **THEN** the visible request starts at once, without waiting for a slot
- **Evidence:** `apps/web/test/preload.test.ts` › "never delays a visible load"
