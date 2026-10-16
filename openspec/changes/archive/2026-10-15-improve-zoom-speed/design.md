# Design

## Context

See proposal.md (D-040 quoted). Current state that shapes the approach:

- **Gesture path** (`apps/web/src/chart/TimeseriesWindow.tsx`): wheel events are joined per animation frame (`WheelFrame`, `flushWheel` in a `requestAnimationFrame`) into one `applyRange(u, min, max)`, which sets `preview.range`, calls `setView` (uPlot redraws the *old* data at the new scale), hides the crosshair, (re)starts `commit(r)` and calls `rerender()`. `commit` sends `window.setRange` after `COMMIT_DELAY_MS = 300` (line 90). The loader's `requests` are built from `w.range` (the committed range) and passed to `loader.update` in a `useEffect`, so loading starts only after the command came back: the lead's 345 ms.
- **Acknowledgement:** `settled = loader.settled(requests) && values.settled(exactRequests) && width > 0` feeds `onReady(w.id, revision, errors)`.
- **Loader and cache** (archived `add-series-cache`, design C1–C9): views load 256-bucket tiles of width 2^k ns from one tab cache (`chart/cache.ts`), adjacent missing tiles as one run request, LRU limit 4,000,000 weight units, recent tiles (ending after now − 1 h) not stored, raw tiles serve finer levels. A view with all tiles cached completes inside `update`. `LoadState.result` stays one `SeriesResult` per signal, read by `build.ts` (drawing, badge), `readout.ts` and `live.ts`.
- **DTO** (`packages/shared/src/series.ts`): `BucketSeries` has one `width` and per bucket `count` (valid points), `sna`, `mean`, `min`, `max`, so finer buckets merge exactly (mean weighted by count). `Extent` is `{signalId, first, last}`; `fetchExtent` exists in `api.ts`.
- **Server:** `QueryQueue(config.queryConcurrency)`, default `KIPSCOPE_QUERY_CONCURRENCY` 4 (`apps/server/src/config.ts`); an aborted waiting request leaves the queue without running.
- **Wheel:** one tick 2^(1/5), at most 5 ticks (×2) per event and per frame; a synthetic `WheelEvent` has `wheelDelta` 0, so it is not treated as a mouse notch and keeps its delta.

## Goals / Non-Goals

**Goals:**
- D-040 (1): loading follows the shown range during the gesture; a cached view is drawn sharp in the frame that applies the step.
- D-040 (2): a per-signal overview and placeholders, so an uncached view is never drawn as stretched old data when anything coarser is cached.
- D-041: linked windows show and load the gesture's preview range in the same frame (Z9).
- D-040 (3): prefetch at rest so the next zoom out or pan is usually cached.
- Every number is a constant in one file and unit-tested with fake timers and a fake fetch.
- Goal (not a must): a gesture of many frames costs no more queries than one per 100 ms per window.

**Non-Goals:**
- No change in `packages/shared`, `apps/server`, `apps/cli`; no new endpoint, parameter or DTO (D-040: server tile cache and binary transport out of scope). The only interfaces between parallel tasks are the web modules pinned below.
- No per-region mixed resolution in one curve (Q1); no new visual marker (Q2).
- The command delay (300 ms) and the zoom history stay as they are.

## Decisions

### Z1: Load on preview, throttle (pinned, `chart/loader.ts`, `chart/TimeseriesWindow.tsx`)

- `TimeseriesWindow` builds `requests` from the **shown** range (`preview.view(serverRange)` after `preview.settle(...)`, the same range the header shows) and builds `committedRequests` the same way from `w.range`. `loader.update(requests)` runs in a `useLayoutEffect`. The acknowledgement reads `loader.settled(committedRequests)`.
- `applyRange` calls `flushSync(rerender)` (from `react-dom`) instead of `rerender()`. Inside the animation frame that applied the step, React renders, the layout effect updates the loader, a cache hit completes synchronously and its `onChange` rerender is flushed in the same commit, and the data layout effect calls `u.setData` before the browser paints. Without `flushSync`, a render scheduled from `requestAnimationFrame` runs after that frame's paint and the sharp data lands one frame late.
- `commit` is unchanged: after 300 ms the command carries exactly the shown range, so the committed requests then equal the loaded ones (same request identity) and nothing loads again.
- **Throttle** (per loader): a visible load set (all keys whose missing tiles are requested in one `update` or one timer turn) starts at once when no visible set started in the last `loadIntervalMs`; otherwise the keys become *pending* and keep state `loading` (with a placeholder, Z4). At the end of the interval every pending key loads the tiles its *current* request still misses (it may have become cached meanwhile → `complete`), and if anything started a new interval begins. A pending key keeps its previous cache owner until its load starts, then releases it (as today), so a run that still serves the new view is not aborted. Prefetch and overview loads (Z2, Z7) do not count for the throttle.

