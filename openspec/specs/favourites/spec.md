# favourites Specification

## Purpose
Each user's starred signals: a list of signal names, kept per user on the server, valid on every vehicle and session, set with a star in the explorer, the keyboard or the CLI, and shown as a Favourites group at the top of the signal list.

## Requirements

### Requirement: Favourites per user
The server SHALL keep each user's favourites as an ordered list of signal names without data ref in `<stateDir>/users/<user>/favourites.yaml` (design F2); with identity `none` the user is `local`. A user SHALL never read or change another user's. A missing file SHALL be the empty list; an unreadable one SHALL be reported, never overwritten. Origin: D-102 („Favourits sind persönlich … user bezogen"; by name without data ref); concept §8; never overwritten: necessary consequence (hand edits, F2).

#### Scenario: File in the user's folder
- **WHEN** on a test server (`none` mode, temp state dir) `POST /api/favourites {add: ["Sna_800h.RPM", "Fast_100h.SIG_A"]}` is sent, then `GET /api/favourites`
- **THEN** both answer 200 with `names` `["Sna_800h.RPM", "Fast_100h.SIG_A"]`, and `<stateDir>/users/local/favourites.yaml` parses to `{kipscope: "favourites", version: 1, names: ["Sna_800h.RPM", "Fast_100h.SIG_A"]}`
- **Evidence:** `apps/server/test/favourites.http.test.ts` › "stores favourites per user in the state dir"

#### Scenario: Favourites per user
- **WHEN** with the test identity adapter alice adds `Sna_800h.RPM`, then bob sends `GET /api/favourites` and `POST /api/favourites {remove: ["Sna_800h.RPM"]}`, then alice sends `GET /api/favourites`
- **THEN** bob's list is `[]` both times, alice's is `["Sna_800h.RPM"]`, and no file under `users/bob/` names `Sna_800h.RPM`
- **Evidence:** `apps/server/test/favourites.http.test.ts` › "keeps favourites per user"

#### Scenario: Broken file is kept
- **WHEN** the user's `favourites.yaml` holds `names: [`, and `GET /api/favourites` and `POST /api/favourites {add: ["X.Y"]}` are sent
- **THEN** the GET answers 200 `{names: [], error: …}` with a non-empty `error`; the POST answers 409 `favourites_unreadable`; the file's text is unchanged
- **Evidence:** `apps/server/test/favourites.http.test.ts` › "leaves a broken file untouched"

#### Scenario: Document rules
- **WHEN** `parseFavouritesDoc` gets `{kipscope: "favourites", version: 1, names: ["A.B", "C.D", "A.B"], extra: 1}`, the same with `version: 2`, with `kipscope: "view"`, with `names: ["", "A.B"]`, with `names: [" A.B"]`, and with 1001 distinct names
- **THEN** the first gives `ok` with `["A.B", "C.D"]`; each other gives `ok: false` with a message
- **Evidence:** `packages/shared/test/favourites.test.ts` › "parses the favourites file tolerantly"

### Requirement: Favourites routes
`GET /api/favourites` SHALL answer the requester's list. `POST /api/favourites {add?, remove?}` SHALL remove, then append each added name not yet present, in order, and answer the new list; a no-op SHALL succeed. Both SHALL have access level `user`. Errors as design "Pinned interfaces" (400, 409, 422, 500); a refused request SHALL leave the file unchanged. Origin: D-102; level `user` and deltas: design F1 (per user; no lost update between tab and CLI); docs: api-reference "HTTP route reference".

#### Scenario: Change rules
- **WHEN** `applyFavouritesChange` gets `["A.B", "C.D"]` with `{add: ["E.F", "A.B", "E.F"]}`, with `{remove: ["A.B", "X.Y"]}`, and with `{remove: ["C.D"], add: ["C.D"]}`
- **THEN** it returns `["A.B", "C.D", "E.F"]`, `["C.D"]` and `["A.B", "C.D"]`
- **Evidence:** `packages/shared/test/favourites.test.ts` › "applies a change: removes, then appends new names once"

#### Scenario: Refused bodies
- **WHEN** `POST /api/favourites` is sent with `{}`, `{add: []}`, `{add: ["x".repeat(201)]}`, `{add: ["A\u0007B"]}`, `{add: ["A.B"], grant: 1}`, and, with 1000 names stored, `{add: ["NEW.ONE"]}`
- **THEN** the first five answer 400 `invalid_request`, the last 422 `too_many_favourites`, and the file is the same before and after each
- **Evidence:** `apps/server/test/favourites.http.test.ts` › "refuses bad changes"

#### Scenario: Routes documented
- **WHEN** the route reference test collects the registered routes of an app with a favourites store
- **THEN** `GET /api/favourites` and `POST /api/favourites` are among them and in `docs/http-api.md`'s table
- **Evidence:** `apps/server/test/docs.test.ts` › "documents every HTTP route" (its app built with a favourites store)

### Requirement: Favourites are not workspace state
Starring SHALL NOT be a workspace command: it SHALL change no workspace revision, no view document and no link, and SHALL need no right on any workspace. Everyone who opens a shared workspace SHALL see their own favourites in it, and a user with only the read right SHALL be able to star. Origin: D-102 („user bezogen"); design F1.

#### Scenario: Shared workspace, own stars
- **WHEN** with the test identity adapter alice owns workspace A shared `read`, alice has favourite `Sna_800h.RPM` and bob `Fast_100h.SIG_A`; bob opens `/api/w/A/live` and sends `POST /api/w/A/favourites {add: ["Sna_800h.SPEED"]}`
- **THEN** bob's connection gets `favourites` with `["Fast_100h.SIG_A"]` on connect and `["Fast_100h.SIG_A", "Sna_800h.SPEED"]` after the POST, which answers 200; A's revision is unchanged; alice's list is still `["Sna_800h.RPM"]`
- **Evidence:** `apps/server/test/favourites.http.test.ts` › "lets a reader of a shared workspace star their own"

### Requirement: Favourites on the live channel
When the server keeps favourites, every live connection SHALL get `{type: "favourites", names, error?}` of its own user right after the `state` sent on connect, and again after each request that changed that user's list, from whichever client or workspace it came. A request that changed nothing SHALL push nothing. Origin: necessary consequence of D-102 with concept §7 (a CLI change shows in the open UI, as every CLI action does) and of a per-user list shown in several tabs; design F4.

#### Scenario: Push to every tab of the user
- **WHEN** with the test identity adapter alice has two live connections (workspaces A and B) and bob one; alice sends `POST /api/favourites {add: ["Sna_800h.RPM"]}`, then the same again
- **THEN** both of alice's connections got `favourites` `[]` after their connect `state` and `["Sna_800h.RPM"]` once after the first POST; nothing after the second; bob's connection got only his connect message
- **Evidence:** `apps/server/test/favourites.http.test.ts` › "pushes favourites on the live channel"

#### Scenario: Live state in the web
- **WHEN** `applyLiveMessage` gets a state with revision 4, then `{type: "favourites", names: ["A.B"]}`
- **THEN** the result has `favourites` `["A.B"]`, revision 4 and the same workspace object
- **Evidence:** `apps/web/test/livestate.test.ts` › "keeps favourites apart from the workspace state"

### Requirement: Star on every explorer row
Every explorer row SHALL have an 18 × 22 px star button in its empty left indent, so dot, name, unit and `+` keep their positions (design F7): `★` while the row's `name` is a favourite, else `☆` only on hover or the active row, keeping its box. A press on it SHALL start no drag and change neither selection nor active row. Origin: D-102 („mit Sternchen markierte"); "Layout never moves" (D-092); look: D-055; tooltip: guidance.

#### Scenario: Star a row on smart451
- **WHEN** on smart451 at 1440×900 with no favourites the user types `speed`, rests the pointer on the row `SPEED_DISP`, then clicks its star
- **THEN** before the click the row shows `☆` and the other rows no star; after the click `SPEED_DISP` shows `★` (`aria-pressed="true"`), a header `★ Favourites 1` is the first item with `SPEED_DISP` under it, and `SPEED_DISP` is still under `CGW` with `★` too; no window changed (revision unchanged)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the click, the revision before and after)

#### Scenario: Star slot on smart451
- **WHEN** at 1440×900 and at 1000×557 (sidebar 208 px) the user types `speed` with `SPEED_DISP` starred, and a snippet reads the `getBoundingClientRect()` of the row, `.star`, `.sna-dot`, `.name` and `.add` of the rows `SPEED_DISP` and `WSPD_FL`
- **THEN** both rows' names start at the same x and their `+` buttons at the same x; each `.star` is 18 × 22 px and lies inside its row's left 18 px; each row's `.sna-dot` starts 18 px (± 1 px) right of the row's left edge, as before this change
- **Evidence:** UI check on smart451 at both sizes (snippet output, one screenshot each)

#### Scenario: Star markup
- **WHEN** the explorer is rendered with `renderToStaticMarkup` for a catalog of `testcar/Sna_800h.RPM` and `testcar/Fast_100h.SIG_A` with favourites `["Sna_800h.RPM"]` and an empty query
- **THEN** each row's first child is `button.star` with `tabindex="-1"`; RPM's has `aria-pressed="true"`, `★` and the title `HINTS.star(true)`; SIG_A's `aria-pressed="false"`, `☆` and `HINTS.star(false)`
- **Evidence:** `apps/web/test/explorer.test.ts` › "renders a star button in every row"

### Requirement: Favourites group
When a row is a favourite, a header `★ Favourites` with their count SHALL come first, open after each query change, followed by a copy of each favourite row (design F5): searching in rank order, else in starred order. Each row SHALL also stay in its group. Favourites not in the catalog in use SHALL stay stored, not shown, counted in the header's tooltip. Origin: D-102 with D-080 (P1 „top of the explorer in book order"); D-103 (Jan's answers to design Q-1 to Q-3).

