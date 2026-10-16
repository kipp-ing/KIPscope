import { describe, expect, it } from "vitest";
import type { DataSource } from "../src/datasource.ts";
import { QueryQueue, queuedSource } from "../src/queue.ts";

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
    expect(queue.stats).toEqual({ running: 0, waiting: 0, peak: 4 });
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

describe("queuedSource gaps", () => {
  it("forwards loggerGaps and firstTimes to the wrapped source", async () => {
    const seen: unknown[][] = [];
    const stub = {
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
    expect(seen.map((a) => a[0])).toEqual(["car", "car"]);
  });
});
