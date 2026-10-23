## MODIFIED Requirements

### Requirement: Open warnings shown
After an open by link and by a dropped file, the open report SHALL be shown as one text, the open's case texts first (alignment fallback, missing signals), then the report's `warnings`, joined by ` · `, in the session bar's note ("Open report in the session bar") and not in the bottom bar's message line. A CLI open (`kipscope case open`) SHALL report it in its JSON line only (`data.case.missing`, `data.case.warnings`), not in a browser. Origin: finder finding (the ADX feedback, comment 2026-10-21: the file drop discards the answer, the link path overwrites one notice with the other); "Back link only to the finder"; place: D-092 (6) („the open-report note shows only in the session bar", supersedes D-091's bottom-bar notice for it; „A CLI open reports its warnings in the CLI's output, not in the browser").

#### Scenario: One notice for case texts and warnings
- **WHEN** the open note is built for a report with `missing` `["othercar/Irr_200h.JITTER"]` and `warnings` `["origin.url https://evil.example/ dropped: its origin is not in KIPSCOPE_FINDER_ORIGINS"]`, for one with only that warning, and for one with neither; and the App's open handling gets the first report
- **THEN** the first is `1 signal not in this session: JITTER · origin.url https://evil.example/ dropped: its origin is not in KIPSCOPE_FINDER_ORIGINS`; the second the warning alone; the third no note; the open handling sets the note and puts no case notice into the message line (`caseOpenEvents` is no longer used for it)
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "shows open warnings with the case notice"

#### Scenario: Report carried across the page load
- **WHEN** `openDroppedCatalog` opens a file and the fake open answers workspace `w1` with a report holding one warning, then the report is taken for `w1` twice, and a report stored for `w1` is taken for `w2`
- **THEN** the first take gives the report, the second nothing; the take for `w2` gives nothing and leaves no entry behind; a storage that throws on write or read changes nothing else (the page still goes to `/w/w1`)
- **Evidence:** `apps/web/test/filedrop.test.ts` › "carries the open report across the page load"; `apps/web/test/workspaces.test.ts` › "shows a dropped catalog's report after the page load"

#### Scenario: Dropped file on smart451
- **WHEN** a catalog from `kipscope case drives smart451` with `origin.url` `https://evil.example/` added is saved as a file and dropped on the window of the dev server (no `KIPSCOPE_FINDER_ORIGINS`)
- **THEN** after the page load the session bar's note reads `origin.url https://evil.example/ dropped: its origin is not in KIPSCOPE_FINDER_ORIGINS` (cut to its box, full text in the tooltip) and the bottom bar shows no such message
- **Evidence:** UI check on smart451 (one screenshot of the session bar with the tooltip and of the bottom bar)

#### Scenario: CLI open reports in its output
- **WHEN** against the test server (identity `none`) `case open` runs with C4 whose `origin.url` is `https://evil.example/`, and a browser then opens the new workspace's `/w/<id>`
- **THEN** the CLI's JSON line holds `data.case.warnings` with the `origin.url https://evil.example/ dropped: …` text and `data.case.missing` as an array; the session bar in the browser shows no note
- **Evidence:** `apps/cli/test/cli.test.ts` › "prints the open report"; UI check (one screenshot of the session bar after `/w/<id>`)

### Requirement: Open report in the session bar
The open's note (texts of "Open warnings shown") SHALL show inside the session bar's title slot, after the title, as a warning-ink pill (`⚠ <text> ✕`) at most 470 px wide and leaving the title at least 8 characters; its text truncates with `…` and has the full text in its tooltip, and its ✕ (a 22 × 22 px button labelled `Dismiss`) dismisses it. The title gives way to the note, never the other slots. The note SHALL stay until the ✕ or the first accepted `case.go`, `case.step` or `case.unlink` (design X4a of `fix-handoff-findings`). Origin: Jan's hand check of `fix-handoff-findings` (2026-10-21: the warning only showed cut off in the bottom bar and went unnoticed); D-091 (lifetime); place in the title slot: D-092 (6), mock `SessionBar.dc.html` state 5; ✕ 22 px: D-095 (critic 15); 470 px: the mock's cap (×2 leaves a 1000 px row no title, ×½ cuts the note to about 30 characters, still readable with its tooltip).

#### Scenario: Note in the bar
- **WHEN** the session bar renders linked C4 with the note `1 signal not in this session: JITTER · origin.url https://evil.example/ dropped: its origin is not in KIPSCOPE_FINDER_ORIGINS`, and again without a note; and `endsOpenNote` gets accepted results of `case.step`, `case.go`, `case.unlink`, `case.align` and a window command, and a refused `case.step`
- **THEN** the first markup holds one `session-open-note` element inside the `slot-title` element, after the title, with that text and that `title`, and a button labelled `Dismiss`; the second holds none; `endsOpenNote` is true for the first three only
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "shows the open report in the session bar"

#### Scenario: Note on smart451
- **WHEN** at 1440×900 a catalog from `kipscope case drives smart451` with `origin.url` `https://evil.example/` is opened once as a dropped file and once by its link (`kipscope case url -`), with the layout probe (design DW1) running; the user hovers the note, moves a window, then presses `]`
- **THEN** both times the note sits in the title slot after the title, its tooltip shows the whole warning, the bottom bar shows no open message, the note's ✕ measures 22 × 22 px (±0.5); the note survives the window move and is gone after `]`; the probe reports at most 1 px for the duration and action slots while the note comes and goes
- **Evidence:** UI check on smart451 (one screenshot per open path with the tooltip, one after `]`, probe output)
