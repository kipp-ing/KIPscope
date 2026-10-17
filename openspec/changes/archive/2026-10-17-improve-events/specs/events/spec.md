## MODIFIED Requirements

### Requirement: Events panel
The sidebar's Events tab SHALL show the heading `EVENTS` with the scope switch `In view <k> | All <n>`, the filter in words followed by ` · <h> hidden` (events of the strip's data ref the filter hides) or the parser's error, the presets, a `Refine` section (closed by default, its state kept per browser) holding the filter field, the category and ECU chips with counts and the events-line signals with remove buttons, then the list and a key line (layout: design P3, P6). Origin: D-058 (filter in human terms; brief: "filtering never hides silently"); place: D-058 (Jan's answers); Jan 2026-10-17 („cluttered hard to use"); proposal E-4.

#### Scenario: Panel on smart451
- **WHEN** smart451 is shown at 1440×900 with the shipped project file's events-line signals (IgnCurMode, BMS.contactor) and the default filter, window 1 over 2026-10-14 18:55–19:15 local, Refine closed, and the user opens the Events tab
- **THEN** the heading shows `In view 15 | All 63` with `In view` pressed, the line reads `Active faults and state changes · 414 hidden`, the six presets show, `Refine` shows `active changes` and no field or chip is visible, the list starts within the upper half of the viewport, and the key line shows `Fault`, `Stored`, `Change`, `Other`, `Fault memory read` (counts as `curl -s 'localhost:7310/api/events?dataRef=smart451&signal=smart451/CPC_168h.IgnCurMode&signal=smart451/BMS.contactor' | jq '.total'` and the same with `&filter=active%20changes` and `&from=2026-10-14T16:55:00Z&to=2026-10-14T17:15:00Z` give them; 477, 63, 15 on 2026-10-17)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot of the panel; the three `curl` counts)

#### Scenario: Refine section
- **WHEN** on smart451 the user clicks `Refine`, reloads the page, then clicks `Refine` again
- **THEN** after the first click the field, the category chips (Active fault 13, Stored fault 4, Not tested 38, State change 43, Snapshot 374, Request refused 2, Transport error 2, Other 1 by `/api/events` `counts`), the ECU chips and the events-line signals show and `aria-expanded` is true; after the reload it is still open; after the second click it is closed; no click sends a command (revision unchanged)
- **Evidence:** UI check on smart451 at 1440×900 (screenshots, revision); `apps/web/test/eventsPrefs.test.ts` › "loads and saves scope and refine state"

### Requirement: Events list
The events list SHALL show, in scope `In view`, the shown events of the strip's data ref inside the bar target's range, and in scope `All` all of them; it SHALL group them by local day into rows (design P4), DTCs of one source at one time as one fault memory read row; at most 500 events with a note of how many more; in scope `All` rows inside the range carry an accent left border. A row click SHALL put cursor A on the row's time (Shift+click cursor B), centring the bar target on it first (span kept, one `window.setRange`) only when the time lies outside its range. Origin: D-058 (brief: „click and jump"); Jan 2026-10-17 (list focuses on what is in view); click like the glyph click (D-064); proposal E-1, E-2; 500: add-events design V8.

#### Scenario: Row click centres
- **WHEN** with the setup of "Panel on smart451" and scope `All` the user clicks the `BMS.contactor` row at 2026-10-14 18:59:47.679, then Shift+clicks the `Fault memory read` row at 2026-10-15 07:27:12.135, then clicks "Back"
- **THEN** after the click A is at 18:59:47.679 (values window header), the range unchanged, revision +1; after the Shift+click the header shows a 20 min range centred on 2026-10-15 07:27:12.135 local and B is there, revision +2; after "Back" the range 18:55–19:15 again, A and B unchanged
- **Evidence:** UI check on smart451 at 1440×900 (window header, values window header and revision after each step)

#### Scenario: Long list
- **WHEN** the panel lists 1,200 shown events (unit test with a fake list)
- **THEN** it renders the rows of the first 500 events and the note `700 more — narrow the filter`
- **Evidence:** `apps/web/test/eventsPanel.test.ts` › "caps the list at 500 rows"

