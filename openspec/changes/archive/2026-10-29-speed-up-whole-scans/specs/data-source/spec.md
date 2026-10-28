## MODIFIED Requirements

### Requirement: ClickHouse answers as before
The ClickHouse adapter SHALL implement every optional method natively except `series`, which it takes from the server's fallback. It SHALL send the same query texts as before for every existing path (density, gaps, events, series, values, catalog). The server may add calls on these paths, but only calls of methods that already exist: the scan bound's `refCount` (scope "Scan bound") and the calendar's per-day `refBuckets`. `raw` without a limit and `refBuckets` without row times SHALL be unchanged. The source contract (`SourceAdapter`) SHALL be unchanged, and ADX and the fallbacks need no change. Origin: the lead's brief („Keep ClickHouse behaviour and performance unchanged"); D-007; D-074 („ClickHouse keeps all 15 methods and its queries unchanged"); `series` from the fallback: speed-up-adx design A2; added calls: D-117, D-118.

#### Scenario: Existing suite
- **WHEN** `pnpm --filter @kipscope/server test` runs against the seeded test DB
- **THEN** every existing test passes with unchanged expected values, except where this change's delta specs name new call counts or answers
- **Evidence:** the command's output

#### Scenario: Density query unchanged
- **WHEN** the density of `drivecar` is computed with a client that records query texts
- **THEN** after the scan bound's `SELECT count()` with only the data-ref filter, its two queries are the `refExtent` and the counts-only `refBuckets` query of today (no `min`/`max` of the time column)
- **Evidence:** `apps/server/test/density.http.test.ts` › "sends the counts-only bucket query"

#### Scenario: No native series on ClickHouse
- **WHEN** `nativeMethods` runs on the ClickHouse adapter
- **THEN** it lists `count`, `extent`, `refExtent`, `refCount`, `loggerGaps`, `firstTimes`, `stateChanges`, `computedSeries` and `events`, and not `series`
- **Evidence:** `apps/server/test/fallbacks.test.ts` › "takes series from the fallback on ClickHouse"

#### Scenario: No contract change
- **WHEN** `git diff 33383a7 -- apps/server/src/datasource.ts` (the commit before this change) runs at the end of the change
- **THEN** it prints nothing
- **Evidence:** the command's output
