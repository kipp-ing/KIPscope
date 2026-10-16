import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { testClient, testSource } from "./testdb.ts";

const real = testSource();
let failing = false;
/** Data refs of every `refExtent` call, in order: one per density computation. */
const extentCalls: string[] = [];
/** The test source, whose density queries fail on demand ("source unreachable"). */
const source = {
  listSignals: (abort?: AbortSignal) => real.listSignals(abort),
  refExtent: (...args: Parameters<typeof real.refExtent>) => {
    extentCalls.push(args[0]);
    return failing ? Promise.reject(new Error("connect ECONNREFUSED")) : real.refExtent(...args);
  },
  refBuckets: (...args: Parameters<typeof real.refBuckets>) =>
    failing ? Promise.reject(new Error("connect ECONNREFUSED")) : real.refBuckets(...args),
} as unknown as DataSource;
const catalog = new Catalog(source, async () => new Map());
const app = buildApp({
  catalog,
  source,
  workspace: new WorkspaceStore({ signalExists: () => true }),
});

const density = (dataRef?: string) =>
  app.inject({ url: "/api/density", query: dataRef === undefined ? {} : { dataRef } });

/** Counts testcar rows with a timestamp in [from, to) straight from the test DB. */
async function dbCount(from?: string, to?: string): Promise<number> {
  const range = from
    ? `AND utc >= toDateTime64('${from}', 3, 'UTC') AND utc < toDateTime64('${to}', 3, 'UTC')`
    : "";
  const res = await testClient().query({
    query: `SELECT count() FROM sdlog.signals WHERE vehicle = 'testcar' AND utc IS NOT NULL ${range}`,
    format: "TabSeparated",
  });
  return Number((await res.text()).trim());
}

describe("GET /api/density", () => {
  // Ready first, so the series plugin listens for the load and prefetches (design Q4).
  beforeAll(async () => {
    await app.ready();
    await catalog.refresh();
  });
  afterAll(() => app.close());

  it("computes after the catalog load without a request, and a request does not recompute", async () => {
    // beforeAll only refreshed the catalog; no density request has been made yet.
    await vi.waitFor(() => expect(extentCalls).toContain("testcar"), { timeout: 20_000 });
    const res = await density("testcar");
    expect(res.statusCode).toBe(200);
    expect(extentCalls.filter((ref) => ref === "testcar")).toHaveLength(1);
  });

  it("counts testcar rows in 10 min buckets", async () => {
    const res = await density("testcar");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const first = 1_790_812_800_000_000_000n; // 2026-10-01T00:00:00Z
    expect(body.dataRef).toBe("testcar");
    expect(body.first).toBe(first.toString());
    expect(body.last).toBe((first + 36_000_000_000_000n).toString()); // 10:00:00Z
    expect(body.width).toBe("600000000000"); // 10 min; 5 min would need 121 buckets
    expect(body.start).toBe(body.first);
    expect(body.counts).toHaveLength(61);
    const sum = (body.counts as number[]).reduce((a, b) => a + b, 0);
    expect(sum).toBe(await dbCount());
    expect(body.counts[0]).toBe(await dbCount("2026-10-01 00:00:00", "2026-10-01 00:10:00"));
    // 10 min of SIG_A/B/C at 5 ms are 360,000 rows; the first bucket holds at least those.
    expect(body.counts[0]).toBeGreaterThanOrEqual(360_000);
  });

  it("picks the width for short and pre-1970 extents", async () => {
    const short = (await density("othercar")).json();
    expect(short.width).toBe("1000000"); // 1 ms
    expect(short.counts).toHaveLength(46);
    const expected = Array.from({ length: 46 }, (_, i) => (i % 5 === 0 ? 1 : 0));
    expect(short.counts).toEqual(expected);

    const far = (await density("spancar")).json();
    const widthNs = 180n * 86_400n * 1_000_000_000n;
    expect(far.width).toBe(widthNs.toString());
    expect(far.start).toBe("-15552000000000000");
    expect(far.counts).toHaveLength(117);
    const want = new Array<number>(117).fill(0);
    want[0] = 2;
    want[1] = 1;
    want[114] = 1;
    want[116] = 1;
    expect(far.counts).toEqual(want);
  });

  it("answers 400, 404 and 502", async () => {
    const missing = await density();
    expect(missing.statusCode).toBe(400);
    expect(missing.json().error.code).toBe("invalid_request");
    const empty = await density("");
    expect(empty.statusCode).toBe(400);
    expect(empty.json().error.code).toBe("invalid_request");

    const unknown = await density("nocar");
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("unknown_data_ref");

    // A fresh app, so no cached density hides the failure.
    const fresh = buildApp({
      catalog,
      source,
      workspace: new WorkspaceStore({ signalExists: () => true }),
    });
    failing = true;
    try {
      const res = await fresh.inject({ url: "/api/density", query: { dataRef: "testcar" } });
      expect(res.statusCode).toBe(502);
      expect(res.json().error.code).toBe("source_error");
      expect(res.json().error.message).toContain("ECONNREFUSED");
    } finally {
      failing = false;
      await fresh.close();
    }
  });
});
