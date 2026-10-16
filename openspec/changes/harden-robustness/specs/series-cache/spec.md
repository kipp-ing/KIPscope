## ADDED Requirements

### Requirement: Long views use tiles
Views and overviews whose span exceeds 2^53 ns (~104 days) SHALL load through the tile cache like shorter ones, as long as their tiles lie within the time bounds; only views outside the bounds SHALL fall back to an exact, uncached request. Origin: necessary consequence of D-043 (overview per signal's extent) and series-query "Exact times for any span": today a signal recorded over more than 104 days gets no overview and no placeholder. Design H1.

#### Scenario: A 200-day view is tileable
- **WHEN** `tileable` is asked for the tiles of a 200-day view at its level, and for a range whose last tile ends after `TIME_MAX`
- **THEN** it returns true and false
- **Evidence:** `apps/web/test/tiles.test.ts` › "views longer than 2^53 ns are tileable within the time bounds"

### Requirement: Malformed answers fail the load
A series answer whose times do not decode, whose kind is unknown or whose value arrays differ in length from its times SHALL fail that signal's load like a failed request (state `error`, legend `failed: …`), for tiled and exact loads alike; it SHALL NOT reach drawing. Origin: concept §10 („Fehler … müssen erkennbar bleiben"); necessary consequence: today the exact path stores the raw JSON and a bad answer blanks the app at draw time. Design H6.

#### Scenario: Exact view with a malformed answer
- **WHEN** an exact (non-tileable) view's fetch answers a raw result with 3 times and 2 values
- **THEN** the key's state is `error` with a message naming the malformed result, and `result` holds no part of that answer
- **Evidence:** `apps/web/test/loader.test.ts` › "fails an exact view whose answer is malformed"

#### Scenario: Tiled view with a malformed answer
- **WHEN** a tiled view's run answers with an offset `"abc"` in `t.dt`
- **THEN** the key's state is `error` and no tile of that run is stored
- **Evidence:** `apps/web/test/loader.test.ts` › "fails a tiled view whose answer is malformed"

## MODIFIED Requirements

### Requirement: Retry at once on recovery
A failed signal SHALL be retried at once when any `/api/series` request of the tab succeeds or the live channel opens again, but not sooner than 1 s after its last failure; such a retry SHALL NOT reset the backoff. A success of another request SHALL pull a signal forward only once per run of failures in a row; after that, until the signal completes, only the backoff, the live channel opening and the same request again retry it. Origin: D-042 (1) („at once when a request succeeds again or the live channel reconnects"). The 1 s floor: necessary consequence (else a signal that keeps failing is fetched after every other answer); value: design R3. Once per run: design H9, Jan's answer to Q1 (2026-10-16).

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

#### Scenario: A signal that keeps failing is pulled forward once
- **WHEN** signal A fails at F1, another request of the tab answers at F1 + 0.2 s, A's pulled retry fails at F2 = F1 + 1 s, and from then on other requests of the tab answer every 100 ms for 10 s while A keeps failing
- **THEN** A's fetches after F2 start only at the backoff times (F2 + 2 s, then 4 s after that failure), not after the other answers
- **Evidence:** `apps/web/test/loader.test.ts` › "pulls a failing signal forward once per run of failures"

#### Scenario: Reconnect pulls forward again
- **WHEN** signal A was already pulled forward once in its current run of failures, and the live channel opens 2 s after A's last failure
- **THEN** A's fetch starts at once
- **Evidence:** `apps/web/test/loader.test.ts` › "a live reconnect pulls a failing signal forward again"
