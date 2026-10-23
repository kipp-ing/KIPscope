# Design

## Context

Source: the ADX testers' performance report on the ADX feedback (comment of 2026-10-22, sections 1 and 2), measured on a real ADX cluster (~2.6k signals per vehicle, `KIPSCOPE_CATALOG=scoped`, opened through `/open#cases=`). Jan agreed on 2026-10-22 to the lead's cut: P1, P2, P5, P6 and an investigation of P9, all server-side. Facts this design rests on:

| Fact | Where today |
|---|---|
| ADX has no native `count` or `extent`; the fallbacks are a bucket query of width 2^62 (`count`) and `after(TIME_MIN)` + `before(TIME_MAX)`, two `top 1` scans (`extent`). Report: extent fallback 4–17 s per signal | `apps/server/src/adx.ts` (methods), `apps/server/src/fallbacks.ts` (`count`, `extent`) |
| The emulator measurements of 2026-10-17 had the fallbacks within 1.6×, so ADX left them out under D-074's factor-of-two rule | `docs/data-sources.md` (method table, "Fallback ≤ 2×?") |
| `querySeries` awaits `source.count`, then runs `raw` + `before` + `after` or `buckets`: two serial round trips; a round trip on the cluster costs 0.6–8 s | `apps/server/src/series.ts` (`querySeries`) |
| `count` has exactly one caller | `apps/server/src/series.ts` |
| The queue limit is `KIPSCOPE_QUERY_CONCURRENCY`, default 4 for every source, one slot kept for `interactive` (D-081). Report: 6 requests in flight, 4 running; most of the series p90 of 8.9 s is queue wait | `apps/server/src/config.ts` (`queryConcurrency`), `apps/server/src/queue.ts` |
| `/api/meta` pings on every request; single flight only, "no cache beyond it". Report: 1,590 calls in 12 h | `apps/server/src/meta.ts` (`check`) |
| The ping already bypasses the queue: `queuedAdapter` passes `ping` through, `main.ts` wires `meta.ping` to `source.ping` with the comment "Outside the query queue"; tested | `apps/server/src/queue.ts` (`queuedAdapter`), `apps/server/src/main.ts`, `queue.test.ts` › "passes ping and info through without the queue" |
| `/api/value` calls `before(ref, t + 1, scope)` and `after(ref, t + 1, scope)` with the workspace's scope, and awaits gap info | `apps/server/src/routes/series.ts` (`/api/value`) |
| `adx.test.ts` and the ADX conformance run only under `test:adx` (emulator); `pnpm test` excludes them | `apps/server/vitest.config.ts`, `vitest.adx.config.ts` |

## Goals / Non-Goals

**Goals:** fewer serial ADX round trips per open (P1, P2), less queue wait on ADX (P5), fewer pings (P6), all with unchanged HTTP payloads and unchanged ClickHouse queries; evidence that runs locally (query counts on a fake Kusto client in `pnpm test`, answers on the emulator in `test:adx` and on the ClickHouse test DB).

**Non-Goals:** the proposal's non-goals; any wall-clock target (the report's targets are measured by the ADX testers after release); any change in `packages/shared`, `apps/web` or the CLI.

## Decisions

### A1: Native `extent` on ADX; `count` and `refExtent` stay on the fallback

