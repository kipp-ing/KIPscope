import {
  assertSeries,
  parseSignalId,
  type SeriesResult,
  scopeKey,
  TIME_MAX,
  TIME_MIN,
  type WorkspaceScope,
} from "@kipscope/shared";
import { type CaseRequestOptions, fetchSeries } from "../api.ts";
import {
  deriveRaw,
  FRESH_MARGIN_NS,
  MAX_RUN_TILES,
  MERGE_DEPTH,
  mergeUp,
  runRequest,
  type SeriesRequest,
  splitRun,
  type Tile,
  tileId,
  tileSpan,
  tileWeight,
} from "./tiles.ts";

export const CACHE_LIMIT = 4_000_000; // weight units (C5)
export const PREFETCH_IN_FLIGHT = 2; // prefetch and preload runs fetched at once per tab (Z6, K13)

/** "preload" ranks below "prefetch" and shares its slots (add-case-open K13). */
export type Priority = "visible" | "prefetch" | "preload";

/** Why the source may be reachable again: an answer through the cache, or the live channel opened (H9). */
export type RecoverReason = "success" | "reconnect";

export type FetchSeries = (
  request: SeriesRequest & CaseRequestOptions,
  abort: AbortSignal,
) => Promise<SeriesResult>;

/** The scope tiles are fetched and used under (add-case-open K12); undefined: no scope. */
interface CacheScope {
  key: string;
  dataRef: string;
  from: bigint;
  to: bigint;
}

const cacheScope = (scope: WorkspaceScope | undefined): CacheScope | undefined =>
  scope && {
    key: scopeKey(scope),
    dataRef: scope.dataRef,
    from: BigInt(scope.from),
    to: BigInt(scope.to),
  };

/** A preload run's target: the catalog entry and its scope (add-case-open K13). */
export interface PreloadTarget {
  /** 0-based catalog index, sent as `case=<n>`. */
  case: number;
  scope: WorkspaceScope;
}

export interface CacheOptions {
  limit?: number; // default CACHE_LIMIT
  now?: () => number; // ms since epoch, default Date.now (C6)
}

/** One request in flight for adjacent tiles of one signal and level, and who wants it. */
interface Run {
  controller: AbortController;
  owners: Set<string>;
  /** Fetches the run; set only while it waits in the prefetch queue (Z6). */
  begin?: (() => void) | undefined;
  /** Fetched as prefetch or preload: holds one of the PREFETCH_IN_FLIGHT slots until it finishes. */
  counted?: boolean;
  /** Fetched as a visible load: counts in `visibleInFlight` until it finishes. */
  visible?: boolean;
  /** The scope the run is fetched under: its tiles are stored by it (K12). */
  scope: CacheScope | undefined;
  /** A preload run: sent with `case=<n>` and the preload class until a visible load takes it over. */
  preload?: PreloadTarget | undefined;
}

interface Stored {
  tile: Tile;
  weight: number;
  /** A raw tile without `before` (`after`) fetched under a scope: that scope's start (end) (K12). */
  cutFrom?: bigint;
  cutTo?: bigint;
}

interface InFlight {
  run: Run;
  promise: Promise<Tile>;
}

/**
 * The tab's series tiles (design C2): stored tiles in least-recently-used order under a weight
 * limit (C5), and the runs in flight, shared by every loader of the tab and aborted only when no
 * owner wants them any more.
 */
export class SeriesCache {
  readonly fetch: FetchSeries;
  private readonly limit: number;
  private readonly now: () => number;
  /** Stored tiles; a Map keeps insertion order, so re-inserting on use makes the first the oldest. */
  private readonly tiles = new Map<string, Stored>();
  /** Per signal: levels holding stored raw tiles, with their count (C3). */
  private readonly rawLevels = new Map<string, Map<number, number>>();
  private readonly inFlight = new Map<string, InFlight>();
  private readonly owned = new Map<string, Set<Run>>();
  /** Prefetch runs waiting for a slot, oldest first (Z6). */
  private readonly queue: Run[] = [];
  /** Preload runs waiting for a slot, oldest first; fetched only when no prefetch run waits (K13). */
  private readonly preloadQueue: Run[] = [];
  private prefetchRunning = 0;
  private visibleRunning = 0;
  /** The workspace's scope: loads fetch and find under it (K12). */
  private scope: CacheScope | undefined;
  private weight = 0;
  /** Counts `clear()` calls: a run started before the last one stores nothing (add-scope Z12). */
  private generation = 0;
  private readonly recoverListeners = new Set<(reason: RecoverReason) => void>();

