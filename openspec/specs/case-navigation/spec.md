# case-navigation Specification

## Purpose
How a user moves through an open catalog: the case state of a workspace, stepping to any session with the dashboard kept at the same moment, moving signals to another vehicle, alignment to start, end, anchor or an event, and the session bar, keys and catalog list that drive it.

Test data: catalog C4 of design "Test fixtures", pad 60 s; times 2026-10-01 UTC. One timeseries window `w1` with `testcar/Fast_100h.SIG_A` and `testcar/Irr_200h.JITTER`.

## Requirements

### Requirement: Case state in the workspace
A workspace opened from a catalog SHALL hold `case` `{catalogId, count, current, linked, pad, align, alignAt, linkedRanges?, entry}` (design K2), saved and restored with the workspace, and every case command SHALL make one revision. A case command in a workspace without a catalog SHALL be rejected `no_case`. Origin: D-078 („shows one case at a time"); D-086 Q2.

#### Scenario: Case commands without a catalog
- **WHEN** `applyCommand` gets `case.step {by: 1}`, `case.go {index: 0}`, `case.unlink` and `case.align {align: {mode: "end"}}` on a workspace without `case`
- **THEN** each fails `no_case` and leaves the workspace unchanged
- **Evidence:** `packages/shared/test/apply.test.ts` › "refuses steps past the ends and while unlinked"

### Requirement: Stepping keeps the moment
`case.go {index}` and `case.step {by}` SHALL set the scope to the target session ± pad and move every timeseries window range and cursor by the difference of the alignment points, spans kept, clamped into the new scope (`clamped` when moved); windows, signals, heights, display, Diff, filter and events line SHALL stay. Origin: D-078 („gleiche Fenster und Signale, neuer Scope"); D-086 Q4; exploration UX sketch.

#### Scenario: Step by start and by anchor
- **WHEN** at entry 0 (align start) `w1` shows [01:02:00, 01:04:00) and cursor A is at 01:03:00, then `case.go {index: 2}` applies; and separately the same with align `anchor`
- **THEN** with start: scope `{testcar, 04:49:00, 05:11:00}`, `w1` [04:52:00, 04:54:00), A at 04:53:00, `alignAt` 04:50:00, `current` 2; with anchor: `w1` [04:57:00, 04:59:00), A at 04:58:00, `alignAt` `"1790830500000000000"`
- **Evidence:** `packages/shared/test/apply.test.ts` › "steps keeping offsets from the alignment point"

#### Scenario: Clamped at a short session
- **WHEN** at entry 0 `w1` shows [01:02:00, 01:04:00) and `case.go {index: 1}` applies (othercar, 1 s session, scope [23:59:00 of 2026-09-30, 00:01:01))
- **THEN** `w1` shows [23:59:01, 00:01:01) and the result has `clamped: true`
- **Evidence:** `packages/shared/test/apply.test.ts` › "steps keeping offsets from the alignment point"

#### Scenario: No page load
- **WHEN** on smart451 with a catalog from `kipscope case drives smart451` the user presses `]` three times
- **THEN** the network panel shows no document request, the session bar reads `4 / <n>`, and each window kept its offset from the drive start (header times)
- **Evidence:** UI check on smart451 (network panel and one screenshot)

### Requirement: Steps stay inside the catalog
`case.step` SHALL be rejected `case_end` past the first or last session (no wrap-around) and `case_unlinked` while unlinked; `case.go` with an index ≥ `count` SHALL be rejected `case_end`. Origin: necessary consequence of an ordered catalog (D-085) and of Unlink (D-086).

#### Scenario: Ends and unlinked
- **WHEN** at entry 3 `case.step {by: 1}` applies; at entry 0 `case.step {by: -1}`; `case.go {index: 4}`; and after `case.unlink` `case.step {by: 1}`
- **THEN** the first three fail `case_end`, the fourth `case_unlinked`, each with the revision unchanged
- **Evidence:** `packages/shared/test/apply.test.ts` › "refuses steps past the ends and while unlinked"

### Requirement: Signals move to the next vehicle
When the target session's data ref differs, every window signal, colour key and events-line signal of the old data ref SHALL move to the new one by name, assignment IDs and colours kept; names the new vehicle's list lacks SHALL stay and be listed in the result's `missing`. Origin: concept §9 („Templates neu binden … fehlende … Signalzuordnungen melden"); D-085 („beliebige VINs"); Q-3 (a).

#### Scenario: testcar to othercar and back
- **WHEN** at entry 0 `w1` holds `testcar/Fast_100h.SIG_A` (colour 0) and `testcar/Irr_200h.JITTER` (colour 1), `case.go {index: 1}` applies, then `case.go {index: 0}`
- **THEN** after the first `w1` holds `othercar/Fast_100h.SIG_A` (colour 0) and `othercar/Irr_200h.JITTER` (colour 1) with the same assignment IDs and the result's `missing` is `["othercar/Irr_200h.JITTER"]`; after the second both are on `testcar` again and `missing` is absent
- **Evidence:** `packages/shared/test/apply.test.ts` › "moves signals to another vehicle"; `apps/server/test/case.http.test.ts` › "steps through the catalog over HTTP"

#### Scenario: Missing signal in the window
- **WHEN** after the step to entry 1 the window loads `othercar/Irr_200h.JITTER` and gets 404 `unknown_signal`
- **THEN** the window's error line reads `not in this session` for it, and the message line reads `1 signal not in this session: JITTER`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "messages after a step"

### Requirement: Step loads the target's list first
`case.go` and `case.step` SHALL load the target session's signal list before they apply and SHALL check `missing` against it; a failed load SHALL answer 503 `catalog_unavailable` with the workspace unchanged. Origin: scope "A scope's signal list loads first" (the same rule for every scope change); D-082.

#### Scenario: Step over HTTP
- **WHEN** a recording source answers, C4 is opened at entry 0, and `case.step {by: 1}` is posted; then a stub source fails `listSignals` for entry 2's scope and `case.step {by: 1}` is posted
- **THEN** the first answers 200 after one `listSignals` with scope `{othercar, 23:59:00, 00:01:01}`, with a new revision; the second answers 503 `catalog_unavailable` and `case.current` stays 1
- **Evidence:** `apps/server/test/case.http.test.ts` › "steps through the catalog over HTTP"

### Requirement: Alignment modes
`case.align` SHALL set the mode `start`, `end`, `anchor` or `event` and the current session's alignment point without moving windows; on a step the point SHALL be the target's start, end, anchor (else start) or first matching event in its padded scope (else start), with `alignFallback: true` when the start replaced the mode. Origin: D-086 Q4 („Align to this event … every session shows the same event"); Q-1 (a).

#### Scenario: Points of a session
- **WHEN** `alignPoint` gets entry 2 with `start`, `end`, `anchor`, and entry 0 with `anchor`
- **THEN** it gives 04:50:00, 05:10:00 and 04:55:00 without fallback, and 01:00:00 with `fallback: true`
- **Evidence:** `packages/shared/test/case.test.ts` › "computes the alignment point"

#### Scenario: Event matching
- **WHEN** `eventMatchOf` gets a DTC event and a state change to `KEYON`, and `matchesEvent` compares the change's match with a change to `KEYON` and with one to `NONE` of the same signal
- **THEN** the DTC match has no `text`, the change match has `text` `KEYON`; the first comparison is true, the second false
- **Evidence:** `packages/shared/test/case.test.ts` › "matches events"

#### Scenario: Align to a DTC and step
- **WHEN** at entry 2 `case.align` is posted with the match of the first DTC at 05:00:00 and `at` 05:00:00, `w1` showing [04:59:00, 05:01:00); then `case.go {index: 3}`; then `case.go {index: 0}`
- **THEN** after the second `w1` shows [04:59:00, 05:01:00) and the result has no `alignFallback`; after the third (no DTC in entry 0) `w1` shows [00:59:00, 01:01:00), `alignAt` is 01:00:00 (`"1790816400000000000"`), and the result has `alignFallback: true`
- **Evidence:** `apps/server/test/case.http.test.ts` › "aligns to an event and falls back to the start"

#### Scenario: Align without a match
- **WHEN** at entry 0 `case.align {align: {mode: "event", event: <DTC match>}}` is posted without `at`
- **THEN** it answers 422 `no_matching_event` and the revision is unchanged
- **Evidence:** `apps/server/test/case.http.test.ts` › "aligns to an event and falls back to the start"

### Requirement: Session bar
While a catalog is open, the context row (its own row between the top row and the time strip, design DW3) SHALL show the session bar as fixed slots on one line, left to right: the label `SESSION` (linked) or `VEHICLE` (unlinked); `‹`, the position button `<k> / <n>` with an align glyph and `▾`, and `›` side by side; the title slot (the remaining width); the duration slot; the action slot holding `Unlink` while linked and `Link` while unlinked. The bar SHALL show no start (the range button shows the shown range's start): the session's start is in the title's tooltip and in the catalog list. Linked, the title is the entry's title, else its object, with the tooltip `<title or object> · <full start> · <duration> · <kind>` (range-picker "Start and duration": `Thu 2026-10-01 03:00`, `0:10 h`) followed, one per line, by every meta entry `<key>: <value>`, `id: <id>` and `from <tool>`. Unlinked, the title is `<object> · whole series` (the vehicle, never the dropped session's title) with the tooltip `<object> · whole series · <full start> · <duration>` of the scope, and the duration that of the scope. The duration slot reads the duration with the duration tag (its words as tooltip). The position button SHALL show the alignment: a glyph (a bar at the left for `start`, at the right for `end`, in the middle for anchor and event modes, design DW5), the tooltip `Sessions of the catalog, aligned at <words>` and the `aria-label` `Session <k> of <n>, aligned at <words>: sessions and align` (`the session start`, `the session end`, `the anchor`, `<event label>`). Each slot's box SHALL depend only on the row's width, never on its text: the title truncates with `…` and keeps its full text in the tooltip; the label slot 64 px, the arrows 26 px, the position button 88 × 24 px (fits `123 / 456`), the duration slot 64 px (fits `9 d 11 h`), the action slot 64 × 24 px. When the row is narrower than the measured threshold at which the title slot would drop below 160 px, the label SHALL be left out (compact row). The row is one line at most 32 px tall; the strip is 28 px (time-strip "Time strip"). Origin: D-092 („the session thing: the ui placements move on text size … stable and clean it shall be"; answer (5) Align into the list); designer's measurement (text width 372 → 728 → 646 → 407 px, `k / n` moved up to 355 px over one `]`); mock `SessionBar.dc.html` states 1, 4, 6, 7, 8; supersedes the bar layout of D-089 (K14); start and duration: D-093 (supersedes D-092 (4) for the bar); title and duration only, the glyph, 88/64/24 px: D-095 (critic 10, 12, 15: start shown twice; Align invisible while the list is closed); Jan's original bar: „mit einem pfeil rechts links bei session metainfo … mit "unlink" wird session rechts links grau".

#### Scenario: Bar text
- **WHEN** `sessionSlots` gets the case at entry 0 of C4 (title absent, kind `driving`, `meta {distance_km: 6.2}`, align `start`) in Europe/Berlin; the same case unlinked with scope 2026-10-01 02:00 – 12:00 local; that unlinked case with entry 0 titled `Drive 1`; and the C4 case at entry 3 in `end` mode
- **THEN** the first gives label `SESSION`, position `1 / 4`, align `start` with the position tooltip `Sessions of the catalog, aligned at the session start`, title `testcar`, a title tooltip whose first line is `testcar · Thu 2026-10-01 03:00 · 0:10 h · driving` and which holds `distance_km: 6.2` and `id: ` lines, duration `0:10 h` with the tooltip `Duration 10 min`, action `Unlink`, and no start field; both unlinked cases give label `VEHICLE`, title `testcar · whole series` (not `Drive 1`) with the tooltip `testcar · whole series · Thu 2026-10-01 02:00 · 10:00 h`, duration `10:00 h`, action `Link`; the fourth gives position `4 / 4` and the position `aria-label` `Session 4 of 4, aligned at the session end: sessions and align`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "fills the session slots"

#### Scenario: Across midnight and days
- **WHEN** `sessionSlots` gets in Europe/Berlin an entry from 2026-10-20 23:31:05 to 2026-10-21 01:52:43 local, one from 2026-10-11 10:00:00 to 2026-10-21 09:00:00 local, and one of 41 s from 2026-10-13 15:06:03 local
- **THEN** duration `2:21 h` with the title tooltip line 1 holding `Tue 2026-10-20 23:31`; duration `9 d 23 h` (`Duration 9 d 23 h`) with `Sun 2026-10-11 10:00`; duration `41 s` with `Tue 2026-10-13 15:06:03`; no slot holds a weekday, an end time or `⁺¹`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "gives start and duration across midnight and days"

#### Scenario: Bar on smart451
- **WHEN** a catalog from `kipscope case drives smart451` is open at 1440×900 and at 1000×557 (sidebar open), the user hovers the title and the position button, then clicks **Unlink**
- **THEN** at 1440×900 the row reads `SESSION ‹ <k> / <n> › <title> <stopwatch> <H:MM> h Unlink` with no start, the position button 88 × 24 px with the align glyph, the duration slot 64 px and the action slot 64 × 24 px (±1 px); at 1000×557 the same without `SESSION`; the title's tooltip names the full start and the kind, the duration's its words, the position button's `aligned at the session start`; the row is one line ≤ 32 px and the strip 28 px at both sizes; after Unlink the row reads `VEHICLE ‹ <k> / <n> › smart451 · whole series … Link` with greyed arrows, `Link` in the box `Unlink` had (±1 px), and no `Drive` title
- **Evidence:** UI check on smart451 (one screenshot per state and size, row and strip heights, the slot boxes before and after, the three `title` values)

### Requirement: Arrows and keys
`‹` and `›`, and the keys `[` and `]` outside text fields and selects without Ctrl, Meta or Alt, SHALL send `case.step {by: -1}` and `{by: 1}` while linked; at the first or last session and while unlinked they SHALL send nothing, and the arrows SHALL be disabled. Origin: Jan („pfeil rechts links … hüpfe ich zur nächsten"); `←` `→` already pan (time-navigation), so the exploration chose `[` `]`.

#### Scenario: Keys
- **WHEN** the key handler gets `]` at entry 0, `[` at entry 0, `]` in the "Go to" field, `Ctrl+]`, and `]` while unlinked
- **THEN** only the first sends a command, `case.step {by: 1}`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "steps with brackets"

#### Scenario: Greyed while unlinked
- **WHEN** the session bar renders an unlinked case
- **THEN** both arrows are disabled with the tooltip `Link first`, and a click sends nothing
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "greys the arrows while unlinked"

### Requirement: Catalog list
The position button SHALL open the catalog list: one row per session in catalog order in four fixed columns (28 px, the rest, 116 px, 64 px): the position; the title or object, kind and up to 2 meta values (truncating, full text as tooltip); the start (`26-10-13 15:06`, its full start as tooltip); the duration with the duration tag (range-picker "Start and duration"); the current row marked, a focused filter field matching title, object, kind, id, local start or a meta value case-insensitively, at most 500 rows then `… <m> more: type to filter`; a click or Enter SHALL send `case.go`. Its back link SHALL read `Back to search`. At its foot the list SHALL hold an `ALIGN` radio group with the alignment items (`Session start`, `Session end`, `Anchor from the finder` disabled when no session has an anchor, and the event while in event mode), the current mode checked in the pressed style (design-language "Cursor toggles as pills"); choosing an unchecked item SHALL send `case.align` with it and close the list. The session bar SHALL have no separate Align control. Origin: exploration UX sketch („Catalog list"), accepted by D-086; Align in the list: D-092 (5); columns, start and duration: D-093, mock `SessionBar.dc.html` (grid `28px 1fr 116px 64px`); `Back to search`, 64 px, full start: D-095 (critic 12, 15).

#### Scenario: Filter and go
- **WHEN** the list gets C4 at entry 0 and the filter `charg`, then Enter; and a catalog of 600 sessions without a filter
- **THEN** one row (entry 2) remains and Enter sends `case.go {index: 2}`; the 600-session list renders 500 rows and `… 100 more: type to filter`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "filters the catalog list"

#### Scenario: Row columns
- **WHEN** `catalogRows` gets C4 at entry 0 without a filter, and the list renders C4 with an `origin.url`
- **THEN** the first row has position `1`, a name starting `testcar · driving` that holds `6.2`, start `26-10-01 03:00` with the tooltip `Thu 2026-10-01 03:00`, duration `0:10 h` with the tooltip `Duration 10 min`; the filter `26-10-01 03:00` keeps entry 0 (a typed start in the shown form matches); the rendered list holds one `.duration-tag` per row and a back link reading `Back to search`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "fills the catalog row columns"

#### Scenario: Align in the list
- **WHEN** the session bar is rendered open for linked C4 in start mode, and again in event mode for `dtc ECU1 B1234`
- **THEN** both markups hold one `radiogroup` labelled `Align` inside the list with `Session start` checked in the first and the event item checked in the second, `Anchor from the finder` disabled exactly when no C4 entry has an anchor, and the bar outside the list holds no button whose text starts `Align`; the position button's `aria-label` ends `aligned at the session start: sessions and align` in the first and names the event in the second
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "puts the align modes into the catalog list"

### Requirement: Align from an event
While linked, a strip pin's context menu and an events-list row SHALL offer `Align sessions to this event`, which SHALL send `case.align` with that event's match and `at` its time; the catalog list's `ALIGN` group ("Catalog list") SHALL offer `Session start`, `Session end` and `Anchor from the finder` (disabled when no session has an anchor) and show the event in event mode. Origin: Jan's tuned dashboard („every session has an event, the dashboard is tuned to it", exploration); D-086 Q4; place of the group: D-092 (5).

#### Scenario: Row action
- **WHEN** the events list renders a DTC row at 05:00:00 while a case is linked, and the same row without a case
- **THEN** the first has an `Align` action that sends `case.align {align: {mode: "event", event: {kind: "dtc", …}}, at: "1790830800000000000"}`; the second has none
- **Evidence:** `apps/web/test/eventsPanel.test.ts` › "offers Align on an event row"

#### Scenario: Align on smart451
- **WHEN** on smart451 the user right-clicks the first ignition pin of drive 1, chooses `Align sessions to this event`, zooms to ±30 s around it, and presses `]`
- **THEN** the catalog list's `ALIGN` group shows the event checked, and drive 2 shows its first ignition change at the same place in the window (the shown range is ±30 s around it), or the message `No <name> in this session; aligned to its start.`
- **Evidence:** UI check on smart451 (one screenshot before and after the step, one of the open list)

### Requirement: Step messages
After a case command, the message line SHALL say when a range was clamped at the session edge, when the alignment fell back to the session start, and which signals the new session lacks (texts in design K14). Origin: necessary consequence of clamps, fallbacks and rebinding that must not go unnoticed (time-navigation "Navigation stops at the scope edge"; Q-1, Q-3).

#### Scenario: Messages
- **WHEN** the result handler gets a `case.step` result with `clamped`, one with `alignFallback` in event mode for `B1234`, and one with `missing` of 5 signals
- **THEN** it shows `Stopped at the session edge. Unlink shows the whole vehicle.`, `No B1234 in this session; aligned to its start.` and `5 signals not in this session: <first 3 shown names>, …`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "messages after a step"

### Requirement: Case notices clear on the next command
A case result notice ("Step messages", alone or combined) SHALL be dismissed by the tab's next accepted command, case or other, that sets no message of its own; a refusal or a new message SHALL replace it; an open notice SHALL stay. Origin: necessary consequence of matching the scope-edge message (time-navigation "Message on a clamped result"); round 1 UI finding („a clamp message outlives later commands").

#### Scenario: Notice cleared by the next command
- **WHEN** the message slot holds, in turn, each case notice (clamped linked, clamped unlinked, no anchor, no event, 1 signal missing, 5 signals missing, clamped and missing), and then gets the result events of an accepted `case.go` without flags and of an accepted window command without flags; and a held clamp notice gets a `case.step` result with `missing` of 1 signal
- **THEN** every notice is gone after either next command; the clamp notice is replaced by `1 signal not in this session: S1`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "clears a case message on the next command"

### Requirement: Zoom history per session
The zoom history ("Back") SHALL be kept per catalog index in the tab: a step SHALL push no entry, and stepping back to a session SHALL restore its history. Origin: exploration UX sketch („Back history is per session"), accepted by D-086.

#### Scenario: Back after stepping back
- **WHEN** at entry 0 the user zooms twice, steps to entry 2, zooms once, steps back to entry 0 and presses Back
- **THEN** the range is the one before entry 0's second zoom (shifted by nothing, same session)
- **Evidence:** `apps/web/test/zoom.test.ts` › "keeps the zoom history per session"

### Requirement: Stepping shows the target at once
On a step (`‹`, `›`, `[`, `]`) or a pick in the catalog list, the session bar SHALL at once show the target's slots from the loaded catalog, a 2 px accent progress line on the row's bottom edge taking no space, and the strip's loading state until the new density is in (design DW4). The line SHALL end when the command's revision is rendered, or when it is refused, which restores the current slots. Origin: D-092; designer's measurement (title ~1 s before the range); mock state 2; D-094.

#### Scenario: Pending step slots
- **WHEN** `sessionSlots` gets linked C4 at entry 0 with a pending target 2 and the loaded catalog; the same with the catalog not loaded; and `pendingTarget` gets linked C4 at current 0 with no pending and `case.step {by: 1}`, with pending 1 and `case.step {by: 1}`, at current 3 (the last) with `case.step {by: 1}`, with `case.go {index: 2}`, and unlinked with `case.step {by: 1}`
- **THEN** the first gives position `3 / 4` and entry 2's title, title tooltip and duration with `pending` true; the second gives position `3 / 4` and skeletons in the title and duration slots; `pendingTarget` gives 1, 2, undefined, 2 and undefined
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "shows the step target at once"

#### Scenario: Step on smart451
- **WHEN** a catalog from `kipscope case drives smart451` is open at 1440×900 at entry 1, the user presses `]` and takes a screenshot within 200 ms, then waits until the windows have drawn
- **THEN** the first screenshot shows the next drive's title and duration with the progress line visible and the strip reading `Loading recording…` (28 px); afterwards the progress line is gone, the strip shows the new session's presence line with the accent window, and the windows show the new session
- **Evidence:** UI check on smart451 (two screenshots)

### Requirement: Session bar never moves
No slot of the context row SHALL move or resize by more than 1 px while the user steps, opens the list, unlinks or links, or the open note comes or goes. A slot whose text is not known yet (no workspace yet after `/open#cases=`, a pending target not in the loaded catalog) SHALL show a grey skeleton in its own box; after `/open#cases=` the row SHALL be there with skeletons from the first paint. Origin: D-092 ("Layout never moves"); mock `SessionBar.dc.html` states 2, 3.

#### Scenario: Skeleton before the workspace
- **WHEN** the session bar is rendered to static markup for an opening page without a workspace yet, and for linked C4
- **THEN** both markups hold the same slot elements in the same order (`slot-label`, the two arrows, `session-position`, `slot-title`, `slot-duration`, `slot-action`) and no `slot-times`; in the first the title and duration slots each hold one `skeleton` element and no text
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "renders skeletons in the same slots"

#### Scenario: Probe over steps
- **WHEN** at 1440×900 and at 1000×557 (sidebar open) a catalog from `kipscope case drives smart451` is open with one entry's title changed to a 90-character text, the UI user starts the layout probe of design DW1, presses `]` three times (passing the long title), `[` once, opens and closes the list, clicks Unlink and then Link, waiting for the progress line to end after each, then stops the probe
- **THEN** the probe reports at most 1 px for `‹`, the position button, `›`, the title, duration and action slots, the context row and the strip at both sizes
- **Evidence:** UI check on smart451 (probe output per size, one screenshot at the long title showing the `…` and its tooltip)

### Requirement: Unlink and Link show progress
From the click on `Unlink` (`case.unlink`) or `Link` (`case.go {index: current}`) until the result's revision is rendered, or the command is refused or fails, the context row SHALL have `aria-busy="true"` and show the progress line of DW4, and the action button SHALL read `Unlinking…` or `Linking…`, disabled, in the action slot's 64 × 24 px box with its text not clipped. The other slots keep their text. Origin: D-112 (2); box: D-095; line: DW4, D-094.

#### Scenario: Pending action helper
- **WHEN** the pure helper `pendingAction(c, input)` gets linked C4 with `case.unlink`; unlinked C4 with `case.go {index: 1}`; linked C4 with `case.go {index: 2}`; linked C4 with `case.step {by: 1}`; unlinked C4 with `case.unlink`; and linked C4 with `case.align {align: {mode: "end"}}`
- **THEN** it gives `"Unlinking…"`, `"Linking…"`, `undefined`, `undefined`, `undefined` and `undefined`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "names the pending Unlink and Link"

#### Scenario: Pending action markup
- **WHEN** the session bar is rendered to static markup for linked C4 with `progress` true and `actionPending` `"Unlinking…"`, for unlinked C4 with `progress` true and `actionPending` `"Linking…"`, and for linked C4 without either
- **THEN** the first holds a `slot-action` button with the text `Unlinking…` and `disabled`, the second one with `Linking…` and `disabled`, both a `context-row` with `aria-busy="true"` and one `session-progress`; the third holds `Unlink`, not disabled, no `aria-busy` and no `session-progress`; all three hold the same slot elements in the same order
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "shows Unlinking… and Linking… while pending"

#### Scenario: Unlink and Link on smart451
- **WHEN** a catalog from `kipscope case drives smart451` is open at 1440×900, linked, and the UI user installs a `MutationObserver` on the context row (subtree, attributes, characterData, childList) that records, on every mutation, the action button's text, its `disabled`, its `getBoundingClientRect()` width and height, the row's `aria-busy` and whether `.session-progress` exists; then clicks `Unlink` with a real pointer click, waits until the row reads `VEHICLE`, clicks `Link` with a real pointer click and waits until it reads `SESSION`
- **THEN** the record holds, after the Unlink click and before the first `Link` text, at least one entry `Unlinking…`, disabled, `aria-busy` `true`, progress line present; after the Link click and before the next `Unlink` text at least one entry `Linking…` with the same; the last entry reads `Unlink`, enabled, no `aria-busy`, no progress line; every entry measures 64 × 24 px (±1 px); `kipscope state` shows `case.linked` false after the first wait and true after the second
- **Evidence:** UI check on smart451 (the observer's record printed from the page, filtered to distinct entries; `kipscope state` after each wait; one screenshot after each wait). The reload on carserver is fast, so the record, not a screenshot, is the evidence of the pending state; no test hook or throttling is used.

### Requirement: Pending Unlink and Link end on their own outcome
A refusal or failure of Unlink or Link SHALL restore `Unlink` or `Link`, enabled, without the progress line and `aria-busy`; the refusal goes to the message line as today. The pending state SHALL end only by its own command's outcome or by a newer case command that starts a pending state of its own; a newer case command that starts none (a `]` while unlinked) SHALL NOT end or orphan it. Origin: necessary consequence of D-112 (2) and of DW4's end rule (D-094).

#### Scenario: Which commands start a pending state
- **WHEN** the pure helper `startsPending(c, pending, input)` gets unlinked C4 with `case.step {by: 1}`; unlinked C4 with `case.go {index: 1}`; linked C4 at current 0 with `case.unlink`; linked C4 at current 0 with `case.step {by: 1}`; linked C4 at current 3 (the last) with `case.step {by: 1}`; and linked C4 with `case.align {align: {mode: "end"}}`
- **THEN** it gives `false`, `true`, `true`, `true`, `false` and `false` (true exactly when `pendingTarget` or `pendingAction` gives a value)
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "starts a pending state only for a target or an action"; reviewer reads `App.tsx` `caseCommand`: the sequence that guards `settle` is bumped only when `startsPending` is true

### Requirement: Patience hint on a slow Unlink
While an Unlink is still on its way 1000 ms after the click, the session bar's title slot SHALL show `HINTS.unlinkSlow` (`Unlinking: reading the whole vehicle's time range; this can take a few seconds`) in a `role="status"` element that exists, empty, from the click on. Link, steps and other commands SHALL NOT show it. Origin: D-113; place: the open note's slot (X4a, DW7); 1000 ms: design "Delay".

#### Scenario: Patience hint helpers
- **WHEN** the pure helper `patienceHintFor(action)` gets `"Unlinking…"`, `"Linking…"` and `undefined`; and, with fake timers, `startPatienceTimer(show)` is started and the clock advanced by 999 ms, then by 1 ms more, then by 5000 ms more; a second timer is started and cancelled after 500 ms, then the clock advanced by 5000 ms; a third is cancelled after it fired
- **THEN** `patienceHintFor` gives `true`, `false`, `false`; the first `show` has not been called after 999 ms and has been called exactly once after 1000 ms and still once after 6000 ms; the second `show` is never called; cancelling the third after it fired throws nothing and calls nothing; `UNLINK_HINT_DELAY_MS` is `1000`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "starts the Unlink hint after the delay, only for Unlink"

#### Scenario: Patience hint markup
- **WHEN** the session bar is rendered to static markup for linked C4 with `progress` true, `actionPending` `"Unlinking…"` and `unlinkHint` true; the same with `unlinkHint` false; unlinked C4 with `progress` true, `actionPending` `"Linking…"` and `unlinkHint` true; and linked C4 without any of them
- **THEN** the first holds inside `slot-title`, after `slot-title-text`, one `session-unlink-hint` element with `role="status"`, the text and the `title` `HINTS.unlinkSlow`; the second holds that element with `role="status"` and no text; the third and the fourth hold no `session-unlink-hint`; all four hold the same slot elements in the same order
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "shows the Unlink hint in the title slot"

#### Scenario: Hint wording
- **WHEN** the hints table is read
- **THEN** `HINTS.unlinkSlow` equals `Unlinking: reading the whole vehicle's time range; this can take a few seconds` and passes the wording rule (W1: starts with a capital, at most 140 characters, no closing period)
- **Evidence:** `apps/web/test/hints.test.ts` › "words the Unlink patience hint (D-113)" and › "keeps every hint within the wording rule"

### Requirement: Patience hint ends with Unlinking… and moves nothing
The hint SHALL go in the render in which `Unlinking…` goes (revision rendered, refused, failed, or replaced by a newer pending state), so an Unlink done within 1000 ms never shows it. It sits after the title text, truncates with `…` (full text as tooltip), and no slot of the context row changes its box. Origin: D-113; fixed boxes: D-095.

#### Scenario: Slow Unlink on smart451
- **WHEN** a catalog from `kipscope case drives smart451` is open at 1440×900, linked, no Unlink of smart451 ran on this server in the last 5 minutes (the extent cache's lifetime), and the UI user installs on the page a capture `pointerdown` listener on the action button that stores `t0 = performance.now()`, and a `MutationObserver` on the context row (subtree, attributes, characterData, childList) that records on every mutation: `t = performance.now() - t0`, the action button's text, the `session-unlink-hint` element's presence, `role` and text, the row's height, and the `getBoundingClientRect()` x and width of `slot-title`, `slot-duration` and the action button; then clicks `Unlink` with a real pointer click, waits until the row reads `VEHICLE`, clicks `Link` with a real pointer click and waits until it reads `SESSION`
- **THEN** in the Unlink run: every entry with `t` < 950 ms has no hint text; the first entry with hint text has 950 ≤ `t` ≤ 1500 ms, `role="status"` and the text of `HINTS.unlinkSlow`, and the button reads `Unlinking…` in it and in every later entry with hint text; the first entry whose button reads `Link` has no `session-unlink-hint`; the whole Unlink takes more than 3 s (else the run did not test a slow Unlink and is repeated after the cache expired). In the Link run no entry has a `session-unlink-hint`. In every entry the row is 32 px high and the three boxes keep their x and width (±1 px). `kipscope state` shows `case.linked` false after the first wait and true after the second
- **Evidence:** UI check on smart451 (the observer's record printed from the page, filtered to distinct entries, with the Unlink's total time; `kipscope state` after each wait; one screenshot about 5 s after the Unlink click showing the hint beside the title and `Unlinking…`). No test hook or throttling.

#### Scenario: Warm Unlink on smart451
- **WHEN** right after "Slow Unlink on smart451" (within the extent cache's 5 minutes), with the same observer, the UI user clicks `Unlink` again with a real pointer click and waits until the row reads `VEHICLE`
- **THEN** the record and the Unlink's total time are reported; if the Unlink took less than 950 ms, no entry has hint text; if it took longer, the hint follows the rules of the slow run and the fast case rests on "Patience hint helpers"
- **Evidence:** UI check on smart451 (the record and the total time, printed from the page)
