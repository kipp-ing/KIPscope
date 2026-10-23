# Design

## Context

See proposal.md for why. Today `AdxSource` has no `computedSeries`, so `completeSource` uses the fallback in `fallbacks.ts`: `raw` of all inputs, capped at 200,000 rows together. The reference shape is ClickHouse's `computedSeries` in `apps/server/src/clickhouse.ts` after `speed-up-computed`:

- one count, then one rows query
- several inputs: a ROWS window with each input's last value (SNA folded in as NaN, S-3) and last time (S-2)
- the last row per time (S-5), the hold filter, the formula with NaN-carrying `min`/`max` (S-4), and non-finite → NULL
- raw answer or buckets (S-6)
- chunked bucket scans with a bounded lookback (C-1 … C-4), each query through `this.run` (`useQueue`)

`queryComputed` (`computed.ts`) reads the seeds with `before` per input in one parallel wave, calls `computedSeries`, and for a raw answer reads the edges. That stays as it is.

**Emulator probe (spec owner, 2026-10-23, the pinned Kustainer on 127.0.0.1:8125, database `kipscope_test`).** The query shape below ran as written:

- `min(Lin.RAMP * k0, Sna.CODE)` over [B + 49.5 s, B + 50.5 s), with the `Sna.CODE` seed as an SNA row at B + 49 s and `k0` = `real(1e+3)`:
  - Raw path (`lim` 1000): the count row was 101, followed by 100 `p` rows, 50 null and 50 at 0. The shared time B + 50 s gave one row.
  - Bucket path (`lim` 10, `w` 250 ms): 4 buckets (0/25, 0/25, 25/0 min 0, 25/0).
  - `cr` 50: only the count row.
- `Spd.V - Flag.ERR` on `KMeta` with `snat` gave exactly the values of "SNA from row texts".
- `1.0/0` = Infinity, `0.0/0` = NaN, `isfinite(1.0/0)` = false.
- `min_of(real(nan), 1.0)` = NaN and `min_of(1.0, real(nan))` = 1: Kusto's `min_of` loses NaN depending on argument order, as ClickHouse's `least` does.

The probe scripts are not kept. The tests are the evidence.

## Goals / Non-goals

Goals:

- a computed signal over any range on ADX, with rows identical to the core's
- one round trip for an unchunked answer
- chunks on long ranges as on ClickHouse

Not goals: a timing target. The emulator is no cluster, and timing on a real cluster belongs to the ADX testers (D-111). Everything under "Out of scope" in proposal.md.

## Decisions

### K-1 Carry forward with `scan`

One `scan` with one step that matches every row carries, per input i, `i<i>_v` (the last value, SNA as NaN) and `i<i>_t` (the last time, ns). This is the fill-forward pattern of the KQL `scan` docs and D-102's "serialize and scan". It is one serial pass over the sorted rows with 2 state columns per input, the KQL counterpart of ClickHouse's window. It ran on the emulator.

Rejected:

- `prev()` reaches only a fixed offset back.
- `row_window_session` groups rows by time gaps, not by input.
- `row_cumsum` of per-input deltas would carry exact times but not exact values: float rounding, and one NaN poisons every later row.
- A `lookup` or `join` per input reads the inputs N times.
- `make-series … fill_forward` works on a grid and lost the extremes in D-102's measurement (−157 instead of −946).

### K-2 Seeds as rows

For each input with a seed, one row `print x_ = st<i>, k_ = <i>, f_ = iff(ss<i> == 1, real(nan), sv<i>)` joins the input rows before the sort. Seed times lie before `from`, so the seed rows sort first. An input without a seed gets no row. Its state starts null, so no row is held until its first point. `scan declare` gets no defaults: defaults would have to be constants.

### K-3 SNA folded into the value

`f_ = case(k_ == 0, iff(<sna0>, real(nan), v_), k_ == 1, …, real(nan))`.

- `<sna i>` is today's `isSna(input)`: the DBC ranges as literals the adapter writes, plus `tostring(<text>) in (snat)` when SNA texts are configured (add-adx-row-metadata R3).
- `k_ = case(<signal> == s0, 0, <signal> == s1, 1, …, -1)`. The names in a formula are distinct (`formulaInputs`).
- The outer projection is `v_ = iff(isfinite(v0_), v0_, real(null))`.

This is correct for the same reasons as speed-up-computed S-3: `+ - * /`, unary minus, `abs` and (K-4) `min`/`max` carry NaN.

### K-4 `min`/`max` carry NaN

