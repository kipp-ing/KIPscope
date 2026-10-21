## ADDED Requirements

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

## MODIFIED Requirements

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

### Requirement: Guide for the finder
`docs/handoff.md` SHALL document every key of the catalog document, a field mapping, the order rule, the JWS header, the deflate-raw payload, the claims and lifetime, a signing example, the JWKS, the link and its limit, the balanced trim rule ("Balanced trim"), that length limits count UTF-16 code units (JavaScript string length) while the inflated limit counts UTF-8 bytes, that one bad entry refuses the whole catalog with `invalid_catalog`, that with `view` each chart opens at the session scope `[from − pad, to + pad)` and the view's own chart times and cursors are not used, the named tab and its opener rule (KIPscope sets no Cross-Origin-Opener-Policy; with `noopener` or a COOP that severs the opener every click opens a new tab), the loopback back link in `none`, and the user-visible errors. Origin: D-086 Q9 („[Suchtool] button … once the payload is fixed"); trim, lengths, refusal, view times and opener: finder findings (issue #1, comment 2026-10-21).

#### Scenario: Guide names every key and claim
- **WHEN** the docs test reads `docs/handoff.md`
- **THEN** it finds each top-level and entry key of the K2 schema, each claim `iss`, `aud`, `sub`, `iat`, `exp`, `cases`, the header `typ` `kipscope-cases`, `deflate-raw`, `target="kipscope"`, the codes `signature_required`, `invalid_signature`, `wrong_user`, `invalid_catalog`, `link_too_long`, and the words `longer side`, `UTF-16`, `as a whole`, `[from − pad, to + pad)`, `Cross-Origin-Opener-Policy`, `noopener` and `--trim`; it does not find `alternately`
- **Evidence:** `apps/server/test/docs.test.ts` › "documents the handoff"
