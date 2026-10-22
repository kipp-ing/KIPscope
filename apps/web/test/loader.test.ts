import {
  decodeTimes,
  type Extent,
  encodeTimes,
  type RawSeries,
  type SeriesResult,
  TIME_MAX,
} from "@kipscope/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../src/api.ts";
import { SeriesCache } from "../src/chart/cache.ts";
import {
  isMissing,
  LOAD_INTERVAL_MS,
  type LoaderOptions,
  type LoadRequest,
  loadKey,
  loadStatusText,
  SeriesLoader,
} from "../src/chart/loader.ts";
import { levelFor, splitRun, tileable, touchedTiles } from "../src/chart/tiles.ts";
import { apiError } from "./apiError.ts";
import {
  DENSE_FIXTURE,
  densePoints,
  expectSameSeries,
  type FakeCall,
  type FakePoint,
  type Fixture,
  fakeAnswer,
  fakeFetch,
  flush,
  SHIFTED_FIXTURE,
  SPARSE_FIXTURE,
  STEP_FIXTURE,
} from "./fakeSeries.ts";

const SIG = "c/s";
const S10 = 262144n; // tile span of level 10 (width 1024 ns)

/**
 * A tile-aligned view of one level-10 tile: [j × S10, (j + 1) × S10) at target 257 has bucket
 * width exactly 1024 ns. The fake signal holds ten raw points per tile: t = j × S10 + 1000 × i + 500,
 * value 100 × j + i.
 */
const POINTS: FakePoint[] = [0n, 1n].flatMap((j) =>
  Array.from({ length: 10 }, (_, i) => ({
    t: j * S10 + 1000n * BigInt(i) + 500n,
    v: Number(100n * j) + i,
  })),
);

const view = (j: bigint, key = "a1", signalId = SIG): LoadRequest => ({
  key,
  signalId,
  from: (j * S10).toString(),
  to: ((j + 1n) * S10).toString(),
  target: 257,
});

const NOW = () => 1_000_000_000_000_000;

function setup(options: { limit?: number } = {}) {
  const server = fakeFetch(POINTS);
  const cache = new SeriesCache(server.fetch, { now: NOW, ...options });
  return { ...server, cache };
}

const raw = (r: SeriesResult | undefined): RawSeries => {
  if (r?.kind !== "raw") throw new Error("expected raw");
  return r;
};

describe("SeriesLoader", () => {
  it("ignores a response that arrives after a newer request's response", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    loader.update([view(1n)]);
    expect(calls[0]?.abort.aborted).toBe(true);
    calls[1]?.answer();
    await flush();
    calls[0]?.answer(); // late answer for the old zoom
    await flush();
    const state = loader.get("a1");
    expect(state).toMatchObject({ status: "complete", result: { from: S10.toString() } });
    expect(raw(state?.result).v).toEqual([100, 101, 102, 103, 104, 105, 106, 107, 108, 109]);
  });

  it("keeps showing the previous data while the next range loads", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    calls[0]?.answer();
    await flush();
    loader.update([view(1n)]);
    expect(loader.get("a1")).toMatchObject({ status: "loading", result: { from: "0" } });
  });

  it("marks a failed signal and leaves the others alone", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    const requests = [view(0n, "a1"), view(1n, "a2")];
    loader.update(requests);
    calls[0]?.fail(new Error("source_error: timeout"));
    calls[1]?.answer();
    await flush();
    expect(loader.get("a1")).toEqual({
      status: "error",
      request: `c/s|0|${S10}|257`,
      error: "source_error: timeout",
    });
    expect(loader.get("a2")?.status).toBe("complete");
    expect(loader.settled(requests)).toBe(true);
  });

  it("does not refetch an unchanged request and aborts removed signals", async () => {
    const { cache, calls } = setup();
    let changes = 0;
    const loader = new SeriesLoader(cache, () => changes++);
    loader.update([view(0n, "a1"), view(1n, "a2")]);
    loader.update([view(0n, "a1"), view(1n, "a2")]);
    expect(calls).toHaveLength(2);
    expect(changes).toBe(1);
    loader.update([view(0n, "a1")]);
    expect(calls[1]?.abort.aborted).toBe(true);
    expect(loader.get("a2")).toBeUndefined();
  });

  it("is settled only when every current request has finished", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    expect(loader.settled([view(0n)])).toBe(false);
    calls[0]?.answer();
    await flush();
    expect(loader.settled([view(0n)])).toBe(true);
    expect(loader.settled([view(1n)])).toBe(false);
  });

  it("restarts every request after dispose", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    loader.dispose(); // StrictMode: dispose, then remount with the same requests
    expect(calls[0]?.abort.aborted).toBe(true);
    loader.update([view(0n)]);
    expect(calls).toHaveLength(2);
    calls[0]?.answer(); // late answer of the disposed request
    await flush();
    expect(loader.get("a1")?.status).toBe("loading");
    calls[1]?.answer();
    await flush();
    expect(loader.get("a1")).toMatchObject({ status: "complete", result: { from: "0" } });
    expect(loader.settled([view(0n)])).toBe(true);
  });
});

describe("SeriesLoader on the tab cache", () => {
  it("draws a previous view again without a request", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    calls[0]?.answer();
    await flush();
    const first = loader.get("a1")?.result;
    loader.update([view(1n)]);
    calls[1]?.answer();
    await flush();
    loader.update([view(0n)]); // back to the first view
    expect(calls).toHaveLength(2);
    expect(loader.get("a1")).toMatchObject({ status: "complete" }); // no flush: at once
    expect(loader.settled([view(0n)])).toBe(true);
    expect(loader.get("a1")?.result).toEqual(first);
  });

  it("serves a re-added signal from the cache", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    calls[0]?.answer();
    await flush();
    loader.update([]); // signal removed
    loader.update([view(0n)]); // dropped back in
    expect(calls).toHaveLength(1);
    expect(loader.get("a1")?.status).toBe("complete");
  });

  // Level 20 (width 2^20 ns, span 2^28 ns): seven points spread over six tiles, values 0 to 6.
  const WIDE: FakePoint[] = [
    100_000_000n,
    300_000_000n,
    400_000_000n,
    500_000_000n,
    900_000_000n,
    1_200_000_000n,
    1_500_000_000n,
  ].map((t, v) => ({ t, v }));
  const wideView = (from: string, to: string): LoadRequest => ({
    key: "a1",
    signalId: SIG,
    from,
    to,
    target: 1001,
  });
  const wideSetup = () => {
    const server = fakeFetch(WIDE);
    return {
      ...server,
      loader: new SeriesLoader(new SeriesCache(server.fetch, { now: NOW }), () => {}),
    };
  };
  const FIRST = wideView("0", String(1000n * 2n ** 20n));

  it("requests only the tiles a pan uncovers", async () => {
    const { calls, loader } = wideSetup();
    loader.update([FIRST]);
    expect(calls.map((c) => c.request)).toEqual([
      { signalId: SIG, from: "0", to: "1073741824", target: 1025 },
    ]);
    calls[0]?.answer();
    await flush();
    loader.update([wideView("524288000", "1572864000")]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.request).toEqual({
      signalId: SIG,
      from: "1073741824",
      to: "1610612736",
      target: 513,
    });
  });

  it("zooms into raw tiles without a request", async () => {
    const { calls, loader } = wideSetup();
    loader.update([FIRST]);
    calls[0]?.answer();
    await flush();
    expect(raw(loader.get("a1")?.result).v).toEqual([0, 1, 2, 3, 4]); // points before 2^30
    // Zoom in by 4: 250 × 2^20 ns from 200,000,000 is level 18, inside the raw level-20 tiles.
    const from = 200_000_000n;
    const zoom = wideView(from.toString(), (from + 250n * 2n ** 20n).toString());
    loader.update([zoom]);
    expect(calls).toHaveLength(1);
    expect(loader.settled([zoom])).toBe(true);
    const r = raw(loader.get("a1")?.result);
    expect(decodeTimes(r.t)).toEqual([300_000_000n, 400_000_000n]);
    expect(r.v).toEqual([1, 2]);
    expect(r.before).toEqual({ t: "100000000", v: 0 });
    expect(r.after).toEqual({ t: "500000000", v: 3 });
  });

  it("keeps drawing a view whose tiles were dropped", async () => {
    const { cache, calls } = setup({ limit: 1 }); // no tile fits
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    calls[0]?.answer();
    await flush();
    expect(cache.size).toBe(0);
    expect(cache.peek(SIG, 10, 0n)).toBeUndefined();
    expect(loader.get("a1")).toMatchObject({ status: "complete", result: { from: "0" } });
    expect(raw(loader.get("a1")?.result).v).toHaveLength(10);
  });

  it("shares one request between two windows", async () => {
    const { cache, calls } = setup();
    const w1 = new SeriesLoader(cache, () => {});
    const w2 = new SeriesLoader(cache, () => {});
    w1.update([view(0n)]);
    w2.update([view(0n)]);
    expect(calls).toHaveLength(1);
    calls[0]?.answer();
    await flush();
    expect(w1.get("a1")?.status).toBe("complete");
    expect(w2.get("a1")?.status).toBe("complete");
  });

  it("lets a late response fill the cache only", async () => {
    const { cache, calls } = setup();
    const w1 = new SeriesLoader(cache, () => {});
    const w2 = new SeriesLoader(cache, () => {});
    w1.update([view(0n)]);
    w2.update([view(0n)]); // wants the first view's tile too
    w1.update([view(1n)]); // w1 moves on
    expect(calls).toHaveLength(2);
    expect(calls[0]?.abort.aborted).toBe(false);
    calls[1]?.answer(); // the second view arrives first
    await flush();
    calls[0]?.answer(); // then the first view's request
    await flush();
    expect(w1.get("a1")).toMatchObject({ status: "complete", result: { from: S10.toString() } });
    expect(w2.get("a1")).toMatchObject({ status: "complete", result: { from: "0" } });
    expect(cache.peek(SIG, 10, 0n)).toBeDefined();
  });

  it("requests failed tiles again for the next view", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    calls[0]?.fail(new Error("source_error: timeout"));
    await flush();
    expect(loader.get("a1")?.status).toBe("error");
    // Another view over the same tile (slightly shorter, still level 10).
    loader.update([{ ...view(0n), to: String(S10 - 1n) }]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.request).toEqual(calls[0]?.request);
    calls[1]?.answer();
    await flush();
    expect(loader.get("a1")?.status).toBe("complete");
  });
});

