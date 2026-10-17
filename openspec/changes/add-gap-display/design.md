# Design: add-gap-display

## Jan's decision (D-062, quoted)

- „A line breaks where the logger recorded nothing at all (every signal), and where a cyclic signal skips more than 3 of its periods (period from the DBC, the diagnostic catalog, else measured). Signals without a known or measurable period break only at logger gaps. The same holds for buckets when zoomed out."
- „Gaps stay blank; logger gaps also get a faint grey band so "no data" reads as intended."
- „A cursor (A, B, L) inside a gap shows „no data", never a value interpolated across it."

## Context

Measured on carserver (read-only, 2026-10-16, smart451, 131 M timestamped rows, 553 signals, 2026-10-11 12:34 – 2026-10-16 09:52 UTC):

- **The logger is off most of the time.** Only 93,220 of ~425,000 seconds hold a row. Silences of at least 2 s: 24; of them 22 last 1,229 s to 99,561 s (car off), two lie inside drives (9.08 s at 2026-10-11 13:41:34, 3.05 s at 2026-10-13 09:27:53.936). At 100 ms resolution there are 46 silences of 0.2 s or more, 27 of 1 s or more, 23 of 5 s or more, 22 of 10 s or more: nothing between 10 s and 20 min. While the logger runs it writes ~30–60 rows/s even when parked, so a silence of 2 s is never normal operation.
- **Cyclic CAN signals keep their DBC period.** In the drive 2026-10-13 09:28–10:13 UTC: `MS_312h.DNMOT` (10 ms) spacings p0.1/p50/p99.9 = 7/10/13 ms; `BS_200h.DVL` (20 ms) 19/20/21; `COMBI_412h.V_ANZ` (100 ms) 99/100/103; `CPC_168h.IgnCurMode` (100 ms) 99/100/101; `PNHV_STAT…` (200 ms) 198/200/202; `OCM_A1.OCM_Id` (1000 ms) 1000/1002/1313. Spacing > 3 P: 7, 9, 4, 6, 4, 2 times in 45 min; > 2 P: the same counts (±1); > 1.5 P: 13, 11, 4, 8, 4, 3 (jitter). The first 1,000 spacings of one signal of each of the 42 messages with a cycle time: median = DBC period for 41 (EWM_230h sends at 10 ms, DBC says 20), spacings > 3 P ≤ 0.9 %.
- **Over the whole recording:** `MS_312h.DNMOT` has 35 spacings > 3 P (24 of them the ≥ 2 s logger silences, 11 dropouts of 30 ms–2 s, e.g. 09:34:36.210–09:34:36.998), 35 > 6 P, 41 > 1.5 P; `COMBI_412h.V_ANZ` 32 / 31 / 32; `OCM_A1.OCM_Id` 26 / 23 / 30.
- **Diag readings keep their group interval:** `BMS.current` and `BMS.contactor` (group `10s`): median 10.028 s, p90 10.07 s, 16 spacings > 15 s, all ≥ 23.7 s (2.4 P, one missed poll pair) and 15 of them ≥ 99 s; `BMS.soc` (`30s`) median 30.05 s; `BMS.isolation_resistance` (`60s`) 60.1 s. The manifest calls `interval` "advisory"; it matches. The 93 `BMS.cell_voltage.NNN` (group `DT_Single_Cell_Voltage_Internal`, `never`) are polled every ~502 ms anyway.
- **Event and one-shot signals:** `D_RS_BMS.D_RS_BMS` comes in bursts (median 2 ms, 12.4 % of spacings > 6 ms); `VIN.VIN_DATA`/`VIN_MSG` median 20 ms, 33 % > 60 ms; `MS_101h.FBS` 50 rows in total; 12 `D_RS_*` one row each.
- **Period sources on smart451 (catalog on the dev server):** DBC cycle time 408 signals (42 messages); diag interval 29; neither 116 (93 cell voltages, 3 `never` BMS fields, 20 DBC signals without cycle time). Measured with G3: 94 accepted (93 cell voltages ≈ 502 ms, `MESS_CPC` 10 ms), 22 refused.
- **Code today:** `/api/series` returns raw points with edge neighbours or non-empty buckets; the chart (uPlot, `spanGaps: false`) breaks only at `null` (SNA) and bridges empty buckets (alignment `undefined`); `evaluateAt` (packages/shared `cursor.ts`) interpolates or holds between any two neighbours; legends A/B and the values window read `/api/value` (D-031), L and drags read the drawn data (`chartValueAt`).

## Goals / Non-Goals

**Goals:** D-062 as quoted, in every timeseries window, raw and aggregated, and in every cursor value (legends, values window, live cursor, `kipscope value`); gaps identical with and without the tile cache; the cost bounded to two light queries per data ref and catalog load, plus one metadata count per data ref every 5 min and a recompute after new rows (G9).

