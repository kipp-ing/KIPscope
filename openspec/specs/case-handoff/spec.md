# case-handoff Specification

## Purpose
How a search tool (finder; not part of KIPscope) hands an ordered catalog of sessions to KIPscope: one document for link, file, CLI and API, signed by the finder on a server, bound to the user, mapped to data refs, and turned into a new workspace whose grant covers exactly the catalog's vehicles.

Test data: catalog C4 of design "Test fixtures" (4 sessions on `testcar` and `othercar`, 2026-10-01 UTC, pad 60 s). T0 = 01:00:00Z = `1790816400000000000`.

## Requirements

### Requirement: Catalog document
A catalog SHALL be a document `{kipscope: "cases", version: 1, cases, current?, pad?, align?, view?, origin?}` (design K2): 1 to 2,000 sessions, each with `id`, `object`, `from`, `to` and optional `kind`, `title`, `meta` (≤ 16 keys), `anchor`; unknown keys ignored. A bad document SHALL be refused as a whole with 400 `invalid_catalog` naming the first bad path. Origin: concept §9 („Untersuchung direkt öffnen"); D-078; payload: exploration, accepted by D-086.

#### Scenario: Valid catalog with defaults
- **WHEN** the catalog parser gets C4 without `current`, `pad` and `align`, plus an unknown top-level key `extra`
- **THEN** it accepts it with `current` 0, `pad` 60 s (`KIPSCOPE_CASE_PAD` default), `align` `{mode: "start"}`, 4 entries in the order sent with times as decimal ns (entry 0 `from` `"1790816400000000000"`), and `extra` dropped
- **Evidence:** `packages/shared/test/case.test.ts` › "parses a catalog document"

#### Scenario: Bad catalogs
- **WHEN** the parser gets a catalog with no sessions, with 2,001 sessions, with `cases[1].to` equal to its `from`, with `cases[2].anchor` after its `to`, with `current` 4 for 4 sessions, with `pad` `"2d"`, and with 17 meta keys on one session
- **THEN** each is refused `invalid_catalog`, the messages naming `cases`, `cases`, `cases[1].to`, `cases[2].anchor`, `current`, `pad` and `cases[0].meta`
- **Evidence:** `packages/shared/test/case.test.ts` › "refuses bad catalogs"

### Requirement: Order defines neighbours
The catalog's order as sent SHALL be the only order KIPscope uses for previous, next, positions and the catalog list; sessions of different vehicles in any order SHALL be accepted, and KIPscope SHALL never sort them. Origin: D-085 („die liste kann beliebig sortiert sein beliebige VINs").

#### Scenario: Unsorted catalog of two vehicles
- **WHEN** C4 (testcar, othercar, testcar, testcar; not in time order) is opened and `GET /api/case` is read
- **THEN** `entries` lists the four ids in the order sent, entry 1 has `dataRef` `othercar`
- **Evidence:** `apps/server/test/case.http.test.ts` › "opens a catalog as a new workspace"

### Requirement: One handoff in four forms
The same catalog SHALL open from the link `/open#cases=<code>`, a file, stdin and `POST /api/workspaces {open: {cases}}`, where `cases` is a JWS, an unsigned code (deflate-raw, base64url, as `#view=`) or, in identity `none`, the plain document; each SHALL create a new workspace and answer its address. Origin: D-078 („Link, CLI-Aufruf und Datei, alles ein Befehl"); D-086 Q2.

#### Scenario: Same workspace content from every form
- **WHEN** in identity `none` C4 is posted once as the document, once as `encodeCasesLink(C4)`, and once as a JWS signed with the test key (keys configured)
- **THEN** each answers 200 with a new workspace ID, and the three workspaces' `case` (without `catalogId`) and `scope` are equal
- **Evidence:** `apps/server/test/case.http.test.ts` › "opens the same catalog from link, file and API"

#### Scenario: Link in the browser
- **WHEN** the web app starts on `/open#cases=<encodeCasesLink(C4)>`
- **THEN** it posts `{open: {cases: <code>}}` once, replaces the address with `/w/<id>` without a second page load, and the strip head shows the session bar at `1 / 4`
- **Evidence:** `apps/web/test/workspaces.test.ts` › "opens /open#cases= as a new workspace"; UI check on smart451 with a link from `kipscope case drives smart451` and `kipscope case url -` (address after load, one screenshot)

#### Scenario: Dropped file
- **WHEN** a file holding C4 as JSON is dropped on the window
- **THEN** the app posts it as `{open: {cases: <document>}}` and goes to `/w/<id>`
- **Evidence:** `apps/web/test/filedrop.test.ts` › "opens a dropped catalog"

### Requirement: Signed catalogs on a server
With an identity other than `none`, a catalog SHALL be accepted only as a JWS (design K3) that verifies against `KIPSCOPE_FINDER_JWKS` with an allowed algorithm, the configured `iss` and `aud`, a valid `exp` and `iat` and `exp − iat` ≤ `KIPSCOPE_FINDER_MAX_AGE`; else 403 `signature_required` or `invalid_signature` with a reason. Origin: D-085 („rechtemanagement in [Suchtool]"); D-086 Q10.

#### Scenario: Verified catalog
- **WHEN** `verifyCases` gets C4 signed with the test Ed25519 key and, separately, with the P-256 key (ES256), both with the configured `iss` and `aud`, `iat` now and `exp` now + 10 min
- **THEN** both are accepted and give the same 4 entries
- **Evidence:** `apps/server/test/caseSignature.test.ts` › "verifies a signed catalog"

#### Scenario: Forged, expired and foreign catalogs
- **WHEN** it gets C4 with one payload byte changed, signed by an unknown key, with `alg` `HS256` keyed by the public key, with `exp` 2 min ago, with `exp − iat` 2 h, with another `iss`, and with another `aud`
- **THEN** each is refused `invalid_signature` with reason `bad_signature`, `unknown_key`, `algorithm`, `expired`, `lifetime`, `issuer` and `audience`
- **Evidence:** `apps/server/test/caseSignature.test.ts` › "refuses forged, expired and foreign catalogs"

#### Scenario: Unsigned catalog with a sign-in
- **WHEN** a server with the example identity module and keys configured gets `POST /api/workspaces` as `alice` with C4 as a document and as `encodeCasesLink(C4)`
- **THEN** both answer 403 `signature_required`, and no workspace is created
- **Evidence:** `apps/server/test/case.http.test.ts` › "refuses unsigned catalogs with a sign-in"

#### Scenario: No finder keys
- **WHEN** that server runs without `KIPSCOPE_FINDER_JWKS` and gets a signed C4
- **THEN** it answers 503 `finder_not_configured`
- **Evidence:** `apps/server/test/case.http.test.ts` › "answers finder_not_configured without keys"

### Requirement: Catalog bound to its user
With an identity other than `none`, the claim `KIPSCOPE_FINDER_USER_CLAIM` (default `sub`) SHALL equal the signed-in user, else 403 `wrong_user`; in `none` mode the check SHALL be skipped. Origin: exploration "Security" („Bound to the user"), accepted by D-086 Q10.

#### Scenario: Forwarded link
- **WHEN** C4 signed with `sub` `alice` is posted by `alice` and by `bob`
- **THEN** `alice` gets 200; `bob` gets 403 `wrong_user` and no workspace
- **Evidence:** `apps/server/test/case.http.test.ts` › "binds a signed catalog to its user and widens the grant"

### Requirement: Objects map to data refs and widen the grant
Each session's data ref SHALL be `KIPSCOPE_CASE_DATAREF` (default `{object}`) with `{object}` replaced; after a successful check the new workspace's grant SHALL be widened by exactly the catalog's data refs (`grantObjects`), without a time part, before any of its data is read. Origin: D-086 Q7 (template), Q12 („rechte haben keinen zeit bezug des objekts"); D-085.

#### Scenario: Template
- **WHEN** `caseDataRef` gets template `{object}` and object `TESTVIN0000000001`, then `fleet-{object}` and `F-104`
- **THEN** it gives `TESTVIN0000000001`, then `fleet-F-104`; `loadConfig` with `KIPSCOPE_CASE_DATAREF=fleet` throws naming the variable
- **Evidence:** `packages/shared/test/case.test.ts` › "maps objects to data refs by the template"; `apps/server/test/config.test.ts` › "reads the finder and case variables"

#### Scenario: Grant of a signed catalog
- **WHEN** `alice`, whose workspaces start with an empty grant, opens a signed C4 and then reads `/api/series` for `othercar/Fast_100h.SIG_A` with `case=1` and for `drivecar/Fast_100h.SIG_A`
- **THEN** the answer's `case.dataRefs` is `["testcar", "othercar"]`, the workspace's grant objects are exactly these, the first series answers 200, the second 403 `forbidden_data`
- **Evidence:** `apps/server/test/case.http.test.ts` › "binds a signed catalog to its user and widens the grant"

### Requirement: Finder variables
The server SHALL read `KIPSCOPE_FINDER_JWKS`, `_ISSUER`, `_AUDIENCE`, `_ALGS`, `_USER_CLAIM`, `_MAX_AGE`, `_ORIGINS`, `KIPSCOPE_CASE_DATAREF` and `KIPSCOPE_CASE_PAD` with the defaults and rules of design K4 and SHALL stop with a message naming the variable on a bad value. Origin: necessary consequence of the signed handoff (D-086 Q10) and of the mapping (Q7).

#### Scenario: Configuration
- **WHEN** `loadConfig` runs with none of them, then with `KIPSCOPE_FINDER_JWKS` set but no issuer, with `KIPSCOPE_FINDER_ALGS=HS256`, with `KIPSCOPE_CASE_PAD=2d`, and with `KIPSCOPE_FINDER_MAX_AGE=30s`
- **THEN** the first gives algs `EdDSA,ES256`, user claim `sub`, max age 1 h, pad 60 s, template `{object}`; each of the others throws naming its variable
- **Evidence:** `apps/server/test/config.test.ts` › "reads the finder and case variables"

### Requirement: Back link only to the finder
`origin.url` SHALL be kept only when its origin is listed in `KIPSCOPE_FINDER_ORIGINS`, or, in identity `none` only, when it is an `http` or `https` URL whose host is `localhost`, `127.0.0.1` or `[::1]`, on any port; otherwise it SHALL be dropped with a warning in the open report. Origin: exploration "Security" („no link can point anywhere else"); loopback in `none`: finder finding (issue #1, comment 2026-10-21), matching the Host guard that accepts loopback on any port (server-access).

#### Scenario: Foreign back link
- **WHEN** C4 with `origin.url` `https://finder.example/#f=1` is opened with `KIPSCOPE_FINDER_ORIGINS=https://finder.example`, and again with `origin.url` `https://evil.example/`
- **THEN** the first catalog keeps the url; the second has none and the report's `warnings` names the dropped url
- **Evidence:** `apps/server/test/case.http.test.ts` › "keeps only a back link to a listed finder"

#### Scenario: Loopback back link
- **WHEN** in identity `none` without `KIPSCOPE_FINDER_ORIGINS` C4 is opened with `origin.url` `http://localhost:5173/#f=1`, `http://127.0.0.1:9999/x`, `http://[::1]:8080/`, `http://localhost.evil.example/` and `file://localhost/x`; and on a server with the example identity module and keys a signed C4 with `origin.url` `http://localhost:5173/` is opened by its user
- **THEN** the first three keep their url with `warnings` `[]`; the fourth, the fifth and the signed one have no url and a warning naming it
- **Evidence:** `apps/server/test/case.http.test.ts` › "keeps a loopback back link in identity none"

### Requirement: Size limits
A `cases` string SHALL be at most 4,000,000 characters and SHALL inflate to at most 4,194,304 bytes, else 400 `invalid_catalog`; a link SHALL be at most 8,192 characters. Origin: exploration "Security" (2,000 sessions by file or API, 8,192 characters by link); D-070 (link limit).

#### Scenario: Inflate bomb and long link
- **WHEN** the server gets an unsigned code that inflates to 10 MB, and `kipscope case url` gets a catalog of 2,000 sessions
- **THEN** the server answers 400 `invalid_catalog` after inflating no more than the limit; the CLI exits 2 with `error.code` `link_too_long`
- **Evidence:** `apps/server/test/case.http.test.ts` › "refuses an oversized catalog"; `apps/cli/test/cli.test.ts` › "prints a catalog link"

### Requirement: Catalog kept with its workspace
The entries SHALL be served by `GET /api/case` and SHALL survive a server restart; `Workspace.case` SHALL hold only the case state of design K2, never the entry list. Origin: necessary consequence of 2,000-entry catalogs and of state pushes carrying the whole workspace (design K6).

#### Scenario: Restart and small pushes
- **WHEN** C4 is opened, a live client connects, then a new server is built from the same state dir and `GET /api/case` is read
- **THEN** the live `state` message's `workspace.case` has `count` 4 and `entry` but no entry list; after the restart `GET /api/case` gives the same `catalogId` and entries and `workspace.case` is unchanged
- **Evidence:** `apps/server/test/case.http.test.ts` › "keeps the catalog out of live state pushes"; "restores the catalog after a restart"

### Requirement: Open lays out the session
A new workspace from a catalog SHALL show the current session: scope `[from − pad, to + pad)` on its data ref, its signal list loaded first; windows from the payload's `view` (at the whole session), else from the user's most recently active workspace with a window (rebound by name, offsets kept from its alignment point when it had a case), else none. Origin: D-078 („gleiche Fenster und Signale"); concept §9 („Template oder Signalauswahl"); Q-2 (a).

#### Scenario: Layout of the latest workspace
- **WHEN** the user's latest workspace has a case on entry 0 of C4 with one window on `testcar/Fast_100h.SIG_A` at [01:02:00, 01:04:00), and C4 with `current` 2 and `align` `{mode: "anchor"}` is opened
- **THEN** the new workspace's scope is `{testcar, 04:49:00, 05:11:00}`, its window shows `testcar/Fast_100h.SIG_A` at [04:57:00, 04:59:00) (offset +2 min from the anchor 04:55:00), and `case.alignAt` is `"1790830500000000000"`
- **Evidence:** `packages/shared/test/case.test.ts` › "opens a case with the latest workspace's layout"; `apps/server/test/case.http.test.ts` › "opens a catalog as a new workspace"

#### Scenario: View in the payload
- **WHEN** C4 with `view` naming a saved view of two windows on `othercar/Fast_100h.SIG_A` is opened at `current` 0
- **THEN** both windows show `testcar/Fast_100h.SIG_A` at the whole scope [00:59:00, 01:11:00)
- **Evidence:** `apps/server/test/case.http.test.ts` › "opens a catalog with a view"

### Requirement: Guide for the finder
`docs/handoff.md` SHALL document every key of the catalog document, a field mapping, the order rule, the JWS header, the deflate-raw payload, the claims and lifetime, a signing example, the JWKS, the link and its limit, the balanced trim rule ("Balanced trim"), that length limits count UTF-16 code units (JavaScript string length) while the inflated limit counts UTF-8 bytes, that one bad entry refuses the whole catalog with `invalid_catalog`, that with `view` each chart opens at the session scope `[from − pad, to + pad)` and the view's own chart times and cursors are not used, the named tab and its opener rule (KIPscope sets no Cross-Origin-Opener-Policy; with `noopener` or a COOP that severs the opener every click opens a new tab), the loopback back link in `none`, and the user-visible errors. Origin: D-086 Q9 („[Suchtool] button … once the payload is fixed"); trim, lengths, refusal, view times and opener: finder findings (issue #1, comment 2026-10-21).

#### Scenario: Guide names every key and claim
- **WHEN** the docs test reads `docs/handoff.md`
- **THEN** it finds each top-level and entry key of the K2 schema, each claim `iss`, `aud`, `sub`, `iat`, `exp`, `cases`, the header `typ` `kipscope-cases`, `deflate-raw`, `target="kipscope"`, the codes `signature_required`, `invalid_signature`, `wrong_user`, `invalid_catalog`, `link_too_long`, and the words `longer side`, `UTF-16`, `as a whole`, `[from − pad, to + pad)`, `Cross-Origin-Opener-Policy`, `noopener` and `--trim`; it does not find `alternately`
- **Evidence:** `apps/server/test/docs.test.ts` › "documents the handoff"

### Requirement: Balanced trim
A catalog whose encoded link is too long SHALL be trimmed by dropping, while too long, the far end of the longer side around `current` (tie: the side before), keeping order and other keys and lowering `current` by the number dropped before it; a fitting catalog SHALL stay unchanged, one that does not fit with `current` alone SHALL be refused `link_too_long` (design X1). Origin: finder finding (issue #1, 2026-10-21); D-070.

#### Scenario: Short side kept
- **WHEN** `trimCases` gets L(3540) (L(n): sessions `c0` … `c<n−1>`, `origin {tool: "t"}`, `pad "60s"`, unknown key `x: 1`; encoder `doc => "x".repeat(doc.cases.length)`) with `current` 2 and `maxChars` 213
- **THEN** it answers `ok` with sessions `c0` … `c212`, `current` 2, `dropped` `{before: 0, after: 3327}`, `origin`, `pad` and `x` unchanged, and the encoder ran at most 14 times
- **Evidence:** `packages/shared/test/caseTrim.test.ts` › "keeps the short side"

#### Scenario: Tie and middle
- **WHEN** it gets L(5) with `current` 2 and `maxChars` 3; and L(10) with `current` 5 and `maxChars` 5
- **THEN** the first keeps `c1` … `c3` with `current` 1 (`dropped {before: 1, after: 1}`); the second keeps `c3` … `c7` with `current` 2 (`dropped {before: 3, after: 2}`)
- **Evidence:** `packages/shared/test/caseTrim.test.ts` › "drops the side before on a tie"

#### Scenario: Current at an edge
- **WHEN** it gets L(10) with `current` 0 and `maxChars` 4, and L(10) with `current` 9 and `maxChars` 4
- **THEN** the first keeps `c0` … `c3` with `current` 0; the second keeps `c6` … `c9` with `current` 3
- **Evidence:** `packages/shared/test/caseTrim.test.ts` › "trims with current at either edge"

#### Scenario: Fits or cannot fit
- **WHEN** it gets L(10) with `current` 4 and `maxChars` 10, and the same with `maxChars` 0
- **THEN** the first answers `ok` with the very same document object, `dropped {before: 0, after: 0}` and `text` of length 10; the second answers `{ok: false, code: "link_too_long", chars: 1}`
- **Evidence:** `packages/shared/test/caseTrim.test.ts` › "leaves a fitting catalog alone and refuses one that cannot fit"

### Requirement: Open warnings shown
The open report's `warnings` SHALL be shown in the message line after an open by link and by a dropped file, in one notice with the open's case notice: case texts first, then the warnings, joined by ` · `. Origin: finder finding (issue #1, comment 2026-10-21: the file drop discards the answer, the link path overwrites one notice with the other); "Back link only to the finder".

#### Scenario: One notice for case texts and warnings
- **WHEN** the open notice is built for a report with `missing` `["othercar/Irr_200h.JITTER"]` and `warnings` `["origin.url https://evil.example/ dropped: its origin is not in KIPSCOPE_FINDER_ORIGINS"]`, for one with only that warning, and for one with neither
- **THEN** the first is one notice `1 signal not in this session: JITTER · origin.url https://evil.example/ dropped: its origin is not in KIPSCOPE_FINDER_ORIGINS`; the second the warning alone; the third no notice
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "shows open warnings with the case notice"

#### Scenario: Report carried across the page load
- **WHEN** `openDroppedCatalog` opens a file and the fake open answers workspace `w1` with a report holding one warning, then the report is taken for `w1` twice, and a report stored for `w1` is taken for `w2`
- **THEN** the first take gives the report, the second nothing; the take for `w2` gives nothing and leaves no entry behind; a storage that throws on write or read changes nothing else (the page still goes to `/w/w1`)
- **Evidence:** `apps/web/test/filedrop.test.ts` › "carries the open report across the page load"; `apps/web/test/workspaces.test.ts` › "shows a dropped catalog's report after the page load"

#### Scenario: Dropped file on smart451
- **WHEN** a catalog from `kipscope case drives smart451` with `origin.url` `https://evil.example/` added is saved as a file and dropped on the window of the dev server (no `KIPSCOPE_FINDER_ORIGINS`)
- **THEN** after the page load the message line reads `origin.url https://evil.example/ dropped: its origin is not in KIPSCOPE_FINDER_ORIGINS`
- **Evidence:** UI check on smart451 (one screenshot of the message line)

### Requirement: Open report in the session bar
The open's notice (texts of "Open warnings shown") SHALL also show in the session bar next to the session text, cut to fit the one-line bar with the full text in its tooltip and a ✕ to dismiss it; it SHALL stay until the ✕ or the first accepted `case.go`, `case.step` or `case.unlink` (design X4a). Origin: Jan's hand check of this change (2026-10-21: the warning only showed cut off in the bottom bar and went unnoticed).

#### Scenario: Note in the bar
- **WHEN** the session bar renders linked C4 with the note `1 signal not in this session: JITTER · origin.url https://evil.example/ dropped: its origin is not in KIPSCOPE_FINDER_ORIGINS`, and again without a note; and `endsOpenNote` gets accepted results of `case.step`, `case.go`, `case.unlink`, `case.align` and a window command, and a refused `case.step`
- **THEN** the first markup holds one `session-open-note` element after the session text with that text and that `title`, and a button labelled `Dismiss`; the second holds none; `endsOpenNote` is true for the first three only
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "shows the open report in the session bar"

#### Scenario: Note on smart451
- **WHEN** at 1440×900 a catalog from `kipscope case drives smart451` with `origin.url` `https://evil.example/` is opened once as a dropped file and once by its link (`kipscope case url -`), the user hovers the note, moves a window, then presses `]`
- **THEN** both times the session bar shows the note beside the session text, the tooltip shows the whole warning, the strip stays ≤ 56 px on one line, the note survives the window move and is gone after `]`
- **Evidence:** UI check on smart451 (one screenshot per open path with the tooltip, one after `]`)