describe("SeriesLoader with the window options", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  // 4,295 points every 10^6 ns from 500 (up to 4,294,500,500): dense at every level of these tests.
  const DENSE = densePoints(4295, 1_000_000n, 500n);
  const EXTENT: Extent = { signalId: SIG, first: "0", last: "4294967295" };
  const WIDE_TO = 1000n * 2n ** 20n; // level 20 at target 1001: tiles 0 to 3

  const wide = (key = "a1"): LoadRequest => ({
    key,
    signalId: SIG,
    from: "0",
    to: WIDE_TO.toString(),
    target: 1001,
  });

  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

  /** Answers every call that is not yet answered or aborted, until no new call appears. */
  async function answerAll(calls: FakeCall[], answered: Set<FakeCall>) {
    for (let round = 0; round < 20; round++) {
      await tick();
      const open = calls.filter((c) => !answered.has(c) && !c.abort.aborted);
      if (open.length === 0) return;
      for (const c of open) {
        answered.add(c);
        c.answer();
      }
    }
  }

  function wsetup(
    options: LoaderOptions = {},
    extent: Extent | null = EXTENT,
    cacheOptions: { limit?: number } = {},
  ) {
    const server = fakeFetch(DENSE);
    const starts: number[] = [];
    const calls = server.calls;
    const fetch: typeof server.fetch = (request, abort) => {
      starts.push(Date.now());
      return server.fetch(request, abort);
    };
    const cache = new SeriesCache(fetch, { now: NOW, ...cacheOptions });
    const extentCalls: string[] = [];
    const extents = new Map<string, Promise<Extent>>();
    const extentOf = (signalId: string) => {
      let p = extents.get(signalId);
      if (!p) {
        extentCalls.push(signalId);
        p = Promise.resolve(extent as Extent);
        extents.set(signalId, p);
      }
      return p;
    };
    let changes = 0;
    const make = () =>
      new SeriesLoader(cache, () => changes++, {
        loadIntervalMs: 100,
        ...(extent ? { extent: extentOf } : {}),
        ...options,
      });
    const answered = new Set<FakeCall>();
    return {
      cache,
      calls,
      starts,
      extentCalls,
      make,
      answered,
      changes: () => changes,
      drain: () => answerAll(calls, answered),
    };
  }

  it("draws a cached zoom in the same update, without a request", async () => {
    const t = wsetup({ prefetch: true });
    const loader = t.make();
    loader.update([view(0n)]);
    expect(t.extentCalls).toEqual([SIG]); // the extent first ...
    expect(t.calls).toHaveLength(0); // ... no series request in the update
    await tick(); // the extent's microtask
    expect(t.calls.length).toBeGreaterThan(0);
    await t.drain();
    await tick(150);
    loader.update([view(1n)]);
    await t.drain();
    await tick(150);
    expect(loader.get("a1")).toMatchObject({
      status: "complete",
      result: { from: S10.toString() },
    });

    const requests = t.calls.length;
    const changes = t.changes();
    loader.update([view(0n)]); // back to view A
    expect(t.calls).toHaveLength(requests); // no fetch
    expect(loader.get("a1")).toMatchObject({ status: "complete", result: { from: "0" } });
    expect(loader.settled([view(0n)])).toBe(true);
    expect(t.changes()).toBeGreaterThan(changes); // onChange ran inside the update
    loader.dispose();
  });

  it("throttles loads during a gesture: first at once, then once per interval", async () => {
    const t = wsetup({}, null); // no overview, no prefetch: only visible loads
    const loader = t.make();
    const t0 = Date.now();
    // A new uncached tile every 16 ms from 0 ms to 240 ms (16 views).
    for (let i = 0; i < 16; i++) {
      loader.update([view(BigInt(i))]);
      if (i === 0) expect(t.calls).toHaveLength(1); // at once
      await tick(16);
    }
    await tick(200);
    expect(t.starts.map((s) => s - t0)).toEqual([0, 100, 200, 300]);
    // The 0, 96, 192 and 240 ms views.
    expect(t.calls.map((c) => c.request.from)).toEqual(
      [0n, 6n, 12n, 15n].map((j) => (j * S10).toString()),
    );
    // Each earlier run, which the next view does not want, is aborted.
    expect(t.calls.map((c) => c.abort.aborted)).toEqual([true, true, true, false]);

    // A single step after a pause starts within the update call.
    loader.update([view(20n)]);
    expect(t.calls).toHaveLength(5);
    expect(t.calls[4]?.request.from).toBe((20n * S10).toString());
    loader.dispose();
  });

  it("loads the overview once per signal after its first view", async () => {
    const t = wsetup({}); // extent set, no prefetch
    const w1 = t.make();
    const w2 = t.make();
    w1.update([view(0n)]);
    w2.update([view(0n, "b1")]);
    // The extent comes first: asked once for both loaders, before any series request.
    expect(t.extentCalls).toEqual([SIG]);
    expect(t.calls).toHaveLength(0);
    await tick(); // the extent resolves: the view (level 10, below the overview's 22) goes first
    expect(t.extentCalls).toEqual([SIG]);
    expect(t.calls).toHaveLength(1); // the first view, shared
    expect(t.calls[0]?.request).toEqual({
      signalId: SIG,
      from: "0",
      to: "262144",
      target: 257,
    });
    t.calls[0]?.answer();
    t.answered.add(t.calls[0] as FakeCall);
    await tick();
    expect(t.extentCalls).toEqual([SIG]); // still one extent request
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]?.request).toEqual({
      signalId: SIG,
      from: "0",
      to: "4294967296",
      target: 1025,
    });
    await t.drain();
    await tick(1000);
    expect(t.calls).toHaveLength(2); // one overview request for both loaders, nothing else
    expect(w1.get("a1")?.status).toBe("complete");
    expect(w2.get("b1")?.status).toBe("complete");
    w1.dispose();
    w2.dispose();
  });

  it("keeps the overview tiles when the cache drops them", async () => {
    const t = wsetup({}, EXTENT, { limit: 1 }); // no tile fits: everything stored is dropped
    const loader = t.make();
    loader.update([view(0n)]);
    await t.drain(); // first view, then the overview
    expect(t.calls.some((c) => c.request.target === 1025 && c.request.to === "4294967296")).toBe(
      true,
    );
    expect(t.cache.size).toBe(0);
    await tick(150);

    loader.update([wide()]);
    const state = loader.get("a1");
    expect(state).toMatchObject({ status: "loading", placeholder: true });
    expect(state?.result).toMatchObject({ kind: "buckets", width: "4194304" }); // level 22, from the overview
    loader.dispose();
  });

  it("shows a placeholder at once and sharp data after the response", async () => {
    const t = wsetup({});
    const loader = t.make();
    loader.update([view(0n)]);
    await t.drain(); // first view and overview (level 22)
    await tick(150);

    const before = t.calls.length;
    loader.update([wide()]);
    expect(t.calls).toHaveLength(before + 1);
    expect(t.calls[before]?.request).toEqual({
      signalId: SIG,
      from: "0",
      to: "1073741824",
      target: 1025,
    });
    const state = loader.get("a1");
    expect(state).toMatchObject({ status: "loading", placeholder: true });
    expect(state?.result).toMatchObject({ kind: "buckets", width: "4194304" }); // 2^22
    expect(loader.settled([wide()])).toBe(false);

    await t.drain();
    const done = loader.get("a1");
    expect(done?.status).toBe("complete");
    expect(done?.placeholder).toBeUndefined();
    expect(done?.result).toMatchObject({ kind: "buckets", width: "1048576" }); // 2^20
    expect(loader.settled([wide()])).toBe(true);
    loader.dispose();
  });

  it("prefetches after the view rests, never during a gesture", async () => {
    const t = wsetup({ prefetch: true }, null);
    const loader = t.make();
    // A changing view every 50 ms for one second.
    for (let i = 0; i < 20; i++) {
      loader.update([view(BigInt(i))]);
      await tick(50);
    }
    await tick(150);
    const gesture = t.calls.length;
    expect(t.calls.every((c) => c.request.target === 257)).toBe(true); // visible views only

    loader.update([wide()]);
    expect(t.calls).toHaveLength(gesture + 1);
    t.calls[gesture]?.answer();
    t.answered.add(t.calls[gesture] as FakeCall);
    await tick(299);
    expect(t.calls).toHaveLength(gesture + 1); // still no prefetch 299 ms after the change
    await tick(1);

    // Level 21 tiles 0 and 1 are merged from the cached level-20 tiles and tile 3 of level 20 is
    // cached, so the plan's tiles -2…3 / -4…-1 / 3…7 shrink to these runs (design Z7: cache.find).
    const expected = [
      { signalId: SIG, from: "-1073741824", to: "0", target: 513 }, // level 21, tiles -2…-1
      { signalId: SIG, from: "1073741824", to: "2147483648", target: 513 }, // level 21, tiles 2…3
      { signalId: SIG, from: "-1073741824", to: "0", target: 1025 }, // level 20, tiles -4…-1
      { signalId: SIG, from: "1073741824", to: "2147483648", target: 1025 }, // level 20, tiles 4…7
    ];
    const prefetch = () => t.calls.slice(gesture + 1);
    expect(prefetch().map((c) => c.request)).toEqual(expected.slice(0, 2)); // two in flight at most
    prefetch()[0]?.answer();
    await tick();
    expect(prefetch().map((c) => c.request)).toEqual(expected.slice(0, 3));

    // A new view that wants none of them: running prefetch is aborted, queued prefetch never sent.
    loader.update([view(30n)]);
    await tick();
    expect(
      prefetch()
        .slice(1, 3)
        .map((c) => c.abort.aborted),
    ).toEqual([true, true]);
    expect(prefetch().map((c) => c.request.from)).toEqual([
      ...expected.slice(0, 3).map((e) => e.from),
      (30n * S10).toString(),
    ]);
    loader.dispose();
  });

  it("prefetches no tile outside the workspace's scope", async () => {
    const t = wsetup({ prefetch: true }, null);
    // The view starts at the scope's start, as after a case step: the tiles before it answer 409.
    t.cache.setScope({ dataRef: "c", from: "0", to: (2n ** 40n).toString() });
    const loader = t.make();
    loader.update([wide()]);
    await t.drain();
    await tick(300);
    await t.drain();
    expect(t.calls.length).toBeGreaterThan(1); // prefetch ran
    expect(t.calls.every((c) => BigInt(c.request.to) > 0n)).toBe(true);
    loader.dispose();
  });
});

