# events Specification

## Purpose
TBD - created by archiving change add-events. Update Purpose after archive.

## Requirements

### Requirement: Events source
The server SHALL read events from the configured events table (default `sdlog.events`, columns mapped like the signals table, design E1) and SHALL never return rows without a time. Without that table every data ref SHALL have no events, and the server logs one warning per catalog load. Origin: D-058 (new table `sdlog.events`); mapping: D-006 (configured source).

#### Scenario: Default mapping
- **WHEN** the server config is loaded without event variables, and once with `KIPSCOPE_EVENTS_TABLE=diag_events` and `KIPSCOPE_EVENT_COLUMN_TEXT=label`
- **THEN** the first gives table `events` with columns `source`, `kind`, `name`, `value`, `text`, `detail`; the second table `diag_events` and text column `label`; an invalid identifier (`a-b`) throws naming the variable
- **Evidence:** `apps/server/test/config.test.ts` › "reads the events mapping"

#### Scenario: No events table
- **WHEN** a test server runs against the test DB with `KIPSCOPE_EVENTS_TABLE=nope` and `GET /api/events?dataRef=testcar` is sent twice
- **THEN** both answer 200 with `total` 0 and `events` `[]`, and the server logged one warning naming `sdlog.nope`
- **Evidence:** `apps/server/test/events.http.test.ts` › "answers no events without an events table"

#### Scenario: Rows without time
- **WHEN** the test DB holds a `testcar` DTC row `P0NULL0` with a null time and `GET /api/events?dataRef=testcar` is sent
- **THEN** no event has the name `P0NULL0`
- **Evidence:** `apps/server/test/events.http.test.ts` › "lists the events of testcar with categories"

### Requirement: Event categories
Every event SHALL carry one category derived on the server (design E5): a DTC by its ISO 14229 status bits as `active`, `pending`, `stored`, `untested`, `passed` or `other`; a state row as `change` or `snapshot`; kind `nrc` as `refused`, `isotp` as `transport`, any other kind as `other`. Origin: D-058 (filter in „terms a person uses … not raw columns"); concept §9 („Fehlercodes fachlich passend darstellen").

#### Scenario: Status bytes
- **WHEN** the categories of DTC values 0x29, 0x69, 0x09, 0x24, 0x02, 0x28, 0x20, 0x80, 0x50, 0x40, 0x10, 0x00, 3.5, 256 and −1 are derived
- **THEN** active, active, active, pending, pending, stored, stored, stored, untested, untested, untested, passed, other, other, other
- **Evidence:** `packages/shared/test/events.test.ts` › "maps DTC status bytes to categories"

#### Scenario: Categories on smart451
- **WHEN** the dev server runs against carserver and `curl -s 'localhost:7310/api/events?dataRef=smart451' | jq -c '.counts'` runs (with no events-line signal listed)
- **THEN** it prints active 13, stored 4, untested 38, change 22, snapshot 304, refused 2, transport 2 (and no other category), `total` 385
- **Evidence:** the command

