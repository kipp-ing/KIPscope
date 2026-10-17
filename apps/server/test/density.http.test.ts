import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import { ClickHouseSource } from "../src/clickhouse.ts";
import type { DataSource } from "../src/datasource.ts";
import { DensityCache } from "../src/density.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { testClient, testEventMapping, testMapping, testSource } from "./testdb.ts";

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
  workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
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
    expect(body.grid).toBe("1500000000"); // width / 400 = 1.5 s
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
    expect(short.grid).toBe("2500"); // 1 ms / 400
    expect(short.counts).toHaveLength(46);
    const expected = Array.from({ length: 46 }, (_, i) => (i % 5 === 0 ? 1 : 0));
    expect(short.counts).toEqual(expected);

    const far = (await density("spancar")).json();
    const widthNs = 180n * 86_400n * 1_000_000_000n;
    expect(far.width).toBe(widthNs.toString());
    expect(far.grid).toBe("38880000000000"); // 180 d / 400 = 10.8 h
    expect(far.start).toBe("-15552000000000000");
    expect(far.counts).toHaveLength(117);
    const want = new Array<number>(117).fill(0);
    want[0] = 2;
    want[1] = 1;
    want[114] = 1;
    want[116] = 1;
    expect(far.counts).toEqual(want);
  });

  it("finds the drives of drivecar", async () => {
    const res = await density("drivecar");
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.width).toBe("300000000000"); // 5 min; 73 bars over 6 h
    expect(body.grid).toBe("750000000"); // 750 ms
    expect(body.counts).toHaveLength(73);
    expect((body.counts as number[]).reduce((a, b) => a + b, 0)).toBe(233_161);
    // The 30 s pause (01:20:00-01:20:30) merges, the 90 s pause (03:05-03:06:30) splits; the 60 s
    // WAKE burst is active but not longer than 2 min; trickle buckets (1 row) are not active.
    expect(body.drives).toEqual([
      { from: "1790902800000000000", to: "1790904600000000000", rows: 177_180 },
      { from: "1790910000000000000", to: "1790910300000000000", rows: 30_030 },
      { from: "1790910390000000000", to: "1790910600000000000", rows: 21_021 },
    ]);
  });

  it("finds one drive in testcar, none in othercar, grid-wide ones in spancar", async () => {
    const test = (await density("testcar")).json();
    // One drive over the whole recording; the bucket with only the 10:00:00 SLOW point is below a tenth.
    expect(test.drives).toHaveLength(1);
    expect(test.drives[0].from).toBe(test.first);
    expect(test.drives[0].to).toBe(test.last);
    const sum = (test.counts as number[]).reduce((a, b) => a + b, 0);
    expect(test.drives[0].rows).toBe(sum - 1);

    expect((await density("othercar")).json().drives).toEqual([]); // one 45 ms run

    const S = 1_000_000_000n;
    const ns = (s: number) => (BigInt(s) * S).toString();
    expect((await density("spancar")).json().drives).toEqual([
      { from: ns(-38_880), to: ns(38_880), rows: 3 },
      { from: ns(1_767_212_640), to: ns(1_767_251_520), rows: 1 },
      { from: ns(1_790_812_800), to: ns(1_790_851_680), rows: 1 },
    ]);
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
      workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
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

describe("density queries", () => {
  it("sends the counts-only bucket query", async () => {
    // A client that records the text of every query it sends.
    const client = testClient();
    const texts: string[] = [];
    const recording = new Proxy(client, {
      get(target, key) {
        const member = Reflect.get(target, key, target);
        if (key !== "query") return typeof member === "function" ? member.bind(target) : member;
        return (params: Parameters<typeof client.query>[0]) => {
          texts.push(params.query);
          return client.query(params);
        };
      },
    });
    const cache = new DensityCache(
      new ClickHouseSource(recording, testMapping, 30, testEventMapping),
      () => new Date(1),
    );
    const density = await cache.get("drivecar");
    expect(density?.dataRef).toBe("drivecar");
    const flat = texts.map((text) => text.replace(/\s+/g, " ").trim());
    expect(flat).toHaveLength(2);
    // refExtent: count, first and last row time of the data ref.
    expect(flat[0]).toContain("count()");
    expect(flat[0]).toContain("min(utc)");
    // refBuckets without row times: today's query, no min or max of the time column.
    expect(flat[1]).toBe(
      "WITH toUnixTimestamp64Nano(utc) AS x SELECT toString(x - positiveModulo(x, {w:Int64})) AS b, count() FROM sdlog.signals WHERE vehicle = {ref:String} AND utc IS NOT NULL GROUP BY b",
    );
    expect(flat[1]).not.toMatch(/\b(min|max)\(/);
  });
});