describe("SeriesLoader retries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const DENSE = densePoints(4295, 1_000_000n, 500n);
  const EXTENT: Extent = { signalId: SIG, first: "0", last: "4294967295" };
  const WIDE_TO = 1000n * 2n ** 20n;
  const wide = (key = "a1"): LoadRequest => ({
    key,
    signalId: SIG,
    from: "0",
    to: WIDE_TO.toString(),
    target: 1001,
  });
  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
  const down = (message = "down") => new ApiRequestError(502, "source_error", message);
  const DOWN = "source_error: down";

  /** Window options (throttle interval, retry) over a fake server; `at()` lists fetch start times in ms. */
  function rsetup(options: LoaderOptions = {}, extent?: LoaderOptions["extent"]) {
    const server = fakeFetch(DENSE);
    const starts: number[] = [];
    const fetch: typeof server.fetch = (request, abort) => {
      starts.push(Date.now());
      return server.fetch(request, abort);
    };
    const cache = new SeriesCache(fetch, { now: NOW });
    const t0 = Date.now();
    const make = (extra: LoaderOptions = {}) =>
      new SeriesLoader(cache, () => {}, {
        loadIntervalMs: LOAD_INTERVAL_MS,
        retry: true,
        ...(extent ? { extent } : {}),
        ...options,
        ...extra,
      });
    return { cache, calls: server.calls, at: () => starts.map((s) => s - t0), make };
  }

  /** Fails a call and lets the loader see it. */
  const fail = async (call: FakeCall | undefined, error: Error = down()) => {
    call?.fail(error);
    await tick();
  };
  /** Answers a call and lets the loader see it. */
  const answer = async (call: FakeCall | undefined) => {
    call?.answer();
    await tick();
  };

  it("retries a failed load with backoff 1, 2, 4, 8, 16, 30 s", async () => {
    const t = rsetup();
    const loader = t.make();
    loader.update([view(0n)]);
    // The first seven fetches fail; the delays after each failure are 1, 2, 4, 8, 16, 30, 30 s.
    const delays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    for (const [i, delay] of delays.entries()) {
      expect(t.calls).toHaveLength(i + 1);
      await fail(t.calls[i]);
      await tick(delay - 1);
      expect(t.calls).toHaveLength(i + 1); // nothing in between
      await tick(1);
    }
    expect(t.at()).toEqual([0, 1000, 3000, 7000, 15000, 31000, 61000, 91000]);
    await answer(t.calls[7]);
    expect(loader.get("a1")?.status).toBe("complete");
    expect(loader.get("a1")?.error).toBeUndefined();
    await tick(120000);
    expect(t.calls).toHaveLength(8);
    loader.dispose();
  });

  it("resets the backoff after a complete load", async () => {
    const t = rsetup();
    const loader = t.make();
    loader.update([view(0n)]);
    await fail(t.calls[0]);
    await tick(1000); // retry 1
    await fail(t.calls[1]);
    await tick(2000); // retry 2
    expect(t.calls).toHaveLength(3);
    await answer(t.calls[2]);
    expect(loader.get("a1")?.status).toBe("complete");

    await tick(LOAD_INTERVAL_MS); // the throttle interval of the last load ends
    loader.update([view(1n)]);
    expect(t.calls).toHaveLength(4);
    await fail(t.calls[3]);
    await tick(999);
    expect(t.calls).toHaveLength(4);
    await tick(1);
    expect(t.calls).toHaveLength(5); // 1 s after the failure, not 4 s
    expect(t.calls[4]?.request.from).toBe(S10.toString());
    loader.dispose();
  });

  it("does not retry a 4xx failure by itself", async () => {
    const t = rsetup();
    const loader = t.make();
    loader.update([view(0n)]);
    // Not `unknown_signal`: that one reads as missing and stays so for the same view (DW13).
    await fail(t.calls[0], new ApiRequestError(400, "bad_range", "no such range"));
    await tick(120000);
    expect(t.calls).toHaveLength(1);
    expect(loader.get("a1")).toMatchObject({
      status: "error",
      error: "bad_range: no such range",
    });

    // Second half: the identical request again retries it.
    loader.update([view(0n)]);
    await tick(LOAD_INTERVAL_MS);
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]?.request).toEqual(t.calls[0]?.request);
    loader.dispose();
  });

  it("reads an unknown signal as missing", async () => {
    // The API error of a 404 answer {error: {code: "unknown_signal", message: ...}}, as api.ts builds it.
    const unknown = await apiError(404, "unknown_signal", "unknown signal: othercar/X");
    expect(unknown).toBeInstanceOf(ApiRequestError);
    const t = rsetup();
    const loader = t.make();
    loader.update([view(0n)]);
    await fail(t.calls[0], unknown);
    const state = loader.get("a1");
    // The status and code of the API error reach the loader state.
    expect(state).toMatchObject({ status: "error", errorStatus: 404, errorCode: "unknown_signal" });
    expect(isMissing(state)).toBe(true);
    // missing outside and inside a case, never `failed: …` and never `not in this session`.
    expect(loadStatusText(state, false)).toBe("missing");
    expect(loadStatusText(state, true)).toBe("missing");
    // Not retried: neither by backoff nor when the same view is asked again.
    await tick(120000);
    loader.update([view(0n)]);
    await tick(120000);
    expect(t.calls).toHaveLength(1);
    loader.dispose();

    // Another failure of the same request kind keeps `failed: <message>` and is not missing.
    const other = rsetup();
    const second = other.make();
    second.update([view(0n)]);
    await fail(other.calls[0], await apiError(502, "source_error", "down"));
    expect(isMissing(second.get("a1"))).toBe(false);
    expect(loadStatusText(second.get("a1"), true)).toBe("failed: source_error: down");
    // A 404 with another code is a plain failure, too.
    const odd = rsetup();
    const third = odd.make();
    third.update([view(0n)]);
    await fail(odd.calls[0], await apiError(404, "not_found", "no such thing"));
    expect(loadStatusText(third.get("a1"), true)).toBe("failed: not_found: no such thing");
    second.dispose();
    third.dispose();
  });

  it("retries at once when another request of the tab succeeds", async () => {
    const t = rsetup();
    const w1 = t.make();
    const w2 = t.make();
    w1.update([view(0n)]);
    // Four failures in a row: fetches at 0, 1, 3 and 7 s; the fourth retry is due 8 s after 7 s.
    for (const wait of [1000, 2000, 4000, 0]) {
      await fail(t.calls.at(-1));
      await tick(wait);
    }
    expect(t.at()).toEqual([0, 1000, 3000, 7000]);
    await fail(t.calls[3]); // fourth failure at 7 s
    await tick(3000); // 10 s: A's retry is due at 15 s
    expect(t.calls).toHaveLength(4);
    w2.update([view(1n, "b1")]);
    expect(t.calls).toHaveLength(5);
    await answer(t.calls[4]);
    expect(t.calls).toHaveLength(6); // A's retry started right after that answer
    expect(t.calls[5]?.request.from).toBe("0");
    expect(t.at()[5]).toBe(10000);
    w1.dispose();
    w2.dispose();
  });

  it("retries at once on recovery, not sooner than 1 s after the failure", async () => {
    const t = rsetup();
    const w1 = t.make();
    const w2 = t.make();
    w1.update([view(0n)]);
    for (const wait of [1000, 2000]) {
      await fail(t.calls.at(-1));
      await tick(wait);
    }
    await fail(t.calls[2]); // third failure at F = 3 s; next retry due at F + 4 s
    await tick(500);
    w2.update([view(1n, "b1")]);
    expect(t.calls).toHaveLength(4);
    await answer(t.calls[3]); // answers at F + 0.5 s
    expect(t.calls).toHaveLength(4); // floor: not yet
    await tick(499);
    expect(t.calls).toHaveLength(4);
    await tick(1);
    expect(t.calls).toHaveLength(5);
    expect(t.at()[4]).toBe(4000); // F + 1 s
    expect(t.calls[4]?.request.from).toBe("0");
    w1.dispose();
    w2.dispose();
  });

  it("retries at once when the cache reports a recovery", async () => {
    const t = rsetup();
    const loader = t.make();
    loader.update([view(0n)]);
    for (const wait of [1000, 2000]) {
      await fail(t.calls.at(-1));
      await tick(wait);
    }
    await fail(t.calls[2]); // third failure at 3 s; next retry due at 7 s
    await tick(2000);
    expect(t.calls).toHaveLength(3);
    t.cache.recover(); // the live channel opened
    await tick();
    expect(t.calls).toHaveLength(4);
    expect(t.at()[3]).toBe(5000);
    loader.dispose();
  });

  it("retries a failed load at once when the same request comes again", async () => {
    const t = rsetup();
    const loader = t.make();
    loader.update([view(0n)]);
    for (const wait of [1000, 2000]) {
      await fail(t.calls.at(-1));
      await tick(wait);
    }
    await fail(t.calls[2]); // third failure at 3 s; next retry due at 7 s
    await tick(2000);
    expect(t.calls).toHaveLength(3);
    loader.update([view(0n)]); // identical request in a new array
    await tick(LOAD_INTERVAL_MS); // an update within a running throttle interval starts at its end
    expect(t.calls).toHaveLength(4);
    expect(t.at()[3]).toBeLessThanOrEqual(5000 + LOAD_INTERVAL_MS);
    loader.dispose();
  });

  it("stops retrying when the signal is removed, the view changes or the loader is disposed", async () => {
    // Removed while waiting.
    const a = rsetup();
    const removed = a.make();
    removed.update([view(0n)]);
    await fail(a.calls[0]);
    removed.update([]);
    await tick(60000);
    expect(a.calls).toHaveLength(1);

    // View changed while waiting: B is fetched at once, A never again; B's failure continues the sequence.
    const b = rsetup();
    const changed = b.make();
    changed.update([view(0n)]);
    await fail(b.calls[0]);
    await tick(500);
    changed.update([view(1n)]);
    expect(b.calls).toHaveLength(2);
    expect(b.calls[1]?.request.from).toBe(S10.toString());
    await fail(b.calls[1]); // second failure of the key: next delay 2 s
    await tick(1999);
    expect(b.calls).toHaveLength(2);
    await tick(1);
    expect(b.calls).toHaveLength(3);
    expect(b.at()[2]).toBe(2500);
    await tick(60000);
    expect(b.calls.slice(1).every((c) => c.request.from === S10.toString())).toBe(true);
    changed.dispose();

    // Disposed while waiting.
    const c = rsetup();
    const disposed = c.make();
    disposed.update([view(0n)]);
    await fail(c.calls[0]);
    disposed.dispose();
    await tick(60000);
    expect(c.calls).toHaveLength(1);
  });

  it("two windows retry with one request", async () => {
    const t = rsetup();
    const w1 = t.make();
    const w2 = t.make();
    w1.update([view(0n)]);
    w2.update([view(0n)]);
    expect(t.calls).toHaveLength(1); // shared request
    await fail(t.calls[0]);
    expect(w1.get("a1")?.status).toBe("error");
    expect(w2.get("a1")?.status).toBe("error");
    await tick(1000);
    expect(t.calls).toHaveLength(2); // one retry for both
    await answer(t.calls[1]);
    expect(w1.get("a1")).toMatchObject({ status: "complete", result: { from: "0" } });
    expect(w2.get("a1")).toMatchObject({ status: "complete", result: { from: "0" } });
    expect(t.calls).toHaveLength(2);
    w1.dispose();
    w2.dispose();
  });

  it("a retry completes from the cache without a request", async () => {
    const t = rsetup();
    const w1 = t.make();
    const w2 = t.make();
    w1.update([view(0n)]);
    await fail(t.calls[0]); // window 1 failed at 0; its retry is due at 1 s
    await tick(300);
    w2.update([view(0n, "b1")]); // window 2 loads the same tiles
    expect(t.calls).toHaveLength(2);
    await answer(t.calls[1]);
    await tick(700); // 1 s after the failure
    expect(t.calls).toHaveLength(2); // no fetch of window 1's own
    expect(w1.get("a1")).toMatchObject({ status: "complete", result: { from: "0" } });
    w1.dispose();
    w2.dispose();
  });

  it("does not retry a failed prefetch", async () => {
    const t = rsetup({ prefetch: true });
    const loader = t.make();
    loader.update([wide()]);
    await answer(t.calls[0]);
    expect(loader.get("a1")?.status).toBe("complete");
    // Let the view rest and fail every prefetch request as it appears.
    const failed = new Set<FakeCall>([t.calls[0] as FakeCall]);
    await tick(400);
    for (let round = 0; round < 40; round++) {
      const open = t.calls.filter((c) => !failed.has(c));
      if (open.length === 0) break;
      for (const c of open) {
        failed.add(c);
        c.fail(down());
      }
      await tick(100);
    }
    expect(t.calls.length).toBeGreaterThan(1); // prefetch did run
    const sent = t.calls.length;
    await tick(120000);
    expect(t.calls).toHaveLength(sent); // nothing again
    const keys = t.calls.map((c) => JSON.stringify(c.request));
    expect(new Set(keys).size).toBe(keys.length); // no tile fetched twice
    loader.dispose();
  });

  it("starts a failed overview again after a complete view", async () => {
    let extentCalls = 0;
    let extentDown = true;
    const extent = async (): Promise<Extent> => {
      extentCalls++;
      if (extentDown) throw down();
      return EXTENT;
    };
    const t = rsetup({}, extent);
    const loader = t.make();
    loader.update([view(0n)]);
    expect(extentCalls).toBe(1); // the extent is asked first ...
    expect(t.calls).toHaveLength(0);
    await tick(); // ... fails, and the view loads at once
    expect(t.calls).toHaveLength(1);
    await fail(t.calls[0]); // the first view fails too
    expect(extentCalls).toBe(1);
    await tick(1000);
    await fail(t.calls[1]); // the retry fails too: no extent request
    expect(extentCalls).toBe(1);
    extentDown = false;
    await tick(2000);
    expect(t.calls).toHaveLength(3);
    await answer(t.calls[2]); // the view completes
    await tick();
    expect(extentCalls).toBe(2); // right after that complete view
    // Overview tiles arrive: placeholders come from it again.
    const overview = t.calls.slice(3);
    expect(overview.length).toBeGreaterThan(0);
    for (const c of overview) c.answer();
    await tick(LOAD_INTERVAL_MS + 50);
    loader.update([wide()]);
    expect(loader.get("a1")).toMatchObject({ status: "loading", placeholder: true });
    loader.dispose();
  });

  it("is settled while failed, not while a retry loads", async () => {
    const t = rsetup();
    const loader = t.make();
    loader.update([view(0n)]);
    expect(loader.settled([view(0n)])).toBe(false);
    await fail(t.calls[0]);
    expect(loader.get("a1")?.status).toBe("error");
    expect(loader.settled([view(0n)])).toBe(true);
    await tick(1000); // the retry starts
    expect(t.calls).toHaveLength(2);
    expect(loader.get("a1")?.status).toBe("loading");
    expect(loader.settled([view(0n)])).toBe(false);
    await answer(t.calls[1]);
    expect(loader.get("a1")?.status).toBe("complete");
    expect(loader.get("a1")?.error).toBeUndefined();
    expect(loader.settled([view(0n)])).toBe(true);
    loader.dispose();
  });

  it("keeps the shown result when a load fails", async () => {
    const t = rsetup({ retry: false });
    const loader = t.make();
    loader.update([view(0n)]);
    await answer(t.calls[0]);
    const shown = loader.get("a1")?.result;
    expect(shown).toMatchObject({ from: "0" });
    await tick(LOAD_INTERVAL_MS);
    loader.update([view(1n)]);
    await fail(t.calls[1]);
    const state = loader.get("a1");
    expect(state).toMatchObject({
      status: "error",
      request: `c/s|${S10}|${2n * S10}|257`,
      error: DOWN,
    });
    expect(state?.result).toBe(shown);
    expect(state?.placeholder).toBeUndefined();
    loader.dispose();
  });

  it("keeps the placeholder when a load fails", async () => {
    const t = rsetup({ retry: false }, async () => EXTENT);
    const loader = t.make();
    loader.update([view(0n)]);
    await tick(); // the extent first, then the view
    await answer(t.calls[0]); // first view
    await tick();
    for (const c of t.calls.slice(1)) c.answer(); // overview
    await tick(150);
    const before = t.calls.length;
    loader.update([wide()]);
    const shown = loader.get("a1");
    expect(shown).toMatchObject({ status: "loading", placeholder: true });
    expect(t.calls).toHaveLength(before + 1);
    await fail(t.calls[before]);
    const state = loader.get("a1");
    expect(state).toMatchObject({ status: "error", error: DOWN, placeholder: true });
    expect(state?.result).toBe(shown?.result);
    expect(state?.result).toMatchObject({ kind: "buckets", width: "4194304" });
    loader.dispose();
  });

  it("names the legend status, failed while a retry loads", async () => {
    const t = rsetup();
    const loader = t.make();
    expect(loadStatusText(undefined)).toBe("loading");
    loader.update([view(0n)]);
    expect(loadStatusText(loader.get("a1"))).toBe("loading"); // plain loading
    await fail(t.calls[0]);
    expect(loadStatusText(loader.get("a1"))).toBe(`failed: ${DOWN}`);
    await tick(1000); // retry loads and carries the last error
    expect(loader.get("a1")).toMatchObject({ status: "loading", error: DOWN });
    expect(loadStatusText(loader.get("a1"))).toBe(`failed: ${DOWN}`);
    await answer(t.calls[1]);
    expect(loadStatusText(loader.get("a1"))).toBe("");
    loader.dispose();
  });
});

