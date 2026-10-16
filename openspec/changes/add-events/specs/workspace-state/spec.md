## ADDED Requirements

### Requirement: Events-line signals in the workspace
The workspace SHALL hold the events-line signals as `eventSignals` (IDs in order, absent when empty, at most 8), starting from the project file. `events.addSignal {signalId}` SHALL append one or be rejected with `unknown_signal`, `not_state_signal`, `already_listed` or `event_signal_limit`; `events.removeSignal {signalId}` SHALL remove one or be rejected with `not_listed`. Origin: D-059 („drags a signal with stats to horizon"; yaml start); D-051 pattern; 8: design E8.

#### Scenario: Add and remove
- **WHEN** on a workspace without `eventSignals`, with a context where `testcar/Ign_A20h.MODE` has states, `testcar/Fast_100h.SIG_A` has none and `testcar/Nope.X` is unknown, these are applied: add MODE, add MODE, add SIG_A, add Nope.X, remove Nope.X, remove MODE; and add to a list of 8
- **THEN** `eventSignals` `["testcar/Ign_A20h.MODE"]`; `already_listed`; `not_state_signal`; `unknown_signal`; `not_listed`; the field absent again; `event_signal_limit`
- **Evidence:** `packages/shared/test/apply.test.ts` › "adds and removes events-line signals"

#### Scenario: Start value and HTTP
- **WHEN** the test server starts with a project file listing `testcar/Ign_A20h.MODE`, and a caller posts `events.addSignal` for `testcar/DIAG.door` and reads `GET /api/workspace`
- **THEN** the command is accepted with a new revision and `eventSignals` is `["testcar/Ign_A20h.MODE","testcar/DIAG.door"]`
- **Evidence:** `apps/server/test/workspace.http.test.ts` › "applies the events commands over HTTP"
