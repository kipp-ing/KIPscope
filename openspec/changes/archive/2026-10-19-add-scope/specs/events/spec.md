# events delta

T1 = 2026-10-01T01:00:00Z, T2 = 02:00:00Z (test DB `testcar`).

## ADDED Requirements

### Requirement: Events of a scope
While the workspace has a scope, `GET /api/events` for its data ref SHALL answer only the table events in the scope and the state changes of the listed signals within it, the first row in the scope being a `snapshot` (design Z9). `from` and `to` SHALL be intersected with the scope, and loads SHALL be cached per scope. Origin: issue #1 item 4; issue #1 (`stateChanges` „all time for one signal"); D-078.

#### Scenario: testcar events in a scope
- **WHEN** the test server has scope {testcar, T1, T2} and `GET /api/events?dataRef=testcar` is sent, then the same with `&signal=testcar/Ign_A20h.MODE`
- **THEN** the first answers `total` 4 with the same events as the unscoped request with `from=2026-10-01T01:00:00Z&to=2026-10-01T02:00:00Z`; in the second the `Ign_A20h.MODE` events are exactly a snapshot `NONE` at 01:00:00 and a change to `KEYON` at 01:10:00 (from `NONE`); its change at 02:00:00 lies outside the scope
- **Evidence:** `apps/server/test/events.http.test.ts` › "lists the events of a scope"

#### Scenario: Scoped source calls
- **WHEN** a fake source records its calls and an events request with one events-line signal is answered under scope {testcar, T1, T2}
- **THEN** `events` and `stateChanges` were each called once with that scope, and never without one
- **Evidence:** `apps/server/test/events.test.ts` › "loads table events and signal changes of a scope"
