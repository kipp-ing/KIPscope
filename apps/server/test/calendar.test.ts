import { afterEach, describe, expect, it } from "vitest";
import type { SourceAdapter } from "../src/datasource.ts";
import { currentPriority, type QueryClass } from "../src/priority.ts";
import {
  calendarUrl,
  DAY,
  OCT1,
  OCT2,
  pause,
  S,
  TESTCAR_ROWS,
  untilCounted,
  WIDTH_60S,
} from "./calendarKit.ts";
import { closeApps, gated, quiet, unlink, unlinked } from "./caseApp.ts";
import { classRecording } from "./caseKit.ts";
import { memoryAdapter, type ScopeApp, scopeApp } from "./scopeApp.ts";
import { testSource } from "./testdb.ts";

// Spec range-picker "Calendar cached and classed", "Calendar days counted at the lowest priority".
// The stub source counts the calendar's own `refBuckets` calls by their 60 s width and scope, so
// the density prefetch after a scope's list loads (another width) does not count.

/** M10 = local October 2026: 2026-09-30T22:00:00Z = 1790805600 s, 31 d + 1 h long. */
const M10_FROM = 1790805600n * S;
const M10_TO = M10_FROM + (31n * 24n + 1n) * 3600n * S;
/** 2026-10-01T01:00:00Z and 02:00:00Z in ns (the scope tests' T1 and T2). */
const T1 = 1790816400n * S;
const T2 = 1790820000n * S;

/** A source with the required methods plus native `refBuckets`, `refCount` and `refExtent`. */
function stub() {
  const calls = {
    calendar: 0,
    failNext: false,
    classes: [] as QueryClass[],
    scopes: [] as ({ from: bigint; to: bigint } | undefined)[],
  };
  const adapter: SourceAdapter = {
    info: { kind: "stub", database: "d", table: "t" },
    ping: async () => {},
    listSignals: async () => [{ dataRef: "testcar", name: "S" }],
    raw: async () => [],
    before: async () => undefined,
    after: async () => undefined,
    buckets: async () => [],
    refExtent: async () => ({ count: 3, first: 0n, last: 5_000_000n }),
    refCount: async () => 3,
    refBuckets: async (_ref, width, _times, scope) => {
      if (width !== WIDTH_60S) return [{ start: 0n, count: 1 }];
      calls.calendar++;
      calls.classes.push(currentPriority().cls);
      calls.scopes.push(scope);
      await new Promise((r) => setTimeout(r, 10));
      if (calls.failNext) {
        calls.failNext = false;
        throw new Error("boom");
      }
      return [{ start: scope?.from ?? M10_FROM, count: 3 }];
    },
  };
  return { adapter, calls };
}

const apps: ScopeApp[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((a) => a.close()));
  await closeApps();
});

/** A full-mode server on the stub with scope {testcar, T1, T2} set. */
async function startApp() {
  const { adapter, calls } = stub();
  const t = await scopeApp({ adapter });
  apps.push(t);
  const set = await t.command({
    type: "scope.set",
    dataRef: "testcar",
    from: T1.toString(),
    to: T2.toString(),
  });
  expect(set.status, JSON.stringify(set.body)).toBe(200);
  const scope = t.store.workspace.scope;
  const get = (from: bigint, to: bigint, headers: Record<string, string> = {}) =>
    t.app.inject({
      url: "/api/calendar",
      headers,
      query: { dataRef: "testcar", from: from.toString(), to: to.toString() },
    });
  /** A reload of the scope's signal list: the next calendar computes again. */
  const reload = async () => {
    await new Promise((r) => setTimeout(r, 5));
    const catalog = t.catalogs.get(scope);
    if (!catalog) throw new Error("no scope catalog");
    await catalog.refresh();
  };
  return { t, calls, get, reload };
}

