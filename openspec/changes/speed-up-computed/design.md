# Design

## Context

See proposal.md for why. `computedSeries` in `apps/server/src/clickhouse.ts` (about lines 384–470, design F9 of `archive/2026-10-23-improve-formula-editor`) sends two queries. The first is a `count()` of the inputs' rows in `[from, to)`; `raw = count <= target` decides the answer kind. The second is one scan, the "rows query":

- **One input:** the formula per row, then `ORDER BY x LIMIT 1 BY x`. This change leaves that path alone.
- **Several inputs:** `WINDOW w AS (ORDER BY time RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`. Each input gets three window columns, `last_value(if(mine, …, NULL)) IGNORE NULLS OVER w` of its value (`i<i>_v`), SNA flag (`i<i>_s`) and time (`i<i>_t`), each wrapped in `ifNull(…, seed)`. The rows are kept where every input is held within its limit, the formula is applied, and then `ORDER BY x LIMIT 1 BY x`.
- **Answer:** the raw answer reads `SELECT toString(x), v FROM (rows)`. The bucket answer groups `rows` on the floor grid.

The lead measured the whole recording of smart451 on carserver (ClickHouse 26.8, `max_threads` 4, 4.2 M input rows):

| Part | Time |
|---|---|
| today's scan | 3.49 s |
| `count()` | 0.18 s |
| sort alone | 0.29 s |
| each window column | 0.3–0.5 s, one thread |
| `ORDER BY x LIMIT 1 BY x` | about 1.0 s (only 8 duplicate times) |
| `uniqExact(x)` per bucket instead | about 1.3 s |
| ROWS frame + running max time + last row per time (S-1, S-2, S-5 below) | 2.06 s, same count 4,141,081, min −946.1, max 81.6 |

## Goals / Non-goals

Goals:

