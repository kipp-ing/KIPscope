import { describe, expect, it } from "vitest";
import type { DataSource, SourceAdapter, SourceInfo } from "../src/datasource.ts";
import { Priority, type QueryClass, withPriority } from "../src/priority.ts";
import { QueryQueue, queuedAdapter } from "../src/queue.ts";

const tick = () => new Promise((r) => setTimeout(r, 1));

/** Fake source whose `count` resolves after a short delay and records every call. */
function fakeSource() {
  const calls: string[] = [];
  let concurrent = 0;
  let maxConcurrent = 0;
  const source = {
    count: async (ref: { name: string }) => {
      calls.push(ref.name);
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await tick();
      concurrent--;
      return 1;
    },
  } as unknown as DataSource;
  return { source, calls, maxConcurrent: () => maxConcurrent };
}

const ref = (name: string) => ({ dataRef: "car", name });

/** Per-class stats of a queue with nothing running or waiting (design Interfaces: `byClass`). */
const idle = () => ({
  interactive: { running: 0, waiting: 0 },
  metadata: { running: 0, waiting: 0 },
  background: { running: 0, waiting: 0 },
  preload: { running: 0, waiting: 0 },
});

/** The stubs below implement the optional methods they call, so the queued adapter has them too. */
const queuedSource = (stub: DataSource, queue: QueryQueue) =>
  queuedAdapter(stub, queue) as DataSource;

describe("QueryQueue", () => {
  it("runs 50 queries with at most 4 at a time and completes all", async () => {
    const fake = fakeSource();
    const queue = new QueryQueue(4);
    const source = queuedSource(fake.source, queue);
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => source.count(ref(`s${i}`), 0n, 1n)),
    );
    expect(results).toHaveLength(50);
    expect(fake.calls).toHaveLength(50);
    expect(fake.maxConcurrent()).toBe(4);
    expect(queue.peak).toBe(4);
    expect(queue.stats).toEqual({ running: 0, waiting: 0, peak: 4, byClass: idle() });
  });

  it("never sends an already aborted request to the source", async () => {
    const fake = fakeSource();
    const source = queuedSource(fake.source, new QueryQueue(4));
    const controller = new AbortController();
    controller.abort();
    await expect(source.count(ref("x"), 0n, 1n, controller.signal)).rejects.toThrow(/abort/i);
    expect(fake.calls).toEqual([]);
  });

  it("drops a queued request that is aborted while waiting", async () => {
    const fake = fakeSource();
    const queue = new QueryQueue(1);
    const source = queuedSource(fake.source, queue);
    const controller = new AbortController();
    const first = source.count(ref("first"), 0n, 1n);
    const second = source.count(ref("second"), 0n, 1n, controller.signal);
    expect(queue.stats.waiting).toBe(1);
    controller.abort();
    await expect(second).rejects.toThrow(/abort/i);
    await first;
    await tick();
    expect(fake.calls).toEqual(["first"]);
    expect(queue.stats).toMatchObject({ running: 0, waiting: 0 });
  });

  it("passes the abort signal to running queries and frees the slot on failure", async () => {
    const queue = new QueryQueue(1);
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    const failing = queue.run(async (abort) => {
      received = abort;
      throw new Error("boom");
    }, controller.signal);
    await expect(failing).rejects.toThrow("boom");
    expect(received).toBe(controller.signal);
    await expect(queue.run(async () => "next")).resolves.toBe("next");
  });
});