#### Scenario: Group order and copies
- **WHEN** `explorerItems` gets the ranked matches of signal-groups "Group order and state" (groups `ESP` ranks 3, 5; `Other` rank 1; `CGW` rank 2; `AC` rank 4) with favourites the names of ranks 5 and 2 (in that order), first searching, then with an empty query in catalog order, then searching with `FAVOURITES_GROUP` toggled, then with `grouped` false
- **THEN** searching: header `★ Favourites` (count 2, open, `favourites: true`), rank 2 and rank 5 (`inFavourites: true`), then exactly the items of "Group order and state"; empty query: the header (open), rank 5, rank 2 (favourites order), then the closed headers `AC`, `CGW`, `ESP`, `Other`; toggled: the header closed and no copies; flat: the header, the two copies, then the five matches in rank order without other headers
- **Evidence:** `apps/web/test/explorer.test.ts` › "puts favourites in a group at the top"

#### Scenario: One name on every data ref
- **WHEN** the catalog holds `testcar/Fast_100h.SIG_A` and `othercar/Fast_100h.SIG_A` and the favourites are `["Fast_100h.SIG_A", "Gone_900h.X"]`
- **THEN** the Favourites group holds both entries (count 2), and nothing for `Gone_900h.X`; with favourites `["Gone_900h.X"]` alone the items are exactly those without favourites
- **Evidence:** `apps/web/test/explorer.test.ts` › "matches favourites by name on every data ref"

