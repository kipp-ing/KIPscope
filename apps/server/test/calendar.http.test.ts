import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { untilCounted } from "./calendarKit.ts";
import { type Call, codeOf, type ScopeApp, scopeApp } from "./scopeApp.ts";
import { testClient, testSource } from "./testdb.ts";

// Spec range-picker "Calendar density", "Calendar request rules", "Calendar bounded by window and
// scope". Hand-computed values (no constant of the code under test is imported):
//   M10 = the local month October 2026 under TZ=Europe/Berlin: from 2026-09-30T22:00:00Z =
//   1790805600 s, to 2026-10-31T23:00:00Z = 1793487600 s (31 d + 1 h = 745 hours).
// Without a scope (full mode) the calendar comes from the counted vehicle-days (speed-up-whole-scans
// B6): the first answer may list `pending` days, and the counts are asked for until none is left.
// The values are those of one bucket query over the window, as before.
const S = 1_000_000_000n;
const M10_FROM = "2026-09-30T22:00:00Z";
const M10_TO = "2026-10-31T23:00:00Z";
const M10_FROM_NS = 1790805600n * S;
const M10_TO_NS = 1793487600n * S;
/** 2026-10-01T01:00:00Z and 02:00:00Z in ns (the scope tests' T1 and T2). */
const T1 = 1790816400n * S;
const T2 = 1790820000n * S;
const WIDTH_60S = 60n * S;

const range = (from: string, to: string) => `from=${from}&to=${to}`;

describe("GET /api/calendar on the test DB", () => {
  const real = testSource();
  let failing = false;
  /** The test source, whose bucket queries fail on demand ("source unreachable"). */
  const source = {
    listSignals: (...args: Parameters<typeof real.listSignals>) => real.listSignals(...args),
    refExtent: (...args: Parameters<typeof real.refExtent>) => real.refExtent(...args),
    refCount: (...args: Parameters<typeof real.refCount>) => real.refCount(...args),
    refBuckets: (...args: Parameters<typeof real.refBuckets>) =>
      failing ? Promise.reject(new Error("connect ECONNREFUSED")) : real.refBuckets(...args),
  } as unknown as DataSource;
  const catalog = new Catalog(source, async () => new Map());
  const newApp = () =>
    buildApp({
      catalog,
      source,
      workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
    });
  const app = newApp();
  const calendar = (query: string) => app.inject({ url: `/api/calendar?${query}` });
  /** The answer once every day of the window is counted. */
  const counted = async (query: string) => {
    const done = await untilCounted(async () => {
      const res = await calendar(query);
      return { status: res.statusCode, body: res.json(), res };
    });
    return done.res;
  };

  beforeAll(async () => {
    await app.ready();
    await catalog.refresh();
  });
  afterAll(() => app.close());

  it("counts drivecar rows per hour and finds its drives on the minute grid", async () => {
    const res = await counted(`dataRef=drivecar&${range(M10_FROM, M10_TO)}`);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.pending).toBeUndefined();
    expect(body.dataRef).toBe("drivecar");
    expect(body.from).toBe("1790805600000000000");
    expect(body.to).toBe("1793487600000000000");
    expect(body.scope).toBeUndefined();
    const hours = body.hours as number[];
    expect(hours).toHaveLength(745);
    expect(hours.reduce((a, b) => a + b, 0)).toBe(233_161);
    // 2026-10-02T00:00Z is hour 26 of M10 (24 h + the 2 h before local midnight).
    const nonzero = new Map(hours.flatMap((n, i) => (n === 0 ? [] : [[i, n] as const])));
    expect(Object.fromEntries(nonzero)).toEqual({
      26: 360,
      27: 177_360,
      28: 3_360,
      29: 51_360,
      30: 360,
      31: 360,
      32: 1,
    });
    // On the 60 s grid the 90 s pause 03:05:00-03:06:30 is one empty minute (03:05-03:06 holds 6
    // trickle rows, below a tenth of the peak 6,006) and merges; the 60 s WAKE minute is no drive.
    expect(body.drives).toEqual([
      { from: "1790902800000000000", to: "1790904600000000000", rows: 177_180 },
      { from: "1790910000000000000", to: "1790910600000000000", rows: 51_060 },
    ]);
  });

  it("answers 400, 404 and empty windows", async () => {
    const bad = [
      "dataRef=drivecar", // no from and to
      `dataRef=drivecar&${range("2026-10-01T00:00:30Z", "2026-10-02T00:00:00Z")}`, // 30 s off the grid
      `dataRef=drivecar&${range("2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z")}`, // to equals from
      `dataRef=drivecar&${range("2026-10-01T00:00:00Z", "2026-11-03T00:00:00Z")}`, // 33 days
    ];
    for (const query of bad) {
      const res = await calendar(query);
      expect(res.statusCode, query).toBe(400);
      expect(res.json().error.code, query).toBe("invalid_request");
    }
    // Exactly 32 days is still allowed (D-089).
    const edge = await calendar(
      `dataRef=drivecar&${range("2026-10-01T00:00:00Z", "2026-11-02T00:00:00Z")}`,
    );
    expect(edge.statusCode, edge.body).toBe(200);
    expect(edge.json().hours).toHaveLength(768); // 32 d * 24 h

    const unknown = await calendar(`dataRef=nocar&${range(M10_FROM, M10_TO)}`);
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json().error.code).toBe("unknown_data_ref");

    // testcar has no row in 2025: zeros, no drives, no error.
    const empty = await counted(
      `dataRef=testcar&${range("2025-10-01T00:00:00Z", "2025-10-02T00:00:00Z")}`,
    );
    expect(empty.statusCode, empty.body).toBe(200);
    expect(empty.json().hours).toEqual(new Array(24).fill(0));
    expect(empty.json().drives).toEqual([]);
  });

  it("leaves a day the source fails on pending, never an error", async () => {
    // A fresh app, so no counted day hides the failure. The days are counted at idle in the
    // background: a failing source leaves them pending, and the request itself answers 200.
    const fresh = newApp();
    failing = true;
    try {
      const res = await fresh.inject({
        url: `/api/calendar?dataRef=testcar&${range("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z")}`,
      });
      expect(res.statusCode, res.body).toBe(200);
      await new Promise((r) => setTimeout(r, 200));
      const again = await fresh.inject({
        url: `/api/calendar?dataRef=testcar&${range("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z")}`,
      });
      expect(again.statusCode).toBe(200);
      expect(again.json().pending).toEqual([
        { from: "1790812800000000000", to: "1790899200000000000" },
      ]);
    } finally {
      failing = false;
      await fresh.close();
    }
  });
});