describe("queuedAdapter gaps", () => {
  it("forwards loggerGaps, firstTimes and refCount to the wrapped source", async () => {
    const seen: unknown[][] = [];
    const stub = {
      refCount: async (...a: unknown[]) => {
        seen.push(a);
        return 42;
      },
      loggerGaps: async (...a: unknown[]) => {
        seen.push(a);
        return { gaps: [{ from: 1n, to: 9n }], last: 9n };
      },
      firstTimes: async (...a: unknown[]) => {
        seen.push(a);
        return new Map([["x", [1n, 2n]]]);
      },
    } as unknown as DataSource;
    const source = queuedSource(stub, new QueryQueue(2));
    expect(await source.loggerGaps("car", 2n, 5n)).toEqual({
      gaps: [{ from: 1n, to: 9n }],
      last: 9n,
    });
    expect(await source.firstTimes("car", ["x"], 2)).toEqual(new Map([["x", [1n, 2n]]]));
    const controller = new AbortController();
    // The scope sits before `abort` (add-scope Z1) and reaches the wrapped source unchanged.
    const scope = { dataRef: "car", from: 1n, to: 9n };
    expect(await source.refCount("car", scope, controller.signal)).toBe(42);
    expect(seen.map((a) => a[0])).toEqual(["car", "car", "car"]);
    expect(seen[2]?.[1]).toEqual(scope);
    expect(seen[2]?.[2]).toBe(controller.signal);
  });
});

describe("queuedAdapter shape", () => {
  const info: SourceInfo = { kind: "memory", database: "fixture", table: "rows" };
  const required = (extra: Partial<SourceAdapter> = {}): SourceAdapter => ({
    info,
    ping: async () => {},
    listSignals: async () => [],
    raw: async () => [],
    before: async () => undefined,
    after: async () => undefined,
    buckets: async () => [],
    refBuckets: async () => [],
    ...extra,
  });

  it("wraps only the optional methods the adapter has", () => {
    const bare = queuedAdapter(required(), new QueryQueue(2));
    for (const name of [
      "count",
      "extent",
      "series",
      "refExtent",
      "refCount",
      "loggerGaps",
      "firstTimes",
      "stateChanges",
      "events",
    ] as const) {
      expect(bare[name], name).toBeUndefined();
    }
    const withEvents = queuedAdapter(required({ events: async () => [] }), new QueryQueue(2));
    expect(typeof withEvents.events).toBe("function");
    expect(withEvents.count).toBeUndefined();
  });

  it("passes ping and info through without the queue", async () => {
    const queue = new QueryQueue(1);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = required({
      listSignals: async () => {
        await gate;
        return [];
      },
    });
    const queued = queuedAdapter(adapter, queue);
    expect(queued.info).toBe(info);
    // The only slot is busy, a second query waits, and ping still answers at once.
    const busy = queued.listSignals();
    const waiting = queued.listSignals();
    // No priority context: both queries count as interactive.
    expect(queue.stats).toEqual({
      running: 1,
      waiting: 1,
      peak: 1,
      byClass: { ...idle(), interactive: { running: 1, waiting: 1 } },
    });
    await expect(queued.ping(new AbortController().signal)).resolves.toBeUndefined();
    release();
    await Promise.all([busy, waiting]);
  });

  it("forwards limit, times and abort to the wrapped methods", async () => {
    const seen: unknown[][] = [];
    const queued = queuedAdapter(
      required({
        raw: async (...a) => {
          seen.push(a);
          return [];
        },
        refBuckets: async (...a) => {
          seen.push(a);
          return [];
        },
      }),
      new QueryQueue(2),
    );
    const controller = new AbortController();
    await queued.raw({ dataRef: "car", name: "S", sna: [] }, 1n, 2n, 7, controller.signal);
    const scope = { dataRef: "car", from: 1n, to: 9n };
    await queued.refBuckets("car", 5n, true, scope, controller.signal);
    expect(seen[0]?.slice(1, 4)).toEqual([1n, 2n, 7]);
    expect(seen[0]?.[4]).toBe(controller.signal);
    expect(seen[1]?.slice(0, 4)).toEqual(["car", 5n, true, scope]);
    expect(seen[1]?.[4]).toBe(controller.signal);
  });
});

