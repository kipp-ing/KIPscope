import type { SignalInfo } from "@kipscope/shared";
import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import { ClickHouseSource } from "../src/clickhouse.ts";
import type { EventMapping, TableMapping } from "../src/config.ts";
import type { RawPoint, Scope, SourceAdapter, SourceInfo } from "../src/datasource.ts";
import { EventsCache } from "../src/events.ts";
import {
  completeSource,
  nativeMethods,
  STATE_SCAN_MAX,
  STATE_SCAN_PAGE,
} from "../src/fallbacks.ts";
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

describe("fallbacks keep the scope", () => {
  // Scope {conf-a, B + 5 s, B + 35 s} of the conformance fixture (B = 2026-10-05T00:00:00Z).
  const B = 1791158400000000000n;
  const SEC = 1_000_000_000n;
  const scope: Scope = { dataRef: "conf-a", from: B + 5n * SEC, to: B + 35n * SEC };

  it("passes the scope to every core call", async () => {
    // A recording stub with only the required methods; every call keeps its arguments.
    const before: unknown[][] = [];
    const after: unknown[][] = [];
    const refBuckets: unknown[][] = [];
    const raw: unknown[][] = [];
    const point = (n: number): RawPoint => ({ t: B + 5n * SEC + BigInt(n) * SEC, v: n });
    const adapter: SourceAdapter = {
      info,
      ping: async () => {},
      listSignals: async () => [],
      raw: async (...args) => {
        raw.push(args);
        return [point(0), point(1), point(2)];
      },
      before: async (...args) => {
        before.push(args);
        return point(29);
      },
      after: async (...args) => {
        after.push(args);
        return point(0);
      },
      buckets: async () => [],
      refBuckets: async (...args) => {
        refBuckets.push(args);
        return [{ start: B, count: 3, first: B + 5n * SEC, last: B + 7n * SEC }];
      },
    };
    const source = completeSource(adapter);
    const ref = { dataRef: "conf-a", name: "Lin.RAMP" };

    expect(await source.extent(ref, scope)).toEqual({ first: point(0).t, last: point(29).t });
    expect((await source.refExtent("conf-a", scope))?.count).toBe(3);
    expect(await source.refCount("conf-a", scope)).toBe(3);
    expect((await source.loggerGaps("conf-a", SEC, 2n * SEC, scope)).last).toBe(B + 7n * SEC);
    const times = await source.firstTimes("conf-a", ["A", "B", "C"], 100, scope);
    expect(times.size).toBe(3);
    await source.stateChanges({ ...ref, sna: [] }, { kind: "text" }, 10, scope);

    // Each core method was reached by at least one fallback ...
    expect(before.length).toBeGreaterThanOrEqual(1);
    expect(after.length).toBeGreaterThanOrEqual(1);
    expect(refBuckets.length).toBeGreaterThanOrEqual(3);
    // 3 names of firstTimes, at least one page of stateChanges.
    expect(raw.length).toBeGreaterThanOrEqual(4);
    // ... and carries the scope: before (ref, t, scope, abort), after the same, refBuckets
    // (dataRef, width, times, scope, abort).
    for (const args of [...before, ...after]) expect(args[2]).toEqual(scope);
    for (const args of refBuckets) expect(args[3]).toEqual(scope);
    // raw (ref, from, to, limit, abort): the scope's bounds replace the whole time axis.
    for (const args of raw) {
      expect(args[1]).toBe(scope.from);
      expect(args[2]).toBe(scope.to);
    }
  });

  it("calls the core without a scope when none is given", async () => {
    const before: unknown[][] = [];
    const adapter: SourceAdapter = {
      ...requiredOnly().adapter,
      before: async (...args) => {
        before.push(args);
        return undefined;
      },
    };
    await completeSource(adapter).extent({ dataRef: "conf-a", name: "Lin.RAMP" });
    expect(before[0]?.[2]).toBeUndefined();
  });
});

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
    const pending = source.firstTimes("conf-a", names(50), 1001, undefined, controller.signal);
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

