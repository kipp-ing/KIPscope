import type { Extent, SeriesResult } from "@kipscope/shared";
import { ApiRequestError, isCatalogLoading } from "../api.ts";
import type { RecoverReason, SeriesCache } from "./cache.ts";
import { GAP_LOADING_RETRY_MS } from "./gaps.ts";
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
export const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 16000, 30000] as const; // last one repeats (R2)
export const RETRY_FLOOR_MS = 1000; // no retry sooner after a key's failure (R3)

export interface LoaderOptions {
  /** Visible loads start at most once per interval (Z1); absent or 0: every load starts at once. */
  loadIntervalMs?: number;
  /** Extent per signal for the overview (Z2); absent: no overview, no placeholder from it. */
  extent?: (signalId: string) => Promise<Extent>;
  /** Prefetch at rest (Z7); absent or false: none. */
  prefetch?: boolean;
  /**
   * Retry failed loads with backoff and on recovery (R1); absent or false: a failed request stays
   * failed. With it, a 503 `catalog_unavailable` keeps the key loading until a retry succeeds,
   * retried after GAP_LOADING_RETRY_MS at most.
   */
  retry?: boolean;
}

export interface LoadRequest extends SeriesRequest {
  /** Assignment ID: one signal's place in a window. */
  key: string;
}

export interface LoadState {
  status: "loading" | "complete" | "error";
  /** Identity of the request this state belongs to. */
  request: string;
  /**
   * While loading, a placeholder or the previous result stays here so the window keeps showing it;
   * after a failure, the result shown when it failed (R5).
   */
  result?: SeriesResult;
  /** The failure; also kept while a retry of the same request loads (R5). */
  error?: string;
  /** HTTP status and code of an API failure, kept with `error` (add-case-open K14). */
  errorStatus?: number;
  errorCode?: string;
  /** Set while `result` is a placeholder of coarser tiles (Z4); never with status "complete". */
  placeholder?: true;
}

/** False only for a client error (4xx), which only the same request again retries (R4). */
export function retryable(error: unknown): boolean {
  return !(error instanceof ApiRequestError && error.status >= 400 && error.status <= 499);
}

/** The status text of a signal the shown data ref lacks (design DW13, DW16). */
export const MISSING = "missing";

/** The failure is a 404 `unknown_signal`: the shown data ref lacks the signal (DW13). */
export function isMissing(
  state: { errorStatus?: number | undefined; errorCode?: string | undefined } | undefined,
): boolean {
  return state?.errorStatus === 404 && state.errorCode === "unknown_signal";
}

/**
 * The legend's status text of a signal: MISSING for a 404 `unknown_signal`, in a case or not
 * (`_inCase` no longer changes it, DW13); failed while another error is kept; empty when complete.
 */
export function loadStatusText(state: LoadState | undefined, _inCase = false): string {
  if (isMissing(state)) return MISSING;
  if (state?.error !== undefined) return `failed: ${state.error}`;
  return state?.status === "complete" ? "" : "loading";
}

/**
 * What a window's requests follow besides view, target and width (H7): its signal assignments and
 * the tab's count of `window.setRange` commands. Equal for a new but equal `signals` array.
 */
export function loadKey(
  signals: readonly { id: string; signalId: string }[],
  rangeSets: number,
): string {
  return JSON.stringify([signals.map((s) => [s.id, s.signalId]), rangeSets]);
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
  /** The extent or its tiles failed; started again after the key's next complete view (R6). */
  failed?: true;
}

/** A key's failures in a row (R2): reset on a complete state. */
interface Failures {
  count: number;
  /** `Date.now()` of the last failure. */
  at: number;
  retryable: boolean;
  /** A success of another request already pulled this run forward (H9). */
  pulled?: true;
}

/**
 * Per timeseries window: the bucket target its loads ask with (its plot width), so the neighbour
 * preload requests the tiles the window will draw (add-case-open K13).
 */