describe("SeriesLoader with malformed answers", () => {
  it("fails an exact view whose answer is malformed", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    // A view that ends after TIME_MAX cannot be tiled and is fetched exactly.
    const exact: LoadRequest = {
      key: "a1",
      signalId: SIG,
      from: (TIME_MAX - 1000n).toString(),
      to: (TIME_MAX + 1000n).toString(),
      target: 257,
    };
    const level = levelFor(BigInt(exact.from), BigInt(exact.to), exact.target);
    const { first, last } = touchedTiles(BigInt(exact.from), BigInt(exact.to), level);
    expect(tileable(level, first, last)).toBe(false);
    loader.update([exact]);
    expect(calls).toHaveLength(1);
    const bad = {
      kind: "raw",
      signalId: SIG,
      from: exact.from,
      to: exact.to,
      t: encodeTimes([1n, 2n, 3n]),
      v: [1, 2],
    } as RawSeries;
    calls[0]?.answer(bad);
    await flush();
    const state = loader.get("a1");
    expect(state?.status).toBe("error");
    expect(state?.error).toMatch(/malformed series result/);
    expect(state?.result).toBeUndefined();
    loader.dispose();
  });

  it("fails a tiled view whose answer is malformed", async () => {
    const { cache, calls } = setup();
    const loader = new SeriesLoader(cache, () => {});
    loader.update([view(0n)]);
    expect(calls).toHaveLength(1);
    const good = JSON.parse(JSON.stringify(fakeAnswer(POINTS, calls[0]?.request as LoadRequest)));
    good.t.dt[1] = "abc";
    calls[0]?.answer(good);
    await flush();
    const state = loader.get("a1");
    expect(state?.status).toBe("error");
    expect(state?.error).toMatch(/invalid time offset|malformed series result/);
    expect(state?.result).toBeUndefined();
    expect(cache.peek(SIG, 10, 0n)).toBeUndefined();
    expect(cache.peek(SIG, 10, 1n)).toBeUndefined();
    loader.dispose();
  });
});

