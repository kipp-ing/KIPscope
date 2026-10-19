## ADDED Requirements

### Requirement: A workspace per session
The server SHALL hold any number of sessions. Each is one workspace with its own revision, live clients, render acknowledgements and state file, plus an ID of 10 characters `[a-z0-9]`, an owner (the user who created it), a share level, a creation time and a last-active time (set on create, live connect and each accepted command). A command in one session SHALL never change another. Origin: D-083 („Every session (one opened case, its own workspace) carries rights"); Jan's „ja" to a workspace per session with its own URL; D-079 („each in their own workspaces"). Design M4.

#### Scenario: Sessions stay apart
- **WHEN** alice creates sessions A and B with `POST /api/sessions {}`, posts `window.create` three times to `/api/s/A/commands`, and reads `/api/s/B/workspace`
- **THEN** both IDs match `^[a-z0-9]{10}$` and differ; A's revision is 3; B's revision is 0 with no windows; `GET /api/sessions/A` shows `owner` `alice`, `share` `private`, `windows` 3
- **Evidence:** `apps/server/test/sessions.http.test.ts` › "keeps sessions apart"

### Requirement: Session address
Every route that reads or changes a workspace (design M5 list) SHALL also answer as `/api/s/<id>/<rest>` for session `<id>`, and every answer that served a session SHALL carry the header `X-KIPscope-Session: <id>`. An ID of the right form that names no session SHALL answer 404 `unknown_session`. The UI page of a session SHALL be `/s/<id>`. Origin: Jan's „ja" (old tabs keep their case: the case is in the address); concept §7 (the CLI addresses the open view). Design M5.

#### Scenario: Prefix routes
- **WHEN** alice posts `window.create` to `/api/s/A/commands`, reads `/api/s/A/workspace`, opens `/api/s/A/live`, and reads `/api/s/zzzzzzzzzz/workspace`
- **THEN** the workspace has the window and the answer carries `x-kipscope-session: A`; the live channel sends `hello`, then `session` with `id` A, then `state` with A's revision; the last answers 404 `unknown_session`
- **Evidence:** `apps/server/test/sessions.http.test.ts` › "addresses a session by its prefix"

### Requirement: Default session
A request to a workspace route without the prefix SHALL serve the requester's default session: the session they own with the latest last-active time, or a new empty one when they own none. Origin: spec owner's default (design "Spec owner's defaults"): today's routes, scripts and the CLI without `--session` keep working.

#### Scenario: Most recently active
- **WHEN** on an empty state dir `GET /api/workspace` is sent, then `POST /api/sessions {}`, then `GET /api/workspace`, then `cursor.set` is posted to `/api/s/<first>/commands`, then `GET /api/workspace` again
- **THEN** the first answer creates a session S1 and names it in `x-kipscope-session`; the second create makes S2; the next read names S2; after the command the read names S1; `GET /api/sessions` lists S1 then S2
- **Evidence:** `apps/server/test/sessions.http.test.ts` › "serves the most recently active session without a prefix"

### Requirement: Rights per session
The owner SHALL have every right on a session. Other signed-in users SHALL get rights from the share level: `private` none, `read` open, `write` open and change. A session route without the open right SHALL answer 403 `forbidden`. A change route (design M6 table) without the change right SHALL answer 403 `read_only` and change nothing. Only the owner SHALL change the share level or delete the session, else 403 `not_owner`. One function SHALL decide rights (design M6). Origin: D-083 („who may open and change it"); Q-3 (a); D-079 (one place for later access control).

#### Scenario: Private, read, write
- **WHEN** in header mode alice owns session A with a scope and one window, and bob sends `GET /api/s/A/workspace` and opens `/api/s/A/live` while A is `private`; alice posts `/api/sessions/A/share {share: "read"}`, and bob reads `/api/s/A/workspace`, `/api/s/A/catalog`, posts `window.create` to `/api/s/A/commands` and `POST /api/s/A/views/open {name: "x"}`; alice sets `write`, and bob posts `window.create`; bob posts `/api/sessions/A/share {share: "private"}` and `DELETE /api/sessions/A`
- **THEN** while private: 403 `forbidden`, and the WebSocket gets no message; while read: both reads 200, both posts 403 `read_only` with A's revision unchanged; while write: the command is accepted; bob's share and delete answer 403 `not_owner`, and A still exists
- **Evidence:** `apps/server/test/sessions.http.test.ts` › "enforces session rights"

#### Scenario: Rights function
- **WHEN** `rightsOf` gets the owner, then another user for a `private`, a `read` and a `write` session
- **THEN** it returns `{open: true, change: true, owner: true}`, `undefined`, `{open: true, change: false, owner: false}` and `{open: true, change: true, owner: false}`
- **Evidence:** `apps/server/test/rights.test.ts` › "derives rights from owner and share level"

### Requirement: Share changes act at once
After a share change, every open live connection to the session SHALL get a `session` message with its user's new rights, and a connection whose user lost the open right SHALL be closed with code 4403. Deleting a session SHALL close its connections with code 4404. Origin: necessary consequence of "Rights per session" (a right taken away must not keep working through an open channel).

#### Scenario: Bob loses rights
- **WHEN** A is `write`, bob is connected to `/api/s/A/live`, and alice sets `read`, then `private`; then a new bob connection under `write` is open and alice deletes A
- **THEN** bob's channel gets `session` with `rights.change` false after the first change, and is closed with 4403 after the second; the last connection is closed with 4404 and `GET /api/sessions/A` answers 404 `unknown_session`
- **Evidence:** `apps/server/test/sessions.http.test.ts` › "applies share changes and deletes to open connections"

### Requirement: Session management
`GET /api/sessions` SHALL list the requester's own sessions, latest last-active first, as `SessionSummary` (design M7). `GET /api/sessions/:id` SHALL return one summary (open right). `POST /api/sessions` SHALL create one. `POST /api/sessions/:id/share` SHALL set the share level. `DELETE /api/sessions/:id` SHALL delete the session and its state file. Origin: necessary consequence of „a workspace per session" (a user must find and remove their sessions); D-083 (rights per session).

#### Scenario: List, share, delete
- **WHEN** alice creates two sessions and posts a scope to the first, bob creates one, alice reads `GET /api/sessions`, sets the first to `write`, and deletes the second
- **THEN** alice's list holds her two sessions only, the first carries `scope`, `clients` 0 and `rights.owner` true; the share answer shows `share` `write`; the delete answers `{deleted: <id>}`, the session's file is gone, and her list holds one session
- **Evidence:** `apps/server/test/sessions.http.test.ts` › "lists, shares and deletes sessions"

### Requirement: Create with an open view
`POST /api/sessions {open}` SHALL create a session and open a saved view (`{name}`) or a view document (`{view}`) in it as one step. When the open fails, no session SHALL be created and the answer SHALL be the failed command result with its usual status. Origin: concept §9 („Untersuchung direkt öffnen … über CLI beziehungsweise Link"); D-078 (the finder's handoff opens a case: `add-case-open` extends this request); necessary consequence of links opening a new session (saved-views "Open from the address").

#### Scenario: Open into a new session
- **WHEN** alice posts `/api/sessions {open: {view: <v1 document with two windows>}}`, then `/api/sessions {open: {view: {kipscope: "view", version: 9}}}`, then `/api/sessions {open: {name: "nope"}}`
- **THEN** the first answers 200 with `session.windows` 2 and `result.ok` true; the second answers 422 with code `unsupported_version`; the third 404 `unknown_view`; `GET /api/sessions` lists one session
- **Evidence:** `apps/server/test/sessions.http.test.ts` › "creates a session with an open view"

### Requirement: Sessions survive a restart
Each session SHALL be written to `<stateDir>/sessions/<id>.json` with owner, share level, times, revision and workspace, at most 500 ms after its last change and at once on `SIGINT` or `SIGTERM`, atomically. At start every session file SHALL be restored. A file that is not a valid session SHALL be moved to `<id>.bad.json` with one warning, while the other sessions load. Origin: concept §8 („Speichern/Laden"); workspace-state "Workspace survives a restart", now per session. Design M4.

#### Scenario: Restart keeps every session
- **WHEN** a session store on a temp state dir has alice's session A (5 commands, share `read`) and bob's B (2 commands), `flush()` runs, and a new store is built from the same dir
- **THEN** A and B have the same workspaces, revisions 5 and 2, owners, share levels and times; the next command on A gets revision 6
- **Evidence:** `apps/server/test/sessions.persist.test.ts` › "restores every session"

#### Scenario: Broken session file
- **WHEN** `sessions/` holds A's valid file and `bbbbbbbbbb.json` with `{"kipscope":"session","version":1}`
- **THEN** the store holds A; `bbbbbbbbbb.bad.json` holds that text; one warning names the file
- **Evidence:** `apps/server/test/sessions.persist.test.ts` › "moves a broken session file aside"

### Requirement: Migration from the single workspace
At start, when `<stateDir>/workspace.json` exists and `<stateDir>/sessions/` does not, the server SHALL turn that workspace and revision into a session owned by `local` and rename the file `workspace.migrated.json`. When `<stateDir>/views/` exists and `<stateDir>/users/local/views/` does not, it SHALL rename the folder to the latter. Each step SHALL log one line. Origin: necessary consequence: Jan's local workspace and views survive the upgrade.

#### Scenario: Old state dir
- **WHEN** a temp state dir holds `workspace.json` (revision 7, two windows) and `views/speeds.yaml`, and the server's store starts on it in `none` mode, and `GET /api/workspace` and `GET /api/views` are sent
- **THEN** the workspace answer has revision 7 and the two windows; `speeds` is listed; the dir holds `workspace.migrated.json`, `sessions/<id>.json` and `users/local/views/speeds.yaml`, and no `views/`; a second start migrates nothing
- **Evidence:** `apps/server/test/sessions.persist.test.ts` › "migrates the single workspace and the views"

### Requirement: Session limits and idle cleanup
A user SHALL own at most 200 sessions. Creating one more SHALL delete their least recently active session that has no live client, or answer 409 `session_limit` when every one has a client. Sessions idle longer than `KIPSCOPE_SESSION_IDLE_DAYS` (default 30) with no live client SHALL be deleted at start and every hour. Origin: necessary consequence: every handed-over case makes a session (D-078), so the disk and the list must stay bounded. Numbers: design "Numbers".

#### Scenario: Limit
- **WHEN** a session store with limit 200 holds 200 of alice's sessions, the oldest with a live client, and alice creates one more; and then all 200 have a client and she creates another
- **THEN** the first create deletes the second-oldest session (the oldest is kept) and succeeds; the second answers `session_limit`
- **Evidence:** `apps/server/test/sessions.test.ts` › "evicts the least recently active session at the limit"

#### Scenario: Idle cleanup
- **WHEN** on a fake clock with idle days 30, sessions last active 31 days ago (one with a live client), 29 days ago and now exist, and the hourly cleanup runs
- **THEN** only the 31-day session without a client is deleted, with its file
- **Evidence:** `apps/server/test/sessions.test.ts` › "removes idle sessions without clients"

#### Scenario: Idle days configuration
- **WHEN** `loadConfig` runs without `KIPSCOPE_SESSION_IDLE_DAYS`, with `7`, with `0` and with `x`
- **THEN** 30, 7; the last two throw naming the variable
- **Evidence:** `apps/server/test/config.test.ts` › "reads the auth settings"

### Requirement: Signal lists of open sessions
The signal list of the scope of every session with a live client SHALL stay held, and up to 4 other lists SHALL stay held, least recently used dropped first. Sessions on the same scope SHALL share one list. Period measuring and the events-line prefetch SHALL cover the window and events-line signals of every session with a live client. Origin: D-082 and add-scope design („Catalogs are keyed by scope, so two users on the same case share one list"); D-081 (periods for the workspace's signals), now per open session.

#### Scenario: Shared and kept lists
- **WHEN** on a recording source alice's session A and bob's session B have the same scope, both connect live and read `/api/s/<id>/catalog`; then six more sessions with six other scopes connect and read their catalogs, and A's catalog is read again
- **THEN** `listSignals` ran once for A's and B's scope, and A's list was not loaded again after the six others
- **Evidence:** `apps/server/test/sessions.http.test.ts` › "shares and keeps the signal lists of open sessions"

#### Scenario: Periods for every open session
- **WHEN** session A (live client) has a window with `testcar/Fast_100h.SIG_A` and session B (live client) one with `testcar/Cyc_B10h.CYC` in the same scope, and gap info for that scope is computed
- **THEN** both signals are among those measured
- **Evidence:** `apps/server/test/sessions.http.test.ts` › "measures periods for the open sessions' signals"

### Requirement: Session in the address of the UI
The UI SHALL run at `/s/<id>`. `/` SHALL go to the user's latest own session, or a new one, by replacing the address without a reload. An unknown session SHALL show "Session not found" and a forbidden one "No access to this session", both with the buttons "My latest session" and "New session", and the live channel SHALL not reconnect after the codes 4403 and 4404. Origin: Jan's „ja" (own URL per session, old tabs keep their case). Design M12.

#### Scenario: Start-up target
- **WHEN** `startupTarget` gets the paths `/s/abcdefghij`, `/` with sessions `[X, Y]`, `/` with no sessions, `/#view=<code>`, `/s/abcdefghij?view=demo` and `/s/ABC`
- **THEN** it returns `{session: "abcdefghij"}`, `{session: X}`, `{create: {}}`, `{create: {open: {view: <decoded>}}}`, `{create: {open: {name: "demo"}}}` and `{latest: true}` (a path that is not a session)
- **Evidence:** `apps/web/test/session.test.ts` › "chooses the session from the address"

#### Scenario: API paths of a session
- **WHEN** `apiPath` with session `abcdefghij` gets `/api/series?x=1`, `/api/live`, `/api/sessions`, `/api/me` and `/api/views`
- **THEN** it returns `/api/s/abcdefghij/series?x=1`, `/api/s/abcdefghij/live`, and the last three unchanged
- **Evidence:** `apps/web/test/session.test.ts` › "prefixes session routes only"

#### Scenario: Old tabs keep their case
- **WHEN** Jan's windows are open at `/s/<A>`, a second tab opens `/`, picks "New session" in the Sessions menu, adds a window there, and the first tab is reloaded
- **THEN** the second tab's address is `/s/<B>` with B ≠ A; the first tab still shows A's windows, unchanged by B's window
- **Evidence:** UI check on smart451 (screenshot of each tab)

### Requirement: Sessions menu
The top row SHALL offer a Sessions menu listing the user's own sessions, latest first, with a title (view title, else measurement name, else data ref and local scope start, else `New session`), the last active time and a mark when it has clients; the current session is marked. It SHALL offer "New session", "Copy session link", for the owner the share level `Private · Read · Write`, and delete for every session but the current one, with a confirm. Origin: necessary consequence of sessions (find, share and remove them in the UI); D-083 (rights per session).

#### Scenario: Title rule
- **WHEN** `sessionTitle` gets summaries with a view titled `Drive 3`, with only measurement `smart451 test`, with only scope `{smart451, 2026-10-13T12:00:00Z, …}` in zone Europe/Berlin, and with nothing
- **THEN** it returns `Drive 3`, `smart451 test`, `smart451 2026-10-13 14:00` and `New session`
- **Evidence:** `apps/web/test/session.test.ts` › "titles sessions"

#### Scenario: Menu on real data
- **WHEN** the UI is open on smart451 with two sessions and the Sessions menu is opened
- **THEN** it lists both with titles and times, the current one marked, and shows "New session", "Copy session link" and the share choice
- **Evidence:** UI check (one screenshot of the open menu)

### Requirement: Read-only session in the UI
When the user may open but not change the session, the top row SHALL show a `Read-only` pill whose tooltip names the owner and says that "Copy link" opens an own copy; rejected commands SHALL show in the message line with code `read_only`. Origin: Q-3 (a) (`read` share level); concept §10 („Fehler … müssen erkennbar bleiben").

#### Scenario: Two users on real data
- **WHEN** the server runs in header mode on loopback against carserver, Vite runs on 5173 with `KIPSCOPE_DEV_USER=alice` and on 5174 with `KIPSCOPE_DEV_USER=bob`; alice opens a session with one smart451 window and sets it to `write`; bob opens alice's session address on 5174 and adds a signal; alice sets `read`; bob zooms; alice sets `private`
- **THEN** alice's tab shows bob's signal without a reload; after `read`, bob's top row shows `Read-only` and his zoom shows a `read_only` message while the range stays; after `private`, bob's tab shows "No access to this session"; the footer shows `alice` and `bob` in the two tabs; goal, measured and reported but not pass/fail: the server's RSS with both tabs open
- **Evidence:** UI check (one screenshot per step on 5174, one of alice's tab after bob's add)
