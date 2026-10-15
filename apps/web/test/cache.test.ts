import { describe, expect, it } from "vitest";
import { SeriesCache } from "../src/chart/cache.ts";
import { densePoints, type FakePoint, fakeFetch, flush } from "./fakeSeries.ts";

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
});