describe("loadKey", () => {
  it("load key ignores unrelated revisions", () => {
    const signals = [{ id: "a1", signalId: "c/s" }];
    const key = loadKey(signals, 0);
    // A new array with equal content, as every pushed revision brings.
    expect(
      loadKey(
        signals.map((s) => ({ ...s })),
        0,
      ),
    ).toBe(key);
    expect(loadKey([...signals, { id: "a2", signalId: "c/t" }], 0)).not.toBe(key);
    expect(loadKey(signals, 1)).not.toBe(key);
  });
});

describe("SeriesLoader pulls a failing signal forward once per run", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const DENSE = densePoints(4295, 1_000_000n, 500n);
  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

  /** Signal A (view 0) always fails at once; every other request waits for a manual answer. */
  function psetup() {
    const server = fakeFetch(DENSE);
    const aStarts: number[] = [];
    const t0 = Date.now();
    const cache = new SeriesCache(
      (request, abort) => {
        if (request.from === "0") {
          aStarts.push(Date.now() - t0);
          return Promise.reject(new ApiRequestError(502, "source_error", "down"));
        }
        return server.fetch(request, abort);
      },
      { now: NOW },
    );
    const make = () =>
      new SeriesLoader(cache, () => {}, { loadIntervalMs: LOAD_INTERVAL_MS, retry: true });
    const answered = new Set<FakeCall>();
    /** Another window's request of the tab succeeds. */
    const otherSucceeds = async (loader: SeriesLoader, j: bigint) => {
      loader.update([view(j, "b1")]);
      await tick();
      for (const call of server.calls) {
        if (answered.has(call)) continue;
        answered.add(call);
        call.answer();
      }
      await tick();
    };
    return { cache, aStarts, make, otherSucceeds };
  }

  it("pulls a failing signal forward once per run of failures", async () => {
    const t = psetup();
    const w1 = t.make();
    const w2 = t.make();
    w1.update([view(0n)]); // F1 = 0 s
    await tick(200);
    await t.otherSucceeds(w2, 1n); // pulls A forward to F1 + 1 s
    // A's pulled retry fails at F2 = 1 s; from then on other requests answer every 100 ms.
    for (let j = 2n; j < 102n; j++) {
      await tick(100);
      await t.otherSucceeds(w2, j);
    }
    // F1 = 0, the pulled retry at 1 s, then only the backoff: F2 + 2 s, and 4 s after that.
    expect(t.aStarts).toEqual([0, 1000, 3000, 7000]);
    w1.dispose();
    w2.dispose();
  });

  it("a live reconnect pulls a failing signal forward again", async () => {
    const t = psetup();
    const w1 = t.make();
    const w2 = t.make();
    w1.update([view(0n)]); // fails at 0 s
    await tick(200);
    await t.otherSucceeds(w2, 1n); // pulled once: A fetches at 1 s and fails
    await tick(2800); // 3 s: the backoff retry fails again; the next one is due at 7 s
    expect(t.aStarts).toEqual([0, 1000, 3000]);
    await tick(1000);
    await t.otherSucceeds(w2, 2n); // 4 s: a success does not pull A again
    expect(t.aStarts).toHaveLength(3);
    await tick(1000); // 5 s: the live channel opens, 2 s after A's last failure
    t.cache.recover();
    await tick();
    expect(t.aStarts).toEqual([0, 1000, 3000, 5000]);
    w1.dispose();
    w2.dispose();
  });
});

