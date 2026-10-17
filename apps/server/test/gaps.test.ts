import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { testSource } from "./testdb.ts";

const MS = 1_000_000n;
const S = 1_000_000_000n;
const workspace = () => new WorkspaceStore({ signalExists: () => true, hasStates: () => false });

/** Stub source: one data ref `car` with the signals `Cyc` and `Odd`; counts its two gap queries. */
function stubSource() {
  const calls = { logger: 0, samples: 0, failNext: false };
  const source = {
    listSignals: async () => [
      { dataRef: "car", name: "Cyc" },
      { dataRef: "car", name: "Odd" },
    ],
    refCount: async () => 100,
    loggerGaps: async () => {
      calls.logger++;
      await new Promise((r) => setTimeout(r, 10));
      if (calls.failNext) {
        calls.failNext = false;
        throw new Error("boom");
      }
      return { gaps: [{ from: 1n * S, to: 4n * S }], last: 9n * S };
    },
    firstTimes: async (_ref: string, names: readonly string[]) => {
      calls.samples++;
      // Cyc: 1,001 rows 100 ms apart (measurable); Odd is not asked to be measured differently.
      return new Map(
        names.map((n) => [n, Array.from({ length: 1001 }, (_, i) => BigInt(i) * 100n * MS)]),
      );
    },
  } as unknown as DataSource;
  return { source, calls };
}