  constructor(fetch: FetchSeries, options: CacheOptions = {}) {
    // Every well-formed answer through the cache tells the listeners the source is reachable (R7);
    // a malformed one rejects like a failed request, stores no tile and is no recovery (H1).
    this.fetch = (request, abort) =>
      fetch(request, abort).then((result) => {
        assertSeries(result);
        this.notify("success");
        return result;
      });
    this.limit = options.limit ?? CACHE_LIMIT;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.weight;
  }

  peek(signalId: string, level: number, index: bigint): Tile | undefined {
    return this.tiles.get(tileId(signalId, level, index))?.tile;
  }

  get queuedPrefetch(): number {
    return this.queue.length;
  }

  get queuedPreload(): number {
    return this.preloadQueue.length;
  }

  /** Runs fetched for a visible load that have not answered yet (the preload waits for 0, K13). */
  get visibleInFlight(): number {
    return this.visibleRunning;
  }

  /**
   * The workspace's scope changed (add-case-open K12): stored tiles stay, later loads fetch and
   * find under `scope`; runs in flight under another scope answer only their own owners.
   */
  setScope(scope: WorkspaceScope | undefined): void {
    this.scope = cacheScope(scope);
  }

  /**
   * Called with "success" after every well-formed answer through the cache and with "reconnect" on
   * `recover()`; returns unsubscribe (R7, H9).
   */
  onRecover(listener: (reason: RecoverReason) => void): () => void {
    this.recoverListeners.add(listener);
    return () => {
      this.recoverListeners.delete(listener);
    };
  }

  /**
   * Forgets every stored tile and every run in flight, so later loads fetch again; a run being
   * fetched still answers its owners but stores nothing, a waiting prefetch run is aborted unfetched
   * so no query of the old scope starts (add-scope Z12: the workspace's scope changed).
   */
  clear(): void {
    for (const id of [...this.tiles.keys()]) this.remove(id);
    // The abort rejects the waiting runs' promises, as a release does; their owners ask again.
    for (const run of [...this.queue.splice(0), ...this.preloadQueue.splice(0)]) {
      run.begin = undefined;
      run.controller.abort();
      for (const owner of run.owners) this.owned.get(owner)?.delete(run);
    }
    this.inFlight.clear();
    this.generation++;
  }

  /** Tells listeners the source may be reachable again (live channel opened). */
  recover(): void {
    this.notify("reconnect");
  }

  /** Calls the listeners once, in a microtask, outside the cache's own bookkeeping. */
  private notify(reason: RecoverReason): void {
    queueMicrotask(() => {
      for (const listener of [...this.recoverListeners]) listener(reason);
    });
  }

  /**
   * The stored tile, else one cut from a stored coarser raw tile (C3), else merged from its two
   * children found the same way, at most MERGE_DEPTH levels down (Z3); derived tiles are not stored.
   */
  find(
    signalId: string,
    level: number,
    index: bigint,
    scope: WorkspaceScope | undefined = undefined,
  ): Tile | undefined {
    const under = scope ? cacheScope(scope) : this.scope;
    // A signal of another data ref than the scope's answers 409 out_of_scope, never a tile.
    if (under && parseSignalId(signalId)?.dataRef !== under.dataRef) return undefined;
    return this.findUpTo(signalId, level, index, MERGE_DEPTH, under);
  }

  private findUpTo(
    signalId: string,
    level: number,
    index: bigint,
    depth: number,
    scope: CacheScope | undefined,
  ): Tile | undefined {
    const own = this.use(tileId(signalId, level, index), scope);
    if (own) return own;
    const levels = this.rawLevels.get(signalId);
    for (const parentLevel of levels?.keys() ?? []) {
      if (parentLevel <= level) continue;
      const parentIndex = index >> BigInt(parentLevel - level);
      const parent = this.use(tileId(signalId, parentLevel, parentIndex), scope);
      if (parent?.data.kind === "raw") return deriveRaw(parent, level, index);
    }
    if (depth <= 0 || level <= 0) return undefined;
    const left = this.findUpTo(signalId, level - 1, index * 2n, depth - 1, scope);
    if (!left) return undefined;
    const right = this.findUpTo(signalId, level - 1, index * 2n + 1n, depth - 1, scope);
    return right && mergeUp(left, right);
  }

  /** False for a tile that would not be stored (ends after now − FRESH_MARGIN_NS, C6). */
  storable(level: number, index: bigint): boolean {
    const end = (index + 1n) * tileSpan(level);
    return end <= BigInt(Math.floor(this.now())) * 1_000_000n - FRESH_MARGIN_NS;
  }

