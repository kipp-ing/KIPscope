import { describe, expect, it } from "vitest";
import type { DataSource, Scope } from "../src/datasource.ts";
import { guardScoped, ScopeGuardError } from "../src/scope.ts";

/** 2026-10-01T01:00:00Z and 02:00:00Z in ns, by hand. */
const T1 = 1790816400000000000n;
const T2 = 1790820000000000000n;
const S = 1_000_000_000n;
const SCOPE: Scope = { dataRef: "testcar", from: T1, to: T2 };

/** A source that records which methods reached it. */
function recordingSource() {
  const reached: string[] = [];
  const method = (name: string, answer: unknown) => async () => {
    reached.push(name);
    return answer;
  };
  const source = {
    info: { kind: "memory", database: "d", table: "t" },
    ping: async () => {
      reached.push("ping");
    },
    listSignals: method("listSignals", []),
    raw: method("raw", []),
    buckets: method("buckets", []),
    count: method("count", 0),
    before: method("before", undefined),
    after: method("after", undefined),
    extent: method("extent", undefined),
    refExtent: method("refExtent", undefined),
    refCount: method("refCount", 0),
    refBuckets: method("refBuckets", []),
    loggerGaps: method("loggerGaps", { gaps: [] }),
    firstTimes: method("firstTimes", new Map()),
    stateChanges: method("stateChanges", []),
    events: method("events", []),
  } as unknown as DataSource;
  return { source, reached };
}

describe("guardScoped (add-scope Z10)", () => {
  it("refuses unbounded calls before the adapter", async () => {
    const { source, reached } = recordingSource();
    const logged: string[] = [];
    const guarded = guardScoped(source, () => [SCOPE], { error: (m) => logged.push(m) });
    const ref = { dataRef: "testcar", name: "Fast_100h.SIG_A", sna: [] };

    // A scope-taking call without a scope, and a raw range that leaves the scope: refused.
    await expect(guarded.listSignals()).rejects.toBeInstanceOf(ScopeGuardError);
    await expect(guarded.raw(ref, T1, T2 + S)).rejects.toBeInstanceOf(ScopeGuardError);
    expect(reached).toEqual([]);
    // One log line per method, naming it, also when the same mistake repeats.
    await expect(guarded.listSignals()).rejects.toBeInstanceOf(ScopeGuardError);
    await expect(guarded.raw(ref, T1, T2 + S)).rejects.toBeInstanceOf(ScopeGuardError);
    expect(logged).toHaveLength(2);
    expect(logged.some((line) => line.includes("listSignals"))).toBe(true);
    expect(logged.some((line) => line.includes("raw"))).toBe(true);

    // A scoped call reaches the adapter.
    await guarded.refExtent("testcar", SCOPE);
    expect(reached).toEqual(["refExtent"]);
  });

  it("lets bounded ranges and ping through, and refuses a data ref no scope holds", async () => {
    const { source, reached } = recordingSource();
    const guarded = guardScoped(source, () => [SCOPE], { error: () => {} });
    const ref = { dataRef: "testcar", name: "Fast_100h.SIG_A", sna: [] };
    await guarded.raw(ref, T1, T2);
    await guarded.buckets(ref, T1 + S, T2 - S, S);
    await guarded.count(ref, T1, T1 + S);
    await guarded.ping(new AbortController().signal);
    expect(reached).toEqual(["raw", "buckets", "count", "ping"]);
    // The range is inside the time but another data ref is held by no scope.
    await expect(guarded.raw({ ...ref, dataRef: "othercar" }, T1, T2)).rejects.toBeInstanceOf(
      ScopeGuardError,
    );
    // Without any held scope nothing with a range passes.
    const none = guardScoped(source, () => [], { error: () => {} });
    await expect(none.raw(ref, T1, T2)).rejects.toBeInstanceOf(ScopeGuardError);
    // Every scope-taking method is refused without a scope.
    const calls: [string, () => Promise<unknown>][] = [
      ["extent", () => guarded.extent(ref)],
      ["refExtent", () => guarded.refExtent("testcar")],
      ["refCount", () => guarded.refCount("testcar")],
      ["before", () => guarded.before(ref, T1)],
      ["after", () => guarded.after(ref, T1)],
      ["refBuckets", () => guarded.refBuckets("testcar", S, false)],
      ["loggerGaps", () => guarded.loggerGaps("testcar", S, 2n * S)],
      ["firstTimes", () => guarded.firstTimes("testcar", ["A"], 10)],
      ["stateChanges", () => guarded.stateChanges(ref, { kind: "text" }, 10)],
      ["events", () => guarded.events("testcar", 10)],
    ];
    for (const [name, call] of calls) {
      await expect(call(), name).rejects.toBeInstanceOf(ScopeGuardError);
    }
  });
});
