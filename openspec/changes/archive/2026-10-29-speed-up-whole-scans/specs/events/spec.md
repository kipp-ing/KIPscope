## ADDED Requirements

### Requirement: Events within the scan bound
In full mode without a scope, the event prefetch after a catalog load SHALL skip every data ref whose `refCount` exceeds the scan bound's rows (scope "Scan bound"), and `/api/events` for such a data ref SHALL answer 422 `too_wide`. With a scope, or a work window in an object scope, the events follow that range as before. Origin: D-117 (no whole-data scans; the signal changes of the events line read a signal's whole recording without a scope).

#### Scenario: Large data ref in full mode
- **WHEN** a full-mode test server with a recording adapter runs with the bound below testcar's row count and no scope, its catalog loads, and `/api/events?dataRef=testcar` is sent
- **THEN** the prefetch sent no `events` or `stateChanges` call for testcar, and the request answers 422 `too_wide`
- **Evidence:** `apps/server/test/scanBound.http.test.ts` › "skips the events of a data ref over the bound"