describe("the series fallback (speed-up-adx A2)", () => {
  const B = 1791158400000000000n;
  const SEC = 1_000_000_000n;
  const scope: Scope = { dataRef: "conf-a", from: B, to: B + 100n * SEC };
  const ref = { dataRef: "conf-a", name: "Lin.RAMP", sna: [] };
  const from = B + 10n * SEC;
  const to = B + 20n * SEC;
  const width = 2n * SEC;

  /** A stub with `count` answering `n` after a delay; every call is recorded in order with its arguments. */
  function recording(n: number) {
    const log: { call: string; phase: "start" | "end"; args: unknown[] }[] = [];
    const step =
      <T>(call: string, answer: T, delayMs = 0) =>
      async (...args: unknown[]): Promise<T> => {
        log.push({ call, phase: "start", args });
        await sleep(delayMs);
        log.push({ call, phase: "end", args });
        return answer;
      };
    const points: RawPoint[] = [
      { t: from, v: 1 },
      { t: from + SEC, v: 2 },
    ];
    const edge = (t: bigint): RawPoint => ({ t, v: 9 });
    const buckets = [{ start: from, count: 3, sna: 0, mean: 2, min: 1, max: 3 }];
    const adapter: SourceAdapter = {
      ...requiredOnly().adapter,
      count: step("count", n, 20),
      raw: step("raw", points),
      before: step("before", edge(from - SEC)),
      after: step("after", undefined),
      buckets: step("buckets", buckets),
    };
    return { adapter, log, points, buckets, edge };
  }

  it("computes a series from count, then raw and edges or buckets", async () => {
    // 5 points against target 10: count, then raw (no limit), before and after; no buckets.
    const small = recording(5);
    const answer = await completeSource(small.adapter).series(ref, from, to, 10, width, scope);
    expect(answer).toEqual({
      kind: "raw",
      points: small.points,
      before: small.edge(from - SEC),
    });
    expect("after" in answer && answer.after !== undefined).toBe(false);
    const started = small.log.filter((e) => e.phase === "start");
    expect(started.map((e) => e.call)).toEqual(["count", "raw", "before", "after"]);
    const calls = Object.fromEntries(started.map((e) => [e.call, e.args]));
    expect(calls.count?.slice(0, 3)).toEqual([ref, from, to]);
    expect(calls.raw?.slice(0, 4)).toEqual([ref, from, to, undefined]);
    expect(calls.before?.slice(0, 3)).toEqual([ref, from, scope]);
    expect(calls.after?.slice(0, 3)).toEqual([ref, to, scope]);
    // count ended before any other call started.
    const countEnd = small.log.findIndex((e) => e.call === "count" && e.phase === "end");
    const firstOther = small.log.findIndex((e) => e.call !== "count");
    expect(countEnd).toBeGreaterThanOrEqual(0);
    expect(countEnd).toBeLessThan(firstOther);

    // Exactly the target counts as raw (count <= target).
    const edgeCase = recording(10);
    expect(
      (await completeSource(edgeCase.adapter).series(ref, from, to, 10, width, scope)).kind,
    ).toBe("raw");

    // 50 points against target 10: count, then buckets of the width, and nothing else.
    const large = recording(50);
    const wide = await completeSource(large.adapter).series(ref, from, to, 10, width, scope);
    expect(wide).toEqual({ kind: "buckets", buckets: large.buckets });
    const wideStarted = large.log.filter((e) => e.phase === "start");
    expect(wideStarted.map((e) => e.call)).toEqual(["count", "buckets"]);
    expect(wideStarted[1]?.args.slice(0, 4)).toEqual([ref, from, to, width]);
    expect(large.log.findIndex((e) => e.call === "buckets")).toBeGreaterThan(
      large.log.findIndex((e) => e.call === "count" && e.phase === "end"),
    );
  });

  it("passes the abort signal to every call of the series fallback", async () => {
    const small = recording(5);
    const controller = new AbortController();
    await completeSource(small.adapter).series(ref, from, to, 10, width, scope, controller.signal);
    const abortAt = {
      count: 3,
      raw: 4,
      before: 3,
      after: 3,
    } as const;
    for (const [call, at] of Object.entries(abortAt)) {
      const entry = small.log.find((e) => e.call === call && e.phase === "start");
      expect(entry?.args[at], call).toBe(controller.signal);
    }
  });

  it("takes series from the fallback on ClickHouse", () => {
    const mapping: TableMapping = {
      database: "sdlog",
      table: "conf_signals",
      dataRef: "vehicle",
      signal: "signal",
      time: "utc",
      value: "value",
      text: "text",
    };
    const events: EventMapping = {
      table: "conf_events",
      source: "source",
      kind: "kind",
      name: "name",
      value: "value",
      text: "text",
      detail: "detail",
    };
    const adapter = new ClickHouseSource({} as never, mapping, 30, events);
    expect(nativeMethods(adapter)).toEqual([
      "count",
      "extent",
      "refExtent",
      "refCount",
      "loggerGaps",
      "firstTimes",
      "stateChanges",
      "events",
    ]);
    expect((adapter as SourceAdapter).series).toBeUndefined();
    // The completed source still has it.
    expect(typeof completeSource(adapter).series).toBe("function");
  });
});