### Requirement: DTC status for people
A DTC event SHALL carry its status as text: `0x` and two upper-case hex digits, then the set bits in bit order, joined by ` · `, with the names failing now, failed this cycle, pending, confirmed, not tested since clear, failed since clear, not tested this cycle, warning lamp. Origin: D-058 („human way of thinking"); ISO 14229-1 bit meanings.

#### Scenario: Status text
- **WHEN** the status texts of 41, 80 and 0 are formatted
- **THEN** `0x29 failing now · confirmed · failed since clear`, `0x50 not tested since clear · not tested this cycle` and `0x00`
- **Evidence:** `packages/shared/test/events.test.ts` › "decodes the status byte for people"

### Requirement: Changes and snapshots
A state event SHALL be a `change` when its detail reads `from <state>`, or when its text differs from the previous event of the same source and name (then `inferred`: seen after a gap); every other one, the first of a name included, a `snapshot`. A change SHALL carry the previous state and when it was last seen. Origin: D-058 (snapshots per ~90 s chunk vs. transitions); data fact: 11 of smart451's 22 changes fall between logger sessions; design E6; D-058 (answer Q6).

#### Scenario: Derivation
- **WHEN** state rows of `VCU.door` are derived: closed (initial) at 01:00:00, closed (initial) at 01:01:30, open (`from closed`) at 01:03:00, open (initial) at 01:04:30, closed (initial) at 02:00:00; and of `DIAG.lock`: locked (initial) at 02:00:00
- **THEN** snapshot, snapshot, change from closed (last seen 01:01:30, not inferred), snapshot, change from open (last seen 01:04:30, inferred); `DIAG.lock` snapshot
- **Evidence:** `packages/shared/test/events.test.ts` › "derives changes and snapshots per state name"

#### Scenario: Changes on smart451
- **WHEN** `curl -s 'localhost:7310/api/events?dataRef=smart451&filter=changes' | jq -c '[.events[] | select(.inferred)] | length, ([.events[] | select(.name == "BMS.contactor")] | map(.text))'` runs (no events-line signal listed)
- **THEN** it prints 11 and `["closed","open"]`
- **Evidence:** the command

### Requirement: State changes of events-line signals
For each events-line signal with states, the server SHALL derive events from its rows without SNA (design E7): the first row a `snapshot`, each change of state a `change` (`VAL_` signals: only where the old or the new value has a name), `inferred` after more than 5 min without rows; kind `signal`, source the signal's shown name, text the state name. Origin: D-059 („if one drags a signal with stats to horizon. the changes are marked").

#### Scenario: Signal changes in the test DB
- **WHEN** `GET /api/events?dataRef=testcar&signal=testcar/Ign_A20h.MODE&signal=testcar/Tmp_A21h.TEMP&signal=testcar/DIAG.door&signal=testcar/DIAG.lock` is sent
- **THEN** besides the 18 table events it holds for `Ign_A20h.MODE` a snapshot `NONE` at 01:00:00 and changes `KEYON` at 01:10:00 (from `NONE`), `NONE` at 02:00:00 (from `KEYON`) and `KEYON` at 02:45:00 (inferred, from `NONE` last seen 02:29:59.900); for `Tmp_A21h.TEMP` a snapshot `20` at 01:00:00 and changes `SENSOR_DEF` at 01:05:00 (from `29`) and `25` at 01:05:10; for `DIAG.door` a snapshot `closed` and changes `open` at 01:03:00 and `closed` at 02:00:00 (inferred); nothing for `DIAG.lock`, which is in `skipped` with reason `in_events_table`; all times after 2026-10-01T00:00:00Z
- **Evidence:** `apps/server/test/events.http.test.ts` › "adds the state changes of listed signals"

#### Scenario: Rule on rows
- **WHEN** signal change events are derived from rows (t s: value) 0: 0, 1: 0, 2: SNA, 3: 3, 4: 3, 400: 3, 1000: 0 with names 0 NONE and 3 KEYON; and from rows 0: 20, 1: 21, 2: 254, 3: 25 with only 254 named SENSOR_DEF
- **THEN** snapshot NONE at 0, change KEYON at 3 (from NONE at 1), change NONE at 1000 (inferred, from KEYON at 400); snapshot 20 at 0, change SENSOR_DEF at 2 (from 21), change 25 at 3
- **Evidence:** `packages/shared/test/events.test.ts` › "derives state changes of a signal"

#### Scenario: Ignition on smart451
- **WHEN** `curl -s 'localhost:7310/api/events?dataRef=smart451&signal=smart451/DCU_1F4h.IgnMode&signal=smart451/BMS.contactor' | jq -c '[.events[] | select(.kind == "signal")] | length, (map(select(.category == "change")) | length), .skipped'` runs
- **THEN** it prints 17, 16 and `[{"signalId":"smart451/BMS.contactor","reason":"in_events_table"}]`; the first change is `KEYON` at 2026-10-11T13:38:56.879Z
- **Evidence:** the command

### Requirement: Signal change limits
The server SHALL fetch only the changed rows of a signal from the source; a signal with more than 2,000 changes SHALL be skipped as `too_many_changes`, and one whose data ref's events table holds state events of its name as `in_events_table`. Origin: D-007 (carserver's 2 GB RAM); no double marks, since `BMS.contactor` is both a diag event and a signal; design E7.

