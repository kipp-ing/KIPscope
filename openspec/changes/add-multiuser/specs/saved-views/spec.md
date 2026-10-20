## MODIFIED Requirements

### Requirement: Named views on the server
The server SHALL save a workspace as a named view of the requesting user in `<stateDir>/users/<user>/views/<name>.yaml`, and list, return and delete that user's views; a user SHALL never see or change another user's views. Saving onto an existing name SHALL need `overwrite`, else 409 `view_exists`. The list SHALL show every file, a broken one with its error. Saving SHALL mark the workspace's open view as saved. Origin: concept §8 („Speichern/Laden"); Jan 2026-10-17; persona test (boss: keep a view); per user: D-084 („q4 views je nutzer, ja").

#### Scenario: Save, list, overwrite
- **WHEN** on a test server with a temp state dir `POST /api/views {title: "Hard acceleration, drive 3"}` is sent twice, then once with `overwrite: true`, then `GET /api/views`
- **THEN** the first answers 200 with `view.name` `hard-acceleration-drive-3` and the next revision; the second 409 `view_exists`; the third 200; the list holds that view with `windows` and `signals` counts of the workspace; `GET /api/workspace` shows `view` `{name: "hard-acceleration-drive-3", title: "Hard acceleration, drive 3", modified: false}`; the file is `<stateDir>/users/local/views/hard-acceleration-drive-3.yaml`
- **Evidence:** `apps/server/test/views.http.test.ts` › "saves, lists and overwrites views"

#### Scenario: Broken file listed
- **WHEN** the user's views directory holds `broken.yaml` with the text `windows: [`
- **THEN** `GET /api/views` lists `{name: "broken", title: "broken", error: …}` and the other views as before
- **Evidence:** `apps/server/test/views.http.test.ts` › "lists a broken file with its error"

#### Scenario: Delete
- **WHEN** `DELETE /api/views/hard-acceleration-drive-3` is sent twice
- **THEN** the first answers 200 `{deleted: "hard-acceleration-drive-3"}` and the file is gone; the second 404 `unknown_view`
- **Evidence:** `apps/server/test/views.http.test.ts` › "deletes a view"

#### Scenario: Views per user
- **WHEN** with the test identity adapter (alice and bob with role `all`) alice saves `speeds` from her workspace, and bob sends `GET /api/views`, `GET /api/views/speeds`, `DELETE /api/views/speeds`, `POST /api/views/open {name: "speeds"}` and then saves his own `speeds`
- **THEN** bob's list does not hold alice's view; the get, the delete and the open answer 404 `unknown_view`; bob's save answers 200 without `overwrite`; alice's file is unchanged
- **Evidence:** `apps/server/test/views.http.test.ts` › "keeps views per user"

### Requirement: Before last open
Before a view is opened over a workspace with at least one window, the server SHALL keep that workspace as the view `_previous` of the user who opens, titled "Before last open", replacing an older one. It SHALL be listed last and open like any view. Origin: necessary consequence of opening into a workspace other tabs show (design S-4); goal: undo of an open without the general undo of concept §8; per user: D-084 (Q-4).

#### Scenario: Open, then go back
- **WHEN** the workspace has two windows, view X is opened, then `POST /api/views/open {name: "_previous"}` is sent
- **THEN** after the first open `GET /api/views` lists `_previous` last with title `Before last open` and 2 windows; after the second the workspace shows the two windows again (new IDs), and `_previous` now holds X's windows
- **Evidence:** `apps/server/test/views.http.test.ts` › "keeps the workspace before the last open"

#### Scenario: Empty workspace is not kept
- **WHEN** the workspace has no windows and a view is opened
- **THEN** no `_previous.yaml` is written (an older one stays)
- **Evidence:** `apps/server/test/views.http.test.ts` › "keeps the workspace before the last open"

### Requirement: Links to a view
"Copy link (own copy)" in Share… (workspaces "Share") SHALL copy a link `<page origin>/#view=<code>` holding the whole workspace as a view document (deflate-raw, base64url). Opening it SHALL open the view in a new workspace of the person who opens it (design M12). It works only where that person reaches the KIPscope server at that origin and the new workspace's grant covers the view's data refs: always in `none` mode; on a server not before `add-case-open` (data-access "A view grants nothing").

Origin: Jan 2026-10-17 („url? shared link?"); concept §9 („Untersuchung direkt öffnen … über … Link"); new workspace: Jan's „ja" (a case per workspace, old tabs keep theirs); grant: D-086 Q13; the label: exploration row 3.

