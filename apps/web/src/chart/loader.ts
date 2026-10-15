import type { Extent, SeriesResult } from "@letsview/shared";
import type { SeriesCache } from "./cache.ts";
import {
  emptyTile,
  levelFor,
  MAX_LEVEL,
  overviewTiles,
  PLACEHOLDER_SEARCH,
  placeholder,
  prefetchPlan,
  type SeriesRequest,
  stitch,
  type Tile,
  type TileRange,
  tileable,
  tileSpan,
  touchedTiles,
} from "./tiles.ts";

export const LOAD_INTERVAL_MS = 100; // visible loads start at most once per interval (Z1)
export const SETTLE_MS = 300; // rest before the prefetch (Z7)
export const PREFETCH_MAX_TILES = 256; // per window and rest (Z7)

export interface LoaderOptions {
  /** Visible loads start at most once per interval (Z1); absent or 0: every load starts at once. */
  loadIntervalMs?: number;
  /** Extent per signal for the overview (Z2); absent: no overview, no placeholder from it. */
  extent?: (signalId: string) => Promise<Extent>;
  /** Prefetch at rest (Z7); absent or false: none. */
  prefetch?: boolean;
}

export interface LoadRequest extends SeriesRequest {
  /** Assignment ID: one signal's place in a window. */
  key: string;
}

export interface LoadState {
  status: "loading" | "complete" | "error";
  /** Identity of the request this state belongs to. */
  request: string;
  /** While loading, a placeholder or the previous result stays here so the window keeps showing it. */
  result?: SeriesResult;
  error?: string;
  /** Set while `result` is a placeholder of coarser tiles (Z4); only with status "loading". */
  placeholder?: true;
}

const requestId = (r: LoadRequest) => `${r.signalId}|${r.from}|${r.to}|${r.target}`;

/** A request's tile grid; not `tileable` → fetched exactly and not cached (C1 fallback). */
interface View {
  from: bigint;
  to: bigint;
  level: number;
  first: bigint;
  last: bigint;
  tileable: boolean;
}

function viewOf(request: LoadRequest): View {
  const from = BigInt(request.from);
  const to = BigInt(request.to);
  const level = levelFor(from, to, request.target);
  const { first, last } = touchedTiles(from, to, level);
  return { from, to, level, first, last, tileable: tileable(level, first, last) };
}

/** A key's overview (Z2): its signal's extent and the tiles of one coarse level, held by reference. */
interface Overview {
  signalId: string;
  extent?: { first: bigint; last: bigint };
  range?: TileRange;
  tiles: Map<bigint, Tile>;
  owner?: string;
}

let loaders = 0;

/**
 * Loads series per signal of one window from the tab's tile cache (design C7, Z1–Z7). A view whose
 * tiles are all cached completes at once; otherwise a placeholder of coarser tiles or the previous
 * result stays while its missing tiles load (throttled to one start per interval). A response is
 * applied only if it belongs to the latest request for its signal, so an out-of-order answer can
 * never replace newer data. With options it also loads an overview per signal and prefetches at rest.
 */
export class SeriesLoader {
  private readonly cache: SeriesCache;
  private readonly onChange: () => void;
  private readonly options: LoaderOptions;
  private readonly id = ++loaders;
  private readonly states = new Map<string, LoadState>();
  /** Per key: the cache owner of its current view's tiles. */
  private readonly owners = new Map<string, string>();
  /** Per key: the exact request of a view that cannot be tiled (C1 fallback). */
  private readonly controllers = new Map<string, AbortController>();
  private readonly latest = new Map<string, number>();
  private seq = 0;
  /** The requests of the last update, in the window's order. */
  private order: LoadRequest[] = [];
  /** Keys whose load waits for the end of the throttle interval, with their current request (Z1). */
  private readonly pending = new Map<string, LoadRequest>();
  /** Set while a throttle interval runs. */
  private interval: ReturnType<typeof setTimeout> | undefined;
  private readonly overviews = new Map<string, Overview>();
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  /** The settle timer has fired and this rest has not prefetched yet (Z7). */
  private rested = false;
  private prefetchOwner: string | undefined;
  private prefetches = 0;

