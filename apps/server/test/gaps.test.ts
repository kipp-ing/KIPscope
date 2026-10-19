import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { memoryAdapter, scopeApp } from "./scopeApp.ts";
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
      const get = () =>
        app.inject({ url: "/api/gaps", query: { dataRef: "car", signal: ["car/Cyc", "car/Odd"] } });
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
      const named = { dataRef: "car", signal: ["car/Cyc", "car/Odd"] };
      const failed = await app2.inject({ url: "/api/gaps", query: named });
      expect(failed.statusCode).toBe(502);
      expect(failed.json().error.code).toBe("source_error");
      expect(failed.json().error.message).toContain("boom");
      const retry = await app2.inject({ url: "/api/gaps", query: named });
      expect(retry.statusCode).toBe(200);
      expect(second.calls.logger).toBe(2);
      const again = await app2.inject({ url: "/api/gaps", query: named });
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

/** Lets promise callbacks and the prefetch chain run; not a timer wait. */
const settle = async () => {
  for (let i = 0; i < 20; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** A workspace holding the given windows and events-line signals (no catalog check). */
function workspaceWith(
  windows: { kind: "timeseries" | "values"; signals: string[] }[],
  eventSignals: string[] = [],
) {
  const store = new WorkspaceStore(
    { signalExists: () => true, hasStates: () => false },
    { eventSignals },
  );
  for (const w of windows) {
    const created = store.execute(
      w.kind === "timeseries"
        ? { type: "window.create", from: "0", to: "1000" }
        : { type: "window.create", kind: "values" },
    );
    if (!created.ok || created.created === undefined) throw new Error("window.create failed");
    for (const signalId of w.signals) {
      const added = store.execute({
        type: "window.addSignal",
        windowId: created.created,
        signalId,
      });
      if (!added.ok) throw new Error(`window.addSignal failed: ${signalId}`);
    }
  }
  return store;
}

describe("measured periods only for signals in use", () => {
  it("measures periods only for asked and workspace signals", async () => {
    // 2,400 signals S0001 ... S2400 of data ref `big`, none with a DBC or diag period.
    const names = Array.from({ length: 2400 }, (_, i) => `S${String(i + 1).padStart(4, "0")}`);
    const asked: string[][] = [];
    const source = {
      listSignals: async () => names.map((name) => ({ dataRef: "big", name })),
      refExtent: async () => undefined,
      events: async () => [],
      refCount: async () => 100,
      loggerGaps: async () => ({ gaps: [], last: 9n * S }),
      before: async () => undefined,
      after: async () => undefined,
      // Every asked signal has 1,001 rows 100 ms apart: measurable.
      firstTimes: async (_ref: string, requested: readonly string[]) => {
        asked.push([...requested]);
        return new Map(
          requested.map((n) => [n, Array.from({ length: 1001 }, (_, i) => BigInt(i) * 100n * MS)]),
        );
      },
    } as unknown as DataSource;
    const catalog = new Catalog(source, async () => new Map());
    const workspace = workspaceWith(
      [
        { kind: "timeseries", signals: ["big/S0001", "big/S0002"] },
        { kind: "values", signals: ["big/S0003"] },
      ],
      ["big/S0004"],
    );
    const app = buildApp({ catalog, source, workspace });
    const measured = { ns: (100n * MS).toString(), source: "measured" };
    try {
      await app.ready();
      await catalog.refresh();
      await settle();
      // The prefetch measures the workspace signals, in one call.
      expect(asked).toHaveLength(1);
      expect([...(asked[0] ?? [])].sort()).toEqual(["S0001", "S0002", "S0003", "S0004"]);

      // Nothing named: no query, and the workspace signals measured along are not listed.
      const bare = await app.inject({ url: "/api/gaps", query: { dataRef: "big" } });
      expect(bare.statusCode).toBe(200);
      expect(bare.json().periods).toEqual({});
      expect(asked).toHaveLength(1);

      // S0001 is measured already and listed because it is named; only S0100 is new.
      const named = await app.inject({
        url: "/api/gaps",
        query: { dataRef: "big", signal: ["big/S0001", "big/S0100"] },
      });
      expect(named.statusCode).toBe(200);
      expect(named.json().periods).toEqual({ "big/S0001": measured, "big/S0100": measured });
      expect(asked).toHaveLength(2);
      expect(asked[1]).toEqual(["S0100"]);

      // A value request waits for its own signal's period only.
      const value = await app.inject({
        url: "/api/value",
        query: { signal: "big/S0200", t: "0" },
      });
      expect(value.statusCode).toBe(200);
      expect(asked).toHaveLength(3);
      expect(asked[2]).toEqual(["S0200"]);

      // In all: 3 calls (prefetch, second request, value request) with 4 + 1 + 1 = 6 names.
      expect(asked).toHaveLength(3);
      expect(asked.flat()).toHaveLength(6);
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

describe("gap info of a scope (add-scope)", () => {
  const F = 1790985900000000000n;
  const T = 1790986200000000000n;
  const scope = { dataRef: "gapcar", from: F, to: T };
  const POLL_MS = 300_000;
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => vi.useRealTimers());

  const flush = async () => {
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(0);
  };

  it("computes and polls the gap info of a scope", async () => {
    // 1,001 rows of Cyc, 100 ms apart, from F + 1 s; Odd has one row; the pause F + 61 s - F + 63 s.
    const cyc = Array.from({ length: 1001 }, (_, i) => F + 1_000_000_000n + BigInt(i) * 100n * MS);
    const rows = cyc.filter((t) => t < F + 61n * S || t >= F + 63n * S);
    const t = await scopeApp({
      adapter: memoryAdapter([
        { dataRef: "gapcar", name: "Cyc", rows: rows.map((x) => [x, 1]) },
        { dataRef: "gapcar", name: "Odd", rows: [[F + 5n * S, 1]] },
        { dataRef: "othercar", name: "Cyc", rows: [[F + 5n * S, 1]] },
      ]),
    });
    try {
      const start = t.calls.length;
      const set = await t.command({
        type: "scope.set",
        dataRef: "gapcar",
        from: F.toString(),
        to: T.toString(),
      });
      expect(set.status).toBe(200);
      await flush();
      const ask = () => t.get("/api/gaps?dataRef=gapcar&signal=gapcar/Cyc");
      const [one, two] = [await ask(), await ask()];
      await flush();
      expect(one.status).toBe(200);
      expect(two.text).toBe(one.text);
      // The logger gap of the pause, and the period measured from the scope's rows.
      expect(one.body.logger).toEqual([
        { from: (F + 60n * S + 900n * MS).toString(), to: (F + 63n * S).toString() },
      ]);
      expect(one.body.periods["gapcar/Cyc"]).toEqual({
        ns: (100n * MS).toString(),
        source: "measured",
      });

      const count = (name: string) => t.calls.slice(start).filter((c) => c.method === name);
      expect(count("loggerGaps")).toHaveLength(1);
      expect(count("firstTimes")).toHaveLength(1);
      const countsBeforePoll = count("refCount").length;

      // One poll, 5 min after the scope's prefetch: it counts the rows of the scope only.
      await vi.advanceTimersByTimeAsync(POLL_MS + 1000);
      await flush();
      expect(count("refCount").length).toBe(countsBeforePoll + 1);
      // The count did not change, so the poll computes nothing more.
      expect(count("loggerGaps")).toHaveLength(1);
      expect(count("firstTimes")).toHaveLength(1);

      // Every call of the scope carries the scope, and none is made without one.
      for (const name of ["loggerGaps", "firstTimes", "refCount"]) {
        for (const call of count(name))
          expect(call.args[name === "refCount" ? 1 : 3], name).toEqual(scope);
      }
      expect(t.calls.slice(start).filter((c) => c.method === "refExtent")).toEqual([]);
    } finally {
      await t.close();
    }
  });
});