describe("queuedAdapter scope", () => {
  const info: SourceInfo = { kind: "memory", database: "fixture", table: "rows" };
  const scope = { dataRef: "car", from: 1000n, to: 9000n };
  const sig = { dataRef: "car", name: "S", sna: [] };
  const rule = { kind: "text" } as const;

  /** A stub with every method; each records the exact arguments it received, under its name. */
  function stub() {
    const seen = new Map<string, unknown[]>();
    const record =
      (name: string, result: unknown) =>
      async (...a: unknown[]) => {
        seen.set(name, a);
        return result;
      };
    const adapter: DataSource = {
      info,
      ping: async () => {},
      listSignals: record("listSignals", []),
      raw: record("raw", []),
      before: record("before", undefined),
      after: record("after", undefined),
      buckets: record("buckets", []),
      refBuckets: record("refBuckets", []),
      count: record("count", 0),
      series: record("series", { kind: "raw", points: [] }),
      extent: record("extent", undefined),
      refExtent: record("refExtent", undefined),
      refCount: record("refCount", 0),
      loggerGaps: record("loggerGaps", { gaps: [] }),
      firstTimes: record("firstTimes", new Map()),
      stateChanges: record("stateChanges", []),
      computedSeries: record("computedSeries", { kind: "raw", points: [] }),
      events: record("events", []),
    } as DataSource;
    return { adapter, seen };
  }

  /**
   * The 12 methods that take a scope (design Z1 of add-scope, `series` added by speed-up-adx A2): the call with scope and abort, and
   * the arguments the wrapped method must receive, `abort` always last. Written from the Z1 table.
   */
  const calls: [string, (q: DataSource, abort?: AbortSignal) => Promise<unknown>, unknown[]][] = [
    ["listSignals", (q, a) => q.listSignals(scope, a), [scope]],
    ["extent", (q, a) => q.extent(sig, scope, a), [sig, scope]],
    ["refExtent", (q, a) => q.refExtent("car", scope, a), ["car", scope]],
    ["refCount", (q, a) => q.refCount("car", scope, a), ["car", scope]],
    ["before", (q, a) => q.before(sig, 5000n, scope, a), [sig, 5000n, scope]],
    ["after", (q, a) => q.after(sig, 5000n, scope, a), [sig, 5000n, scope]],
    ["events", (q, a) => q.events("car", 100, scope, a), ["car", 100, scope]],
    ["refBuckets", (q, a) => q.refBuckets("car", 60n, true, scope, a), ["car", 60n, true, scope]],
    ["loggerGaps", (q, a) => q.loggerGaps("car", 2n, 5n, scope, a), ["car", 2n, 5n, scope]],
    ["firstTimes", (q, a) => q.firstTimes("car", ["S"], 3, scope, a), ["car", ["S"], 3, scope]],
    ["stateChanges", (q, a) => q.stateChanges(sig, rule, 100, scope, a), [sig, rule, 100, scope]],
    [
      "series",
      (q, a) => q.series(sig, 1000n, 5000n, 100, 40n, scope, a),
      [sig, 1000n, 5000n, 100, 40n, scope],
    ],
  ];

  it("passes a computed series call on with its abort signal (it takes no scope)", async () => {
    const { adapter, seen } = stub();
    const queued = queuedAdapter(adapter, new QueryQueue(2)) as DataSource;
    const controller = new AbortController();
    const computed = { dataRef: "car", ast: { op: "var", name: "a" }, a: sig } as const;
    await queued.computedSeries(computed, 1000n, 5000n, 100, 40n, controller.signal);
    expect(seen.get("computedSeries")).toEqual([
      computed,
      1000n,
      5000n,
      100,
      40n,
      controller.signal,
    ]);
  });

  it("covers the 12 methods of the contract that take a scope", () => {
    expect(calls.map(([name]) => name).sort()).toEqual(
      [
        "listSignals",
        "extent",
        "refExtent",
        "refCount",
        "before",
        "after",
        "events",
        "refBuckets",
        "loggerGaps",
        "firstTimes",
        "stateChanges",
        "series",
      ].sort(),
    );
    expect(calls).toHaveLength(12);
  });

  for (const [name, call, args] of calls) {
    it(`${name} passes the scope on to the wrapped method`, async () => {
      const { adapter, seen } = stub();
      const queued = queuedAdapter(adapter, new QueryQueue(2)) as DataSource;
      const controller = new AbortController();
      await call(queued, controller.signal);
      // Scope in its place, then the abort signal: nothing shifted, nothing lost.
      expect(seen.get(name)).toEqual([...args, controller.signal]);
      expect(seen.get(name)?.[args.length]).toBe(controller.signal);
    });

    it(`${name} passes the scope on without an abort signal`, async () => {
      const { adapter, seen } = stub();
      const queued = queuedAdapter(adapter, new QueryQueue(2)) as DataSource;
      await call(queued);
      const received = seen.get(name) ?? [];
      expect(received.slice(0, args.length)).toEqual(args);
      expect(received[args.length]).toBeUndefined();
    });
  }
});

