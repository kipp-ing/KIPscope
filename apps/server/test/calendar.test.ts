import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { currentPriority, type QueryClass } from "../src/priority.ts";
import { WorkspaceStore } from "../src/workspace.ts";

// Spec range-picker "Calendar cached and classed". The stub source counts the calendar's own
// `refBuckets` calls by their 60 s width, so the density prefetch after a catalog load (another
// width) does not count.

const S = 1_000_000_000n;
const WIDTH_60S = 60n * S;
/** M10 = local October 2026: 2026-09-30T22:00:00Z = 1790805600 s, 31 d + 1 h long. */
const M10_FROM = 1790805600n * S;
const M10_TO = M10_FROM + (31n * 24n + 1n) * 3600n * S;
const DAY = 86_400n * S;

function stub() {
  const calls = { calendar: 0, failNext: false, classes: [] as QueryClass[] };
  const source = {
    listSignals: async () => [{ dataRef: "testcar", name: "S" }],
    refExtent: async () => ({ count: 3, first: 0n, last: 5_000_000n }),
    refBuckets: async (_ref: string, width: bigint, _times: boolean, scope?: { from: bigint }) => {
      if (width !== WIDTH_60S) return [{ start: 0n, count: 1 }];
      calls.calendar++;
      calls.classes.push(currentPriority().cls);
      await new Promise((r) => setTimeout(r, 10));
      if (calls.failNext) {
        calls.failNext = false;
        throw new Error("boom");
      }
      return [{ start: scope?.from ?? M10_FROM, count: 3 }];
    },
  } as unknown as DataSource;
  return { source, calls };
}

async function startApp() {
  const { source, calls } = stub();
  const catalog = new Catalog(source, async () => new Map());
  await catalog.refresh();
  const app = buildApp({
    catalog,
    source,
    workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
  });
  await app.ready();
  const get = (from: bigint, to: bigint) =>
    app.inject({
      url: "/api/calendar",
      query: { dataRef: "testcar", from: from.toString(), to: to.toString() },
    });
  return { app, catalog, calls, get };
}

describe("GET /api/calendar cache", () => {
  it("computes once per window and catalog load, shares, drops failures and the least recent", async () => {
    const { app, catalog, calls, get } = await startApp();
    try {
      // Three at once share one computation; a fourth later is served from the cache.
      const three = await Promise.all([
        get(M10_FROM, M10_TO),
        get(M10_FROM, M10_TO),
        get(M10_FROM, M10_TO),
      ]);
      const fourth = await get(M10_FROM, M10_TO);
      expect(calls.calendar).toBe(1);
      for (const res of [...three, fourth]) {
        expect(res.statusCode, res.body).toBe(200);
        expect(res.body).toBe(three[0]?.body);
      }
      expect(three[0]?.json().hours).toHaveLength(745);
      expect(three[0]?.json().hours[0]).toBe(3);

      // A catalog reload computes again, once.
      await new Promise((r) => setTimeout(r, 5));
      await catalog.refresh();
      const after = await get(M10_FROM, M10_TO);
      expect(after.statusCode).toBe(200);
      await get(M10_FROM, M10_TO);
      expect(calls.calendar).toBe(2);

      // A failing first computation is not cached: the next request asks again.
      await new Promise((r) => setTimeout(r, 5));
      await catalog.refresh();
      calls.failNext = true;
      const failed = await get(M10_FROM, M10_TO);
      expect(failed.statusCode).toBe(502);
      expect(failed.json().error.code).toBe("source_error");
      const retry = await get(M10_FROM, M10_TO);
      expect(retry.statusCode).toBe(200);
      expect(calls.calendar).toBe(4); // the failed one and the retry

      // At most 12 windows are kept: 13 different ones drop the first, which computes again.
      const before = calls.calendar;
      const window = (i: number) =>
        [M10_FROM + BigInt(i) * 30n * DAY, M10_FROM + BigInt(i + 1) * 30n * DAY] as const;
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
    } finally {
      await app.close();
    }
  });

  it("runs in the request's class", async () => {
    const { app, calls, get } = await startApp();
    try {
      const res = await get(M10_FROM, M10_TO);
      expect(res.statusCode, res.body).toBe(200);
      expect(calls.classes).toEqual(["interactive"]);
    } finally {
      await app.close();
    }
  });
});
