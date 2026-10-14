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