export const windowTargets = new Map<string, number>();

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
  /** Per key: its failures in a row (R2). */
  private readonly failures = new Map<string, Failures>();
  /** Per key: its scheduled retry and when it is due (R6). */
  private readonly retries = new Map<
    string,
    { timer: ReturnType<typeof setTimeout>; at: number }
  >();
  /** Keys whose last load met a server still loading its catalog: loading, a retry is due. */
  private readonly waiting = new Set<string>();
  /** Set while subscribed to the cache's recovery signal: while a key holds an error (R3, R7). */
  private unsubscribe: (() => void) | undefined;

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
    let retried = false;
    for (const request of requests) {
      const state = this.states.get(request.key);
      if (state?.request === requestId(request)) {
        // The same request again retries a failed load, a 4xx too, after the floor (R3 c); a
        // missing signal stays missing for the same view (DW13).
        if (this.options.retry && state.status === "error" && !isMissing(state)) {
          const at = (this.failures.get(request.key)?.at ?? 0) + RETRY_FLOOR_MS;
          if (at <= Date.now()) {
            this.clearRetry(request.key);
            this.beginRetry(request.key, state);
            loads.push(request);
            retried = true;
          } else this.retryAt(request.key, at);
        }
        continue;
      }
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
    this.maybeUnsubscribe();
    if (changed) this.restartRest();
    if (changed || retried) this.onChange();
  }

  /**
   * The workspace's scope changed (add-scope Z12): every key loads its current request again at
   * once, keeping what it shows meanwhile, and its overview after that; its failures in a row start
   * over. A complete key reloads too: its tiles and the value lines at its edges were bounded by the
   * old scope; the cache answers what it may (add-case-open K12). A new sequence number drops any
   * late answer of the old scope. The reload waits for a microtask, so the window's update of the
   * same commit runs first: a key it gives a new request (a step's range, a rebound signal) loads
   * only that, never its old view under the new scope (a wasted fetch, or 409 out_of_scope).
   */
  rescope(): void {
    for (const request of this.order) this.dropOverview(request.key);
    if (this.order.length === 0) return;
    const marks = new Map(this.order.map((r) => [r.key, this.latest.get(r.key)]));
    queueMicrotask(() => this.reloadKept(marks));
  }

  /** The reload of `rescope` for the keys whose request did not change since (`marks`). */
  private reloadKept(marks: Map<string, number | undefined>): void {
    if (this.order.length === 0) return; // disposed meanwhile
    const loads: LoadRequest[] = [];
    for (const request of this.order) {
      const { key } = request;
      if (!marks.has(key) || this.latest.get(key) !== marks.get(key)) continue;
      const state = this.states.get(key);
      if (state?.request === requestId(request)) {
        this.clearRetry(key);
        this.failures.delete(key);
        this.beginRetry(key, state);
        loads.push(request);
      }
    }
    if (loads.length > 0) {
      if (this.interval !== undefined) {
        for (const request of loads) this.pending.set(request.key, request);
      } else {
        for (const request of loads) this.load(request);
        this.beginInterval();
      }
    }
    this.maybeUnsubscribe();
    this.onChange();
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
    for (const key of [...this.retries.keys()]) this.clearRetry(key);
    this.failures.clear();
    this.waiting.clear();
    this.maybeUnsubscribe();
  }

  private remove(key: string): void {
    this.forget(key);
    this.dropOverview(key);
    this.pending.delete(key);
    this.states.delete(key);
    this.latest.delete(key);
    this.clearRetry(key);
    this.failures.delete(key);
    this.waiting.delete(key);
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
    this.clearRetry(key);
    this.waiting.delete(key);
    const id = requestId(request);
    const view = viewOf(request);
    if (view.tileable) {
      const tiles = this.cached(signalId, view);
      if (tiles) {
        this.pending.delete(key);
        this.forget(key);
        this.complete(key, id, stitch(tiles, view.from, view.to));
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
      this.complete(key, id, stitch(tiles as Tile[], view.from, view.to));
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
        this.complete(key, id, stitch(all, view.from, view.to));
        this.finished(key, signalId);
      },
      (error: unknown) => {
        if (!isCurrent()) return;
        this.fail(key, id, error);
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
        this.complete(key, id, result);
        this.finished(key, signalId);
      },
      (error: unknown) => {
        if (!isCurrent() || controller.signal.aborted) return;
        this.fail(key, id, error);
        this.finished(key, signalId);
      },
    );
  }

  /** The key's request is complete: its failures in a row end (R2). */
  private complete(key: string, id: string, result: SeriesResult): void {
    this.states.set(key, { status: "complete", request: id, result });
    this.failures.delete(key);
    this.clearRetry(key);
    this.waiting.delete(key);
    this.maybeUnsubscribe();
  }

  /**
   * The key's request failed: the shown result and placeholder stay (R5), except for a missing
   * signal (DW13). With `retry`, the failure counts and a retryable one is retried after the next delay of the sequence (R2).
   */
  private fail(key: string, id: string, error: unknown): void {
    const shown = this.states.get(key);
    // The server still loads its catalog: with `retry` the key stays loading, without an error.
    const waits = this.options.retry === true && isCatalogLoading(error);
    // A missing signal keeps no result: it belongs to a data ref that had the signal (DW13).
    const missing =
      error instanceof ApiRequestError &&
      isMissing({ errorStatus: error.status, errorCode: error.code });
    this.states.set(key, {
      ...(waits
        ? { status: "loading", request: id }
        : {
            status: "error",
            request: id,
            error: error instanceof Error ? error.message : String(error),
            ...(error instanceof ApiRequestError
              ? { errorStatus: error.status, errorCode: error.code }
              : {}),
          }),
      ...(shown?.result && !missing ? { result: shown.result } : {}),
      ...(shown?.placeholder && !missing ? { placeholder: true } : {}),
    });
    if (waits) this.waiting.add(key);
    if (!this.options.retry) return;
    const previous = this.failures.get(key);
    const count = (previous?.count ?? 0) + 1;
    const at = Date.now();
    const again = retryable(error);
    // `pulled` lasts for the whole run of failures; `complete` ends the run (H9).
    this.failures.set(key, {
      count,
      at,
      retryable: again,
      ...(previous?.pulled ? { pulled: true } : {}),
    });
    this.unsubscribe ??= this.cache.onRecover((reason) => this.recovered(reason));
    if (!again) return;
    const backoff = RETRY_DELAYS_MS[Math.min(count, RETRY_DELAYS_MS.length) - 1] as number;
    // While the catalog loads, poll as fast as the gap store does.
    const delay = waits ? Math.min(backoff, GAP_LOADING_RETRY_MS) : backoff;
    this.retryAt(key, at + delay);
  }

  /**
   * Something of the tab succeeded or the live channel opened: retry failed keys now (R3 a, b). A
   * success pulls a key forward once per run of failures, a reconnect always (H9).
   */
  private recovered(reason: RecoverReason): void {
    const now = Date.now();
    const keys = [...this.states]
      .filter(([key, s]) => s.status === "error" || this.waiting.has(key))
      .map(([key]) => key);
    for (const key of keys) {
      const failures = this.failures.get(key);
      if (!failures?.retryable) continue;
      if (reason === "success") {
        if (failures.pulled) continue;
        failures.pulled = true;
      }
      this.retryAt(key, Math.max(now, failures.at + RETRY_FLOOR_MS));
    }
  }

  /** Retries the key at `at`, at once when due; an earlier scheduled retry stays. */
  private retryAt(key: string, at: number): void {
    const scheduled = this.retries.get(key);
    if (scheduled && scheduled.at <= at) return;
    this.clearRetry(key);
    const delay = at - Date.now();
    if (delay <= 0) {
      this.retry(key);
      return;
    }
    this.retries.set(key, { timer: setTimeout(() => this.retry(key), delay), at });
  }

  private clearRetry(key: string): void {
    clearTimeout(this.retries.get(key)?.timer);
    this.retries.delete(key);
  }

  /**
   * Loads the key's current request again, like a throttled visible load, if it is still failed or
   * waiting for the catalog.
   */
  private retry(key: string): void {
    this.clearRetry(key);
    const request = this.order.find((r) => r.key === key);
    const state = this.states.get(key);
    const due = state?.status === "error" || this.waiting.has(key);
    if (!request || !state || !due || state.request !== requestId(request)) return;
    this.beginRetry(key, state);
    if (this.interval !== undefined) this.pending.set(key, request);
    else if (this.load(request)) this.beginInterval();
    this.onChange();
  }

  /** A retry loads under a new sequence number and keeps the failed state's result and error (R5). */
  private beginRetry(key: string, state: LoadState): void {
    this.waiting.delete(key);
    this.latest.set(key, ++this.seq);
    this.states.set(key, { ...state, status: "loading" });
  }

  /** Drops the recovery subscription once no key holds an error or waits for the catalog. */
  private maybeUnsubscribe(): void {
    if (this.unsubscribe === undefined || this.waiting.size > 0) return;
    for (const state of this.states.values()) if (state.error !== undefined) return;
    this.unsubscribe();
    this.unsubscribe = undefined;
  }

  /** After a load of the key's current request answered. */
  private finished(key: string, signalId: string): void {
    this.firstViewDone(key, signalId);
    this.onChange();
    this.maybePrefetch();
  }

  /** Loads the key's overview once its first view has finished (Z2), again after a failed one (R6). */
  private firstViewDone(key: string, signalId: string): void {
    const extentOf = this.options.extent;
    if (!extentOf) return;
    const existing = this.overviews.get(key);
    const restart = existing?.failed && this.states.get(key)?.status === "complete";
    if (existing?.signalId === signalId && !restart) return;
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
        // A failed overview is tried again after the key's next complete view (R6).
        Promise.all(loads).then(
          (loaded) => {
            if (!isCurrent()) return;
            for (const tile of loaded) overview.tiles.set(tile.index, tile);
            this.overviewLoaded();
          },
          () => {
            overview.failed = true;
          },
        );
      })
      .catch(() => {
        overview.failed = true;
      });
  }

  private dropOverview(key: string): void {
    const owner = this.overviews.get(key)?.owner;
    if (owner !== undefined) this.cache.release(owner);
    this.overviews.delete(key);
  }

  /** Recomputes the placeholder of every key still loading, or failed without sharp data (Z2, R5). */
  private overviewLoaded(): void {
    let changed = false;
    for (const request of this.order) {
      const state = this.states.get(request.key);
      if (!state || state.status === "complete" || state.request !== requestId(request)) continue;
      if (state.status === "error" && state.result && !state.placeholder) continue;
      if (isMissing(state)) continue;
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