- `extent(ref, scope)`: `<scoped table> | where <signal filter> | extend x_ = <ns(t)> | summarize f_ = min(x_), l_ = max(x_) | project tostring(f_), tostring(l_)`. Answers one row of two ns strings; empty strings (or no row) mean no data, giving `undefined`. With a scope the three scope filters come first (`scoped()`, design Z3).
- `refExtent`: not native. Its fallback is one `refBuckets` query too, the report shows no measured gain, and D-074 asks for a measured factor of two. `refCount` is already native.
- `count`: not native (D-097, Jan 2026-10-22, following D-074). The report has no count-only measurement, its fallback is one query too, and after A2 ADX never calls `count` from `/api/series` (its only caller); the `series` fallback, used only by adapters without a native `series`, keeps calling the completed `count`.
- D-074's rule is met for `extent` by the report's measurement on the cluster (the fallback's two `top 1` scans 4–17 s per signal; extent + count for 3 names in one summarize 1.8 s).

### A2: P2 as an optional `series` method (one combined query), not a reused count

Two ways were on the table:

1. **Reuse a count the caller already has.** The web asks `/api/extent` per signal, but wave 1 (`target=769`) goes out before the extent is known, the extent covers the whole scope while a series request covers part of it, and `/api/extent` returns no count today (adding one changes the shared `Extent` type, P3 territory). A server-side cache of scope counts would save the `count` only when the scope count is ≤ target or the range covers the whole extent; every zoom would still pay two round trips, and the cache needs keys, a lifetime and invalidation.
2. **One combined query.** A new optional adapter method answers "raw points with edges, or buckets" in one call; ADX implements it as one KQL query; adapters without it get today's steps from the fallback.

Picked **2**: it is the simpler one (no cache, no shared type, no web change), it cuts every series request on ADX to one round trip and one queue slot (today up to four slots: `count`, then `raw`, `before`, `after`), and ClickHouse keeps its exact queries through the fallback. Cost: the KQL evaluates the range's rows for the count and again for the chosen branch; on ADX the per-query latency dominates (report: 0.6–8 s per round trip, the same shape varies 3–6×).

**Pinned interface** (`apps/server/src/datasource.ts`, server-internal; no `packages/shared` change):

```ts
/** What one series request needs (design A2): raw points with edges, or buckets. */
export type SeriesAnswer =
  | { kind: "raw"; points: RawPoint[]; before?: RawPoint; after?: RawPoint }
  | { kind: "buckets"; buckets: Bucket[] };

// in SourceAdapter, after `extent`:
/**
 * If [from, to) holds at most `target` points (as `count` counts them): those points (as `raw`
 * without a limit), `before(ref, from, scope)` and `after(ref, to, scope)`; else
 * `buckets(ref, from, to, width)`.
 */
series?(
  ref: SeriesRef,
  from: Timestamp,
  to: Timestamp,
  target: number,
  width: bigint,
  scope?: Scope,
  abort?: AbortSignal,
): Promise<SeriesAnswer>;
```

- **Fallback** (`fallbacks.ts`, in `completeSource`): `const n = await source.count(ref, from, to, abort)` (the completed `count`, native where the adapter has one); if `n <= target`, `Promise.all([adapter.raw(ref, from, to, undefined, abort), adapter.before(ref, from, scope, abort), adapter.after(ref, to, scope, abort)])` → `{kind: "raw", points, before, after}` (absent edges stay absent); else `{kind: "buckets", buckets: await adapter.buckets(ref, from, to, width, abort)}`. These are today's calls with today's arguments, so ClickHouse sends the same queries.
- **`OPTIONAL`** (`fallbacks.ts`): `["count", "extent", "series", "refExtent", "refCount", "loggerGaps", "firstTimes", "stateChanges", "events"]`; the start log names native methods in this order. `coreOnly` is unchanged.
- **Queue** (`queue.ts`, `queuedAdapter`): a native `series` is wrapped like the other optional methods, one `queue.run` per call (one slot, the caller's class and abort).
- **Guard** (`scope.ts`, `guardScoped`): `series` has its scope at argument index 5 and its range at 1–2; it is refused without a scope and when `[from, to)` is not inside a held scope of `ref.dataRef` (both checks on the one wrapper; the two existing loops each assign `guarded[method]`, so `series` needs its own wrapper, not an entry in both tables).
- **`querySeries`** (`series.ts`): unchanged signature and output. It computes `width = bucketWidth(0n, span, target)` first, calls `source.series(ref, from, to, target, width, scope, abort)` once and builds `RawSeries` or `BucketSeries` from the answer exactly as today (`edgePoint`, `encodeTimes`, text only for `ref.text`). `RangeError` handling in the route stays.

### A3: The ADX `series` query

One `client.query` call. Parameters: `ref`, `sig`, `t0`, `t1`, `lim` (target, long), `w` (width, long), plus `sref`, `sfrom`, `sto` with a scope. Shape (the engineer writes the exact text; names may differ, the row layout below may not):

```kql
let src_ = <scoped(table, scope).src>;                 // the bare table without a scope
let s_ = src_ | where <signal filter> and <t> >= t0 and <t> < t1;
let n_ = toscalar(s_ | count);
union
  (print k_ = "n", c_ = n_),
  (s_ | where n_ <= lim | extend v_ = todouble(<value>) | order by <t> asc | extend c_ = row_number()
      | project k_ = "p", c_, t_ = <ns string>, v_ = <null where SNA>, x_ = <text if ref.text>),
  (src_ | where n_ <= lim and <signal filter> and <t> < t0 | ... | top 1 by <t> desc | project k_ = "b", ...),
  (src_ | where n_ <= lim and <signal filter> and <t> >= t1 | ... | top 1 by <t> asc | project k_ = "a", ...),
  (s_ | where n_ > lim | <today's bucket summarize on the floor grid of w> | project k_ = "k", ...)
| project k_, t_, v_, x_, c_, m_, lo_, hi_
```

**Pinned row layout** (the tester's fake client answers these rows; columns in this order):

| `k_` | `t_` (string) | `v_` (real) | `x_` (string) | `c_` (long) | `m_` (long) | `lo_` (real) | `hi_` (real) |
|---|---|---|---|---|---|---|---|
| `n`, exactly one row | — | — | — | count of `[from, to)` | — | — | — |
| `p` point | time, exact ns | value, null where SNA | text (text signals) | row number from 1 in time order | — | — | — |
| `b` / `a` edge before / after | time | value, null where SNA | text (text signals) | — | — | — | — |
| `k` bucket | start, exact ns | mean, null if `c_` = 0 | — | valid count | SNA count | min, null if `c_` = 0 | max, null if `c_` = 0 |

"—" is null (or empty string for string columns). The adapter decides the kind from the `n` row alone (`c_ <= target` → raw), sorts points by `c_` and buckets by start, and sets `RawPoint.text` only for `ref.text`, as `raw` does. A missing `n` row is an error ("the series query returned no count"), never a guess.

Every reference to the signals table goes through `scoped()`, so with a scope the three filters precede every other operator and data-source "Scoped queries carry both filters" holds unchanged; within the scope the range filter `t0`/`t1` still bounds the points (the guard keeps the range inside the scope).

### A4: Queue width 8 for ADX

`config.ts`: `queryConcurrency: positiveInt(env, "KIPSCOPE_QUERY_CONCURRENCY", DEFAULT_QUERY_CONCURRENCY[source.kind])` with `export const DEFAULT_QUERY_CONCURRENCY = { clickhouse: 4, adx: 8 } as const`. The queue, its classes and the kept slot are unchanged (`kept` stays 1, so 7 slots for below-`interactive` work).

Why 8 of 8–12: after A2 one series request is one query, so the report's 6 requests in flight plus the extents of an open fit in 8 slots without waiting; 8 is twice today's sized-for-ClickHouse value. **Off by ×2:** 4 is today's measured queue wait; 16 would let one user's open send 16 concurrent queries to a shared cluster, which risks the cluster's own request throttling on a small SKU and multiplies across users (the queue is per server, not per user), so the higher value is left to `KIPSCOPE_QUERY_CONCURRENCY`. The effect is unmeasured locally (the emulator is not the cluster); the ADX testers measures queue wait after release.

### A5: Ping reuse 15 s, reachable results only

`meta.ts`: next to the single flight, keep the last reachable `PingResult` and the time its ping ended; a request within `PING_CACHE_MS = 15_000` of that time answers it as is (same `checkedAt`); otherwise it starts or joins the single-flight ping. A failed ping is not kept, so a request after a failure pings again. Time comes from `Date.now()`, so vitest fake timers drive it. The ping stays outside the queue (already true, see Context); `MetaDeps.ping` keeps its contract.

Why 15 s of 15–30 s, and why only reachable results:

- The report's goal is "≤ 1 ADX ping per 15 s per server regardless of open tabs"; 15 s meets it with the least staleness.
- **Off by ×2:** 30 s would let a dropped tunnel read as reachable up to 30 s longer with several tabs open (a tab's 30 s poll could hit a cache another tab filled just before the drop); 7.5 s would allow up to 4 pings per 30 s with many tabs, still bounded. With one tab nothing changes: its polls are 30 s apart, longer than the reuse, so every poll pings, and the lead's "Tunnel drop on real data" check (35 s waits) still holds.
- A failed result is not reused, so recovery shows at the next poll; an unreachable source costs the cluster nothing.

### A6: P9 finding, no change

The hypothesis "`/api/value`'s edge lookups run without the scope filter" does not hold:

- The route passes the workspace's source scope to both calls (`source.before(ref, t + 1n, scope, …)`, `source.after(ref, t + 1n, scope, …)`), and the ADX `edge` applies `scoped()`: data ref `== sref` and time `>= sfrom`, `< sto` on the table before any other operator. `adx.test.ts` › "scopes every query by data ref and time" checks exactly this for `before` and `after`. In scoped mode a call without a scope cannot reach the source (guard). `raw` is bounded by the request's range, the edges by the scope; for a handed-over session that scope is the session ± `KIPSCOPE_SCOPE_PAD` (1 h).
- Likely causes of the p90 of 18.4 s, outside this cut: (1) `/api/value` waits for gap info (D-062; D-081 consequence: "`/api/value` … still wait for gap info"); on a cold gap cache that is a `loggerGaps` over the scope or work window, which the guide estimates at 7.2 s on a large table; (2) queue wait behind the series waves at 4 slots (A4 helps); (3) the cluster's 3–6× spread for one query shape. 
- One observation for a later change: in an object scope (after Unlink, D-086) the scope is the vehicle's whole extent, so `before`/`after` may scan that signal's whole history for their `top 1`. Bounding them by the work window would change which value a cursor next to a long silence reads, so it needs Jan; it does not apply to the report's session opens.
- What would settle it: the ADX testers' log of `/api/value` with queue wait and the gap cache state per request.

No task follows from P9.

### A7: Evidence without a cluster

- **Query counts and KQL shape** on a fake Kusto client (records each `query(csl, params)`, answers canned rows of A1 (`extent`) and A3 (`series`)) in a new `apps/server/test/adxQueries.test.ts`, which `pnpm test` runs (the name does not match the `adx` excludes).
- **Answers** in the conformance suite (ClickHouse test DB in `pnpm test`, emulator in `test:adx`) and native-vs-fallback JSON identity on the emulator (`adx.test.ts`).
- **ClickHouse unchanged** by the existing suite plus "No native series on ClickHouse" and the fallback-steps test.
- **Docs:** the guide's measured-cost column gets the emulator numbers for `extent` and `series` native → fallback (informative, not a gate). Method of the `series` figures (2026-10-22): warm medians of 3 runs of native `AdxSource.series` against `completeSource(coreOnly(adapter)).series` on the same requests, on a temporary emulator database `kipscope_perf` holding only `SIG_A` (about 7.2 M rows, dropped afterwards). The absolute times are not comparable with the 2026-10-17 rows, which used the 21.6 M-row data set.

## Risks / Trade-offs

- **The combined query evaluates the range twice** (count, then the branch). On the cluster the round trip dominates; on a very long raw range near the target the second scan is small. If the emulator shows the dead branch scanning anyway, the answer is still correct; record the timing in the guide.
- **Contract grows an optional method** (8 optional instead of 7, D-074 lists 7). It is optional, has a fallback, and the conformance suite checks it on both adapters; adapter authors read it in the guide.
- **Queue width 8 is a guess for the cluster**; the override stays.

## Open questions (Jan)

None. Q-1 (native ADX `count`) is resolved by D-097: dropped; ADX gets native `extent` and `series` only. D-097 also records the ADX queue default 8.

## Out of scope

Everything in the proposal's non-goals, plus: a native `series` for ClickHouse, a native `count` or `refExtent` on ADX, bounding edges by the work window in an object scope (A6), changing when `/api/value` waits for gap info, the web's meta polling rate, and any new log field for queue wait.
