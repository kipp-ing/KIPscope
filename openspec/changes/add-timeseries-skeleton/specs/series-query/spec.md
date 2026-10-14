# Spec Delta

## Purpose

Fetches a signal's recorded data for a time range at a resolution that fits the display, so that long overviews stay small and detail views show unmodified raw measurements.

## ADDED Requirements

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
Each aggregated bucket SHALL cover a contiguous time interval and report its start, end, number of points, arithmetic mean, minimum and maximum of the raw points inside it. Buckets without raw points SHALL be omitted, not filled.

#### Scenario: Empty bucket
- **WHEN** a bucket interval contains no raw point
- **THEN** no bucket is returned for that interval and no value is invented

### Requirement: Raw points
Raw points SHALL be returned unmodified with their original timestamps and SHALL NOT be shifted onto a common sampling grid.

#### Scenario: Irregular timestamps
- **WHEN** a signal has points at 0.000, 0.0051 and 0.0098 s
- **THEN** the result contains exactly those timestamps

### Requirement: Edge neighbors
A raw-point result SHALL include, when they exist, the last point before the range and the first point after it, marked as outside the range.

#### Scenario: No point inside a millisecond window
- **WHEN** a 1 ms range lies between two raw points of a signal
- **THEN** the result contains no in-range points and both neighbors, so a line or step can still be drawn

#### Scenario: Range at start of recording
- **WHEN** no point exists before the range
- **THEN** no leading neighbor is returned

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
