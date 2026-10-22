## ADDED Requirements

### Requirement: Query limit per source kind
Without `KIPSCOPE_QUERY_CONCURRENCY` the query limit SHALL be 8 for an ADX source and 4 for a ClickHouse source; a set `KIPSCOPE_QUERY_CONCURRENCY` SHALL win for either kind. One slot stays kept for `interactive` queries ("A slot kept for interactive queries"). Origin: data fact (search tool team's report of 2026-10-22, P5: 6 requests in flight, 4 running; most of the `/api/series` p90 of 8.9 s is queue wait; on ADX latency dominates, not throughput); Jan's agreement to the lead's cut (2026-10-22, P5: „ADX default higher (8–12, pick one), ClickHouse stays 4; KIPSCOPE_QUERY_CONCURRENCY env override still wins"); 8 per design A4. Supersedes D-011 (D7, „at most 4 concurrent DB queries") for ADX only, as Jan agreed.

#### Scenario: Defaults and override
- **WHEN** `loadConfig` runs with `KIPSCOPE_SOURCE=adx` plus cluster and database; with only `CLICKHOUSE_URL`; with `KIPSCOPE_SOURCE=adx`, cluster, database and `KIPSCOPE_QUERY_CONCURRENCY=3`; and with `CLICKHOUSE_URL` and `KIPSCOPE_QUERY_CONCURRENCY=6`
- **THEN** `queryConcurrency` is 8, 4, 3 and 6
- **Evidence:** `apps/server/test/config.test.ts` › "defaults the query limit per source kind"

#### Scenario: Queue of the ADX default
- **WHEN** a queue of limit 8 gets 20 `interactive` tasks that each run until released, then 20 `background` tasks
- **THEN** 8 interactive tasks run at once; after all interactive tasks have ended, 7 background tasks run at once
- **Evidence:** `apps/server/test/queue.test.ts` › "runs eight at once with the ADX default"