**Non-Goals:** see the proposal's Out of scope. In particular no change to SNA classification, to series queries or to the time strip.

## Decisions

### G1: Types (pinned, new `packages/shared/src/gaps.ts`; `signals.ts`; `cursor.ts`)

```ts
// gaps.ts
/** D-062: a split needs more than this many periods between two points. */
export const GAP_PERIODS = 3;
/** Shortest logger gap: 2 s (G2). */
export const LOGGER_GAP_MIN = 2_000_000_000n;
/** Grid of the logger-gap query; must be ≤ LOGGER_GAP_MIN / 2 so every gap is found exactly (G2). */
export const LOGGER_GAP_GRID = LOGGER_GAP_MIN / 2n;
/** Rows read per signal to measure a period (G3). */
export const PERIOD_SAMPLE_ROWS = 1001;
/** A measured period needs at least this many spacings. */
export const PERIOD_MIN_SPACINGS = 100;
/** …and at most this share of spacings longer than GAP_PERIODS medians. */
export const PERIOD_MAX_LONG_SHARE = 0.05;

export type PeriodSource = "dbc" | "diag" | "measured";
/** Decimal ns. */
export interface SignalPeriod { ns: string; source: PeriodSource }
/** From the earlier row's time to the later row's time, decimal ns. */
export interface LoggerGapJson { from: string; to: string }
/** Body of GET /api/gaps (G6). */
export interface GapInfo {
  dataRef: string;
  /** The data ref's last row time when computed; absent without rows. Later rows have no known logger gaps. */
  through?: string;
  /** Time order, not overlapping. */
  logger: LoggerGapJson[];
  /** Signal ID → period, for every catalog signal of the data ref that has one. */
  periods: Record<string, SignalPeriod>;
}

export interface LoggerGap { from: bigint; to: bigint }
/** What the gap rule needs for one signal; `logger` sorted by `from`. */
export interface SignalGaps { period?: bigint; logger: readonly LoggerGap[] }
export const NO_GAPS: SignalGaps; // { logger: [] }
/** A split pair (G4): the kind for the reason, and how long the earlier value may be held. */
export interface Split { kind: "logger" | "period"; holdEnd: bigint }

/** dbc.cycleMs, else diag.intervalMs, in ns; undefined when neither (G3). Pure. */
export function staticPeriod(info: SignalInfo): { ns: bigint; source: "dbc" | "diag" } | undefined;
/** G3; sorts a copy; undefined when not measurable. Pure. */
export function measurePeriod(times: readonly bigint[]): bigint | undefined;
/** The earliest logger gap with from < q and to > p; binary search. Pure. */
export function loggerGapBetween(p: bigint, q: bigint, logger: readonly LoggerGap[]): LoggerGap | undefined;
/** The logger gap with from < t < to. Pure. */
export function loggerGapAt(t: bigint, logger: readonly LoggerGap[]): LoggerGap | undefined;
/** G4. Pure. */
export function splitPoints(p: bigint, q: bigint, gaps: SignalGaps): Split | undefined;
/** G5, buckets starting at s1 < s2 of width w. Pure. */
export function splitBuckets(s1: bigint, s2: bigint, width: bigint, gaps: SignalGaps): Split["kind"] | undefined;
/** The SignalGaps of one signal from a GapInfo (decoded once per GapInfo, WeakMap); NO_GAPS for undefined. */
export function signalGaps(info: GapInfo | undefined, signalId: string): SignalGaps;

// signals.ts
DbcInfo.cycleMs?: number;     // GenMsgCycleTime of the signal's message, ms, > 0 (signal-catalog "Message period from the DBC")
DiagInfo.intervalMs?: number; // the group's interval, ms, > 0 ("Group interval from the diagnostic catalog")

// cursor.ts
export type NoValueReason =
  | "no_data" | "before_first" | "after_last" | "next_sna" | "logger_gap" | "period_gap";
export function evaluateAt(
  t: bigint, mode: ValuesMode, at: Point | undefined, next: Point | undefined,
  named?: (p: Point) => boolean,
  gaps?: SignalGaps,            // new, last; absent = today's behaviour
): CursorValue;
```

All exported from the package index. `period`, `ns` and times travel as decimal strings like `Density` (they exceed 2^53 ns).

### G2: Logger gaps (pinned)

**Definition:** two consecutive timestamped rows of the data ref (any signal, the signals table only, not `sdlog.events`) at least `LOGGER_GAP_MIN` = 2 s apart; the gap runs from the earlier row's time to the later row's time.

