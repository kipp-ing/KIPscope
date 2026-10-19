## MODIFIED Requirements

### Requirement: Named views on the server
The server SHALL save a session's workspace as a named view of the requesting user in `<stateDir>/users/<user>/views/<name>.yaml`, and list, return and delete that user's views; a user SHALL never see or change another user's views. Saving onto an existing name SHALL need `overwrite`, else 409 `view_exists`. The list SHALL show every file, a broken one with its error. Saving SHALL mark the session's open view as saved. Origin: concept §8 („Speichern/Laden"); Jan 2026-10-17; persona test (boss: keep a view); per user: Q-4 (a) (design).

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
- **WHEN** in header mode alice saves `speeds` from her session, and bob sends `GET /api/views`, `GET /api/views/speeds`, `DELETE /api/views/speeds`, `POST /api/views/open {name: "speeds"}` and then saves his own `speeds`
- **THEN** bob's list does not hold alice's view; the get, the delete and the open answer 404 `unknown_view`; bob's save answers 200 without `overwrite`; alice's file is unchanged
- **Evidence:** `apps/server/test/views.http.test.ts` › "keeps views per user"

### Requirement: Before last open
Before a view is opened over a session's workspace with at least one window, the server SHALL keep that workspace as the view `_previous` of the user who opens, titled "Before last open", replacing an older one. It SHALL be listed last and open like any view. Origin: necessary consequence of opening into a workspace other tabs show (design S-4); goal: undo of an open without the general undo of concept §8; per user: Q-4 (a).

#### Scenario: Open, then go back
- **WHEN** the workspace has two windows, view X is opened, then `POST /api/views/open {name: "_previous"}` is sent
- **THEN** after the first open `GET /api/views` lists `_previous` last with title `Before last open` and 2 windows; after the second the workspace shows the two windows again (new IDs), and `_previous` now holds X's windows
- **Evidence:** `apps/server/test/views.http.test.ts` › "keeps the workspace before the last open"

#### Scenario: Empty workspace is not kept
- **WHEN** the workspace has no windows and a view is opened
- **THEN** no `_previous.yaml` is written (an older one stays)
- **Evidence:** `apps/server/test/views.http.test.ts` › "keeps the workspace before the last open"

### Requirement: Links to a view
"Copy link" SHALL copy a link `<page origin>/#view=<code>` holding the whole session's workspace as a view document (deflate-raw, base64url). Opening it SHALL open the view in a new session of the person who opens it (design M12). It works only where that person reaches the KIPscope server at that origin and the server knows the view's data refs. Origin: Jan 2026-10-17 („url? shared link?"); concept §9 („Untersuchung direkt öffnen … über … Link"); new session: Jan's „ja" (a case per session, old tabs keep theirs).

#### Scenario: Link codec
- **WHEN** a synthetic document of 17 windows with 66 signal entries over 44 smart451-like IDs is encoded with `encodeViewLink` and decoded with `decodeViewLink`, and `decodeViewLink` gets `@@@` and a valid code cut in half
- **THEN** the round trip gives the same document; the code has at most 2,000 characters (goal; Jan's real workspace measured ≈ 1,400); the two bad inputs reject
- **Evidence:** `packages/shared/test/views.test.ts` › "encodes views into short links"

#### Scenario: Link page is the origin
- **WHEN** the web's "Copy link" helper builds a link on the page `http://127.0.0.1:5173/s/abcdefghij`
- **THEN** the link starts with `http://127.0.0.1:5173/#view=`
- **Evidence:** `apps/web/test/viewlink.test.ts` › "copies the shared link" (extended)

### Requirement: Open from the address
Opening the UI with `#view=<code>` SHALL open that view, and with `?view=<name>` the user's saved view of that name, each in a new session of that user (sessions "Create with an open view"); afterwards the address SHALL be `/s/<new id>` without the view part, so a reload does not open it again. A bad code or unknown name SHALL create no session, show the user's latest session (or a new one) and show an error. Origin: concept §9 („Untersuchung direkt öffnen"); Jan 2026-10-17; new session: Jan's „ja" (old tabs keep their case).

#### Scenario: Start-up from a link
- **WHEN** the page's address has `#view=<code>`, `?view=demo`, `?view=nope`, or neither
- **THEN** `startupView(location)` returns `{view: <decoded>}`, `{name: "demo"}`, `{name: "nope"}`, and nothing; the cleaned address keeps the path and drops query and fragment
- **Evidence:** `apps/web/test/viewlink.test.ts` › "reads a view from the address"

#### Scenario: Link in a second browser
- **WHEN** with Jan's windows open the user clicks "Copy link" and `kipscope view link --page <UI origin>/` runs, then a new tab navigates to the printed `url`
- **THEN** the notice says `Link copied (<n> characters)` with n within a few characters of the CLI's `data.chars` (same workspace and page address; compression may differ); the new tab's address becomes `/s/<new id>` after loading, it shows the windows and its strip shows `Opened "<title>"`; the first tab's session and address are unchanged
- **Evidence:** UI check on smart451 (the notice text and the CLI line; screenshot after opening the link). Pasting the clipboard into a tab is the lead's hand check.

#### Scenario: Bookmark by name
- **WHEN** a new tab navigates to `<UI origin>/?view=<saved name>` and then to `<UI origin>/?view=nope`
- **THEN** the first opens the view in a new session (address `/s/<id>` after loading, `Opened "<title>"`); the second creates no session, shows the latest session and an error naming `unknown_view`
- **Evidence:** UI check on smart451 (one screenshot each)
