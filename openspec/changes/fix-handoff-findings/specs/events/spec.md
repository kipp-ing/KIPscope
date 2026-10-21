## MODIFIED Requirements

### Requirement: Events source
The server SHALL read events from the configured events table (default `sdlog.events`, columns mapped like the signals table, design E1) and SHALL never return rows without a time. Without that table every data ref SHALL have no events: after the source's first "no table" answer the server SHALL remember it for the rest of its run, SHALL send no further table-events query to that source for any data ref, scope or work window, and SHALL log one warning per run; state changes of events-line signals SHALL still be read. Origin: D-058 (new table `sdlog.events`); mapping: D-006 (configured source); remembered: finder finding (issue #1, comment 2026-10-21): ADX answers SEM0100 and the query is sent again for every scope.

#### Scenario: Default mapping
- **WHEN** the server config is loaded without event variables, and once with `KIPSCOPE_EVENTS_TABLE=diag_events` and `KIPSCOPE_EVENT_COLUMN_TEXT=label`
- **THEN** the first gives table `events` with columns `source`, `kind`, `name`, `value`, `text`, `detail`; the second table `diag_events` and text column `label`; an invalid identifier (`a-b`) throws naming the variable
- **Evidence:** `apps/server/test/config.test.ts` › "reads the events mapping"

#### Scenario: No events table
- **WHEN** a test server runs against the test DB with `KIPSCOPE_EVENTS_TABLE=nope` and `GET /api/events?dataRef=testcar` is sent twice
- **THEN** both answer 200 with `total` 0 and `events` `[]`, and the server logged one warning naming `sdlog.nope`
- **Evidence:** `apps/server/test/events.http.test.ts` › "answers no events without an events table"

#### Scenario: Missing table remembered
- **WHEN** a fake source counts its calls and answers "no table" for `events`, and two caches over that source (as the events route and the case route hold) load table events for `testcar` in scope {testcar, T1, T2}, for `othercar`, for `testcar` in a work window, after a new catalog load, and with one events-line signal `testcar/Ign_A20h.MODE`
- **THEN** `events` was called once in all, the warn function got one message, every load gave no table events, and `stateChanges` was called for `Ign_A20h.MODE`
- **Evidence:** `apps/server/test/events.test.ts` › "remembers a missing events table for the run"

#### Scenario: Rows without time
- **WHEN** the test DB holds a `testcar` DTC row `P0NULL0` with a null time and `GET /api/events?dataRef=testcar` is sent
- **THEN** no event has the name `P0NULL0`
- **Evidence:** `apps/server/test/events.http.test.ts` › "lists the events of testcar with categories"

## ADDED Requirements

### Requirement: Events table in meta
`GET /api/meta` SHALL report `source.events`: `unknown` until the source first answered a table-events query, then `table` (rows, none counts) or `none` ("no table"); a failed query SHALL leave it as it was. `docs/http-api.md` SHALL name it in the meta row. Origin: finder finding (issue #1, comment 2026-10-21: "no events table" cannot be told from "no events here"); "Events source".

#### Scenario: Meta follows the first answer
- **WHEN** an app with a fake source answers `GET /api/meta` before any events request, then after `GET /api/events?dataRef=testcar` with the source answering "no table"; and a second app whose source answers `[]`
- **THEN** the first app reports `source.events` `unknown`, then `none`; the second `unknown`, then `table` after its events request
- **Evidence:** `apps/server/test/meta.http.test.ts` › "reports whether the source has an events table"

#### Scenario: Documented
- **WHEN** the docs test reads the row of `GET /api/meta` in `docs/http-api.md`
- **THEN** it contains `events`
- **Evidence:** `apps/server/test/docs.test.ts` › "documents every HTTP route"