describe("GET /api/calendar cache", () => {
  it("computes once per window and catalog load, shares, drops failures and the least recent", async () => {
    const { calls, get, reload } = await startApp();
    // The scope's own prefetches are done before the counting starts.
    await new Promise((r) => setTimeout(r, 300));
    const base = calls.calendar;

    // Three at once share one computation; a fourth later is served from the cache.
    const three = await Promise.all([
      get(M10_FROM, M10_TO),
      get(M10_FROM, M10_TO),
      get(M10_FROM, M10_TO),
    ]);
    const fourth = await get(M10_FROM, M10_TO);
    expect(calls.calendar - base).toBe(1);
    for (const res of [...three, fourth]) {
      expect(res.statusCode, res.body).toBe(200);
      expect(res.body).toBe(three[0]?.body);
    }
    // The scope's single bucket (3 rows at T1, the scope's start) is hour 3 of M10 (22:00Z + 3 h).
    expect(three[0]?.json().hours).toHaveLength(745);
    expect(three[0]?.json().hours[3]).toBe(3);
    expect(three[0]?.json().scope).toEqual({ from: T1.toString(), to: T2.toString() });
    // The one call carried the window cut to the scope.
    expect(calls.scopes[calls.scopes.length - 1]).toEqual({ dataRef: "testcar", from: T1, to: T2 });

    // A catalog reload computes again, once.
    await reload();
    const after = await get(M10_FROM, M10_TO);
    expect(after.statusCode).toBe(200);
    await get(M10_FROM, M10_TO);
    expect(calls.calendar - base).toBe(2);

    // A failing first computation is not cached: the next request asks again.
    await reload();
    calls.failNext = true;
    const failed = await get(M10_FROM, M10_TO);
    expect(failed.statusCode).toBe(502);
    expect(failed.json().error.code).toBe("source_error");
    const retry = await get(M10_FROM, M10_TO);
    expect(retry.statusCode).toBe(200);
    expect(calls.calendar - base).toBe(4); // the failed one and the retry

    // At most 12 windows are kept: 13 different ones (each reaches over the scope, so each
    // computes) drop the first, which computes again.
    const before = calls.calendar;
    const window = (i: number) =>
      [M10_FROM - BigInt(i + 1) * WIDTH_60S, M10_TO + BigInt(i) * WIDTH_60S] as const;
    for (let i = 0; i < 13; i++) {
      const res = await get(...window(i));
      expect(res.statusCode, `window ${i}`).toBe(200);
    }
    expect(calls.calendar).toBe(before + 13);
    // Windows 1 … 12 are cached; the first was dropped.
    for (let i = 1; i < 13; i++) await get(...window(i));
    expect(calls.calendar).toBe(before + 13);
    await get(...window(0));
    expect(calls.calendar).toBe(before + 14);
  });

  it("does not cache a too-wide answer", async () => {
    // The bound counts a range once per 5 min. Within the row budget the first window computes;
    // after the count moved over the budget (a fake clock passes the 5 min) a new window answers
    // 422 `too_wide` with no calendar query, and once the count is within the budget again the
    // same window computes (the refusal was not cached).
    const { adapter, calls } = stub();
    let rows = 3;
    adapter.refCount = async () => rows;
    let clock = 1_000_000;
    const t = await scopeApp({ adapter, scanRows: 5, now: () => clock });
    apps.push(t);
    const set = await t.command({
      type: "scope.set",
      dataRef: "testcar",
      from: T1.toString(),
      to: T2.toString(),
    });
    expect(set.status, JSON.stringify(set.body)).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    const first = await t.get(calendarUrl("2026-09-30T22:00:00Z", "2026-10-31T23:00:00Z"));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    const computed = calls.calendar;
    expect(computed).toBe(1);

    clock += 6 * 60_000;
    rows = 9;
    const wide = calendarUrl("2026-09-30T21:59:00Z", "2026-10-31T23:00:00Z");
    const refused = await t.get(wide);
    expect(refused.status).toBe(422);
    expect(refused.body.error).toMatchObject({ code: "too_wide", rows: "9", limit: "5" });
    expect(calls.calendar).toBe(computed);

    clock += 6 * 60_000;
    rows = 3;
    const again = await t.get(wide);
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(calls.calendar).toBe(computed + 1);
  });

  it("runs in the request's class, days at idle", async () => {
    const { calls, get } = await startApp();
    await new Promise((r) => setTimeout(r, 300));
    const before = calls.classes.length;
    const res = await get(M10_FROM, M10_TO);
    expect(res.statusCode, res.body).toBe(200);
    expect(calls.classes.slice(before)).toEqual(["interactive"]);
    // A request with the preload header, for a window no earlier request computed.
    const next = await get(M10_FROM - WIDTH_60S, M10_TO, { "x-kipscope-class": "preload" });
    expect(next.statusCode, next.body).toBe(200);
    expect(calls.classes.slice(before)).toEqual(["interactive", "preload"]);
    // Any other value leaves the request interactive.
    const other = await get(M10_FROM - 2n * WIDTH_60S, M10_TO, {
      "x-kipscope-class": "background",
    });
    expect(other.statusCode, other.body).toBe(200);
    expect(calls.classes.slice(before)).toEqual(["interactive", "preload", "interactive"]);
  });

  it("counts the days of an unlinked workspace at idle and never above it", async () => {
    // Unlinked on testcar (object scope): the calendar answers from counted vehicle-days. The
    // adapter's day counts are held until the test lets them go, so the answer cannot have waited.
    const gate = gated(testSource() as SourceAdapter, (method, args) => {
      return method === "refBuckets" && args[1] === WIDTH_60S;
    });
    const { t, id, log } = await unlinked({ adapter: gate.adapter });
    await unlink(t.anon, id);
    await quiet(t.calls);
    const mark = log.length;
    const url = `/api/w/${id}/calendar?dataRef=testcar&from=2026-09-30T22:00:00Z&to=2026-10-31T23:00:00Z`;
    const answer = await t.anon.get(url);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    // The answer came while the day counts are held (or not even asked yet).
    expect(Array.isArray(answer.body.pending)).toBe(true);
    expect(answer.body.pending.length).toBeGreaterThan(0);
    // Interactive work from now on raises nothing: a second request does not change the class.
    const again = await t.anon.get(url);
    expect(again.status).toBe(200);
    gate.release();
    const done = await untilCounted(() => t.anon.get(url), pause);
    expect(done.body.scope).toBeDefined();
    const dayCounts = log
      .slice(mark)
      .filter((c) => c.method === "refBuckets" && c.args[1] === WIDTH_60S);
    expect(dayCounts.length).toBeGreaterThan(0);
    expect(dayCounts.every((c) => c.cls === "idle")).toBe(true);
    // The counts of the day count (refCount) run at idle, too.
    const counts = log.slice(mark).filter((c) => c.method === "refCount");
    expect(counts.every((c) => c.cls === "idle")).toBe(true);
  });
});