The query starts with two lambdas:

```
let kmin_ = (a: real, b: real) { iff(isnan(a) or isnan(b), real(nan), min_of(a, b)) };
let kmax_ = (a: real, b: real) { iff(isnan(a) or isnan(b), real(nan), max_of(a, b)) };
```

`min(a, b, c)` compiles to `kmin_(kmin_(a, b), c)`: each argument appears once in the text, and any NaN argument gives NaN, like `Math.min` in the core. Both lambdas are emitted always; an unused `let` is harmless. If the engine refuses an unused lambda, emit only the used ones.

### K-5 One row per time: the last row at that time

After the scan: `| extend nx_ = next(x_) | where (isnull(nx_) or nx_ != x_) and x_ >= cs and <held>`.

- The scan keeps the sort order, so the last row at t has seen every row at t. The probe kept one row at the shared time.
- `next` gives null after the last row, so no sentinel time is needed. Times before 1970 stay valid.
- `<held>` is `isnotnull(i<i>_t) and x_ - i<i>_t <= h<i>` for every input.
- `cs` is the chunk start (K-11), `from` when unchunked.

### K-6 Count, raw and buckets in one query; dead legs read nothing

Shape to build (identifiers in brackets come from the table mapping, quoted with `q()` as today):

```
let kmin_ = …; let kmax_ = …;                                         // K-4
let in_ = [table] | where [dataRef] == ref and [signal] in (s0, …)
            and [time] >= t0 and [time] < t1;
let cnt_ = toscalar(in_ | count);
let rows_ = (live: bool) {
  union
    (in_ | where live | extend v_ = todouble([value]), k_ = case(…)
         | project x_ = tolong([time] - datetime(1970-01-01)) * 100, k_, f_ = case(…)),   // K-3
    (print x_ = st0, k_ = 0, f_ = iff(ss0 == 1, real(nan), sv0) | where live), …         // K-2, seeded inputs only
  | order by x_ asc
  | scan declare (i0_v: real, i0_t: long, …) with (
      step s_: true => i0_v = iff(k_ == 0, f_, s_.i0_v), i0_t = iff(k_ == 0, x_, s_.i0_t), …;)
  | extend nx_ = next(x_)
  | where (isnull(nx_) or nx_ != x_) and x_ >= cs and <held>                             // K-5
  | extend v0_ = <formula over i<i>_v>                                                   // K-7
  | project x_, v_ = iff(isfinite(v0_), v0_, real(null))
};
union
  (print k_ = "n", t_ = "", v_ = real(null), c_ = cnt_, m_ = long(null), lo_ = real(null), hi_ = real(null)),
  (rows_(cnt_ <= lim) | project k_ = "p", t_ = tostring(x_), v_, c_ = long(null), m_ = long(null),
       lo_ = real(null), hi_ = real(null)),
  (rows_(cnt_ > lim and cnt_ <= cr)
     | summarize c_ = countif(isnotnull(v_)), m_ = countif(isnull(v_)), a_ = avgif(v_, isnotnull(v_)),
         lo_ = minif(v_, isnotnull(v_)), hi_ = maxif(v_, isnotnull(v_)) by b_ = <grid(x_, w)>
     | project k_ = "k", t_ = tostring(b_), v_ = iff(c_ == 0, real(null), a_), c_, m_,
         lo_ = iff(c_ == 0, real(null), lo_), hi_ = iff(c_ == 0, real(null), hi_))
| project k_, t_, v_, c_, m_, lo_, hi_
```

- **The guard sits at the leaves.** `live` filters the input rows and the seed rows before the sort, so a dead leg sorts and scans nothing, whether or not the engine prunes it.
- **Three outcomes:**
  - `cnt_ <= lim`: rows (raw).
  - `lim < cnt_ <= cr`: buckets.
  - Otherwise only the count row comes back, and the adapter chunks (K-11).
- **No `materialize`.** `in_` is read twice, by the count and by the live leg, as `series` does today. The count is cheap, while `materialize` would hold every input row in memory.
- `<grid(x_, w)>` is the existing `grid` helper.

### K-7 `formulaKql`

`formulaKql(ast, column, params)` in `adx.ts` is the counterpart of `formulaSql`:

- `num` becomes the parameter `k<n>` (real), numbered per query.
- `sig` becomes `column(name)`, which is `i<index>_v`.
- `neg` becomes `(-x)` and `abs` becomes `abs(x)`.
- `+ - * /` become `(a op b)`.
- `min`/`max` as in K-4.

No text of the formula reaches the query.