  /**
   * Promises of the tiles, joining runs in flight under the same scope and starting runs for the
   * rest. A "prefetch" run waits while PREFETCH_IN_FLIGHT prefetch or preload runs are fetched; a
   * "preload" run (with its `target` entry and scope, K13) waits behind every waiting prefetch run;
   * a "visible" load never waits and starts a waiting run it wants at once (Z6), a preload run
   * then without its preload class.
   */
  load(
    owner: string,
    signalId: string,
    level: number,
    indices: readonly bigint[],
    priority: Priority = "visible",
    target?: PreloadTarget,
  ): Promise<Tile>[] {
    const runs = this.owned.get(owner) ?? new Set<Run>();
    this.owned.set(owner, runs);
    const scope = target ? cacheScope(target.scope) : this.scope;
    const promises = new Map<bigint, Promise<Tile>>();
    const missing: bigint[] = [];
    for (const index of indices) {
      const flight = this.inFlight.get(flightKey(signalId, level, index, scope));
      if (flight) {
        flight.run.owners.add(owner);
        runs.add(flight.run);
        promises.set(index, flight.promise);
        if (priority === "visible" && flight.run.begin) {
          this.unqueue(flight.run);
          flight.run.preload = undefined;
          flight.run.visible = true;
          this.visibleRunning++;
          flight.run.begin();
        }
      } else if (!missing.includes(index)) {
        missing.push(index);
      }
    }
    missing.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    // Adjacent missing indices form one run of at most MAX_RUN_TILES tiles (C1).
    const groups: { first: bigint; last: bigint }[] = [];
    for (const index of missing) {
      const group = groups.at(-1);
      if (group && index === group.last + 1n && index - group.first < MAX_RUN_TILES) {
        group.last = index;
      } else {
        groups.push({ first: index, last: index });
      }
    }
    for (const { first, last } of groups) {
      const run: Run = {
        controller: new AbortController(),
        owners: new Set([owner]),
        scope,
        ...(priority === "preload" && target ? { preload: target } : {}),
      };
      runs.add(run);
      for (const [index, promise] of this.startRun(run, signalId, level, first, last)) {
        promises.set(index, promise);
      }
      if (priority === "visible") {
        run.visible = true;
        this.visibleRunning++;
        run.begin?.();
      } else if (priority === "preload") this.preloadQueue.push(run);
      else this.queue.push(run);
    }
    this.pump();
    return indices.map((index) => promises.get(index) as Promise<Tile>);
  }

  release(owner: string): void {
    const runs = this.owned.get(owner);
    if (!runs) return;
    this.owned.delete(owner);
    for (const run of runs) {
      run.owners.delete(owner);
      if (run.owners.size > 0) continue;
      // A waiting run leaves the queue unfetched; the abort rejects its promises.
      this.unqueue(run);
      run.begin = undefined;
      run.controller.abort();
      // An aborted run takes no new owners: a later load of its tiles starts a new run.
      for (const [id, flight] of this.inFlight) if (flight.run === run) this.inFlight.delete(id);
    }
  }

  private startRun(
    run: Run,
    signalId: string,
    level: number,
    first: bigint,
    last: bigint,
  ): Map<bigint, Promise<Tile>> {
    const { signal } = run.controller;
    const generation = this.generation;
    const scope = run.scope;
    // An abort rejects the run's promises at once, even if the fetch never settles.
    const aborted = new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
    );
    // Fetched when `begin` is called: at once for a visible load, later for a waiting prefetch run.
    const fetched = new Promise<SeriesResult>((resolve, reject) => {
      run.begin = () => {
        run.begin = undefined;
        const request = runRequest(signalId, level, first, last);
        const preload = run.preload;
        try {
          this.fetch(
            preload ? { ...request, case: preload.case, preload: true } : request,
            signal,
          ).then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      };
    });
    const answer = Promise.race([fetched, aborted]).then((result) => {
      // A fetch that ignores its abort signal must not fill the cache either.
      if (signal.aborted) throw signal.reason;
      const tiles = new Map<bigint, Tile>();
      for (const tile of splitRun(result, level, first, last)) {
        if (generation === this.generation) this.store(tile, scope);
        tiles.set(tile.index, tile);
      }
      return tiles;
    });
    const done = () => {
      for (let index = first; index <= last; index++) {
        const id = flightKey(signalId, level, index, scope);
        if (this.inFlight.get(id)?.run === run) this.inFlight.delete(id);
      }
      if (run.visible) {
        run.visible = false;
        this.visibleRunning--;
      }
      if (run.counted) {
        run.counted = false;
        this.prefetchRunning--;
        this.pump();
      }
    };
    answer.then(done, done);
    const promises = new Map<bigint, Promise<Tile>>();
    for (let index = first; index <= last; index++) {
      const promise = answer.then((tiles) => {
        const tile = tiles.get(index);
        if (!tile) throw new Error(`run answer lacks tile ${tileId(signalId, level, index)}`);
        return tile;
      });
      // Nobody may await a tile of a run that fails after its owners left.
      promise.catch(() => {});
      promises.set(index, promise);
      this.inFlight.set(flightKey(signalId, level, index, scope), { run, promise });
    }
    return promises;
  }

