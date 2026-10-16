## ADDED Requirements

### Requirement: Density of a recording
`GET /api/density?dataRef=<ref>` SHALL answer the rows with a timestamp of all the ref's signals per bucket over its whole extent: `first`, `last` (decimal ns), `width` ("Bucket widths"), `start` (`first` floored to a multiple of `width`, also before 1970) and `counts` from `start` to the bucket holding `last`, empty ones 0 (design T6). Origin: D-055 („data density over the whole recording"); a data ref is one recording (`smart451`).

#### Scenario: Ten hours of test data
- **WHEN** the server runs on the test DB and `GET /api/density?dataRef=testcar` is sent
- **THEN** 200 with `first` 2026-10-01T00:00:00Z and `last` 2026-10-01T10:00:00Z in ns, `width` `"600000000000"` (10 min; 5 min would need 121 buckets), `start` equal to `first`, 61 `counts`, their sum equal to `SELECT count() FROM sdlog.signals WHERE vehicle = 'testcar' AND utc IS NOT NULL`, and `counts[0]` equal to the same count for [00:00, 00:10)
- **Evidence:** `apps/server/test/density.http.test.ts` › "counts testcar rows in 10 min buckets"

#### Scenario: Short and pre-1970 recordings
- **WHEN** `GET /api/density` is sent for `othercar` (10 points 5 ms apart) and for `spancar` (5 points from 1969-12-31T23:59:58.5Z to 2026-10-01T00:00:00Z)
- **THEN** `othercar` has `width` `"1000000"` (1 ms) and 46 counts, ten of them 1 and the rest 0; `spancar` has `width` 180 d in ns, `start` `"-15552000000000000"`, 117 counts with 2 at index 0, 1 at index 1, 1 at index 114, 1 at index 116 and 0 elsewhere
- **Evidence:** `apps/server/test/density.http.test.ts` › "picks the width for short and pre-1970 extents"

### Requirement: Density errors
A missing or empty `dataRef` SHALL answer 400 `invalid_request`; a data ref the loaded catalog does not know 404 `unknown_data_ref`; one without rows 404 `no_data`; a source failure 502 `source_error`. The route SHALL pass the `server-access` guard like every route. Origin: necessary consequence; codes as `/api/extent` (`series-query`).

#### Scenario: Errors
- **WHEN** `/api/density` is sent without `dataRef`, with `dataRef=nocar` after the catalog loaded, and with `dataRef=testcar` while the source is unreachable
- **THEN** 400 `invalid_request`, 404 `unknown_data_ref`, and 502 `source_error`
- **Evidence:** `apps/server/test/density.http.test.ts` › "answers 400, 404 and 502"

### Requirement: Bucket widths
The bucket width SHALL be the smallest of 1, 2, 5, 10, 20, 50, 100, 200, 500 ms; 1, 2, 5, 10, 15, 30 s; 1, 2, 5, 10, 15, 30 min; 1, 2, 3, 6, 12 h; 1, 2, 7, 14, 30, 90, 180 d; 1, 2, 5, 10, 20, 50, 100 × 365 d with `floor(last / w) − floor(first / w) + 1 ≤ 120`. Origin: necessary consequence of a label `1 bar = <width>` that reads as a round duration; 120: design T6; 100 × 365 d is the widest that fits a signed 64-bit ns value and still covers every allowed time.

#### Scenario: Width choice
- **WHEN** `densityWidth(first, last)` gets 0 and 0; 0 and 36,000 s; 0 and 35,999.999 s; −1.5 s and 2026-10-01T00:00:00Z; 1900-01-01 and 2262-04-11
- **THEN** 1 ms; 10 min; 5 min; 180 d; 5 × 365 d
- **Evidence:** `packages/shared/test/time.test.ts` › "picks the smallest round density width for at most 120 buckets"

### Requirement: Density cached
The server SHALL compute a data ref's density at most once per catalog load: concurrent requests share one computation, a failed one is not cached, and a catalog reload makes the next request compute it again. After each successful catalog load the server SHALL start the computation for every data ref of the catalog without a request, one ref after another. Origin: necessary consequence of carserver's 2 GB RAM (D-007) and of a strip shown on every page load; prefetch: D-055 Q4.

#### Scenario: Cache
- **WHEN** a test source counts its queries, three `/api/density?dataRef=testcar` requests arrive at once, then one more, then the catalog is refreshed and one more arrives; separately the first computation fails and a second request follows
- **THEN** the first four requests cause two source queries in all and get the same body; after the refresh two more; after the failure the second request queries again
- **Evidence:** `apps/server/test/density.test.ts` › "computes once per catalog load, shares and does not cache failures"