  constructor(cache: SeriesCache, onChange: () => void, options: LoaderOptions = {}) {
    this.cache = cache;
    this.onChange = onChange;
    this.options = options;
  }

  get(key: string): LoadState | undefined {
    return this.states.get(key);
  }

  /** True when every requested signal has finished (complete or error) for its current request. */
  settled(requests: LoadRequest[]): boolean {
    return requests.every((r) => {
      const s = this.states.get(r.key);
      return s !== undefined && s.request === requestId(r) && s.status !== "loading";
    });
  }

  update(requests: LoadRequest[]): void {
    const wanted = new Set(requests.map((r) => r.key));
    let changed = false;
    for (const key of [...this.states.keys()]) {
      if (!wanted.has(key)) {
        this.remove(key);
        changed = true;
      }
    }
    this.order = requests;
    const loads: LoadRequest[] = [];
    for (const request of requests) {
      if (this.states.get(request.key)?.request === requestId(request)) continue;
      if (this.show(request)) loads.push(request);
      changed = true;
    }
    if (loads.length > 0) {
      if (this.interval !== undefined) {
        for (const request of loads) this.pending.set(request.key, request);
      } else {
        for (const request of loads) this.load(request);
        this.beginInterval();
      }
    }
    if (changed) {
      this.restartRest();
      this.onChange();
    }
  }

  /**
   * Releases every tile and aborts every request and forgets every state, so a later update starts
   * all of them again (React's StrictMode disposes and remounts once; a kept "loading" state would
   * never fill). Also clears the timers and releases the overview and prefetch owners.
   */
  dispose(): void {
    for (const key of [...this.owners.keys(), ...this.controllers.keys()]) this.forget(key);
    for (const key of [...this.overviews.keys()]) this.dropOverview(key);
    this.states.clear();
    this.latest.clear();
    this.pending.clear();
    this.order = [];
    clearTimeout(this.interval);
    this.interval = undefined;
    clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
    this.rested = false;
    this.stopPrefetch();
  }

  private remove(key: string): void {
    this.forget(key);
    this.dropOverview(key);
    this.pending.delete(key);
    this.states.delete(key);
    this.latest.delete(key);
  }

  /** Lets go of the key's tiles and aborts its exact request. */
  private forget(key: string): void {
    const owner = this.owners.get(key);
    if (owner !== undefined) this.cache.release(owner);
    this.owners.delete(key);
    this.controllers.get(key)?.abort();
    this.controllers.delete(key);
  }

  /** The view's tiles when the cache holds all of them. */
  private cached(signalId: string, view: View): Tile[] | undefined {
    const tiles: Tile[] = [];
    for (let index = view.first; index <= view.last; index++) {
      const tile = this.cache.find(signalId, view.level, index);
      if (!tile) return undefined;
      tiles.push(tile);
    }
    return tiles;
  }

  /**
   * Makes `request` the key's current one and sets its state: complete from the cache, else
   * loading with a placeholder (Z4) or the previous result. True when its tiles must be loaded.
   */
  private show(request: LoadRequest): boolean {
    const { key, signalId } = request;
    this.latest.set(key, ++this.seq);
    const id = requestId(request);
    const view = viewOf(request);
    if (view.tileable) {
      const tiles = this.cached(signalId, view);
      if (tiles) {
        this.pending.delete(key);
        this.forget(key);
        this.states.set(key, {
          status: "complete",
          request: id,
          result: stitch(tiles, view.from, view.to),
        });
        this.firstViewDone(key, signalId);
        return false;
      }
      const shown = this.placeholderOf(key, signalId, view);
      if (shown) {
        this.states.set(key, { status: "loading", request: id, result: shown, placeholder: true });
        return true;
      }
    }
    const previous = this.states.get(key)?.result;
    this.states.set(key, {
      status: "loading",
      request: id,
      ...(previous ? { result: previous } : {}),
    });
    return true;
  }

