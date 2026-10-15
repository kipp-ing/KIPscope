## ADDED Requirements

### Requirement: Exact times for any span
Series results SHALL carry every timestamp exactly for any range within the time bounds, whatever its span and the gaps between points. A time offset SHALL travel as a JSON number while its magnitude is at most 2^53 − 1 ns and as a decimal string beyond. Origin: concept §3 („Originalpräzision erhalten"); data fact: offsets are exact only to 2^53 ns ≈ 104 days, carserver holds 4.3 days today and grows. Design H1.

#### Scenario: Round trip over the full bounds
- **WHEN** the timestamps `TIME_MIN`, `TIME_MIN + 1`, 0, `TIME_MAX − 1` and `TIME_MAX` are encoded, sent through `JSON.stringify`/`JSON.parse` and decoded
- **THEN** the decoded list equals the input, the offsets up to 2^53 − 1 are numbers and the others decimal strings
- **Evidence:** `packages/shared/test/encoding.test.ts` › "round-trips times across the full time bounds"

#### Scenario: Malformed offsets refused
- **WHEN** `t` holds the offset `0.5`, `2^53` as a number, `"1e3"` or `"abc"`
- **THEN** decoding throws a `RangeError`
- **Evidence:** `packages/shared/test/encoding.test.ts` › "rejects malformed offsets"

#### Scenario: Raw points more than 104 days apart
- **WHEN** `/api/series` is requested for `spancar/Span_910h.FAR` from 1969-12-31T00:00:00Z to 2026-12-01T00:00:00Z with target 2,000
- **THEN** the answer is 200 with kind `raw` and the five seeded timestamps exactly, the last ones as string offsets
- **Evidence:** `apps/server/test/series.http.test.ts` › "answers raw points more than 104 days apart exactly"

### Requirement: Bucket width within int64
The bucket width SHALL be at most 2^62 ns, so the width and every bucket start fit in int64 for any range within the time bounds. Where the cap applies, a range SHALL touch at most 3 buckets. Origin: necessary consequence: ClickHouse rejected the width 1.14 × 10^19 of the full bounds at target 2 (above 2^63 − 1), and the route answered a retryable 502. Number: design H2.

#### Scenario: Width cap
- **WHEN** `bucketWidth(TIME_MIN, TIME_MAX, 2)` and `bucketWidth(0n, 10_000n, 2)` are computed
- **THEN** they are 2^62 and 10,000
- **Evidence:** `apps/server/test/series.test.ts` › "caps the bucket width at 2^62 ns"

#### Scenario: Full bounds over HTTP
- **WHEN** `/api/series` is requested for `testcar/Fast_100h.SIG_A` from `TIME_MIN` to `TIME_MAX` with target 2
- **THEN** the answer is 200 with kind `buckets`, width `4611686018427387904` and at most 3 buckets whose `count` plus `sna` sum to the number of points `/api/series` returns for the signal's extent at target 20,000
- **Evidence:** `apps/server/test/series.http.test.ts` › "answers the full time bounds"

### Requirement: Floor grid before 1970
Bucket starts SHALL lie on the grid `k × width` with `k = floor(t / width)` for timestamps before 1970 as after, so no bucket around 0 is wider than the others and server buckets match the web's tiles. Origin: necessary consequence of "Aggregated buckets" (contiguous intervals) and D-011 (D4, absolute grid); the time bounds start in 1900. Design H2.

#### Scenario: Buckets around the epoch
- **WHEN** the buckets of `spancar/Span_910h.FAR` from 1969-12-31T23:59:57Z to 1970-01-01T00:00:01Z are fetched from the source with width 1 s
- **THEN** their starts are −2 s, −1 s and 0 s (in ns), each with count 1
- **Evidence:** `apps/server/test/series.test.ts` › "buckets before 1970 on the floor grid"

### Requirement: Unanswerable requests are client errors
A series request that the server cannot answer because of its own computation on valid input SHALL get a 4xx answer, never a 5xx; 5xx SHALL stay reserved for failures of the source. Origin: necessary consequence of D-044 (5xx retry by themselves): a deterministic failure answered as 5xx is retried forever. Design H2.

#### Scenario: Computation error
- **WHEN** the series route's query throws a `RangeError` (stubbed source) for a valid request
- **THEN** the answer is 400 with code `invalid_request`
- **Evidence:** `apps/server/test/series.http.test.ts` › "answers 400, not 502, when the server cannot compute a result"

### Requirement: Extent request aborts with its client
When the client of `/api/extent` goes away before the answer, the server SHALL abort the extent query, like series queries. Origin: necessary consequence of D-011 (D7: aborts cancel server-side). Design H8.

#### Scenario: Client disconnects
- **WHEN** a client requests `/api/extent` against a source that waits until aborted, and closes the connection
- **THEN** the source's abort signal fires
- **Evidence:** `apps/server/test/series.abort.test.ts` › "aborts the extent query when the client disconnects"
