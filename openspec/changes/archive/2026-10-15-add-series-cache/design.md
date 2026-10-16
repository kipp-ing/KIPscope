# Design

## Context

See proposal.md (Why, D-037 (3) quoted). Current state that shapes the approach:

- **Loader** (`apps/web/src/chart/loader.ts`): one `SeriesLoader` per timeseries window (`TimeseriesWindow.tsx` line ~539, `new SeriesLoader(fetchSeries, rerender)`). Per signal key it fetches `{signalId, from, to, target}` with `target = min(4000, max(100, round(plot width px)))`; a new request aborts the previous one, a response applies only if it belongs to the latest request (sequence check), the previous result stays while loading. `get(key).result` is a `SeriesResult` that `build.ts` (drawing, SNA periods and share), `readout.ts` (`chartValueAt`, dragged lines) and `live.ts` (L cells, near signal) read; `settled(requests)` feeds the render acknowledgement.
- **Server** (`apps/server/src/series.ts`): raw when `count(from, to) ≤ target`, with edge neighbours `before` (last point `< from`) and `after` (first point `≥ to`); else buckets of width `ceil((to − from) / (target − 1))` on the absolute grid `k × width` (ClickHouse `intDiv(t, w) * w`), aggregating only points inside `[from, to)`. So for `from`, `to` multiples of `w` and `target = (to − from) / w + 1` the width is exactly `w` and every bucket is complete: tile-aligned requests already work, no server change (series-query "Reusable buckets for aligned requests" pins it with a test). `MAX_TARGET` is 20,000. Times are bounded to `TIME_MIN`…`TIME_MAX` (`packages/shared/src/time.ts`); `encodeTimes` offsets must stay below 2^53 ns (~104 days) per result.
- **Exact lookups:** `/api/value` (values window, committed cursor readouts, D-031 „Always exact") goes through `ValueLoader` and `fetchCursorValue`, not through `SeriesLoader`.

## Goals / Non-Goals

**Goals:**
- Views load fixed tiles; a tile loaded once is reused by every later view of any window in the tab (D-037 (3)).
- The loader's outside stays as is: `LoadState.result` is still one `SeriesResult` per signal for the view's range, so `build.ts`, `readout.ts`, `live.ts`, `TimeseriesWindow.tsx` drawing and the render acknowledgement need no change.
- Every rule with a number is a pure function in `chart/tiles.ts` or a constructor option of `chart/cache.ts`, unit-tested with a fake fetch.
- Goal (not a must): zoom and pan inside one bucket width level cost only the tiles that come into view.

**Non-Goals:**
- No change in `packages/shared`, `apps/server/src`, `apps/cli`; no new endpoint, DTO or parameter. Server and web need no coordination; the only shared interface is the existing `/api/series` request, used tile-aligned.
- `/api/value` and `/api/extent` are not cached: committed cursor values are exact server values by D-031, and a lookup per cursor time rarely repeats.
- No persistence, no browser storage (D-037 „Not persisted across reloads"); no server-side cache (concept §2).
- No coarse buckets derived from cached finer ones, no prefetch, no cache settings or cache display in the UI.

## Decisions

### C1: The grid (pinned, `apps/web/src/chart/tiles.ts`, new)

- **Level `k`** (integer 0…62): bucket width `w = 2^k` ns. A view `[from, to)` with target `n` uses the largest `k` with `2^k ≤ ceil((to − from) / (n − 1))`, at least 0 (D-038: snap down). The view then holds between `n − 1` and 2 × (`n` − 1) buckets: never coarser than before the cache, up to 2× the buckets. Each run request still stays at or below its own target (series-query "Resolution-aware request").
- **Tile `(signalId, k, j)`**: covers `[j × S, (j + 1) × S)` with span `S = 256 × 2^k` ns (`TILE_BUCKETS = 256`). `j` is a bigint, floor division (times before 1970 are negative).
- **Touched tiles** of a view: `j` from `floor(from / S)` to `floor((to − 1) / S)`.
- **Run**: adjacent tiles `first…last` of one signal and level, fetched as one request `{signalId, from: first × S, to: (last + 1) × S, target: (last − first + 1) × 256 + 1}`; at most `MAX_RUN_TILES = 64` tiles (target ≤ 16,385 < `MAX_TARGET`), longer runs are split. The server then answers with width exactly `2^k` or with raw points.
- **Fallback**: when a view's touched span `[first × S, (last + 1) × S)` leaves `TIME_MIN`…`TIME_MAX` or exceeds 2^53 ns, the view is fetched exactly as today (`{signalId, from, to, target}` of the view), not cached.

```ts
import type { SeriesResult } from "@kipscope/shared";

export const TILE_BUCKETS = 256;
export const MAX_RUN_TILES = 64;
export const MAX_LEVEL = 62;
export const FRESH_MARGIN_NS = 3_600_000_000_000n; // 1 h (C6)
export const TILE_OVERHEAD = 16; // weight units per tile (C5)
export const RAW_POINT_WEIGHT = 2;
export const BUCKET_WEIGHT = 6;

/** One series request; LoadRequest (loader.ts) extends it with `key`. */
export interface SeriesRequest {
  signalId: string;
  from: string; // decimal ns
  to: string;
  target: number;
}

export interface Tile {
  signalId: string;
  level: number;
  index: bigint;
  /**
   * from/to = the tile's bounds (decimal ns). Raw: the points inside, `before`/`after` the nearest
   * points outside the tile (absent when none exists). Buckets: width 2^level, complete buckets only.
   */
  data: SeriesResult;
}

export const tileId = (signalId: string, level: number, index: bigint) =>
  `${signalId}|${level}|${index}`;
export function bucketWidthOf(level: number): bigint;          // 2n ** BigInt(level)
export function tileSpan(level: number): bigint;               // TILE_BUCKETS × width
export function levelFor(from: bigint, to: bigint, target: number): number;
export function touchedTiles(from: bigint, to: bigint, level: number): { first: bigint; last: bigint };
/** False → fallback to an exact, uncached request (time bounds or 2^53 ns span). */
export function tileable(level: number, first: bigint, last: bigint): boolean;
/** The request for one run (last − first + 1 ≤ MAX_RUN_TILES; the cache splits longer ones). */
export function runRequest(signalId: string, level: number, first: bigint, last: bigint): SeriesRequest;
/** Splits a run's response into its tiles (raw neighbours per tile from adjacent points or the run's). */
export function splitRun(result: SeriesResult, level: number, first: bigint, last: bigint): Tile[];
/** A finer raw tile cut from a coarser raw tile that contains it (C3). */
export function deriveRaw(parent: Tile, level: number, index: bigint): Tile;
/** Raw tile → bucket tile of its own level (series-query bucket rules, SNA = null kept out of mean/min/max). */
export function aggregateRaw(tile: Tile): Tile;
/** View result from its touched tiles in index order (C4). */
export function stitch(tiles: readonly Tile[], from: bigint, to: bigint): SeriesResult;
export function tileWeight(tile: Tile): number;
```

### C2: The tab cache (pinned, `apps/web/src/chart/cache.ts`, new)

One `SeriesCache` per tab holds stored tiles (a `Map` in least-recently-used order) and the runs in flight.

```ts
import type { SeriesResult } from "@kipscope/shared";
import type { SeriesRequest, Tile } from "./tiles.ts";

export const CACHE_LIMIT = 4_000_000; // weight units (C5)

export type FetchSeries = (request: SeriesRequest, abort: AbortSignal) => Promise<SeriesResult>;

export interface CacheOptions {
  limit?: number;          // default CACHE_LIMIT
  now?: () => number;      // ms since epoch, default Date.now (C6)
}

export class SeriesCache {
  constructor(fetch: FetchSeries, options?: CacheOptions);
  /** The fetch, for the loader's uncached fallback. */
  readonly fetch: FetchSeries;
  /** Sum of the stored tiles' weights. */
  get size(): number;
  /** Stored tile (no use mark), for tests. */
  peek(signalId: string, level: number, index: bigint): Tile | undefined;
  /**
   * The stored tile, else one derived from a stored raw tile of a coarser level (C3; not stored).
   * Marks the stored tile it used as most recently used.
   */
  find(signalId: string, level: number, index: bigint): Tile | undefined;
  /**
   * One promise per index, for tiles `find` did not return. An index in flight joins its run;
   * the others are grouped into runs (C1) and fetched. `owner` wants all of them until `release`.
   * When a run answers, its tiles are stored (C5, C6) and the promises resolve with them (stored
   * or not). A failed run rejects its promises with its error and stores nothing; an aborted run
   * rejects with the abort error.
   */
  load(owner: string, signalId: string, level: number, indices: readonly bigint[]): Promise<Tile>[];
  /** owner wants nothing any more; every run without any wanting owner is aborted. */
  release(owner: string): void;
}

/** The tab's cache, created on first use with `fetchSeries` from api.ts. */
export function tabSeriesCache(): SeriesCache;
```

### C3: Raw tiles serve finer levels

A raw tile `(s, K, J)` contains every finer tile `(s, k, j)` with `k < K` and `j >> (K − k) = J` (arithmetic shift = floor). `find` checks the own key first, then the coarser levels that hold a stored raw tile of that signal (keep a per-signal set of such levels, so a lookup does not probe 62 levels). `deriveRaw` cuts the points inside the finer tile (binary search on the decoded times); its `before` is the parent's last point before the finer tile's start, else the parent's `before`; its `after` the parent's first point at or after its end, else the parent's `after`. Derived tiles are not stored (no double weight); the parent counts as used.

Bucket tiles serve only their own level. A view whose touched tiles are all raw draws raw (C4), else buckets. Today the raw/bucket switch is `count(view) ≤ target`; now it is per run (`count(run) ≤ run target`, about one point per bucket of the run), which is the same density threshold on a slightly larger span. With the width snapped down (C1, D-038) the density threshold is up to 2× stricter than today (at most one point per finer bucket), while a view spans up to 2× `target` buckets, so a raw view may still hold up to about 2× `target` points, at most 64 × 256 + 1 per run.

### C4: Stitching (the loader's result)

`stitch(tiles, from, to)` with the touched tiles of one level in index order:
- **All raw:** points with `from ≤ t < to` in time order; `before` = last point `< from` among the tiles, else the first tile's `before`; `after` = first point `≥ to` among the tiles, else the last tile's `after`. Result `from`/`to` = the view's.
- **Else:** raw tiles go through `aggregateRaw`; buckets with `start + w > from` and `start < to` in order. Result `from` = `floor(from / w) × w`, `to` = `ceil(to / w) × w`, `width` = `w`, so the `BucketSeries` invariant („aggregates only points inside [from, to)") holds for the snapped range. The edge buckets are complete (today they are partial); the SNA share of a bucket view therefore counts up to two buckets beyond the view's edges, two of at least `target − 1` buckets.
- Times are re-encoded with `encodeTimes` (span ≤ 2^53 ns by C1's fallback). The loader stitches once per completed view and keeps the object, so `x.result === y.result` memo checks in `TimeseriesWindow.tsx` keep working.

### C5: Size limit and weight

Weight of a stored tile: `TILE_OVERHEAD + RAW_POINT_WEIGHT × (points + neighbours)` for raw, `TILE_OVERHEAD + BUCKET_WEIGHT × buckets` for buckets (one unit ≈ one stored number: raw time + value; bucket start, count, SNA count, mean, min, max). After storing a tile, the cache drops least-recently-used tiles until `size ≤ limit`; a tile heavier than the limit on its own is not kept. `find` (also through a derived tile) and `store` count as use. Tiles a view already holds stay referenced by the loader's state, so eviction never blanks a shown curve; only a later view refetches them.

### C6: Recent data

A tile whose end (`(index + 1) × S`) is after `now() − 1 h` (ms → ns) is resolved to its waiting views but not stored. Data still being written there is requested again by every later view, as today. Data imported later into an older, already cached range appears after a reload (Q1).

### C7: Loader on tiles (pinned, `apps/web/src/chart/loader.ts`)

```ts
import type { SeriesCache } from "./cache.ts";
import type { SeriesRequest } from "./tiles.ts";

export interface LoadRequest extends SeriesRequest {
  key: string; // assignment ID
}
// LoadState unchanged.
export class SeriesLoader {
  constructor(cache: SeriesCache, onChange: () => void);
  get(key: string): LoadState | undefined;   // unchanged
  settled(requests: LoadRequest[]): boolean;  // unchanged semantics
  update(requests: LoadRequest[]): void;
  dispose(): void;
}
```

`update`, per request whose identity (`signalId|from|to|target`) changed:
1. `seq++`; owner `${loaderId}|${key}|${seq}` (`loaderId` a per-instance counter).
2. `level = levelFor(...)`, touched `first…last`. If not `tileable`: today's path (abort the key's controller, fetch the exact request with `cache.fetch`, latest-wins).
3. `cache.find` for every touched index, keeping the returned tiles. All found: state `complete` with `stitch(...)` in this call, no fetch.
4. Else state `loading` with the previous result kept; `cache.load(owner, ...)` for the missing indices; on all resolved and `seq` still current: `complete` with `stitch(found + loaded)`; on a rejection while current and not aborted: `error` with its message.
5. Only then `cache.release(previous owner of this key)`, so tiles the old and new view share keep their run alive. A removed key and `dispose()` release their owner (and abort a fallback controller).

`settled` and the sequence check stay as today: a late response for an old view only resolves promises nobody reads any more; its tiles are stored by the cache (series-cache "Stale responses only fill the cache").

### C8: Wiring (`apps/web/src/api.ts`, `apps/web/src/chart/TimeseriesWindow.tsx`)

- `api.ts`: `fetchSeries(r: SeriesRequest, abort)` (type import from `chart/tiles.ts` instead of `LoadRequest`); body unchanged.
- `TimeseriesWindow.tsx`: `new SeriesLoader(tabSeriesCache(), rerender)` instead of `new SeriesLoader(fetchSeries, rerender)`. Nothing else; the live cursor and readouts read `loader.get(key).result` as before.

### C9: Numbers and the factor-two check

| Number | Value | Origin | ×2 / ÷2 |
|---|---|---|---|
| Width ladder base | 2 (widths `2^k` ns) | necessary consequence (a common grid; base 2 keeps parent/child tiles nested) | Base 4 would give views up to 4× the buckets of today; base 2 is the finest nested ladder. Snapping down (D-038) gives a view up to 2× today's buckets (≤ 2 buckets per px), never fewer. |
| `TILE_BUCKETS` | 256 | design | Overfetch of a fresh view ≈ one tile beyond the view: at 1000 px (999 … 1,997 buckets) ≈ +20 % DB scan on average, at most +51 %. 512: ≈ +35 % on average, coarser pan reuse. 128: ≈ +10 %, twice the tiles (up to 65 per view at 4000 px; map entries, stitch work). Requests stay one per run either way. With up to 2× buckets per view, 256 stays the balance; tiles per view: ≤ 9 at 1000 px, ≤ 33 at 4000 px. |
| `MAX_RUN_TILES` | 64 | necessary consequence of `MAX_TARGET` 20,000 | Views touch ≤ 33 tiles at target 4000 (≤ 7,997 buckets), run target ≤ 8,449, so it never splits today; 128 tiles would exceed `MAX_TARGET`. |
| `CACHE_LIMIT` | 4,000,000 units | D-037 „with a size limit"; the value: design | With D-038's up to 2× buckets: one 1000-px view of 10 signals in buckets ≈ 10 × 1,650 × 6 ≈ 100k units on average (≤ 10 × 2,304 × 6 ≈ 138k), so ≈ 30–40 views. The largest single view (50 signals at 4000 px, ≤ 33 tiles) ≈ 2.5 M units still fits. A unit costs ~8–20 bytes in V8 arrays (numbers vs. boxed values next to nulls): 32–80 MB. ×2: 64–160 MB, noticeable in a tab. ÷2: ≈ 15–20 views, and the largest view would no longer fit (its older tiles evicted while it loads, refetched on return). The limit bounds memory, so 2× data per view halves the views kept, not the bytes. |
| `FRESH_MARGIN_NS` | 1 h | Q1 | 30 min: an ingest delay over 30 min leaves stale tiles until reload. 2 h: only data younger than 2 h is refetched each time, which is today's behaviour anyway. The real data (2026-10-11 … 13) is never inside it. |
| Weights | raw 2, bucket 6, tile 16 | design (stored numbers) | Only the ratio matters against the limit; a wrong ratio shifts the limit by < 2× for one kind. |

## Risks / Trade-offs

- **Up to 2× the buckets per view** (D-038, C1 snapping down): up to 2× transfer, result size and drawing work per view, and half as many views fit in the cache. Accepted by Jan („up to 2× data per view is accepted"); the DB scans the same time range as before, so its scan cost does not double.
- **First load scans more time** (≈ one extra tile per signal, ≈ +20 % at 1000 px). Mitigation: 256-bucket tiles; requests stay one per signal per view.
- **Data imported into an already cached past range** is invisible until reload (C6). Mitigation: reload is cheap; Q1.
- **More code on the web side** (tiles, cache). Mitigation: pure functions in `tiles.ts`, cache testable with a fake fetch and clock.

## Migration Plan

None: memory only, no stored format. Rollback = revert the web change.

## Open Questions

Q1 is built as recommended until Jan decides otherwise; Q2 is decided.

- **Q1 Recent data:** (a) cache every tile until the tab closes: simplest, but data written after loading never shows until reload; (b) a TTL on every tile (e.g. 10 min): long sessions lose the cache; (c) **recommended:** do not store tiles that end within the last hour (C6); older data imported later shows after a reload.
- **Q2 Width rounding: decided by Jan, D-038** („the power-of-two bucket width snaps down (finer), so a view gets between `target` and 2 × `target` buckets, never coarser than before the cache"; why: „min/max band and spikes stay as sharp as today; up to 2× data per view is accepted"). Built in C1, C3, C9.