  /** The view at the finest coarser level the cache or the key's overview fully provides (Z4). */
  private placeholderOf(key: string, signalId: string, view: View): SeriesResult | undefined {
    const overview = this.overviews.get(key);
    const range = overview?.signalId === signalId ? overview.range : undefined;
    const maxLevel = Math.min(
      MAX_LEVEL,
      Math.max(range?.level ?? 0, view.level + PLACEHOLDER_SEARCH),
    );
    return placeholder(view.from, view.to, view.level, maxLevel, (level, index) => {
      const tile = this.cache.find(signalId, level, index);
      if (tile || !overview || !range || level !== range.level) return tile;
      if (index < range.first || index > range.last) return emptyTile(signalId, level, index);
      return overview.tiles.get(index);
    });
  }

  private beginInterval(): void {
    const ms = this.options.loadIntervalMs ?? 0;
    if (ms > 0) this.interval = setTimeout(() => this.endInterval(), ms);
  }

  /** Loads every pending key's current request; a new interval begins if anything started (Z1). */
  private endInterval(): void {
    this.interval = undefined;
    const due = [...this.pending.values()];
    this.pending.clear();
    let started = false;
    let completed = false;
    for (const request of due) {
      if (this.load(request)) started = true;
      else completed = true;
    }
    if (started) this.beginInterval();
    if (completed) this.onChange();
    this.maybePrefetch();
  }

  /**
   * Starts loading the key's current request: its missing tiles, or the exact request. False when
   * the cache meanwhile holds all its tiles (the state is then complete).
   */
  private load(request: LoadRequest): boolean {
    const { key, signalId } = request;
    const seq = this.latest.get(key) ?? 0;
    const id = requestId(request);
    const view = viewOf(request);
    if (!view.tileable) {
      this.forget(key);
      this.fetchExact(request, seq);
      return true;
    }
    this.controllers.get(key)?.abort();
    this.controllers.delete(key);

    const tiles: (Tile | undefined)[] = [];
    const missing: bigint[] = [];
    for (let index = view.first; index <= view.last; index++) {
      const tile = this.cache.find(signalId, view.level, index);
      tiles.push(tile);
      if (!tile) missing.push(index);
    }
    const previousOwner = this.owners.get(key);
    if (missing.length === 0) {
      this.owners.delete(key);
      if (previousOwner !== undefined) this.cache.release(previousOwner);
      const result = stitch(tiles as Tile[], view.from, view.to);
      this.states.set(key, { status: "complete", request: id, result });
      this.firstViewDone(key, signalId);
      return false;
    }

    const owner = `${this.id}|${key}|${seq}`;
    const loads = this.cache.load(owner, signalId, view.level, missing);
    this.owners.set(key, owner);
    // Only now, so tiles the old and the new view share keep their run alive.
    if (previousOwner !== undefined) this.cache.release(previousOwner);

    const isCurrent = () => this.latest.get(key) === seq;
    Promise.all(loads).then(
      (loaded) => {
        if (!isCurrent()) return;
        let next = 0;
        const all = tiles.map((tile) => tile ?? (loaded[next++] as Tile));
        const result = stitch(all, view.from, view.to);
        this.states.set(key, { status: "complete", request: id, result });
        this.finished(key, signalId);
      },
      (error: unknown) => {
        if (!isCurrent()) return;
        const message = error instanceof Error ? error.message : String(error);
        this.states.set(key, { status: "error", request: id, error: message });
        this.finished(key, signalId);
      },
    );
    return true;
  }

