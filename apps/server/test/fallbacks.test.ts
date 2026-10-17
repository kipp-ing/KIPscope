import type { SignalInfo } from "@kipscope/shared";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { RawPoint, SourceAdapter, SourceInfo } from "../src/datasource.ts";
import { EventsCache } from "../src/events.ts";
import { completeSource, STATE_SCAN_MAX, STATE_SCAN_PAGE } from "../src/fallbacks.ts";
import { QueryQueue, queuedAdapter } from "../src/queue.ts";
import { WorkspaceStore } from "../src/workspace.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const info: SourceInfo = {
  kind: "memory",
  database: "fixture",
  table: "rows",
  eventsTable: "fixture.conf_events",
};

/** An adapter with the 7 required methods only; `raw` counts its calls and takes `delayMs`. */
function requiredOnly(delayMs = 0, extra: Partial<SourceAdapter> = {}) {
  const calls = { raw: 0, concurrent: 0, peak: 0, other: [] as string[] };
  const adapter: SourceAdapter = {
    info,
    ping: async () => {},
    listSignals: async () => [{ dataRef: "conf-a", name: "Lin.RAMP" }],
    raw: async () => {
      calls.raw++;
      calls.concurrent++;
      calls.peak = Math.max(calls.peak, calls.concurrent);
      await sleep(delayMs);
      calls.concurrent--;
      return [
        { t: BigInt(calls.raw), v: 1 },
        { t: BigInt(calls.raw) + 1000n, v: 2 },
      ];
    },
    before: async () => {
      calls.other.push("before");
      return undefined;
    },
    after: async () => {
      calls.other.push("after");
      return undefined;
    },
    buckets: async () => {
      calls.other.push("buckets");
      return [];
    },
    refBuckets: async () => {
      calls.other.push("refBuckets");
      return [];
    },
    ...extra,
  };
  return { adapter, calls };
}

const names = (n: number) => Array.from({ length: n }, (_, i) => `S${i}`);

describe("fallbacks of a source with the required methods only", () => {
  it("sends no query for an empty name list", async () => {
    const { adapter, calls } = requiredOnly();
    const source = completeSource(adapter);
    const times = await source.firstTimes("conf-a", [], 1001);
    expect(times.size).toBe(0);
    expect(calls.raw).toBe(0);
    expect(calls.other).toEqual([]);
  });

  it("sends fallback queries through the queue", async () => {
    const { adapter, calls } = requiredOnly(5);
    const queue = new QueryQueue(2);
    const source = completeSource(queuedAdapter(adapter, queue));
    const times = await source.firstTimes("conf-a", names(50), 1001);
    expect(times.size).toBe(50);
    expect(calls.raw).toBe(50);
    expect(calls.peak).toBe(2);
    expect(queue.peak).toBe(2);
  });

  it("stops a fallback on abort", async () => {
    const { adapter, calls } = requiredOnly(50);
    const source = completeSource(queuedAdapter(adapter, new QueryQueue(2)));
    const controller = new AbortController();
    const reason = new Error("client went away");
    const pending = source.firstTimes("conf-a", names(50), 1001, controller.signal);
    const outcome = pending.then(
      () => "resolved" as unknown,
      (error: unknown) => error,
    );
    await vi.waitFor(() => expect(calls.raw).toBe(2));
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    // Nothing else is started after the abort, also not when the running two finish.
    await sleep(200);
    expect(calls.raw).toBeLessThanOrEqual(2);
  });

  it("stops the state-change scan after 5,000,000 points", async () => {
    expect(STATE_SCAN_PAGE).toBe(100_000);
    expect(STATE_SCAN_MAX).toBe(5_000_000);
    // 5,000,001 points of one value, 10 ns apart, generated page by page on demand.
    const total = 5_000_001n;
    const pages: number[] = [];
    const { adapter } = requiredOnly(0, {
      raw: async (_ref, from, _to, limit) => {
        pages.push(limit ?? -1);
        const start = from <= 0n ? 0n : (from + 9n) / 10n;
        const wanted = BigInt(limit ?? Number(total));
        const count = Number(wanted < total - start ? wanted : total - start);
        const points: RawPoint[] = new Array(count);
        for (let i = 0; i < count; i++)
          points[i] = { t: (start + BigInt(i)) * 10n, v: 1, text: "closed" };
        return points;
      },
    });
    const source = completeSource(adapter);
    const door: SignalInfo = {
      id: "conf-a/State.X",
      dataRef: "conf-a",
      name: "State.X",
      states: "text",
    };
    const catalog = {
      loadedAt: new Date(1_000) as Date | undefined,
      get: (id: string) => (id === door.id ? door : undefined),
      snaRanges: () => [],
    };
    const warn = vi.fn();
    const cache = new EventsCache(source, catalog, warn);
    expect(await cache.signal(door.id)).toBe("too_many_changes");
    // At most 50 pages of 100,000 points (the last asks for one more to see the cap is crossed).
    expect(pages.length).toBeLessThanOrEqual(50);
    expect(pages[0]).toBe(100_000);
    const lines = warn.mock.calls.map((call) => String(call[0])).filter((m) => m.includes(door.id));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("stateChanges");
    expect(lines[0]).toContain("5,000,000");
    // The same signal asked again in the same catalog load logs nothing more.
    await cache.signal(door.id);
    expect(
      warn.mock.calls.map((call) => String(call[0])).filter((m) => m.includes(door.id)),
    ).toHaveLength(1);
  }, 60_000);

  it("returns the rows at exactly 5,000,000 points", async () => {
    // 5,000,000 points of one value, 10 ns apart, generated page by page on demand.
    const total = BigInt(STATE_SCAN_MAX);
    const calls: number[] = [];
    const { adapter } = requiredOnly(0, {
      raw: async (_ref, from, _to, limit) => {
        calls.push(limit ?? -1);
        const start = from <= 0n ? 0n : (from + 9n) / 10n;
        const wanted = BigInt(limit ?? Number(total));
        const left = total - start;
        const count = Number(left <= 0n ? 0n : wanted < left ? wanted : left);
        const points: RawPoint[] = new Array(count);
        for (let i = 0; i < count; i++)
          points[i] = { t: (start + BigInt(i)) * 10n, v: 1, text: "closed" };
        return points;
      },
    });
    const source = completeSource(adapter);
    const rows = await source.stateChanges(
      { dataRef: "conf-a", name: "State.X", sna: [] },
      { kind: "text" },
      1000,
    );
    // One row: the first valid point; no change follows in 5,000,000 equal points.
    expect(rows).toEqual([{ t: "0", value: 1, text: "closed" }]);
    // No 51st raw call after the 50 pages.
    expect(calls.length).toBeLessThanOrEqual(50);
  }, 60_000);

  it("treats a source without events as one without an events table", async () => {
    const { adapter } = requiredOnly();
    const source = completeSource(adapter);
    expect("events" in adapter).toBe(false);
    const catalog = new Catalog(source, async () => new Map());
    const app = buildApp({
      catalog,
      source,
      workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
    });
    const warn = vi.spyOn(app.log, "warn").mockImplementation(() => undefined);
    try {
      await app.ready();
      await catalog.refresh();
      for (let i = 0; i < 2; i++) {
        const res = await app.inject({ url: "/api/events", query: { dataRef: "conf-a" } });
        expect(res.statusCode).toBe(200);
        expect(res.json().total).toBe(0);
      }
      // One warning in all, naming the source's events table.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("fixture.conf_events");
    } finally {
      await app.close();
    }
  });
});
