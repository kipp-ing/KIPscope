## ADDED Requirements

### Requirement: Row metadata configuration
With `KIPSCOPE_SOURCE=adx` the server SHALL read `KIPSCOPE_COLUMN_UNIT` (unit column, an identifier; unset or empty: none) and `KIPSCOPE_SNA_TEXTS` (comma list, entries trimmed, empty entries and repeats dropped; none left: unset), matched exactly and case-sensitively. With ClickHouse either one set SHALL be a config error naming it. Unset, ADX queries SHALL be as before. Origin: D-100; ClickHouse refusal: necessary consequence (D-100 names only ADX), Q-1; exact match: design R1.

#### Scenario: Row metadata variables
- **WHEN** `loadConfig` runs with the ADX settings of "Defaults and checks" plus (a) `KIPSCOPE_COLUMN_UNIT=unit` and `KIPSCOPE_SNA_TEXTS= SNA, INVLD,,SNA `; (b) neither; (c) `KIPSCOPE_SNA_TEXTS= , `; (d) `KIPSCOPE_COLUMN_UNIT=bad name`; and with only `CLICKHOUSE_URL` set plus (e) `KIPSCOPE_COLUMN_UNIT=unit`, (f) `KIPSCOPE_SNA_TEXTS=SNA`
- **THEN** (a) gives mapping `unit` `unit` and `snaTexts` `["SNA", "INVLD"]`; (b) and (c) give a mapping without `unit` and `snaTexts` keys; (d) throws naming `KIPSCOPE_COLUMN_UNIT`; (e) throws `KIPSCOPE_COLUMN_UNIT: only with KIPSCOPE_SOURCE=adx`; (f) throws `KIPSCOPE_SNA_TEXTS: only with KIPSCOPE_SOURCE=adx`
- **Evidence:** `apps/server/test/config.test.ts` › "reads the ADX row metadata settings"