**Finding them exactly and cheaply:** group the data ref's rows on the floor grid `k × g` (g = `LOGGER_GAP_GRID` = 1 s) keeping each non-empty bucket's earliest (`lo`) and latest (`hi`) row; a gap is a pair of consecutive non-empty buckets with `lo₂ − hi₁ ≥ 2 s`. Complete: a silence of at least 2 g contains one whole grid bucket, so its bounding rows are the `hi` and `lo` of consecutive non-empty buckets. Exact: those are real row times. Silences shorter than 2 s may also show up as consecutive buckets and are dropped by the filter. The floor grid (`x − positiveModulo(x, g)`) keeps buckets before 1970 one width wide (series-query "Floor grid before 1970").

```sql
-- DataSource.loggerGaps (ClickHouse); columns through the table mapping
SELECT toString(prev_hi), toString(lo), toString(last), rn FROM (
  SELECT lo, lagInFrame(hi) OVER w AS prev_hi, row_number() OVER w AS rn, max(hi) OVER () AS last
  FROM (
    SELECT x - positiveModulo(x, {g:Int64}) AS b, min(x) AS lo, max(x) AS hi
    FROM (SELECT toUnixTimestamp64Nano(<time>) AS x FROM <table>
          WHERE <dataRef> = {ref:String} AND <time> IS NOT NULL)
    GROUP BY b)
  WINDOW w AS (ORDER BY b ROWS BETWEEN 1 PRECEDING AND CURRENT ROW))
WHERE rn = 1 OR lo - prev_hi >= {min:Int64}
ORDER BY lo
```

The `rn = 1` row only carries `last` (for `through`) and is never a gap. carserver: 7.2 s, 14 MB server memory, 24 gaps; the same full scan as the density's bar query, once per catalog load.

**Why not reuse the density grid (9 s at 1 h bars):** it grows with the recording's length (`DENSITY_WIDTHS / 400`) and gives no row times, so the minimum gap would drift and the edges would be off by up to 9 s at ms zoom; reading `min`/`max` on it would still miss gaps below 18 s. A fixed 1 s grid with exact edges costs one more scan per catalog load.

### G3: Periods (pinned)

Order per signal (data-gaps "Period of a signal"): `dbc.cycleMs` (> 0) → source `dbc`; else `diag.intervalMs` → `diag`; else measured → `measured`; else none.

**DBC** (`apps/server/src/dbc.ts`, in `parseDbc` on the already decoded text): `/BA_\s+"GenMsgCycleTime"\s+BO_\s+(\d+)\s+(\d+)\s*;/g` → message ID (as written, like `messageId`) → ms; `/BA_DEF_DEF_\s+"GenMsgCycleTime"\s+(\d+)\s*;/` → default (0 when absent). The closing quote keeps `"GenMsgCycleTimeActive"` out. Every signal of a message gets `cycleMs` = own value ?? default when > 0. A signal's entry comes from the first file that defines it (unchanged), its cycle time from the same file. `catalog.ts` copies `cycleMs` into `DbcInfo`.

**Diag catalog** (`apps/server/src/diag.ts`): the manifest group gains optional `interval: string` in the zod shape; `/^(\d+(?:\.\d+)?)(ms|s|min|h)$/` → ms (rounded to an integer, > 0); `never` or absent → none, silently; other text → none and one warning `diag catalog: <file>: group <name>: interval "<text>" not understood` through the existing per-load warning path. Each `DiagInfo` gets its group's `intervalMs`.

**Measured** (`measurePeriod`): sort the up to `PERIOD_SAMPLE_ROWS` times; spacings `d` between neighbours; `m` = median of the positive spacings (the element at index `floor(n/2)` of the sorted positive spacings); accept `m` when `d.length ≥ PERIOD_MIN_SPACINGS` and `count(d > GAP_PERIODS × m) ≤ PERIOD_MAX_LONG_SHARE × d.length`. Duplicate times (spacing 0) count as spacings, not as long ones. On smart451 this accepts 94 of 116 (G-context) and refuses every burst and one-shot signal.

```sql
-- DataSource.firstTimes: one query for all signals of a data ref without a static period
SELECT <signal>, groupArray(toString(toUnixTimestamp64Nano(<time>))) FROM (
  SELECT <signal>, <time> FROM <table>
  WHERE <dataRef> = {ref:String} AND <signal> IN {names:Array(String)} AND <time> IS NOT NULL
  ORDER BY <signal>, <time> LIMIT {rows:UInt32} BY <signal>)
GROUP BY <signal>
```

carserver, the 115 smart451 names: 0.17 s, 1.9 MB server memory, 2.1 MB answer (it reads all rows of the listed signals in key order, 3.8 M). No query when no signal needs measuring.

### G4: Split between two points (pinned, `splitPoints`)

For consecutive points `p < q` of one signal (edge neighbours included):

- `g = loggerGapBetween(p, q, logger)`; `periodSplit = period !== undefined && q − p > GAP_PERIODS × period`.
- Neither → no split. Else `kind = g ? "logger" : "period"`, `holdEnd = min(g ? g.from : ∞, periodSplit ? p + period : ∞)`.

