# Spec Delta

## Purpose

How a user moves through an open catalog: the case state of a workspace, stepping to any session with the dashboard kept at the same moment, moving signals to another vehicle, alignment to start, end, anchor or an event, and the session bar, keys and catalog list that drive it.

Test data: catalog C4 of design "Test fixtures", pad 60 s; times 2026-10-01 UTC. One timeseries window `w1` with `testcar/Fast_100h.SIG_A` and `testcar/Irr_200h.JITTER`.

## ADDED Requirements

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
While a catalog is open, the strip head SHALL show the session bar instead of the scope head (design K14): linked `SESSION ‹ <session text> › <k> / <n> ▾ Unlink Align ▾`, unlinked `VEHICLE ‹ › <vehicle text> Link`, on one line, the strip at most 56 px. Origin: Jan („mit einem pfeil rechts links bei session metainfo bei hover hüpfe ich zur nächsten … mit "unlink" wird session rechts links grau"); exploration UX sketch; D-056 (≤ 56 px).

#### Scenario: Bar text
- **WHEN** `sessionBarText` gets the case at entry 0 of C4 (title absent, `meta {distance_km: 6.2}`) in Europe/Berlin, and the same case unlinked with scope 2026-10-01 02:00 – 12:00 local
- **THEN** it gives `testcar · driving · 2026-10-01 03:00 – 03:10 (10 min) · distance_km 6.2` with position `1 / 4`, and `testcar · whole series · 2026-10-01 02:00 – 2026-10-01 12:00 (10 h)`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "describes the session"

#### Scenario: Bar on smart451
- **WHEN** a catalog from `kipscope case drives smart451` is open at 1440×900 and at 1000×557, the user hovers the bar, then clicks **Unlink**
- **THEN** `‹ ›` appear on hover with tooltips naming the neighbour; the bar fits one line and the strip is ≤ 56 px at both sizes; after Unlink the bar reads `VEHICLE` with greyed arrows and **Link**
- **Evidence:** UI check on smart451 (one screenshot per state and size, strip height)

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
`<k> / <n> ▾` SHALL open the catalog list: one row per session in catalog order with position, kind, title or object, local start, duration and up to 2 meta values, the current row marked, a focused filter field matching title, object, kind, id, local start or a meta value case-insensitively, at most 500 rows then `… <m> more: type to filter`; a click or Enter SHALL send `case.go`. Origin: exploration UX sketch („Catalog list"), accepted by D-086.

#### Scenario: Filter and go
- **WHEN** the list gets C4 at entry 0 and the filter `charg`, then Enter; and a catalog of 600 sessions without a filter
- **THEN** one row (entry 2) remains and Enter sends `case.go {index: 2}`; the 600-session list renders 500 rows and `… 100 more: type to filter`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "filters the catalog list"

### Requirement: Align from an event
While linked, a strip pin's context menu and an events-list row SHALL offer `Align sessions to this event`, which SHALL send `case.align` with that event's match and `at` its time; the Align menu SHALL offer `Session start`, `Session end` and `Anchor from the finder` (disabled when no session has an anchor) and show the event in event mode. Origin: Jan's tuned dashboard („every session has an event, the dashboard is tuned to it", exploration); D-086 Q4.

#### Scenario: Row action
- **WHEN** the events list renders a DTC row at 05:00:00 while a case is linked, and the same row without a case
- **THEN** the first has an `Align` action that sends `case.align {align: {mode: "event", event: {kind: "dtc", …}}, at: "1790830800000000000"}`; the second has none
- **Evidence:** `apps/web/test/eventsPanel.test.ts` › "offers Align on an event row"

#### Scenario: Align on smart451
- **WHEN** on smart451 the user right-clicks the first ignition pin of drive 1, chooses `Align sessions to this event`, zooms to ±30 s around it, and presses `]`
- **THEN** the Align menu reads the event, and drive 2 shows its first ignition change at the same place in the window (header times ±30 s around it), or the message `No <name> in this session; aligned to its start.`
- **Evidence:** UI check on smart451 (one screenshot before and after the step)

### Requirement: Step messages
After a case command, the message line SHALL say when a range was clamped at the session edge, when the alignment fell back to the session start, and which signals the new session lacks (texts in design K14). Origin: necessary consequence of clamps, fallbacks and rebinding that must not go unnoticed (time-navigation "Navigation stops at the scope edge"; Q-1, Q-3).

#### Scenario: Messages
- **WHEN** the result handler gets a `case.step` result with `clamped`, one with `alignFallback` in event mode for `B1234`, and one with `missing` of 5 signals
- **THEN** it shows `Stopped at the session edge. Unlink shows the whole vehicle.`, `No B1234 in this session; aligned to its start.` and `5 signals not in this session: <first 3 shown names>, …`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "messages after a step"

### Requirement: Zoom history per session
The zoom history ("Back") SHALL be kept per catalog index in the tab: a step SHALL push no entry, and stepping back to a session SHALL restore its history. Origin: exploration UX sketch („Back history is per session"), accepted by D-086.

#### Scenario: Back after stepping back
- **WHEN** at entry 0 the user zooms twice, steps to entry 2, zooms once, steps back to entry 0 and presses Back
- **THEN** the range is the one before entry 0's second zoom (shifted by nothing, same session)
- **Evidence:** `apps/web/test/zoom.test.ts` › "keeps the zoom history per session"