#### Scenario: Header tooltip
- **WHEN** `HINTS.favourites(5, 7)` and `HINTS.favourites(1, 1)` are evaluated
- **THEN** they read `Favourites: 5 of your 7 starred signals are in this list` and `Favourites: 1 of your 1 starred signals are in this list` or a wording of the same facts that passes the wording rule
- **Evidence:** `apps/web/test/hints.test.ts` › "keeps every hint within the wording rule" (the new samples)

#### Scenario: Search with favourites on smart451
- **WHEN** on smart451 with favourites `WSPD_FL`'s and `SPEED_DISP`'s names the user empties the search, then types `speed`, then `wspd`
- **THEN** with the empty search `★ Favourites 2` is first and open with `WSPD_FL`, `SPEED_DISP` in the order starred, the other groups closed; under `speed` the group shows both in rank order and the row of the best hit of `speed` is active (the same row as without favourites); under `wspd` it shows only `WSPD_FL`
- **Evidence:** UI check on smart451 at 1440×900 (one screenshot per query)

#### Scenario: No visible lag
- **WHEN** 10,000 synthetic matches in 100 groups and 1,000 favourites (500 of them matching) are passed to `explorerItems` while searching
- **THEN** the median of 5 runs is under 10 ms, measured and reported (goal; the test fails only above 50 ms)
- **Evidence:** `apps/web/test/explorer.test.ts` › "groups 10,000 matches with 1,000 favourites in under 10 ms"

### Requirement: Star a selection or by key
A star click on a selected row, or `Ctrl+D` (`Cmd+D` on macOS) in the search on the active selected row, with two or more signals selected, SHALL act on the selection: add the unstarred ones if any, else remove all. Otherwise they SHALL act on that row alone; the key on a header does nothing and never reaches the browser. A signal in two rows SHALL count once (design F8). Origin: D-102 (lead: multi-select toggles all); D-066 L3 (as `+`); key: D-103 (design Q-4).

#### Scenario: Toggle rule
- **WHEN** `toggleFavourites` gets starred `{A.B}` with names `["A.B", "C.D"]`, starred `{A.B, C.D}` with the same names, and any starred set with `[]`
- **THEN** it returns `{add: ["C.D"]}`, `{remove: ["A.B", "C.D"]}` and `undefined`
- **Evidence:** `packages/shared/test/favourites.test.ts` › "toggles a selection: adds unless all are starred"