`holdEnd ≥ p` always, and `holdEnd + 1 < q` (a logger gap is ≥ 2 s and lies within `[p, q]`; a period split leaves more than 2 P after `p + P`), so the inserted points of G7 keep x strictly ascending.

**evaluateAt with `gaps`** (order of checks; steps 1–3 unchanged):

1. no `at` → `before_first` / `no_data`; 2. `at.t === t` → `raw` / `sna`; 3. no `next` → `after_last`;
4. `s = splitPoints(at.t, next.t, gaps)`; if `s`: when `t ≤ s.holdEnd` and `at.v === null` → `sna`; when `t ≤ s.holdEnd` and (`mode === "step"` or `named(at)` or `named(next)` with `next.v !== null`) → `held` (value `at.v`); otherwise `{kind: "none", reason: s.kind === "logger" ? "logger_gap" : "period_gap"}`;
5. no split → today's rules (SNA, held, `next_sna`, interpolated).

**Why the hold end:** a step shows "the value until the next point"; across a gap the next point is not the next state. A cyclic value is known for one period after it was sent; an event signal's value is known as long as the logger ran (an unlogged change is impossible while it records). So a step holds `P` at most, and never into a logger gap.

### G5: Split between two buckets (pinned, `splitBuckets`)

For consecutive non-empty buckets starting at `s1 < s2`, width `w`:

- period: `period !== undefined && s2 − (s1 + w) > GAP_PERIODS × period` → `"period"`;
- else logger: `loggerGapBetween(s1 + w/2, s2 + w/2, logger)` → `"logger"`;
- else none.

The empty stretch `s2 − (s1 + w)` is a lower bound of the real spacing (the real one is at most `+ 2w` longer), so a period split is certain and never invented; a slow signal's empty buckets stay joined (BMS.soc, 30 s, at 5 ms buckets: stretch < 30 s). The logger rule says "no drawn segment crosses a logger gap", which keeps curves and bands consistent at every zoom. A gap inside a bucket that it does not leave (period split narrower than the bucket) is not visible at that zoom: the bucket mean stands for its whole width (concept §6, accepted semantics).

### G6: Server (pinned, new `apps/server/src/gaps.ts`, `routes/series.ts`, `datasource.ts`, `clickhouse.ts`)

```ts
// datasource.ts, DataSource gains
/** G2: consecutive timestamped rows of the data ref ≥ minGap apart, exact, time order, found on the floor grid `grid` (≤ minGap / 2); `last`: the data ref's last row time, undefined without rows. */
loggerGaps(dataRef: string, grid: bigint, minGap: bigint, abort?: AbortSignal):
  Promise<{ gaps: { from: Timestamp; to: Timestamp }[]; last?: Timestamp }>;
/** G3: up to `rows` timestamps of each named signal of the data ref (any order); signals without rows absent; no query for []. */
firstTimes(dataRef: string, names: readonly string[], rows: number, abort?: AbortSignal):
  Promise<Map<string, Timestamp[]>>;

// gaps.ts
export class GapCache {
  constructor(
    source: Pick<DataSource, "loggerGaps" | "firstTimes">,
    catalog: { readonly loadedAt: Date | undefined; all(): readonly SignalInfo[] },
  );
  /** Once per catalog load and data ref, shared, failure not kept (like DensityCache). */
  get(dataRef: string): Promise<GapInfo>;
  /** Computes each data ref in turn; a failure goes to `warn`; a newer catalog load stops the run. */
  prefetch(dataRefs: Iterable<string>, warn: (message: string) => void): Promise<void>;
}
```

`compute(dataRef)`: `loggerGaps(dataRef, LOGGER_GAP_GRID, LOGGER_GAP_MIN)` and, for the catalog signals of the data ref without `staticPeriod`, `firstTimes(dataRef, names, PERIOD_SAMPLE_ROWS)` (the two run in parallel through the query queue); periods = static ones plus accepted measured ones, keyed by signal ID; the computation ignores client aborts (shared).

Routes (`seriesRoutes`, next to the `DensityCache`): one `GapCache`; after each catalog load the density prefetch runs first, then `gaps.prefetch(dataRefs)`, so carserver sees one full scan at a time.

- `GET /api/gaps?dataRef=`: zod `{dataRef: string.min(1)}` → 400 `invalid_request`; no catalog yet → 503 `catalog_unavailable` (as `/api/series`); catalog has no signal of the data ref → 404 `unknown_data_ref`; computation fails → 502 `source_error`; else the `GapInfo`.
- `GET /api/value`: `gaps.get(info.dataRef)` runs in parallel with `before`/`after`; its failure → 502 `source_error` with `signalId`; `evaluateAt(t, mode, at, next, named, signalGaps(info, signalId))`. Body unchanged apart from the new reasons.
- `/api/series`, `/api/density`, `/api/extent`: unchanged.