/** A task the test holds open until it releases it (no wall-clock waits). */
interface Held {
  name: string;
  cls: QueryClass;
  started: boolean;
  released: boolean;
  release: () => void;
  /** Settles when the queue ran the task to its end, or rejected it. */
  done: Promise<void>;
}

/** Lets promise callbacks and the queue's follow-up picks run; not a timer wait. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** Queues a task of class `cls` that records its start in `order` and runs until `release`. */
function hold(
  queue: QueryQueue,
  order: string[],
  name: string,
  cls: QueryClass | Priority,
  abort?: AbortSignal,
): Held {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held: Held = {
    name,
    cls: typeof cls === "string" ? cls : cls.cls,
    started: false,
    released: false,
    release: () => {
      held.released = true;
      release();
    },
    done: Promise.resolve(),
  };
  held.done = withPriority(cls, () =>
    queue.run(async () => {
      held.started = true;
      order.push(name);
      await gate;
    }, abort),
  );
  return held;
}

/** Releases every started, not yet released task per round until all ended. */
async function drain(tasks: readonly Held[]) {
  for (;;) {
    const running = tasks.filter((t) => t.started && !t.released);
    if (running.length === 0) break;
    for (const task of running) task.release();
    await settle();
  }
  await Promise.all(tasks.map((t) => t.done));
}