  /** A view outside the tile grid: fetched exactly as requested and not cached. */
  private fetchExact(request: LoadRequest, seq: number): void {
    const { key, signalId, from, to, target } = request;
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const id = requestId(request);

    const isCurrent = () => this.latest.get(key) === seq;
    this.cache.fetch({ signalId, from, to, target }, controller.signal).then(
      (result) => {
        if (!isCurrent()) return;
        this.states.set(key, { status: "complete", request: id, result });
        this.finished(key, signalId);
      },
      (error: unknown) => {
        if (!isCurrent() || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        this.states.set(key, { status: "error", request: id, error: message });
        this.finished(key, signalId);
      },
    );
  }

  /** After a load of the key's current request answered. */
  private finished(key: string, signalId: string): void {
    this.firstViewDone(key, signalId);
    this.onChange();
    this.maybePrefetch();
  }

  /** Loads the key's overview once its first view has finished (Z2). */
  private firstViewDone(key: string, signalId: string): void {
    const extentOf = this.options.extent;
    if (!extentOf) return;
    const existing = this.overviews.get(key);
    if (existing?.signalId === signalId) return;
    if (existing) this.dropOverview(key);
    const overview: Overview = { signalId, tiles: new Map() };
    this.overviews.set(key, overview);
    const isCurrent = () => this.overviews.get(key) === overview;
    extentOf(signalId)
      .then((extent) => {
        if (!isCurrent()) return;
        const first = BigInt(extent.first);
        const last = BigInt(extent.last);
        overview.extent = { first, last };
        const range = overviewTiles(first, last);
        if (!tileable(range.level, range.first, range.last)) return;
        overview.range = range;
        const missing: bigint[] = [];
        for (let index = range.first; index <= range.last; index++) {
          const tile = this.cache.find(signalId, range.level, index);
          if (tile) overview.tiles.set(index, tile);
          else missing.push(index);
        }
        if (missing.length === 0) {
          this.overviewLoaded();
          return;
        }
        overview.owner = `${this.id}|overview|${key}`;
        const loads = this.cache.load(overview.owner, signalId, range.level, missing, "prefetch");
        // A failed overview is tried again when the key is added again.
        Promise.all(loads).then(
          (loaded) => {
            if (!isCurrent()) return;
            for (const tile of loaded) overview.tiles.set(tile.index, tile);
            this.overviewLoaded();
          },
          () => {},
        );
      })
      .catch(() => {});
  }

  private dropOverview(key: string): void {
    const owner = this.overviews.get(key)?.owner;
    if (owner !== undefined) this.cache.release(owner);
    this.overviews.delete(key);
  }

  /** Recomputes the placeholder of every key still loading (Z2). */
  private overviewLoaded(): void {
    let changed = false;
    for (const request of this.order) {
      const state = this.states.get(request.key);
      if (state?.status !== "loading" || state.request !== requestId(request)) continue;
      const view = viewOf(request);
      if (!view.tileable) continue;
      const shown = this.placeholderOf(request.key, request.signalId, view);
      if (!shown) continue;
      this.states.set(request.key, { ...state, result: shown, placeholder: true });
      changed = true;
    }
    if (changed) this.onChange();
  }

  /** A changing update: the prefetch of the last rest stops and a new rest begins (Z7). */
  private restartRest(): void {
    if (!this.options.prefetch) return;
    this.stopPrefetch();
    this.rested = false;
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      this.rested = true;
      this.maybePrefetch();
    }, SETTLE_MS);
  }

  private stopPrefetch(): void {
    if (this.prefetchOwner !== undefined) this.cache.release(this.prefetchOwner);
    this.prefetchOwner = undefined;
  }

  /** Prefetches once per rest, when every key has finished and no load is pending (Z7). */
  private maybePrefetch(): void {
    if (!this.rested || this.pending.size > 0) return;
    for (const state of this.states.values()) if (state.status === "loading") return;
    this.rested = false;
    const owner = `${this.id}|prefetch|${++this.prefetches}`;
    this.prefetchOwner = owner;
    let budget = PREFETCH_MAX_TILES;
    for (const request of this.order) {
      const view = viewOf(request);
      if (!view.tileable) continue;
      const extent = this.overviews.get(request.key)?.extent;
      for (const range of prefetchPlan(view.from, view.to, view.level)) {
        const span = tileSpan(range.level);
        const indices: bigint[] = [];
        for (let index = range.first; index <= range.last && budget > 0; index++) {
          if (!tileable(range.level, index, index)) continue;
          if (extent && (index * span > extent.last || (index + 1n) * span <= extent.first))
            continue;
          if (!this.cache.storable(range.level, index)) continue;
          if (this.cache.find(request.signalId, range.level, index)) continue;
          indices.push(index);
          budget--;
        }
        if (indices.length === 0) continue;
        const loads = this.cache.load(owner, request.signalId, range.level, indices, "prefetch");
        // Prefetch draws nothing; a failed or aborted tile is loaded again when a view wants it.
        for (const load of loads) load.catch(() => {});
      }
    }
  }
}