#### Scenario: Too many changes
- **WHEN** a fake source reports 2,001 changes for a signal on the events line
- **THEN** its events are left out and `skipped` names it with `too_many_changes`
- **Evidence:** `apps/server/test/events.test.ts` › "skips a signal with more than 2,000 changes"

#### Scenario: Cost on carserver
- **WHEN** the dev server was restarted and `curl -s -o /dev/null -w '%{time_total}\n' 'localhost:7310/api/events?dataRef=smart451&signal=smart451/BCM_42Eh.IGN_15'` runs twice
- **THEN** both answer 200; goal, measured and reported but not pass/fail: the first ≤ 1 s, the second ≤ 0.1 s
- **Evidence:** the command (both times)

### Requirement: Events endpoint
`GET /api/events?dataRef=<ref>` with optional repeated `signal`, `filter`, `from` and `to` SHALL answer the events in time order (fields of design E2), `total`, `counts` and `sources` before the filter, the filter in normal form, and the skipped signals with reasons (`not_in_catalog`, `no_states`, `too_many_changes`, `in_events_table`). Origin: D-058 (events reach strip, windows and CLI).

#### Scenario: testcar events
- **WHEN** `GET /api/events?dataRef=testcar` is sent on the test DB
- **THEN** 200 with `total` 18, `counts` {active 2, pending 1, stored 2, untested 2, passed 1, change 2, snapshot 4, refused 1, transport 1, other 2}, `sources` `[{"source":"BMS","count":11},{"source":"VCU","count":7}]`, events in time order, `P0CA700` with `status` `0x29 failing now · confirmed · failed since clear`, no `filter` field, `skipped` `[]`
- **Evidence:** `apps/server/test/events.http.test.ts` › "lists the events of testcar with categories"

#### Scenario: Server-side filter and range
- **WHEN** `filter=faults%20ecu:bms`, then `filter=FAULTS%20Fault`, then `from=2026-10-01T01:00:00Z&to=2026-10-01T02:00:00Z`, then `filter=ecu:` are sent for testcar
- **THEN** 5 events (2 active, 1 pending, 2 stored) with `filter` `faults ecu:bms` and `total` 18; then `filter` `faults` (normal form, duplicate dropped); then 4 events (the `VCU.door` rows before 02:00) with `total` 4; then 400 `invalid_filter` with a message naming `ecu`
- **Evidence:** `apps/server/test/events.http.test.ts` › "filters on the server"

#### Scenario: Skipped signals
- **WHEN** `signal=testcar/Fast_100h.SIG_A&signal=testcar/Nope.X&signal=othercar/Fast_100h.SIG_A` is sent with `dataRef=testcar`
- **THEN** 200 with `skipped` `no_states` for the first, `not_in_catalog` for the second, and the third ignored (other data ref)
- **Evidence:** `apps/server/test/events.http.test.ts` › "reports skipped signals"

### Requirement: Events endpoint errors
The events endpoint SHALL answer 400 `invalid_filter` with the parser's message, 400 for bad times or `to` not after `from`, 404 `unknown_data_ref` and 502 `source_error`. Origin: like the density errors (`time-strip` "Density errors").

#### Scenario: Bad requests
- **WHEN** `dataRef` is missing, `dataRef=nope`, `from` without `to`, and `from` after `to` are sent
- **THEN** 400, 404 `unknown_data_ref`, 400, 400
- **Evidence:** `apps/server/test/events.http.test.ts` › "rejects bad parameters"

### Requirement: Events cached
Table events SHALL be loaded once per data ref and catalog load and a signal's changes once per signal and catalog load, concurrent requests sharing a load and failures not kept; after each catalog load the server SHALL load every data ref's table events and the project file's signals in turn. Above 100,000 events the first 100,000 SHALL be kept with `truncated`. Origin: like the density (D-056); 100,000: design E3.

#### Scenario: Cache, prefetch, failure, cap
- **WHEN** a fake source counts its calls: two concurrent `get("testcar")`, then a catalog load, a failing call, a retry; and a source with 100,001 rows
- **THEN** one source call for the two gets; a prefetch call per data ref and listed signal after the load; the failure rejects and the retry calls the source again; the large source gives 100,000 events and `truncated` true
- **Evidence:** `apps/server/test/events.test.ts` › "caches per catalog load and prefetches", "keeps the first 100,000 events"

