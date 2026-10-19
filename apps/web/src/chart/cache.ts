import { assertSeries, type SeriesResult } from "@kipscope/shared";
import { fetchSeries } from "../api.ts";
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
export const PREFETCH_IN_FLIGHT = 2; // prefetch runs fetched at once per tab (Z6)

export type Priority = "visible" | "prefetch";

/** Why the source may be reachable again: an answer through the cache, or the live channel opened (H9). */
export type RecoverReason = "success" | "reconnect";

export type FetchSeries = (request: SeriesRequest, abort: AbortSignal) => Promise<SeriesResult>;

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
  /** Fetched as prefetch: holds one of the PREFETCH_IN_FLIGHT slots until it finishes. */
  counted?: boolean;
}

interface Stored {
  tile: Tile;
  weight: number;
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
  private prefetchRunning = 0;
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
    for (const run of this.queue.splice(0)) {
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
  find(signalId: string, level: number, index: bigint): Tile | undefined {
    return this.findUpTo(signalId, level, index, MERGE_DEPTH);
  }

  private findUpTo(
    signalId: string,
    level: number,
    index: bigint,
    depth: number,
  ): Tile | undefined {
    const own = this.use(tileId(signalId, level, index));
    if (own) return own;
    const levels = this.rawLevels.get(signalId);
    for (const parentLevel of levels?.keys() ?? []) {
      if (parentLevel <= level) continue;
      const parent = this.use(tileId(signalId, parentLevel, index >> BigInt(parentLevel - level)));
      if (parent?.data.kind === "raw") return deriveRaw(parent, level, index);
    }
    if (depth <= 0 || level <= 0) return undefined;
    const left = this.findUpTo(signalId, level - 1, index * 2n, depth - 1);
    if (!left) return undefined;
    const right = this.findUpTo(signalId, level - 1, index * 2n + 1n, depth - 1);
    return right && mergeUp(left, right);
  }

  /** False for a tile that would not be stored (ends after now − FRESH_MARGIN_NS, C6). */
  storable(level: number, index: bigint): boolean {
    const end = (index + 1n) * tileSpan(level);
    return end <= BigInt(Math.floor(this.now())) * 1_000_000n - FRESH_MARGIN_NS;
  }

  /**
   * Promises of the tiles, joining runs in flight and starting runs for the rest. A "prefetch" run
   * waits while PREFETCH_IN_FLIGHT prefetch runs are fetched; a "visible" load never waits and
   * starts a waiting prefetch run it wants at once (Z6).
   */
  load(
    owner: string,
    signalId: string,
    level: number,
    indices: readonly bigint[],
    priority: Priority = "visible",
  ): Promise<Tile>[] {
    const runs = this.owned.get(owner) ?? new Set<Run>();
    this.owned.set(owner, runs);
    const promises = new Map<bigint, Promise<Tile>>();
    const missing: bigint[] = [];
    for (const index of indices) {
      const flight = this.inFlight.get(tileId(signalId, level, index));
      if (flight) {
        flight.run.owners.add(owner);
        runs.add(flight.run);
        promises.set(index, flight.promise);
        if (priority === "visible" && flight.run.begin) {
          this.queue.splice(this.queue.indexOf(flight.run), 1);
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
      const run: Run = { controller: new AbortController(), owners: new Set([owner]) };
      runs.add(run);
      for (const [index, promise] of this.startRun(run, signalId, level, first, last)) {
        promises.set(index, promise);
      }
      if (priority === "visible") run.begin?.();
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
      const waiting = this.queue.indexOf(run);
      if (waiting >= 0) this.queue.splice(waiting, 1);
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
    // An abort rejects the run's promises at once, even if the fetch never settles.
    const aborted = new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
    );
    // Fetched when `begin` is called: at once for a visible load, later for a waiting prefetch run.
    const fetched = new Promise<SeriesResult>((resolve, reject) => {
      run.begin = () => {
        run.begin = undefined;
        try {
          this.fetch(runRequest(signalId, level, first, last), signal).then(resolve, reject);
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
        if (generation === this.generation) this.store(tile);
        tiles.set(tile.index, tile);
      }
      return tiles;
    });
    const done = () => {
      for (let index = first; index <= last; index++) {
        const id = tileId(signalId, level, index);
        if (this.inFlight.get(id)?.run === run) this.inFlight.delete(id);
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
      this.inFlight.set(tileId(signalId, level, index), { run, promise });
    }
    return promises;
  }

  /** Fetches waiting prefetch runs while fewer than PREFETCH_IN_FLIGHT are in flight (Z6). */
  private pump(): void {
    while (this.prefetchRunning < PREFETCH_IN_FLIGHT) {
      const run = this.queue.shift();
      if (!run) return;
      run.counted = true;
      this.prefetchRunning++;
      run.begin?.();
    }
  }

  /** Stores a tile unless it is recent (C6) or heavier than the limit, then evicts the oldest (C5). */
  private store(tile: Tile): void {
    if (!this.storable(tile.level, tile.index)) return;
    const weight = tileWeight(tile);
    if (weight > this.limit) return;
    const id = tileId(tile.signalId, tile.level, tile.index);
    this.remove(id);
    this.tiles.set(id, { tile, weight });
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

  /** The stored tile, marked as most recently used. */
  private use(id: string): Tile | undefined {
    const stored = this.tiles.get(id);
    if (!stored) return undefined;
    this.tiles.delete(id);
    this.tiles.set(id, stored);
    return stored.tile;
  }
}

let tab: SeriesCache | undefined;

/** The tab's cache, created on first use with `fetchSeries` from api.ts. */
export function tabSeriesCache(): SeriesCache {
  tab ??= new SeriesCache(fetchSeries);
  return tab;
}
