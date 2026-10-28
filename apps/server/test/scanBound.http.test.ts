/**
 * The scan bound over HTTP (speed-up-whole-scans, scope "Scan bound", "Too wide answers", "A
 * too-wide scope is refused"; series-query "Series within the row budget", "Value when its gap
 * info is too wide"; events "Events within the scan bound"). The row counts come from the test
 * DB itself, never from the code under test.
 */
import { EMPTY_WORKSPACE, tooWideText, widenScope } from "@kipscope/shared";
import { afterEach, describe, expect, it } from "vitest";
import type { SourceAdapter } from "../src/datasource.ts";
import { closeApps, stateOf, unlink, unlinked } from "./caseApp.ts";
import { at } from "./caseKit.ts";
import { codeOf, type ScopeApp, scopeApp } from "./scopeApp.ts";
import { testClient, testSource } from "./testdb.ts";

/** 2026-10-01T01:00:00Z and 02:00:00Z in ns, by hand (1790816400 s and 1790820000 s). */
const T1 = 1790816400000000000n;
const T2 = 1790820000000000000n;

const apps: ScopeApp[] = [];
const open = async (options: Parameters<typeof scopeApp>[0]) => {
  const t = await scopeApp(options);
  apps.push(t);
  return t;
};
afterEach(async () => {
  await Promise.all(apps.splice(0).map((t) => t.close()));
  await closeApps();
});

/** testcar rows straight from the test DB: all of them, or in [from, to) (UTC). */
async function testcarRows(from?: string, to?: string): Promise<number> {
  const range = from
    ? `AND utc >= toDateTime64('${from}', 3, 'UTC') AND utc < toDateTime64('${to}', 3, 'UTC')`
    : "";
  const res = await testClient().query({
    query: `SELECT count() FROM sdlog.signals WHERE vehicle = 'testcar' ${range}`,
    format: "TabSeparated",
  });
  return Number((await res.text()).trim());
}

const group = (n: number) => n.toLocaleString("en-US");

