# saved-views Specification

## Purpose
Keeps a view and hands it on: one versioned view document (YAML on disk, JSON in links) with the windows, signals, ranges, cursors and options of a workspace but no measured data and no credentials; named views on the server, export and import, self-contained `#view=` links and `?view=<name>` bookmarks, and the CLI `view` forms.

## Requirements

### Requirement: View document
A view SHALL be a YAML document with `kipscope: view`, `version: 1`, title, optional note, the data refs of its signals, link flag, cursors and diff mode, digits, optional measurement, event filter and events-line signals, signal colours, and its windows in order (kind, title, range, display, height or values mode, signals as full IDs), written in the canonical form of design V1. Origin: concept §8 (the saved state's list); Jan 2026-10-17 („yaml export").

#### Scenario: Workspace to document and back
- **WHEN** a workspace with a linked timeseries window (two signals, height 360, mode step, envelope on), a values window, cursors A and B with diff on, digits 4, measurement name and one meta entry, event filter `faults`, one events-line signal and colours 3 and 5 is turned into a document with `workspaceToView` and opened again with `view.open`
- **THEN** the new workspace equals the old one except window and assignment IDs (renumbered from the old `nextId`), `lastZoomed` (absent) and `view` (`{title, modified: false}`)
- **Evidence:** `packages/shared/test/views.test.ts` › "round-trips a workspace through a view document"

#### Scenario: Canonical YAML
- **WHEN** the server writes the document of design V1's example
- **THEN** the file text equals the example byte for byte (key order, no absent fields, block lists)
- **Evidence:** `apps/server/test/views.test.ts` › "writes the canonical YAML form"

### Requirement: No data, secrets or IDs in a view
A view SHALL hold no measured values, no server address, no credentials and no window or assignment IDs. Origin: concept §8 („Ein Snapshot der Ansicht ist keine Kopie der Messdaten"; „Zugangsdaten gehören nicht in exportierte Templates"); necessary consequence (IDs are internal to one server run).

#### Scenario: Nothing secret or internal
- **WHEN** a workspace is saved on a test server whose ClickHouse password is `s3cret`
- **THEN** the file contains neither `s3cret`, nor the server URL, nor any `w<n>` or `a<n>` ID, nor `nextId`
- **Evidence:** `apps/server/test/views.http.test.ts` › "stores no credentials and no internal IDs"

### Requirement: Exact and stable references
A view SHALL reference signals by full ID `dataRef/name`, never by display name, and times as absolute UTC ISO-8601 exact to the nanosecond. Reading SHALL accept ISO-8601 with any offset or decimal nanoseconds for times and SHALL write them back as UTC. Origin: concept §8 („Originalzeitpräzision bleibt bei … Zustandsablage … erhalten"; „Datenreferenz"); D-035/D-036 (display names may change); D-045 (exact times).

#### Scenario: Nanoseconds survive
- **WHEN** cursor A is at `1791896881500000001` ns and the workspace is saved, read back and opened
- **THEN** the file says `a: 2026-10-13T13:08:01.500000001Z` and the opened workspace's cursor A is `1791896881500000001`
- **Evidence:** `packages/shared/test/views.test.ts` › "keeps times exact to the nanosecond"

#### Scenario: Display names are not references
- **WHEN** a window shows `smart451/ICL_3A2h.SPEED_DISP` (display name `SPEED_DISP`) and is saved on the dev server
- **THEN** the file lists `smart451/ICL_3A2h.SPEED_DISP` and does not contain `SPEED_DISP` as a separate value
- **Evidence:** command `curl -s localhost:7310/api/views/<name> | grep -c "smart451/ICL_3A2h.SPEED_DISP"` prints at least 1

### Requirement: Versioned, tolerant reading
Reading a view SHALL accept YAML and JSON. A document whose `kipscope` is not `view` SHALL be refused with `invalid_view`; a `version` above 1 with `unsupported_version` naming both versions; a field that fails validation with `invalid_view` naming its path. Unknown keys SHALL be dropped with one warning each, never refused. Origin: concept §8 („versionierbare Konfiguration"); necessary consequence (files outlive builds and are edited by hand).

#### Scenario: Versions and keys
- **WHEN** `parseViewDoc` reads (1) a valid v1 document as parsed JSON, (2) the same with `version: 2`, (3) with `kipscope: workspace`, (4) with `windows[0].from: "yesterday"`, (5) with an extra top-level `author` and `windows[1].colour`
- **THEN** (1) is ok without warnings; (2) fails `unsupported_version` with message `view version 2; this KIPscope reads 1`; (3) fails `invalid_view`; (4) fails `invalid_view` with `windows.0.from` in the message; (5) is ok with the warnings `unknown key "author" ignored` and `unknown key "windows[1].colour" ignored`
- **Evidence:** `packages/shared/test/views.test.ts` › "reads versions and unknown keys"

#### Scenario: YAML timestamps stay strings
- **WHEN** a YAML file with unquoted `from: 2026-10-13T13:08:00Z` is imported
- **THEN** the import succeeds and the window range starts at `1791896880000000000`
- **Evidence:** `apps/server/test/views.http.test.ts` › "imports YAML and JSON"

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

### Requirement: File-safe view names
A view name SHALL be given or derived from the title (`viewName`) and match `^[a-z0-9][a-z0-9-]{0,62}$`; any other name SHALL be refused with 400 `invalid_view_name`, and no request SHALL read or write a file outside the views directory. Origin: necessary consequence (names become file names; D-046 keeps the server local, not trusted input).

#### Scenario: Names from titles
- **WHEN** `viewName` gets `Hard acceleration, drive 3`, `Übersicht Fahrt 1`, `   `, and a title of 120 `x`
- **THEN** it returns `hard-acceleration-drive-3`, `ubersicht-fahrt-1`, `view`, and 63 `x`
- **Evidence:** `packages/shared/test/views.test.ts` › "derives file names from titles"

#### Scenario: No path outside the views directory
- **WHEN** `GET /api/views/..%2Fworkspace`, `GET /api/views/a.b`, `DELETE /api/views/-x` and `POST /api/views {title: "t", name: "../x"}` are sent
- **THEN** each answers 400 `invalid_view_name` and no file outside `<stateDir>/views/` is read, written or removed
- **Evidence:** `apps/server/test/views.http.test.ts` › "refuses names that are not file-safe"

### Requirement: Open a view
Opening a view SHALL replace the open workspace in one command `view.open` and one revision, pushed to every tab. Window and assignment IDs SHALL continue from the current `nextId`. Origin: concept §8 („Laden"); D-011 D8 (every change is a command).

#### Scenario: One revision, fresh IDs
- **WHEN** the workspace is at revision 7 with `nextId` 12 and two windows, and `POST /api/views/open {name}` opens a saved view with three windows
- **THEN** the answer is `{ok: true, revision: 8, report: {missing: [], skipped: [], warnings: []}}`, a fake live client got exactly one state push with `command` `view.open`, and the three windows are `w12`, `w13`, `w14` (assignments after them)
- **Evidence:** `apps/server/test/views.http.test.ts` › "opens a view as one command"

#### Scenario: Open on real data
- **WHEN** a view with Jan's windows is saved on the dev server, three windows are then removed in the UI, and the view is opened from the Views menu
- **THEN** within 1 s every open tab shows the saved windows with their ranges, cursors and colours again, and the strip shows `Opened "<title>"`
- **Evidence:** UI check on smart451 (screenshots before removing and after opening)

### Requirement: Signals left out on open
On open, signals the catalog does not know SHALL be left out and listed in `report.missing`, and known signals over the unit, signal-count or duplicate rules in `report.skipped` with their reason; the view file SHALL stay unchanged. Origin: D-019 and workspace-state "Signal limit" (limits hold on open); necessary consequence (catalogs change, files do not).

#### Scenario: Missing and skipped signals reported
- **WHEN** a view's window lists `testcar/Sna_800h.RPM`, `testcar/Gone_1h.X` (not in the catalog), RPM again, and signals of five different units, and it is opened
- **THEN** the window shows RPM and the first signals up to four units; `report.missing` is `["testcar/Gone_1h.X"]`; `report.skipped` lists the duplicate RPM with `already_in_window` and the fifth unit's signal with `too_many_units`; reading the view file again gives the same text as before
- **Evidence:** `packages/shared/test/apply.test.ts` › "opens a view with missing and skipped signals"; `apps/server/test/views.http.test.ts` › "opens a view as one command" (file unchanged)

### Requirement: Linked ranges on open
A view opened with linked time axes SHALL have one range in all its timeseries windows. Origin: D-017; workspace-state "Linked time axes".

#### Scenario: Linked ranges aligned
- **WHEN** a hand-written view has `linkTime: true` and two timeseries windows with different ranges
- **THEN** after the open both have the first window's range and `report.warnings` holds `time axes are linked: ranges aligned to the first window`
- **Evidence:** `packages/shared/test/apply.test.ts` › "aligns ranges of a linked view"

### Requirement: Open needs the catalog
Opening a view SHALL need the signal list it is checked against. A view that resolves a scope (saved-views "Open sets the scope") SHALL first load that scope's list, and answer 503 `catalog_unavailable` and change nothing when that load fails. A view that resolves no scope SHALL need the full catalog in full mode, answering 503 `catalog_unavailable` while it has never loaded, and SHALL be refused with `scope_required` in scoped mode. Origin: necessary consequence (without a list every signal would count as missing); the ADX feedback item 3 („The scope's signal list loads before the view's signals are checked").

#### Scenario: Catalog not loaded
- **WHEN** the test server's full catalog has never loaded and a view with only a values window and no cursors (no scope) is opened
- **THEN** the answer is 503 `catalog_unavailable` and the revision is unchanged
- **Evidence:** `apps/server/test/views.http.test.ts` › "refuses to open before the catalog loads"

#### Scenario: Scope list loads first
- **WHEN** the full catalog has never loaded, and a view with one `testcar` timeseries window [T1 + 10 min, T1 + 20 min) is opened on the test server (pad 1 h); separately the same open runs while the stub source fails `listSignals` for that scope
- **THEN** the first answers 200 after the source's `listSignals` was called with scope {testcar, T1 − 50 min, T1 + 80 min}, and its report's `missing` is checked against that list; the second answers 503 `catalog_unavailable` and the revision is unchanged
- **Evidence:** `apps/server/test/views.http.test.ts` › "loads the scope's list before checking the view"

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

### Requirement: Export and import
Each saved view SHALL be downloadable as its YAML file (`<name>.kipscope.yaml`). A YAML or JSON view text of at most 256 KiB SHALL be importable as a named view (name given or from its title, `overwrite` as for save), stored in canonical form, optionally opened at once; the import result SHALL carry the reader's warnings. Origin: Jan 2026-10-17 („yaml export"); persona test (boss: hand a view on); concept §8 (no offline data export: the file holds no data).

#### Scenario: Download headers
- **WHEN** `GET /api/views/hard-acceleration-drive-3?download=1` is sent
- **THEN** it answers 200 with `content-type` `application/yaml; charset=utf-8`, `content-disposition` `attachment; filename="hard-acceleration-drive-3.kipscope.yaml"` and the file text as body
- **Evidence:** `apps/server/test/views.http.test.ts` › "serves a view file for download"

#### Scenario: Import YAML and JSON
- **WHEN** the exported text is imported with `name: "copy"`, the same document as JSON with `name: "copy-json"` and `open: true`, and a text of 300 KiB
- **THEN** the first two answer 200 and `copy.yaml` and `copy-json.yaml` have the exported text except `saved`; the second carries `opened.ok` true; the third answers 413 `view_too_large`
- **Evidence:** `apps/server/test/views.http.test.ts` › "imports YAML and JSON"

#### Scenario: Syntax error named
- **WHEN** a text with a YAML syntax error in line 4 is imported
- **THEN** the answer is 400 `invalid_view_yaml` and the message names line 4
- **Evidence:** `apps/server/test/views.http.test.ts` › "imports YAML and JSON"

#### Scenario: Alias bomb refused
- **WHEN** a 2 KiB YAML text whose anchors and aliases nest 10 levels deep (each level 10 aliases of the one before) is imported, and the same text lies in the views directory as `bomb.yaml`
- **THEN** the import answers 400 `invalid_view_yaml` within 1 s and the server stays up; `GET /api/views` lists `bomb` with `error`; `POST /api/views/open {name: "bomb"}` answers 422 `invalid_view`
- **Evidence:** `apps/server/test/views.http.test.ts` › "refuses an alias bomb"

#### Scenario: Download and import in the UI
- **WHEN** in the Views menu the user hovers a view's row, then `kipscope view export <name> --out /tmp/v.yaml`, `kipscope view delete <name>` and `kipscope view import /tmp/v.yaml --open` run, and the menu is opened again
- **THEN** the row's Download link has `href` `/api/views/<name>?download=1`; after the import every tab shows the view's windows, the title in the top row and the notice `"<title>" opened elsewhere`, and the menu lists the view again, marked ✓
- **Evidence:** UI check on smart451 (the `href` read from the page; one screenshot of the menu after the import). The file dialogs themselves (browser saves `<name>.kipscope.yaml`; "Import file…" with it) are the lead's hand check (design "Manual checks").

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

### Requirement: One link for web and CLI
"Copy link" and `kipscope view link` SHALL build the link with one shared function (`viewLinkUrl`, design V1) from one document (`linkViewDoc`: title rule, the note when set, no saved time), so one workspace and page give one link. Origin: design V7/V8; round-2 finding (372 vs 355 characters); lead's decision 2026-10-17.

#### Scenario: Same link from web and CLI
- **WHEN** view "Drive 3" with the note `BRK_LMP first` is saved and open, the web's "Copy link" helper and `kipscope view link --page http://127.0.0.1:5173/` build a link for that workspace and page, and the CLI's code is decoded
- **THEN** both links decode to the same document (compressed bytes may differ between browser and Node: lead 2026-10-17, measured 520 vs 512 characters); the decoded document is `linkViewDoc(workspace)`: title `Drive 3`, note `BRK_LMP first`, no `saved`; without an open view the title is the measurement name, else `Shared view`, and there is no note; `grep -rn "encodeViewLink(" apps/web/src apps/cli/src` prints nothing (both call `viewLinkUrl`)
- **Evidence:** `packages/shared/test/views.test.ts` › "builds the link document" (`linkViewDoc` title rule, note, no `saved`); `apps/cli/test/cli.test.ts` › "prints the same link as Copy link" (`data.url` equals `viewLinkUrl(<GET /api/workspace>, page)`, the call web "Copy link" makes); `apps/web/test/viewlink.test.ts` › "copies the shared link" (the web helper's link equals `viewLinkUrl` for a workspace with a noted view); the grep above

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

### Requirement: Title of the open view
The top row SHALL show a **Views** button and, when the workspace has an open view, its title with a `•` while it is modified and its note as tooltip; the browser tab title SHALL be `<title> · KIPscope`, else `KIPscope`. Origin: persona test (boss: „a title", no story on screen); concept §9 („Lesezeichen mit Notiz").

#### Scenario: Title and modified dot
- **WHEN** a view "Drive 3" with a note is opened, then cursor A is moved, then the view is saved with Ctrl+S
- **THEN** after the open the top row shows `Drive 3` without dot and the tab title is `Drive 3 · KIPscope`; after the move it shows `Drive 3 •`; after Ctrl+S (no form) the dot is gone and the revision rose by one
- **Evidence:** UI check on smart451 (three screenshots of the top row); `packages/shared/test/apply.test.ts` › "marks the open view modified"; `apps/web/test/views.test.ts` › "titles the top row and the browser tab" (`titleParts` and `documentTitle` for no view, a clean and a modified view)

#### Scenario: Top row stays one line
- **WHEN** a view titled with 120 characters is open with the six-window setup and the sidebar open, at 1440×900 and at 1000×557
- **THEN** every control of the top row has the same `getBoundingClientRect().top` (±1 px) in each viewport; the title text is at least `10ch` wide (rect width ≥ its computed `min-width`, which is `10ch`) and ends in an ellipsis with the full title in its tooltip and in the tab title; at both sizes Digits and "+ Values window" are not displayed in the row and the "⋯" menu holds both; "Share…" is in the row at both sizes and never in the "⋯" menu
- **Evidence:** UI check on smart451: the UI user measures `getBoundingClientRect().top` of every displayed top-row item in a 1000×557 iframe and at 1440×900 (tops, title width and computed `min-width` per viewport, one screenshot each); `apps/web/test/views.test.ts` › "keeps the title at least ten characters" (`titleMinChars` gives 10 for 120 characters, 7 for `Drive 3`)

### Requirement: Top-row overflow menu
The top row SHALL end with "Share…", a "⋯" button (`aria-label` `More`) and "?" at every width. The "⋯" menu SHALL hold Digits (the segmented control of `number-format` "Digits option") and "+ Values window" and nothing else; "Share…" SHALL never move into it. The row never wraps at 1000×557 with the sidebar open nor at 1440×900 (the view title shrinks first, `10ch` at least). Each item SHALL stay usable by keyboard; opening the menu SHALL focus its first control that is not `tabindex="-1"`, which is the checked Digits button. Origin: round-2 UI finding of `add-saved-views` (851 px needed, 728 px available); design V7 "Top-row overflow rule"; Digits and "+ Values window" always in "⋯" and "?" in the row: D-092 (7) (supersedes D-071's width rule for them), mock `Compact.dc.html`; Share in the row at every width: D-095 (critic 15, supersedes the compact-width move of D-092's mock and the Share overflow item of D-086's M12); Digits as a segmented control: D-112 (1).

#### Scenario: Overflow menu by keyboard
- **WHEN** at 1000×557 with the sidebar open and digits 3 the user does, in order:
  1. tabs to "⋯" and presses Enter
  2. presses ArrowRight
  3. tabs to "+ Values window" and presses Enter
  4. presses Shift+Tab until "Share…" in the row has focus and presses Enter, then presses Escape
- **THEN**
  - Enter opens the menu with focus on the Digits button `3` (checked)
  - ArrowRight moves focus to `4`, checks it, and the menu stays open
  - the workspace's digits become 4, and a new values window appears
  - "Share…" opens its popover from the row
  - the Escape closes the popover with focus on "Share…"
  - "⋯" has `aria-haspopup="menu"`, with `aria-expanded` true while open and false after
- **Evidence:** UI check on smart451 (focused element and `aria-expanded` read from the page after each step, `kipscope state` for digits and windows; one screenshot with the menu open)

#### Scenario: Share in the row when there is room
- **WHEN** the six-window setup is open with the sidebar open at 1440×900 and at 1000×557, and the user opens "⋯"
- **THEN** "Share…" is in the top row before "⋯", "⋯" and "?" are displayed after it, every top-row item has the same `getBoundingClientRect().top` (±1 px), and the menu holds Digits and "+ Values window" but not "Share…", at both sizes
- **Evidence:** UI check on smart451 at both sizes (tops read from the page; one screenshot with the menu open per size); `apps/web/test/bar.test.ts` › "renders the top row in order" (no Share item in the menu markup)

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

### Requirement: Save in place
With a named open view, "Save" (Ctrl/Cmd+S) SHALL save it in place without asking and "Save as…" SHALL open the form; otherwise "Save view…" (Ctrl/Cmd+S) opens the form. Saving SHALL ask "Replace?" only when the name belongs to a different view. Origin: round-1 UI finding (spec owner's default, design V7); persona test (boss: keep a view).

#### Scenario: Save the open view in place
- **WHEN** view "Speeds" (name `speeds`) is open and modified, and the user picks "Save"; then "Save as…" with the title unchanged; then Ctrl+S
- **THEN** "Save" and Ctrl+S save without a form, the "Save as…" form saves without "Replace?"; each removes the `•` and raises the revision by one; the menu lists one "Speeds"
- **Evidence:** UI check on smart451 (screenshot of the menu after); `apps/web/test/views.test.ts` › "saves the open view in place" (`saveEntries` and `saveTarget` for no view, an unnamed view, a named view with unchanged, changed and same-name titles)

#### Scenario: Save onto another view's title
- **WHEN** "Speeds" is saved, view "Drive 3" is opened, and the user saves with "Save as…" under the title "Speeds"
- **THEN** the form shows `"Speeds" exists. Replace?`; "Replace" saves it, the menu lists one "Speeds", marked ✓, and "Drive 3" is unchanged
- **Evidence:** UI check on smart451 (screenshot of the prompt and of the list after); `apps/web/test/views.test.ts` › "reads a 409 into a Replace prompt" (`existingTitle`)

### Requirement: Open notice
After an open, the strip SHALL show `Opened "<title>"` and, if any, how many signals were not found or left out, in the info tone, replacing any older message; a click removes it. Other tabs SHALL show `"<title>" opened elsewhere`. Origin: necessary consequence of "Signals left out on open" (the user must see what is missing); replacing and "elsewhere": round-1 UI finding (spec owner's default, design V7).

#### Scenario: Open notice names missing signals
- **WHEN** a view file whose first window lists `smart451/Nope_1h.X` is imported and opened
- **THEN** the strip shows `Opened "<title>" · 1 signal not found: Nope_1h.X` in the info tone, and a click removes it
- **Evidence:** UI check on smart451 (screenshot of the strip); `apps/web/test/views.test.ts` › "builds the open notice" (`openNotice`)

#### Scenario: Open clears an older message
- **WHEN** `<UI address>?view=nope` shows the `unknown_view` error, and then a view is opened from the menu
- **THEN** the strip shows only `Opened "<title>"` in the info tone, no error
- **Evidence:** UI check on smart451 (screenshot of the strip); `apps/web/test/views.test.ts` › "clears an older message on open" (`nextStrip`: error then opened gives the notice; notice then error gives the error)

#### Scenario: Opened elsewhere
- **WHEN** two tabs are open, tab A opens "Speeds" from its menu (A shows `Opened "Speeds"`), and then `kipscope view open <other name>` runs
- **THEN** both tabs show the other view, and each strip shows `"<other title>" opened elsewhere` in the info tone; tab A's `Opened "Speeds"` is gone (replaced, not kept); right after A's own open, A showed `Opened "Speeds"` and no "opened elsewhere" for it (its own push, even when the push arrived before the HTTP answer)
- **Evidence:** UI check on smart451 (A's strip text before and after the CLI open, one screenshot of A after); `apps/web/test/views.test.ts` › "notices an open from elsewhere" (`openedElsewhere` for a foreign `view.open` push, the tab's own revision, and another command); `apps/web/test/livestate.test.ts` › "keeps the last view open across later pushes" (`applyLiveMessage` sets `lastOpen` on a `view.open` push, keeps it over a following `window.setRange` push, never sets it from the connect state)

### Requirement: Scope in a view document
A view document SHALL accept an optional `scope` `{dataRef, from, to}` (ISO UTC to the ns), written after `data` by `workspaceToView` and `linkViewDoc` when the workspace has a scope, and SHALL stay `version: 1`. A `scope` whose `to` is not after `from` SHALL be refused with `invalid_view`. Origin: the ADX feedback item 3 („may carry an explicit optional `scope`"; „The view v1 link format does not change"); concept §8; D-070 (unknown keys dropped with a warning).

#### Scenario: Round trip with a scope
- **WHEN** a workspace with scope {testcar, T1, T2} and one window is turned into a document, written as YAML, read with `parseViewDoc`, and opened; and the same document is read by a parser without the `scope` key in its known keys
- **THEN** the YAML holds `scope:` with `dataRef: testcar`, `from: 2026-10-01T01:00:00Z`, `to: 2026-10-01T02:00:00Z` right after `data`, `version` is 1, and the opened workspace has the same scope; the older parser reads it with the warning `unknown key "scope" ignored`
- **Evidence:** `packages/shared/test/views.test.ts` › "round-trips the scope of a view"

#### Scenario: Canonical form without scope unchanged
- **WHEN** the server writes the document of design V1's example (no scope)
- **THEN** the file text equals the example byte for byte
- **Evidence:** `apps/server/test/views.test.ts` › "writes the canonical YAML form" (unchanged)

### Requirement: Open sets the scope
Opening a view, a `#view=` link or `?view=<name>` SHALL set the workspace's scope in both modes (design Q-1 (a)): the command's `scope`, else the document's, else `viewScope` (design Z8: the first signal's data ref and the union of window ranges and cursors, padded by `KIPSCOPE_SCOPE_PAD`). A view without a data ref or a time sets none. Origin: the ADX feedback item 3; D-078 („shows one case at a time").

#### Scenario: Derived scope
- **WHEN** `viewScope` gets, with pad 1 h, a document whose windows are `testcar` [T1, T1 + 10 min) and [T1 + 30 min, T1 + 40 min) with cursor A at T1 + 50 min; one whose first window shows `othercar/X.Y` and second `testcar/X.Y`; one with only a values window and no cursor; and one with `scope` {testcar, T1, T2}
- **THEN** it gives {testcar, T1 − 1 h, T1 + 50 min + 1 ns + 1 h}; a scope on `othercar`; undefined; and {testcar, T1, T2} unpadded
- **Evidence:** `packages/shared/test/scope.test.ts` › "derives the scope of a view"

### Requirement: View clamped into its scope
On open, window ranges SHALL be clamped into the scope with the warning `ranges clamped to the scope`, and cursors outside it SHALL be dropped with a warning naming the cursor. Origin: scope "Ranges and cursors stay in the scope" (the invariant holds after every command).

#### Scenario: Explicit scope smaller than the windows
- **WHEN** a view with `scope` {testcar, T1, T2}, a window [T1 − 30 min, T1 + 10 min) and cursor B at T2 + 1 min is opened
- **THEN** the window shows [T1, T1 + 40 min), cursor B is off, and `report.warnings` holds `ranges clamped to the scope` and `cursor B outside the scope dropped`
- **Evidence:** `packages/shared/test/apply.test.ts` › "opens a view into its scope"

#### Scenario: Link opens with a scope on real data
- **WHEN** with a 20 min window on smart451 in full mode, "Copy link" is used, the scope is cleared, and a new tab opens the link
- **THEN** every tab shows the window again, and the strip head shows `SCOPE smart451` with the window's range padded by 1 h on each side
- **Evidence:** UI check on smart451 (screenshot of the strip head and header)

### Requirement: Signals of another data ref on open
On open, a window signal whose data ref is not the scope's SHALL be left out and listed in `report.skipped` with reason `out_of_scope` and its window index. An events-line signal of another data ref SHALL be dropped with one warning. Origin: D-078 (one data ref per case); design Q-2 (a).

#### Scenario: Two data refs in one view
- **WHEN** a view whose first window shows `testcar/Fast_100h.SIG_A` and `othercar/Fast_100h.SIG_A` is opened on the test server
- **THEN** the scope is on `testcar`, the window shows only the `testcar` signal, and `report.skipped` is `[{"signalId":"othercar/Fast_100h.SIG_A","window":0,"reason":"out_of_scope"}]`
- **Evidence:** `apps/server/test/views.http.test.ts` › "skips signals of another data ref"

### Requirement: Computed signals in a view
A view document SHALL carry the workspace's computed signals as `computed` entries (name, canonical formula, unit) without IDs, a nested reference written as the other entry's name, and windows SHALL list a computed signal as `<dataRef>/=<name>`. An entry that fails validation, closes a cycle or exceeds a limit SHALL be left out with a warning. Opening SHALL give each definition a fresh ID. `version` stays 1. Origin: D-102 („the definition lives in the workspace and the view"); no IDs: saved-views "No data, secrets or IDs in a view"; nesting: D-106 with D-105 Q-1; version: add-computed-signals C10.

#### Scenario: Round trip
- **WHEN** a workspace with computed `c3` ("Diff", `Fast_100h.SIG_A - Sna_800h.SPEED`, unit `A`) and `c4` ("AbsDiff", `abs(Diff)`), both shown in a window, is turned into a document with `workspaceToView` and opened with `view.open` on a workspace whose `nextId` is 40
- **THEN** the document has `computed: [{name: Diff, formula: "Fast_100h.SIG_A - Sna_800h.SPEED", unit: A}, {name: AbsDiff, formula: "abs(Diff)"}]`, the window lists `testcar/=Diff` and `testcar/=AbsDiff` and no `c3` or `c4` appears; the opened workspace has both definitions with new IDs (n ≥ 40), AbsDiff's formula still `abs(Diff)`, and the window shows both new IDs
- **Evidence:** `packages/shared/test/views.test.ts` › "round-trips computed signals through a view document"

#### Scenario: Broken entry and missing reference
- **WHEN** `parseViewDoc` reads a document with computed entries `{name: Bad, formula: "X.A %"}`, `{name: P, formula: "Q + 1"}`, `{name: Q, formula: "P + 1"}`, and a window listing `testcar/=Nope`
- **THEN** it is ok with the warnings `computed signal "Bad" left out: Unexpected "%" at 5` and, for P and Q, `computed signal "<name>" left out: Cycle: …`; on open `testcar/=Nope` is in `report.missing`
- **Evidence:** `packages/shared/test/views.test.ts` › "leaves out a broken computed entry with a warning"
