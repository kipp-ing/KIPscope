import type { CursorValueResult, GapInfo, ServerMeta } from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as api from "../src/api.ts";
import { ApiRequestError } from "../src/api.ts";
import { SeriesCache, tabSeriesCache } from "../src/chart/cache.ts";
import { GapInfoStore, gapInfoStore } from "../src/chart/gaps.ts";
import {
  LOAD_INTERVAL_MS,
  type LoadRequest,
  loadStatusText,
  SeriesLoader,
} from "../src/chart/loader.ts";
import * as overview from "../src/chart/overview.ts";
import { enterScope, resetScopeForTest, scopeChangeWatcher } from "../src/chart/rescope.ts";
import { metaLoader } from "../src/footer/useMeta.ts";
import { ValueLoader } from "../src/values/loader.ts";
import { type FakePoint, fakeAnswer, fakeFetch, flush } from "./fakeSeries.ts";

// Round-3 web logic of add-scope Z12: what the web does when the workspace's scope changes.

const SIG = "c/s";
const S10 = 262144n; // tile span of level 10 (width 1024 ns)
const NOW = () => 1_000_000_000_000_000; // ms: every tile of these tests lies long before it

/** Ten raw points in level-10 tile `j` (t = j × S10 + 1000 × i + 500) with value `base + i`. */
const tilePoints = (j: bigint, base: number): FakePoint[] =>
  Array.from({ length: 10 }, (_, i) => ({ t: j * S10 + 1000n * BigInt(i) + 500n, v: base + i }));

/** One tile-aligned view; at target 257 its request is exactly one level-10 tile. */
const view = (j: bigint, key = "a1", signalId = SIG): LoadRequest => ({
  key,
  signalId,
  from: (j * S10).toString(),
  to: ((j + 1n) * S10).toString(),
  target: 257,
});

const values = (loader: SeriesLoader, key = "a1"): number[] => {
  const result = loader.get(key)?.result;
  if (result?.kind !== "raw") throw new Error("expected a raw result");
  return result.v as number[];
};

describe("enterScope", () => {
  beforeEach(() => resetScopeForTest());

  it("does nothing on the first call and on the same key", () => {
    const clear = vi.spyOn(tabSeriesCache(), "clear");
    const forget = vi.spyOn(overview, "forgetExtents");
    const reload = vi.spyOn(gapInfoStore, "reload").mockImplementation(() => {});
    try {
      expect(enterScope("smart451|1|2")).toBe(false);
      expect(enterScope("smart451|1|2")).toBe(false);
      expect(clear).not.toHaveBeenCalled();
      expect(forget).not.toHaveBeenCalled();
      expect(reload).not.toHaveBeenCalled();
    } finally {
      clear.mockRestore();
      forget.mockRestore();
      reload.mockRestore();
    }
  });

  it("keeps the tiles when the key changes and reloads nothing", () => {
    const clear = vi.spyOn(tabSeriesCache(), "clear");
    const forget = vi.spyOn(overview, "forgetExtents");
    const reload = vi.spyOn(gapInfoStore, "reload").mockImplementation(() => {});
    try {
      enterScope("smart451|1|2");
      expect(enterScope("smart451|1|3")).toBe(true);
      // The tiles stay (add-case-open K12): a scope change clears nothing.
      expect(clear).not.toHaveBeenCalled();
      expect(forget).not.toHaveBeenCalled();
      // Every window of the commit calls it: the others find the key entered already.
      expect(enterScope("smart451|1|3")).toBe(false);
      // Clearing the scope is a change as well.
      expect(enterScope("")).toBe(true);
      expect(clear).not.toHaveBeenCalled();
    } finally {
      clear.mockRestore();
      forget.mockRestore();
      reload.mockRestore();
    }
  });
});