describe("the scan bound over HTTP", () => {
  it("answers too_wide on the routes", async () => {
    // Full mode, no scope, 1,000 rows: testcar (the whole data ref) is far over it.
    const rows = await testSource().refCount("testcar");
    expect(rows).toBeGreaterThan(1000);
    const t = await open({ adapter: testSource(), scanRows: 1000 });
    const message = `too wide: ${group(rows)} rows, more than the 1,000 a query may read; choose a shorter range`;
    for (const url of [
      "/api/density?dataRef=testcar",
      "/api/gaps?dataRef=testcar",
      "/api/value?signal=testcar/Fast_100h.SIG_A&t=2026-10-01T01:30:00Z",
    ]) {
      const res = await t.get(url);
      expect(res.status, `${url}: ${JSON.stringify(res.body)}`).toBe(422);
      expect(res.body.error.code, url).toBe("too_wide");
      expect(res.body.error.limit, url).toBe("1000");
      expect(res.body.error.rows, url).toBe(String(rows));
      expect(res.body.error.message, url).toBe(message);
    }
  });

  it("answers too_wide for a value without bounded gap info", async () => {
    const rows = await testSource().refCount("testcar");
    const t = await open({ adapter: testSource(), scanRows: rows - 1 });
    const mark = t.calls.length;
    const res = await t.get("/api/value?signal=testcar/Fast_100h.SIG_A&t=2026-10-01T01:30:00Z");
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(codeOf(res.body)).toBe("too_wide");
    expect(res.body).not.toHaveProperty("value");
    // The source never got a logger-gap query: the bound refused the range first.
    expect(t.calls.filter((c) => c.method === "loggerGaps")).toEqual([]);
    expect(t.calls.slice(mark).filter((c) => c.method === "loggerGaps")).toEqual([]);
  });

  it("refuses a series over the row budget", async () => {
    // A stub with only the required methods and `count`: 2,000 rows behind the server's fallbacks
    // with the bound at 1,000.
    const calls: string[] = [];
    const note =
      <T>(method: string, value: T) =>
      async (): Promise<T> => {
        calls.push(method);
        return value;
      };
    const adapter: SourceAdapter = {
      info: { kind: "stub", database: "d", table: "t" },
      ping: async () => {},
      listSignals: async () => [{ dataRef: "car", name: "S" }],
      raw: note("raw", []),
      before: note("before", undefined),
      after: note("after", undefined),
      buckets: note("buckets", []),
      refBuckets: note("refBuckets", []),
      count: note("count", 2000),
    };
    const t = await open({ adapter, scanRows: 1000 });
    const mark = calls.length;
    const res = await t.get("/api/series?signal=car/S&from=0&to=1000000000&target=100");
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.error).toMatchObject({ code: "too_wide", rows: "2000", limit: "1000" });
    expect(res.body.error.message).toBe(tooWideText({ rows: "2000", limit: "1000" }));
    // The count was asked, and neither `raw` nor `buckets` followed it.
    expect(calls.slice(mark)).toContain("count");
    expect(calls.slice(mark)).not.toContain("raw");
    expect(calls.slice(mark)).not.toContain("buckets");
  });

  it("refuses a scope wider than the bound", async () => {
    // N = testcar's rows in [T1, T2): that scope is accepted, the widened one (00:00 … 03:00) is not.
    const n = await testcarRows("2026-10-01 01:00:00", "2026-10-01 02:00:00");
    expect(n).toBeGreaterThan(0);
    const t = await open({ adapter: testSource(), scanRows: n });
    const scope = { dataRef: "testcar", from: T1.toString(), to: T2.toString() };
    const set = await t.command({ type: "scope.set", ...scope });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    const revision = t.store.revision;

    const widened = widenScope(t.store.workspace.scope as never);
    const wide = await t.command({ type: "scope.set", ...widened });
    expect(wide.status, JSON.stringify(wide.body)).toBe(422);
    expect(codeOf(wide.body)).toBe("too_wide");
    expect(wide.body.ok).toBe(false);
    expect(wide.body.limit).toBe(String(n));
    const rows = await testcarRows("2026-10-01 00:00:00", "2026-10-01 03:00:00");
    expect(wide.body.rows).toBe(String(rows));
    expect(wide.body.message).toBe(tooWideText({ rows: String(rows), limit: String(n) }));
    // The scope stays and the revision is the same.
    expect(t.store.workspace.scope).toEqual(scope);
    expect(t.store.revision).toBe(revision);
  });

  it("refuses a span over the bound without a source call", async () => {
    const t = await open({ adapter: testSource(), scanSpan: 3_600_000_000_000n });
    const mark = t.calls.length;
    // 2 h is above the 1 h span: refused with the span, with no count and no list query.
    const res = await t.command({
      type: "scope.set",
      dataRef: "testcar",
      from: T1.toString(),
      to: (T1 + 2n * 3_600_000_000_000n).toString(),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(codeOf(res.body)).toBe("too_wide");
    expect(res.body.span).toBe((2n * 3_600_000_000_000n).toString());
    expect(res.body.maxSpan).toBe("3600000000000");
    expect(res.body.message).toBe(
      "too wide: 2 h is more than the 1 h a query may span; choose a shorter range",
    );
    expect(t.calls.slice(mark).filter((c) => c.method !== "ping")).toEqual([]);
    expect(t.store.workspace.scope).toBeUndefined();
  });

  it("refuses a view.open and a case step into a too-wide scope", async () => {
    // view.open: the view's scope [T1, T2 + 2 h) has more rows than the bound.
    const n = await testcarRows("2026-10-01 01:00:00", "2026-10-01 02:00:00");
    const t = await open({ adapter: testSource(), scanRows: n });
    const view = {
      kipscope: "view",
      version: 1,
      title: "Wide",
      data: ["testcar"],
      linkTime: true,
      cursors: { diff: false },
      digits: 3,
      windows: [
        {
          kind: "timeseries",
          from: "2026-10-01T01:10:00Z",
          to: "2026-10-01T01:20:00Z",
          mode: "line",
          envelope: false,
          signals: ["testcar/Fast_100h.SIG_A"],
        },
      ],
      scope: { dataRef: "testcar", from: "2026-10-01T01:00:00Z", to: "2026-10-01T04:00:00Z" },
    };
    const revision = t.store.revision;
    const opened = await t.command({ type: "view.open", view });
    expect(opened.status, JSON.stringify(opened.body)).toBe(422);
    expect(codeOf(opened.body)).toBe("too_wide");
    expect(t.store.revision).toBe(revision);
    expect(t.store.workspace.scope).toBeUndefined();

    // case.go: entry 0's scope (00:59 … 01:11) is within the bound, entry 2's (04:49 … 05:11) is not.
    const bound = await testcarRows("2026-10-01 00:59:00", "2026-10-01 01:11:00");
    const longer = await testcarRows("2026-10-01 04:49:00", "2026-10-01 05:11:00");
    expect(longer).toBeGreaterThan(bound);
    const c = await unlinked({ scanRows: bound });
    const before = await stateOf(c.t.anon, c.id);
    const step = await c.t.anon.command({ type: "case.go", index: 2 }, c.id);
    expect(step.status, JSON.stringify(step.body)).toBe(422);
    expect(codeOf(step.body)).toBe("too_wide");
    const after = await stateOf(c.t.anon, c.id);
    expect(after.workspace.scope).toEqual(before.workspace.scope);
    expect(after.workspace.case.current).toBe(0);
    expect(after.revision).toBe(before.revision);
    // Unlink still works: it asks no count (the span of the catalog's sessions, B4).
    await unlink(c.t.anon, c.id);
    expect((await stateOf(c.t.anon, c.id)).workspace.scope).toMatchObject({
      dataRef: "testcar",
      from: at(0, 59),
      to: at(5, 11),
      object: true,
    });
  });

  it("answers 422 on the catalog and the signals when the list load is refused", async () => {
    // A restored scope (state file) whose list the bound refuses: the routes answer too_wide once
    // the load has failed (until then 503 catalog_unavailable).
    const n = await testcarRows("2026-10-01 01:00:00", "2026-10-01 02:00:00");
    const scope = { dataRef: "testcar", from: T1.toString(), to: T2.toString() };
    const t = await open({
      adapter: testSource(),
      mode: "scoped",
      scanRows: n - 1,
      initial: { revision: 1, workspace: { ...EMPTY_WORKSPACE, scope } },
    });
    for (const url of ["/api/catalog", "/api/signals?q=sig"]) {
      let last: Awaited<ReturnType<typeof t.get>> | undefined;
      for (let i = 0; i < 100; i++) {
        last = await t.get(url);
        if (last.status !== 503) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect(last?.status, `${url}: ${JSON.stringify(last?.body)}`).toBe(422);
      expect(codeOf(last?.body)).toBe("too_wide");
      expect(last?.body.error.limit).toBe(String(n - 1));
    }
  });

  it("skips the events of a data ref over the bound", async () => {
    // Full mode, no scope: testcar is one row over the bound; its catalog loads at start.
    const rows = await testSource().refCount("testcar");
    const t = await open({ adapter: testSource(), scanRows: rows - 1, startup: true });
    // The prefetch runs after the catalog load; wait until the events of some other data ref ran.
    await waitFor(() => t.calls.some((c) => c.method === "events" && c.args[0] !== "testcar"));
    await new Promise((r) => setTimeout(r, 500));
    const forTestcar = t.calls.filter((c) => {
      if (c.method === "events") return c.args[0] === "testcar";
      if (c.method === "stateChanges")
        return (c.args[0] as { dataRef?: string })?.dataRef === "testcar";
      return false;
    });
    expect(forTestcar).toEqual([]);

    const res = await t.get("/api/events?dataRef=testcar");
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(codeOf(res.body)).toBe("too_wide");
    expect(res.body.error.rows).toBe(String(rows));
    expect(t.calls.filter((c) => c.method === "events" && c.args[0] === "testcar")).toEqual([]);

    // A data ref within the bound still answers.
    const small = await t.get("/api/events?dataRef=othercar");
    expect(small.status, JSON.stringify(small.body)).toBe(200);
  });
});

/** Polls `test` on real timers for up to 20 s. */
async function waitFor(test: () => boolean) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    if (test()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("waited for a source call that never came");
}