- the whole recording in ≤ 2 s through `/api/series` (lead's curl)
- the 25 min window no slower than today
- rows identical to today's and to the core's

Non-goals: everything under "Out of scope" in proposal.md.

## Decisions

### S-1 ROWS frame

`WINDOW w AS (ORDER BY <time> ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)` replaces the RANGE frame. The two frames differ only at rows that share a time: with ROWS, an earlier row at time t does not see the later rows at t. S-5 keeps only the last row at each time, and that row's ROWS frame equals the RANGE frame of t. So the kept rows hold what they held before.

### S-2 Last time per input as a running max

`ifNull(max(if(mine, x, NULL)) OVER w, {st<i>:Nullable(Int64)}) AS i<i>_t`. Here `mine` is `<signal> = {s<i>:String}` and `x` is `toUnixTimestamp64Nano(<time>)`. The window is ordered by time, so the largest time of an input in the frame is its last one. A plain aggregate over the frame is cheaper than `last_value … IGNORE NULLS`.

### S-3 SNA folded into the value

```
ifNull(last_value(if(mine, if(<sna<i> expr>, nan, <value>), NULL)) IGNORE NULLS OVER w,
       if({ss<i>:Nullable(UInt8)} = 1, nan, {sv<i>:Nullable(Float64)})) AS i<i>_v
```

`i<i>_s` and `anySna` go away. The outer select becomes `if(NOT isFinite(v0), NULL, v0) AS v`. This is correct because:

- `+ - * /`, unary minus and `abs` carry NaN.
- `min`/`max` carry it after S-4.
- So a held SNA point always makes the formula NaN, and NaN reads as SNA (D-105 Q-4).
- A NaN stored in the value column already read as SNA through `isFinite`, so nothing changes for it.

Seeds keep today's parameters `sv`, `ss`, `st` (`ss` = 1 when the seed point is SNA). No NaN travels as a query parameter.

In a row that passes the hold filter, every input has a time, so it has a row or a seed and `i<i>_v` is not NULL. `least`/`greatest` skip NULL arguments (ClickHouse ≥ 24.12), so this matters.

### S-4 `min`/`max` carry NaN

`formulaSql` compiles `min(a, b, …)` to `if(isNaN(_kf<m>) OR isNaN(_kf<m+1>) OR …, nan, least((a) AS _kf<m>, (b) AS _kf<m+1>, …))`, and `max` the same way with `greatest`. Each argument appears once in the SQL text, under a fresh alias `_kf<n>` numbered per query. Writing an argument twice would double the text per nesting level.

Probed on the test DB (ClickHouse 26.8):

- `least(nan, 1)` = 1 and `least(1, nan)` = nan, so plain `least` loses NaN depending on argument order.
- The aliased form gives nan for `x / 0` at x = 0 and 2 for `least(x / 0, 1 + x)` at x = 1.

This applies to both paths, one input and several. It matches `Math.min`/`Math.max` in `evalFormula`. Another form is fine if each argument appears once and the S-4 tests pass.

### S-5 One row per time: the last row at that time

```
leadInFrame(x, 1, x + 1) OVER w2 AS nx
WINDOW w2 AS (ORDER BY <time> ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING)
```

The rows are filtered with `WHERE nx != x AND <held>`. This replaces `ORDER BY x LIMIT 1 BY x` in the several-input path.

- **Same ORDER BY as `w`:** `w2` must have exactly the same `ORDER BY` as `w`. ClickHouse then evaluates both windows over one sort, so "last row at t" in `w2` is the row whose `w` frame holds all rows at t.
- **Default `x + 1`, no sentinel:** the default makes the last row of the range differ from its next row. A sentinel such as −1 would be wrong, because times before 1970 are valid (design H2, see `buckets`) and −1 ns is a time. Probed on 26.8: a per-row default works.

### S-6 One rows query for raw and buckets

Both answers keep reading the same `rows` subquery. That subquery no longer orders its output. The raw answer adds `ORDER BY x` itself: `SELECT toString(x), v FROM (rows) ORDER BY x`. That sorts at most `target` input rows, so it is cheap. The bucket answer is unchanged (`GROUP BY b ORDER BY toInt64(b)`). The query count stays two: the count and the scan.

### Rows query, several inputs (shape to build)

```
SELECT x, if(NOT isFinite(v0), NULL, v0) AS v FROM (
  SELECT x, <formula over i<i>_v> AS v0 FROM (
    SELECT toUnixTimestamp64Nano(<time>) AS x,
           <per input: i<i>_v (S-3), i<i>_t (S-2)>,
           leadInFrame(x, 1, x + 1) OVER w2 AS nx
    FROM <table> WHERE <range>
    WINDOW w AS (ORDER BY <time> ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW),
           w2 AS (ORDER BY <time> ROWS BETWEEN CURRENT ROW AND 1 FOLLOWING))
  WHERE nx != x AND <held, as today>)
```

That is two window columns per input plus one, where today has three per input: 5 instead of 6 for two inputs, and every one is cheaper. The parameters `{s<i>}`, `{sna<i>…}`, `{sv<i>}`, `{ss<i>}`, `{st<i>}`, `{h<i>}` and `{k<n>}` keep their names. `NO_HOLD` stays.

## Pinned interfaces

None change. `DataSource.computedSeries`, `ComputedRef`, `ComputedAnswer`, the HTTP payloads and `packages/shared` stay as they are. `formulaSql(ast, column, params)` keeps its signature. Only its SQL for `min`/`max` changes (S-4).

## Numbers

| Number | Value | Off by ×2 |
|---|---|---|
| Whole recording goal | ≤ 2 s (lead; today 3.9–4.0 s). Expected: SQL 2.06 s without S-3, + count 0.18 s + HTTP, about 2.4 s; S-3 saves 0.3–0.5 s per input, about 1.5–1.9 s | 4 s is today's time, so nothing gained: a finding. 1 s would need `PARTITION BY` (out of scope). Goal, not gate. |
| 25 min window goal | ≤ 0.30 s (today 0.21–0.30 s, status.md), median of 3 runs | 0.6 s would be felt while panning: a finding. Fewer and cheaper window columns make it unlikely. |
| Busiest hour goal | ≤ 0.5 s (D-102) | Kept from the main spec, reported. |
| `mean` tolerance in S2 | 1e-9 relative | `avg` may sum in a different order. Float noise is about 1e-15, so ×2 either way changes nothing. |
| `leadInFrame` default offset | `x + 1` (1 ns) | Any non-zero offset works. |

## Manual checks (the lead, carserver)

- **S1 Speed (goal):** run `curl -s -o /dev/null -w '%{time_total}\n' "$KS/api/series?signal=smart451%2F%3Dc1&formula=MS_312h.DNMOT%20-%20CPC_508h.PNHV_SupBat_Curr&from=…&to=…&target=2000"` three times each, over:
  - the whole recording
  - a 25 min window
  - the busiest hour
  - a three-input formula (third numeric signal of the session) over the whole recording

  Report against the goals in Numbers.
- **S2 Same answer:** before the round, with today's server, save the whole-recording answer: `curl -s "…" > /tmp/before.json`. After the round, save `after.json` the same way. Check:
  - `jq -S '[.buckets[] | {start, count, sna, min, max}]'` is equal for both files.
  - Means agree within 1e-9 relative (a `jq` zip over both files).
  - The sum of `count` is 4,141,081, the min of `min` is −946.1 and the max of `max` is 81.6.

  Use the field names of the actual response (`docs/http-api.md`).

## Risks

- **Two sorts:** if ClickHouse ever sorts `w` and `w2` separately, the tie order among rows at one time could differ, and S-5 could keep a row that has not seen all its peers. Mitigation: one identical `ORDER BY` for both windows (S-5). The conformance case "computes at shared times" checks values at shared times. S2 checks 4.2 M real rows.
- **The SNA fold misses its gain:** if S1 shows no gain over S-1 + S-2 + S-5 alone, the lead may ask to restore `i<i>_s`. The rows are the same either way.
