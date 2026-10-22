## MODIFIED Requirements

### Requirement: Source ping
`source.reachable` SHALL come from a ping of the source that bypasses the query queue, counts as failed after 2 s without answer, and is shared by concurrent meta requests (one ping in flight). A reachable result SHALL be reused, with its own `checkedAt`, by every meta request within 15 s after that ping ended; a failed ping SHALL NOT be reused, so the next meta request pings again. A failed ping SHALL give `reachable` false with the reason in `source.error`. Origin: concept §10 (a dropped tunnel stays visible, D-042); bypass: a ping queued behind slow series queries would report a false outage; 2 s per design F2; reuse: data fact (search tool team's report of 2026-10-22, P6: 1,590 `/api/meta` calls in 12 h, each pinging ADX), Jan's agreement to the lead's cut (2026-10-22, P6: „cache the /api/meta ping result for 15–30 s"), 15 s per speed-up-adx design A5.

#### Scenario: Source down
- **WHEN** the ping rejects with `connect ECONNREFUSED 127.0.0.1:18123`, and in a second app it never settles
- **THEN** the first answers `source.reachable` false with `source.error` naming `ECONNREFUSED`; the second answers within 3 s with `reachable` false and `error` `no answer within 2 s`
- **Evidence:** `apps/server/test/meta.http.test.ts` › "reports an unreachable source", "gives up the ping after 2 s"

#### Scenario: One ping for concurrent requests
- **WHEN** three `GET /api/meta` are sent at once while the ping takes 100 ms
- **THEN** the ping runs once and all three answer the same `checkedAt`
- **Evidence:** `apps/server/test/meta.http.test.ts` › "shares one ping between concurrent requests"

#### Scenario: Reachable ping reused for 15 s
- **WHEN** with fake timers and a ping that resolves at once, `GET /api/meta` is sent at 0 s, 14.9 s and 15.1 s
- **THEN** the ping ran twice; the first two answers carry the same `checkedAt`, the third a later one
- **Evidence:** `apps/server/test/meta.http.test.ts` › "reuses a reachable ping for 15 s"

#### Scenario: Failed ping not reused
- **WHEN** with fake timers and a ping that rejects, `GET /api/meta` is sent at 0 s and 1 s; then the ping resolves and a third request follows at 2 s
- **THEN** the ping ran three times; the first two answers are `reachable` false, the third `reachable` true
- **Evidence:** `apps/server/test/meta.http.test.ts` › "pings again after a failed ping"

#### Scenario: Ping beside a full queue
- **WHEN** a queued adapter on a queue of limit 1 runs a query that does not end, and its `ping` is called
- **THEN** the ping reaches the adapter at once and resolves while the query still runs
- **Evidence:** `apps/server/test/queue.test.ts` › "passes ping and info through without the queue"
