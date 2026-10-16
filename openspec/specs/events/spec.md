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
- **WHEN** `curl -s 'localhost:7310/api/events?dataRef=smart451&signal=smart451/CPC_168h.IgnCurMode&signal=smart451/BMS.contactor' | jq -c '[.events[] | select(.kind == "signal")] | length, (map(select(.category == "change")) | length), .skipped'` runs
- **THEN** it prints 17, 16 and `[{"signalId":"smart451/BMS.contactor","reason":"in_events_table"}]`; the first change is `KEYON` at 2026-10-11T13:38:56.879Z
- **Evidence:** the command

### Requirement: Signal change limits
The server SHALL fetch only the changed rows of a signal from the source; a signal with more than 2,000 changes SHALL be skipped as `too_many_changes`, and one whose data ref's events table holds state events of its name as `in_events_table`. Origin: D-007 (carserver's 2 GB RAM); no double marks, since `BMS.contactor` is both a diag event and a signal; design E7.

#### Scenario: Too many changes
- **WHEN** a fake source reports 2,001 changes for a signal on the events line
- **THEN** its events are left out and `skipped` names it with `too_many_changes`
- **Evidence:** `apps/server/test/events.test.ts` › "skips a signal with more than 2,000 changes"

#### Scenario: Cost on carserver
- **WHEN** the dev server was restarted and `curl -s -o /dev/null -w '%{time_total}\n' 'localhost:7310/api/events?dataRef=smart451&signal=smart451/SAM_423h.KL_15'` runs twice
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
The project file's `events.signals` (at most 8 signal IDs) SHALL give the start value of the workspace's events-line signals; commands win until restart and nothing writes the file. The shipped file SHALL list `smart451/CPC_168h.IgnCurMode` and `smart451/BMS.contactor`. Origin: D-059 („automatically only two things (yaml define) IGN and contactor state"); D-051 pattern; names: D-058 (Jan's answers).

#### Scenario: Reading the section
- **WHEN** project files with `events: {signals: [smart451/CPC_168h.IgnCurMode]}`, with 9 entries, with `signals: [nodataref]` and with `events: {colour: red}` are read
- **THEN** the first gives `["smart451/CPC_168h.IgnCurMode"]`; the others are problems naming `events.signals` (at most 8; not a signal ID) and `events: unknown key "colour"`, handled like the other project-file problems
- **Evidence:** `apps/server/test/project.test.ts` › "reads events.signals"

### Requirement: Waiting signals
A listed signal missing from the catalog SHALL be skipped without an error, logged once per catalog load and shown in the events panel as not recorded yet; its changes SHALL appear after the first catalog load that holds it. Origin: D-059 („the entry must wait quietly until it is").

#### Scenario: Waiting signal
- **WHEN** the test server starts with `events.signals` `[testcar/Ign_A20h.MODE, testcar/Later.X]` and its catalog is loaded twice, the second time with `testcar/Later.X` (a state signal) added to the stub catalog
- **THEN** `GET /api/workspace` lists both in `eventSignals`; after the first load the log has one line naming `testcar/Later.X` and an events request with both signals skips it as `not_in_catalog`; after the second load it is not skipped
- **Evidence:** `apps/server/test/events.http.test.ts` › "waits for a listed signal until it is recorded"

### Requirement: Events panel
The sidebar's Events tab SHALL show the heading `EVENTS` with `<shown> of <total>`, the filter field, the filter in words or the parser's error, the presets, category and ECU chips with counts, the events-line signals with remove buttons, and the list of the shown events of the strip's data ref (layout: design V8). Origin: D-058 (filter in human terms; brief: „3 of 385 shown"); place: D-058 (Jan's answers).

#### Scenario: Panel on smart451
- **WHEN** the six-window setup is shown on smart451 at 1440×900 with the shipped project file, and the user opens the Events tab
- **THEN** the heading shows `51 of 402`, the field `active changes`, the line `Active faults and state changes`; chips Active fault 13, Stored fault 4, Not tested 38, State change 38, Snapshot 305, Request refused 2, Transport error 2 (on: active, change); ECU chips BMS 385 and IgnCurMode 17; the events-line signals IgnCurMode and BMS.contactor; the list starts with a day band and the first ignition `KEYON` of 2026-10-11 at `15:38:56.879`
- **Evidence:** UI check on smart451 at 1440×900 (screenshot of the panel, `curl` of `/api/events` for the counts)

### Requirement: Events list
The events list SHALL group the events by local day; each row SHALL show a category glyph, the local time to the ms, source and name, and the text (a change `<from> → <to>`); at most 500 rows with a note of how many more; rows inside the bar target's range carry an accent left border; a click SHALL centre the bar target on the event, span kept, with one `window.setRange`. Origin: D-058 (brief: „click and jump"); 500: design V8.

#### Scenario: Row click centres
- **WHEN** window 1 shows a 20 min range on smart451, "Link time axes" is on, and the user clicks the list row of `P0CA700`, then clicks "Back"
- **THEN** the header shows a 20 min range centred on 2026-10-15 07:27:12.135 local, the revision rose by one; after "Back" the old range
- **Evidence:** UI check on smart451 at 1440×900 (header and revision after each step)

#### Scenario: Long list
- **WHEN** the panel lists 1,200 shown events (unit test with a fake list)
- **THEN** it renders 500 rows and the note `700 more — narrow the filter`
- **Evidence:** `apps/web/test/eventsPanel.test.ts` › "caps the list at 500 rows"
