## ADDED Requirements

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
- **WHEN** a window shows `smart451/COMBI_412h.V_ANZ` (display name `V_ANZ`) and is saved on the dev server
- **THEN** the file lists `smart451/COMBI_412h.V_ANZ` and does not contain `V_ANZ` as a separate value
- **Evidence:** command `curl -s localhost:7310/api/views/<name> | grep -c "smart451/COMBI_412h.V_ANZ"` prints at least 1

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
The server SHALL save the open workspace as a named view in `<stateDir>/views/<name>.yaml`, list, return and delete views. Saving onto an existing name SHALL need `overwrite`, else 409 `view_exists`. The list SHALL show every file, a broken one with its error. Saving SHALL mark the open view as saved. Origin: concept §8 („Speichern/Laden"); Jan 2026-10-17; persona test (boss: keep a view).

#### Scenario: Save, list, overwrite
- **WHEN** on a test server with a temp state dir `POST /api/views {title: "Hard acceleration, drive 3"}` is sent twice, then once with `overwrite: true`, then `GET /api/views`
- **THEN** the first answers 200 with `view.name` `hard-acceleration-drive-3` and the next revision; the second 409 `view_exists`; the third 200; the list holds that view with `windows` and `signals` counts of the workspace; `GET /api/workspace` shows `view` `{name: "hard-acceleration-drive-3", title: "Hard acceleration, drive 3", modified: false}`
- **Evidence:** `apps/server/test/views.http.test.ts` › "saves, lists and overwrites views"

#### Scenario: Broken file listed
- **WHEN** the views directory holds `broken.yaml` with the text `windows: [`
- **THEN** `GET /api/views` lists `{name: "broken", title: "broken", error: …}` and the other views as before
- **Evidence:** `apps/server/test/views.http.test.ts` › "lists a broken file with its error"

#### Scenario: Delete
- **WHEN** `DELETE /api/views/hard-acceleration-drive-3` is sent twice
- **THEN** the first answers 200 `{deleted: "hard-acceleration-drive-3"}` and the file is gone; the second 404 `unknown_view`
- **Evidence:** `apps/server/test/views.http.test.ts` › "deletes a view"

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
While the catalog has never loaded, opening a view SHALL be refused with 503 `catalog_unavailable` and change nothing. Origin: necessary consequence (without a catalog every signal would count as missing).

#### Scenario: Catalog not loaded
- **WHEN** the test server's catalog has never loaded and a view is opened
- **THEN** the answer is 503 `catalog_unavailable` and the revision is unchanged
- **Evidence:** `apps/server/test/views.http.test.ts` › "refuses to open before the catalog loads"

### Requirement: Before last open
Before a view is opened over a workspace with at least one window, the server SHALL keep that workspace as the view `_previous` titled "Before last open", replacing an older one. It SHALL be listed last and open like any view. Origin: necessary consequence of one shared workspace (opening replaces what every tab shows, design S-4); goal: undo of an open without the general undo of concept §8.

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
"Copy link" SHALL copy a link `<page address>#view=<code>` holding the whole open workspace as a view document (deflate-raw, base64url). It works only where a KIPscope server is reachable at that address (local-only, D-046) and knows the view's data refs. Origin: Jan 2026-10-17 („url? shared link?"); concept §9 („Untersuchung direkt öffnen … über … Link").

#### Scenario: Link codec
- **WHEN** a synthetic document of 17 windows with 66 signal entries over 44 smart451-like IDs is encoded with `encodeViewLink` and decoded with `decodeViewLink`, and `decodeViewLink` gets `@@@` and a valid code cut in half
- **THEN** the round trip gives the same document; the code has at most 2,000 characters (goal; Jan's real workspace measured ≈ 1,400); the two bad inputs reject
- **Evidence:** `packages/shared/test/views.test.ts` › "encodes views into short links"

### Requirement: One link for web and CLI
"Copy link" and `kipscope view link` SHALL build the link with one shared function (`viewLinkUrl`, design V1) from one document (`linkViewDoc`: title rule, the note when set, no saved time), so one workspace and page give one link. Origin: design V7/V8; round-2 finding (372 vs 355 characters); lead's decision 2026-10-17.

#### Scenario: Same link from web and CLI
- **WHEN** view "Drive 3" with the note `BLS first` is saved and open, the web's "Copy link" helper and `kipscope view link --page http://127.0.0.1:5173/` build a link for that workspace and page, and the CLI's code is decoded
- **THEN** both links are equal character for character; the decoded document is `linkViewDoc(workspace)`: title `Drive 3`, note `BLS first`, no `saved`; without an open view the title is the measurement name, else `Shared view`, and there is no note; `grep -rn "encodeViewLink(" apps/web/src apps/cli/src` prints nothing (both call `viewLinkUrl`)
- **Evidence:** `packages/shared/test/views.test.ts` › "builds the link document" (`linkViewDoc` title rule, note, no `saved`); `apps/cli/test/cli.test.ts` › "prints the same link as Copy link" (`data.url` equals `viewLinkUrl(<GET /api/workspace>, page)`, the call web "Copy link" makes); `apps/web/test/viewlink.test.ts` › "copies the shared link" (the web helper's link equals `viewLinkUrl` for a workspace with a noted view); the grep above

### Requirement: Open from the address
Opening the UI with `#view=<code>` SHALL open that view, and with `?view=<name>` the saved view of that name; afterwards the UI SHALL remove that part from the address so a reload does not open it again. A bad code or unknown name SHALL leave the workspace unchanged and show an error. Origin: concept §9 („Untersuchung direkt öffnen"); Jan 2026-10-17.

#### Scenario: Start-up from a link
- **WHEN** the page's address has `#view=<code>`, `?view=demo`, `?view=nope`, or neither
- **THEN** `startupView(location)` returns `{view: <decoded>}`, `{name: "demo"}`, `{name: "nope"}`, and nothing; the cleaned address keeps the path and drops query and fragment
- **Evidence:** `apps/web/test/viewlink.test.ts` › "reads a view from the address"

#### Scenario: Link in a second browser
- **WHEN** with Jan's windows open the user clicks "Copy link" and `kipscope view link --page <UI address>` runs, then all windows are removed and a new tab navigates to the printed `url`
- **THEN** the notice says `Link copied (<n> characters)` with n equal to the CLI's `data.chars` (same workspace, same page address, so the same link); the new tab's address loses `#view=…` after loading, all tabs show the windows again, and the new tab's strip shows `Opened "<title>"`
- **Evidence:** UI check on smart451 (the notice text and the CLI line; screenshot after opening the link). Pasting the clipboard into a tab is the lead's hand check.

#### Scenario: Bookmark by name
- **WHEN** a new tab navigates to `<UI address>?view=<saved name>` and then to `<UI address>?view=nope`
- **THEN** the first opens the view (address without `?view=` after loading, `Opened "<title>"`); the second leaves the workspace unchanged and shows an error naming `unknown_view`
- **Evidence:** UI check on smart451 (one screenshot each)

### Requirement: Title of the open view
The top row SHALL show a **Views** button and, when the workspace has an open view, its title with a `•` while it is modified and its note as tooltip; the browser tab title SHALL be `<title> · KIPscope`, else `KIPscope`. Origin: persona test (boss: „a title", no story on screen); concept §9 („Lesezeichen mit Notiz").

#### Scenario: Title and modified dot
- **WHEN** a view "Drive 3" with a note is opened, then cursor A is moved, then the view is saved with Ctrl+S
- **THEN** after the open the top row shows `Drive 3` without dot and the tab title is `Drive 3 · KIPscope`; after the move it shows `Drive 3 •`; after Ctrl+S (no form) the dot is gone and the revision rose by one
- **Evidence:** UI check on smart451 (three screenshots of the top row); `packages/shared/test/apply.test.ts` › "marks the open view modified"; `apps/web/test/views.test.ts` › "titles the top row and the browser tab" (`titleParts` and `documentTitle` for no view, a clean and a modified view)

#### Scenario: Top row stays one line
- **WHEN** a view titled with 120 characters is open with the six-window setup and the sidebar open, at 1440×900 and at 1000×557
- **THEN** every control of the top row has the same `getBoundingClientRect().top` (±1 px) in each viewport; the title text is at least `10ch` wide (rect width ≥ its computed `min-width`, which is `10ch`) and ends in an ellipsis with the full title in its tooltip and in the tab title; at 1440×900 Digits and "+ Values window" are in the row and "⋯" is not displayed; at 1000×557 Digits and "+ Values window" are not displayed in the row, "⋯" is the row's last item, and its menu holds both
- **Evidence:** UI check on smart451: the UI user measures `getBoundingClientRect().top` of every displayed top-row item in a 1000×557 iframe and at 1440×900, as in round 2 (tops, title width and computed `min-width` per viewport, one screenshot each); `bar/bar.css` comment names the measured threshold and the row width after the move (≤ 728 px); `apps/web/test/views.test.ts` › "keeps the title at least ten characters" (`titleMinChars` gives 10 for 120 characters, 7 for `Drive 3`)

### Requirement: Top-row overflow menu
Below a measured width, after the other give-way steps, the top row SHALL move its overflow items (Digits, "+ Values window"; later end-of-row controls such as `add-guidance`'s "?") into a "⋯" menu at its end, so it never wraps at 1000×557 with the sidebar open nor at 1440×900; each item SHALL stay usable by keyboard. Origin: round-2 UI finding (851 px needed, 728 px available); lead's decision 2026-10-17 (Jan: his hints are ideas); design V7 "Top-row overflow rule".

#### Scenario: Overflow menu by keyboard
- **WHEN** at 1000×557 with the sidebar open the user tabs to "⋯", presses Enter, changes Digits to 4 with the arrow keys, tabs to "+ Values window" and presses Enter, then opens "⋯" again and presses Escape
- **THEN** Enter opens the menu with focus on the Digits select; the workspace's digits become 4; a new values window appears; Escape closes the menu and focus is on "⋯"; "⋯" has `aria-haspopup="menu"` and `aria-expanded` true while open, false after
- **Evidence:** UI check on smart451 (focused element and `aria-expanded` read from the page after each step, `kipscope state` for digits and windows; one screenshot with the menu open)

### Requirement: Views menu
The Views menu SHALL offer save entries, the saved views newest first with saved time, window count and data refs, the open one marked, "Before last open" last, "Import file…" and "Copy link"; each row SHALL offer Download and Delete (inline confirm) without shortening the row's meta line. Origin: persona test (boss); Jan 2026-10-17; row layout: round-1 UI finding (spec owner's default, design V7).

#### Scenario: Row actions keep the meta line
- **WHEN** the menu lists a view with 6 windows and data `smart451`, and the pointer moves onto its row
- **THEN** Download and Delete appear; the meta line's rect width and text are the same as before the hover (±1 px), and it reads `<saved local time> · 6 windows · smart451`
- **Evidence:** UI check on smart451 (rects before and on hover, one screenshot on hover); `apps/web/test/views.test.ts` › "describes a menu row" (`rowDetails`)

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