describe("per-scope stores (add-case-open K12)", () => {
  beforeEach(() => {
    resetScopeForTest();
    overview.forgetExtents();
  });
  afterEach(() => vi.restoreAllMocks());

  const info = (dataRef: string): GapInfo => ({ dataRef, through: "20", logger: [], periods: {} });

  it("keeps extents and gap info for four scopes", async () => {
    const extents = vi
      .spyOn(api, "fetchExtent")
      .mockImplementation(async () => ({ first: "1", last: "2" }) as never);
    const gaps = vi.spyOn(api, "fetchGaps").mockImplementation(async (ref) => info(ref));
    const signal = "car/Cyc_A.CYC";
    const key = (n: string) => `car|${n.charCodeAt(0)}|1000`;

    /** What the windows do in a scope: enter it, ask the signal's extent and gap info, let go. */
    async function visit(k: string) {
      enterScope(k);
      await overview.signalExtent(signal);
      const release = gapInfoStore.ask([signal], () => {}, k);
      await flush();
      release();
    }
    const asked = () => [extents.mock.calls.length, gaps.mock.calls.length];

    for (const n of ["A", "B", "C", "D"]) await visit(key(n));
    expect(asked()).toEqual([4, 4]);

    // Back to A: kept, nothing asked.
    await visit(key("A"));
    expect(asked()).toEqual([4, 4]);

    // E is the fifth scope: B, the least recently used, is dropped.
    await visit(key("E"));
    expect(asked()).toEqual([5, 5]);
    await visit(key("C"));
    await visit(key("D"));
    await visit(key("A"));
    expect(asked()).toEqual([5, 5]);

    // B asks again.
    await visit(key("B"));
    expect(asked()).toEqual([6, 6]);
  });

  it("keeps gap info of an object scope per work window", async () => {
    const gaps = vi.fn(async (ref: string, _signals?: readonly string[], _window?: unknown) =>
      info(ref),
    );
    const store = new GapInfoStore(gaps);
    const signal = "car/Cyc_A.CYC";
    const key = "car|1|9|object";
    const day = (n: number) => ({ from: `${n}000`, to: `${n}999` });
    const ask = async (window: { from: string; to: string }) => {
      const release = store.ask([signal], () => {}, key, window);
      await Promise.resolve();
      await Promise.resolve();
      release();
    };
    store.enter(key);
    await ask(day(1));
    await ask(day(2));
    await ask(day(1)); // kept
    expect(gaps).toHaveBeenCalledTimes(2);
    expect(gaps.mock.calls.map((c) => c[2])).toEqual([day(1), day(2)]);
    expect(store.state([signal], key, day(1)).infos.get("car")).toBeDefined();
    expect(store.state([signal], key, day(3)).infos.size).toBe(0);
  });
});

describe("scopeChangeWatcher", () => {
  it("rescopes only on a changed key, not on mount", () => {
    const changed = scopeChangeWatcher("a");
    expect(changed("a")).toBe(false); // the mount's own effect
    expect(changed("a")).toBe(false);
    expect(changed("b")).toBe(true);
    expect(changed("b")).toBe(false); // remembered
    expect(changed("a")).toBe(true); // back again is a change too
  });
});