#### Scenario: Star key
- **WHEN** `isStarKey` gets `d` with Ctrl on a non-mac, `D` with Meta on a mac, `d` with Meta on a non-mac, `d` with Ctrl on a mac, `d` with Ctrl and Alt, `d` with Ctrl and Shift, and `d` alone
- **THEN** it returns true for the first two and false for the others
- **Evidence:** `apps/web/test/keys.test.ts` › "maps Ctrl/Cmd+D to the star"

#### Scenario: Starred row once in a selection
- **WHEN** the items hold the Favourites copy of `testcar/Sna_800h.RPM` and its row in group `SNA codes`, both selected with `testcar/Fast_100h.SIG_A`, and `selectedInOrder` runs
- **THEN** it returns `["testcar/Sna_800h.RPM", "testcar/Fast_100h.SIG_A"]` with RPM once
- **Evidence:** `apps/web/test/selection.test.ts` › "lists a starred row once in the selection"

#### Scenario: Key and selection on smart451
- **WHEN** on smart451 at 1440×900 with no favourites the user types `speed`, clicks `WSPD_FL`, Shift-clicks `WSPD_RR`, presses Ctrl+D (Cmd+D on macOS), then clicks the star of `WSPD_FR`, then presses ArrowDown until `STEER_SPEED` is active (unselected) and presses the key twice
- **THEN** after the key `WSPD_FL`, `WSPD_FR`, `TRQ_DL`, `WSPD_RL`, `WSPD_RR` are starred and no bookmark dialog opened; after the star click on `WSPD_FR` (selected, all starred) none of the five is starred; `STEER_SPEED` is starred after the first key press and not after the second, the five rows still selected throughout
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each step)

### Requirement: Row stays in place
After a star change the active item SHALL stay on the same row (the same signal, in or out of the Favourites group); if that row is gone, the item now at its index SHALL be active. After a star click, the row clicked SHALL stay under the pointer although rows were added or removed above it. Origin: declutter-workspace "Layout never moves" (D-092: „stable and clean it shall be"); design F10.

#### Scenario: Row stays in place on smart451
- **WHEN** on smart451 at 1440×900 with no favourites and the empty search, the user opens group `ESP`, scrolls the list so `WSPD_RR` is in its lower half, reads the row's `getBoundingClientRect().top`, clicks its star, and reads it again
- **THEN** the header `★ Favourites 1` was added at the top of the list and the `WSPD_RR` row under the pointer moved by at most 1 px
- **Evidence:** UI check on smart451 at 1440×900 (both readings, screenshot after the click)

### Requirement: Stars hold everywhere the user works
A star SHALL show in every session and on every data ref that has a signal of that name, after a reload, in every tab of the same user at once, and after a CLI change at once (within 1 s). Origin: D-102 („valid on every vehicle and session"; „user bezogen"); live: design F4.

#### Scenario: Stars hold across sessions and clients on smart451
- **WHEN** on the case workspace of declutter-workspace design DW24 the user stars `SPEED_DISP`, presses `]` to the next session where `SPEED_DISP` has data, reloads the page, opens a second tab on another workspace of the same user, and in a shell runs `kipscope fav add WSPD_FL`
- **THEN** `SPEED_DISP` is starred and under `★ Favourites` after the step, after the reload and in the second tab; within 1 s of the CLI call both tabs show `WSPD_FL` starred without a reload
- **Evidence:** UI check on smart451 (screenshot of each tab after the CLI call, the CLI output)

### Requirement: Favourites documented
`docs/manual.md` SHALL explain stars under "Find a signal" (the star, the Favourites group, `Ctrl/Cmd+D`, the selection rule, per user and by name on every vehicle); the help's key list SHALL hold `Ctrl/Cmd+D`; `docs/http-api.md` SHALL list both routes and the live message. Origin: guidance (manual and keys stay complete); api-reference "HTTP route reference".

#### Scenario: Manual and keys
- **WHEN** `grep -n "Favourites\|Ctrl/Cmd+D" docs/manual.md` runs and `SHORTCUTS` is read
- **THEN** grep prints at least two lines under "Find a signal", and `SHORTCUTS` holds `Ctrl/Cmd+D` in the group "Signal list"; `manual.test.ts` and `shortcuts.test.ts` stay green
- **Evidence:** the `grep` command; `apps/web/test/shortcuts.test.ts`, `apps/web/test/manual.test.ts`

#### Scenario: Live message documented
- **WHEN** `grep -n "favourites" docs/http-api.md` runs
- **THEN** it prints the two route rows and a line in "Live channel" naming the `favourites` message
- **Evidence:** the `grep` command
