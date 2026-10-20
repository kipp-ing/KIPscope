## ADDED Requirements

### Requirement: Grant per workspace
Each workspace SHALL hold a grant, either `{objects: "all"}` or `{objects: [<data refs>]}` (design M3), stored with the workspace and never taken from a client. The grant SHALL name data refs exactly, with no patterns and no time part.

What a workspace may read:
- With `KIPSCOPE_IDENTITY=none`, every workspace SHALL be able to read every data ref, as today.
- With any other identity, a new workspace SHALL start with an empty grant.
- With any other identity, a stored grant `all` SHALL count as empty.

Roles from the identity adapter SHALL NOT change what a workspace may read.

Origin: D-085 („wir können das rechtemanagement in kiping packen": rights live in KI.ping); D-086 Q11 (no KIPscope rules file) and its decision „rechte haben keinen zeit bezug des objekts" (a grant names vehicles, whoever may see one may see all of it); D-084 („bei mir lokal ohne login, bin mein eigener herr": `none` unchanged); fail closed for state carried over from `none`: necessary consequence of "never taken from a client" (a local state dir must not grant on a server). Design M3.

#### Scenario: Grant functions
- **WHEN**
  - `covers` gets `{objects: "all"}` with `x`; `{objects: ["testcar", "demo"]}` with `testcar`, `demo`, `testcar2`, `TESTCAR` and `test*`; and `{objects: []}` with `testcar`
  - `effectiveGrant` gets `all` and `["a"]` with identity `none`, then `all` and `["a"]` with `oidc`
  - `initialGrant` gets `none` and `module`
- **THEN**
  - `covers` returns true; then true, true, false, false, false; then false
  - `effectiveGrant` returns `all`, `all`, then `[]`, `["a"]`
  - `initialGrant` returns `all` and `[]`
- **Evidence:** `apps/server/test/rights.test.ts` › "covers data refs by grant"

#### Scenario: New workspace on a server sees nothing
- **WHEN**, in full mode on the test DB with the test identity adapter, alice (roles `[kipscope-admin]`) sends `POST /api/workspaces {}`, then `GET /api/w/<id>/catalog`, `GET /api/w/<id>/signals?q=`, `GET /api/w/<id>/meta` and `GET /api/w/<id>/series?signal=testcar/Fast_100h.SIG_A&…`
- **THEN**
  - the create answers 200 with `granted` 0
  - the catalog and the signals list nothing, with `total` 0, and the meta's `catalog.size` is 0
  - the series answers 403 `forbidden_data`
  - the recording source received no series query
- **Evidence:** `apps/server/test/rights.http.test.ts` › "starts a server workspace with an empty grant"

#### Scenario: Carried-over grant on a server
- **WHEN** a state dir from `none` mode holds a workspace with grant `all` and a window on `testcar/Fast_100h.SIG_A`, and the server starts on it with the test identity adapter as user `local`
- **THEN** `GET /api/w/<id>/workspace` answers 200 with `granted` 0, and `GET /api/w/<id>/series` for that signal answers 403 `forbidden_data`
- **Evidence:** `apps/server/test/rights.http.test.ts` › "reads a stored all as empty on a server"

#### Scenario: Local mode unchanged
- **WHEN**, in `none` mode on the test DB, `POST /api/workspaces {}` is sent, then `GET /api/w/<id>/series` for `othercar/Fast_100h.SIG_A`
- **THEN** the create answers `granted` `all`, and the series answers 200 with points
- **Evidence:** `apps/server/test/rights.http.test.ts` › "grants everything in local mode"

### Requirement: Only the server widens a grant
One server function SHALL add data refs to a workspace's grant: `WorkspaceRegistry.grantObjects(workspaceId, dataRefs)` (design M3). It adds them uniquely, is a no-op on `all`, persists the grant, and notifies open live clients. Nothing else SHALL widen a grant:
- `POST /api/workspaces` SHALL refuse a body with a `grant` key (400)
- no command SHALL change a grant
- a view document SHALL NOT carry one

More than 2,000 objects SHALL be refused, leaving the grant unchanged.

Origin: D-085 (KIPscope "can no longer trust a plain handoff link: KI.ping must vouch for it"); D-086 Q10 (signed catalog, verified by `add-case-open`, which calls this function); necessary consequence: a grant a client could set would undo D-085. 2,000: design M3 "Numbers".

#### Scenario: Widening
- **WHEN**, on a registry in `oidc` mode, `grantObjects` gets:
  1. workspace A with `["testcar"]`
  2. A with `["othercar", "testcar"]`
  3. an unknown ID
  4. A with 1,999 new data refs
- **THEN**
  - after the first call, A's grant is `["testcar"]`, its file holds it, and one `onChange` event of type `grant` fired
  - after the second, `["testcar", "othercar"]`
  - the unknown ID gives `undefined`
  - the last throws `GrantLimitError`, and A's grant is still the two
- **Evidence:** `apps/server/test/workspaces.test.ts` › "widens a grant only through grantObjects"

#### Scenario: A client cannot set a grant
- **WHEN**, with the test identity adapter, alice sends:
  - `POST /api/workspaces {grant: {objects: "all"}}`
  - `POST /api/commands {type: "grant.set", objects: "all"}`
  - `POST /api/views/import {view: <document without windows plus a top-level grant: {objects: "all"}>, open: true}` to her workspace with an empty grant
- **THEN**
  - the first answers 400 and creates no workspace
  - the second answers 400 as an unknown command
  - the third answers 200, and her workspace's `granted` stays 0
  - `grep -rn "grantObjects(" apps/server/src` prints only the method's definition in `apps/server/src/workspaces.ts`
- **Evidence:** `apps/server/test/rights.http.test.ts` › "takes no grant from a client"; the grep

### Requirement: One guard for every route
Every route under `/api/` SHALL declare its access level and the data refs it names (design M6 table), and the server SHALL refuse to start when one does not. Every data ref a request names (query parameter, signal ID, command, view document, saved view opened by name) that the workspace's grant does not cover SHALL be refused with 403 `forbidden_data`, before any catalog lookup, cache read or source query. The status, code and message form SHALL be the same whether that data ref exists or not. For `POST /api/workspaces {open}` the check SHALL use the grant the new workspace gets.

Origin: D-084 („rights limit which data a user can see, in every query, list, view and CLI call, on the server"; „data-ref filtering at one place"); D-085 (the grant is KI.ping's, enforced by KIPscope's guard, exploration "Security" and Q11). Design M6.

#### Scenario: Every API route declares its access
- **WHEN** the test app is built and its registered routes are listed, and a test app is built with one extra route `GET /api/x` without `config.access`
- **THEN** every route under `/api/` has an access level of the M6 table (`public`, `user`, `workspace` or `change`); the second build rejects, naming `/api/x`
- **Evidence:** `apps/server/test/guard.routes.test.ts` › "every API route declares its access"

#### Scenario: A workspace keeps to its grant on every route
- **WHEN**
  - in full mode on the test DB with the test identity adapter, alice's workspace W has the grant `["testcar"]`
  - for each route of the M6 table that names a data ref, alice sends one request to W naming `othercar` (exists) and one naming `nosuchcar` (absent):
    - `GET /api/extent|series|value?signal=<ref>/X`
    - `GET /api/density|gaps|events?dataRef=<ref>`
    - `GET /api/gaps?dataRef=testcar&signal=<ref>/X`
    - `POST /api/commands` with `window.addSignal <ref>/X`, `events.addSignal <ref>/X`, `scope.set <ref>`, and `view.open` of a document with a window on `<ref>/X`
    - `POST /api/views/open {view}` with such a document
    - `POST /api/views/import {view, open: true}`
  - she also sends `POST /api/workspaces {open: {view}}` with such a document
- **THEN**
  - every request answers 403 `forbidden_data`
  - the answers for `othercar` and `nosuchcar` are equal after replacing the data ref name
  - a recording source received no query naming either
  - W's revision is unchanged, and no workspace was created
  - the case list is built from the registered routes, so a data route without a case fails the test
- **Evidence:** `apps/server/test/rights.http.test.ts` › "keeps a workspace to its grant on every route"

#### Scenario: Granted data still answers
- **WHEN** alice's workspace W (grant `["testcar"]`) asks `GET /api/series` for `testcar/Fast_100h.SIG_A` and for `testcar/Nope.X`
- **THEN** the first answers 200 with points; the second answers 404 `unknown_signal`, as today
- **Evidence:** `apps/server/test/rights.http.test.ts` › "answers granted data as before"

### Requirement: Lists and counts show granted data only
`GET /api/catalog`, `GET /api/signals` (items and `total`), `GET /api/meta` (`catalog.size`) and the signal lookups of commands SHALL see only signals of data refs the workspace's grant covers. The shared signal lists and caches SHALL stay shared between workspaces.

Origin: D-084 (not every user sees every platform; now decided by KI.ping, D-085); necessary consequence: a count or a search hit reveals data as much as a series does. Design M6 `CatalogView`.

#### Scenario: Filtered catalog
- **WHEN**, in full mode on the test DB, workspace W1 (grant `["testcar"]`) and workspace W2 (grant `["testcar", "othercar"]`) read `GET /api/catalog`, `GET /api/signals?q=` and `GET /api/meta`
- **THEN**
  - W1's items and `total` hold only `testcar` signals, and its `catalog.size` equals its item count
  - W2's hold `othercar` too, and its size is larger
  - `listSignals` ran once for both
- **Evidence:** `apps/server/test/rights.http.test.ts` › "filters lists and counts by grant"

### Requirement: Sharing never widens data access
An invited user SHALL see in a shared workspace exactly what its grant covers. Sharing SHALL NOT widen the invited user's own workspaces:
- a workspace they create, and a view they open or copy from the shared one, gets the initial grant

Only users of the same identity provider SHALL be invited: the server's one adapter and, for `oidc`, its one issuer. Setting the share level `read` or `write` SHALL answer 403 `share_not_permitted` when `KIPSCOPE_SHARE` is `off`, and `private` SHALL always be allowed.

Origin: D-085 (KI.ping decides what each user sees); D-084 (share levels stay; sharing must not show data the user's rights hide); the lead's brief 2026-10-20: the receiver gets read or write only within the same Ping tenant. What the receiver sees follows the recommendation of open question Q-6 (proposal); the stricter alternative changes the first sentence only. Share switch: spec owner's default (design "Revision", item 4).

#### Scenario: Invited user and the owner's grant
- **WHEN**
  - alice's workspace A has the grant `["testcar"]` and a window on `testcar/Fast_100h.SIG_A`, and she sets `read`
  - bob reads `/api/w/A/catalog` and `GET /api/w/A/series` for that signal
  - bob posts `POST /api/workspaces {open: {view: <A's workspace as a view>}}`, then `POST /api/workspaces {}`, and reads `/api/w/<bob's new>/catalog`
- **THEN**
  - bob's catalog of A lists `testcar` signals, and the series answers 200
  - his open answers 403 `forbidden_data` and creates no workspace
  - his new workspace has `granted` 0 and an empty catalog
- **Evidence:** `apps/server/test/rights.http.test.ts` › "shows an invited user the shared grant only there"

#### Scenario: Another issuer cannot be invited
- **WHEN** the test server runs `oidc` against a local JWKS server, and `GET /api/w/A/workspace` of a `write` workspace is sent with a token signed by the same key but `iss` `https://other.example`
- **THEN** it answers 401 `invalid_token`
- **Evidence:** `apps/server/test/identity/oidc.test.ts` › "refuses a token of another issuer on a workspace route"

#### Scenario: Share switch
- **WHEN** with `KIPSCOPE_SHARE=off` alice owns workspace A and posts `/api/workspaces/A/share` with `read`, `write` and `private`; and `loadConfig` reads `KIPSCOPE_SHARE` unset, `off`, and `maybe`
- **THEN**
  - the first two posts answer 403 `share_not_permitted`, and A stays `private`
  - the third answers 200
  - the config gives `share` true, then false; `maybe` throws naming `KIPSCOPE_SHARE`
- **Evidence:** `apps/server/test/rights.http.test.ts` › "needs sharing turned on to share"; `apps/server/test/config.test.ts` › "reads the auth settings"

### Requirement: A view grants nothing
Opening a view (by name, by document, by link or through the CLI) SHALL show only data that the grant of the workspace it opens into covers. A view's data refs outside that grant SHALL be refused with `forbidden_data`. Saving or importing a view without opening it SHALL need no grant.

Origin: D-086 Q13 („a saved view or `#view=` link opens only data the user's current workspace grant covers; a view alone grants nothing").

#### Scenario: View into a granted workspace
- **WHEN** alice has a saved view `both` with windows on `testcar/Fast_100h.SIG_A` and `othercar/Fast_100h.SIG_A`, and posts `POST /api/w/W/views/open {name: "both"}` to her workspace W, first with grant `["testcar"]`, then with grant `["testcar", "othercar"]`; and she imports `both` again without `open` while W's grant is empty
- **THEN**
  - the first open answers 403 `forbidden_data` naming `othercar`, and W's revision is unchanged
  - the second answers 200 with two windows
  - the import answers 200
- **Evidence:** `apps/server/test/rights.http.test.ts` › "opens a view only within the grant"

#### Scenario: Explorer of a server workspace
- **WHEN**
  - the server runs the example identity module on loopback against carserver
  - alice's workspace is granted the carserver data ref (`scripts/grant.ts`, workspaces "Gate on a server workspace without data")
  - Vite runs on 5173 with `KIPSCOPE_DEV_USER=alice` and on 5174 with `KIPSCOPE_DEV_USER=bob`
  - bob opens `/` on 5174 and then alice's private workspace address
- **THEN**
  - alice's explorer lists signals
  - bob first sees "Open a session from KI.ping", then "No access to this workspace"
  - his footer tooltip names his roles
- **Evidence:** UI check (one screenshot per tab)