#### Scenario: Prefetch
- **WHEN** a test source counts its queries and records their data refs, the catalog loads with data refs `testcar` and `othercar` and no request is sent; then `/api/density?dataRef=testcar` is sent; separately the prefetch of `testcar` fails and a request for `testcar` follows
- **THEN** after the load the source gets the density queries of both refs without a request, the second ref's only after the first ref's finished; the later request causes no further source query and gets the prefetched body; after the failed prefetch the request queries again
- **Evidence:** `apps/server/test/density.http.test.ts` › "computes after the catalog load without a request, and a request does not recompute"

### Requirement: Density queries cheap
A density computation SHALL run through the query queue as two queries that read only the data-ref and time columns, the second grouping into at most 120 buckets, with nothing sorted per row (design T7). Origin: necessary consequence of carserver's 2 GB RAM (D-007); queue: `series-query` concurrency.

#### Scenario: Cost on carserver
- **WHEN** the dev server runs against carserver and `curl -s -o /dev/null -w '%{time_total}\n' 'localhost:7310/api/density?dataRef=smart451'` runs twice
- **THEN** both answer 200; goal, measured and reported but not pass/fail: the first ≤ 5 s, the second ≤ 0.1 s
- **Evidence:** the command (both times)

### Requirement: Time strip
Below the option bar, sticking with it, the page SHALL show the time strip for the data ref of the bar target's first signal, else of the first signal in any window: `TIME`, the target's range as in its header, and at the right `<shown> of <recorded> recorded · 1 bar = <width>`, spans in the largest of y (365 d), d, h, min, s, ms they reach, one decimal at most, no `.0`. Clicking does nothing. Origin: D-055 (time strip on; mock label).

#### Scenario: Strip on real data
- **WHEN** the six-window setup is shown on smart451 at 1440×900 and window 1 is zoomed from its full extent to a 20 min range
- **THEN** the strip shows `TIME`, window 1's header range and `… recorded · 1 bar = …`; its bars are grey where smart451 has data; after the zoom only the bars overlapping those 20 min are in `rgb(2, 132, 199)` (one or a few), the label's left part equals the new header range, and the strip is ≤ 56 px tall in both states
- **Evidence:** UI check on smart451 at 1440×900 (screenshot before and after the zoom, strip height)

### Requirement: Time strip bars
The strip SHALL draw one bar per density bucket across its width, 2 px apart, at most 24 px high: a bucket with rows at least 3 px and in proportion to the largest count above that, an empty bucket 1 px; bars in slate-300, those overlapping the shown range (half-open) in the accent. Origin: D-055 (bars grey where data exists, the shown range in the accent); 24 px and the 3 px floor: design T8 and its numbers (the mock's 30 px cost plot share).

#### Scenario: Bars and label
- **WHEN** `stripBars` gets counts `[0, 10, 5, 0, 1]`, start 0, width 10 s, and the shown range [12 s, 31 s); and `stripLabel` gets that range, first 0 and last 6 d, width 3 h
- **THEN** heights `[1, 24, 12, 1, 3]` and shown `[false, true, true, true, false]`; the label reads `19 s of 6 d recorded · 1 bar = 3 h`; `formatSpan` gives `20 min`, `2.5 h`, `45 ms`, `5 y`
- **Evidence:** `apps/web/test/strip.test.ts` › "sizes and marks the bars", "labels the shown and recorded spans"

### Requirement: Time strip states
Without a signal the strip SHALL show `No signal shown`; while loading `Loading recording…`; after a failure `Recording unavailable`, retrying every 30 s; without a timeseries window no range and no accent bars. The strip SHALL be at most 56 px tall, the same in every state, and SHALL keep the plot share of `workspace-layout` "Screen use". Origin: necessary consequence (the strip must not move windows or hide data); 30 s: the load retry cap of D-042; 56 px: design T8.

#### Scenario: Strip states
- **WHEN** the workspace has no window; then only a values window with one signal; then the source is unreachable at page load
- **THEN** the strip shows `TIME` and `No signal shown`; then the bars and `<recorded> recorded · 1 bar = …` without a range and without accent bars; then `Recording unavailable` in the muted colour, and the bars appear without a reload within 30 s after the source is back; the strip's height is the same in all three states (±0.5 px) and no window moves when it changes
- **Evidence:** UI check (screenshot per state, strip heights); `apps/web/test/strip.test.ts` › "takes the data ref of the target window, else of any window"

#### Scenario: Screen use with the strip
- **WHEN** the six-window setup is shown at 1000×557 with the sidebar open and the strip loaded
- **THEN** the plot share from design M1's snippet is at least 30 % (`workspace-layout` "Screen use")
- **Evidence:** UI check on smart451 at 1000×557 (snippet output, screenshot)
