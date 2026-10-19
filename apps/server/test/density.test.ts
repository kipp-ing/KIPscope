import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { DensityCache } from "../src/density.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { memoryAdapter, scopeApp } from "./scopeApp.ts";

const MS = 1_000_000n;

/** Fake source: 3 rows at 0, 5 and 5 ms; counts its density queries. */
function fakeSource() {
  const calls = { extent: 0, buckets: 0, failNext: false };
  const source = {
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
    refBuckets: async (_ref: string, _width: bigint, times: boolean) => {
      calls.buckets++;
      // The density asks for counts only: row times would cost +25 % on carserver.
      expect(times).toBe(false);
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
      refBuckets: async (_ref: string, width: bigint, times: boolean) => {
        expect(times).toBe(false);
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

describe("DensityCache with a scope (add-scope Z9)", () => {
  // 2026-10-01T01:00:00Z and 02:00:00Z in ns, by hand.
  const T1 = 1790816400000000000n;
  const T2 = 1790820000000000000n;
  const scope = { dataRef: "testcar", from: T1, to: T2 };

  /** A source that records the scope of each query; rows at T1 + 10 s (2) and T1 + 31 min (1). */
  function scopedSource() {
    const calls: { method: string; scope: unknown }[] = [];
    const source = {
      refExtent: async (_ref: string, s?: unknown) => {
        calls.push({ method: "refExtent", scope: s });
        return { count: 3, first: 0n, last: 5n * MS };
      },
      refBuckets: async (_ref: string, width: bigint, times: boolean, s?: unknown) => {
        calls.push({ method: "refBuckets", scope: s });
        expect(times).toBe(false);
        // Grid buckets (width / 400): one at T1 + 10 s and one 31 min in.
        const grid = width / 400n;
        const at = (t: bigint) => t - (t % grid);
        return [
          { start: at(T1 + 10_000_000_000n), count: 2 },
          { start: at(T1 + 31n * 60n * 1_000_000_000n), count: 1 },
        ];
      },
    } as unknown as DataSource;
    return { source, calls };
  }

  it("computes a scope's density from one bucket query", async () => {
    const { source, calls } = scopedSource();
    let loadedAt = new Date(1000);
    const cache = new DensityCache(source, () => loadedAt);
    const [a, b] = await Promise.all([cache.get("testcar", scope), cache.get("testcar", scope)]);
    expect(await cache.get("testcar", scope)).toBe(a);
    expect(b).toBe(a);
    // One refBuckets with the scope and no refExtent at all.
    expect(calls).toEqual([{ method: "refBuckets", scope }]);

    // The bars span the whole scope, empty stretches included: first = from, last = to - 1 ns.
    expect(a?.first).toBe(T1.toString());
    expect(a?.last).toBe((T2 - 1n).toString());
    expect(a?.scope).toEqual({ from: T1.toString(), to: T2.toString() });
    // 1 h: width 30 s (15 s would need 240 bars, over the limit of 200), 120 bars.
    expect(a?.width).toBe("30000000000");
    expect(a?.counts).toHaveLength(120);
    expect(a?.counts.reduce((x, y) => x + y, 0)).toBe(3);
    // The rows at 10 s (two) and at 31 min land in bars 0 and 62 (31 min / 30 s); the rest is empty.
    expect(a?.counts[0]).toBe(2);
    expect(a?.counts[62]).toBe(1);

    // Another scope has its own entry; an unscoped request has its own, with the old two queries.
    await cache.get("testcar", { ...scope, to: T2 - 60n * 1_000_000_000n });
    expect(calls.filter((c) => c.method === "refBuckets")).toHaveLength(2);
    await cache.get("testcar");
    expect(calls.map((c) => c.method)).toEqual([
      "refBuckets",
      "refBuckets",
      "refExtent",
      "refBuckets",
    ]);

    // It is computed again after that scope's list loads again (a new loadedAt).
    loadedAt = new Date(2000);
    await cache.get("testcar", scope);
    expect(calls.filter((c) => c.method === "refBuckets" && c.scope === scope)).toHaveLength(2);
  });

  it("computes a scope's density from one bucket query over HTTP", async () => {
    const adapter = memoryAdapter([
      { dataRef: "testcar", name: "S", rows: [[T1 + 10_000_000_000n, 1]] },
      { dataRef: "othercar", name: "S", rows: [[T1 + 10_000_000_000n, 1]] },
    ]);
    const t = await scopeApp({ adapter });
    try {
      const start = t.calls.length;
      const set = await t.command({
        type: "scope.set",
        dataRef: "testcar",
        from: T1.toString(),
        to: T2.toString(),
      });
      expect(set.status).toBe(200);
      const first = await t.get("/api/density?dataRef=testcar");
      const second = await t.get("/api/density?dataRef=testcar");
      expect(first.status).toBe(200);
      expect(second.text).toBe(first.text);
      // Let the scope's own prefetch finish too: it shares the one computation.
      await new Promise((resolve) => setTimeout(resolve, 300));
      const calls = t.calls.slice(start);
      expect(calls.filter((c) => c.method === "refExtent")).toEqual([]);
      const buckets = calls.filter((c) => c.method === "refBuckets");
      expect(buckets).toHaveLength(1);
      expect(buckets[0]?.args[3]).toEqual(scope);
    } finally {
      await t.close();
    }
  });
});
