# Design

## Context

Source: D-100 (2026-10-22), quoted in proposal.md; origin text: issue #1, last comment, section "M3 — Units and SNA from the table". M1 and M2 of that comment are out of scope.

Today (read before writing this design):

- `AdxSource.listSignals` (`apps/server/src/adx.ts`) runs one `summarize n_ = countif(isnotempty(<text>)) by <dataref>, <signal>`, scoped or not (the same text; `scoped()` prefixes the filters). On SEM0100 for the text column it falls back to `distinct <dataref>, <signal>` (no text signals).
- SNA lives in `SeriesRef.sna` (closed value ranges from the DBC, `catalog.snaRanges(id)`). The module function `isSna(ref)` is used by `pointProjection` (raw, before, after), `series` (points and the bucket branch's `m_` count), `buckets` and `stateChanges` (`where not(...)`). Row-based methods (`refBuckets`, `refCount`, `loggerGaps`, `extent`, the `firstTimes` fallback) count every row, SNA or not; the gap logic (data-gaps) never looks at SNA. A state name exists only for a point with a non-null value (`textLabel` in `apps/server/src/series.ts`, `tiles.ts:138` in the web), so a null value already means "no label".
- The catalog (`apps/server/src/catalog.ts`) builds one entry per listed (data ref, name); DBC and diag metadata are looked up by name. `withStates` marks `states: "text"` from the listed `text` flag.
- `KIPSCOPE_COLUMN_TEXT` exists for both adapters (`config.ts`, `TableMapping.text`). ClickHouse's `listSignals` has two query paths (unscoped: two `SELECT DISTINCT`; scoped: one `GROUP BY`).
- The hover card's source line (`formatSource`, `apps/web/src/explorer/format.ts`) reads `<dataRef> · no DBC entry` for a signal without `dbc` and `diag`.

## Goals / Non-goals

Goals: units and sentinels from the ADX table with no extra query and no change when the variables are unset. Non-goals: see proposal.md.

## Decisions

### R1 Configuration (ADX only)

- `KIPSCOPE_COLUMN_UNIT`: unset or empty: no unit column. Otherwise an identifier (the existing `IDENTIFIER` check of `identifier()`), stored as `TableMapping.unit`.
- `KIPSCOPE_SNA_TEXTS`: split at `,`, each entry trimmed, empty entries dropped, duplicates dropped (first occurrence kept, order kept). An empty result means unset. Stored as `TableMapping.snaTexts` (absent when unset). Entries are matched exactly and case-sensitively against the row text (KQL `in`, not `in~`): `SNA` does not match `sna` or ` SNA`. Why exact: the list names sentinels the table writes verbatim; a fuzzy match could swallow a real state name.
- With `KIPSCOPE_SOURCE=clickhouse` (or unset) either variable set to a non-empty value throws `KIPSCOPE_COLUMN_UNIT: only with KIPSCOPE_SOURCE=adx` (resp. `KIPSCOPE_SNA_TEXTS: …`). Why: D-100 names the ADX source; a variable that is read but ignored is worse than a refusal (Q-1).

### R2 Unit in the signal list (one query, scoped and unscoped)

The scoped and the unscoped list share one query text today; both get the unit (Q-2). Pinned KQL (`R` data-ref column, `S` signal column, `X` text column, `U` unit column, all through `q()`; brackets mark the parts present only when configured):

```
<src> | summarize n_ = countif(isnotempty(X)[ and not(tostring(X) in (snat))])[, u_ = take_anyif(U, isnotempty(U))] by R, S
| project R, S, x_ = n_ > 0[, u_ = tostring(u_)] | order by R asc, S asc
```

On SEM0100 naming the text column:

- `snaTexts` set: reject with `Error("KIPSCOPE_SNA_TEXTS needs the text column '<X>' (KIPSCOPE_COLUMN_TEXT), which does not exist")`; the catalog load fails and `/api/catalog` answers 503 `catalog_unavailable` with that reason. Why: every value query would otherwise fail on the missing column.
- `unit` set: `<src> | summarize u_ = take_anyif(U, isnotempty(U)) by R, S | project R, S, u_ = tostring(u_) | order by R asc, S asc` (no text signals, as today).
- neither: today's `distinct` query, unchanged.

A missing unit column is not caught: the SEM0100 error names it and fails the load (the variable was set explicitly). A row value of `u_` that is empty after `trim` gives no `unit` field. Per data ref by construction: the summarize groups by `R, S`, so `a/X.Y` and `b/X.Y` carry their own unit.

### R3 SNA by text in every value query

`isSna(ref)` becomes a method of `AdxSource` returning the predicate on the current row:

- ranges part: as today (`(v_ >= lo and v_ <= hi) or …`);
- text part, only with `snaTexts`: `tostring(X) in (snat)`;
- joined with `or`; `false` when neither part exists (today's text without `snaTexts`).

Parameter `snat: { type: "dynamic", value: snaTexts }` is added to the params of `raw`, `before`/`after` (`edge`), `series`, `buckets`, `stateChanges` and `listSignals` exactly when `snaTexts` is set; without it no query text or parameter changes. Why a parameter, not a literal: the adapter's rule is "all values go in as query parameters"; the ranges are numbers the adapter formats itself, the texts are user strings. If the emulator refuses `in` over a dynamic parameter, that is a finding for the spec owner, not a silent switch to literals.

Effect, identical to a DBC SNA value: the point's value is null (raw points, edges, series points: a gap in the chart, no state name, D-010), the bucket counts it in `sna`/`m_` and leaves it out of mean, min and max, `stateChanges` leaves it out, an edge query returns it as an SNA neighbour instead of skipping it. Row text of such a point is returned unchanged for a text signal; no consumer shows text of a null-valued point (Context). Row-based methods are unchanged: an SNA row is still a row for periods, logger gaps, density and extent, as a DBC SNA row is today.

### R4 Text flag

With `snaTexts`, `n_` counts only rows whose text is non-empty and not in the list (R2). A signal whose only texts are sentinels is listed without `text` and so gets no `states: "text"` (state-names). A signal with real state names and sentinels stays a text signal; its sentinel rows are SNA by R3.

### R5 Catalog: the table unit last

In `Catalog.load`, after DBC and diag are applied as today: `if (info.unit === undefined && listed.unit) info.unit = listed.unit`. So the table unit fills an entry whose winning metadata (DBC entry, else diag field) has no unit, including a DBC entry without unit. DBC and diag stay keyed by name; the table unit is per listed (data ref, name). It feeds everything `unit` feeds today (search terms, legend `name [unit]`, shared y axes, the explorer's unit limit) without any further change. No new `SignalInfo` field.

### R6 Hover card source line

`formatSource`: no `dbc`, no `diag`, `unit` present → `<dataRef> · unit from the table`. No `dbc`, no `diag`, no unit → `<dataRef> · no DBC entry` (unchanged). Why inferred, not flagged: today a unit comes only from a DBC entry or a diag field, so a unit without either can only be the table's; a flag would change `packages/shared` and the HTTP payload for one line of text. If a later change adds another unit source, it revisits this line. Wording: Q-3.

### R7 Emulator fixture `KMeta`

`seed-adx.ts` creates and fills one more table in `kipscope_test`, outside the conformance fixture (which stays as it is, so "Fixture seeded identically" and the ClickHouse seed are untouched):

`.create table KMeta (dataref: string, signal: string, timestamp: datetime, value: real, text: string, unit: string)`; B is the conformance base `B` (fixture.ts), S = 1 s. 22 rows:

| Signal | Rows |
|---|---|
| `meta-a/Spd.V` | n = 0 … 9 at B + n·S; value 10·n, except n = 3, 4: value 255, text `SNA`, and n = 7: value 254, text `INVLD`; other texts empty; unit `km/h` for n ≤ 4, empty for n ≥ 5 |
| `meta-a/Gear.POS` | k = 0 … 3 at B + 10·k·S; value k; text `P`, `D`, `SNA`, `R`; unit empty |
| `meta-a/Flag.ERR` | k = 0 … 4 at B + k·S; value k mod 2; text `SNA` at k = 2, else empty; unit empty |
| `meta-b/Spd.V` | k = 0 … 2 at B + k·S; value 1; text empty; unit `mph` |

Spot checks added to the seed's list: `KMeta | count` → `22`; `KMeta | where text in ('SNA','INVLD') | count` → `5`.

The tests build `new AdxSource(client(), { ...adxMapping, table: "KMeta", unit: "unit", snaTexts: ["SNA", "INVLD"] }, adxEventMapping)` (and variants without `unit` or `snaTexts`).

### R8 What does not change

`packages/shared`, every HTTP payload and route, the CLI, ClickHouse (`clickhouse.ts`), the conformance fixture and suite, `seed-test-db.ts`, the series cache, the web's chart code. `SignalInfo.sna` stays DBC-only: a signal whose SNA comes from text has no `sna` field and no SNA line in the hover card.

## Pinned interfaces

Server-internal, shared by the config/catalog task and the adapter task (both `apps/server/src`, different files):

```ts
// apps/server/src/config.ts
export interface TableMapping {
  database: string;
  table: string;
  dataRef: string;
  signal: string;
  time: string;
  value: string;
  /** Text column (state names, design E1); a missing column is no config error (no signal has text). */
  text: string;
  /** Unit column (ADX, add-adx-row-metadata R1); absent: none. */
  unit?: string;
  /** Row texts that mean SNA (ADX, R1): non-empty, trimmed, distinct; absent: none. */
  snaTexts?: readonly string[];
}

// apps/server/src/datasource.ts
/** A listed signal; `text`: some rows carry non-empty text that is not an SNA text (add-events N1, R4);
 *  `unit`: the non-empty unit of its rows, from the source (R2); absent: none. */
export interface SourceSignal extends SignalRef {
  text?: boolean;
  unit?: string;
}
```

Web: `formatSource(signal: SignalInfo): string` keeps its signature (R6). `SignalInfo` and every HTTP payload are unchanged, so server and web build in parallel without waiting.

## Numbers

| Number | Where | Off by ×2 |
|---|---|---|
| 1 query per `listSignals` | R2 | Exact, tested. A second query would add one ADX round trip (0.16–0.34 s measured, D-098) to every open in scoped mode, where the list is on the open's path. |
| Extra cost of `take_anyif` and the `in` test | R2, R3 | Not measured; a goal, not a gate. Same scan, one more column read and aggregate. If it doubled the scoped list's duration, an open would wait one list duration longer; the variables are off by default, and the search tool team measures after release (as for D-097). |
| `SNA,INVLD` (2 entries) | R1 | A list of 4 or 1 changes nothing: one `in` over a short dynamic array. |
| 22 rows, 5 sentinel rows in `KMeta` | R7 | Exact fixture counts; the tests compare exact values. |

## Risks

- `take_anyif` picks any non-empty unit when rows of one signal in one data ref disagree; the unit can flip between loads. Accepted (origin text: "take_anyif"); out of scope to resolve.
- In scoped mode a signal whose unit rows lie outside the scope shows no unit in that scope (D-100: read "only for the scope"); D-096's backlog item covers metadata independent of the scope.
- A sentinel spelled differently from the list (`Sna`) stays a state name and makes its signal a text signal; documented in `docs/data-sources.md`.

## Open questions for Jan

- **Q-1 ClickHouse.** Recommendation: ADX only, as D-100 says "the ADX source"; with ClickHouse either variable is a config error (R1). Alternative: the same in ClickHouse (both `listSignals` paths, the SNA predicate with an array parameter, a ClickHouse fixture), about twice the server work and a conformance change.
- **Q-2 Unscoped list.** D-100 names "the scoped signal list in its existing summarize". Recommendation: the unscoped list gets the same summarize, because both share one query text and full mode would otherwise show the table units only after a scope is set; cost as in "Numbers". Alternative: unit only with a scope (a second query text to maintain).
- **Q-3 Source line wording.** Recommendation: `<dataRef> · unit from the table`. Alternative: keep `<dataRef> · no DBC entry` (true, but reads as "no metadata" next to a unit).
