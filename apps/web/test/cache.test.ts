import { describe, expect, it } from "vitest";
import { SeriesCache } from "../src/chart/cache.ts";
import { runRequest } from "../src/chart/tiles.ts";
import {
  densePoints,
  expectSameSeries,
  type FakePoint,
  fakeAnswer,
  fakeFetch,
  flush,
} from "./fakeSeries.ts";

const SIG = "c/s";
const OLD_NOW = () => 1_000_000_000_000_000; // ms: every tile of these tests lies long before it

// Level 0 tiles span 256 ns; one point in each of tiles 0 to 3.
const POINTS: FakePoint[] = [100n, 356n, 612n, 868n].map((t, i) => ({ t, v: i }));

describe("SeriesCache", () => {
  it("drops the least recently used tile first", async () => {
    const { fetch, calls } = fakeFetch(POINTS);
    // Tiles 1 and 2 weigh 16 + 2 × 3 = 22 each (the point plus both neighbours), tile 3 weighs
    // 16 + 2 × 2 = 20 (no point after it). The limit holds two of them.
    const cache = new SeriesCache(fetch, { limit: 44, now: OLD_NOW });
    const store = async (index: bigint) => {
      const [tile] = cache.load("o", SIG, 0, [index]);
      calls.at(-1)?.answer();
      await tile;
    };
    await store(1n); // A
    await store(2n); // B
    expect(cache.size).toBe(44);
    expect(cache.find(SIG, 0, 1n)).toBeDefined(); // use A
    await store(3n); // C
    expect(cache.peek(SIG, 0, 2n)).toBeUndefined();
    expect(cache.peek(SIG, 0, 1n)).toBeDefined();
    expect(cache.peek(SIG, 0, 3n)).toBeDefined();
    expect(cache.size).toBe(22 + 20);
  });

  it("aborts a run only when nobody wants it", async () => {
    const { fetch, calls } = fakeFetch(POINTS);
    const cache = new SeriesCache(fetch, { now: OLD_NOW });
    const settle = (p: Promise<unknown>) =>
      p.then(
        () => "ok",
        () => "rejected",
      );

    // Two owners share one run; the first one leaves, the run goes on.
    const a1 = cache.load("o1", SIG, 0, [1n]);
    const a2 = cache.load("o2", SIG, 0, [1n]);
    expect(calls).toHaveLength(1);
    cache.release("o1");
    expect(calls[0]?.abort.aborted).toBe(false);
    calls[0]?.answer();
    expect(await Promise.all([...a1, ...a2].map(settle))).toEqual(["ok", "ok"]);
    expect(cache.peek(SIG, 0, 1n)).toBeDefined();

    // Both leave, the run is aborted and its tile is not stored.
    const b1 = cache.load("o1", SIG, 0, [2n]);
    const b2 = cache.load("o2", SIG, 0, [2n]);
    expect(calls).toHaveLength(2);
    cache.release("o1");
    cache.release("o2");
    expect(calls[1]?.abort.aborted).toBe(true);
    calls[1]?.answer(); // a late answer of the aborted run
    await flush();
    expect(await Promise.all([...b1, ...b2].map(settle))).toEqual(["rejected", "rejected"]);
    expect(cache.peek(SIG, 0, 2n)).toBeUndefined();
  });

  it("does not store tiles that end within the last hour", async () => {
    const nowMs = 1_700_000_000_000;
    const nowNs = BigInt(nowMs) * 1_000_000n;
    const span = 256n * 2n ** 20n; // level 20
    const tileEndingBefore = (ns: bigint) => (nowNs - ns) / span - 1n; // index whose end <= now − ns
    const recent = tileEndingBefore(30n * 60n * 1_000_000_000n); // ends about 30 min ago
    const old = tileEndingBefore(3n * 3600n * 1_000_000_000n); // ends about 3 h ago
    const points: FakePoint[] = [recent, old].map((j) => ({ t: j * span + 5n, v: 1 }));
    const { fetch, calls } = fakeFetch(points);
    const cache = new SeriesCache(fetch, { now: () => nowMs });

    const [first] = cache.load("o", SIG, 20, [recent]);
    expect(calls[0]?.request).toEqual({
      signalId: SIG,
      from: (recent * span).toString(),
      to: ((recent + 1n) * span).toString(),
      target: 257,
    });
    calls[0]?.answer();
    expect(await first).toMatchObject({ level: 20, index: recent }); // the view gets it
    expect(cache.peek(SIG, 20, recent)).toBeUndefined(); // but it is not kept
    cache.load("o", SIG, 20, [recent]);
    expect(calls).toHaveLength(2); // the next view asks again

    const [older] = cache.load("o", SIG, 20, [old]);
    calls[2]?.answer();
    await older;
    expect(cache.peek(SIG, 20, old)).toBeDefined(); // old data is kept
  });

  it("finds a tile merged from cached children, at most two levels down", async () => {
    // Eight level-10 tiles (span 262,144 ns) from one run of 2,300 points: buckets of 1,024 ns.
    const { fetch, calls } = fakeFetch(densePoints(2300, 900n, 50n));
    const cache = new SeriesCache(fetch, { now: OLD_NOW });
    const tiles = cache.load("o", SIG, 10, [0n, 1n, 2n, 3n, 4n, 5n, 6n, 7n]);
    expect(calls).toHaveLength(1);
    calls[0]?.answer();
    await Promise.all(tiles);

    const l11 = cache.find(SIG, 11, 0n);
    const l12 = cache.find(SIG, 12, 0n);
    expect(l11).toMatchObject({ level: 11, index: 0n });
    expect(l12).toMatchObject({ level: 12, index: 0n });
    expect(cache.find(SIG, 13, 0n)).toBeUndefined(); // three levels down: too deep
    expect(calls).toHaveLength(1); // no fetch
    expect(cache.peek(SIG, 11, 0n)).toBeUndefined(); // merged tiles are not stored
    expect(cache.peek(SIG, 12, 0n)).toBeUndefined();
  });

  it("does not merge when one child is missing", async () => {
    const { fetch, calls } = fakeFetch(densePoints(600, 900n, 50n));
    const cache = new SeriesCache(fetch, { now: OLD_NOW });
    const [t] = cache.load("o", SIG, 10, [0n]); // only the left child of level-11 tile 0
    calls[0]?.answer();
    await t;
    expect(cache.find(SIG, 11, 0n)).toBeUndefined();
  });

  describe("prefetch priority", () => {
    const S10 = 262144n;
    const quiet = (promises: Promise<unknown>[]) =>
      promises.map((p) =>
        p.then(
          () => "ok",
          () => "rejected",
        ),
      );

    it("runs at most two prefetch requests at once, visible loads first", async () => {
      const { fetch, calls } = fakeFetch(POINTS);
      const cache = new SeriesCache(fetch, { now: OLD_NOW });
      for (const i of [0n, 2n, 4n, 6n]) quiet(cache.load("p", SIG, 10, [i], "prefetch"));
      expect(calls.map((c) => c.request.from)).toEqual(["0", String(2n * S10)]);
      expect(cache.queuedPrefetch).toBe(2);

      const [visible] = cache.load("v", SIG, 10, [10n]); // default priority "visible"
      expect(calls).toHaveLength(3); // starts at once, third call
      expect(calls[2]?.request.from).toBe(String(10n * S10));

      calls[0]?.answer(); // one prefetch run answers
      await flush();
      expect(calls).toHaveLength(4);
      expect(calls[3]?.request.from).toBe(String(4n * S10)); // FIFO: tile 4 before tile 6
      expect(cache.queuedPrefetch).toBe(1);
      calls[2]?.answer();
      await visible;
    });

    it("starts a queued prefetch run at once when a visible load wants it", async () => {
      const { fetch, calls } = fakeFetch(POINTS);
      const cache = new SeriesCache(fetch, { now: OLD_NOW });
      for (const i of [0n, 2n, 4n]) quiet(cache.load("p", SIG, 10, [i], "prefetch"));
      expect(calls).toHaveLength(2);
      expect(cache.queuedPrefetch).toBe(1); // tile 4 waits

      const [visible] = cache.load("v", SIG, 10, [4n]);
      expect(calls).toHaveLength(3);
      expect(calls[2]?.request.from).toBe(String(4n * S10));
      expect(cache.queuedPrefetch).toBe(0);
      calls[2]?.answer();
      expect(await visible).toMatchObject({ level: 10, index: 4n });

      // It no longer counts as prefetch: two other prefetch runs are still in flight, so a new one waits.
      quiet(cache.load("p", SIG, 10, [6n], "prefetch"));
      expect(calls).toHaveLength(3);
      expect(cache.queuedPrefetch).toBe(1);
    });

    it("drops a queued prefetch run nobody wants", async () => {
      const { fetch, calls } = fakeFetch(POINTS);
      const cache = new SeriesCache(fetch, { now: OLD_NOW });
      quiet(cache.load("p", SIG, 10, [0n], "prefetch"));
      quiet(cache.load("p", SIG, 10, [2n], "prefetch"));
      const [queued] = quiet(cache.load("q", SIG, 10, [4n], "prefetch"));
      expect(cache.queuedPrefetch).toBe(1);

      cache.release("q");
      expect(cache.queuedPrefetch).toBe(0);
      expect(await queued).toBe("rejected");

      calls[0]?.answer(); // a slot frees up, the dropped run must not take it
      await flush();
      expect(calls).toHaveLength(2);
      expect(cache.peek(SIG, 10, 4n)).toBeUndefined();

      cache.release("p"); // running ones are aborted as before
      expect(calls[1]?.abort.aborted).toBe(true);
    });
  });

  describe("recovery signal", () => {
    it("notifies recovery listeners after a successful answer, not after a failure", async () => {
      const { fetch, calls } = fakeFetch(POINTS);
      const cache = new SeriesCache(fetch, { now: OLD_NOW });
      let notified = 0;
      const off = cache.onRecover(() => notified++);

      const [failing] = cache.load("o", SIG, 0, [1n]);
      calls[0]?.fail(new Error("source_error: timeout"));
      await failing?.catch(() => {});
      await flush();
      expect(notified).toBe(0);

      const tiles = cache.load("o", SIG, 0, [1n, 2n]); // one run, one answer
      expect(calls).toHaveLength(2);
      calls[1]?.answer();
      await Promise.all(tiles);
      await flush();
      expect(notified).toBe(1);

      off();
      const [later] = cache.load("o", SIG, 0, [3n]);
      calls[2]?.answer();
      await later;
      await flush();
      expect(notified).toBe(1);
    });

    it("notifies recovery listeners on recover()", async () => {
      const { fetch } = fakeFetch(POINTS);
      const cache = new SeriesCache(fetch, { now: OLD_NOW });
      let notified = 0;
      const off = cache.onRecover(() => notified++);
      cache.recover();
      await flush();
      expect(notified).toBe(1);
      off();
      cache.recover();
      await flush();
      expect(notified).toBe(1);
    });
  });
});

