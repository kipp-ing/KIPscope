import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AdxSource } from "../src/adx.ts";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { SourceAdapter } from "../src/datasource.ts";
import { completeSource, nativeMethods } from "../src/fallbacks.ts";
import { KustoClient } from "../src/kusto.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { adxEventMapping, adxMapping, adxMgmt, TEST_ADX_DATABASE, testAdxUrl } from "./adxdb.ts";
import { B, FIXTURE_SIGNALS } from "./conformance/fixture.ts";

const S = 1_000_000_000n;

const client = () =>
  new KustoClient({ cluster: testAdxUrl(), database: TEST_ADX_DATABASE, timeoutSeconds: 30 });
const adapter = (mapping = adxMapping, events = adxEventMapping) =>
  new AdxSource(client(), mapping, events);

describe("ADX adapter on the emulator", () => {
  it("reads through a stored function", async () => {
    // KSignals() renames the columns of another table to the default layout (seed-adx.ts).
    const source = adapter({ ...adxMapping, table: "KSignals" });
    const listed = await source.listSignals();
    expect(listed.length).toBe(8);
    expect(listed.map((s) => `${s.dataRef}/${s.name}`).sort()).toEqual(
      FIXTURE_SIGNALS.map((s) => `${s.dataRef}/${s.name}`),
    );
    const points = await source.raw(
      { dataRef: "conf-a", name: "Lin.RAMP", sna: [] },
      B + S,
      B + 2n * S,
    );
    expect(points.length).toBe(100);
    expect(points[0]).toEqual({ t: B + S, v: 100 });
    expect(points[99]).toEqual({ t: B + S + 990_000_000n, v: 199 });
  });

  it("fails on a truncated answer", async () => {
    // The emulator cuts the answer at 500,000 rows and reports LimitsExceeded in the completion frame.
    await expect(client().query("range i from 1 to 600000 step 1", {})).rejects.toThrow(
      /LimitsExceeded/,
    );
  });

  it("treats a missing events table and text column as none", async () => {
    const noEvents = adapter(adxMapping, { ...adxEventMapping, table: "nope" });
    expect(await noEvents.events("conf-a", 100)).toBeUndefined();
    const noText = adapter({ ...adxMapping, text: "nope" });
    const listed = await noText.listSignals();
    expect(listed.length).toBe(8);
    expect(listed.every((s) => s.text !== true)).toBe(true);
    // Any other error fails: a missing signals table is no "none".
    await expect(adapter({ ...adxMapping, table: "nope" }).listSignals()).rejects.toThrow(/nope/);
  });

  it("cancels a query on abort", async () => {
    // A cancelled query still unwinding from an earlier run slows the next one down: start idle.
    for (let attempt = 0; attempt < 120; attempt++) {
      const busy = await adxMgmt(`.show queries | where State == "InProgress" | count`);
      if (Number(busy[0]?.[0]) <= 1) break; // this very command is the one in progress
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const id = `KIPscope.test;${randomUUID()}`;
    const withId: typeof fetch = (input, init) =>
      fetch(input, {
        ...init,
        headers: { ...(init?.headers as Record<string, string>), "x-ms-client-request-id": id },
      });
    const slow = new KustoClient({
      cluster: testAdxUrl(),
      database: TEST_ADX_DATABASE,
      timeoutSeconds: 60,
      fetch: withId,
    });
    const reason = new Error("aborted by the test");
    const controller = new AbortController();
    const outcome = slow
      .query("range i from 1 to 3000000000 step 1 | summarize sum(i % 7)", {}, controller.signal)
      .then(
        () => "resolved" as unknown,
        (error: unknown) => error,
      );
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const abortedAt = performance.now();
    controller.abort(reason);
    expect(await outcome).toBe(reason);
    expect(performance.now() - abortedAt).toBeLessThan(100);

    // The emulator lists the cancelled query once it has stopped it; under load that can take a while.
    let state = "";
    let duration = "";
    for (let attempt = 0; attempt < 120 && state === ""; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const rows = await adxMgmt(
        `.show queries | where ClientActivityId == "${id}" | project State, Duration`,
      );
      [state, duration] = (rows[0] ?? ["", ""]) as [string, string];
    }
    expect(state).toBe("Cancelled");
    const [h, m, s] = duration.split(":").map(Number) as [number, number, number];
    expect(h * 3600 + m * 60 + s).toBeLessThan(2);
  }, 150_000);

  it("reports the ADX source in meta", async () => {
    const source = completeSource(adapter());
    const app = buildApp({
      catalog: new Catalog(source, async () => new Map()),
      source,
      workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
      meta: {
        build: { commit: "7c1e2a9", dirty: false, startedAt: new Date("2026-10-17T10:00:00Z") },
        source: source.info,
        ping: (signal) => source.ping(signal),
      },
    });
    try {
      const res = await app.inject({ url: "/api/meta" });
      expect(res.statusCode).toBe(200);
      expect(res.json().source).toMatchObject({
        kind: "adx",
        database: "kipscope_test",
        table: "signals",
        reachable: true,
      });
      expect(res.body).not.toContain(testAdxUrl());
      expect(res.body).not.toContain("127.0.0.1");
      expect(res.body).not.toContain("8125");
    } finally {
      await app.close();
    }
  });

  it("implements the measured fast paths only", () => {
    const source: SourceAdapter = adapter();
    expect(nativeMethods(source).sort()).toEqual(
      ["events", "loggerGaps", "refCount", "stateChanges"].sort(),
    );
    for (const name of [
      "ping",
      "listSignals",
      "raw",
      "before",
      "after",
      "buckets",
      "refBuckets",
      "refCount",
      "loggerGaps",
      "stateChanges",
      "events",
    ] as const) {
      expect(typeof source[name], name).toBe("function");
    }
    for (const name of ["count", "extent", "refExtent", "firstTimes"] as const) {
      expect(source[name], name).toBeUndefined();
    }
    expect(source.info).toEqual({
      kind: "adx",
      database: "kipscope_test",
      table: "signals",
      eventsTable: "kipscope_test.events",
    });
  });
});