### Requirement: Events-line signals in the project file
The project file's `events.signals` (at most 8 signal IDs) SHALL give the start value of the workspace's events-line signals; commands win until restart and nothing writes the file. The shipped file SHALL list `smart451/DCU_1F4h.IgnMode` and `smart451/BMS.contactor`. Origin: D-059 („automatically only two things (yaml define) IGN and contactor state"); D-051 pattern; names: D-058 (Jan's answers).

#### Scenario: Reading the section
- **WHEN** project files with `events: {signals: [smart451/DCU_1F4h.IgnMode]}`, with 9 entries, with `signals: [nodataref]` and with `events: {colour: red}` are read
- **THEN** the first gives `["smart451/DCU_1F4h.IgnMode"]`; the others are problems naming `events.signals` (at most 8; not a signal ID) and `events: unknown key "colour"`, handled like the other project-file problems
- **Evidence:** `apps/server/test/project.test.ts` › "reads events.signals"

### Requirement: Waiting signals
A listed signal missing from the catalog SHALL be skipped without an error, logged once per catalog load and shown in the events panel as not recorded yet; its changes SHALL appear after the first catalog load that holds it. Origin: D-059 („the entry must wait quietly until it is").

#### Scenario: Waiting signal
- **WHEN** the test server starts with `events.signals` `[testcar/Ign_A20h.MODE, testcar/Later.X]` and its catalog is loaded twice, the second time with `testcar/Later.X` (a state signal) added to the stub catalog
- **THEN** `GET /api/workspace` lists both in `eventSignals`; after the first load the log has one line naming `testcar/Later.X` and an events request with both signals skips it as `not_in_catalog`; after the second load it is not skipped
- **Evidence:** `apps/server/test/events.http.test.ts` › "waits for a listed signal until it is recorded"

### Requirement: Events panel
The sidebar's Events tab SHALL show the heading `EVENTS` with the scope switch `In view <k> | All <n>`, the filter in words followed by ` · <h> hidden` (events of the strip's data ref the filter hides) or the parser's error, the presets, a `Refine` section (closed by default, its state kept per browser) holding the filter field, the category and ECU chips with counts and the events-line signals with remove buttons, then the list and a key line (layout: design P3, P6). Origin: D-058 (filter in human terms; brief: "filtering never hides silently"); place: D-058 (Jan's answers); Jan 2026-10-17 („cluttered hard to use"); proposal E-4.

#### Scenario: Panel on smart451
- **WHEN** smart451 is shown at 1440×900 with the shipped project file's events-line signals (IgnMode, BMS.contactor) and the default filter, window 1 over 2026-10-14 18:55–19:15 local, Refine closed, and the user opens the Events tab
- **THEN** the heading shows `In view 15 | All 63` with `In view` pressed, the line reads `Active faults and state changes · 414 hidden`, the six presets show, `Refine` shows `active changes` and no field or chip is visible, the list starts within the upper half of the viewport, and the key line shows `Fault`, `Stored`, `Change`, `Other`, `Fault memory read` (counts as `curl -s 'localhost:7310/api/events?dataRef=smart451&signal=smart451/DCU_1F4h.IgnMode&signal=smart451/BMS.contactor' | jq '.total'` and the same with `&filter=active%20changes` and `&from=2026-10-14T16:55:00Z&to=2026-10-14T17:15:00Z` give them; 477, 63, 15 on 2026-10-17)
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
A row SHALL show the category glyph, the local time to the ms and the category in words, then the event's name without a repeated source and its text (a change `<from> → <to>`, an inferred one with ` · after a gap`), wrapping and never cut with an ellipsis (design P4). Origin: persona test 2026-10-17 (novice: "event text cut off in the narrow list", "show the description in the list, not only on hover"); D-058 („human way of thinking"); sidebar width: D-095.

#### Scenario: Row names
- **WHEN** `rowName` runs for a signal event (source `IgnMode`, name `DCU_1F4h.IgnMode`), a state event (source `BMS`, name `BMS.contactor`), a DTC (`BMS`, `P0CA700`) and an NRC (`BMS`, `SID 22`)
- **THEN** `IgnMode`, `BMS.contactor`, `BMS P0CA700`, `BMS SID 22`
- **Evidence:** `apps/web/test/eventsPanel.test.ts` › "names rows without a repeated source"

#### Scenario: Longest text on smart451
- **WHEN** on smart451 at 1440×900 the sidebar is open (248 px wide), the filter is `all`, window 1 shows 2026-10-15 07:17:12–07:37:12 local and the user expands the `Fault memory read` row
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

### Requirement: Events of a scope
While the workspace has a scope, `GET /api/events` for its data ref SHALL answer only the table events in the scope and the state changes of the listed signals within it, the first row in the scope being a `snapshot` (design Z9). `from` and `to` SHALL be intersected with the scope, and loads SHALL be cached per scope. In an object scope `from` and `to` SHALL be required and SHALL take the scope's place, loads cached per window (object-view "Gaps and events follow the view"). Origin: the ADX feedback item 4; the ADX feedback (`stateChanges` „all time for one signal"); D-078; object scope: D-086.

#### Scenario: testcar events in a scope
- **WHEN** the test server has scope {testcar, T1, T2} and `GET /api/events?dataRef=testcar` is sent, then the same with `&signal=testcar/Ign_A20h.MODE`
- **THEN** the first answers `total` 4 with the same events as the unscoped request with `from=2026-10-01T01:00:00Z&to=2026-10-01T02:00:00Z`; in the second the `Ign_A20h.MODE` events are exactly a snapshot `NONE` at 01:00:00 and a change to `KEYON` at 01:10:00 (from `NONE`); its change at 02:00:00 lies outside the scope
- **Evidence:** `apps/server/test/events.http.test.ts` › "lists the events of a scope"

#### Scenario: Scoped source calls
- **WHEN** a fake source records its calls and an events request with one events-line signal is answered under scope {testcar, T1, T2}
- **THEN** `events` and `stateChanges` were each called once with that scope, and never without one
- **Evidence:** `apps/server/test/events.test.ts` › "loads table events and signal changes of a scope"

#### Scenario: Work window in an object scope
- **WHEN** a fake source records its calls, a workspace is unlinked on `testcar`, and an events request with one events-line signal and `from=2026-10-01T01:00:00Z&to=2026-10-01T02:00:00Z` is answered twice
- **THEN** it answers the same events as the scope {testcar, T1, T2} above; `events` and `stateChanges` were each called once with that window as their scope and never with the whole object scope
- **Evidence:** `apps/server/test/events.test.ts` › "loads the events of a work window"

### Requirement: Events count on the Events tab
While the strip's data ref has events, the sidebar's `Events` tab SHALL show after its label the number of events matching the filter, in tabular figures, with the tooltip `HINTS.eventsCount` (or the work window's "nearby" tooltip under a vehicle scope); without events the label alone. The tab's box SHALL NOT change with the number. `e` keeps opening the list with `Refine` open. Origin: D-058 („filtering never hides silently"); D-092 (strip head dropped; mock „Events 2").

#### Scenario: Tab count
- **WHEN** `sidebarTabs` gets events `{shown: 43, total: 629, sentence: "Active faults and state changes"}`, then `{shown: 0, total: 0}`, then 1,234 shown of 2,000
- **THEN** the Events tab's count is `43` with a title containing `43 events match the filter` and `629 in the recording`; then no count; then `1,234`
- **Evidence:** `apps/web/test/sidebar.test.ts` › "shows the events count on the tab"

#### Scenario: Count on smart451
- **WHEN** smart451 is shown at 1440×900 with the shipped project file and the default filter, then at 1000×557 with the sidebar open, and the user switches the events filter preset
- **THEN** the Events tab shows the number `/api/events` gives as the filtered total for smart451 (43 on 2026-10-17) at both sizes, fully visible, with the tooltip of `HINTS.eventsCount`; after the preset change the number changes and both tabs keep their boxes (±1 px)
- **Evidence:** UI check on smart451 (screenshots at both sizes, tooltip text, tab boxes before and after)
