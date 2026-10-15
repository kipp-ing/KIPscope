import type { SeriesResult } from "@letsview/shared";
import type { SeriesCache } from "./cache.ts";
import {
  levelFor,
  type SeriesRequest,
  stitch,
  type Tile,
  tileable,
  touchedTiles,
} from "./tiles.ts";

export interface LoadRequest extends SeriesRequest {
  /** Assignment ID: one signal's place in a window. */
  key: string;
}

export interface LoadState {
  status: "loading" | "complete" | "error";
  /** Identity of the request this state belongs to. */
  request: string;
  /** While loading, the previous result stays here so the window keeps showing it. */
  result?: SeriesResult;
  error?: string;
}

const requestId = (r: LoadRequest) => `${r.signalId}|${r.from}|${r.to}|${r.target}`;

let loaders = 0;

/**
 * Loads series per signal of one window from the tab's tile cache (design C7). A view whose tiles
 * are all cached completes at once; otherwise its missing tiles are loaded and the previous result
 * stays meanwhile. A response is applied only if it belongs to the latest request for its signal,
 * so an out-of-order answer can never replace newer data.
 */
export class SeriesLoader {
  private readonly cache: SeriesCache;
  private readonly onChange: () => void;
  private readonly id = ++loaders;
  private readonly states = new Map<string, LoadState>();
  /** Per key: the cache owner of its current view's tiles. */
  private readonly owners = new Map<string, string>();
  /** Per key: the exact request of a view that cannot be tiled (C1 fallback). */
  private readonly controllers = new Map<string, AbortController>();
  private readonly latest = new Map<string, number>();
  private seq = 0;

  constructor(cache: SeriesCache, onChange: () => void) {
    this.cache = cache;
    this.onChange = onChange;
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
        this.forget(key);
        this.states.delete(key);
        this.latest.delete(key);
        changed = true;
      }
    }
    for (const request of requests) {
      if (this.states.get(request.key)?.request === requestId(request)) continue;
      this.start(request);
      changed = true;
    }
    if (changed) this.onChange();
  }

  /**
   * Releases every tile and aborts every request and forgets every state, so a later update starts
   * all of them again (React's StrictMode disposes and remounts once; a kept "loading" state would
   * never fill).
   */
  dispose(): void {
    for (const key of [...this.owners.keys(), ...this.controllers.keys()]) this.forget(key);
    this.states.clear();
    this.latest.clear();
  }

  /** Lets go of the key's tiles and aborts its exact request. */
  private forget(key: string): void {
    const owner = this.owners.get(key);
    if (owner !== undefined) this.cache.release(owner);
    this.owners.delete(key);
    this.controllers.get(key)?.abort();
    this.controllers.delete(key);
  }

  private start(request: LoadRequest): void {
    const { key, signalId } = request;
    const seq = ++this.seq;
    this.latest.set(key, seq);
    const id = requestId(request);
    const from = BigInt(request.from);
    const to = BigInt(request.to);
    const level = levelFor(from, to, request.target);
    const { first, last } = touchedTiles(from, to, level);
    if (!tileable(level, first, last)) {
      this.forget(key);
      this.fetchExact(request, seq);
      return;
    }
    this.controllers.get(key)?.abort();
    this.controllers.delete(key);

    const tiles: (Tile | undefined)[] = [];
    const missing: bigint[] = [];
    for (let index = first; index <= last; index++) {
      const tile = this.cache.find(signalId, level, index);
      tiles.push(tile);
      if (!tile) missing.push(index);
    }
    const previousOwner = this.owners.get(key);
    if (missing.length === 0) {
      this.owners.delete(key);
      if (previousOwner !== undefined) this.cache.release(previousOwner);
      const result = stitch(tiles as Tile[], from, to);
      this.states.set(key, { status: "complete", request: id, result });
      return;
    }

    const previous = this.states.get(key)?.result;
    this.states.set(key, {
      status: "loading",
      request: id,
      ...(previous ? { result: previous } : {}),
    });
    const owner = `${this.id}|${key}|${seq}`;
    const loads = this.cache.load(owner, signalId, level, missing);
    this.owners.set(key, owner);
    // Only now, so tiles the old and the new view share keep their run alive.
    if (previousOwner !== undefined) this.cache.release(previousOwner);

    const isCurrent = () => this.latest.get(key) === seq;
    Promise.all(loads).then(
      (loaded) => {
        if (!isCurrent()) return;
        let next = 0;
        const all = tiles.map((tile) => tile ?? (loaded[next++] as Tile));
        this.states.set(key, { status: "complete", request: id, result: stitch(all, from, to) });
        this.onChange();
      },
      (error: unknown) => {
        if (!isCurrent()) return;
        const message = error instanceof Error ? error.message : String(error);
        this.states.set(key, { status: "error", request: id, error: message });
        this.onChange();
      },
    );
  }

  /** A view outside the tile grid: fetched exactly as requested and not cached. */
  private fetchExact(request: LoadRequest, seq: number): void {
    const { key, signalId, from, to, target } = request;
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const previous = this.states.get(key)?.result;
    const id = requestId(request);
    this.states.set(key, {
      status: "loading",
      request: id,
      ...(previous ? { result: previous } : {}),
    });

    const isCurrent = () => this.latest.get(key) === seq;
    this.cache.fetch({ signalId, from, to, target }, controller.signal).then(
      (result) => {
        if (!isCurrent()) return;
        this.states.set(key, { status: "complete", request: id, result });
        this.onChange();
      },
      (error: unknown) => {
        if (!isCurrent() || controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        this.states.set(key, { status: "error", request: id, error: message });
        this.onChange();
      },
    );
  }
}