describe("SeriesCache across scopes (add-case-open)", () => {
  const S = 262144n; // tile span of level 10 (width 1024 ns)
  const sig = "c/s"; // data ref "c"
  const scope = (from: bigint, to: bigint) => ({
    dataRef: "c",
    from: String(from),
    to: String(to),
  });
  /** Ten raw points in each of the level-10 tiles `from` … `to`. */
  const tiles = (from: number, to: number): FakePoint[] =>
    Array.from({ length: to - from + 1 }, (_, k) =>
      Array.from({ length: 10 }, (_, i) => ({
        t: BigInt(from + k) * S + 1000n * BigInt(i) + 500n,
        v: (from + k) * 100 + i,
      })),
    ).flat();

  it("keeps tiles across scopes", async () => {
    const { fetch, calls } = fakeFetch(tiles(0, 130));
    const cache = new SeriesCache(fetch, { now: OLD_NOW });
    // Entry 0's scope [10 S, 20 S), entry 2's scope [100 S, 110 S): two sessions of one vehicle.
    const first = scope(10n * S, 20n * S);
    const second = scope(100n * S, 110n * S);

    cache.setScope(first);
    const load = cache.load("w", sig, 10, [12n, 13n]);
    expect(calls).toHaveLength(1);
    calls[0]?.answer();
    const drawn = await Promise.all(load);
    expect(cache.find(sig, 10, 12n)).toBeDefined();

    // The scope changes: nothing is cleared; the other session loads its own tiles.
    cache.setScope(second);
    expect(cache.peek(sig, 10, 12n)).toBeDefined();
    expect(cache.find(sig, 10, 12n)).toBeUndefined(); // outside the new scope
    const other = cache.load("w", sig, 10, [105n]);
    expect(calls).toHaveLength(2);
    calls[1]?.answer();
    await Promise.all(other);

    // Back to the first scope: the same window asks the same tiles and gets them from memory.
    cache.setScope(first);
    const again = [12n, 13n].map((i) => cache.find(sig, 10, i));
    expect(again.every((t) => t !== undefined)).toBe(true);
    expect(again.map((t) => t?.data)).toEqual(drawn.map((t) => t.data));
    expect(calls).toHaveLength(2); // no third fetch
  });

  /**
   * Asks the tiles as a window does: what `find` answers is used, the rest is loaded (and answered
   * by the fake server). Returns the first index of each run the cache fetched.
   */
  async function ask(
    cache: SeriesCache,
    calls: { request: { from: string }; answer: () => void }[],
    indices: bigint[],
  ): Promise<bigint[]> {
    const before = calls.length;
    const missing = indices.filter((i) => cache.find(sig, 10, i) === undefined);
    const loading = cache.load("w", sig, 10, missing);
    const fetched = calls.slice(before);
    for (const call of fetched) call.answer();
    await Promise.all(loading);
    return fetched.map((call) => BigInt(call.request.from) / S);
  }

  // Scope A [1.5 S, 3.5 S): tile 1 and tile 3 stick out on one side, tile 2 lies inside.
  const A = scope(S + S / 2n, 3n * S + S / 2n);
  /** A scope that cuts the same three tiles at both ends again. */
  const shifted = (by: bigint) => scope(S + S / 2n + by, 3n * S + S / 2n + by);

  it("stores edge tiles under the scope that fetched them", async () => {
    const { fetch, calls } = fakeFetch(tiles(0, 5));
    const cache = new SeriesCache(fetch, { now: OLD_NOW });
    cache.setScope(A);
    expect(await ask(cache, calls, [1n, 2n, 3n])).toEqual([1n]); // one run for the three tiles
    expect(calls).toHaveLength(1);
    // The same three tiles under A again: no fetch, the window draws all of them.
    expect(await ask(cache, calls, [1n, 2n, 3n])).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(cache.find(sig, 10, 1n)).toBeDefined();
    expect(cache.find(sig, 10, 3n)).toBeDefined();

    // The middle tile is stored for every scope, the outer ones under A's key only: even a scope
    // holding all three tiles asks the two edge tiles again.
    cache.setScope(scope(0n, 6n * S));
    expect(cache.find(sig, 10, 2n)).toBeDefined();
    expect(cache.find(sig, 10, 1n)).toBeUndefined();
    expect(cache.find(sig, 10, 3n)).toBeUndefined();
  });

  it("weighs edge tiles in the tile limit and drops them with the memory LRU", async () => {
    const weigh = async (limit?: number) => {
      const { fetch, calls } = fakeFetch(tiles(0, 5));
      const cache = new SeriesCache(fetch, { now: OLD_NOW, ...(limit && { limit }) });
      cache.setScope(A);
      await ask(cache, calls, [1n, 2n, 3n]);
      return { cache, calls };
    };
    const full = await weigh();
    expect(full.cache.size).toBeGreaterThan(0);
    // A limit one unit short of the three tiles: the least recently used one (the edge tile
    // stored first) goes, the other two stay.
    const tight = await weigh(full.cache.size - 1);
    expect(tight.cache.size).toBeLessThan(full.cache.size);
    expect(await ask(tight.cache, tight.calls, [1n, 2n, 3n])).toEqual([1n]);
  });

  it("uses an edge tile only in the scope that fetched it", async () => {
    const { fetch, calls } = fakeFetch(tiles(0, 5));
    const cache = new SeriesCache(fetch, { now: OLD_NOW });
    cache.setScope(A);
    await ask(cache, calls, [1n, 2n, 3n]);

    // B cuts the same tiles at both ends again: the middle tile comes from memory, the outer ones
    // are fetched (two runs, tile 1 and tile 3).
    cache.setScope(shifted(1000n));
    expect(await ask(cache, calls, [1n, 2n, 3n])).toEqual([1n, 3n]);
    // Back under A: nothing is fetched, B's edge tiles did not replace A's.
    cache.setScope(A);
    expect(await ask(cache, calls, [1n, 2n, 3n])).toEqual([]);

    // B, C, D, E (four keys other than A's) are entered in turn: A's key leaves the LRU of 4.
    for (const by of [1000n, 2000n, 3000n, 4000n]) cache.setScope(shifted(by));
    cache.setScope(A);
    expect(await ask(cache, calls, [1n, 2n, 3n])).toEqual([1n, 3n]); // the middle tile stays
  });

  it("lets a case run touch its scope key in the LRU of four", async () => {
    const { fetch, calls } = fakeFetch(tiles(0, 5));
    const cache = new SeriesCache(fetch, { now: OLD_NOW });
    cache.setScope(A);
    await ask(cache, calls, [1n, 2n, 3n]);
    // A is the least recently used of four keys after B, C and D ...
    for (const by of [1000n, 2000n, 3000n]) cache.setScope(shifted(by));
    // ... until a preload run for the entry whose scope A it is touches the key.
    const target = { case: 3, scope: A };
    const loading = cache.load("p", sig, 10, [4n], "preload", target);
    loading.forEach((p) => void p.catch(() => {}));
    cache.setScope(shifted(4000n)); // the fifth key drops B, the least recently used, not A
    cache.setScope(A);
    expect(await ask(cache, calls, [1n, 2n, 3n])).toEqual([]);
    cache.release("p");
  });

  it("refetches a cut raw tile under a wider scope", async () => {
    // Points start in tile 2, so tile 2 has no point before it: the scope's start cut nothing, but
    // the answer cannot tell, and a wider scope may hold an earlier point.
    const { fetch, calls } = fakeFetch(tiles(2, 8));
    const cache = new SeriesCache(fetch, { now: OLD_NOW });
    const narrow = scope(2n * S, 6n * S);
    cache.setScope(narrow);
    const run = cache.load("w", sig, 10, [2n]);
    calls[0]?.answer();
    await Promise.all(run);
    expect(cache.peek(sig, 10, 2n)).toBeDefined();
    expect(cache.find(sig, 10, 2n)).toBeDefined(); // same scope: from memory

    // A scope that starts 1 h before: the tile is asked again.
    cache.setScope(scope(2n * S - 3_600_000_000_000n, 6n * S));
    expect(cache.find(sig, 10, 2n)).toBeUndefined();
    // A scope that starts where the first one did: from memory.
    cache.setScope(scope(2n * S, 8n * S));
    expect(cache.find(sig, 10, 2n)).toBeDefined();
  });

  it("drops edge points outside the asking scope", async () => {
    // One level-10 tile with the nearest points 5 s outside it on both sides.
    const index = 100_000n;
    const from = index * S;
    const to = from + S;
    const SEC = 1_000_000_000n;
    const points: FakePoint[] = [
      { t: from - 5n * SEC, v: -1 },
      { t: from + 1000n, v: 1 },
      { t: from + 2000n, v: 2 },
      { t: to + 5n * SEC, v: 3 },
    ];
    const { fetch, calls } = fakeFetch(points);
    const cache = new SeriesCache(fetch, { now: OLD_NOW });
    const around = (by: bigint) => scope(from - by, to + by);

    // Scope S reaches 6 s past the tile on both sides, so both edge points lie inside it.
    cache.setScope(around(6n * SEC));
    const run = cache.load("w", sig, 10, [index]);
    expect(calls).toHaveLength(1);
    calls[0]?.answer();
    const [loaded] = await Promise.all(run);
    if (loaded?.data.kind !== "raw") throw new Error("expected a raw tile");
    expect(loaded.data.before).toEqual({ t: String(from - 5n * SEC), v: -1 });
    expect(loaded.data.after).toEqual({ t: String(to + 5n * SEC), v: 3 });

    // S2 ends 2 s past the tile: both points lie outside it and are dropped, with no fetch.
    cache.setScope(around(2n * SEC));
    const narrow = cache.find(sig, 10, index);
    expect(narrow).toBeDefined();
    if (narrow?.data.kind !== "raw") throw new Error("expected a raw tile");
    expect(narrow.data.before).toBeUndefined();
    expect(narrow.data.after).toBeUndefined();
    expect(narrow.data.v).toEqual([1, 2]);

    // S3 reaches 10 s past it: both points lie inside, with no fetch.
    cache.setScope(around(10n * SEC));
    const wide = cache.find(sig, 10, index);
    if (wide?.data.kind !== "raw") throw new Error("expected a raw tile");
    expect(wide.data.before).toEqual(loaded.data.before);
    expect(wide.data.after).toEqual(loaded.data.after);

    // S again: the stored tile still holds both points.
    cache.setScope(around(6n * SEC));
    const again = cache.find(sig, 10, index);
    if (again?.data.kind !== "raw") throw new Error("expected a raw tile");
    expect(again.data.before).toEqual(loaded.data.before);
    expect(again.data.after).toEqual(loaded.data.after);
    expect(calls).toHaveLength(1);
  });

  it("answers no tile of another data ref than the scope's", async () => {
    const { fetch, calls } = fakeFetch(tiles(0, 5));
    const cache = new SeriesCache(fetch, { now: OLD_NOW });
    cache.setScope(scope(0n, 6n * S));
    const run = cache.load("w", "c/s", 10, [2n]);
    calls[0]?.answer();
    await Promise.all(run);
    expect(cache.find("c/s", 10, 2n)).toBeDefined();
    expect(cache.find("other/s", 10, 2n)).toBeUndefined();
  });

  it("keys runs in flight by tile and scope", async () => {
    const { fetch, calls } = fakeFetch(tiles(0, 130));
    const cache = new SeriesCache(fetch, { now: OLD_NOW });
    cache.setScope(scope(10n * S, 20n * S));
    cache.load("w", sig, 10, [12n]);
    expect(calls).toHaveLength(1);
    // The same tile asked under another scope is another run: the first one's answer never serves it.
    cache.setScope(scope(11n * S, 21n * S));
    cache.load("w", sig, 10, [12n]);
    expect(calls).toHaveLength(2);
    // The same scope again joins the run in flight.
    cache.load("v", sig, 10, [12n]);
    expect(calls).toHaveLength(2);
  });
});

