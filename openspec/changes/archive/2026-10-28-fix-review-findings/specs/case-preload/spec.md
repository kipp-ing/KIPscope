## MODIFIED Requirements

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
