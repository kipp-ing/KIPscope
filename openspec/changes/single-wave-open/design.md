# Design

## Context

See proposal.md for the why. Today's per-key flow in `apps/web/src/chart/loader.ts` (window options: `extent`, `prefetch`, `retry`, load interval 100 ms):

1. `show`/`load`: the view's level `L = levelFor(from, to, target)` (D-038), its touched tiles from `cache.find` (stored tile → cut from a coarser raw tile → merged from children up to `MERGE_DEPTH` 2 levels down, Z3); missing tiles go to `cache.load(…, "visible")`, which groups adjacent indices into runs of at most `MAX_RUN_TILES` (64) and sends one `/api/series` per run (`runRequest`: tile-aligned `from`/`to`, target `n × 256 + 1`).
2. `firstViewDone`: only after the key's first view is complete (or failed), `options.extent` → `overviewTiles(first, last)` (level `O = levelFor(first, last + 1, 1025)`, Z2) → `cache.find` per overview tile, missing ones `cache.load(…, "prefetch")`.
3. `maybePrefetch` (300 ms after rest, Z7): next coarser level over three view widths and the own level one view width each side, minus found, unstorable, outside-scope and out-of-extent tiles.

The report's chain decodes as run targets `n × 256 + 1`: 769 = the view's 3-tile run, 1281 = the overview's 5-tile run (a 37-min drive: `O` = 31, tile 550 s), 257 = the prefetch's coarser-level edge tile whose two children are not both cached. In that open `L` = 32 > `O`: the overview alone holds everything the view draws. Z2 already meant the full-extent view of a window about 1,000 px wide to be served by the overview; the order (view first) prevents it.

The server's rule (`apps/server/src/series.ts` `querySeries`, series-query "Resolution-aware request"): raw with edge neighbours iff the range, cut to the scope, holds at most `target` points (valid and SNA), else buckets of `bucketWidth(0, span, target)`; for a tile-aligned run that width is `2^L` (series-query "Reusable buckets for aligned requests"). Edge neighbours stay inside the scope.

How a step sets ranges (`packages/shared/src/caseApply.ts` `caseRanges`): linked, each window keeps its offset from the alignment point and its span, moved onto the target's point and clamped into the target scope (`clamped`); unlinked, its `linkedRanges` or the whole scope. So after a step the view equals the scope only by accident; W7 handles every case.

## Goals / Non-Goals

**Goals:** one `/api/series` per window signal on an open or an un-preloaded step whose view spans the signal's extent, the extent before it; zooms and the prefetch at or above a held cover's level without requests; the drawn data unchanged (W1).

**Non-Goals:** see proposal ("Non-goals"). In particular no new constant, no server or `packages/shared` change, no change to case-preload, to background tabs (series load only once the window has a width, `TimeseriesWindow.tsx` unchanged), or to the cache's existing `find` rules.

## Decisions

### W1: What "same drawn data" means

1. **Level:** every view is drawn at `L = levelFor(view.from, view.to, target)` (D-038, unchanged); a placeholder (Z4) as today. A cover's level is never drawn in place of `L` (a coarser cover is never used for a finer view; W3).
2. **Cache hits as today:** a tile `cache.find` answers (stored, cut from a coarser raw tile, merged) is used exactly as today, including D-039's known warm-cache effect (a sparse view's raw vs buckets can depend on what was loaded before).
3. **Requested runs replaced only by equal ones:** where today's loader would request a run (`runsOf` of the missing indices, W4), this change either requests it as today or computes it with `deriveRun`, and computes it only when the result equals the server's answer to `runRequest(signalId, level, first, last)` under the scope: raw exactly when the run's points (valid and SNA) under the scope are at most `(last − first + 1) × 256 + 1`; raw points, `text`, `before` and `after` identical; buckets of width `2^level`, `count`, `sna`, `min`, `max` identical, `mean` within relative 1e-12 (float summation order, as Z3). `splitRun` of both is the comparison.
4. **The open's first draw equals today's cold open:** the view runs a waiting load recorded as missing (W5) are computed from the overview directly, not through `find` over the freshly stored overview tiles (for `L` in `O+1 … O+2`, `find` would merge two raw overview tiles into raw even where the server answers the view's run with buckets; for `L = O` the stored overview tile came from the overview's run, not the view's). The computed run is stored over the overview's tiles of the same IDs, which is the state today's cold open ends in (its view run is stored first and the overview's `find` reuses it).