### G7: Web (pinned, new `apps/web/src/chart/gaps.ts`; `api.ts`, `chart/build.ts`, `chart/readout.ts`, `chart/TimeseriesWindow.tsx`, `values/format.ts`, `styles.css`)

**Gap info:** `api.ts` `fetchGaps(dataRef, signal?) → GapInfo`. `chart/gaps.ts`: one module-level cache per browser tab `Map<dataRef, GapInfo>` (like the strip's densities), one request in flight per data ref shared by all windows, a failure kept as an error and retried after `GAP_RETRY_MS = 30_000` while any window still asks for that data ref; hook `useGapInfo(dataRefs: readonly string[]) → { infos: ReadonlyMap<string, GapInfo>; errors: { dataRef: string; message: string }[]; settled: boolean }` (`settled`: every data ref loaded or failed). Pure `bandsIn(logger: readonly LoggerGap[], from: bigint, to: bigint) → LoggerGap[]` (gaps that meet the view, clipped to it).

**Breaks in `buildModel`** (`SignalInput` gains `gaps?: SignalGaps`; absent = `NO_GAPS`):

- Raw: over the decoded times of `[before, …points, after]`, for each consecutive pair with `s = splitPoints(p, q, gaps)`: insert after `p` — in step path, when `p` is valid and `s.holdEnd > p`, a hold point `(holdEnd, p.v)`; then, in every path, a break `(holdEnd + 1, null)`. Inserted before `holdBeforeSna`, which only acts on the result's own SNA points (a gap break is never moved or held into).
- **Every hold obeys G4, state signals included.** add-events draws signals with named states as steps (each point holds to the next) and, for a view without a point of such a signal, adds a synthetic point holding the edge level across the view (`holdAcrossRange`, being generalised to a step rule). Both are holds: a state signal's step segment from `p` ends at `splitPoints(p, q).holdEnd` when `p` and `q` are split, followed by the break; the synthetic edge hold runs from `before` only up to `min(view end, holdEnd)` of the pair (`before`, `after`), with a break after it when split, and is not drawn past the hold end. So a state signal is blank inside a logger gap and beyond one period after its last point (smart451: `CPC_168h.IgnCurMode`'s 51.7 h hold over car-off logger gaps becomes at most 100 ms of hold, then blank). The readout already follows G4 (named → held only up to the hold end).
- Buckets: for each consecutive pair with `splitBuckets(s1, s2, w, gaps)`: insert `(s2, null)` in the mean, min and max columns (`s2` lies between the two bucket centres).
- `snaPeriods(result, origin, gaps?)`: a raw SNA point's period ends at `min(next, holdEnd)` when it is split from the next point; buckets unchanged.
- `isolatedPoints` and `seriesOptions` unchanged: the inserted nulls make a point between two splits isolated, so it gets its marker.

**Drawn value** (`chartValueAt(result, t, mode, info?, gaps?)`): outside `[from, to)` → `outside_range` (unchanged); raw → `evaluateAt(…, gaps)` with the edge neighbours (as today plus `gaps`); buckets: `loggerGapAt(t)` → none `logger_gap`; inside a non-empty bucket → as today; in an empty stretch between buckets `i` and `i+1` → `splitBuckets` kind → none `logger_gap` / `period_gap`, else `empty_bucket`; before the first or after the last bucket → `empty_bucket` (unchanged).

**Cells** (`values/format.ts`): `ValueReason` includes the two new reasons; `REASONS.logger_gap = "no data: the logger recorded nothing"`, `REASONS.period_gap = "no data: more than 3 periods without a point"`; `noValueCell` for these gives `{ text: "no data", title, gap: true }` (new `Cell.gap?: boolean` → class `gap-value`, `color: var(--muted)`); all other reasons stay `—`. `readoutCell`, `formatCell`, `deltaCell`, `readoutDelta` need no other change (Δ is `—` unless both are numbers).

**Window** (`TimeseriesWindow.tsx`): data refs from the signal IDs (`parseSignalId`); `useGapInfo`; each input gets `signalGaps(infos.get(dataRef), signalId)`; the readouts (L, drag preview) pass the same `gaps`. Bands: the union of the logger gaps of the window's data refs, painted in a `drawClear` hook (before grid, event lines of add-events V6, series and SNA lanes) over `u.bbox` in `GAP_FILL = "#f1f5f9"` (canvas hex, like `GRID_STROKE`), each at least 1 CSS px wide (`devicePixelRatio`), recomputed on every redraw (zoom previews included). Settled = today's loader condition `&& gapInfo.settled`; each gap-info error becomes a render error `{ windowId, message: "gap info for <dataRef> unavailable: <message>" }`.