describe("SeriesLoader opens on the extent (single-wave-open)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);
  const FULL = "4294967296"; // 2^32
  const open = (target: number, to = FULL, from = "0", key = "a1"): LoadRequest => ({
    key,
    signalId: SIG,
    from,
    to,
    target,
  });
  const req = (from: string, to: string, target: number) => ({ signalId: SIG, from, to, target });

  /**
   * A window-options loader over a fake server and a fake extent store (one ask per signal until
   * the scope changes; a failed ask is asked again). `events` lists the extent and series requests
   * in the order they were sent. Mode "manual": the extent waits for `resolveExtent`/`failExtent`.
   */
  function wave(
    fixture: Fixture,
    mode: "auto" | "manual" = "auto",
    options: LoaderOptions = {},
    cacheOptions: { limit?: number; now?: () => number } = {},
  ) {
    const server = fakeFetch(fixture.points);
    const events: string[] = [];
    const fetch: typeof server.fetch = (request, abort) => {
      events.push(`series ${request.from} ${request.to} ${request.target}`);
      return server.fetch(request, abort);
    };
    const cache = new SeriesCache(fetch, { now: NOW, ...cacheOptions });
    let span = { first: fixture.first, last: fixture.last };
    const asked: string[] = [];
    const known = new Map<string, Promise<Extent>>();
    const waiting: { resolve: () => void; reject: (error: Error) => void }[] = [];
    const extentOf = (signalId: string): Promise<Extent> => {
      const have = known.get(signalId);
      if (have) return have;
      asked.push(signalId);
      events.push(`extent ${signalId}`);
      const extent: Extent = { signalId, ...span };
      const promise =
        mode === "auto"
          ? Promise.resolve(extent)
          : new Promise<Extent>((resolve, reject) =>
              waiting.push({ resolve: () => resolve(extent), reject }),
            );
      known.set(signalId, promise);
      promise.catch(() => known.delete(signalId));
      return promise;
    };
    const answered = new Set<FakeCall>();
    /** Answers every call not yet answered or aborted, until no new call appears. */
    async function drain() {
      for (let round = 0; round < 20; round++) {
        await tick();
        const open = server.calls.filter((c) => !answered.has(c) && !c.abort.aborted);
        if (open.length === 0) return;
        for (const c of open) {
          answered.add(c);
          c.answer();
        }
      }
    }
    return {
      cache,
      calls: server.calls,
      events,
      asked,
      make: (extra: LoaderOptions = {}) =>
        new SeriesLoader(cache, () => {}, {
          loadIntervalMs: 100,
          extent: extentOf,
          ...options,
          ...extra,
        }),
      /** The extent the next ask returns (after a `rescope()`: a new scope's store). */
      setExtent: (next: { first: string; last: string }) => {
        span = next;
        known.clear();
      },
      resolveExtent: () => waiting.at(-1)?.resolve(),
      failExtent: (error = new Error("extent down")) => waiting.at(-1)?.reject(error),
      drain,
      /** Rests `ms` with every request answered. */
      rest: async (ms = 2000) => {
        for (let i = 0; i < 4; i++) {
          await drain();
          await tick(ms / 4);
        }
        await drain();
      },
    };
  }

  /** What a loader without options draws for `request` on its own cache: today's cold path. */
  async function withoutOptions(points: readonly FakePoint[], request: LoadRequest) {
    const server = fakeFetch(points);
    const cache = new SeriesCache(server.fetch, { now: NOW });
    const loader = new SeriesLoader(cache, () => {});
    loader.update([request]);
    const answered = new Set<FakeCall>();
    for (let round = 0; round < 10; round++) {
      await tick();
      const open = server.calls.filter((c) => !answered.has(c));
      if (open.length === 0) break;
      for (const c of open) {
        answered.add(c);
        c.answer();
      }
    }
    await tick();
    expect(loader.get(request.key)?.status).toBe("complete");
    const result = loader.get(request.key)?.result;
    loader.dispose();
    return result;
  }

  const OPENS = [
    ["DENSE", DENSE_FIXTURE],
    ["SPARSE", SPARSE_FIXTURE],
  ] as const;
  const TARGETS = [257, 1025, 4001];
  /** The one series request of an open: the overview up to target 1025, the view at 4001. */
  const openRequest = (name: string, target: number) =>
    target === 4001 ? req("0", FULL, 4097) : req("0", FULL, name === "DENSE" ? 1025 : 2049);

  it("asks the extent before the first series request", async () => {
    const t = wave(DENSE_FIXTURE, "manual");
    const loader = t.make();
    loader.update([open(257)]);
    // Within the update: the extent asked once, no series request.
    expect(t.events).toEqual([`extent ${SIG}`]);
    expect(loader.get("a1")?.status).toBe("loading");
    await tick(500);
    expect(t.calls).toHaveLength(0); // the extent has not answered: nothing is sent
    t.resolveExtent();
    await tick();
    expect(t.calls.map((c) => c.request)).toEqual([req("0", FULL, 1025)]);
    expect(t.events).toEqual([`extent ${SIG}`, `series 0 ${FULL} 1025`]);
    loader.dispose();
  });

  it("draws a cached step at once, before the extent", async () => {
    const t = wave(DENSE_FIXTURE, "manual");
    // The tile is in the cache (a loader without options loaded it); no extent was asked yet.
    const plain = new SeriesLoader(t.cache, () => {});
    plain.update([open(257)]);
    expect(t.calls).toHaveLength(1);
    t.calls[0]?.answer();
    await tick();
    expect(plain.get("a1")?.status).toBe("complete");
    plain.dispose();
    expect(t.asked).toEqual([]);

    const loader = t.make();
    loader.update([open(257, FULL, "0", "b1")]);
    expect(loader.get("b1")?.status).toBe("complete"); // the extent has not answered
    expect(t.calls).toHaveLength(1); // no series request for the view
    loader.dispose();
  });

  it("loads the view first when the extent fails", async () => {
    const t = wave(DENSE_FIXTURE, "manual");
    const loader = t.make();
    loader.update([open(257)]);
    expect(t.asked).toEqual([SIG]);
    expect(t.calls).toHaveLength(0);
    t.failExtent();
    await tick();
    // The view's own request, not the overview's.
    expect(t.calls.map((c) => c.request)).toEqual([req("0", FULL, 257)]);
    expect(loader.get("a1")?.status).toBe("loading");
    t.calls[0]?.answer();
    await tick();
    expect(loader.get("a1")?.status).toBe("complete");
    // After that complete view the extent is asked again.
    expect(t.asked).toEqual([SIG, SIG]);
    loader.dispose();
  });

  it("requests the run the overview cannot answer", async () => {
    const t = wave(DENSE_FIXTURE);
    const loader = t.make();
    loader.update([open(257)]);
    await t.drain();
    await tick(150);
    expect(loader.get("a1")?.status).toBe("complete");
    const before = t.calls.length;

    // The next 2^32 ns hold no points: the overview (extent 0 … 2^32 − 1) cannot answer them.
    loader.update([open(257, "8589934592", FULL)]);
    await tick();
    expect(t.calls.slice(before).map((c) => c.request)).toEqual([req(FULL, "8589934592", 257)]);
    await t.drain();
    expect(t.calls).toHaveLength(before + 1);
    expect(loader.get("a1")).toMatchObject({ status: "complete", result: { from: FULL } });
    loader.dispose();
  });

  it("zooms out above the overview without a request", async () => {
    const t = wave(DENSE_FIXTURE);
    const loader = t.make();
    loader.update([open(257)]);
    await t.drain();
    await tick(150);
    expect(loader.get("a1")?.status).toBe("complete");
    const before = t.calls.length;

    // [−2^32, 2^33) at target 257 is level 25: three levels above the overview's 22.
    const zoomed = open(257, "8589934592", "-4294967296");
    loader.update([zoomed]);
    expect(t.calls).toHaveLength(before); // no series request
    expect(loader.get("a1")?.status).toBe("complete"); // within the update call
    expect(loader.get("a1")?.placeholder).toBeUndefined();
    expectSameSeries(loader.get("a1")?.result, await withoutOptions(DENSE_FIXTURE.points, zoomed));
    loader.dispose();
  });

  it("opens on the extent with one series request per signal", async () => {
    for (const [name, fixture] of OPENS) {
      for (const target of TARGETS) {
        const label = `${name} at target ${target}`;
        const t = wave(fixture, "auto", { prefetch: true });
        const loader = t.make();
        loader.update([open(target)]);
        expect(t.events, `${label}: within the update`).toEqual([`extent ${SIG}`]);
        await t.rest(2000);
        expect(t.asked, `${label}: extent requests`).toEqual([SIG]);
        expect(
          t.calls.map((c) => c.request),
          `${label}: series requests`,
        ).toEqual([openRequest(name, target)]);
        expect(t.events[0], `${label}: the extent first`).toBe(`extent ${SIG}`);
        expect(loader.get("a1")?.status, label).toBe("complete");
        expect(loader.get("a1")?.error, label).toBeUndefined();
        if (name === "DENSE" && target === 257) {
          // Buckets of 2^24 computed from the level-22 overview.
          expect(loader.get("a1")?.result).toMatchObject({ kind: "buckets", width: "16777216" });
        }
        loader.dispose();
      }
    }
  });

  it("draws on open what a loader without overview draws", async () => {
    for (const [name, fixture] of OPENS) {
      for (const target of TARGETS) {
        const label = `${name} at target ${target}`;
        const request = open(target);
        const t = wave(fixture, "auto", { prefetch: true });
        const loader = t.make();
        loader.update([request]);
        await t.rest(2000);
        expect(loader.get("a1")?.status, label).toBe("complete");
        expectSameSeries(
          loader.get("a1")?.result,
          await withoutOptions(fixture.points, request),
          label,
        );
        loader.dispose();
      }
    }
  });

  it("steps to a session the view spans with one series request", async () => {
    const t = wave(STEP_FIXTURE, "auto", { prefetch: true });
    const loader = t.make();
    loader.update([open(257)]);
    await t.rest(1000);
    expect(loader.get("a1")?.status).toBe("complete");
    const before = t.calls.length;
    expect(t.asked).toEqual([SIG]);

    // The step: a new scope with its extent, the same points shifted by 2^33 ns.
    t.setExtent(STEP_FIXTURE.second);
    loader.rescope();
    const next = open(257, "12884901888", "8589934592");
    loader.update([next]);
    expect(t.asked).toEqual([SIG, SIG]); // the extent once more, within the update
    expect(t.calls).toHaveLength(before); // no series request yet
    await t.rest(2000);
    expect(t.asked).toEqual([SIG, SIG]);
    expect(t.calls.slice(before).map((c) => c.request)).toEqual([
      req("8589934592", "12884901888", 1025),
    ]);
    expect(loader.get("a1")?.status).toBe("complete");
    expectSameSeries(loader.get("a1")?.result, await withoutOptions(STEP_FIXTURE.points, next));
    loader.dispose();
  });

  it("steps to a narrower view: view first, overview after it", async () => {
    const t = wave(STEP_FIXTURE);
    const loader = t.make();
    loader.update([open(257)]);
    await t.drain();
    await tick(150);
    expect(loader.get("a1")?.status).toBe("complete");
    const before = t.calls.length;

    t.setExtent(STEP_FIXTURE.second);
    loader.rescope();
    // 2^28 ns inside the new session: level 20, tile 32; the overview's level is 22.
    loader.update([open(257, "8858370048", "8589934592")]);
    expect(t.asked).toEqual([SIG, SIG]);
    await tick();
    expect(t.calls.slice(before).map((c) => c.request)).toEqual([
      req("8589934592", "8858370048", 257),
    ]);
    await tick(300);
    expect(t.calls).toHaveLength(before + 1); // the overview waits for the view
    t.calls[before]?.answer();
    await tick();
    expect(t.calls.slice(before).map((c) => c.request)).toEqual([
      req("8589934592", "8858370048", 257),
      req("8589934592", "12884901888", 1025),
    ]);
    await t.drain();
    expect(loader.get("a1")?.status).toBe("complete");
    loader.dispose();
  });

  it("fetches the serving overview as a visible load", async () => {
    const t = wave(DENSE_FIXTURE);
    const quiet = (promises: Promise<unknown>[]) => {
      for (const p of promises) p.catch(() => {});
    };
    // Two prefetch runs hold both slots, a third waits in the queue.
    quiet(t.cache.load("pf1", SIG, 10, [1000n], "prefetch"));
    quiet(t.cache.load("pf2", SIG, 10, [2000n], "prefetch"));
    quiet(t.cache.load("pf3", SIG, 10, [3000n], "prefetch"));
    expect(t.calls).toHaveLength(2);
    expect(t.cache.queuedPrefetch).toBe(1);

    const loader = t.make();
    loader.update([open(257)]);
    await tick();
    expect(t.calls).toHaveLength(3); // the overview did not wait for a slot
    expect(t.calls[2]?.request).toEqual(req("0", FULL, 1025));
    expect(t.cache.visibleInFlight).toBe(1);
    expect(t.cache.queuedPrefetch).toBe(1); // the queued prefetch run still waits

    t.calls[2]?.answer();
    await tick();
    expect(loader.get("a1")).toMatchObject({
      status: "complete",
      result: { kind: "buckets", width: "16777216" },
    });
    loader.dispose();
    for (const owner of ["pf1", "pf2", "pf3"]) t.cache.release(owner);
  });

  it("computes the overview from a wide view's tiles", async () => {
    const t = wave(SHIFTED_FIXTURE);
    const loader = t.make();
    // Level 20 at target 4001 over the whole extent: tiles 2…17, the overview (level 22) tiles 0…4.
    const wideView = open(4001, "4831838208", "536870912");
    loader.update([wideView]);
    await t.drain();
    await tick(150);
    expect(loader.get("a1")?.status).toBe("complete");
    expect(t.calls.map((c) => c.request)).toEqual([req("536870912", "4831838208", 4097)]);

    // Tiles 1…3 are found as before (merged from the view's tiles) ...
    for (const index of [1n, 2n, 3n]) {
      expect(t.cache.find(SIG, 22, index), `overview tile ${index}`).toBeDefined();
    }
    // ... tiles 0 and 4 are computed, equal to the fake server's answers to the requests they cost.
    const asked = [
      [0n, req("0", "1073741824", 257)],
      [4n, req("4294967296", "5368709120", 257)],
    ] as const;
    for (const [index, request] of asked) {
      const expected = splitRun(fakeAnswer(SHIFTED_FIXTURE.points, request), 22, index, index)[0];
      const held = t.cache.peek(SIG, 22, index) ?? t.cache.find(SIG, 22, index);
      expect(held, `overview tile ${index}`).toBeDefined();
      expectSameSeries(held?.data, expected?.data, `overview tile ${index}`);
    }
    await tick(1000);
    expect(t.calls).toHaveLength(1);
    expectSameSeries(
      loader.get("a1")?.result,
      await withoutOptions(SHIFTED_FIXTURE.points, wideView),
    );
    loader.dispose();
  });

  it("prefetches nothing the overview answers", async () => {
    const t = wave(DENSE_FIXTURE, "auto", { prefetch: true });
    const loader = t.make();
    loader.update([open(257)]);
    await t.rest(1000); // rest 300 ms and more, every request answered
    expect(t.calls.map((c) => c.request)).toEqual([req("0", FULL, 1025)]); // the overview only
    // Level 25 tile 0 (the plan's coarser level) is answered from the cache.
    expect(t.cache.find(SIG, 25, 0n)).toBeDefined();
    expect(t.calls).toHaveLength(1);
    loader.dispose();
  });

  it("does not keep recent data computed from the overview", async () => {
    // The fixtures lie in the first seconds of 1970. The clock reads 1 h + 2.148 s, so a tile is
    // storable (C6) only when it ends by 2.148e9 ns: level 22 tiles 0 and 1, level 23 tile 0; the
    // view's level 24 tile 0 (to 2^32 ns) ends inside the last hour and is not.
    const now = () => 3_600_000 + 2148;
    const t = wave(DENSE_FIXTURE, "auto", {}, { now });
    const loader = t.make();
    const recent = open(257);
    loader.update([recent]);
    await t.drain();
    await tick(150);
    expect(loader.get("a1")?.status).toBe("complete");
    expectSameSeries(loader.get("a1")?.result, await withoutOptions(DENSE_FIXTURE.points, recent));
    expect(t.cache.storable(24, 0n)).toBe(false);
    expect(t.cache.find(SIG, 24, 0n)).toBeUndefined(); // used for the view, not kept

    // An unrelated run the overview answers, on storable tiles: computed, stored, no request.
    const before = t.calls.length;
    const storable = open(257, "2147483648");
    expect(t.cache.storable(23, 0n)).toBe(true);
    loader.update([storable]);
    expect(t.calls).toHaveLength(before);
    expect(loader.get("a1")?.status).toBe("complete"); // within the update call
    expect(t.cache.find(SIG, 23, 0n)).toBeDefined();
    expectSameSeries(
      loader.get("a1")?.result,
      await withoutOptions(DENSE_FIXTURE.points, storable),
    );

    // The recent view again: its tile was not kept, so a request goes out (not the stale overview).
    loader.update([recent]);
    await tick(150);
    expect(t.calls.slice(before).map((c) => c.request)).toEqual([req("0", FULL, 257)]);
    await t.drain();
    expect(loader.get("a1")?.status).toBe("complete");
    expectSameSeries(loader.get("a1")?.result, await withoutOptions(DENSE_FIXTURE.points, recent));
    expect(t.cache.find(SIG, 24, 0n)).toBeUndefined();
    loader.dispose();
  });

  it("computes the overview from a cached next view", async () => {
    const t = wave(DENSE_FIXTURE);
    // The next view's tiles (level 20 over the whole extent, as a neighbour preload stores them).
    const seed = t.cache.load("seed", SIG, 20, [...Array(16).keys()].map(BigInt));
    await t.drain();
    await Promise.all(seed);
    t.cache.release("seed");
    const loader = t.make();

    // A narrow first view the cache does not hold: level 19, tile 0. It loads (case C).
    loader.update([open(257, "134217728")]);
    await tick();
    expect(loader.get("a1")?.status).toBe("loading");
    const before = t.calls.length;
    expect(t.calls[before - 1]?.request).toEqual(req("0", "134217728", 257));

    // The extent is known; a gesture steps to the cached view spanning it, below the overview's level.
    const wide = open(4001);
    loader.update([wide]);
    expect(loader.get("a1")?.status).toBe("complete"); // from the cache, within the update call
    await t.rest(1000);
    // No request for the overview, not even as prefetch: the view's tiles answer it.
    expect(t.calls).toHaveLength(before);
    for (const index of [0n, 1n, 2n, 3n]) {
      expect(t.cache.find(SIG, 22, index), `overview tile ${index}`).toBeDefined();
    }
    expectSameSeries(loader.get("a1")?.result, await withoutOptions(DENSE_FIXTURE.points, wide));
    loader.dispose();
  });
});