describe("SeriesCache.put (single-wave-open)", () => {
  const S = 262144n; // tile span of level 10 (width 1024 ns)
  const sig = "c/s";
  const scope = (from: bigint, to: bigint) => ({
    dataRef: "c",
    from: String(from),
    to: String(to),
  });
  // Ten points spread over each level-10 tile 0 … 5: t = j × S + k × S / 10 + 1000.
  const all: FakePoint[] = Array.from({ length: 6 }, (_, j) =>
    Array.from({ length: 10 }, (_, k) => ({
      t: BigInt(j) * S + (BigInt(k) * S) / 10n + 1000n,
      v: j * 10 + k,
    })),
  ).flat();
  // Scope A [1.5 S, 3.5 S) cuts tile 1 (first half) and tile 3 (second half); tile 2 lies inside.
  const A = scope(S + S / 2n, 3n * S + S / 2n);
  // What the server answers under scope A: only the points inside it exist, edge neighbours too.
  const inA = all.filter((p) => p.t >= S + S / 2n && p.t < 3n * S + S / 2n);

  it("stores a computed run like a fetched one", async () => {
    // Fetched: the run of tiles 1…3 through load, answered under scope A.
    const fetched = fakeFetch(inA);
    const second = new SeriesCache(fetched.fetch, { now: OLD_NOW });
    second.setScope(A);
    const loading = second.load("w", sig, 10, [1n, 2n, 3n]);
    expect(fetched.calls).toHaveLength(1);
    fetched.calls[0]?.answer();
    await Promise.all(loading);

    // Computed: the same run put into a cache that has no fetch to answer.
    const computed = fakeFetch(inA);
    const first = new SeriesCache(computed.fetch, { now: OLD_NOW });
    let notified = 0;
    first.onRecover(() => notified++);
    first.setScope(A);
    const result = fakeAnswer(inA, runRequest(sig, 10, 1n, 3n));
    const put = first.put(sig, 10, 1n, 3n, result);
    await flush();
    expect(computed.calls).toHaveLength(0); // sends nothing
    expect(notified).toBe(0); // is no recovery
    expect(put.map((t) => [t.level, t.index])).toEqual([
      [10, 1n],
      [10, 2n],
      [10, 3n],
    ]);

    // Both caches answer the three tiles under A with the same data ...
    for (const index of [1n, 2n, 3n]) {
      const a = first.find(sig, 10, index);
      const b = second.find(sig, 10, index);
      expect(a, `tile ${index} put`).toBeDefined();
      expect(b, `tile ${index} fetched`).toBeDefined();
      expectSameSeries(a?.data, b?.data, `tile ${index}`);
    }
    expect(first.size).toBe(second.size);
    // ... the middle tile for every scope, the outer two as edge tiles under A's key only.
    for (const cache of [first, second]) {
      cache.setScope(scope(0n, 6n * S));
      expect(cache.find(sig, 10, 2n)).toBeDefined();
      expect(cache.find(sig, 10, 1n)).toBeUndefined();
      expect(cache.find(sig, 10, 3n)).toBeUndefined();
      cache.setScope(A);
      expect(cache.find(sig, 10, 1n)).toBeDefined();
      expect(cache.find(sig, 10, 3n)).toBeDefined();
    }

    // A tile put again replaces the stored one (same weight, not twice).
    const size = first.size;
    first.put(sig, 10, 1n, 3n, result);
    expect(first.size).toBe(size);

    // A tile ending within the last hour is returned by put, not stored (C6).
    const nowMs = 1_700_000_000_000;
    const nowNs = BigInt(nowMs) * 1_000_000n;
    const span = 256n * 2n ** 20n; // level 20
    const tileEndingBefore = (ns: bigint) => (nowNs - ns) / span - 1n;
    const recent = tileEndingBefore(30n * 60n * 1_000_000_000n);
    const old = tileEndingBefore(3n * 3600n * 1_000_000_000n);
    const points: FakePoint[] = [recent, old].map((j) => ({ t: j * span + 5n, v: 1 }));
    const { fetch, calls } = fakeFetch(points);
    const cache = new SeriesCache(fetch, { now: () => nowMs });

    const [kept] = cache.put(
      sig,
      20,
      recent,
      recent,
      fakeAnswer(points, runRequest(sig, 20, recent, recent)),
    );
    expect(kept).toMatchObject({ level: 20, index: recent });
    expect(cache.peek(sig, 20, recent)).toBeUndefined();
    const [older] = cache.put(sig, 20, old, old, fakeAnswer(points, runRequest(sig, 20, old, old)));
    expect(older).toMatchObject({ level: 20, index: old });
    expect(cache.peek(sig, 20, old)).toBeDefined();
    expect(calls).toHaveLength(0);
  });
});
