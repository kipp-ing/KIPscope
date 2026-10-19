## ADDED Requirements

### Requirement: Rules map roles to rights
With an identity adapter other than `none`, the server SHALL read the rules file `KIPSCOPE_RULES` at start (format of design M3) and give a request the union of the rights of every rule whose `role` equals one of its roles: data-ref patterns (globs over the whole data ref, `*` any run of characters, `?` one character, case-sensitive) and the share right. A request whose roles match no rule SHALL have no rights. A missing or invalid rules file SHALL stop the server naming the file and the bad entry. Origin: D-084 („für corp usage brauche ich was mit regeln und rechten"; „nur rollen und recht müssen wirken können"); platform as data-ref patterns: Jan 2026-10-19 („platform ist nur für riesen corp dinger"). Design M3.

#### Scenario: Patterns and union
- **WHEN** `canSee` gets the patterns `["px-*", "demo"]` with the data refs `px-01`, `px-`, `apx-01`, `PX-01`, `demo`, `demo2`, and the patterns `["car-??"]` with `car-01` and `car-1`; and `rightsOf` gets roles `[a, b, zzz]` against rules `a: {data: [x*]}`, `b: {data: [y], share: true}`
- **THEN** `canSee` returns true, true, false, false, true, false, then true, false; `rightsOf` returns `{data: ["x*", "y"], share: true}`
- **Evidence:** `apps/server/test/rights.test.ts` › "matches data-ref patterns and unions roles"

#### Scenario: Rules file checks
- **WHEN** `loadRules` reads a valid file, one with `version: 2`, one with a pattern `a/b`, one naming role `x` twice, one with an unknown key `admin: true`, and a missing path
- **THEN** the first gives its roles; each other throws naming the file and, in order, `version`, `roles[0].data[0]`, `x`, `admin` and the path
- **Evidence:** `apps/server/test/rights.test.ts` › "checks the rules file"

### Requirement: Deny by default
A signed-in user without rights SHALL get 403 `no_rights` on every API route except `GET /api/me` and `GET /api/license`, the live channel included, before any session is created or any source query runs. Origin: D-084 („hier darf nicht jeder nutzer alle platformen sehen"). Design M6.

#### Scenario: Roles that match no rule
- **WHEN** a user with roles `[nobody]` sends `GET /api/me`, `GET /api/workspace`, `GET /api/catalog`, `GET /api/sessions`, `POST /api/sessions {}` and opens `/api/live`
- **THEN** `/api/me` answers 200 with empty rights; the four others answer 403 `no_rights`; the WebSocket gets no message; no session exists afterwards and the source received no call
- **Evidence:** `apps/server/test/rights.http.test.ts` › "refuses users without rights"

### Requirement: One guard for every route
Every route under `/api/` SHALL declare its access level and the data refs it names (design M6 table), and the server SHALL refuse to start when one does not. Every data ref a request names (query parameter, signal ID, command, view document, saved view opened by name) that the user may not see SHALL be refused with 403 `forbidden_data` before any catalog lookup, cache read or source query, with the same status, code and message form whether that data ref exists or not. Origin: D-084 („rights limit which data a user can see, in every query, list, view and CLI call, on the server"; „data-ref filtering at one place"). Design M6.

#### Scenario: Every API route declares its access
- **WHEN** the test app is built and its registered routes are listed, and a test app is built with one extra route `GET /api/x` without `config.access`
- **THEN** every route under `/api/` has an access level of the M6 table; the second build rejects naming `/api/x`
- **Evidence:** `apps/server/test/guard.routes.test.ts` › "every API route declares its access"

#### Scenario: Role A cannot read data refs of role B on any route
- **WHEN** in full mode on the test DB, user `alice` with role `testers` (rule `data: ["test*"]`) sends, for each route of the M6 table that names a data ref, one request naming `othercar` (exists) and one naming `nosuchcar` (absent): `GET /api/extent|series|value?signal=<ref>/X`, `GET /api/density|gaps|events?dataRef=<ref>`, `GET /api/gaps?dataRef=testcar&signal=<ref>/X`, `POST /api/commands` with `window.addSignal <ref>/X`, `events.addSignal <ref>/X`, `scope.set <ref>` and `view.open` of a document with a window on `<ref>/X`, `POST /api/views/open {view}` and `POST /api/sessions {open: {view}}` with such a document, and `POST /api/views/import {view, open: true}`
- **THEN** every request answers 403 `forbidden_data`, the answers for `othercar` and `nosuchcar` are equal after replacing the data ref name, a recording source received no query naming either, no session's revision changed, and no session was created; the case list is built from the registered routes, so a data route without a case fails the test
- **Evidence:** `apps/server/test/rights.http.test.ts` › "keeps role A out of data refs of role B on every route"

#### Scenario: Visible data still answers
- **WHEN** alice (role `testers`) sends `GET /api/series` for `testcar/Fast_100h.SIG_A` and for `testcar/Nope.X`
- **THEN** the first answers 200 with points; the second 404 `unknown_signal` as today
- **Evidence:** `apps/server/test/rights.http.test.ts` › "answers visible data as before"

### Requirement: Lists and counts show visible data only
`GET /api/catalog`, `GET /api/signals` (items and `total`), `GET /api/meta` (`catalog.size`) and the signal lookups of commands SHALL see only signals of data refs the user may see; the shared signal lists and caches SHALL stay shared between users. Origin: D-084 (no user sees every platform); necessary consequence: a count or a search hit reveals data as much as a series does. Design M6 `CatalogView`.

#### Scenario: Filtered catalog
- **WHEN** in full mode on the test DB alice (role `testers`, `test*`) and admin (role `admins`, `*`) read `GET /api/catalog`, `GET /api/signals?q=` and `GET /api/meta`
- **THEN** alice's items and `total` hold only `test*` data refs and her `catalog.size` equals her item count; admin's hold `othercar` too and their size is larger; `listSignals` ran once for both
- **Evidence:** `apps/server/test/rights.http.test.ts` › "filters lists and counts by rights"

#### Scenario: Explorer of a restricted user
- **WHEN** the server runs the example identity module on loopback against carserver with a rules file giving role `cars` the pattern `<carserver data ref>` and role `none-of-it` the pattern `zz-*`; Vite runs on 5173 with `KIPSCOPE_DEV_USER=alice KIPSCOPE_DEV_ROLES=cars` and on 5174 with `KIPSCOPE_DEV_USER=bob KIPSCOPE_DEV_ROLES=none-of-it`
- **THEN** alice's explorer lists signals; bob's explorer lists none and his footer tooltip names role `none-of-it`; bob opening alice's session address sees "No access to this session"
- **Evidence:** UI check (one screenshot per tab)

### Requirement: Sharing never widens data access
A session SHALL be opened (every session-resolving route, the live channel included) only when every data ref of its workspace (scope, window signals, events-line signals) is visible to the requesting user, whatever its owner and share level; otherwise the answer SHALL be 403 `forbidden`, the same as for a private session. A live connection whose user can no longer see every data ref after a command or a share change SHALL be closed with 4403. Setting the share level `read` or `write` SHALL need the share right, else 403 `share_not_permitted`. Origin: D-084 (rights limit the data in every view); necessary consequence: a shared session must not show another user data their roles hide. Refuse rather than filter: design M6 (spec owner's default).

#### Scenario: Shared session with hidden data
- **WHEN** admin (role `admins`, `*`, share) owns session A with a window on `testcar/Fast_100h.SIG_A` and sets it to `write`; alice (role `testers`, `test*`) connects to `/api/s/A/live` and reads `/api/s/A/workspace`; admin adds `othercar/Fast_100h.SIG_A`; alice reads `/api/s/A/workspace` and `/api/s/A/catalog`
- **THEN** alice's first read answers 200; after admin's add her channel is closed with 4403 and both reads answer 403 `forbidden`, with the same body as for a private session
- **Evidence:** `apps/server/test/rights.http.test.ts` › "refuses a shared session holding hidden data"

#### Scenario: Share right
- **WHEN** alice (role `testers`, no share right) owns session A and posts `/api/sessions/A/share` with `read`, `write` and `private`
- **THEN** the first two answer 403 `share_not_permitted` and A stays `private`; the third answers 200
- **Evidence:** `apps/server/test/rights.http.test.ts` › "needs the share right to share"