describe("SeriesCache.clear", () => {
  it("lets a run in flight answer its owners but store no tile", async () => {
    const points = tilePoints(1n, 100);
    const { fetch, calls } = fakeFetch(points);
    const cache = new SeriesCache(fetch, { now: NOW });
    const [old] = cache.load("o", SIG, 10, [1n]);
    expect(calls).toHaveLength(1);
    cache.clear(); // the scope changed while the run is in flight
    calls[0]?.answer();
    expect(await old).toMatchObject({ level: 10, index: 1n }); // the owner still gets its answer
    expect(cache.peek(SIG, 10, 1n)).toBeUndefined(); // but the old scope's tile is not stored
    expect(cache.size).toBe(0);
    // A later load fetches again and stores.
    const [again] = cache.load("o", SIG, 10, [1n]);
    expect(calls).toHaveLength(2);
    calls[1]?.answer();
    await again;
    expect(cache.peek(SIG, 10, 1n)).toBeDefined();
  });

  it("forgets stored tiles", async () => {
    const { fetch, calls } = fakeFetch(tilePoints(1n, 100));
    const cache = new SeriesCache(fetch, { now: NOW });
    const [tile] = cache.load("o", SIG, 10, [1n]);
    calls[0]?.answer();
    await tile;
    expect(cache.find(SIG, 10, 1n)).toBeDefined();
    cache.clear();
    expect(cache.find(SIG, 10, 1n)).toBeUndefined();
    cache.load("o", SIG, 10, [1n]);
    expect(calls).toHaveLength(2);
  });

  // F3: no stale query of the old scope starts after a scope change.
  it("never fetches the queued prefetch runs after a clear (F3)", async () => {
    const { fetch, calls } = fakeFetch(tilePoints(0n, 0));
    const cache = new SeriesCache(fetch, { now: NOW });
    const settle = (p: Promise<unknown>) =>
      p.then(
        () => "ok",
        () => "rejected",
      );
    // Two prefetch runs fetch, two wait for a slot.
    const loads = [0n, 2n, 4n, 6n].map((i) =>
      settle(Promise.all(cache.load("p", SIG, 10, [i], "prefetch"))),
    );
    expect(calls).toHaveLength(2);
    expect(cache.queuedPrefetch).toBe(2);

    cache.clear();
    expect(cache.queuedPrefetch).toBe(0);
    expect(await Promise.all(loads.slice(2))).toEqual(["rejected", "rejected"]);

    // The runs in flight finish; their slots free up but nothing waiting starts.
    calls[0]?.answer();
    calls[1]?.answer();
    await flush();
    await flush();
    expect(calls).toHaveLength(2);
    expect(cache.queuedPrefetch).toBe(0);
    // The runs in flight did not store their tiles.
    expect(cache.peek(SIG, 10, 0n)).toBeUndefined();
    expect(cache.peek(SIG, 10, 2n)).toBeUndefined();

    // A later prefetch gets a free slot at once and a visible load fetches too.
    cache.load("p", SIG, 10, [8n], "prefetch").map((p) => p.catch(() => {}));
    const [visible] = cache.load("v", SIG, 10, [10n]);
    expect(calls).toHaveLength(4);
    calls[3]?.answer();
    await visible;
  });
});

describe("gap info after a scope change", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const A = "cara/Cyc_A.CYC";
  const B = "carb/Cyc_B.CYC";
  const info = (dataRef: string, to: string): GapInfo => ({
    dataRef,
    through: to,
    logger: [{ from: "10", to }],
    periods: {},
  });

  it("fetches every asked data ref again on reload and forgets the unasked", async () => {
    const fetchInfo = vi
      .fn<(dataRef: string, signals: readonly string[]) => Promise<GapInfo>>()
      .mockImplementation((dataRef) => Promise.resolve(info(dataRef, "20")));
    const store = new GapInfoStore(fetchInfo);
    const releaseA = store.ask([A], () => {});
    const releaseB = store.ask([B], () => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchInfo.mock.calls.map((c) => c[0])).toEqual(["cara", "carb"]);

    releaseB(); // nobody asks for carb any more
    store.reload();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchInfo.mock.calls.map((c) => c[0])).toEqual(["cara", "carb", "cara"]);
    expect(store.state([A]).infos.get("cara")).toBeDefined();
    // The forgotten data ref starts from scratch when asked again.
    expect(store.state([B]).infos.size).toBe(0);
    expect(store.state([B]).settled).toBe(false);
    releaseA();
  });

  it("drops an answer of the scope before the reload and fetches again", async () => {
    const answers: ((i: GapInfo) => void)[] = [];
    const fetchInfo = vi
      .fn<(dataRef: string, signals: readonly string[]) => Promise<GapInfo>>()
      .mockImplementation(() => new Promise((resolve) => answers.push(resolve)));
    const store = new GapInfoStore(fetchInfo);
    const listener = vi.fn();
    const release = store.ask([A], listener);
    expect(fetchInfo).toHaveBeenCalledTimes(1);

    store.reload(); // the scope changed while the first fetch is in flight
    expect(fetchInfo).toHaveBeenCalledTimes(1); // it waits for the one in flight
    answers[0]?.(info("cara", "20")); // the old scope's answer
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchInfo).toHaveBeenCalledTimes(2); // dropped, fetched again
    expect(store.state([A]).infos.size).toBe(0);
    expect(store.state([A]).settled).toBe(false);

    answers[1]?.(info("cara", "30"));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state([A]).infos.get("cara")?.through).toBe("30");
    expect(store.state([A]).settled).toBe(true);
    expect(fetchInfo).toHaveBeenCalledTimes(2);
    release();
  });

  it("drops a failure of the scope before the reload as well", async () => {
    const pending: { resolve: (i: GapInfo) => void; reject: (e: Error) => void }[] = [];
    const fetchInfo = vi
      .fn<(dataRef: string, signals: readonly string[]) => Promise<GapInfo>>()
      .mockImplementation(
        () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
      );
    const store = new GapInfoStore(fetchInfo);
    const release = store.ask([A], () => {});
    store.reload();
    pending[0]?.reject(new Error("old scope timed out"));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchInfo).toHaveBeenCalledTimes(2);
    expect(store.state([A]).errors).toEqual([]); // no error from the old scope's fetch
    pending[1]?.resolve(info("cara", "30"));
    await vi.advanceTimersByTimeAsync(0);
    expect(store.state([A]).settled).toBe(true);
    release();
  });
});