`styles.css`: `--gap-fill: #f1f5f9;` on `:root`; `.gap-value { color: var(--muted); }`.

### G8: CLI (pinned)

No code: `kipscope value` prints the server's `value`. `apps/cli/test/helpers.ts`'s stub source gains `loggerGaps` (testcar: the gap 02:00:02Z–02:00:04Z) and `firstTimes` (empty map), and the point 12 at 02:00:05Z for `testcar/Sna_800h.SPEED` (tester).

### G9: Stale logger gaps (pinned; Jan's report 2026-10-17, lead's diagnosis)

**Defect.** Jan (2026-10-17): „same values are cluttered as dots, which should have a hüllkurve instead? looks strange. I get more data when i zoom in". The gap cache had a logger gap 1792176671171000000 → 1792176763235000000 (2026-10-16 18:51:11.171–18:52:43.235 UTC) for smart451. Carserver holds ~16,200 rows per 10 s throughout it (1,491,779 rows in two parts, one of them `…_4196_4211_3`): a chunk uploaded after the gap info was computed, older than the newest rows. A fresh logger-gap query no longer finds the gap; a server restart fixed the view. With the stale gap every pair of points or buckets inside it was split (offline repro, window 18:51:11.385–18:51:20.691 UTC: 500 `LWS_ANGLE` buckets → 499 breaks, all 500 isolated → markers; `PTC_HV_Volt` 95 points → 94 breaks). A gap info can go stale whenever the logger backfills older time; the proposal's "until the next load" did not foresee backfill.

**(a) Data beats a stale gap (shared, pure; server and web alike).** A real logger gap holds no row (G2), so a sample strictly inside one proves it stale for that pair:

```ts
// packages/shared/src/gaps.ts
/** Refresh interval of the gap info, server poll and web refetch (G9 (b), (c)). */
export const GAP_REFRESH_MS = 300_000;
/** The earliest logger gap with p ≤ from and to ≤ q; binary search. Pure. */
export function loggerGapWithin(p: bigint, q: bigint, logger: readonly LoggerGap[]): LoggerGap | undefined;
/** A sample of `result` lies strictly inside `gap`: a raw point or edge neighbour with from < t < to, or a non-empty bucket [s, s + w) with from < s and s + w ≤ to. Pure. */
export function holdsSample(result: SeriesResult, gap: LoggerGap): boolean;
```

- `splitPoints` (G4): the logger part uses `loggerGapWithin(p, q)` instead of `loggerGapBetween`; a gap that holds `p` or `q` strictly inside does not split them. The period rule is unchanged. `evaluateAt` (server `/api/value`, web raw readouts) follows without change.
- `splitBuckets` (G5): a logger gap overlapping the centres splits two buckets only if neither bucket lies entirely inside it (`from < s && s + w ≤ to`). A bucket straddling a gap edge proves nothing and keeps today's rule.
- `chartValueAt`, buckets: `loggerGapAt(t)` gives `logger_gap` only when `!holdsSample(result, gap)`; otherwise it reads the bucket or the empty stretch as today.
- Bands (`chart/gaps.ts`): `bandsIn(logger, from, to, results: readonly SeriesResult[] = [])` leaves out each gap for which `holdsSample(r, gap)` for some `r` of `results`. `TimeseriesWindow` computes the bands per data ref (its logger gaps, the drawn results of its signals; a sample of another data ref says nothing) and paints their union.
- `buildModel`, `snaPeriods`, `isolatedPoints`: no change; they follow `splitPoints`/`splitBuckets`.

Residue until (b) and (c) catch up: a signal with no sample inside a stale gap (an event signal) still breaks across it, and `/api/value` agrees with the drawn data (both use the pair rule).

**(b) Server keeps the gap info fresh.** New `DataSource.refCount(dataRef, abort?) → Promise<number>`: `SELECT count() FROM <table> WHERE <dataRef> = {ref:String}` (all rows; with the data ref as partition key ClickHouse answers it from part metadata). Measured on carserver 2026-10-17: 3.4 ms, `read_rows` 3, 1.2 MB, 183,517,530 rows. `GapCache`:

```ts
/** One poll (G9 (b)): for each data ref with gap info of the current catalog load, in turn: refCount; when it differs from the count taken before that info was computed, compute anew. The old info stays served until the new one is in; a failure goes to `warn` and keeps the old info; a newer catalog load stops the run. */
refresh(dataRefs: Iterable<string>, warn: (message: string) => void): Promise<void>;
```

`compute` takes `refCount` first and keeps it with the entry (rows inserted during the 9 s computation cause one more recompute at the next poll, never a missed one). Routes: a poll runs `GAP_REFRESH_MS` after the previous poll or the catalog load's prefetch ended (a `setTimeout` chain, stopped on close), so polls never overlap each other or a prefetch, and the server runs at most one gap recompute at a time. Cost: one count query per data ref and 5 min; a full recompute (logger-gap query 9.4 s, 20.5 MB over 174 M rows, first-times 0.17 s) only after new rows, at most once per 5 min: ≈ 3 % of the time while the car uploads, nothing while it does not.