#### Scenario: Link codec
- **WHEN** a synthetic document of 17 windows with 66 signal entries over 44 smart451-like IDs is encoded with `encodeViewLink` and decoded with `decodeViewLink`, and `decodeViewLink` gets `@@@` and a valid code cut in half
- **THEN** the round trip gives the same document; the code has at most 2,000 characters (goal; Jan's real workspace measured ≈ 1,400); the two bad inputs reject
- **Evidence:** `packages/shared/test/views.test.ts` › "encodes views into short links"

#### Scenario: Link page is the origin
- **WHEN** the web's "Copy link (own copy)" helper builds a link on the page `http://127.0.0.1:5173/w/abcdefghij`
- **THEN** the link starts with `http://127.0.0.1:5173/#view=`
- **Evidence:** `apps/web/test/viewlink.test.ts` › "copies the shared link" (extended)

### Requirement: Open from the address
Opening the UI with `#view=<code>` SHALL open that view, and with `?view=<name>` the user's saved view of that name, each in a new workspace of that user (workspaces "Create with an open view"). Afterwards the address SHALL be `/w/<new id>` without the view part, so a reload does not open it again. A bad code, an unknown name, or data refs outside the new workspace's grant SHALL create no workspace; the UI SHALL then show the workspace `/` would show, with the error in the message line.

Origin: concept §9 („Untersuchung direkt öffnen"); Jan 2026-10-17; new workspace: Jan's „ja" (old tabs keep their case); grant: D-086 Q13.

#### Scenario: Start-up from a link
- **WHEN** the page's address has `#view=<code>`, `?view=demo`, `?view=nope`, or neither
- **THEN** `startupView(location)` returns `{view: <decoded>}`, `{name: "demo"}`, `{name: "nope"}`, and nothing; the cleaned address keeps the path and drops query and fragment
- **Evidence:** `apps/web/test/viewlink.test.ts` › "reads a view from the address"

#### Scenario: Link in a second browser
- **WHEN** with Jan's windows open the user clicks Share… › "Copy link (own copy)" and `kipscope view link --page <UI origin>/` runs, then a new tab navigates to the printed `url`
- **THEN**
  - the notice says `Link copied (<n> characters)`, with n within a few characters of the CLI's `data.chars` (same workspace and page address; compression may differ)
  - the new tab's address becomes `/w/<new id>` after loading, it shows the windows, and its strip shows `Opened "<title>"`
  - the first tab's workspace and address are unchanged
- **Evidence:** UI check on smart451 (the notice text and the CLI line; screenshot after opening the link). Pasting the clipboard into a tab is the lead's hand check.

#### Scenario: Bookmark by name
- **WHEN** a new tab navigates to `<UI origin>/?view=<saved name>` and then to `<UI origin>/?view=nope`
- **THEN** the first opens the view in a new workspace (address `/w/<id>` after loading, `Opened "<title>"`); the second creates no workspace, shows the workspace `/` would show, and an error naming `unknown_view`
- **Evidence:** UI check on smart451 (one screenshot each)

### Requirement: Top-row overflow menu
Below a measured width, after the other give-way steps, the top row SHALL move its overflow items into a "⋯" menu at its end: Digits, "+ Values window", "Share…", and later end-of-row controls such as `add-guidance`'s "?". So the row never wraps at 1000×557 with the sidebar open nor at 1440×900. Each item SHALL stay usable by keyboard.

Origin: round-2 UI finding (851 px needed, 728 px available); lead's decision 2026-10-17 (Jan: his hints are ideas); design V7 "Top-row overflow rule"; "Share…" as an overflow item: exploration „'Share…' in the overflow menu", accepted by D-086 (add-multiuser design M12).

#### Scenario: Overflow menu by keyboard
- **WHEN** at 1000×557 with the sidebar open the user does, in order:
  1. tabs to "⋯" and presses Enter
  2. changes Digits to 4 with the arrow keys
  3. tabs to "+ Values window" and presses Enter
  4. opens "⋯" again, tabs to "Share…" and presses Enter, then presses Escape twice
- **THEN**
  - Enter opens the menu with focus on the Digits select
  - the workspace's digits become 4, and a new values window appears
  - "Share…" opens its popover
  - the Escapes close the popover and the menu, with focus on "⋯"
  - "⋯" has `aria-haspopup="menu"`, with `aria-expanded` true while open and false after
- **Evidence:** UI check on smart451 (focused element and `aria-expanded` read from the page after each step, `kipscope state` for digits and windows; one screenshot with the menu open)

#### Scenario: Share in the row when there is room
- **WHEN** the six-window setup is open with the sidebar open at 1440×900
- **THEN** "Share…" is in the top row before "⋯", "⋯" is not displayed, and every top-row item has the same `getBoundingClientRect().top` (±1 px)
- **Evidence:** UI check on smart451 (tops read from the page; one screenshot)

### Requirement: Views menu
The Views menu SHALL offer:
- the save entries
- the saved views, newest first, with saved time, window count and data refs; the open one marked
- "Before last open", last among the views
- "Import file…"
- the section "Recent workspaces" (workspaces "Recent workspaces")

Each view row SHALL offer Download and Delete (inline confirm) without shortening the row's meta line. "Copy link" SHALL NOT be in the Views menu; it is "Copy link (own copy)" in Share….

Origin: persona test (boss); Jan 2026-10-17; row layout: round-1 UI finding (spec owner's default, design V7); "Copy link" moved and Recent added: exploration rows 2–3 and "Workspaces become invisible", accepted by D-086.

#### Scenario: Row actions keep the meta line
- **WHEN** the menu lists a view with 6 windows and data `smart451`, and the pointer moves onto its row
- **THEN** Download and Delete appear; the meta line's rect width and text are the same as before the hover (±1 px), and it reads `<saved local time> · 6 windows · smart451`
- **Evidence:** UI check on smart451 (rects before and on hover, one screenshot on hover); `apps/web/test/views.test.ts` › "describes a menu row" (`rowDetails`)

#### Scenario: Menu entries
- **WHEN** the Views menu is opened on smart451 with two saved views and three workspaces
- **THEN** it shows the save entries, both views, "Import file…" and the "Recent workspaces" section with three rows, and no entry named "Copy link"
- **Evidence:** UI check on smart451 (menu text read from the page; one screenshot)