describe("gap info cache over HTTP", () => {
  it("computes gap info once per catalog load and drops a failure", async () => {
    const { source, calls } = stubSource();
    // The catalog loads before the app exists, so no prefetch runs for this first load.
    const catalog = new Catalog(source, async () => new Map());
    await catalog.refresh();
    const app = buildApp({ catalog, source, workspace: workspace() });
    try {
      const get = () => app.inject({ url: "/api/gaps", query: { dataRef: "car" } });
      const three = await Promise.all([get(), get()]);
      three.push(await get());
      expect(three.map((r) => r.statusCode)).toEqual([200, 200, 200]);
      expect(calls).toMatchObject({ logger: 1, samples: 1 });
      expect(three[0]?.json()).toEqual({
        dataRef: "car",
        through: (9n * S).toString(),
        logger: [{ from: (1n * S).toString(), to: (4n * S).toString() }],
        periods: {
          "car/Cyc": { ns: (100n * MS).toString(), source: "measured" },
          "car/Odd": { ns: (100n * MS).toString(), source: "measured" },
        },
      });
      expect(three[1]?.body).toBe(three[0]?.body);

      // A catalog reload computes again, once (the prefetch and the request share it).
      await new Promise((r) => setTimeout(r, 5));
      await catalog.refresh();
      expect((await get()).statusCode).toBe(200);
      expect((await get()).statusCode).toBe(200);
      expect(calls).toMatchObject({ logger: 2, samples: 2 });
    } finally {
      await app.close();
    }

    // A failure is answered 502 once and not kept: the next request computes again and succeeds.
    const second = stubSource();
    const catalog2 = new Catalog(second.source, async () => new Map());
    await catalog2.refresh();
    const app2 = buildApp({ catalog: catalog2, source: second.source, workspace: workspace() });
    try {
      second.calls.failNext = true;
      const failed = await app2.inject({ url: "/api/gaps", query: { dataRef: "car" } });
      expect(failed.statusCode).toBe(502);
      expect(failed.json().error.code).toBe("source_error");
      expect(failed.json().error.message).toContain("boom");
      const retry = await app2.inject({ url: "/api/gaps", query: { dataRef: "car" } });
      expect(retry.statusCode).toBe(200);
      expect(second.calls.logger).toBe(2);
      const again = await app2.inject({ url: "/api/gaps", query: { dataRef: "car" } });
      expect(again.statusCode).toBe(200);
      expect(second.calls.logger).toBe(2);
    } finally {
      await app2.close();
    }
  });

  it("answers 502 for a value without gap info", async () => {
    const real = testSource();
    // The real test DB, but the logger-gap query fails.
    const source = new Proxy(real, {
      get(target, key) {
        if (key === "loggerGaps") return () => Promise.reject(new Error("connect ECONNREFUSED"));
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const catalog = new Catalog(source, async () => new Map());
    await catalog.refresh();
    const app = buildApp({ catalog, source, workspace: workspace() });
    try {
      const res = await app.inject({
        url: "/api/value",
        query: { signal: "testcar/Sna_800h.SPEED", t: "2026-10-01T02:00:01.05Z" },
      });
      expect(res.statusCode).toBe(502);
      const body = res.json();
      expect(body.error.code).toBe("source_error");
      expect(body.error.signalId).toBe("testcar/Sna_800h.SPEED");
      expect(body).not.toHaveProperty("value");
    } finally {
      await app.close();
    }
  });
});

/** Stub source with a controllable row count and logger gaps; counts every query. */
function refreshSource() {
  const state = {
    count: 100,
    gaps: [{ from: 1n * S, to: 4n * S }],
    failNext: false,
    gate: undefined as Promise<void> | undefined,
  };
  const calls = { count: 0, logger: 0 };
  const source = {
    listSignals: async () => [{ dataRef: "car", name: "Cyc" }],
    refExtent: async () => undefined,
    events: async () => [],
    refCount: async () => {
      calls.count++;
      return state.count;
    },
    loggerGaps: async () => {
      calls.logger++;
      await state.gate;
      if (state.failNext) {
        state.failNext = false;
        throw new Error("boom");
      }
      return { gaps: state.gaps, last: 9n * S };
    },
    firstTimes: async (_ref: string, names: readonly string[]) =>
      new Map(names.map((n) => [n, Array.from({ length: 1001 }, (_, i) => BigInt(i) * 100n * MS)])),
  } as unknown as DataSource;
  return { source, state, calls };
}

describe("gap info follows new rows", () => {
  // 5 min (design G9 (b)); a literal so that the test does not depend on the product constant.
  const POLL_MS = 300_000;
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  const flush = async () => {
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(0);
  };

  it("recomputes gap info after new rows and keeps the old one meanwhile", async () => {
    const { source, state, calls } = refreshSource();
    const catalog = new Catalog(source, async () => new Map());
    const app = buildApp({ catalog, source, workspace: workspace() });
    const warn = vi.spyOn(app.log, "warn").mockImplementation(() => undefined);
    const loggerOf = async () => {
      const res = await app.inject({ url: "/api/gaps", query: { dataRef: "car" } });
      expect(res.statusCode).toBe(200);
      return (res.json() as { logger: { from: string; to: string }[] }).logger;
    };
    const gapAt = (from: bigint, to: bigint) => [{ from: from.toString(), to: to.toString() }];
    try {
      await app.ready();
      // The catalog loads after the app exists: the prefetch computes the gap info (count 100).
      await catalog.refresh();
      await flush();
      expect(calls.logger).toBe(1);
      expect(await loggerOf()).toEqual(gapAt(1n * S, 4n * S));

      // Nothing is polled before 5 min after the prefetch ended.
      await vi.advanceTimersByTimeAsync(POLL_MS - 1);
      expect(calls.logger).toBe(1);
      const countBefore = calls.count;

      // Poll 2, the count is still 100: one count query, no logger-gap query.
      await vi.advanceTimersByTimeAsync(1);
      await flush();
      expect(calls.count).toBe(countBefore + 1);
      expect(calls.logger).toBe(1);
      expect(await loggerOf()).toEqual(gapAt(1n * S, 4n * S));

      // Poll 3: the count is 101 and the gaps change; the recompute is held open.
      state.count = 101;
      state.gaps = [{ from: 5n * S, to: 8n * S }];
      let release!: () => void;
      state.gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await flush();
      expect(calls.logger).toBe(2);
      // A request during the recompute gets the old info, not a wait and not an error.
      expect(await loggerOf()).toEqual(gapAt(1n * S, 4n * S));
      release();
      state.gate = undefined;
      await flush();
      // Requests after it get the new info.
      expect(await loggerOf()).toEqual(gapAt(5n * S, 8n * S));
      expect(calls.logger).toBe(2);

      // Count 102, the next recompute fails: the previous info is served (200), a warning is logged.
      state.count = 102;
      state.gaps = [{ from: 9n * S, to: 12n * S }];
      state.failNext = true;
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await flush();
      expect(calls.logger).toBe(3);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("boom"));
      expect(await loggerOf()).toEqual(gapAt(5n * S, 8n * S));

      // The failed recompute did not keep its count: the next poll computes again and succeeds.
      await vi.advanceTimersByTimeAsync(POLL_MS);
      await flush();
      expect(calls.logger).toBe(4);
      expect(await loggerOf()).toEqual(gapAt(9n * S, 12n * S));
    } finally {
      await app.close();
    }
  });
});