describe("QueryQueue classes", () => {
  /** Setup of series-query "Start order by class": limit 4, B1-B20, then P, M, I1-I3. */
  function classSetup(abortI3?: AbortSignal) {
    const queue = new QueryQueue(4);
    const order: string[] = [];
    const tasks: Held[] = [];
    const add = (name: string, cls: QueryClass, abort?: AbortSignal) => {
      const task = hold(queue, order, name, cls, abort);
      tasks.push(task);
      return task;
    };
    for (let i = 1; i <= 20; i++) add(`B${i}`, "background");
    add("P", "preload");
    add("M", "metadata");
    add("I1", "interactive");
    add("I2", "interactive");
    add("I3", "interactive", abortI3);
    const by = (name: string) => tasks.find((t) => t.name === name) as Held;
    return { queue, order, tasks, by };
  }

  const releaseAndSettle = async (task: Held) => {
    task.release();
    await settle();
  };

  it("starts waiting queries by class, oldest first", async () => {
    const { queue, order, tasks, by } = classSetup();
    await settle();
    // Background takes 3 of 4 slots; I1 finds the kept slot free.
    expect(order).toEqual(["B1", "B2", "B3", "I1"]);
    expect(queue.stats.running).toBe(4);

    for (const name of ["B1", "I1", "I2", "I3", "M"]) await releaseAndSettle(by(name));
    expect(order).toEqual(["B1", "B2", "B3", "I1", "I2", "I3", "M", "B4"]);

    await drain(tasks);
    const expected = [
      "B1",
      "B2",
      "B3",
      "I1",
      "I2",
      "I3",
      "M",
      ...Array.from({ length: 17 }, (_, i) => `B${i + 4}`),
      "P",
    ];
    expect(order).toEqual(expected);
    expect(order).toHaveLength(25);
    expect(queue.stats).toEqual({ running: 0, waiting: 0, peak: 4, byClass: idle() });
  });

  it("drops an aborted query from its class", async () => {
    const controller = new AbortController();
    const { queue, order, tasks, by } = classSetup(controller.signal);
    await settle();
    // B1 ends: I2 takes the freed slot, so I3 is the only interactive query left waiting.
    await releaseAndSettle(by("B1"));
    expect(order).toEqual(["B1", "B2", "B3", "I1", "I2"]);
    expect(queue.stats.byClass.interactive).toEqual({ running: 2, waiting: 1 });

    const reason = new Error("client went away");
    controller.abort(reason);
    await expect(by("I3").done).rejects.toBe(reason);
    expect(queue.stats.byClass.interactive).toEqual({ running: 2, waiting: 0 });

    // M (metadata) may start only below the kept slot: after I1 ended it still must not.
    await releaseAndSettle(by("I1"));
    expect(order).not.toContain("M");
    await releaseAndSettle(by("I2"));
    expect(order.slice(5)).toEqual(["M"]);
    expect(order).not.toContain("I3");

    // The rest runs to its end; I3 stays unstarted.
    const rest = tasks.filter((t) => t.name !== "I3");
    await drain(rest);
    expect(order).not.toContain("I3");
    expect(order).toHaveLength(24);
  });

  it("runs eight at once with the ADX default", async () => {
    const queue = new QueryQueue(8);
    expect(queue.kept).toBe(1);
    const order: string[] = [];
    const interactive: Held[] = [];
    const background: Held[] = [];
    for (let i = 1; i <= 20; i++) interactive.push(hold(queue, order, `I${i}`, "interactive"));
    for (let i = 1; i <= 20; i++) background.push(hold(queue, order, `B${i}`, "background"));
    await settle();
    // Eight interactive queries run at once, the other twelve and all background queries wait.
    expect(order).toEqual(Array.from({ length: 8 }, (_, i) => `I${i + 1}`));
    expect(queue.stats.byClass.interactive).toEqual({ running: 8, waiting: 12 });
    expect(queue.stats.byClass.background).toEqual({ running: 0, waiting: 20 });

    // Release the interactive queries until all 20 ended: no background query starts before.
    await drain(interactive);
    expect(order.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, i) => `I${i + 1}`));
    // Then seven background queries run at once: the eighth slot stays kept for interactive ones.
    expect(order.slice(20)).toEqual(Array.from({ length: 7 }, (_, i) => `B${i + 1}`));
    expect(queue.stats.byClass.interactive).toEqual({ running: 0, waiting: 0 });
    expect(queue.stats.byClass.background).toEqual({ running: 7, waiting: 13 });
    expect(queue.stats.running).toBe(7);
    expect(queue.peak).toBe(8);

    await drain(background);
    expect(order).toHaveLength(40);
    expect(queue.stats.running).toBe(0);
  });

  it("keeps one slot for interactive queries", async () => {
    const queue = new QueryQueue(4);
    expect(queue.kept).toBe(1);
    const order: string[] = [];
    const tasks: Held[] = [];
    for (let i = 1; i <= 2400; i++) tasks.push(hold(queue, order, `B${i}`, "background"));
    await settle();
    expect(queue.stats.byClass.background).toEqual({ running: 3, waiting: 2397 });
    expect(queue.stats.running).toBe(3);

    // No background task has ended: the interactive query starts into the kept slot.
    const interactive = hold(queue, order, "I", "interactive");
    tasks.push(interactive);
    await settle();
    expect(interactive.started).toBe(true);
    expect(order).toEqual(["B1", "B2", "B3", "I"]);
    expect(queue.stats.byClass).toEqual({
      ...idle(),
      background: { running: 3, waiting: 2397 },
      interactive: { running: 1, waiting: 0 },
    });
    expect(queue.stats.peak).toBe(4);

    // Clean up: release every running task per round until all 2,401 tasks ended.
    await drain(tasks);
    expect(order).toHaveLength(2401);
  });

  it("has no kept slot with a limit of one", async () => {
    const queue = new QueryQueue(1);
    expect(queue.kept).toBe(0);
    const order: string[] = [];
    const b1 = hold(queue, order, "B1", "background");
    const b2 = hold(queue, order, "B2", "background");
    const i1 = hold(queue, order, "I1", "interactive");
    await settle();
    // Background still runs (else it would starve); no preemption for I1.
    expect(order).toEqual(["B1"]);
    await releaseAndSettle(b1);
    expect(order).toEqual(["B1", "I1"]);
    await releaseAndSettle(i1);
    expect(order).toEqual(["B1", "I1", "B2"]);
    await releaseAndSettle(b2);
    await Promise.all([b1.done, b2.done, i1.done]);
    expect(queue.stats).toEqual({ running: 0, waiting: 0, peak: 1, byClass: idle() });
  });

  it("gives background work one slot with a limit of two", async () => {
    const queue = new QueryQueue(2);
    expect(queue.kept).toBe(1);
    const order: string[] = [];
    const b1 = hold(queue, order, "B1", "background");
    const b2 = hold(queue, order, "B2", "background");
    const i1 = hold(queue, order, "I1", "interactive");
    await settle();
    expect(order).toEqual(["B1", "I1"]);
    await releaseAndSettle(i1);
    // B2 may not start while B1 runs: background keeps to limit - kept = 1.
    expect(order).toEqual(["B1", "I1"]);
    await releaseAndSettle(b1);
    expect(order).toEqual(["B1", "I1", "B2"]);
    await releaseAndSettle(b2);
    await Promise.all([b1.done, b2.done, i1.done]);
  });

  it("starts a raised query at once", async () => {
    const queue = new QueryQueue(4);
    const order: string[] = [];
    const running = [1, 2, 3].map((i) => hold(queue, order, `B${i}`, "background"));
    const priority = new Priority("background");
    const waiting = hold(queue, order, "W", priority);
    await settle();
    expect(order).toEqual(["B1", "B2", "B3"]);
    expect(queue.stats.byClass.background).toEqual({ running: 3, waiting: 1 });

    // Raising never lowers: a raise to a lower class changes nothing.
    priority.raise("preload");
    await settle();
    expect(waiting.started).toBe(false);

    priority.raise("interactive");
    await settle();
    // Before any running task ended.
    expect(waiting.started).toBe(true);
    expect(order).toEqual(["B1", "B2", "B3", "W"]);
    expect(running.every((t) => !t.released)).toBe(true);
    expect(queue.stats).toMatchObject({ running: 4, waiting: 0 });
    await drain([...running, waiting]);
  });

  it("ranks a raised query by the time it was raised", async () => {
    const queue = new QueryQueue(4);
    const order: string[] = [];
    const running = [1, 2, 3, 4].map((i) => hold(queue, order, `R${i}`, "interactive"));
    const priority = new Priority("background");
    // B is queued first, S1 after it; B is raised only then.
    const b = hold(queue, order, "B", priority);
    const s1 = hold(queue, order, "S1", "interactive");
    await settle();
    expect(order).toEqual(["R1", "R2", "R3", "R4"]);
    expect(queue.stats.byClass.background).toEqual({ running: 0, waiting: 1 });

    priority.raise("interactive");
    await settle();
    // All slots are taken: raising starts nothing.
    expect(order).toEqual(["R1", "R2", "R3", "R4"]);
    expect(queue.stats.byClass.interactive).toEqual({ running: 4, waiting: 2 });

    await releaseAndSettle(running[0] as Held);
    // S1 was waiting before the raise, so it goes first although B arrived earlier.
    expect(order).toEqual(["R1", "R2", "R3", "R4", "S1"]);
    expect(b.started).toBe(false);

    await releaseAndSettle(running[1] as Held);
    expect(order).toEqual(["R1", "R2", "R3", "R4", "S1", "B"]);
    await drain([...running, b, s1]);
    expect(queue.stats).toEqual({ running: 0, waiting: 0, peak: 4, byClass: idle() });
  });
});