### Z2: Overview (pinned, `chart/tiles.ts`, `chart/overview.ts` new, `chart/loader.ts`)

- `overviewLevel(first, last) = levelFor(first, last + 1n, OVERVIEW_TARGET)` with `OVERVIEW_TARGET = 1025`: 1,024 to 2,048 buckets over the extent (D-038's snap down), so the full-extent view of a window about 1,000 px wide usually has the overview's level and is served by it. Real data (2026-10-11 … 13, about 3 days): width ≈ 2.5 × 10^11 ns → level 37 (137 s), about 1,900 buckets, 8–9 tiles, one run request.
- `overviewTiles(first, last) = touchedTiles(first, last + 1n, level)`; when `tileable` is false for it (span > 2^53 ns, ≈ 104 days) the signal gets no overview.
- `signalExtent(signalId)` (`chart/overview.ts`): `fetchExtent` once per tab (a module `Map<string, Promise<Extent>>`); a rejected promise is removed from the map, so a later call tries again.
- Per loader key: after the key's first view reaches `complete` or `error` (or completed from the cache), if `options.extent` is set the loader gets the extent, then per overview index takes `cache.find` or `cache.load(overviewOwner, …, "prefetch")` with owner `${loaderId}|overview|${key}`. It keeps the overview tiles in a per-key map (references, so cache eviction does not lose them) until the key is removed or `dispose()`, which release the owner. When the overview is complete, every key still `loading` gets its placeholder recomputed and `onChange` is called once.

### Z3: Merging up (pinned, `chart/tiles.ts`, `chart/cache.ts`)

- `mergeUp(left, right)`: `left.index` even, `right.index = left.index + 1`, both at level `k − 1`; result tile `(k, left.index / 2)`. Both raw → raw: points concatenated, `before` = `left.before`, `after` = `right.after`, `from`/`to` the parent's bounds. Else buckets of width 2^k: raw children first through `aggregateRaw`; a parent bucket at `s` takes the child buckets at `s` and `s + 2^(k−1)`: `count` and `sna` summed, `mean = Σ mean·count / Σ count` over children with `count > 0`, `min`/`max` over non-null, all `null` when the summed `count` is 0; a parent bucket with neither child bucket is omitted. Matches the server's aligned buckets (series-query "Reusable buckets for aligned requests"); mean differs at most by float rounding (relative 1e-12 in tests).
- `SeriesCache.find(signalId, level, index)`: stored tile → tile derived from a stored coarser raw tile (as today) → `mergeUp` of the two children found the same way, at most `MERGE_DEPTH = 2` levels below the asked level. A merge runs only when both children were found. Merged tiles are not stored; the stored tiles read count as used.

### Z4: Placeholder (pinned, `chart/tiles.ts`, `chart/loader.ts`)

- `placeholder(from, to, level, maxLevel, lookup)`: for `P = level + 1 … maxLevel` (finest first), skipping levels where `tileable` is false, the touched tiles of `[from, to)` at `P`; when `lookup(P, j)` returns a tile for every `j`, return `stitch(tiles, from, to)`; else try the next level; `undefined` when none succeeds.
- The loader's `lookup(P, j)`: `cache.find(signalId, P, j)`, else when `P` is the key's overview level its overview tile `j`, or `emptyTile(signalId, P, j)` (bucket tile without buckets) when `j` lies outside the overview's index range. `maxLevel = min(MAX_LEVEL, max(overview level ?? 0, level + PLACEHOLDER_SEARCH))`, `PLACEHOLDER_SEARCH = 6`.
- A key whose view misses tiles gets state `{status: "loading", request, result: placeholder, placeholder: true}`; without a placeholder, `{status: "loading", request, result: previous}` as today. The placeholder is computed in `update` (and again when the overview completes), never in a later frame.
- The placeholder is an ordinary `SeriesResult`: the resolution badge shows its width (`agg · …`), the legend shows the signal's existing "loading" status, the live cursor and dragged lines read it like any bucket data (tooltip "bucket mean (avg)"). Nothing else marks it (Q2).

### Z5: Loader interface (pinned, `chart/loader.ts`)

```ts
import type { Extent, SeriesResult } from "@kipscope/shared";
import type { SeriesCache } from "./cache.ts";

export const LOAD_INTERVAL_MS = 100; // Z1
export const SETTLE_MS = 300; // Z7
export const PREFETCH_MAX_TILES = 256; // Z7

export interface LoaderOptions {
  /** Visible loads start at most once per interval (Z1); absent or 0: every load starts at once. */
  loadIntervalMs?: number;
  /** Extent per signal for the overview (Z2); absent: no overview, no placeholder from it. */
  extent?: (signalId: string) => Promise<Extent>;
  /** Prefetch at rest (Z7); absent or false: none. */
  prefetch?: boolean;
}

export interface LoadState {
  status: "loading" | "complete" | "error";
  request: string;
  result?: SeriesResult;
  error?: string;
  /** Set while `result` is a placeholder of coarser tiles (Z4); only with status "loading". */
  placeholder?: true;
}

export class SeriesLoader {
  constructor(cache: SeriesCache, onChange: () => void, options?: LoaderOptions);
  get(key: string): LoadState | undefined;       // unchanged
  settled(requests: LoadRequest[]): boolean;      // unchanged: placeholder and pending are "loading"
  update(requests: LoadRequest[]): void;          // Z1, Z4, Z7
  dispose(): void;                                // also clears its timers, releases overview and prefetch owners
}
```

Timers use the global `setTimeout`/`clearTimeout` (vitest fake timers). Without options the loader behaves exactly as before this change, so the existing `loader.test.ts` cases stay as they are.

`chart/overview.ts` (new):

```ts
import type { Extent } from "@kipscope/shared";
import type { LoaderOptions } from "./loader.ts";

export function signalExtent(signalId: string): Promise<Extent>;
/** Options of every timeseries window's loader. */
export const WINDOW_LOADER_OPTIONS: LoaderOptions; // { loadIntervalMs: LOAD_INTERVAL_MS, extent: signalExtent, prefetch: true }
```

### Z6: Cache interface additions (pinned, `chart/cache.ts`)

```ts
export const PREFETCH_IN_FLIGHT = 2;
export type Priority = "visible" | "prefetch";

export class SeriesCache {
  // unchanged: fetch, size, peek, release
  find(signalId: string, level: number, index: bigint): Tile | undefined; // + Z3 merge
  load(
    owner: string,
    signalId: string,
    level: number,
    indices: readonly bigint[],
    priority?: Priority, // default "visible"
  ): Promise<Tile>[];
  /** False for a tile that would not be stored (ends after now − FRESH_MARGIN_NS). */
  storable(level: number, index: bigint): boolean;
  /** Prefetch runs waiting in the browser (not yet fetched), for tests. */
  get queuedPrefetch(): number;
}
```

- A `"prefetch"` run is fetched when fewer than `PREFETCH_IN_FLIGHT` prefetch runs of the tab are in flight, else it waits in a FIFO queue; it starts when one finishes (answered, failed or aborted).
- A `"visible"` load never waits. When it wants a tile of a *waiting* prefetch run, that run starts at once and no longer counts as prefetch; when it wants a tile of a *running* prefetch run it joins it as today.
- `release(owner)`: a waiting run without owners leaves the queue without a fetch and rejects its promises with an abort error; a running one is aborted as today.

### Z7: Prefetch at rest (pinned, `chart/tiles.ts`, `chart/loader.ts`)

- `prefetchPlan(from, to, level): TileRange[]` with `span = to − from`, in this order: `{level + 1, touchedTiles(from − span, to + span, level + 1)}`, `{level, touchedTiles(from − span, from, level)}`, `{level, touchedTiles(to, to + span, level)}` (`level + 1` capped at `MAX_LEVEL`). Example: `[0, 1000 × 2^20)` at level 20 → `{21, −2, 3}`, `{20, −4, −1}`, `{20, 3, 7}`.
- **Rest:** each `update` that changed a request (re)starts a `SETTLE_MS` timer and releases the previous prefetch owner. When the timer has fired and every key is `complete` or `error` with no pending load (checked at the timer and after each load completion), the loader prefetches once for this rest with owner `${loaderId}|prefetch|${n}`.
- Per key in the window's order, per plan range: indices for which `cache.find` returns nothing, `cache.storable` is true, and, when the key's extent is known, the tile overlaps `[first, last]`; at most `PREFETCH_MAX_TILES` indices over all keys; `cache.load(prefetchOwner, signalId, level, indices, "prefetch")` per range, promises caught and ignored (prefetch draws nothing). Keys on the uncached fallback path (not `tileable`) get none.

### Z8: Wiring summary (`chart/TimeseriesWindow.tsx`)

`new SeriesLoader(tabSeriesCache(), rerender, WINDOW_LOADER_OPTIONS)`; `requests` from the shown range, `committedRequests` from `w.range`; `useLayoutEffect(() => loader.update(requests), …)`; `flushSync(rerender)` in `applyRange`; `const settled = loader.settled(committedRequests) && …`. `COMMIT_DELAY_MS` stays 300. The computation of the shown range (`preview.settle`, `viewRange()`) moves above the `requests` memo.

### Z9: Linked windows follow the preview (pinned, `chart/linkedPreview.ts` new, `chart/TimeseriesWindow.tsx`, `App.tsx`)

Jan's D-041: „with "Link time axes" on, every linked window shows the preview range and loads during the gesture like the zoomed one (a browser-local shared preview range, like the live cursor); the command is still sent once after the commit delay."

```ts
import type { Range } from "./zoom.ts";

export interface SharedPreview {
  /** Window whose gesture previews the range. */
  source: string;
  range: Range;
}

/** Tab singleton like `liveCursor` (live.ts); never workspace state, never sent to the server. */
export class LinkedPreviewStore {
  get(): SharedPreview | undefined;
  /** Replaces the shared preview (the latest gesture wins) and notifies subscribers synchronously. */
  publish(source: string, range: Range): void;
  /** Clears it only when `source` is the current source; notifies when it cleared. */
  clear(source: string): void;
  subscribe(listener: () => void): () => void;
}
export const linkedPreview: LinkedPreviewStore;
export function useLinkedPreview(store?: LinkedPreviewStore): SharedPreview | undefined; // useSyncExternalStore

/** The range a window shows: its own preview, else (linked, another source) the shared one, else the server range. */
export function shownRange(
  windowId: string,
  own: Range | undefined,
  shared: SharedPreview | undefined,
  linked: boolean,
  server: Range,
): Range;
```

- **Who publishes:** only the gesture's window, only while linked: `applyRange` runs `flushSync(() => { linkedPreview.publish(w.id, r); rerender(); })`, so the followers' re-renders (synchronous `useSyncExternalStore` updates), their loader updates and `setData` all happen in the same animation frame as the source's. Only the source schedules `commit` and calls `onZoomed`; the command and the zoom history are unchanged.
- **Who reads:** every timeseries window, through `useLinkedPreview()` and `shownRange(...)`; the result replaces `preview.view(serverRange)` everywhere the shown range is used (header, x scale, `requests`, live cursor `shown`). A follower's change of shown range goes through the existing "View" layout effect (`setView`, crosshair hidden). Unlinked windows ignore the store (`linked` false).
- **Own preview wins:** a window with its own pending preview shows that; a second gesture in another window replaces the shared preview (latest source wins); the earlier source's later `clear` is ignored because it is no longer the source.
- **Cleared:** by the source in the render in which its own preview is dropped (`preview.range` becomes undefined after `preview.settle`: the accepted range arrived, the command was rejected, or another client's range or a history step (Backspace, the bar) won), on its unmount, and when "Link time axes" is switched off (the source clears when `linked` turns false). Since all linked windows receive the accepted revision in the same render, followers switch from the shared preview to the equal server range without a frame of the old range.
- **Different widths:** each follower builds its own `requests` from the shared range with its own `target` (its own plot width), so it loads its own level and tiles, with its own throttle (Z1), placeholder (Z4) and prefetch at rest (Z7). Only the range is shared.
- **Acknowledgement:** unchanged rule: every window acknowledges from `committedRequests` (`w.range`); a follower showing the shared preview is not settled for the committed revision until the accepted range arrived and its sharp data is drawn.
- **`App.tsx`:** passes `linked={linked}` to `TimeseriesWindow` (one new prop).

### T1: UI timing check (evidence for series-cache "Zoom timing", "Prefetch when the view rests", timeseries-window "Loading starts during the gesture", "Linked windows follow the gesture")

Lead's method from the D-040 measurement, extended to two windows (D-041). Chrome on localhost, "Link time axes" on, window 1 (top) showing `smart451/COMBI_412h.V_ANZ`, window 2 showing `smart451/CPC_448h.PTC_HV_Volt`, run with the browser's JavaScript tool:

```js
(() => {
  if (!window.__strokePatched) {
    const stroke = CanvasRenderingContext2D.prototype.stroke;
    window.__strokes = [];
    CanvasRenderingContext2D.prototype.stroke = function (...a) {
      const w = this.canvas.closest("[data-window-id]")?.dataset.windowId ?? "?";
      window.__strokes.push({ t: performance.now(), w });
      return stroke.apply(this, a);
    };
    window.__strokePatched = true;
  }
  window.__zoom = (deltaY) => {
    const over = document.querySelector(".u-over"); // window 1
    const r = over.getBoundingClientRect();
    window.__strokes.length = 0;
    performance.clearResourceTimings();
    const t0 = performance.now();
    over.dispatchEvent(new WheelEvent("wheel", { deltaY, deltaMode: 0, ctrlKey: true, bubbles: true, cancelable: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    return new Promise((done) => setTimeout(() => {
      const bursts = {}; // per window; strokes closer than 8 ms belong to one draw
      for (const { t, w } of window.__strokes) {
        const list = (bursts[w] ??= []);
        const b = list.at(-1);
        if (b && t - b.end <= 8) b.end = t; else list.push({ start: t, end: t });
      }
      for (const w in bursts) bursts[w] = bursts[w].map((b) => Math.round(b.start - t0));
      done({
        bursts,
        series: performance.getEntriesByType("resource").filter((e) => e.name.includes("/api/series"))
          .map((e) => ({ signal: new URL(e.name).searchParams.get("signal"),
            start: Math.round(e.startTime - t0), end: Math.round(e.responseEnd - t0) })),
      });
    }, 1000));
  };
})();
```

1. Set the range (linked, so both windows): `kipscope --wait window range <w1> 2026-10-13T09:00:00Z 2026-10-13T10:00:00Z`; wait 2 s (views, overviews and prefetch loaded).
2. **Uncached zoom in:** `await __zoom(-500)` (×2 in, level one finer, never loaded). Pass, for **each** window and its signal's `series` entries: first burst `≤ 50` (placeholder from the 1 h tiles), a `series` entry with `start ≤ 50`, the last burst below 290 is `≤ 200` and later than that entry's `end`. Wait 2 s.
3. **Cached zoom out:** `await __zoom(500)` (back to 1 h). Pass, for each window: no `series` entry with `start < 290`, exactly one burst, `≤ 50`. Wait 2 s.
4. **Prefetched zoom out:** `await __zoom(500)` (2 h, one level coarser, prefetched in step 3's rest). Same pass rule as step 3.

Repeat steps 1–2 on 11:00–12:00 and 13:00–14:00; report all values and the median of step 2 per window. Entries starting after 290 ms are prefetch requests (allowed). A burst after 290 ms in steps 3–4 fails series-cache "Command still delayed, no load after it". After each step both headers show the same range (screenshot once).

### Numbers and the factor-two check

| Number | Value | Origin | ×2 / ÷2 |
|---|---|---|---|
| `LOAD_INTERVAL_MS` | 100 ms | Z1, consequence of D-040 (1) and server concurrency 4 | 200: during a long gesture half the request sets, but the last range of a gesture can wait up to 200 ms before loading, breaking the ~150 ms target for multi-frame gestures. 50: up to 20 sets/s per window, twice the aborted queries; a one-step zoom is unaffected (leading edge). |
| `COMMIT_DELAY_MS` | 300 ms | unchanged (D-040: „the command still delayed") | No longer on the drawing path; only history and other clients see the range later. |
| `OVERVIEW_TARGET` | 1025 (1,024–2,048 buckets) | Z2; lead's „~2048 buckets" | 2049: up to 4,096 buckets, ≤ 17 tiles ≈ 26k units per signal held by windows outside the LRU (50 signals ≈ 1.3 M units, ≈ 10–26 MB); placeholders 2× sharper. 513: ≤ 1 bucket per px at 1,000 px, the full-extent view no longer served by the overview. |
| `MERGE_DEPTH` | 2 | Z3 | 4: up to 16 children (4,096 buckets) merged per tile, ≈ 135k bucket merges per signal for a 33-tile view in one frame. 1: a ×4 zoom out in one step (two levels) is not served by merging. |
| `PLACEHOLDER_SEARCH` | 6 levels | Z4 | Only matters before the overview arrives. 12: twice the lookups (cheap). 3: after a ×16 zoom out without overview, no placeholder. |
| `SETTLE_MS` | 300 ms | Z7, equal to the command delay | 600: a user who zooms again after 400 ms gets no prefetch. 150: prefetch starts between the steps of a slow gesture and is aborted, wasting queries. |
| Prefetch coarser span | 3 view widths at level + 1 | Z7; D-040 „next zoom-out level" | Any ×2 zoom out around a pointer inside the view stays inside `[from − span, to + span)`. ×2 (5 widths): only helps pans after a zoom out, ≈ +70 % prefetch volume. ÷2 (1.5 widths): a ×2 zoom out near the plot edge misses up to half. |
| Prefetch neighbours | 1 view width each side, own level | Z7; D-040 „neighbouring tiles" | ×2: pans up to two views cached, twice the volume. ÷2: only half-view pans covered. |
| `PREFETCH_MAX_TILES` | 256 per window and rest | Z7 | At 1,000 px a signal needs ≈ 20 tiles (≈ 31k units), so 256 cover ≈ 12 signals, ≤ ≈ 400k units ≈ 10 % of `CACHE_LIMIT` per rest. 512: 20 % per rest, ten rests evict most history. 128: ≈ 6 signals per window prefetched. |
| `PREFETCH_IN_FLIGHT` | 2 per tab | Z6, against server concurrency 4 and Chrome's 6 HTTP/1.1 connections per host | 4: prefetch fills all server slots and a visible query waits one prefetch query (~50–100 ms). 1: ≈ 30 prefetch runs of 10 signals take ≈ 1.8 s instead of ≈ 0.9 s. |
| UI bound cached | ≤ 50 ms after the wheel | D-040 „within one frame (~16 ms)" + up to 16.7 ms waiting for the frame + measurement | 100: would pass a two-frame delay. 25: flaky on a busy frame. The one-frame rule itself is the "exactly one burst" check. |
| UI bound uncached | ≤ 200 ms after the wheel | D-040 „~150 ms"; lead's measurement: responses 55–110 ms after the request | 400: would almost pass today's 400–455 ms. 100: fails on the slower measured responses. A median between 150 and 200 ms passes, reported with the value for Jan. |

## Risks / Trade-offs

- **More drawing per gesture frame:** each step now sets new data (a placeholder or the cached view) instead of only rescaling the old data. Mitigation: stitched once per changed request in `update`; T1 measures the frame.
- **More database work:** a rest prefetches ≈ 5 view spans per signal (3 at the coarser level, 2 neighbours), at most 2 queries at a time. Mitigation: `PREFETCH_MAX_TILES`, cancelled by the next gesture, cached tiles skipped.
- **Placeholder flash:** for up to ~150 ms a curve can show coarser buckets (a wider envelope) before the sharp data; a cached part of the view is shown coarse too (Q1).
- **Overview memory outside the LRU:** bounded by the signals shown (≤ ≈ 14k units per signal).
- **`flushSync` from a frame callback:** allowed in event handlers and `requestAnimationFrame`; `applyRange` must never be called during render or a layout effect.
- **Stale extent:** the extent is fetched once per tab; data written later lies outside the overview and gets no placeholder there (empty tiles) until its sharp tiles arrive.

## Migration Plan

None: memory only. Rollback = revert the web change.

## Open Questions

Built as recommended until Jan decides otherwise.

- **Q1 Placeholder resolution:** (a) **recommended:** the whole curve at one coarser level until all its sharp tiles are there; keeps `SeriesResult`, drawing, readouts and the live cursor unchanged; with prefetch the placeholder level is usually only one level coarser. (b) Sharp where tiles are cached and coarse only where they are missing: needs mixed bucket widths in one result, a change of `build.ts`, `readout.ts` and the badge.
- **Q2 Marking the placeholder:** (a) **recommended:** nothing new; the resolution badge shows the coarser width and the legend the existing "loading" status for the ~0.1 s it lasts. (b) Draw placeholder curves dimmed (more flicker on every uncached step).
- **Q3 Linked windows during a gesture: decided by Jan, D-041** („with "Link time axes" on, every linked window shows the preview range and loads during the gesture like the zoomed one (a browser-local shared preview range, like the live cursor); the command is still sent once after the commit delay"; why: „otherwise the linked windows still lag 0.35–0.45 s, which defeats D-040"). Built in Z9.
