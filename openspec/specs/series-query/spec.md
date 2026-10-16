# series-query Specification

## Purpose
Fetches a signal's recorded data for a time range at a resolution that fits the display, so that long overviews stay small and detail views show unmodified raw measurements.

## Requirements

### Requirement: Read-only access
Series queries SHALL only read from the data source and SHALL NOT write, modify or delete source data, nor create additional rollups or persistent caches in it.

#### Scenario: Query leaves source untouched
- **WHEN** any series query runs
- **THEN** the data source contains exactly the same data as before

### Requirement: Resolution-aware request
A series query SHALL take a signal ID, a time range and a target bucket count (roughly the window's width in pixels), and SHALL return either aggregated buckets or raw points, whichever keeps the result at or below about the target count.

#### Scenario: Ten-hour overview
- **WHEN** a 10-hour range of a 5 ms signal (7.2 million points) is requested with a target of 2,000 buckets
- **THEN** the result contains at most 2,000 aggregated buckets

#### Scenario: Millisecond detail
- **WHEN** the range contains fewer raw points than the target count
- **THEN** the result contains the raw points

### Requirement: Aggregated buckets
Each aggregated bucket SHALL cover a contiguous time interval and report its start, end, the number of valid points and the number of SNA points inside it, and the arithmetic mean, minimum and maximum of the valid points only. A bucket whose points are all SNA SHALL report no mean, minimum or maximum. Buckets without any raw point SHALL be omitted, not filled.

#### Scenario: Empty bucket
- **WHEN** a bucket interval contains no raw point
- **THEN** no bucket is returned for that interval and no value is invented

#### Scenario: Bucket with some SNA points
- **WHEN** a bucket of `testcar/Sna_800h.SPEED` contains valid points and SNA points (511)
- **THEN** its count is the number of valid points, its SNA count the number of 511 points, and mean, minimum and maximum come from the valid points only (maximum below 511)
- **Evidence:** `apps/server/test/series.test.ts` › "aggregates only valid points and counts SNA per bucket"

#### Scenario: Bucket with only SNA points
- **WHEN** a bucket of `testcar/Sna_800h.SPEED` lies inside its 20 s SNA run
- **THEN** the bucket is returned with count 0, its SNA count, and no mean, minimum or maximum
- **Evidence:** `apps/server/test/series.test.ts` › "returns all-SNA buckets without mean, min and max"

#### Scenario: Real speed overview
- **WHEN** the full extent of `smart451/COMBI_412h.V_ANZ` (2026-10-11T12:34:24.824Z to 2026-10-13T13:17:33.220Z) is requested with target 2,000
- **THEN** no bucket reports a mean, minimum or maximum of 511, and the SNA counts sum to 4,411
- **Evidence:** command `curl -s 'localhost:7310/api/series?signal=smart451/COMBI_412h.V_ANZ&from=2026-10-11T12:34:24.824Z&to=2026-10-13T13:17:33.220Z&target=2000' | jq '([.max[]|select(.!=null)]|max), (.sna|add)'` prints `71` and `4411`

### Requirement: Raw points
Raw points SHALL be returned with their original timestamps and SHALL NOT be shifted onto a common sampling grid. Valid values SHALL be returned unmodified. An SNA point SHALL be returned at its timestamp marked as SNA and without a value.

#### Scenario: Irregular timestamps
- **WHEN** a signal has points at 0.000, 0.0051 and 0.0098 s
- **THEN** the result contains exactly those timestamps

#### Scenario: SNA point in a raw result
- **WHEN** raw points of `smart451/COMBI_412h.V_ANZ` are requested for 2026-10-13T09:56:59Z to 09:57:01Z (20 points, 3 of them stored as 511)
- **THEN** the result has 20 timestamps; the points at 09:56:59.837, 09:56:59.937 and 09:57:00.037 are marked SNA without value; the other 17 carry their value 0
- **Evidence:** `apps/server/test/series.test.ts` › "flags SNA raw points without value" (test DB: `Sna_800h.SPEED`); command `curl -s 'localhost:7310/api/series?signal=smart451/COMBI_412h.V_ANZ&from=2026-10-13T09:56:59Z&to=2026-10-13T09:57:01Z' | jq -c '.v'` prints 8 zeros, 3 `null`, 9 zeros

#### Scenario: Signed SNA point
- **WHEN** raw points of `testcar/Sna_800h.TEMP` (signed, SNA −128) are requested
- **THEN** the points stored as −128 are SNA and all others keep their values
- **Evidence:** `apps/server/test/series.test.ts` › "flags signed SNA points"

### Requirement: Edge neighbors
A raw-point result SHALL include, when they exist, the last point before the range and the first point after it, marked as outside the range. A neighbor that is an SNA point SHALL be returned marked as SNA without a value; the query SHALL NOT skip it to reach a valid point further away.

#### Scenario: No point inside a millisecond window
- **WHEN** a 1 ms range lies between two raw points of a signal
- **THEN** the result contains no in-range points and both neighbors, so a line or step can still be drawn

#### Scenario: Range at start of recording
- **WHEN** no point exists before the range
- **THEN** no leading neighbor is returned

#### Scenario: SNA neighbors
- **WHEN** a 1 ms range lies between two SNA points of `testcar/Sna_800h.SPEED` inside its SNA run
- **THEN** the result contains no in-range points and both neighbors, each marked SNA without value
- **Evidence:** `apps/server/test/series.test.ts` › "returns SNA edge neighbors as SNA"

### Requirement: Timestamp precision
Timestamps SHALL keep the source's original precision, down to nanoseconds, in query results and transport. No conversion SHALL round them.

#### Scenario: Millisecond source
- **WHEN** the source stores a point at 2026-10-13T09:12:00.253Z with millisecond precision
- **THEN** the client receives exactly that timestamp

#### Scenario: Nanosecond source
- **WHEN** a source stores a point at 2026-10-14T08:00:00.123456789Z with nanosecond precision
- **THEN** the client receives exactly that timestamp

### Requirement: Points without timestamp excluded
Source rows without a timestamp SHALL NOT be returned, counted or aggregated, since they cannot be placed on a time axis.

#### Scenario: Row with null timestamp
- **WHEN** a signal has rows whose timestamp is null
- **THEN** those rows appear in no raw result and in no bucket's count, mean, minimum or maximum

### Requirement: Signal extent
The server SHALL return the first and last timestamp of a signal's data, so a view can open on the range where data exists. A signal without timestamped data SHALL return no extent.

#### Scenario: Open a new window on a signal
- **WHEN** a caller requests the extent of a signal with data
- **THEN** it receives the timestamps of the signal's first and last point

### Requirement: Bounded database load
The server SHALL limit the number of concurrent queries it sends to a data source to a configured maximum and queue further queries.

#### Scenario: Fifty signals at once
- **WHEN** a window requests 50 signals at once and the limit is 4
- **THEN** at most 4 queries run against the source at any time and all 50 results eventually arrive

### Requirement: Query errors are reported
A failed or partially failed query SHALL return an error that identifies the signal and range, and SHALL NOT return a partial result as if it were complete.

#### Scenario: Database unavailable
- **WHEN** the data source cannot be reached
- **THEN** the query returns an error and no data

### Requirement: SNA matching
A stored value SHALL count as SNA when it lies within half a raw step (|factor| / 2) of one of the signal's SNA physical values, including both bounds. The tolerance absorbs float rounding; it SHALL NOT reach the neighbouring raw code, which is one full step away. Origin: D-012; proposal.

#### Scenario: Rounded SNA value
- **WHEN** `testcar/Sna_800h.RPM` (factor 0.5, SNA 8191.5) has a stored value 8191.500000001
- **THEN** that point is SNA
- **Evidence:** `apps/server/test/series.test.ts` › "matches SNA within half a raw step"

#### Scenario: Neighbouring raw code stays valid
- **WHEN** `testcar/Sna_800h.RPM` has a stored value 8191.0 (raw 16382)
- **THEN** that point is a valid value 8191
- **Evidence:** `apps/server/test/series.test.ts` › "matches SNA within half a raw step"

### Requirement: SNA needs the catalog
The server SHALL NOT answer a series query while the catalog has never been loaded, since it cannot know which values are SNA. It SHALL return an error instead. Origin: necessary consequence of D-010.

#### Scenario: Series before the first catalog load
- **WHEN** a series query arrives and the catalog has never loaded successfully
- **THEN** the server answers 503 with code `catalog_unavailable`, naming signal and range, and no data
- **Evidence:** `apps/server/test/series.http.test.ts` › "answers 503 for series before the catalog was ever loaded"

### Requirement: Time bounds in requests
Series requests SHALL accept only times between 1900-01-01T00:00:00Z and 2262-04-11T00:00:00Z inclusive and answer 400 `invalid_request` for a time outside, without querying the database. Origin: necessary consequence of the bug "window range 1036-01-11 … 3937-05-09" (times beyond int64 nanoseconds reached the API; design "Bug analysis").

#### Scenario: Series far beyond the data
- **WHEN** a client requests `/api/series?signal=smart451/CPC_448h.PTC_HV_Volt&from=-29473328485867940608&to=62083631947910636800`
- **THEN** the response is 400 with code `invalid_request` and a message naming the bounds
- **Evidence:** `apps/server/test/series.http.test.ts` › "rejects times outside the bounds with 400"; `curl -s -o /dev/null -w '%{http_code}' 'localhost:7310/api/series?signal=smart451/CPC_448h.PTC_HV_Volt&from=-29473328485867940608&to=62083631947910636800'` prints `400`

### Requirement: Value at a time
The server SHALL evaluate one signal at one time `t` in mode `line` (default) or `step`. It SHALL return the last point at or before `t`, the first point after `t`, and the value: raw if a point lies at `t`; else linear between valid neighbours (`line`) or the earlier valid value held (`step`). SNA and missing values follow "No invented value at a time". Origin: concept §6; D-023; design C4.

#### Scenario: Point, linear and hold
- **WHEN** `testcar/Sna_800h.SPEED` (point n at 2026-10-01T02:00:00Z + n × 100 ms, value n mod 100) is evaluated at 02:00:01Z, at 02:00:01.05Z in `line` and at 02:00:01.05Z in `step`
- **THEN** the values are `{kind: "raw", value: 10}`, `{kind: "interpolated", value: 10.5}` and `{kind: "held", value: 10}`, each with n = 10 as `at` and n = 11 as `next`
- **Evidence:** `apps/server/test/value.http.test.ts` › "evaluates SPEED at points, between points and in SNA runs"

#### Scenario: Real speed between two points
- **WHEN** a client requests `/api/value?signal=smart451/COMBI_412h.V_ANZ&t=2026-10-13T13:08:00.1435Z`
- **THEN** `jq -c .value` prints `{"kind":"interpolated","value":22.5}` (neighbours 23 at 13:08:00.093Z and 22 at 13:08:00.194Z)
- **Evidence:** the `curl` command against the dev server

### Requirement: No invented value at a time
The value at a time SHALL be SNA when the point at or before `t` is SNA. It SHALL be no value, with a reason, when there is no point at or before `t` (`before_first`), no point after `t` and none exactly at `t` (`after_last`), or in `line` mode the next point is SNA (`next_sna`). A signal without points SHALL give `no_data`. Origin: D-010, D-016 (null = SNA); concept §5 (no invented values); timeseries-window "No invented values" (the same rules as the drawn curve).

#### Scenario: SNA run and isolated valid point
- **WHEN** `testcar/Sna_800h.SPEED` is evaluated at 02:00:35Z (n = 350, SNA), at 02:00:35.05Z, at 02:01:00.1Z (n = 601, value 42 between the SNA points 600 and 602) and at 02:01:00.15Z
- **THEN** the values are `sna`, `sna`, `{kind: "raw", value: 42}` and, in `line`, `{kind: "none", reason: "next_sna"}`, in `step` `{kind: "held", value: 42}`
- **Evidence:** `apps/server/test/value.http.test.ts` › "evaluates SPEED at points, between points and in SNA runs"; `packages/shared/test/cursor.test.ts` › "returns SNA and no value without inventing one"

#### Scenario: Outside the data
- **WHEN** `testcar/Sna_800h.SPEED` is evaluated at 01:59:59Z and at 02:01:40Z (after the last point n = 999)
- **THEN** the values are `{kind: "none", reason: "before_first"}` and `{kind: "none", reason: "after_last"}`
- **Evidence:** `apps/server/test/value.http.test.ts` › "evaluates SPEED at points, between points and in SNA runs"

### Requirement: Value request errors
A value request SHALL answer like a series request: 400 `invalid_request` for a missing or out-of-bounds `t` or an unknown `mode`, 404 `unknown_signal`, 503 `catalog_unavailable` before the catalog was ever loaded, and 502 `source_error` when the source fails. It SHALL NOT query the database for a 400 or 404. Origin: necessary consequence of series-query "SNA needs the catalog" and "Time bounds in requests" (the same data, the same rules).

#### Scenario: Bad requests
- **WHEN** a client requests `/api/value?signal=smart451/COMBI_412h.V_ANZ&t=-29473328485867940608`, then the same with `t=2026-10-13T13:08:00Z&mode=markers`, then `signal=smart451/NOPE.X`
- **THEN** the answers are 400, 400 and 404
- **Evidence:** `apps/server/test/value.http.test.ts` › "answers errors like the series route"; `curl -s -o /dev/null -w '%{http_code}' 'localhost:7310/api/value?signal=smart451/COMBI_412h.V_ANZ&t=-29473328485867940608'` prints `400`

### Requirement: Reusable buckets for aligned requests
For `from` and `to` multiples of `w` and target `(to − from) / w + 1`, an aggregated result SHALL have width exactly `w` and complete buckets, so a bucket comes back identical from every such request. Origin: necessary consequence of D-037 (3) (the browser cache combines buckets of different requests). Today's behaviour; no server code change.

#### Scenario: Same bucket from two aligned requests
- **WHEN** `testcar/Sna_800h.SPEED` is requested for `from` 1790820011732893696 to `to` 1790820080452370432 with target 513, and for `from` 1790820046092632064 to the same `to` with target 257
- **THEN** both results are aggregated with width `134217728`, and the second result's buckets equal, field by field (start, count, SNA count, mean, minimum, maximum), the first result's buckets that start at or after 1790820046092632064
- **Evidence:** `apps/server/test/series.test.ts` › "returns identical buckets for aligned requests that share them"

#### Scenario: Real speed, aligned
- **WHEN** a client requests `/api/series?signal=smart451/COMBI_412h.V_ANZ&from=1791896364897009664&to=1791896914652823552&target=513`
- **THEN** `jq -r '.kind, .width'` prints `buckets` and `1073741824`
- **Evidence:** the `curl` command against the dev server

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