describe("SeriesLoader.rescope", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
  const down = () => new ApiRequestError(502, "source_error", "down");

  /** What the web does on a scope change: `enterScope` clears the tab's cache, then the window rescopes. */
  function setup(points: FakePoint[], retry = true) {
    const server = fakeFetch(points);
    const cache = new SeriesCache(server.fetch, { now: NOW });
    const loader = new SeriesLoader(cache, () => {}, { loadIntervalMs: LOAD_INTERVAL_MS, retry });
    // The reload starts at the next throttle interval (Z1) at the latest.
    const scopeChanges = async () => {
      cache.clear();
      loader.rescope();
      await vi.advanceTimersByTimeAsync(LOAD_INTERVAL_MS);
    };
    return { ...server, cache, loader, scopeChanges };
  }

  it("loads a failed key again at once, keeps what it shows and starts its failures over", async () => {
    const t = setup([...tilePoints(0n, 0), ...tilePoints(1n, 100)]);
    t.loader.update([view(0n)]);
    t.calls[0]?.answer();
    await tick();
    expect(values(t.loader)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    // The next view fails twice (retry delays 1 s, then 2 s) and shows the first view meanwhile.
    t.loader.update([view(1n)]);
    await tick(LOAD_INTERVAL_MS); // the throttle interval of the first load
    expect(t.calls).toHaveLength(2);
    t.calls[1]?.fail(down());
    await tick();
    await tick(1000);
    expect(t.calls).toHaveLength(3);
    t.calls[2]?.fail(down());
    await tick();
    expect(t.loader.get("a1")).toMatchObject({ status: "error", error: "source_error: down" });

    await t.scopeChanges(); // the retry would only run in 2 s
    expect(t.calls).toHaveLength(4);
    expect(t.loader.get("a1")).toMatchObject({
      status: "loading",
      error: "source_error: down", // kept while it loads again
      result: { from: "0" }, // the earlier view stays
    });

    // Failures start over: the next retry comes after 1 s, not 4 s.
    t.calls[3]?.fail(down());
    await tick();
    await tick(999);
    expect(t.calls).toHaveLength(4);
    await tick(1);
    expect(t.calls).toHaveLength(5);
    t.calls[4]?.answer();
    await tick();
    expect(t.loader.get("a1")).toMatchObject({
      status: "complete",
      result: { from: S10.toString() },
    });
    expect(t.loader.get("a1")?.error).toBeUndefined();
    t.loader.dispose();
  });

  it("loads a still loading key again and ignores the old fetch's late answer", async () => {
    const points = tilePoints(0n, 0); // the old scope's data
    const t = setup(points);
    t.loader.update([view(0n)]);
    expect(t.calls).toHaveLength(1);
    await t.scopeChanges();
    expect(t.calls).toHaveLength(2);
    expect(t.calls[0]?.abort.aborted).toBe(true);
    expect(t.loader.get("a1")?.status).toBe("loading");

    points.splice(0, points.length, ...tilePoints(0n, 50)); // the new scope's data
    t.calls[1]?.answer();
    await tick();
    expect(values(t.loader)).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
    t.calls[0]?.answer(fakeAnswer(tilePoints(0n, 0), view(0n))); // a late answer of the old fetch
    await tick();
    expect(values(t.loader)).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
    expect(t.loader.get("a1")?.status).toBe("complete");
    t.loader.dispose();
  });

  // F1: a complete key's tiles and edge neighbours were bounded by the old scope.
  it("loads a complete key's request again, the late old answer does not overwrite (F1)", async () => {
    const points = tilePoints(0n, 0);
    const t = setup(points);
    t.loader.update([view(0n)]);
    t.calls[0]?.answer();
    await tick();
    expect(t.loader.get("a1")?.status).toBe("complete");
    expect(values(t.loader)[0]).toBe(0);

    points.splice(0, points.length, ...tilePoints(0n, 50)); // Widen: the data looks different now
    await t.scopeChanges();
    expect(t.calls).toHaveLength(2); // asked again although it was complete
    expect(t.loader.get("a1")).toMatchObject({ status: "loading", result: { from: "0" } });
    expect(values(t.loader)[0]).toBe(0); // the old result is shown meanwhile
    expect(t.loader.settled([view(0n)])).toBe(false);

    t.calls[1]?.answer();
    await tick();
    expect(t.loader.get("a1")?.status).toBe("complete");
    expect(values(t.loader)).toEqual([50, 51, 52, 53, 54, 55, 56, 57, 58, 59]);
    expect(t.loader.settled([view(0n)])).toBe(true);
    // Nothing else is asked.
    await tick(60_000);
    expect(t.calls).toHaveLength(2);
    t.loader.dispose();
  });

  it("windows recover after Widen, Clear or open", async () => {
    // Two keys: one failed (the server was down), one complete. A scope change loads both again.
    const t = setup([...tilePoints(0n, 0), ...tilePoints(1n, 100)]);
    t.loader.update([view(0n, "a1"), view(1n, "a2")]);
    t.calls[0]?.fail(down());
    t.calls[1]?.answer();
    await tick();
    expect(t.loader.get("a1")?.status).toBe("error");
    expect(t.loader.get("a2")?.status).toBe("complete");

    await t.scopeChanges();
    expect(t.calls).toHaveLength(4);
    t.calls[2]?.answer();
    t.calls[3]?.answer();
    await tick();
    expect(t.loader.get("a1")).toMatchObject({ status: "complete", result: { from: "0" } });
    expect(t.loader.get("a1")?.error).toBeUndefined();
    expect(t.loader.get("a2")).toMatchObject({ status: "complete" });
    expect(t.loader.settled([view(0n, "a1"), view(1n, "a2")])).toBe(true);
    t.loader.dispose();
  });

  it("shows out_of_scope in the window's error line and does not retry it", async () => {
    const t = setup(tilePoints(0n, 0));
    t.loader.update([view(0n)]);
    t.calls[0]?.fail(
      new ApiRequestError(409, "out_of_scope", "series c/s is outside the scope smart451"),
    );
    await tick();
    const state = t.loader.get("a1");
    expect(state?.status).toBe("error");
    expect(state?.error).toBe("out_of_scope: series c/s is outside the scope smart451");
    expect(loadStatusText(state)).toBe(
      "failed: out_of_scope: series c/s is outside the scope smart451",
    );
    await tick(120_000);
    expect(t.calls).toHaveLength(1); // a client error is not retried
    t.loader.dispose();
  });
});