**(c) Web refetches.** `GapInfoStore` refetches a loaded data ref every `GAP_REFRESH_MS` while a window asks for it. The old info stays until the answer arrives and is replaced only when the answer's JSON differs (no redraw otherwise); a failed refetch keeps the old info, raises no render error and is tried again at the next interval; the window stays settled throughout. Staleness after a backfill: at most 5 min (server poll) + one recompute + 5 min (tab refetch), with (a) covering the drawing meanwhile.

**Out of scope:** the `LWS_ANGLE` values in that stretch (they really jump ±1,400° every 10 ms; the DBC's SNA raw 32768 decodes to 0° = straight ahead: a CarController DBC issue, reported to Jan); the density (time strip) staleness after a backfill; incremental gap computation.

### T: Test data (pinned, `apps/server/scripts/seed-test-db.ts`, `test/fixtures/test-a.dbc`, `test/fixtures/test-diag.manifest.json`; tester)

New data ref `gapcar` (vehicle `gapcar`, device `test-gap`, chunk `g1`), base G = 2026-10-03T00:00:00Z, all rows in [G, G + 10 min). Rows of no gapcar signal lie in [00:05:00, 00:06:00) (logger pause P1), in the open interval (00:09:30.000, 00:09:31.900) (silence S1, 1.9 s, not a logger gap) or in the open interval (00:09:40.000, 00:09:42.000) (logger pause P2, exactly 2.0 s).

| Signal | Rows | Values |
|---|---|---|
| `Cyc_B10h.CYC` (DBC, cycle 20 ms) | every 20 ms (n = 0 … 29,999) except P1, S1, P2, the open interval (00:02:00.100, 00:02:00.600) (dropout, 24 rows) and the rows at 00:03:00.120 and 00:03:00.140 (a spacing of exactly 3 P): 26,781 | n mod 100 |
| `Evt_B11h.EVT` (DBC, cycle 0) | 00:00:30, 00:04:00, 00:07:00, 00:09:00 | 1, 2, 3, 4 |
| `Msr_B12h.MSR` (not in any DBC) | every 100 ms except P1, S1, P2 and the open interval (00:08:00.000, 00:08:01.000) (9 rows): 5,354 | n mod 10 |
| `TBMS.current` (diag `DT_Pack`, `10s`) | every 10 s from 00:00:00 to 00:09:50 except P1 and 00:01:10, 00:01:20, 00:01:30, 00:01:50, 00:02:00, 00:02:10: 48 | 12.5 |

Expected: logger gaps exactly 00:04:59.980–00:06:00.000 and 00:09:40.000–00:09:42.000; `through` 00:09:59.980; periods CYC 20 ms `dbc`, MSR 100 ms `measured`, TBMS.current 10 s `diag`, EVT none. testcar keeps no logger gap (`Fast_100h` every 5 ms over 10 h). Catalog 1,021 → 1,025 signals (tests that assert 1,021, among them add-events' "lists 1,021 signals", move to 1,025).

`test-a.dbc` (keep ISO-8859-1 and CRLF) gains `BO_ 2832 Cyc_B10h: 8 VCU` with `SG_ CYC : 0|8@1+ (1,0) [0|255] "" VCU`, `BO_ 2833 Evt_B11h: 8 VCU` with `SG_ EVT : 0|8@1+ (1,0) [0|255] "" VCU`, `BA_DEF_ BO_ "GenMsgCycleTime" INT 0 65535;`, `BA_DEF_DEF_ "GenMsgCycleTime" 0;`, `BA_ "GenMsgCycleTime" BO_ 2832 20;`, `BA_ "GenMsgCycleTime" BO_ 2833 0;`. `test-diag.manifest.json`: group `DT_Pack` gets `"interval": "10s"`, `DT_Cell` `"interval": "never"`. `globalSetup.ts` checks the newest seed data (`SELECT count() FROM sdlog.signals WHERE vehicle = 'gapcar'` = 32,187) to catch a stale test DB. The seed's header comment lists the new data. HTTP tests that need diag periods build the catalog with `testDiagCatalogs`.

## Numbers: what if off by a factor of two

- **GAP_PERIODS 3** (Jan's): 1.5 → 6 more DNMOT breaks over the recording (41 vs 35), 8 more cell-voltage breaks (17 vs 9): jitter and single missed polls start to break lines. 6 → DNMOT 35, V_ANZ 31 (vs 32), OCM 23 (vs 26), BMS.current 15 (vs 16): a few short dropouts are bridged. Jitter stays ≤ 1.3 P at p99.9 on all measured CAN signals, so 3 is far from both.
- **LOGGER_GAP_MIN 2 s:** 1 s → 27 gaps (+1.0, 1.3, 1.8 s silences); 4 s → 23 (−2.9 s). All are real silences; cyclic signals break there anyway by the period rule, so the choice only decides about bands and event signals. 2 s is 30–120 rows of the parked trickle.
- **LOGGER_GAP_GRID 1 s:** must stay ≤ G/2 (completeness, G2); 0.5 s → twice the groups (~190 k on smart451, memory still ≪ 100 MB), same result; 2 s would miss silences of 2–4 s that straddle a bucket edge.
- **PERIOD_SAMPLE_ROWS 1,001:** 501 → cell voltages still 500 spacings, same result; 2,001 → answer ~4 MB, same result.
- **PERIOD_MIN_SPACINGS 100:** 50 → `MS_101h` (49 spacings) and `SAM_560h` (47) still refused by size, and anyway by their 14–15 % long spacings; 200 → `BMS.current` (374) would still pass if it had no interval.
- **PERIOD_MAX_LONG_SHARE 5 %:** 2.5 % → all accepted signals have 0 %; 10 % → `D_RS_BMS` (12.4 %) still refused. 
- **Band at least 1 px, `#f1f5f9`:** 2 px → a 3 s gap in a day view looks like a 10 min one; slate-200 → competes with grid lines (`#e2e8f0` is the border colour).
- **Retry 30 s:** the density's; 15 s / 60 s change only how fast a recovered server shows breaks.
- **GAP_REFRESH_MS 5 min (G9):** 2.5 min → count queries 2× (≈ 1.4 ms/min, negligible), recomputes at most 2× while uploading (≈ 6 % of carserver's time in the logger-gap scan); 10 min → a stale band or event-signal break lasts up to ~20 min in an open tab. (a) keeps the curves right either way, so the interval only bounds band and event-signal staleness. A recompute grows with the recording (9.4 s at 174 M rows); if it exceeds 30 s (≥ 10 % at 5 min), report a finding (incremental computation is out of scope).

## Risks / Trade-offs

- [A DBC cycle time slower than the real sending] → every spacing exceeds 3 P and the line becomes markers. 0 of 42 messages on smart451 (one is faster, which only bridges dropouts of 30–60 ms). A finding goes to Jan if one appears.
- [Gap info is computed per catalog load] → rows written later, even backfilled older ones, were unknown until the next load; G9 polls the row count every 5 min, recomputes on a change, and lets drawn samples void a stale gap meanwhile.
- [One more full scan per catalog load] → 7 s on carserver, after the density, in the background; a value request before it finishes waits for it (once).
- [`firstTimes` reads all rows of the sampled signals] → 3.8 M rows today; grows with the recording (≈ 10× in 50 days). Fallback if it ever gets slow: one `ORDER BY time LIMIT 1001` query per signal (read in key order, ~10 ms each).
- [Line mode next to a state name] → the readout holds up to the hold end (G4), the drawn line stops at the point (no hold drawn in line mode); within one period only.
- [Drawn without breaks until the gap info arrives] → normally prefetched and in the tab cache; `--wait` and the render acknowledgement wait for it, so screenshots and the CLI see the final drawing.
- [Test suite time] → each test app also prefetches gap info for all seeded data refs (≈ 1–2 s of background queries per app on the local DB). If the suite slows by more than 20 %, the tester reports it; the lead decides on an app option to skip prefetching in tests.
- [add-events scenario "Readouts on smart451"] → its B at 10:40 local is in a logger gap; delta `state-names` moves it to 12:13 local (IgnCurMode `NONE` with data, contactor `no data`). Archive add-events first.

## Migration Plan

None. Payloads gain optional fields and two `NoValueReason` values; restart the server; reseed the test DB (`pnpm --filter @kipscope/server seed:test`).

## Manual checks (lead)

- Show Jan the day overview (timeseries-window "Day overview") and the drive band ("Band in a drive") with cursor A in it.

## Ledger entry on archive (proposed for `docs/decisions.md`)

- D-0xx Gap display conventions: logger gap = consecutive rows of a data ref ≥ 2 s apart, found exactly on a 1 s floor grid once per catalog load; period = DBC `GenMsgCycleTime` > 0, else diag group `interval`, else the median spacing of the first 1,001 rows if ≥ 100 spacings and ≤ 5 % longer than 3 medians (smart451: 408 / 29 / 94, 22 none); split = a logger gap between two points or more than 3 periods; a step holds at most one period and never into a logger gap; buckets split only on a certain gap (empty stretch > 3 P, or a logger gap between centres); `GET /api/gaps`; reasons `logger_gap` / `period_gap`, cell text `no data`; band `--gap-fill` `#f1f5f9` under grid and curves.