### Requirement: Units from the table
With a unit column the ADX signal list SHALL read `take_anyif(<unit>, isnotempty(<unit>))` per data ref and signal in the summarize it already runs, scoped and unscoped, in one query. A listed signal SHALL carry that unit when non-empty after trimming, else none. A configured unit column that does not exist SHALL fail the list. Origin: D-100 („in its existing summarize … per data ref"); issue #1 M3; unscoped: design R2, Q-2; missing column: necessary consequence (set explicitly).

#### Scenario: Unit in the signal list query
- **WHEN** an ADX adapter with `unit: "unit"` on a fake Kusto client that records each query runs `listSignals()` and `listSignals(scope)` with scope {conf-a, B + 5 s, B + 35 s}, and an adapter without `unit` runs the same
- **THEN** each call sends exactly one query; with the unit column its text holds `take_anyif(['unit'], isnotempty(['unit']))` inside the `summarize … by` that also computes the text flag, and the scoped text still filters by `sref`, `sfrom`, `sto` before any other operator; without the unit column no text holds `take_anyif`
- **Evidence:** `apps/server/test/adxQueries.test.ts` › "reads the unit in the signal list query"

#### Scenario: Units on the emulator
- **WHEN** the emulator is seeded and an adapter on table `KMeta` (design R7) with `unit: "unit"` and `snaTexts: ["SNA", "INVLD"]` runs `listSignals()` and `listSignals({meta-a, B + 5 s, B + 10 s})`, and one with `unit: "nope"` runs `listSignals()`
- **THEN** the first lists exactly `meta-a/Flag.ERR` (no unit), `meta-a/Gear.POS` (no unit), `meta-a/Spd.V` with unit `km/h`, `meta-b/Spd.V` with unit `mph`; the scoped call lists only `meta-a/Spd.V`, without unit (its unit rows lie before B + 5 s); the third rejects with an error naming `nope`
- **Evidence:** `apps/server/test/adx.test.ts` › "reads units from the table per data ref"

### Requirement: SNA by row text
With SNA texts, every ADX value query (`raw`, `before`, `after`, `series`, `buckets`, `stateChanges`) SHALL treat a row whose text is in the list as SNA, as a value in a DBC SNA range is treated (null value, bucket SNA count, left out of state changes, returned as SNA neighbour), together with the ranges, the list passed as a query parameter. Row-based methods SHALL count such rows as rows. Origin: D-100 („a gap, no label"); issue #1 M3 („like a DBC SNA value"); parameter and rows: design R3.

#### Scenario: SNA list as a parameter
- **WHEN** an ADX adapter with `snaTexts: ["SNA", "INVLD"]` on the recording fake runs `raw`, `before`, `after`, `series`, `buckets`, `stateChanges` and `listSignals`, and an adapter without `snaTexts` runs the same
- **THEN** with the list every query text holds `tostring(['text']) in (snat)` and its parameters hold `snat` of type `dynamic` with value `["SNA", "INVLD"]`; without the list no query text holds `snat` and no parameter set has it
- **Evidence:** `apps/server/test/adxQueries.test.ts` › "passes the SNA texts to every value query"

#### Scenario: Sentinels on the emulator
- **WHEN** on the seeded emulator an adapter on `KMeta` with `snaTexts: ["SNA", "INVLD"]` runs `raw(meta-a/Spd.V, B, B + 10 s)` with no SNA range and again with range [79.5, 80.5], `buckets(meta-a/Spd.V, B, B + 10 s, 5 s)`, `before(meta-a/Spd.V, B + 4.5 s)`, `after(meta-a/Spd.V, B + 6.5 s)`, `stateChanges(meta-a/Gear.POS, text, 100)`, and an adapter without `snaTexts` runs the first `raw`
- **THEN** the first `raw` gives values 0, 10, 20, null, null, 50, 60, null, 80, 90; with the range also n = 8 is null; the buckets are B (count 3, sna 2, mean 10, min 0, max 20) and B + 5 s (count 4, sna 1, mean 70, min 50, max 90); `before` gives B + 4 s with value null, `after` B + 7 s with value null; `stateChanges` gives exactly P at B, D at B + 10 s (prev P at B) and R at B + 30 s (prev D at B + 10 s); without `snaTexts` `raw` gives 255, 255 and 254 at n = 3, 4, 7
- **Evidence:** `apps/server/test/adx.test.ts` › "treats SNA texts as SNA in every value query"

#### Scenario: Native series with sentinels answers as the fallback does
- **WHEN** on the seeded emulator `querySeries` runs for `meta-a/Spd.V` over [B, B + 10 s) with target 100 (raw path) and target 4 (bucket path), once over `completeSource(adapter)` and once over `completeSource(coreOnly(adapter))`, the adapter on `KMeta` with `snaTexts: ["SNA", "INVLD"]`
- **THEN** both give the same `SeriesResult` serialized to JSON; the raw one has `v` `[0,10,20,null,null,50,60,null,80,90]`, the bucket one SNA counts summing to 3
- **Evidence:** `apps/server/test/adx.test.ts` › "answers KMeta series requests as the fallback does"

#### Scenario: Server on the emulator
- **WHEN** the lead starts a second server as in `docs/data-sources.md` "Try it on the emulator" plus `KIPSCOPE_TABLE=KMeta`, `KIPSCOPE_COLUMN_UNIT=unit`, `KIPSCOPE_SNA_TEXTS=SNA,INVLD`, then runs `curl -s localhost:7311/api/catalog | jq -c '[.items[] | [.id, .unit, .states]]'` and `curl -s 'localhost:7311/api/series?signal=meta-a/Spd.V&from=2026-10-05T00:00:00Z&to=2026-10-05T00:00:10Z' | jq -c '.v'`
- **THEN** the first prints `[["meta-a/Flag.ERR",null,null],["meta-a/Gear.POS",null,"text"],["meta-a/Spd.V","km/h",null],["meta-b/Spd.V","mph",null]]`, the second `[0,10,20,null,null,50,60,null,80,90]`
- **Evidence:** lead's check: the commands and their output

## MODIFIED Requirements

### Requirement: Missing events table or text column
A missing events table SHALL mean no events (`events` answers "no table"), and a missing text column SHALL mean no text signals; any other error SHALL fail. With SNA texts configured a missing text column SHALL fail the signal list with a message naming `KIPSCOPE_SNA_TEXTS`, `KIPSCOPE_COLUMN_TEXT` and the column; with only a unit column configured a missing text column SHALL still mean no text signals, with the units read. Origin: events "Events source"; ClickHouse does the same (design E4 of `add-events`); SNA texts: necessary consequence (every value query would fail on the missing column, design R2).

#### Scenario: Missing table and column
- **WHEN** the ADX adapter runs on the emulator with `KIPSCOPE_EVENTS_TABLE=nope`, and with `KIPSCOPE_COLUMN_TEXT=nope`
- **THEN** `events(conf-a, 100)` answers "no table" and `listSignals` answers the 8 signals all with `text` false
- **Evidence:** `apps/server/test/adx.test.ts` › "treats a missing events table and text column as none"

#### Scenario: Missing text column with row metadata
- **WHEN** on the emulator an adapter on `KMeta` with `text: "nope"` runs `listSignals()` once with `snaTexts: ["SNA"]` and once with only `unit: "unit"`
- **THEN** the first rejects with `KIPSCOPE_SNA_TEXTS needs the text column 'nope' (KIPSCOPE_COLUMN_TEXT), which does not exist`; the second lists the 4 `KMeta` signals, none with `text`, `meta-a/Spd.V` with unit `km/h` and `meta-b/Spd.V` with `mph`
- **Evidence:** `apps/server/test/adx.test.ts` › "treats a missing text column with row metadata"; the same two cases on the recording fake answering SEM0100: `apps/server/test/adxQueries.test.ts` › "falls back without the text column"

### Requirement: Kusto emulator for tests
`docker-compose.yml` SHALL hold the Kusto emulator under the profile `adx` (loopback port 8125, pinned image, volume), so `docker compose up -d` still starts only ClickHouse. `seed:adx` SHALL put the conformance fixture into database `kipscope_test` (default layout), and the row metadata table `KMeta` of design R7 next to it, and refuse a non-loopback `TEST_ADX_URL`; `test:adx` SHALL fail with one message naming both commands when the emulator is missing or unseeded. Origin: Jan (2026-10-17) „Not yet, emulate"; A-3 (a); D-007; `KMeta`: necessary consequence (units and sentinels need rows the conformance fixture does not hold, and changing that fixture would change the ClickHouse seed).

#### Scenario: Not started
- **WHEN** `pnpm --filter @kipscope/server test:adx` runs with no emulator on 8125
- **THEN** it fails once with `Kusto emulator at http://127.0.0.1:8125 is not reachable or not seeded: run \`docker compose --profile adx up -d\` and \`pnpm --filter @kipscope/server seed:adx\``
- **Evidence:** the command's output (tester, emulator stopped)

#### Scenario: Seed guard
- **WHEN** `seed:adx` runs with `TEST_ADX_URL=https://help.kusto.windows.net`
- **THEN** it exits non-zero before sending anything, saying it seeds only a loopback emulator
- **Evidence:** the command's output

#### Scenario: Default test run unchanged
- **WHEN** `docker compose up -d` runs (no profile), then `pnpm test`
- **THEN** only `clickhouse-test` starts, and `pnpm test` passes without the emulator (the ADX conformance run is not part of it)
- **Evidence:** `docker compose ps --format '{{.Service}}'` prints `clickhouse-test` only; the test output

#### Scenario: Row metadata table seeded
- **WHEN** `pnpm --filter @kipscope/server seed:adx` runs against the emulator
- **THEN** its spot checks print `ok` for `KMeta | count` → `22` and `KMeta | where text in ('SNA','INVLD') | count` → `5`, next to the existing checks, which are unchanged
- **Evidence:** the command's output
