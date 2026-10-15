import { describe, expect, it } from "vitest";
import { SeriesCache } from "../src/chart/cache.ts";
import { type FakePoint, fakeFetch, flush } from "./fakeSeries.ts";

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
});
