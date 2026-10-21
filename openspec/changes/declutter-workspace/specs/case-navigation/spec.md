## MODIFIED Requirements

### Requirement: Session bar
While a catalog is open, the context row (its own row between the top row and the time strip, design DW3) SHALL show the session bar as fixed slots on one line, left to right: the label `SESSION` (linked) or `VEHICLE` (unlinked); `‹`, `<k> / <n> ▾` and `›` side by side; the title slot (the remaining width); the times slot; the duration slot; the action slot holding `Unlink` while linked and `Link` while unlinked. Linked, the title is the entry's title, else its object, with the tooltip `<title or object> · <kind>` followed, one per line, by every meta entry `<key>: <value>`, `id: <id>` and `from <tool>` (kind and meta no longer in the bar text; the catalog list keeps them). Unlinked, the title is `<object> · whole series` (the vehicle, never the dropped session's title), times and duration those of the scope. The times slot reads `<weekday> <YYYY-MM-DD>  <HH:MM:SS> – <HH:MM:SS>` in local time, English weekday abbreviations ("Session times across midnight" for other days); the duration is the span as the strip formats spans (`10.8 min`). Each slot's box SHALL depend only on the row's width, never on its text: the title truncates with `…` and keeps its full text in the tooltip; the times slot is as wide as the longest text of its format (goal: 268 px at 12 px, the mock's measure), the duration and action slots 64 px each, the label slot 64 px; `<k> / <n> ▾` is as wide as `<n> / <n> ▾` of the open catalog in tabular numbers. When the row is narrower than the measured threshold at which the title slot would drop below 160 px, the label SHALL be left out (compact row). The row is one line at most 32 px tall; the strip stays at most 56 px. Origin: D-092 („the session thing: the ui placements move on text size … stable and clean it shall be"; answer (5) Align into the list); designer's measurement (text width 372 → 728 → 646 → 407 px, `k / n` moved up to 355 px over one `]`); mock `SessionBar.dc.html` states 1, 4, 6, 8; supersedes the bar layout of D-089 (K14); Jan's original bar: „mit einem pfeil rechts links bei session metainfo … mit "unlink" wird session rechts links grau".

#### Scenario: Bar text
- **WHEN** `sessionSlots` gets the case at entry 0 of C4 (title absent, kind `driving`, `meta {distance_km: 6.2}`) in Europe/Berlin; the same case unlinked with scope 2026-10-01 02:00 – 12:00 local; that unlinked case with entry 0 titled `Drive 1`; and the C4 case at entry 3
- **THEN** the first gives label `SESSION`, position `1 / 4`, title `testcar`, a title tooltip whose first line is `testcar · driving` and which holds `distance_km: 6.2` and `id: ` lines, weekday `Thu`, times `2026-10-01  03:00:00 – 03:10:00`, duration `10 min`, action `Unlink`; both unlinked cases give label `VEHICLE`, title `testcar · whole series` (not `Drive 1`), times `2026-10-01  02:00:00 – 12:00:00`, duration `10 h`, action `Link`; `positionCh` is the same for entries 0 and 3
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "fills the session slots"

#### Scenario: Bar on smart451
- **WHEN** a catalog from `kipscope case drives smart451` is open at 1440×900 and at 1000×557 (sidebar open), the user hovers the title, then clicks **Unlink**
- **THEN** at 1440×900 the row reads `SESSION ‹ <k> / <n> ▾ › <title> <weekday> <date> <times> <duration> Unlink`, at 1000×557 the same without `SESSION`; the title's tooltip names the kind; the row is one line ≤ 32 px and the strip ≤ 56 px at both sizes; after Unlink the row reads `VEHICLE ‹ <k> / <n> ▾ › smart451 · whole series … Link` with greyed arrows, `Link` in the box `Unlink` had (±1 px), and no `Drive` title
- **Evidence:** UI check on smart451 (one screenshot per state and size, row and strip heights, the action slot's box before and after)

### Requirement: Catalog list
`<k> / <n> ▾` SHALL open the catalog list: one row per session in catalog order with position, kind, title or object, local start, duration and up to 2 meta values, the current row marked, a focused filter field matching title, object, kind, id, local start or a meta value case-insensitively, at most 500 rows then `… <m> more: type to filter`; a click or Enter SHALL send `case.go`. At its foot the list SHALL hold an `ALIGN` radio group with the alignment items (`Session start`, `Session end`, `Anchor from the finder` disabled when no session has an anchor, and the event while in event mode), the current mode checked; choosing an unchecked item SHALL send `case.align` with it and close the list. The session bar SHALL have no separate Align control. Origin: exploration UX sketch („Catalog list"), accepted by D-086; Align in the list: D-092 (5).

#### Scenario: Filter and go
- **WHEN** the list gets C4 at entry 0 and the filter `charg`, then Enter; and a catalog of 600 sessions without a filter
- **THEN** one row (entry 2) remains and Enter sends `case.go {index: 2}`; the 600-session list renders 500 rows and `… 100 more: type to filter`
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "filters the catalog list"

#### Scenario: Align in the list
- **WHEN** the session bar is rendered open for linked C4 in start mode, and again in event mode for `dtc ECU1 B1234`
- **THEN** both markups hold one `radiogroup` labelled `Align` inside the list with `Session start` checked in the first and the event item checked in the second, `Anchor from the finder` disabled exactly when no C4 entry has an anchor, and the bar outside the list holds no button whose text starts `Align`
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

## ADDED Requirements

### Requirement: Stepping shows the target at once
On a step (`‹`, `›`, `[`, `]`) or a pick in the catalog list, the session bar SHALL at once show the target's slots from the loaded catalog, a 2 px accent progress line on the row's bottom edge taking no space, and the strip's bars as a skeleton until the new density is in (design DW4). The line SHALL end when the command's revision is rendered, or when it is refused, which restores the current slots. Origin: D-092; designer's measurement (title changes about 1 s before the range); mock state 2.

#### Scenario: Pending step slots
- **WHEN** `sessionSlots` gets linked C4 at entry 0 with a pending target 2 and the loaded catalog; the same with the catalog not loaded; and `pendingTarget` gets linked C4 at current 0 with no pending and `case.step {by: 1}`, with pending 1 and `case.step {by: 1}`, at current 3 (the last) with `case.step {by: 1}`, with `case.go {index: 2}`, and unlinked with `case.step {by: 1}`
- **THEN** the first gives position `3 / 4` and entry 2's title, times and duration with `pending` true; the second gives position `3 / 4` and skeletons in the title, times and duration slots; `pendingTarget` gives 1, 2, undefined, 2 and undefined
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "shows the step target at once"

#### Scenario: Step on smart451
- **WHEN** a catalog from `kipscope case drives smart451` is open at 1440×900 at entry 1, the user presses `]` and takes a screenshot within 200 ms, then waits until the windows have drawn
- **THEN** the first screenshot shows the next drive's title, times and duration with the progress line visible and grey strip bars; afterwards the progress line is gone, the strip shows the new scope's bars with the accent window, and the windows show the new session
- **Evidence:** UI check on smart451 (two screenshots)

### Requirement: Session bar never moves
No slot of the context row SHALL move or resize by more than 1 px while the user steps, opens the list, unlinks or links, or the open note comes or goes. A slot whose text is not known yet (no workspace yet after `/open#cases=`, a pending target not in the loaded catalog) SHALL show a grey skeleton in its own box; after `/open#cases=` the row SHALL be there with skeletons from the first paint. Origin: D-092 ("Layout never moves"); mock `SessionBar.dc.html` states 2, 3.

#### Scenario: Skeleton before the workspace
- **WHEN** the session bar is rendered to static markup for an opening page without a workspace yet, and for linked C4
- **THEN** both markups hold the same slot elements in the same order (`slot-label`, the two arrows, `session-position`, `slot-title`, `slot-times`, `slot-duration`, `slot-action`); in the first the title, times and duration slots each hold one `skeleton` element and no text
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "renders skeletons in the same slots"

#### Scenario: Probe over steps
- **WHEN** at 1440×900 and at 1000×557 (sidebar open) a catalog from `kipscope case drives smart451` is open with one entry's title changed to a 90-character text, the UI user starts the layout probe of design DW1, presses `]` three times (passing the long title), `[` once, opens and closes the list, clicks Unlink and then Link, waiting for the progress line to end after each, then stops the probe
- **THEN** the probe reports at most 1 px for `‹`, `<k> / <n> ▾`, `›`, the title, times, duration and action slots, the context row and the strip at both sizes
- **Evidence:** UI check on smart451 (probe output per size, one screenshot at the long title showing the `…` and its tooltip)

### Requirement: Session times across midnight
The times slot SHALL show a session that ends on the next local day as `<weekday> <date>  <from> – <to>⁺¹` (a small raised `+1` after the end time) and one that ends two or more local days later as `<weekday> <date> – <weekday> <date>` with both full times in the slot's tooltip; the slot's box SHALL NOT change. Origin: D-092 (4) („a range over two or more days shows the full end date, one day a small ⁺¹"; Jan: „a +1 if days span which is rare"); mock `SessionBar.dc.html` states 6 and 7.

#### Scenario: Plus one and multi-day
- **WHEN** `sessionSlots` gets in Europe/Berlin an entry from 2026-10-20 23:31:05 to 2026-10-21 01:52:43 local, one from 2026-10-11 10:00:00 to 2026-10-21 09:00:00 local, and one ending exactly at 2026-10-21 00:00:00 local after starting 2026-10-20 23:00:00
- **THEN** the first gives weekday `Tue`, times `2026-10-20  23:31:05 – 01:52:43` and `plusOne` true; the second times `2026-10-11 – Wed 2026-10-21` with weekday `Sun` and a tooltip holding `2026-10-11 10:00:00 – 2026-10-21 09:00:00`; the third `23:00:00 – 00:00:00` with `plusOne` true
- **Evidence:** `apps/web/test/sessionBar.test.ts` › "marks a session crossing midnight"
