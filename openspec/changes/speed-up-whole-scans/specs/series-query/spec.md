## MODIFIED Requirements

### Requirement: Query classes
Every source query SHALL run in one of the classes `interactive`, `metadata`, `background`, `preload`, `idle` (highest first):
- queries for an HTTP request and the catalog load run `interactive`
- the prefetches after a catalog load and the gap polls run `background`
- the calendar's vehicle-day counts run `idle` (range-picker "Calendar days counted at the lowest priority")
- a fallback's inner queries run in their caller's class

Origin: the ADX feedback item 7; D-078 („Background preloading must never delay interactive queries"); `metadata`: D-080 P1; `preload`: D-078 neighbours; `idle`: D-118 („the lowest priority class (below preload and background …)").

#### Scenario: Prefetch and polls run as background
- **WHEN** a stub adapter with only the required methods plus `events`, behind a queue of limit 4 and the server's fallbacks, records the class of every call it gets; its catalog (data ref `car`, 3 signals, one of them in a window and on the events line) loads; a `/api/series` request for that signal follows; and a gap poll runs 5 min later (fake timers)
- **THEN** every call caused by the density, gap info and events prefetch (including the `raw` calls of the `firstTimes` and `refBuckets` of the `loggerGaps` and `refExtent` fallbacks) and by the poll records `background`, every call of the series request and of the catalog load records `interactive`, and every day count of the calendar records `idle`
- **Evidence:** `apps/server/test/priority.test.ts` › "tags prefetches and polls as background and requests as interactive"

## ADDED Requirements

### Requirement: Series within the row budget
When the server answers `/api/series` through its `series` fallback (`count`, then `raw` or `buckets`), a `count` above the scan bound's rows (scope "Scan bound") SHALL answer 422 `too_wide` with that count. No `raw` or `buckets` call follows. The window SHALL show the signal's status as `too wide`, with the message as its tooltip, in the legend's status column without changing the column's width. An adapter with a native `series` (ADX) is bounded by its scope and the source's own limits. Origin: D-117 („a bound per query with a visible ‚too wide' answer"); concept §10; native `series`: data-source "Series in one call" (no extra round trip, speed-up-adx P2).

#### Scenario: Too many rows for one signal
- **WHEN** a stub adapter with only the required methods answers `count` 2,000 behind the server's fallbacks with the bound at 1,000 rows, and `/api/series` is sent for one of its signals
- **THEN** the answer is 422 `too_wide` with `rows` `"2000"` and `limit` `"1000"`, and the stub got no `raw` and no `buckets` call
- **Evidence:** `apps/server/test/scanBound.http.test.ts` › "refuses a series over the row budget"

#### Scenario: Status in the legend
- **WHEN** a timeseries window's loader gets 422 `too_wide` for one of its signals
- **THEN** that signal's status cell reads `too wide` with the message as its `title`, the other signals draw, and the window's render acknowledgement carries the error with the message
- **Evidence:** `apps/web/test/loader.test.ts` › "shows a too-wide series in the status column"

### Requirement: Value when its gap info is too wide
When the gap info that a `/api/value` needs ("Gap info within the scan bound" of data-gaps) is refused by the scan bound, the value SHALL answer 422 `too_wide` with that message, never a value. The cursor cell SHALL show `—` with the message as its tooltip. Origin: D-062 („never a value interpolated across" a gap): without gap info no value; concept §10.

#### Scenario: Value without gap info
- **WHEN** the full-mode test server runs with the bound below testcar's row count and no scope, and `/api/value?signal=testcar/Fast_100h.SIG_A&t=2026-10-01T01:30:00Z` is sent
- **THEN** it answers 422 `too_wide`, and the source got no `loggerGaps` call
- **Evidence:** `apps/server/test/scanBound.http.test.ts` › "answers too_wide for a value without bounded gap info"
