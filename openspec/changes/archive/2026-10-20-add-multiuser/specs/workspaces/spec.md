## ADDED Requirements

### Requirement: Many workspaces
The server SHALL hold any number of workspaces. Each SHALL have its own revision, live clients, render acknowledgements and state file, plus:
- an ID of 10 characters `[a-z0-9]`
- an owner, the user who created it
- a share level
- a grant (data-access "Grant per workspace")
- a creation time
- a last-active time, set on create, on live connect and on each accepted command

A command in one workspace SHALL never change another.

Origin: D-083 („jedes sesseion braucht rechte"); Jan's „ja" to a workspace per case with its own URL; D-079. Design M4.

#### Scenario: Workspaces stay apart
- **WHEN** alice creates workspaces A and B with `POST /api/workspaces {}`, posts `window.create` three times to `/api/w/A/commands`, and reads `/api/w/B/workspace`
- **THEN** both IDs match `^[a-z0-9]{10}$` and differ; A's revision is 3; B's revision is 0 with no windows; `GET /api/workspaces/A` shows `owner` `alice`, `share` `private` and `windows` 3
- **Evidence:** `apps/server/test/workspaces.http.test.ts` › "keeps workspaces apart"

### Requirement: Session is not a word for the workspace
The words "session" and "sessions" SHALL NOT name the server-held workspace anywhere: UI text, routes, headers, CLI options and forms, DTOs, error codes, files and code names. There are two exceptions:
- constants named `LEGACY_*` that read old state and addresses
- lines about the finder's data section, which name `search tool` on the same line (such as the gate text "Open a session from the search tool")

"Session" is reserved for the finder's data section.

Origin: D-086 Q1 („session" is the data section; the server state is the invisible "workspace", renamed in `add-multiuser`); exploration "Root cause" (two meanings of one word); data fact: on 2026-10-20 the Sessions menu listed workspaces under data-section titles (exploration row 1).

#### Scenario: No session in the code
- **WHEN** `grep -rniE "\bsessions?\b" apps/server/src apps/web/src apps/cli/src packages/shared/src docs/http-api.md docs/deploy.md README.md | grep -v -e LEGACY_ -e 'search tool'` runs
- **THEN** it prints no line
- **Evidence:** the command

### Requirement: Workspace address
Every route that reads or changes a workspace (design M5 list) SHALL also answer as `/api/w/<id>/<rest>` for workspace `<id>`. Every answer that served a workspace SHALL carry the header `X-KIPscope-Workspace: <id>`. An ID of the right form that names no workspace SHALL answer 404 `unknown_workspace`. The old prefix `/api/s/<id>/…` SHALL answer 404 like any unknown route. The UI page of a workspace SHALL be `/w/<id>`.

Origin: Jan's „ja" (old tabs keep their case: the case is in the address); concept §7 (the CLI addresses the open view); D-086 Q1 (rename). Design M5.

#### Scenario: Prefix routes
- **WHEN** alice posts `window.create` to `/api/w/A/commands`, reads `/api/w/A/workspace`, opens `/api/w/A/live`, reads `/api/w/zzzzzzzzzz/workspace`, and reads `/api/s/A/workspace`
- **THEN**
  - the workspace has the window, and the answer carries `x-kipscope-workspace: A`
  - the live channel sends `hello`, then `summary` with `id` A, then `state` with A's revision
  - the read of `zzzzzzzzzz` answers 404 `unknown_workspace`
  - the `/api/s/` read answers 404 and A's revision is unchanged
- **Evidence:** `apps/server/test/workspaces.http.test.ts` › "addresses a workspace by its prefix"

### Requirement: Default workspace
A request to a workspace route without the prefix SHALL serve the requester's own workspace with the latest last-active time, or a new one when they own none.

Origin: spec owner's default (round 1): today's routes, scripts and the CLI without `--workspace` keep working. The exploration recommended keeping it for the CLI („scripts keep working").

#### Scenario: Most recently active
- **WHEN**, on an empty state dir, the following are sent in order:
  1. `GET /api/workspace`
  2. `POST /api/workspaces {}`
  3. `GET /api/workspace`
  4. `cursor.set`, posted to `/api/w/<first>/commands`
  5. `GET /api/workspace`
- **THEN**
  - the first answer creates a workspace W1 and names it in `x-kipscope-workspace`
  - the create makes W2
  - the next read names W2
  - after the command, the read names W1
  - `GET /api/workspaces` lists W1, then W2
- **Evidence:** `apps/server/test/workspaces.http.test.ts` › "serves the most recently active workspace without a prefix"

### Requirement: A new tab never mirrors another
`POST /api/workspaces {reuse: true}` SHALL return the requester's own workspace with the latest last-active time that has no live client and was not handed out by another reuse in the last 10 s, else a new one. The pick SHALL be atomic, so two such requests never get the same workspace. `reuse` together with `open` SHALL answer 400.

Origin: exploration row 4 (data fact: two tabs on `/` both landed in `/s/f006vy0ili` and a change in one showed in the other); exploration "Workspaces become invisible" („`/` opens the user's latest workspace that has no open tab, else a new one. A second tab is never mirrored into the first"), accepted by D-086. 10 s: design M4 "Numbers".

#### Scenario: Two start-ups at once
- **WHEN** alice owns workspace F without a live client and workspace L (later) with one live client; `POST /api/workspaces {reuse: true}` is sent twice in parallel; then a third time 11 s later on a fake clock, with no client connected meanwhile; and `{reuse: true, open: {name: "x"}}` is sent
- **THEN**
  - the two parallel answers name F (`reused` true) and a new workspace N (`reused` false); neither names L
  - the third names F again
  - the combined request answers 400
- **Evidence:** `apps/server/test/workspaces.test.ts` › "reuses a free workspace once"; `apps/server/test/workspaces.http.test.ts` › "never hands one free workspace to two tabs"

### Requirement: Rights per workspace
The owner SHALL have every right on a workspace. Other signed-in users of the same server SHALL get rights from the share level:
- `private`: none
- `read`: open
- `write`: open and change

On a workspace route:
- without the open right, the answer SHALL be 403 `forbidden`
- on a change route (design M6 table) without the change right, the answer SHALL be 403 `read_only`, and nothing changes

Only the owner SHALL change the share level or delete the workspace, else 403 `not_owner`. One function SHALL decide workspace rights (design M6 `workspaceRights`).

Origin: D-083 (who may open and change it); D-084 (owner and share level stay); D-079 (one place for access control).

#### Scenario: Private, read, write
- **WHEN**, with the test identity adapter, alice owns workspace A (grant `[testcar]`, a scope and one window), and the following happen in order:
  1. While A is `private`, bob sends `GET /api/w/A/workspace` and opens `/api/w/A/live`.
  2. Alice posts `/api/workspaces/A/share {share: "read"}`. Bob reads `/api/w/A/workspace` and `/api/w/A/catalog`, posts `window.create` to `/api/w/A/commands`, and posts `POST /api/w/A/views/open {name: "x"}`.
  3. Alice sets `write`, and bob posts `window.create`.
  4. Bob posts `/api/workspaces/A/share {share: "private"}` and `DELETE /api/workspaces/A`.
- **THEN**
  - while private: 403 `forbidden`, and the WebSocket gets no message
  - while read: both reads answer 200, and both posts answer 403 `read_only` with A's revision unchanged
  - while write: the command is accepted
  - bob's share and delete answer 403 `not_owner`, and A still exists
- **Evidence:** `apps/server/test/workspaces.http.test.ts` › "enforces workspace rights"

#### Scenario: Rights function
- **WHEN** `workspaceRights` gets the owner of a `private` workspace, then another user for a `private`, a `read` and a `write` workspace
- **THEN** it returns `{open: true, change: true, owner: true}`, `undefined`, `{open: true, change: false, owner: false}` and `{open: true, change: true, owner: false}`
- **Evidence:** `apps/server/test/rights.test.ts` › "derives workspace rights from owner and share level"

### Requirement: Share changes act at once
After a share change or a grant change, every open live connection to the workspace SHALL get a `summary` message with its user's new rights and `granted`. A connection whose user lost the open right SHALL be closed with code 4403. Deleting a workspace SHALL close its connections with code 4404.

Origin: necessary consequence of "Rights per workspace" (a right taken away must not keep working through an open channel), and of "Grant per workspace" (a grant widened by `add-case-open` must reach the open tab without a reload).

#### Scenario: Bob loses rights
- **WHEN** A is `write` and bob is connected to `/api/w/A/live`; alice sets `read`, then `private`; then a new bob connection under `write` is open, `grantObjects(A, ["othercar"])` runs, and alice deletes A
- **THEN**
  - after the first change, bob's channel gets `summary` with `rights.change` false
  - after the second, it is closed with 4403
  - after the grant, the new connection gets `summary` with `granted` 2
  - after the delete, it is closed with 4404, and `GET /api/workspaces/A` answers 404 `unknown_workspace`
- **Evidence:** `apps/server/test/workspaces.http.test.ts` › "applies share, grant and delete to open connections"

### Requirement: Workspace management
The server SHALL offer these routes:
- `GET /api/workspaces` lists the requester's own workspaces, latest last-active first, as `WorkspaceSummary` (design M7, with `granted`)
- `GET /api/workspaces/:id` returns one summary (open right)
- `POST /api/workspaces` creates one
- `POST /api/workspaces/:id/share` sets the share level
- `DELETE /api/workspaces/:id` deletes the workspace and its state file

Origin: necessary consequence of many workspaces (the Recent list, sharing and the CLI need them); D-083.

#### Scenario: List, share, delete
- **WHEN** alice creates two workspaces and posts a scope to the first; bob creates one; alice reads `GET /api/workspaces`, sets the first to `write`, and deletes the second
- **THEN**
  - alice's list holds her two workspaces only
  - the first carries `scope`, `clients` 0, `granted` `all` (`none` mode) and `rights.owner` true
  - the share answer shows `share` `write`
  - the delete answers `{deleted: <id>}`, the file is gone, and her list holds one workspace
- **Evidence:** `apps/server/test/workspaces.http.test.ts` › "lists, shares and deletes workspaces"

### Requirement: Create with an open view
`POST /api/workspaces {open}` SHALL create a workspace and open a saved view (`{name}`) or a view document (`{view}`) in it, as one step. When the open fails, no workspace SHALL be created, and the answer SHALL be the failed command result with its usual status.

Origin: concept §9 („Untersuchung direkt öffnen … über CLI beziehungsweise Link"); necessary consequence of links opening a new workspace (saved-views "Open from the address").

#### Scenario: Open into a new workspace
- **WHEN** alice (`none` mode) posts `/api/workspaces` with each of these bodies:
  1. `{open: {view: <v1 document with two windows>}}`
  2. `{open: {view: {kipscope: "view", version: 9}}}`
  3. `{open: {name: "nope"}}`
- **THEN**
  - the first answers 200 with `workspace.windows` 2 and `result.ok` true
  - the second answers 422 `unsupported_version`
  - the third answers 404 `unknown_view`
  - `GET /api/workspaces` lists one workspace
- **Evidence:** `apps/server/test/workspaces.http.test.ts` › "creates a workspace with an open view"

### Requirement: Workspaces survive a restart
Each workspace SHALL be written to `<stateDir>/workspaces/<id>.json` (design M4, version 2) with owner, share level, grant, times, revision and workspace. Writes SHALL follow at most 500 ms after its last change and at once on `SIGINT` or `SIGTERM`, atomically. At start every file SHALL be restored. A file that is not a valid workspace file SHALL be moved to `<id>.bad.json` with one warning, while the others load.

Origin: concept §8 („Speichern/Laden"); workspace-state "Workspace survives a restart", per workspace. Design M4.

#### Scenario: Restart keeps every workspace
- **WHEN** a registry on a temp state dir has alice's workspace A (5 commands, share `read`, grant `[testcar]`) and bob's B (2 commands), `flush()` runs, and a new registry is built from the same dir
- **THEN** A and B have the same workspaces, revisions 5 and 2, owners, share levels, grants and times, and the next command on A gets revision 6
- **Evidence:** `apps/server/test/workspaces.persist.test.ts` › "restores every workspace"

#### Scenario: Broken workspace file
- **WHEN** `workspaces/` holds A's valid file and `bbbbbbbbbb.json` with `{"kipscope":"workspace","version":2}`
- **THEN** the registry holds A, `bbbbbbbbbb.bad.json` holds that text, and one warning names the file
- **Evidence:** `apps/server/test/workspaces.persist.test.ts` › "moves a broken workspace file aside"

### Requirement: Migration of old state
At start the server SHALL migrate, in this order, logging one line per step:
1. When `<stateDir>/sessions/` exists and `<stateDir>/workspaces/` does not, it SHALL rename the folder to `workspaces/`, and read its files (`kipscope: "session"`, version 1, no grant) as workspaces with grant `all`.
2. When `<stateDir>/workspace.json` exists and `workspaces/` does not, it SHALL turn that workspace into one owned by `local` with grant `all`, and rename the file `workspace.migrated.json`.
3. When `<stateDir>/views/` exists and `<stateDir>/users/local/views/` does not, it SHALL rename the folder.

Origin: necessary consequence: Jan's local workspaces (`sessions/` since round 1, e.g. `4u5z1wl3vo`) and views survive both renames.

#### Scenario: Old state dir
- **WHEN** a temp state dir holds `workspace.json` (revision 7, two windows) and `views/speeds.yaml`, a registry starts on it in `none` mode, and `GET /api/workspace` and `GET /api/views` are sent
- **THEN**
  - the workspace has revision 7 and the two windows, and `speeds` is listed
  - the dir holds `workspace.migrated.json`, `workspaces/<id>.json` and `users/local/views/speeds.yaml`, and no `views/`
  - a second start migrates nothing
- **Evidence:** `apps/server/test/workspaces.persist.test.ts` › "migrates the single workspace and the views"

#### Scenario: Session folder of round 1
- **WHEN** a temp state dir holds `sessions/aaaaaaaaaa.json` in the round-1 format (`kipscope: "session"`, version 1, owner `local`, revision 4), the registry starts in `none` mode, and a command is accepted on `aaaaaaaaaa` and flushed
- **THEN**
  - the dir holds `workspaces/aaaaaaaaaa.json` and no `sessions/`
  - `GET /api/workspaces/aaaaaaaaaa` shows `granted` `all`, and the command got revision 5
  - the file now holds `kipscope: "workspace"`, version 2 and `grant: {objects: "all"}`
- **Evidence:** `apps/server/test/workspaces.persist.test.ts` › "migrates the session folder of round 1"

### Requirement: Workspace limits and idle cleanup
A user SHALL own at most 200 workspaces. Creating one more SHALL delete their least recently active workspace that has no live client, or answer 409 `workspace_limit` when every one has a client. Workspaces idle longer than `KIPSCOPE_WORKSPACE_IDLE_DAYS` (default 30) with no live client SHALL be deleted at start and every hour.

Origin: necessary consequence: every handed-over case makes a workspace (D-078), so the disk and the list must stay bounded. Numbers: design "Numbers".

#### Scenario: Limit
- **WHEN** a registry with limit 200 holds 200 of alice's workspaces, the oldest with a live client, and alice creates one more; then all 200 have a client and she creates another
- **THEN** the first create deletes the second-oldest workspace (the oldest is kept) and succeeds; the second throws `WorkspaceLimitError`, which the route answers as 409 `workspace_limit`
- **Evidence:** `apps/server/test/workspaces.test.ts` › "evicts the least recently active workspace at the limit"

#### Scenario: Idle cleanup
- **WHEN**, on a fake clock with idle days 30, workspaces last active 31 days ago (one of them with a live client), 29 days ago and now exist, and the hourly cleanup runs
- **THEN** only the 31-day workspace without a client is deleted, with its file
- **Evidence:** `apps/server/test/workspaces.test.ts` › "removes idle workspaces without clients"

#### Scenario: Idle days configuration
- **WHEN** `loadConfig` runs without `KIPSCOPE_WORKSPACE_IDLE_DAYS`, with `7`, with `0` and with `x`
- **THEN** it gives 30 and 7; the last two throw naming `KIPSCOPE_WORKSPACE_IDLE_DAYS`
- **Evidence:** `apps/server/test/config.test.ts` › "reads the auth settings"

### Requirement: Signal lists of open workspaces
The signal list of the scope of every workspace with a live client SHALL stay held, and up to 4 other lists SHALL stay held, least recently used dropped first. Workspaces on the same scope SHALL share one list. Period measuring and the events-line prefetch SHALL cover the window and events-line signals of every workspace with a live client.

Origin: D-082 (catalogs keyed by scope, so two users on the same case share one list); D-081 (periods for the workspace's signals), per open workspace.

#### Scenario: Shared and kept lists
- **WHEN**, on a recording source, alice's workspace A and bob's workspace B have the same scope, both connect live and read `/api/w/<id>/catalog`; then six more workspaces with six other scopes connect and read their catalogs, and A's catalog is read again
- **THEN** `listSignals` ran once for A's and B's scope, and A's list was not loaded again after the six others
- **Evidence:** `apps/server/test/workspaces.http.test.ts` › "shares and keeps the signal lists of open workspaces"

#### Scenario: Periods for every open workspace
- **WHEN** workspace A (live client) has a window with `testcar/Fast_100h.SIG_A`, workspace B (live client) has one with `testcar/Cyc_B10h.CYC` in the same scope, and gap info for that scope is computed
- **THEN** both signals are among those measured
- **Evidence:** `apps/server/test/workspaces.http.test.ts` › "measures periods for the open workspaces' signals"

### Requirement: Workspace in the address of the UI
The UI SHALL run at `/w/<id>`.
- `/` SHALL open the workspace `POST /api/workspaces {reuse: true}` returns, and replace the address with `/w/<id>` without a reload.
- `/s/<id>` SHALL be read as `/w/<id>`, and the address replaced with `/w/<id>`.

Gate pages:
- An unknown workspace SHALL show "Workspace not found", and a forbidden one "No access to this workspace", both with the buttons "My latest workspace" and "New workspace".
- A workspace with an empty grant under an identity other than `none` SHALL show "Open a session from the search tool" until a `summary` message brings a grant (data-access "Grant per workspace").
- The live channel SHALL NOT reconnect after the codes 4403 and 4404.

Origin: Jan's „ja" (own URL per case, old tabs keep their case); D-086 Q1 (rename, old addresses exist in Jan's tabs); exploration row 4 (no mirroring); D-085 (the search tool decides what a user sees). Design M12.

#### Scenario: Start-up target
- **WHEN** `startupTarget` gets the paths `/w/abcdefghij`, `/s/abcdefghij`, `/`, `/#view=<code>`, `/w/abcdefghij?view=demo` and `/w/ABC`
- **THEN** it returns:
  - `{workspace: "abcdefghij"}` twice, both with `path` `/w/abcdefghij`
  - `{create: {reuse: true}}`
  - `{create: {open: {view: <decoded>}}}`
  - `{create: {open: {name: "demo"}}}`
  - `{create: {reuse: true}}`
- **Evidence:** `apps/web/test/workspaces.test.ts` › "chooses the workspace from the address"

#### Scenario: Gate texts
- **WHEN** `gateOf` gets each of:
  - the answers 404 `unknown_workspace` and 403 `forbidden`
  - close code 4403
  - a summary with `granted` 0, with `me.identity` `oidc` and then with `none`
  - the answers 401 `unauthenticated` and 503 `identity_unavailable`
- **THEN** it returns:
  - "Workspace not found", then "No access to this workspace" twice
  - "Open a session from the search tool", then no gate
  - "Not signed in", then "Sign-in service unreachable"

  Only the first three offer "My latest workspace" and "New workspace".
- **Evidence:** `apps/web/test/workspaces.test.ts` › "chooses the gate page"

#### Scenario: API paths of a workspace
- **WHEN** `apiPath` with workspace `abcdefghij` gets `/api/series?x=1`, `/api/live`, `/api/workspaces`, `/api/me` and `/api/views`
- **THEN** it returns `/api/w/abcdefghij/series?x=1` and `/api/w/abcdefghij/live`; the last three come back unchanged
- **Evidence:** `apps/web/test/workspaces.test.ts` › "prefixes workspace routes only"

#### Scenario: Two tabs on real data
- **WHEN** Jan's windows are open at `/w/<A>`, a second tab opens `/`, a window is added there, and the first tab is reloaded; then a third tab opens Jan's old address `/s/<A>`
- **THEN**
  - the second tab's address is `/w/<B>` with B ≠ A, and the first tab still shows A's windows, unchanged by B's window
  - the third tab's address becomes `/w/<A>` and it shows A's windows
- **Evidence:** UI check on smart451 (the three addresses read from the tabs; one screenshot of the first tab after the reload)

#### Scenario: Gate on a server workspace without data
- **WHEN** the setup is:
  - the server runs the example identity module on loopback against carserver on a fresh state dir
  - Vite runs on 5173 with `KIPSCOPE_DEV_USER=alice`

  and then, in order:
  1. Alice opens `/`.
  2. The lead stops the server and runs `pnpm --filter @kipscope/server exec tsx scripts/grant.ts <stateDir> <her workspace id> <carserver data ref>`. This dev-only script builds a `WorkspaceRegistry` on the stopped state dir, calls `grantObjects` and flushes.
  3. The lead starts the server again.
- **THEN**
  - before the grant, her tab shows "Open a session from the search tool" and the explorer lists no signal
  - after the restart, without a reload, the tab reconnects, the gate is gone and the explorer lists signals
- **Evidence:** UI check (one screenshot before, one after the restart)

### Requirement: Share
The top row SHALL offer "Share…" as an overflow item (saved-views "Top-row overflow menu"). Its first part SHALL be "Copy link (own copy)", with a line saying that the receiver gets their own copy of this layout. Its second part SHALL be "Invite to this workspace", offering:
- for the owner, with an identity other than `none`, the share level `Private · Read · Write`, with a line per level saying what the receiver can do; `Read` and `Write` are disabled with the tooltip `Sharing is turned off on this server` when `me.canShare` is false
- "Copy workspace link"

Each label SHALL say what the receiver gets (design M12 texts).

Origin: exploration row 3 (data fact: "Copy link" in the Views menu and "Copy session link" in the Sessions menu gave the receiver an own copy and the same live workspace, with nothing on screen saying which); exploration "Workspaces become invisible", accepted by D-086; D-083 (rights per workspace).

#### Scenario: Share items
- **WHEN** `shareItems` gets:
  1. `me` `{identity: "oidc", canShare: true}` as owner
  2. `me` `{identity: "oidc", canShare: false}` as owner
  3. a non-owner of a `read` workspace of `alice`
  4. `me` `{identity: "none"}`
- **THEN**
  - every result starts with `Copy link (own copy)` and the line `The receiver gets their own copy of this layout; changes stay apart.`; the first three add `On this server they see data only for vehicles the search tool opened for them.`
  - the first offers `Private`, `Read` and `Write`, all enabled, and `Copy workspace link`
  - the second has `Read` and `Write` disabled with the tooltip `Sharing is turned off on this server`
  - the third has no radio and the line `Shared by alice (read)`
  - the fourth has no radio and the button `Copy workspace link (same live workspace)`
- **Evidence:** `apps/web/test/workspaces.test.ts` › "offers the share items"

#### Scenario: Share on real data
- **WHEN** the UI is open on smart451 at 1440×900 and at 1000×557, and Share… is opened (from the row, then from "⋯")
- **THEN**
  - the popover shows `Copy link (own copy)` with its line, and `Copy workspace link (same live workspace)`
  - the top row has no Sessions menu, and the Views menu has no "Copy link" entry
  - clicking `Copy link (own copy)` shows `Link copied (<n> characters)`
- **Evidence:** UI check (one screenshot of the open popover per viewport)

### Requirement: Recent workspaces
The Views menu SHALL list, under the heading `Recent workspaces`, the user's 10 latest own workspaces. Each row SHALL show its title (view title, else measurement name, else data ref and local scope start, else `New workspace`), its last active time, and a mark when it has clients. The current workspace SHALL be marked. Each row SHALL be a link to `/w/<id>`.

Origin: exploration "Workspaces become invisible" („A 'Recent' list (the last 10 workspaces, titled by session or view) moves into the Views menu for the rare way back"), accepted by D-086; exploration row 2 (data fact: two entries titled "Speeds" and two "Before last open", so a time is shown per row). 10: design "Numbers".

#### Scenario: Title rule
- **WHEN** `workspaceTitle` gets summaries:
  - with a view titled `Drive 3`
  - with only measurement `smart451 test`
  - with only scope `{smart451, 2026-10-13T12:00:00Z, …}`, in zone Europe/Berlin
  - with nothing
- **THEN** it returns `Drive 3`, `smart451 test`, `smart451 2026-10-13 14:00` and `New workspace`
- **Evidence:** `apps/web/test/workspaces.test.ts` › "titles workspaces"

#### Scenario: Recent rows
- **WHEN** `recentRows` gets 12 summaries in list order, the current ID being the third, the first with `clients` 1
- **THEN** it returns 10 rows in the same order, the third marked current, the first marked `●`, each with `href` `/w/<id>`
- **Evidence:** `apps/web/test/workspaces.test.ts` › "lists recent workspaces"

#### Scenario: Recent on real data
- **WHEN** the UI is open on smart451 with at least two workspaces, and the Views menu is opened
- **THEN** it shows `Recent workspaces` with titles and times, the current one marked; a click on another row loads `/w/<that id>` with that workspace's windows
- **Evidence:** UI check (one screenshot of the open menu; the address after the click)

### Requirement: Read-only workspace in the UI
When the user may open but not change the workspace, the top row SHALL show a `Read-only` pill. Its tooltip SHALL name the owner and say that "Copy link (own copy)" gives an own copy. Rejected commands SHALL show in the message line with code `read_only`.

Origin: D-083, D-084 (share level `read`); concept §10 („Fehler … müssen erkennbar bleiben").

#### Scenario: Two users on real data
- **WHEN** the setup is:
  - the server runs the example identity module on loopback against carserver, with `KIPSCOPE_SHARE=on`
  - Vite runs on 5173 with `KIPSCOPE_DEV_USER=alice` and on 5174 with `KIPSCOPE_DEV_USER=bob`
  - alice's workspace is granted the carserver data ref (`scripts/grant.ts` of "Gate on a server workspace without data") and has one smart451 window

  and then, in order:
  1. Alice invites with `Write`.
  2. Bob opens alice's `Copy workspace link` on 5174 and adds a signal.
  3. Alice sets `Read`, and bob zooms.
  4. Alice sets `Private`.
- **THEN**
  - alice's tab shows bob's signal without a reload
  - after `Read`, bob's top row shows `Read-only`, and his zoom shows a `read_only` message while the range stays
  - after `Private`, bob's tab shows "No access to this workspace"
  - the footer shows `alice` and `bob` in the two tabs
  - goal (measured and reported, not pass/fail): the server's RSS with both tabs open
- **Evidence:** UI check (one screenshot per step on 5174, one of alice's tab after bob's add)
