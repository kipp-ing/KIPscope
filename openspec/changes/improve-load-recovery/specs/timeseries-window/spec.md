## MODIFIED Requirements

### Requirement: Loading and error state
A window SHALL show per signal while its data is loading and when it failed, including the error message on failure; a complete load shows nothing (D-030 „the "complete" can go"). When a signal's load fails, the window SHALL keep drawing what it showed for that signal at that moment (its previous data or its placeholder) instead of clearing the curve. Its legend row SHALL show `failed: <message>`, also while a retry of the same view loads, until a load of the signal completes. The kept data SHALL be treated like data still loading: the live cursor and dragged cursor lines read their values from it, and the SNA share and the resolution badge describe it. Committed cursor readouts SHALL keep coming from `/api/value` with their own loading and failed state. Origin: concept §10 („Fehler … müssen erkennbar bleiben"); D-042 (2) („on a failed load the window keeps the last drawn data (or the overview placeholder) with the failure marker instead of an empty plot"). The readout behaviour is a necessary consequence of D-031 (readouts from the server) and D-034 (the live cursor reads the drawn curve).

#### Scenario: Query fails
- **WHEN** the query for one signal fails
- **THEN** the window marks that signal as failed and keeps showing the other signals
- **Evidence:** `apps/web/test/loader.test.ts` › "marks a failed signal and leaves the others alone" (existing, stays green)

#### Scenario: Failure keeps the drawn curve
- **WHEN** a signal's view A is complete, the loader gets view B, and B's fetch fails
- **THEN** the state is `error` with B's request, the error message, and A's result as `result`
- **Evidence:** `apps/web/test/loader.test.ts` › "keeps the shown result when a load fails"

#### Scenario: Failure keeps the placeholder
- **WHEN** a signal shows a placeholder for view B (overview loaded) and B's fetch fails
- **THEN** the state is `error` with the placeholder as `result` and `placeholder: true`
- **Evidence:** `apps/web/test/loader.test.ts` › "keeps the placeholder when a load fails"

#### Scenario: Legend text
- **WHEN** a signal's state is `error` with message M, or `loading` while a retry carries the last error M, or plain `loading`, or `complete`
- **THEN** its legend status text is `failed: M`, `failed: M`, `loading` and empty, in that order
- **Evidence:** `apps/web/test/loader.test.ts` › "names the legend status, failed while a retry loads"

#### Scenario: Tunnel drop on real data
- **WHEN** the UI shows a window with real data, the carserver tunnel is dropped, the window's view is changed to a range not loaded before, and the tunnel is restored
- **THEN** while it is down the window keeps a curve and its legend reads `failed: source_error …`; within 35 s of the tunnel coming back the curve for the new range is drawn and the legend status is empty, without any user action
- **Evidence:** lead's manual check (design R8), screenshots before and after