describe("GET /api/calendar with a scope", () => {
  const apps: ScopeApp[] = [];
  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });

  /** Waits until the adapter has received no new call for `quietMs` (the scope's prefetches). */
  async function settle(calls: Call[], quietMs = 400) {
    let seen = -1;
    while (seen !== calls.length) {
      seen = calls.length;
      await new Promise((resolve) => setTimeout(resolve, quietMs));
    }
  }

  it("cuts the window to the scope and skips an empty cut", async () => {
    const t = await scopeApp({ adapter: testSource() });
    apps.push(t);
    const set = await t.command({
      type: "scope.set",
      dataRef: "testcar",
      from: "2026-10-01T01:00:00Z",
      to: "2026-10-01T02:00:00Z",
    });
    expect(set.status).toBe(200);
    await settle(t.calls);

    // M10: hours only at index 3 (01:00Z is 3 h after 22:00Z), as many as the DB holds in [T1, T2).
    const mark = t.calls.length;
    const res = await t.get(`/api/calendar?dataRef=testcar&${range(M10_FROM, M10_TO)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.from).toBe(M10_FROM_NS.toString());
    expect(res.body.to).toBe(M10_TO_NS.toString());
    expect(res.body.scope).toEqual({ from: T1.toString(), to: T2.toString() });
    const hours = res.body.hours as number[];
    expect(hours).toHaveLength(745);
    const expected = Number(
      (
        await (
          await testClient().query({
            query: `SELECT count() FROM sdlog.signals WHERE vehicle = 'testcar'
                    AND utc >= toDateTime64('2026-10-01 01:00:00', 3, 'UTC')
                    AND utc < toDateTime64('2026-10-01 02:00:00', 3, 'UTC')`,
            format: "TabSeparated",
          })
        ).text()
      ).trim(),
    );
    expect(expected).toBeGreaterThan(0);
    expect(hours[3]).toBe(expected);
    expect(hours.filter((n) => n !== 0)).toHaveLength(1);
    const asked = t.calls.slice(mark);
    expect(asked.filter((c) => c.method === "refExtent")).toEqual([]);
    // The scan bound's count of that scope: at most one (the scope's own load shares it).
    const counts = asked.filter((c) => c.method === "refCount");
    expect(counts.length).toBeLessThanOrEqual(1);
    for (const count of counts)
      expect(count.args[1]).toEqual({ dataRef: "testcar", from: T1, to: T2 });
    const buckets = asked.filter((c) => c.method === "refBuckets");
    expect(buckets).toHaveLength(1);
    expect(buckets[0]?.args[0]).toBe("testcar");
    expect(buckets[0]?.args[1]).toBe(WIDTH_60S);
    expect(buckets[0]?.args[2]).toBe(false);
    expect(buckets[0]?.args[3]).toEqual({ dataRef: "testcar", from: T1, to: T2 });
    for (const drive of res.body.drives as { from: string; to: string }[]) {
      expect(BigInt(drive.from) >= T1 && BigInt(drive.to) <= T2).toBe(true);
    }

    // November: the cut is empty, 30 d of zero hours, no drives and no source call.
    const mark2 = t.calls.length;
    const november = await t.get(
      `/api/calendar?dataRef=testcar&${range("2026-10-31T23:00:00Z", "2026-11-30T23:00:00Z")}`,
    );
    expect(november.status, JSON.stringify(november.body)).toBe(200);
    expect(november.body.hours).toEqual(new Array(720).fill(0));
    expect(november.body.drives).toEqual([]);
    expect(t.calls.slice(mark2).filter((c) => c.method !== "ping")).toEqual([]);

    // Another data ref than the scope's.
    const other = await t.get(`/api/calendar?dataRef=othercar&${range(M10_FROM, M10_TO)}`);
    expect(other.status).toBe(409);
    expect(codeOf(other.body)).toBe("out_of_scope");
  });

  it("answers 502 when the source fails on a scope's window", async () => {
    // The plain-scope path computes in the request, so a failing source is the request's error.
    const real = testSource();
    let failing = false;
    const adapter = new Proxy(real, {
      get(target, key, receiver) {
        const member = Reflect.get(target, key, receiver);
        if (key !== "refBuckets" || typeof member !== "function") return member;
        return (...args: unknown[]) =>
          failing ? Promise.reject(new Error("connect ECONNREFUSED")) : member.apply(target, args);
      },
    });
    const t = await scopeApp({ adapter });
    apps.push(t);
    const set = await t.command({
      type: "scope.set",
      dataRef: "testcar",
      from: "2026-10-01T01:00:00Z",
      to: "2026-10-01T02:00:00Z",
    });
    expect(set.status).toBe(200);
    await settle(t.calls);
    failing = true;
    const res = await t.get(`/api/calendar?dataRef=testcar&${range(M10_FROM, M10_TO)}`);
    expect(res.status).toBe(502);
    expect(codeOf(res.body)).toBe("source_error");
    expect(res.body.error.message).toContain("ECONNREFUSED");
  });

  it("answers 422 too_wide for a scope over the bound", async () => {
    // A scope that was allowed to be set, with a bound lowered afterwards (the same app, a count
    // that moved): the calendar of its window is refused by the bound before any bucket query.
    let rows = 10;
    const real = testSource();
    const adapter = new Proxy(real, {
      get(target, key, receiver) {
        const member = Reflect.get(target, key, receiver);
        if (key === "refCount") return async () => rows;
        return typeof member === "function" ? member.bind(target) : member;
      },
    });
    let clock = 1_000_000;
    const t = await scopeApp({ adapter, scanRows: 20, now: () => clock });
    apps.push(t);
    const set = await t.command({
      type: "scope.set",
      dataRef: "testcar",
      from: "2026-10-01T01:00:00Z",
      to: "2026-10-01T02:00:00Z",
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    await settle(t.calls);
    clock += 6 * 60_000;
    rows = 21;
    const mark = t.calls.length;
    const res = await t.get(`/api/calendar?dataRef=testcar&${range(M10_FROM, M10_TO)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error).toMatchObject({ code: "too_wide", rows: "21", limit: "20" });
    expect(t.calls.slice(mark).filter((c) => c.method === "refBuckets")).toEqual([]);
  });
});