describe("GET /api/calendar from counted vehicle-days", () => {
  it("answers counted days at once and counts the rest at idle", async () => {
    // Full mode without a scope, the in-memory vehicle of 2026-10-01 (3 rows) and -02 (2 rows).
    let inFlight = 0;
    let peak = 0;
    let hold: Promise<void> | undefined;
    let release: () => void = () => {};
    const base = classRecording(memoryAdapter(TESTCAR_ROWS));
    const source = new Proxy(base.adapter, {
      get(target, key, receiver) {
        const member = Reflect.get(target, key, receiver);
        if ((key !== "refBuckets" && key !== "refCount") || typeof member !== "function")
          return member;
        return async (...args: unknown[]) => {
          const day = key === "refCount" ? args[1] : args[3];
          if (day !== undefined) {
            inFlight++;
            peak = Math.max(peak, inFlight);
          }
          try {
            if (hold && day !== undefined) await hold;
            return await member.apply(target, args);
          } finally {
            if (day !== undefined) inFlight--;
          }
        };
      },
    });
    const t = await scopeApp({ adapter: source });
    apps.push(t);

    // 2026-10-01 counted first.
    const day1 = calendarUrl("2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");
    const counted = await untilCounted(() => t.get(day1));
    expect(counted.body.hours[1]).toBe(3);

    // Now hold every day count; the request over [09-30 22:00Z, 10-02 22:00Z) answers at once.
    hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const mark = base.log.length;
    const url = calendarUrl("2026-09-30T22:00:00Z", "2026-10-02T22:00:00Z");
    const answer = await t.get(url);
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    // The two UTC days 2026-09-30 and 2026-10-02 are pending (decimal ns, by hand: 1790726400 s
    // … 1790812800 s and 1790899200 s … 1790985600 s); 2026-10-01 is counted.
    expect(answer.body.pending).toEqual([
      { from: "1790726400000000000", to: "1790812800000000000" },
      { from: "1790899200000000000", to: "1790985600000000000" },
    ]);
    // Hours from 2026-09-30T22:00Z: the counted day's 3 rows at 2026-10-01 01:00Z are hour 3.
    expect(answer.body.hours[3]).toBe(3);
    expect(answer.body.hours.reduce((a: number, b: number) => a + b, 0)).toBe(3);

    release();
    const done = await untilCounted(() => t.get(url));
    // 2026-10-02's 2 rows at 02:00Z are hour 28 of this window (22:00Z + 28 h).
    expect(done.body.hours[28]).toBe(2);
    expect(done.body.hours[3]).toBe(3);
    // One refCount and one 60 s refBuckets with the scope of each pending day, in idle.
    const after = base.log.slice(mark);
    const scopeOf = (c: { args: unknown[] }, at: number) =>
      c.args[at] as { from: bigint; to: bigint };
    for (const day of [OCT1 - DAY, OCT2]) {
      const counts = after.filter(
        (c) =>
          c.method === "refCount" && scopeOf(c, 1)?.from === day && scopeOf(c, 1)?.to === day + DAY,
      );
      const bucketsOf = after.filter(
        (c) =>
          c.method === "refBuckets" &&
          c.args[1] === WIDTH_60S &&
          scopeOf(c, 3)?.from === day &&
          scopeOf(c, 3)?.to === day + DAY,
      );
      expect(counts, `refCount of ${day}`).toHaveLength(1);
      expect(bucketsOf, `refBuckets of ${day}`).toHaveLength(1);
      expect([...counts, ...bucketsOf].every((c) => c.cls === "idle")).toBe(true);
    }
    // 2026-10-01 was not asked again.
    expect(after.filter((c) => c.method === "refBuckets" && scopeOf(c, 3)?.from === OCT1)).toEqual(
      [],
    );
    // One at a time.
    expect(peak).toBe(1);
  });
});
