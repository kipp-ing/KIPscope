import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { DensityCache } from "../src/density.ts";
import { WorkspaceStore } from "../src/workspace.ts";

const MS = 1_000_000n;

/** Fake source: 3 rows at 0, 5 and 5 ms; counts its density queries. */
function fakeSource() {
  const calls = { extent: 0, buckets: 0, failNext: false };
  const source = {
    textSignals: async () => [],
    listSignals: async () => [{ dataRef: "testcar", name: "S" }],
    refExtent: async () => {
      calls.extent++;
      await new Promise((r) => setTimeout(r, 10));
      if (calls.failNext) {
        calls.failNext = false;
        throw new Error("boom");
      }
      return { count: 3, first: 0n, last: 5n * MS };
    },
    refBuckets: async () => {
      calls.buckets++;
      return [
        { start: 0n, count: 1 },
        { start: 5n * MS, count: 2 },
      ];
    },
  } as unknown as DataSource;
  return { source, calls };
}

const queries = (c: { extent: number; buckets: number }) => c.extent + c.buckets;

describe("DensityCache grid", () => {
  it("groups on the grid and sums the bars", async () => {
    const widths: bigint[] = [];
    const MIN = 60n * 1_000_000_000n;
    const first = 1_790_812_800_000_000_000n; // 2026-10-01T00:00:00Z
    const last = first + 600n * MIN; // 10 h later
    const source = {
      refExtent: async () => ({ count: 6, first, last }),
      // Grid buckets of 1.5 s: three in the first 10 min bar, one in the second, one after the
      // extent's last bar (left out), one before the first bar (left out).
      refBuckets: async (_ref: string, width: bigint) => {
        widths.push(width);
        return [
          { start: first, count: 1 },
          { start: first + 1_500_000_000n, count: 2 },
          { start: first + 9n * MIN, count: 4 },
          { start: first + 10n * MIN, count: 8 },
          { start: last + 10n * MIN, count: 16 },
          { start: first - 10n * MIN, count: 32 },
        ];
      },
    } as unknown as DataSource;
    const cache = new DensityCache(source, () => new Date(1));
    const d = await cache.get("testcar");
    expect(widths).toEqual([1_500_000_000n]); // the grid, not the 10 min bars
    expect(d?.width).toBe("600000000000");
    expect(d?.grid).toBe("1500000000");
    expect(d?.counts).toHaveLength(61);
    expect(d?.counts[0]).toBe(7); // 1 + 2 + 4
    expect(d?.counts[1]).toBe(8);
    expect(d?.counts.reduce((a, b) => a + b, 0)).toBe(15); // the two outside buckets are left out
  });
});

describe("DensityCache", () => {
  it("computes once per catalog load, shares and does not cache failures", async () => {
    const { source, calls } = fakeSource();
    let loadedAt: Date | undefined = new Date(1000);
    const cache = new DensityCache(source, () => loadedAt);

    // Three at once share one computation (two queries); one more later is served from the cache.
    const [a, b, c] = await Promise.all([
      cache.get("testcar"),
      cache.get("testcar"),
      cache.get("testcar"),
    ]);
    const d = await cache.get("testcar");
    expect(queries(calls)).toBe(2);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(d).toEqual(a);
    expect(a).toEqual({
      dataRef: "testcar",
      first: "0",
      last: "5000000",
      width: "1000000",
      start: "0",
      counts: [1, 0, 0, 0, 0, 2],
      grid: "2500", // 1 ms / 400
      drives: [], // two runs of one 2.5 us bucket
    });

    // A catalog reload computes again, once.
    loadedAt = new Date(2000);
    await Promise.all([cache.get("testcar"), cache.get("testcar")]);
    await cache.get("testcar");
    expect(queries(calls)).toBe(4);

    // Another data ref has its own entry.
    await cache.get("othercar");
    expect(queries(calls)).toBe(6);

    // A failure is passed on to everyone waiting and then dropped: the next request asks again.
    loadedAt = new Date(3000);
    calls.failNext = true;
    const before = queries(calls);
    const results = await Promise.allSettled([cache.get("testcar"), cache.get("testcar")]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(queries(calls)).toBe(before + 1); // extent only: it failed before the bucket query
    const again = await cache.get("testcar");
    expect(again?.counts).toEqual([1, 0, 0, 0, 0, 2]);
    expect(queries(calls)).toBe(before + 3);
  });

  it("caches a data ref without rows like a result", async () => {
    let extents = 0;
    const source = {
      refExtent: async () => {
        extents++;
        return undefined;
      },
      refBuckets: async () => [],
    } as unknown as DataSource;
    const loadedAt = new Date(1);
    const cache = new DensityCache(source, () => loadedAt);
    expect(await cache.get("empty")).toBeUndefined();
    expect(await cache.get("empty")).toBeUndefined();
    expect(extents).toBe(1);
  });
});

describe("GET /api/density cache over HTTP", () => {
  it("computes once per catalog load: three at once, one more, refresh, one more", async () => {
    const { source, calls } = fakeSource();
    const catalog = new Catalog(source, async () => new Map());
    await catalog.refresh();
    const app = buildApp({
      catalog,
      source,
      workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
    });
    try {
      const get = () => app.inject({ url: "/api/density", query: { dataRef: "testcar" } });
      const three = await Promise.all([get(), get(), get()]);
      const fourth = await get();
      expect(queries(calls)).toBe(2);
      for (const res of [...three, fourth]) {
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe(three[0]?.body);
      }

      await new Promise((r) => setTimeout(r, 5));
      await catalog.refresh();
      const after = await get();
      expect(after.statusCode).toBe(200);
      expect(queries(calls)).toBe(4);

      // A failing first computation is not cached: a second request queries again.
      await new Promise((r) => setTimeout(r, 5));
      await catalog.refresh();
      calls.failNext = true;
      const failed = await get();
      expect(failed.statusCode).toBe(502);
      const before = queries(calls);
      const retry = await get();
      expect(retry.statusCode).toBe(200);
      expect(queries(calls)).toBe(before + 2);
    } finally {
      await app.close();
    }
  });
});