### K-8 Parameters

| Name | Type | Value |
|---|---|---|
| `ref` | string | data ref |
| `s<i>` | string | input name, `formulaInputs` order |
| `k<n>` | real | formula constants |
| `t0`, `t1` | datetime | scan range (rounded up to the tick, as every time parameter) |
| `sv<i>`, `ss<i>`, `st<i>` | real, long, long | seed value (0 when SNA), 1 when the seed is SNA else 0, seed time in ns; only for seeded inputs |
| `h<i>` | long | hold limit in ns; `NO_HOLD` = 2^63 − 1 without one |
| `lim` | long | `target`; −1 in a chunk query |
| `cr` | long | `computedChunkRows` when the request may chunk (K-11), else 2^63 − 1 |
| `cs` | long | rows kept from this time on (ns): `from`, or the chunk start |
| `w` | long | bucket width in ns |
| `snat` | dynamic | SNA texts, only when configured (`snaParams`) |

`KustoParam` gains `{ type: "real"; value: number }`. It is sent as `realLiteral(value)` (`real(2.5)`, `real(1e+21)`, `real(nan)`, `real(+inf)`, `real(-inf)`) and declared as `real`. The probe accepted `real(1e+3)` and `real(7)`. A seed value is any number the table holds, so non-finite values must pass too.

### K-9 Reading the answer

The answer's columns are `k_, t_, v_, c_, m_, lo_, hi_`.

- **The count row:** exactly one `n` row, else reject with `the computed query returned no count`. Its `c_` is the count.
- **Raw** (count ≤ target): the `p` rows sorted by `BigInt(t_)`, `v` = `real(v_)`.
- **Buckets** (target < count ≤ `cr`): the `k` rows sorted by start, `{ start, count: c_, sna: m_, mean: v_, min: lo_, max: hi_ }`.
- **Count only:** chunk (K-11).

### K-10 One input takes the same path

A one-input formula uses the same query (Q-4). The row's own value is its held value, and the hold check passes at distance 0. Seeds do not change rows at or after `from`. One path is less code and gives the same rows.

## Round 2: chunks (D-110 on ADX)

### K-11 When and how

`chunkable` holds when all of these do:

- `inputs.length > 1`
- every `holdNs` is defined and not `NO_HOLD`
- `nb ≥ 2`, with `g0` and `nb` as in speed-up-computed C-2

Then:

- **First query:** `cr` = `computedChunkRows` when chunkable, else 2^63 − 1. The query text is the same either way.
- **Count only in the answer** (count > target and count > `cr`): k = min(`COMPUTED_CHUNKS` = 3, ceil(count / `computedChunkRows`), nb). k ≥ 2 here.
- **Boundaries:** as in C-2, c_j = g0 + floor(j · nb / k) · width.
- **Chunk queries:** each chunk sends the same query text with `lim` = −1, `cr` = 2^63 − 1, `cs` = c_j and `t1` = c_{j+1} (or `to`). `t0` is `from` for chunk 0 and max(c_j − L, `from`) after it, with L = max(holdNs). Every chunk carries the request's `sv`/`ss`/`st`.
- **Answer:** each chunk's buckets sorted by start, concatenated in chunk order.

Equality with the unchunked answer follows from speed-up-computed C-3, which the shape here keeps: same lookback, same seeds, same `x_ >= cs` filter. The last row of a chunk has no next row in its scan, so it is kept, exactly as when unchunked.

A chunked request costs one more serial round trip than an unchunked one: the first query answers only the count (Q-3). The count is cheap and the scan dominates on such ranges.

### K-12 Queue and abort

`AdxSource` gets `useQueue(run)` and a private `run: QueryRunner`, by default `(task, abort) => task(abort)`. Every query of `computedSeries` goes through `this.run`: the first query and each chunk. `queuedAdapter` already calls `useQueue` and passes `computedSeries` through unqueued (speed-up-computed "Pinned interfaces"), so `queue.ts` does not change. The chunks run in parallel under one local `AbortController`, which is aborted on the caller's abort and on the first failing chunk (`AbortSignal.any`), as in C-4. The call rejects with the first failure.

## Pinned interfaces

Server only. One engineer per round, so nothing is shared across write areas except these signatures, which the tests use:

