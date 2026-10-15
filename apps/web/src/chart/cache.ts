import type { SeriesResult } from "@letsview/shared";
import { fetchSeries } from "../api.ts";
import {
  deriveRaw,
  FRESH_MARGIN_NS,
  MAX_RUN_TILES,
  runRequest,
  type SeriesRequest,
  splitRun,
  type Tile,
  tileId,
  tileSpan,
  tileWeight,
} from "./tiles.ts";

export const CACHE_LIMIT = 4_000_000; // weight units (C5)

export type FetchSeries = (request: SeriesRequest, abort: AbortSignal) => Promise<SeriesResult>;

export interface CacheOptions {
  limit?: number; // default CACHE_LIMIT
  now?: () => number; // ms since epoch, default Date.now (C6)
}

/** One request in flight for adjacent tiles of one signal and level, and who wants it. */
interface Run {
  controller: AbortController;
  owners: Set<string>;
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
  private weight = 0;

  constructor(fetch: FetchSeries, options: CacheOptions = {}) {
    this.fetch = fetch;
    this.limit = options.limit ?? CACHE_LIMIT;
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.weight;
  }

  peek(signalId: string, level: number, index: bigint): Tile | undefined {
    return this.tiles.get(tileId(signalId, level, index))?.tile;
  }

  find(signalId: string, level: number, index: bigint): Tile | undefined {
    const own = this.use(tileId(signalId, level, index));
    if (own) return own;
    const levels = this.rawLevels.get(signalId);
    if (!levels) return undefined;
    for (const parentLevel of levels.keys()) {
      if (parentLevel <= level) continue;
      const parent = this.use(tileId(signalId, parentLevel, index >> BigInt(parentLevel - level)));
      if (parent?.data.kind === "raw") return deriveRaw(parent, level, index);
    }
    return undefined;
  }

  load(
    owner: string,
    signalId: string,
    level: number,
    indices: readonly bigint[],
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
    }
    return indices.map((index) => promises.get(index) as Promise<Tile>);
  }

  release(owner: string): void {
    const runs = this.owned.get(owner);
    if (!runs) return;
    this.owned.delete(owner);
    for (const run of runs) {
      run.owners.delete(owner);
      if (run.owners.size > 0) continue;
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
    // An abort rejects the run's promises at once, even if the fetch never settles.
    const aborted = new Promise<never>((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
    );
    const fetched = this.fetch(runRequest(signalId, level, first, last), signal);
    const answer = Promise.race([fetched, aborted]).then((result) => {
      // A fetch that ignores its abort signal must not fill the cache either.
      if (signal.aborted) throw signal.reason;
      const tiles = new Map<bigint, Tile>();
      for (const tile of splitRun(result, level, first, last)) {
        this.store(tile);
        tiles.set(tile.index, tile);
      }
      return tiles;
    });
    const done = () => {
      for (let index = first; index <= last; index++) {
        const id = tileId(signalId, level, index);
        if (this.inFlight.get(id)?.run === run) this.inFlight.delete(id);
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

  /** Stores a tile unless it is recent (C6) or heavier than the limit, then evicts the oldest (C5). */
  private store(tile: Tile): void {
    const end = (tile.index + 1n) * tileSpan(tile.level);
    const freshFrom = BigInt(Math.floor(this.now())) * 1_000_000n - FRESH_MARGIN_NS;
    if (end > freshFrom) return;
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