#### Scenario: Items and bands
- **WHEN** `listItems` runs over events in time order: DTC `P1` (BMS) and DTC `P2` (BMS) at t 1, DTC `P3` (VCU) at t 1, a state change of `BMS.contactor` at t 1, DTC `P4` (BMS) at t 2; and `dayBands` over items on two local days
- **THEN** a read item (BMS, t 1, `P1`, `P2`), event `P3`, event `BMS.contactor`, event `P4`; two bands in order, each with its items
- **Evidence:** `apps/web/test/eventsPanel.test.ts` › "groups DTCs of one readout", "groups rows by local day"

## ADDED Requirements

### Requirement: Events in view
The list SHALL offer the scopes `In view` (default: shown events in the bar target's range) and `All`, kept per browser, with both counts on the switch; `In view` SHALL offer `↑ <k> earlier` and `↓ <k> later` jumps to the nearest event outside the range, acting like a row click, and be disabled without a bar target (design P1, P3). Origin: Jan 2026-10-17 (list focuses on what is in view); persona test item 2; proposal E-1.

#### Scenario: In view on smart451
- **WHEN** with the setup of "Panel on smart451" the user looks at the list, clicks `↑ 9 earlier`, then clicks `All`
- **THEN** first `↑ 9 earlier`, 15 rows from 18:59:47.679 to 19:08:32.172 local (the `BMS.contactor` change `closed → open · after a gap` first, then `BMS.isolation_alarm` and `BMS.isolation_fault` changes) and `↓ 39 later`; after the click the header shows a 20 min range centred on 2026-10-13 15:07:14.560 local, A is there, revision +2, the switch reads `In view <k> | All 63`; after `All` 63 rows (day bands from 2026-10-11) with the row at A highlighted and visible, revision unchanged
- **Evidence:** UI check on smart451 at 1440×900 (screenshots, header, values window header, revision)

#### Scenario: View math
- **WHEN** `inView` and `outside` run over events at 10, 20 and 30 s for the range [20 s, 30 s), and over the same events for [40 s, 50 s)
- **THEN** [20]; earlier 1 (before 10), later 1 (after 30); then []; earlier 3 (before 30), later 0 (no after)
- **Evidence:** `apps/web/test/eventsPanel.test.ts` › "keeps the events of the view"

#### Scenario: Scope stored
- **WHEN** the scope is read from storage holding `all`, holding `nonsense`, from empty storage and from storage that throws, and saved into storage that throws
- **THEN** `all`, `view`, `view`, `view`; saving does not throw
- **Evidence:** `apps/web/test/eventsPrefs.test.ts` › "loads and saves scope and refine state"

#### Scenario: No time window
- **WHEN** the workspace holds no timeseries window and the Events tab is open on smart451
- **THEN** `In view` is disabled with the title `In view: needs a window with a time range`, the list shows all shown events, and no earlier/later line shows
- **Evidence:** UI check on smart451 (screenshot with all windows closed in a scratch workspace, or a panel render test `apps/web/test/eventsPanel.test.ts` › "shows all without a range")

### Requirement: Step to an event
`n` and `p` (key rules of `time-navigation` "Navigation keys") and the panel's `›` and `‹` SHALL put cursor A on the next or previous shown event of the strip's data ref, counted from A when it lies in the bar target's range, else from the range's edge; events at one time are one step. Only an event outside the range SHALL centre the view (span kept, one `window.setRange`). Origin: Jan 2026-10-17 (step "from the cursor", as an idea); CANoe trace stepping; proposal E-2; design P2, P7.

#### Scenario: Step math
- **WHEN** `stepEvent` runs over events at 10, 20, 20 and 30 s with the range [15 s, 35 s): A off; A at 20; A at 30; A at 5 (outside the range); and over the range [40 s, 50 s) with A off
- **THEN** next 20, previous 30; next 30, previous 10; next none, previous 20; next 20, previous 30; next none, previous 30
- **Evidence:** `apps/web/test/eventsPanel.test.ts` › "steps from cursor A or the view's edge"; `apps/web/test/keys.test.ts` › "maps navigation keys outside text fields" (`n`, `p`; not with Ctrl, not in a text field)

#### Scenario: Stepping on smart451
- **WHEN** with the setup of "Panel on smart451" and A off, the user presses `n`, `n`, `p`, `p`
- **THEN** A at 2026-10-14 18:59:47.679, then 18:59:47.855 (both rows at that time highlighted), then 18:59:47.679, each with the range unchanged and revision +1; then the header shows a 20 min range centred on 2026-10-13 15:07:14.560 local with A there, revision +2
- **Evidence:** UI check on smart451 at 1440×900 (values window header, window header and revision after each key)

#### Scenario: The list follows cursor A
- **WHEN** in scope `All` on smart451 the user presses `n` until A moves to an event below the list's visible part
- **THEN** the row at A is highlighted and scrolled into the visible part of the list
- **Evidence:** UI check on smart451 at 1440×900 (screenshot)

### Requirement: Event rows readable
A row SHALL show the category glyph, the local time to the ms and the category in words, then the event's name without a repeated source and its text (a change `<from> → <to>`, an inferred one with ` · after a gap`), wrapping and never cut with an ellipsis (design P4). Origin: persona test 2026-10-17 (novice: "event text cut off in the narrow list", "show the description in the list, not only on hover"); D-058 („human way of thinking").

#### Scenario: Row names
- **WHEN** `rowName` runs for a signal event (source `IgnCurMode`, name `CPC_168h.IgnCurMode`), a state event (source `BMS`, name `BMS.contactor`), a DTC (`BMS`, `P0CA700`) and an NRC (`BMS`, `SID 22`)
- **THEN** `IgnCurMode`, `BMS.contactor`, `BMS P0CA700`, `BMS SID 22`
- **Evidence:** `apps/web/test/eventsPanel.test.ts` › "names rows without a repeated source"

#### Scenario: Longest text on smart451
- **WHEN** on smart451 at 1440×900 the sidebar is 240 px wide, the filter is `all`, window 1 shows 2026-10-15 07:17:12–07:37:12 local and the user expands the `Fault memory read` row
- **THEN** the line of `P0D1A16` shows its whole 164-character text over several lines (no `…`; its element's `scrollWidth` ≤ `clientWidth`), and no row in the list has `text-overflow: ellipsis`
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, `scrollWidth`/`clientWidth` read in the page)

### Requirement: Fault memory reads
A DTC's time SHALL be presented as its ECU's fault memory readout time: two or more DTCs of one source at one time form one expandable row `Fault memory read`, marks of DTCs only are hollow, DTC tooltips carry `READ_LINE` (design P2, P4, P5); the data is unchanged. Origin: data fact (persona expert): all 55 smart451 DTCs carry 2026-10-15 07:27:12.135 local, the readout time; ODIS-style fault memory lists; proposal E-3.

#### Scenario: Read summary
- **WHEN** `readSummary` runs for a read item of BMS holding 13 active DTCs, with 55 BMS DTCs at that time in the unfiltered list; and for one holding 2 active and 1 stored DTC of 3
- **THEN** `BMS · 13 active faults · 55 DTCs read` and `BMS · 2 active faults, 1 stored fault · 3 DTCs read`
- **Evidence:** `apps/web/test/eventsPanel.test.ts` › "summarises a fault memory read"

#### Scenario: Readout on smart451
- **WHEN** on smart451 at 1440×900 with the default filter window 1 shows 2026-10-15 07:17:12–07:37:12 local, the user opens the Events tab, then clicks the row's expand button
- **THEN** the list holds one row: hollow glyph, `07:27:12.135`, `Fault memory read`, `BMS · 13 active faults · 55 DTCs read`; expanded, 13 lines, among them `B21F200` with `0x29 failing now · confirmed · failed since clear` and `The status ''Circuit 15'' is implausible.`; the strip pin and the chart glyph at 07:27 are hollow (white inside, red outline) and the strip pin's tooltip starts `13 events · 13 active faults` followed by the line `Fault memory read at this time; when a fault first occurred is unknown`
- **Evidence:** UI check on smart451 at 1440×900 (screenshots of list, strip and chart; tooltip text)

### Requirement: Events key
The panel SHALL show below the list one key line naming each mark colour and line style (`Fault` solid, `Stored` solid, `Change` dashed, `Other` dotted) and the hollow mark (`Fault memory read`), with a tooltip saying where these marks appear. Origin: persona test 2026-10-17 (marker meaning unclear without hovering; tooltips not found by the expert); D-058 („human way of thinking").

#### Scenario: Key on smart451
- **WHEN** the Events tab is open on smart451 at 1440×900 and the list is scrolled
- **THEN** the key line stays visible below the list with its five items in the colours of `markColor` (fault `rgb(190, 18, 60)`, stored `rgb(180, 83, 9)`, change `rgb(124, 58, 237)`, other `rgb(100, 116, 139)`)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, computed colours)