describe("ValueLoader.rescope", () => {
  const row = (t: string, key = "a1:a") => ({
    key,
    signalId: "c/SPEED_DISP",
    t,
    mode: "line" as const,
  });
  const result = (value: number): CursorValueResult => ({
    signalId: "c/SPEED_DISP",
    t: "100",
    mode: "line",
    value: { kind: "raw", value },
  });
  function controllable() {
    const pending: {
      abort: AbortSignal;
      resolve: (r: CursorValueResult) => void;
      reject: (e: unknown) => void;
    }[] = [];
    const fetch = (_request: unknown, abort: AbortSignal) =>
      new Promise<CursorValueResult>((resolve, reject) => pending.push({ abort, resolve, reject }));
    return { fetch, pending };
  }

  it("starts every request again and keeps the rows' results meanwhile", async () => {
    const { fetch, pending } = controllable();
    const loader = new ValueLoader(fetch, () => {});
    loader.update([row("100", "a1:a"), row("100", "a1:b")]);
    pending[0]?.resolve(result(1));
    pending[1]?.reject(new Error("source_error: down"));
    await flush();
    expect(loader.get("a1:a")?.status).toBe("complete");
    expect(loader.get("a1:b")?.status).toBe("error");

    loader.rescope();
    expect(pending).toHaveLength(4);
    expect(loader.get("a1:a")).toMatchObject({
      status: "loading",
      result: { value: { value: 1 } },
    });
    expect(loader.get("a1:b")?.status).toBe("loading"); // the failed row asks again too
    pending[2]?.resolve(result(7));
    pending[3]?.resolve(result(8));
    await flush();
    expect(loader.get("a1:a")).toMatchObject({
      status: "complete",
      result: { value: { value: 7 } },
    });
    expect(loader.get("a1:b")).toMatchObject({
      status: "complete",
      result: { value: { value: 8 } },
    });
  });

  it("drops the old request's late answer", async () => {
    const { fetch, pending } = controllable();
    const loader = new ValueLoader(fetch, () => {});
    loader.update([row("100")]);
    loader.rescope();
    expect(pending).toHaveLength(2);
    expect(pending[0]?.abort.aborted).toBe(true);
    pending[1]?.resolve(result(7));
    await flush();
    pending[0]?.resolve(result(1)); // late answer of the old scope
    await flush();
    expect(loader.get("a1:a")).toMatchObject({
      status: "complete",
      result: { value: { value: 7 } },
    });
  });

  it("does nothing without requests", () => {
    const { fetch, pending } = controllable();
    const changes = vi.fn();
    const loader = new ValueLoader(fetch, changes);
    loader.rescope();
    expect(pending).toHaveLength(0);
    expect(changes).not.toHaveBeenCalled();
  });
});

