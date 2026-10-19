import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { RefBucket, SourceAdapter, SourceInfo } from "../src/datasource.ts";
import { completeSource } from "../src/fallbacks.ts";
import { currentPriority, type QueryClass, withPriority } from "../src/priority.ts";
import { QueryQueue, queuedAdapter } from "../src/queue.ts";
import { WorkspaceStore } from "../src/workspace.ts";

const info: SourceInfo = { kind: "memory", database: "fixture", table: "rows" };

/** One stub call: which method, the class it ran in, and the `limit` of a `raw` call. */
interface Call {
  method: string;
  cls: QueryClass;
  limit?: number | undefined;
}

/** Lets promise callbacks and the queue's follow-up picks run; not a timer wait. */
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

/** Runs a stub call that records the class the queue started it in. */
function recorder() {
  const calls: Call[] = [];
  const note = (method: string, limit?: number) =>
    calls.push({ method, cls: currentPriority().cls, limit });
  return { calls, note };
}

describe("query classes through the whole stack", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] }));
  afterEach(() => vi.useRealTimers());

  it("tags prefetches and polls as background and requests as interactive", async () => {
    const { calls, note } = recorder();
    let rows = 10;
    // Only the required methods plus `events`: the fallbacks compute the rest from these.
    const adapter: SourceAdapter = {
      info,
      ping: async () => {},
      listSignals: async () => {
        note("listSignals");
        return ["A", "B", "C"].map((name) => ({ dataRef: "car", name }));
      },
      raw: async (_ref, _from, _to, limit) => {
        note("raw", limit);
        return [];
      },
      before: async () => {
        note("before");
        return undefined;
      },
      after: async () => {
        note("after");
        return undefined;
      },
      buckets: async () => {
        note("buckets");
        return [];
      },
      refBuckets: async (_dataRef, _width, times) => {
        note("refBuckets");
        const bucket: RefBucket = { start: 0n, count: rows };
        if (times) Object.assign(bucket, { first: 0n, last: 9n });
        return [bucket];
      },
      events: async () => {
        note("events");
        return [];
      },
    };
    const source = completeSource(queuedAdapter(adapter, new QueryQueue(4)));
    const catalog = new Catalog(source, async () => new Map());
    // car/A is in a window and on the events line.
    const workspace = workspaceWith([{ kind: "timeseries", signals: ["car/A"] }], ["car/A"]);
    const app = buildApp({ catalog, source, workspace });
    try {
      await app.ready();

      // Catalog load, then the prefetch that follows it.
      await catalog.refresh();
      await settle();
      const loads = calls.filter((c) => c.method === "listSignals");
      expect(loads).toHaveLength(1);
      expect(loads.every((c) => c.cls === "interactive")).toBe(true);
      const prefetch = calls.filter((c) => c.method !== "listSignals");
      // Density (refExtent and refBuckets fallbacks), gap info (refCount, loggerGaps and the
      // firstTimes fallback's raw) and events all ran, every call in `background`.
      expect(new Set(prefetch.map((c) => c.method))).toEqual(
        new Set(["refBuckets", "raw", "events"]),
      );
      expect(prefetch.some((c) => c.method === "raw" && c.limit === 1001)).toBe(true);
      expect(prefetch.filter((c) => c.cls !== "background")).toEqual([]);

      // A series request for the signal: all its calls are interactive.
      const beforeSeries = calls.length;
      const series = await app.inject({
        url: "/api/series",
        query: { signal: "car/A", from: "0", to: "60000000000" },
      });
      expect(series.statusCode).toBe(200);
      const requested = calls.slice(beforeSeries);
      expect(new Set(requested.map((c) => c.method))).toEqual(
        new Set(["buckets", "raw", "before", "after"]),
      );
      expect(requested.filter((c) => c.cls !== "interactive")).toEqual([]);

      // The gap poll 5 min later: new rows, so it recounts and measures again; all background.
      rows = 15;
      const beforePoll = calls.length;
      await vi.advanceTimersByTimeAsync(300_000);
      await settle();
      const poll = calls.slice(beforePoll);
      expect(poll.some((c) => c.method === "refBuckets")).toBe(true);
      expect(poll.some((c) => c.method === "raw" && c.limit === 1001)).toBe(true);
      expect(poll.filter((c) => c.cls !== "background")).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("raises a prefetch that a request joins", async () => {
    const { calls, note } = recorder();
    const adapter: SourceAdapter = {
      info,
      ping: async () => {},
      listSignals: async () => [{ dataRef: "car", name: "A" }],
      raw: async () => [],
      before: async () => undefined,
      after: async () => undefined,
      buckets: async () => [],
      refBuckets: async () => {
        note("refBuckets");
        return [{ start: 0n, count: 10 }];
      },
      refExtent: async () => {
        note("refExtent");
        return { count: 10, first: 0n, last: 9n };
      },
      // Native, so the gap prefetch that follows the density adds no refExtent or refBuckets call.
      refCount: async () => 10,
      loggerGaps: async () => ({ gaps: [], last: 9n }),
    };
    const queue = new QueryQueue(4);
    const source = completeSource(queuedAdapter(adapter, queue));
    const catalog = new Catalog(source, async () => new Map());
    const app = buildApp({ catalog, source, workspace: workspaceWith([]) });
    const release: (() => void)[] = [];
    const ended: number[] = [];
    try {
      await app.ready();
      // Three background tasks hold the slots background may use; they are never released here.
      const blockers = [1, 2, 3].map((i) => {
        const gate = new Promise<void>((resolve) => release.push(resolve));
        return withPriority("background", () =>
          queue.run(async () => {
            await gate;
            ended.push(i);
          }),
        );
      });
      await settle();
      expect(queue.stats.byClass.background.running).toBe(3);

      // The catalog load takes the kept slot; the density prefetch then waits as background.
      await catalog.refresh();
      await settle();
      expect(queue.stats.byClass.background.waiting).toBe(1);
      expect(calls.filter((c) => c.method === "refExtent")).toEqual([]);

      // The request joins the prefetch's computation and raises it.
      const response = await app.inject({ url: "/api/density", query: { dataRef: "car" } });
      expect(response.statusCode).toBe(200);
      expect(response.json().dataRef).toBe("car");
      expect(ended).toEqual([]);
      // Computed once, and both queries ran as interactive.
      expect(calls.filter((c) => c.method === "refExtent")).toEqual([
        { method: "refExtent", cls: "interactive", limit: undefined },
      ]);
      expect(calls.filter((c) => c.method === "refBuckets")).toEqual([
        { method: "refBuckets", cls: "interactive", limit: undefined },
      ]);

      for (const r of release) r();
      await Promise.all(blockers);
      await settle();
    } finally {
      for (const r of release) r();
      await app.close();
    }
  });

  it("answers a series at once after loading a catalog of 2,400 signals", async () => {
    const calls: { method: string; limit?: number | undefined }[] = [];
    // Each stub call takes 1 s of fake time.
    const slow = async <T>(method: string, result: T, limit?: number): Promise<T> => {
      calls.push({ method, limit });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return result;
    };
    const names = Array.from({ length: 2400 }, (_, i) => `S${String(i + 1).padStart(4, "0")}`);
    // Only the required methods: `firstTimes` falls back to one `raw` per name.
    const adapter: SourceAdapter = {
      info,
      ping: async () => {},
      listSignals: () =>
        slow(
          "listSignals",
          names.map((name) => ({ dataRef: "big", name })),
        ),
      raw: (_ref, _from, _to, limit) => slow("raw", [], limit),
      before: () => slow("before", undefined),
      after: () => slow("after", undefined),
      buckets: () => slow("buckets", []),
      refBuckets: () => slow("refBuckets", []),
    };
    const source = completeSource(queuedAdapter(adapter, new QueryQueue(4)));
    const catalog = new Catalog(source, async () => new Map());
    const workspace = workspaceWith([{ kind: "timeseries", signals: ["big/S0001"] }]);
    const app = buildApp({ catalog, source, workspace });
    try {
      await app.ready();
      const loading = catalog.refresh();
      await vi.advanceTimersByTimeAsync(1000);
      await loading;

      // Right after the load: the prefetch has begun, the series request follows at once.
      const sentAt = Date.now();
      const answer: { at?: number; samples?: number; status?: number } = {};
      const pending = app
        .inject({
          url: "/api/series",
          query: { signal: "big/S0001", from: "0", to: "60000000000" },
        })
        .then((res) => {
          answer.at = Date.now();
          answer.status = res.statusCode;
          answer.samples = calls.filter((c) => c.method === "raw" && c.limit === 1001).length;
        });
      await vi.advanceTimersByTimeAsync(3000);
      expect(answer.at, "the series answered within 3 s of fake time").toBeDefined();
      await pending;
      expect(answer.status).toBe(200);
      expect((answer.at as number) - sentAt).toBeLessThanOrEqual(3000);
      // At most the period sample of S0001 (the workspace signal), not one per catalog signal.
      expect(answer.samples).toBeLessThanOrEqual(1);
    } finally {
      await app.close();
    }
  });
});
