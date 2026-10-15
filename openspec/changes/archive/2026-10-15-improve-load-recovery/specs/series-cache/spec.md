## ADDED Requirements

### Requirement: Failed loads retry with backoff
A signal whose series load failed with a retryable error (no HTTP status, or status ≥ 500) SHALL be loaded again by itself after 1, 2, 4, 8, 16 s for the first five failures in a row and 30 s after each later one; a complete load SHALL reset this to 1 s. A 4xx failure SHALL NOT be retried by itself. Origin: D-042 (1) („retries by itself with backoff 1, 2, 4 … 30 s"); data fact: 502 `source_error` for ~5 min. 4xx: necessary consequence (refused again by series-query rules). Numbers: design R2.

#### Scenario: Backoff until the source is back
- **WHEN** a loader with the window options requests one signal whose fetch fails at once with HTTP 502 seven times and then answers
- **THEN** the fetches start at 0, 1, 3, 7, 15, 31 and 61 s, the eighth at 91 s, none in between, and after the eighth the state is `complete`
- **Evidence:** `apps/web/test/loader.test.ts` › "retries a failed load with backoff 1, 2, 4, 8, 16, 30 s"

#### Scenario: Success resets the backoff
- **WHEN** a signal failed twice (retried after 1 s, then waiting 2 s), its third fetch answers, and a later view of it fails
- **THEN** the retry of the later view starts 1 s after that failure
- **Evidence:** `apps/web/test/loader.test.ts` › "resets the backoff after a complete load"

#### Scenario: Error answers carry their status
- **WHEN** `/api/series` answers 502 with an `ApiError` body `source_error`, 502 with a non-JSON body, or 404 with `unknown_signal`
- **THEN** the fetch rejects with an error whose status is 502, 502 and 404, whose message is `source_error: …`, `http_502: …` and `unknown_signal: …`, and which counts as retryable, retryable and not retryable
- **Evidence:** `apps/web/test/api.test.ts` › "throws errors with HTTP status and code" (stubbed global `fetch`)

#### Scenario: Client errors wait for the user
- **WHEN** a signal's fetch fails with HTTP 404 `unknown_signal`
- **THEN** no further fetch starts within 120 s, and the state stays `error`
- **Evidence:** `apps/web/test/loader.test.ts` › "does not retry a 4xx failure by itself"

### Requirement: Retry at once on recovery
A failed signal SHALL be retried at once when any `/api/series` request of the tab succeeds or the live channel opens again, but not sooner than 1 s after its last failure; such a retry SHALL NOT reset the backoff. Origin: D-042 (1) („at once when a request succeeds again or the live channel reconnects"). The 1 s floor: necessary consequence (else a signal that keeps failing is fetched after every other answer); value: design R3.

#### Scenario: Another request succeeds
- **WHEN** signal A of window 1 has failed four times in a row (next retry due 8 s after the fourth failure) and 3 s after that failure a series request of window 2 on the same tab cache answers
- **THEN** A's fetch starts right after that answer, not 8 s after its failure
- **Evidence:** `apps/web/test/loader.test.ts` › "retries at once when another request of the tab succeeds"

#### Scenario: Floor of 1 s
- **WHEN** signal A failed for the third time at time F (next retry due at F + 4 s) and another request of the tab answers at F + 0.5 s
- **THEN** A's next fetch starts at F + 1 s
- **Evidence:** `apps/web/test/loader.test.ts` › "retries at once on recovery, not sooner than 1 s after the failure"

#### Scenario: Live channel reconnects
- **WHEN** signal A has failed three times in a row and the tab cache is told that the live channel opened
- **THEN** A's fetch starts at once (at least 1 s after its last failure)
- **Evidence:** `apps/web/test/loader.test.ts` › "retries at once when the cache reports a recovery"; command `grep -n "tabSeriesCache().recover()" apps/web/src/live.ts` prints one line, inside the `onopen` handler

### Requirement: Same request retries a failed load
When a failed signal's request comes again unchanged, the window SHALL retry it at once (not sooner than 1 s after the failure), also after a 4xx; for a loading or complete signal nothing SHALL be fetched. Origin: D-042 (1) („setting the same range again also retries"); data fact: after the tunnel was back, a tab with an unchanged range kept its errors (D-042 „Why").

#### Scenario: Same range again
- **WHEN** a signal has failed three times in a row with HTTP 502 (next retry due 4 s later) and 2 s later the loader gets an update with the identical request in a new array
- **THEN** its fetch starts in that update (or at the end of a running throttle interval)
- **Evidence:** `apps/web/test/loader.test.ts` › "retries a failed load at once when the same request comes again"

#### Scenario: Same range after a client error
- **WHEN** a signal failed with HTTP 404 and 2 s later the loader gets the identical request again
- **THEN** its fetch starts in that update
- **Evidence:** `apps/web/test/loader.test.ts` › "does not retry a 4xx failure by itself" (second half)

#### Scenario: No refetch of a complete request
- **WHEN** a signal's request is complete and the identical request comes again
- **THEN** no fetch starts and `onChange` is not called
- **Evidence:** `apps/web/test/loader.test.ts` › "does not refetch an unchanged request and aborts removed signals" (existing, stays green)

### Requirement: Retries stop when the view is no longer wanted
A scheduled or running retry SHALL be cancelled when its signal leaves the window, its view changes (the new view loads as usual and a failure of it continues the backoff), or the window closes; a retry SHALL always load the current view. Origin: D-042 (1); necessary consequence of "Stale responses only fill the cache".

#### Scenario: Signal removed while waiting
- **WHEN** a signal failed and is removed from the loader before its retry is due
- **THEN** no fetch starts within the next 60 s
- **Evidence:** `apps/web/test/loader.test.ts` › "stops retrying when the signal is removed, the view changes or the loader is disposed"

#### Scenario: View changed while waiting
- **WHEN** a signal's view A failed and the loader gets view B for it before A's retry is due
- **THEN** B is fetched at once, A is never fetched again, and when B fails its retry comes after the next delay of the sequence (2 s after a first failure of A)
- **Evidence:** same test

#### Scenario: Loader disposed
- **WHEN** a loader with a failed signal is disposed
- **THEN** no fetch starts within the next 60 s
- **Evidence:** same test

### Requirement: Retries share requests
A retry SHALL load like a visible load of the window: join a request in flight for the same tiles, complete from the tab cache without a request when the tiles meanwhile arrived, and pass the window's load throttle. Origin: D-042 (1); necessary consequence of "One cache for all windows" and "Loads during a gesture are throttled".

#### Scenario: Two windows retry with one request
- **WHEN** two loaders on one tab cache show the same signal and view, their shared request fails, and both retries come due at the same time
- **THEN** one fetch starts for them, and both states become `complete` from its answer
- **Evidence:** `apps/web/test/loader.test.ts` › "two windows retry with one request"

#### Scenario: Retry served by the cache
- **WHEN** a signal's view failed in window 1 and window 2 loads the same tiles before window 1's retry is due
- **THEN** window 1 becomes `complete` without a fetch of its own, at the recovery trigger of window 2's answer (1 s after its failure at the earliest)
- **Evidence:** `apps/web/test/loader.test.ts` › "a retry completes from the cache without a request"

### Requirement: Prefetch failures dropped, overview restarted
A failed prefetch request SHALL NOT be retried. A failed overview SHALL be started again after the signal's next complete view and not otherwise. Origin: necessary consequences of "Prefetch when the view rests" (prefetch draws nothing) and D-042 (2) (without the restart a window gets no placeholders after an outage until the signal is added again).

#### Scenario: Prefetch failure dropped
- **WHEN** a loader with the window options rests after its view completed and every prefetch request fails with HTTP 502
- **THEN** none of those prefetch tiles is fetched again within the next 120 s while the view stays the same
- **Evidence:** `apps/web/test/loader.test.ts` › "does not retry a failed prefetch"

#### Scenario: Overview after the outage
- **WHEN** a signal's first view and its overview (extent request) fail, and its retry later completes
- **THEN** the extent is requested again right after that complete view, and once its tiles arrive placeholders come from it again
- **Evidence:** `apps/web/test/loader.test.ts` › "starts a failed overview again after a complete view"

## MODIFIED Requirements

### Requirement: Render acknowledgement unchanged
A window SHALL count as settled when every tile of each signal's committed view is present or its request failed and the drawn data is that view's own: a shown preview range that differs from the committed range, a placeholder, or a pending throttled load SHALL NOT count as settled. A fully cached committed view SHALL be settled at once. A failed signal SHALL count as settled while it keeps data of another view and while its retry is only scheduled; while a retry loads, the window SHALL NOT be settled, and when the retry ends the window SHALL acknowledge the same revision again (`complete` if it succeeded, `error` if it failed). Origin: necessary consequence of D-005/D-011 (`--wait` reports the rendered state) and series-cache "Loaded series data stays in the tab"; placeholders and previews are not the committed revision's data (D-040 (1), (2)). Retries: D-042 (1), (2), with the acknowledgement behaviour as a necessary consequence (a failure stays reportable to `--wait`, and a recovered window must not keep reporting its old error).

#### Scenario: Cached view settles at once
- **WHEN** a window's new view is fully cached
- **THEN** the loader is settled in the same update, with no pending request
- **Evidence:** `apps/web/test/loader.test.ts` › "is settled only when every current request has finished" (kept) and "draws a previous view again without a request" (settled right after the update); UI check with the CLI: on a window `<w>` zoomed from its overview into one hour, `letsview --wait window range <w> <the overview's from> <the overview's to>` exits 0 and reports `complete`

#### Scenario: Placeholder does not settle
- **WHEN** a loader shows a placeholder for its current request
- **THEN** `settled` is false until the sharp data has arrived, and true right after
- **Evidence:** `apps/web/test/loader.test.ts` › "shows a placeholder at once and sharp data after the response" (checks `settled` before and after); UI check with the CLI: `letsview --wait window range <w>` to a range not loaded before exits 0 with `complete`

#### Scenario: Acknowledged on the committed range
- **WHEN** a window previews a range during a gesture
- **THEN** its acknowledgement is computed from the requests of the committed range, not the shown one
- **Evidence:** command `grep -n "loader.settled(committedRequests)" apps/web/src/chart/TimeseriesWindow.tsx` prints one line

#### Scenario: Settled while failed, not while a retry loads
- **WHEN** a signal's load fails, then its retry starts, then the retry answers
- **THEN** `settled` is true after the failure (state `error`), false while the retry loads, and true again after the answer (state `complete`, no `error`)
- **Evidence:** `apps/web/test/loader.test.ts` › "is settled while failed, not while a retry loads"; command `grep -n "JSON.stringify(\[revision, errors\])" apps/web/src/App.tsx` prints one line (the acknowledgement repeats a revision whose errors changed, design R5); lead's manual check (design R8): with the tunnel down, `letsview --wait window range <w> <its current from> <its current to>` reports render status `error`; after the tunnel is back and without any command, `GET /api/render-status` shows this browser's last acknowledgement for the same revision as `complete` within 35 s