describe("useMeta on a scope change", () => {
  const metaOf = (size: number, mode: "full" | "scoped" = "scoped"): ServerMeta => ({
    build: { commit: "7c1e2a9", dirty: false, startedAt: "2026-10-16T13:07:10.000Z" },
    source: {
      kind: "clickhouse",
      database: "sdlog",
      table: "signals",
      reachable: true,
      checkedAt: "2026-10-16T13:08:01.000Z",
    },
    catalog: { mode, state: "loaded", size, loadedAt: "2026-10-16T13:07:12.000Z" },
  });

  it("footer count follows the scope", async () => {
    // The hook's load runs on mount and whenever its watcher sees a changed scope key.
    const fetched: ((m: ServerMeta) => void)[] = [];
    const fetch = vi.fn(() => new Promise<ServerMeta>((resolve) => fetched.push(resolve)));
    let state: { meta?: ServerMeta; stale: boolean } = { stale: false };
    const abort = new AbortController();
    const load = metaLoader(
      fetch,
      (update) => {
        state = update(state);
      },
      abort.signal,
    );
    const changed = scopeChangeWatcher("smart451|1|2");

    load(); // mount
    fetched[0]?.(metaOf(2300));
    await flush();
    expect(state.meta?.catalog.size).toBe(2300);

    // Re-render with the same key: no fetch. A Widen: the key changes, the meta is fetched again.
    if (changed("smart451|1|2")) load();
    expect(fetch).toHaveBeenCalledTimes(1);
    if (changed("smart451|0|3")) load();
    expect(fetch).toHaveBeenCalledTimes(2);
    fetched[1]?.(metaOf(9100));
    await flush();
    expect(state.meta?.catalog.size).toBe(9100);

    // Clear: full mode, the whole list.
    if (changed("")) load();
    expect(fetch).toHaveBeenCalledTimes(3);
    fetched[2]?.(metaOf(120_000, "full"));
    await flush();
    expect(state.meta?.catalog).toMatchObject({ mode: "full", size: 120_000 });
  });

  it("applies only the latest answer after quick scope changes", async () => {
    const fetched: ((m: ServerMeta) => void)[] = [];
    const fetch = vi.fn(() => new Promise<ServerMeta>((resolve) => fetched.push(resolve)));
    let state: { meta?: ServerMeta; stale: boolean } = { stale: false };
    const load = metaLoader(
      fetch,
      (update) => {
        state = update(state);
      },
      new AbortController().signal,
    );
    load(); // mount
    load(); // scope A -> B
    load(); // scope B -> C
    fetched[2]?.(metaOf(30));
    await flush();
    fetched[0]?.(metaOf(10)); // late answers of older scopes
    fetched[1]?.(metaOf(20));
    await flush();
    expect(state.meta?.catalog.size).toBe(30);
  });

  it("does not refetch on mount", () => {
    const changed = scopeChangeWatcher("smart451|1|2");
    expect(changed("smart451|1|2")).toBe(false);
  });
});