Evidence of W1: `tiles.test.ts` (computed equals the fake server per run) and `loader.test.ts` › "draws on open what a loader without overview draws" (whole loader, against a loader without options on its own cache, which is today's cold path).

### W2: Extent first, then one decision per key

With `options.extent`, `load(request)` for a tileable view that the cache and the key's covers (W3) cannot answer completely, for a signal whose extent this key does not know yet under the current scope, starts the extent (`options.extent(signalId)`, per-scope store in `chart/overview.ts`, unchanged), records `{seq, view, missing}` as the key's waiting load, and returns (state `loading` with placeholder or previous result, as today). The throttle (Z1) counts it as started. A view complete from the cache is drawn before any of this (scenario "Cached view does not wait").

When the extent resolves and the key's sequence number is still the recorded one, the loader decides with `O`, the overview range `R = overviewTiles(first, last)` and the view's level `L`:

| Case | Condition | Requests | Then |
|---|---|---|---|
| A | `tileable(R)` and `L ≥ O` | the overview's tiles `cache.find` does not answer, as **visible** under the overview owner | when all arrived: compute the recorded missing runs from the overview (W1.4); a run `deriveRun` refuses is requested visible under the key's owner |
| B | `tileable(R)`, `L < O`, and the view's touched tiles span the extent (`view.first × tileSpan(L) ≤ first` and `(view.last + 1) × tileSpan(L) > last`) | the view's missing tiles, visible, as today | when the view is complete: the view's tiles are the key's cover (W3); overview tiles from `find`, else computed from the cover per `runsOf` of the still-missing overview indices and `put`, else `cache.load(…, "prefetch")` |
| C | otherwise (or `R` not tileable) | the view's missing tiles, visible, as today | the overview after the first view, as today (`firstViewDone`) |

Once the extent is known the decision is synchronous, so every later `load` starts within its call (series-cache "Loads during a gesture are throttled" unchanged). An extent that rejects marks the overview failed and loads the recorded view at once (case C); the overview restarts after the next complete view (R6, unchanged). A key whose overview has failed takes case C until that restart.

`L ≥ O` in numbers: the widths compare as `ceil(V / (T − 1))` against `ceil(E / 1024)` (both snapped down to powers of two), `V` the view's span, `E` the extent's, `T` the target (plot width). A view spanning the extent at `T ≤ 1025` always has `L ≥ O` (case A); wider plots take case B. For a narrower view at `T` = 769, `L ≥ O` holds while `V ≥ 0.75 E`.

### W3: Covers

A cover of a signal is a list of contiguous tiles of one level that together hold every point the signal has under the scope (they span the extent; the server cut every tile to the scope). A key holds at most two:

- the overview (level `O`), once all its tiles are known (`overview.tiles`, kept while the key shows the signal, as today);
- the wide view cover (level `L < O`), recorded in case B as `{level, first, last}`; its tiles are looked up with `cache.find` when used; if one is gone, this cover is unusable until the next case B (no request for it).

`coverFor(signalId, level)` (loader-private): the overview if complete and `O ≤ level`, else the wide view cover if `cover.level ≤ level` and all its tiles are found, else none. Both are dropped with the overview (`dropOverview`: key removed, signal rebound, `rescope`, `dispose`).

### W4: Pure functions (pinned, `apps/web/src/chart/tiles.ts`)

```ts
/**
 * Sorted, deduplicated `indices` grouped into runs of adjacent indices, each at most MAX_RUN_TILES
 * long, starting a new run at the lowest index: exactly the runs SeriesCache.load requests.
 */
export function runsOf(indices: readonly bigint[]): { first: bigint; last: bigint }[];

/**
 * The server's answer to runRequest(signalId, level, first, last), computed from `source`, or
 * undefined when it cannot be computed exactly (W1.3). `source`: non-empty, contiguous tiles of
 * one level ≤ `level` in index order that hold every point of the signal under the scope inside
 * the run's span (the caller passes a cover, W3). Raw iff the run's points ≤ the run's target;
 * a raw answer needs every source tile raw, else undefined.
 */
export function deriveRun(
  signalId: string,
  source: readonly Tile[],
  level: number,
  first: bigint,
  last: bigint,
): SeriesResult | undefined;
```

`deriveRun`, with `from = first × tileSpan(level)`, `to = (last + 1) × tileSpan(level)`, `target = (last − first + 1) × 256 + 1`:

1. `n` = raw source tiles: points with `from ≤ t < to`; bucket source tiles: `Σ (count + sna)` of buckets with `from ≤ start < to` (source buckets nest in the run's, since source level ≤ level).
2. `n ≤ target`: if any source tile is buckets → undefined; else `cutRaw` of all source points over `[from, to)` with `source[0].before` and `source.at(−1).after` as outer neighbours (as `stitch`), `text` kept.
3. `n > target`: buckets of width `2^level` on `[from, to)`: raw source tiles through `aggregateRaw`, then every source bucket with start in `[from, to)` merged into `floor(start / 2^level) × 2^level` as `mergeUp` merges (`count`, `sna` summed; `mean = Σ mean·count / Σ count` over `count > 0`; `min`/`max` over non-null; all-SNA buckets keep `mean`, `min`, `max` null); result `from`/`to` = the run's bounds (`splitRun` ignores them).

`cache.load` keeps its grouping but takes it from `runsOf` (one definition).

### W5: Where computed runs enter the loader

Order for a view's tiles at level `L`, everywhere (`show`, `load`, the case-A completion, the prefetch):

1. `cache.find` (unchanged, W1.2).
2. For the missing indices: `runsOf(missing)`; per run, `coverFor(signalId, L)` → `deriveRun` → `cache.put` (stores; returns the tiles even when the weight limit keeps them out). **Recent-run exception:** a run whose last tile is not storable (ends after now − 1 h, series-cache C6) is not computed but requested in step 3, so recent data is asked from the server again (`loader.ts` `fromCover`). Case A's completion is exempt: the recorded view runs are computed from the overview even when recent.
3. What is still missing: requested as today.

Exception W1.4: the case-A completion computes the recorded missing runs without step 1 (and without the recent-run exception of step 2).

Consequence of the recent-run exception: for a signal recording up to now, the overview's last tile is never storable, so in case B and after a view complete from the cache (W7 first row) the overview's last run is requested as a prefetch instead of computed: one extra `/api/series` per such signal. The prefetch's runs ending within the last hour are requested likewise (W8).

`show` runs steps 1–2 synchronously: a view a held cover answers is `complete` in the `update` call that first shows it, without a request ("Zoom out above the overview without a request"). `overviewLoaded()` (overview complete) first completes every waiting key with an unchanged sequence number (case A completion), then, as today, recomputes placeholders for keys still loading.

### W6: The overview request in case A

Visible priority (`cache.load(overview.owner, signalId, O, missing, "visible")`): it never waits for a prefetch slot, it takes over a queued prefetch run of the same tiles (existing Z6 rule), and it counts in `visibleInFlight`, so the neighbour preload waits for it (K13, unchanged). It stays under the overview owner, so a gesture that releases the key's view owner does not abort it (the overview is needed for placeholders anyway). If it fails, every key waiting on it gets `fail(…)` with its recorded request (state `error`, R2 retry, R5 kept data), and the overview is marked failed; the retry takes case C (W2). On the server it runs `interactive` like every series request without the preload header (D-081, unchanged).

A view at `L ≥ O` whose key's overview is still loading as prefetch (started by `firstViewDone` after a cached view) records itself as waiting and loads the missing overview tiles as visible under the overview owner, which promotes the queued run.

### W7: Steps

| After a step | Today | This change |
|---|---|---|
| View tiles stored by the neighbour preload | complete at once; then extent, overview (prefetch class), prefetch | the same; the overview's missing tiles computed from the view's tiles when they are a wide view cover (case B's rule applied in `firstViewDone`); prefetch runs computed where a cover answers |
| Not preloaded, `L ≥ O` (e.g. the window showed a whole drive and the new one is at most about 1.33 × as long at `T` = 769) | view → extent → overview → prefetch | extent → overview (visible) → view computed; prefetch computed: **1 request** |
| Not preloaded, `L < O`, view spans the new extent (wide plot) | view → extent → overview edge tiles → prefetch | extent → view; overview computed: **1 request** |
| Not preloaded, `L < O`, view narrower than the new extent | view → extent → overview → prefetch | extent → view → overview after it → prefetch (levels ≥ `O` computed): **2 requests** plus the prefetch below `O`, as today |

`rescope()` drops every key's overview (unchanged), so after a step each key that needs the network waits for the new scope's extent; a key whose view is cached does not (W2). The preload (`preload/preload.ts`) plans view tiles with `levelFor`/`touchedTiles` and is unchanged: with its tiles stored, step 1 of W5 answers the view and nothing is requested. Its spec's test drives loaders without options, so it stays as it is.

### W8: Prefetch

`maybePrefetch` keeps its plan and skips (Z7); its index list per range goes through W5 steps 2–3: runs a cover answers are `put` (no request), the rest `cache.load(…, "prefetch")` as today. Computed tiles count against the 256-tile budget like requested ones. With the overview as cover and the view at `L ≥ O`, the whole plan inside the extent is at levels `≥ O`, so the prefetch of an open sends nothing.

### W9: Test fixtures (vitest, `apps/web/test/`)

The existing counting fake (`fakeSeries.ts` `fakeFetch`/`fakeAnswer`, no scope cut) and `wsetup` in `loader.test.ts` (fake extent, load interval 100 ms). "Loader without options": `new SeriesLoader(cache, …)` on its own `SeriesCache` and fake, i.e. today's cold path; results compare with `mean` within 1e-12 relative.

- **DENSE** (existing): 4,295 points every 10^6 ns from 500; extent given as `0` … `4294967295` → `O` = 22, tiles 0…3, overview request `{0, 4294967296, 1025}`, buckets (4,295 > 1,025).
- **SPARSE:** 1,000 points at `t = 4,294,967 × i` (i = 0…999), value `i`, every 7th SNA; extent `0` … `4290672033` → `O` = 21, tiles 0…7, overview `{0, 4294967296, 2049}`, raw (1,000 ≤ 2,049).
- **SHIFTED:** DENSE + 2^29 ns; extent given as `536870912` … `4831838207` → `O` = 22, tiles 0…4; view `[536870912, 4831838208)` at target 4001 → `L` = 20, tiles 2…17.
- **STEP:** DENSE ∪ (DENSE + 2^33 ns); extent `0` … `4294967295`, after `rescope()` `8589934592` … `12884901887`.

Views at `[0, 4294967296)`: target 257 → `L` = 24 (one tile), 1025 → `L` = 22 (tiles 0…3), 4001 → `L` = 20 (tiles 0…15, request target 4097).

### W10: Requests per signal (view spans the extent, nothing cached)

| | Today | This change |
|---|---|---|
| Open, `T ≤ 1025` (case A) | 1 extent + 3 series (view, overview, prefetch edge tile), serial | 1 extent + 1 series, serial |
| Open, wide plot (case B) | 1 extent + 1–3 series (view; overview tiles `find` cannot merge; prefetch) | 1 extent + 1 series (+1 overview run for a signal recording up to now, W5 recent-run exception) |
| Step after a finished preload | 0 visible; extent + overview + prefetch | 0 visible; extent + overview unless case B's cover answers it (never its last run for a signal recording up to now, W5); prefetch computed where a cover answers |
| Zoom out to `L ≥` a held cover | `find` or 1 per missing run | `find`, else computed: 0 (unless W1.3 refuses) |
| Zoom in below every cover | 1 per missing run, placeholder first | unchanged |

For the report's 4-signal open: 16 requests (4 extent + 12 series) become 8, and each signal's chain shrinks from four serial round trips to two.

### W11: Numbers

No new constant. `L ≥ O` is an exact comparison, not a tuning knob. Existing numbers kept: `OVERVIEW_TARGET` 1025 (Z2, D-043): off by ×2 (2049) the overview would be one level finer, serving case A up to plot widths of about 2,049 px at twice its weight (≤ 4,096 buckets ≈ 25,000 weight units, under 1 % of `CACHE_LIMIT`); not changed here because D-043 fixes 1,024–2,048 buckets. `MAX_RUN_TILES` 64: a view has at most 33 tiles (target ≤ 4,000), so a view is one run; ×½ would split nothing a view asks.

## Pinned interfaces

Write areas share only these (no `packages/shared` type and no HTTP payload changes):

- `tiles.ts`: `runsOf`, `deriveRun` as in W4.
- `cache.ts`:

```ts
/**
 * Stores the tiles of a run computed in the tab (deriveRun) as if `fetch` had answered
 * runRequest(signalId, level, first, last) under the workspace's scope: splitRun, then the store
 * rules (C5 weight and LRU, C6 recent tiles not stored, K12 edge tiles under the scope's key and
 * cut raw tiles); a stored tile of the same ID is replaced. Sends nothing and notifies no recovery
 * listener. Returns the run's tiles in index order, stored or not.
 */
put(signalId: string, level: number, first: bigint, last: bigint, result: SeriesResult): Tile[];
```

- `loader.ts`: no exported change. `LoaderOptions.extent`'s comment becomes "Extent per signal: asked before a signal's first load that needs the network (W2); absent: no overview, no cover, today's order."

## Risks / Trade-offs

- [A view no cover serves waits one extent round trip before its request: case C (a zoomed window after an un-preloaded step, a signal dropped into a zoomed window), measured 0.16–0.34 s on ADX after D-097, milliseconds on ClickHouse] → accepted for the open's gain (Q-1); its overview is no longer one round trip after the view, so the chain is no longer longer.
- [A hanging extent request delays the view until the request fails] → no timeout in this change (Out of scope); the extent route aborts with its client (series-query "Extent request aborts with its client").
- [`deriveRun` per frame during a gesture at levels ≥ `O`: at most about 8,400 source buckets (a 33-tile wide cover) per missing run] → well under a frame; cached views never reach it.
- [Computed tiles weigh in the cache] → they replace requests that would have stored the same tiles; weight unchanged.
- [case-preload's requirement says "the tiles each window asks for after `case.go`"; on an empty cache a case-A window now asks the overview's tiles first] → the preload's tiles are found first (W5 step 1), so after a finished preload nothing is asked, as the requirement intends; its tests use loaders without options and stay green. Spec text unchanged.
- [Existing window-options tests that expect a series request inside the first `update`] → "loads the overview once per signal after its first view", "draws a cached zoom in the same update" and "starts a failed overview again after a complete view" need the extent's microtask flushed before they look at `calls`; their scenarios keep their meaning (task 4.4).

## Open Questions

- **Q-1 (Jan), resolved 2026-10-22 (D-098): accepted.** A view no cover can serve waits for its extent (above). Alternative: start such a view's request at once when the view is narrower than half the scope, a heuristic that sends a second series request when it guesses wrong.
- **Lead:** record Jan's 2026-10-22 agreement ("P4 alone, P3 later") as a decision; the delta specs cite it.