  /** Takes a waiting run out of its queue. */
  private unqueue(run: Run): void {
    for (const queue of [this.queue, this.preloadQueue]) {
      const waiting = queue.indexOf(run);
      if (waiting >= 0) queue.splice(waiting, 1);
    }
  }

  /**
   * Fetches waiting runs while fewer than PREFETCH_IN_FLIGHT are in flight (Z6): prefetch runs
   * first, preload runs only when none waits (K13).
   */
  private pump(): void {
    while (this.prefetchRunning < PREFETCH_IN_FLIGHT) {
      const run = this.queue.shift() ?? this.preloadQueue.shift();
      if (!run) return;
      run.counted = true;
      this.prefetchRunning++;
      run.begin?.();
    }
  }

  /**
   * Stores a tile unless it is recent (C6), heavier than the limit, or not inside the scope it was
   * fetched under (K12), then evicts the oldest (C5). A raw tile the scope cut (no `before` or
   * `after` point) records that scope's edge.
   */
  private store(tile: Tile, scope: CacheScope | undefined): void {
    if (!this.storable(tile.level, tile.index)) return;
    const span = tileSpan(tile.level);
    const from = tile.index * span;
    const to = from + span;
    if (scope && (from < scope.from || to > scope.to)) return;
    const weight = tileWeight(tile);
    if (weight > this.limit) return;
    const id = tileId(tile.signalId, tile.level, tile.index);
    this.remove(id);
    const stored: Stored = { tile, weight };
    if (scope && tile.data.kind === "raw") {
      if (!tile.data.before) stored.cutFrom = scope.from;
      if (!tile.data.after) stored.cutTo = scope.to;
    }
    this.tiles.set(id, stored);
    this.weight += weight;
    if (tile.data.kind === "raw") {
      const levels = this.rawLevels.get(tile.signalId) ?? new Map<number, number>();
      levels.set(tile.level, (levels.get(tile.level) ?? 0) + 1);
      this.rawLevels.set(tile.signalId, levels);
    }
    for (const oldest of this.tiles.keys()) {
      if (this.weight <= this.limit) break;
      this.remove(oldest);
    }
  }

  private remove(id: string): void {
    const stored = this.tiles.get(id);
    if (!stored) return;
    this.tiles.delete(id);
    this.weight -= stored.weight;
    const { tile } = stored;
    if (tile.data.kind !== "raw") return;
    const levels = this.rawLevels.get(tile.signalId);
    const count = (levels?.get(tile.level) ?? 0) - 1;
    if (count > 0) levels?.set(tile.level, count);
    else levels?.delete(tile.level);
    if (levels?.size === 0) this.rawLevels.delete(tile.signalId);
  }

  /**
   * The stored tile, marked as most recently used, if it answers under `scope` (K12): it lies
   * inside it, and a cut raw tile only where the scope reaches no further than the cut.
   */
  private use(id: string, scope: CacheScope | undefined): Tile | undefined {
    const stored = this.tiles.get(id);
    if (!stored) return undefined;
    const lo = scope?.from ?? TIME_MIN;
    const hi = scope?.to ?? TIME_MAX;
    const span = tileSpan(stored.tile.level);
    const from = stored.tile.index * span;
    if (from < lo || from + span > hi) return undefined;
    if (stored.cutFrom !== undefined && lo < stored.cutFrom) return undefined;
    if (stored.cutTo !== undefined && hi > stored.cutTo) return undefined;
    this.tiles.delete(id);
    this.tiles.set(id, stored);
    return stored.tile;
  }
}

/** In-flight key: tile ID and the scope the run is fetched under (K12). */
const flightKey = (signalId: string, level: number, index: bigint, scope: CacheScope | undefined) =>
  `${tileId(signalId, level, index)}#${scope?.key ?? ""}`;

let tab: SeriesCache | undefined;

/** The tab's cache, created on first use with `fetchSeries` from api.ts. */
export function tabSeriesCache(): SeriesCache {
  tab ??= new SeriesCache(fetchSeries);
  return tab;
}