```ts
// apps/server/src/kusto.ts
export type KustoParam =
  | …                                   // as today
  | { type: "real"; value: number };    // sent as realLiteral(value), declared `real`

// apps/server/src/adx.ts
export function formulaKql(
  ast: FormulaNode,
  column: (name: string) => string,
  params: Record<string, KustoParam>,
): string;

constructor(
  client: KustoClient,
  mapping: TableMapping,
  events: EventMapping = DEFAULT_EVENT_MAPPING,
  options: { computedChunkRows?: number } = {},   // default 1_000_000 (round 2; round 1 may accept and ignore it)
)
computedSeries(ref: ComputedRef, from: Timestamp, to: Timestamp, target: number, width: bigint,
               abort?: AbortSignal): Promise<ComputedAnswer>
useQueue(run: QueryRunner): void                  // round 2
```

Unchanged: `DataSource`, `SourceAdapter`, `ComputedRef`, `ComputedAnswer`, `queuedAdapter`, the HTTP payloads, `packages/shared`, the conformance suite. The fake Kusto client of `adxQueries.test.ts` receives `query(csl, params, abort)`. The tests read the parameters by the names in K-8.

## Open questions (picked by the spec owner; Jan may veto)

- **Q-1 Chunks k ≤ 3** on ADX too, not up to 7 (ADX queue width 8 minus the kept slot). D-110 says „at most 3"; on ADX an open sends one query per shown signal at once (D-098), so 3 chunks per computed signal leave room for the others. `COMPUTED_CHUNKS` in `adx.ts` is the one place to change it.
- **Q-2 Threshold 1,000,000 input rows**, as D-110. Not measured on a cluster (D-111).
- **Q-3 Count folded into the query.** An unchunked answer costs one round trip (D-097). A chunked one costs two serial round trips (count-only answer, then the chunks in parallel). The alternative, a separate count first on every request, would cost two round trips on every request.
- **Q-4 One input through the same `scan`**, not a separate per-row path. Less code and the same rows. A one-input formula over a long range then pays a serial scan without chunks. A per-row path is a later option if the ADX testers' timing shows it.

## Numbers

| Number | Value | Off by ×2 |
|---|---|---|
| Inputs | ≤ 8 (D-106) | 16 would mean 32 scan state columns. It is not reachable: the server refuses 9 (computed-signals "Refused requests"). |
| `computedChunkRows` | 1,000,000 input rows (Q-2, D-110) | 500,000 or 2,000,000: the whole recording (4.2 M rows on carserver) still gets 3 chunks and the busiest hour (396 k) none. The number keeps small ranges from paying the extra round trip of K-11. |
| Chunks k | ≤ 3 (Q-1, D-110) | 6 would take 6 of the 7 non-interactive slots of the ADX queue (width 8, D-097). A second computed signal in the same open would wait. 1–2 gain less. |
| `NO_HOLD` | 2^63 − 1 ns | Any value above the longest range works. Halving it still exceeds 146 years. |
| `lim` in a chunk query | −1 | Any negative value turns the raw leg off, since a count is ≥ 0. |
| Emulator timing | not measured, not a goal | The fixture holds 17,069 rows of `conf-a`. Its timing says nothing about a cluster. |

## Manual check (the lead, emulator)

- **M1 Server on the emulator (goal, not a gate).** Start the second server as in `docs/data-sources.md` "Try it on the emulator". Then run `curl -s 'localhost:7311/api/series?signal=conf-a%2F%3Dc1&formula=Lin.RAMP%20-%20Sna.CODE&from=2026-10-05T00:00:00Z&to=2026-10-05T00:01:40Z&target=100' | jq -c '[.kind, ((.count|add) + (.sna|add))]'`. It should print `["buckets",10000]`, and the server log names no `computed_too_large`.

## Risks

- **Order after `scan`.** K-5 relies on the scan output keeping the sort order. If a Kusto version breaks that, `next()` fails or picks the wrong row. Mitigation: the conformance case "computes at shared times". If needed, `serialize` after the scan.
- **Ties within one input.** Two rows of the same input at the same time: the held value depends on the tie order, as on ClickHouse and in the core. That is a data oddity, out of scope.
- **Serial scan on a cluster.** `order by` + `scan` run on one node. That is why the chunks exist. Their gain on a cluster is the ADX testers' measurement.
- **Query timeout.** A chunk over about 1.4 M rows must finish within `KIPSCOPE_QUERY_TIMEOUT_S`. A timeout answers as any ADX query timeout does today.
- **Unknown engine limits.** The emulator accepted the shape. A cluster on another engine version might refuse the tabular lambda with a bool parameter. Fallback: emit the `rows_` body twice, inline, with the guard in each (generated text, no user text). That is a finding for the lead, not a silent change.
