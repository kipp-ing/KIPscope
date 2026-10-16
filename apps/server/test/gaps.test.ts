import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { testSource } from "./testdb.ts";

const MS = 1_000_000n;
const S = 1_000_000_000n;
const workspace = () => new WorkspaceStore({ signalExists: () => true, hasStates: () => false });

/** Stub source: one data ref `car` with the signals `Cyc` and `Odd`; counts its two gap queries. */
function stubSource() {
  const calls = { logger: 0, samples: 0, failNext: false };
  const source = {
    textSignals: async () => [],
    listSignals: async () => [
      { dataRef: "car", name: "Cyc" },
      { dataRef: "car", name: "Odd" },
    ],
    loggerGaps: async () => {
      calls.logger++;
      await new Promise((r) => setTimeout(r, 10));
      if (calls.failNext) {
        calls.failNext = false;
        throw new Error("boom");
      }
      return { gaps: [{ from: 1n * S, to: 4n * S }], last: 9n * S };
    },
    firstTimes: async (_ref: string, names: readonly string[]) => {
      calls.samples++;
      // Cyc: 1,001 rows 100 ms apart (measurable); Odd is not asked to be measured differently.
      return new Map(
        names.map((n) => [n, Array.from({ length: 1001 }, (_, i) => BigInt(i) * 100n * MS)]),
      );
    },
  } as unknown as DataSource;
  return { source, calls };
}

describe("gap info cache over HTTP", () => {
  it("computes gap info once per catalog load and drops a failure", async () => {
    const { source, calls } = stubSource();
    // The catalog loads before the app exists, so no prefetch runs for this first load.
    const catalog = new Catalog(source, async () => new Map());
    await catalog.refresh();
    const app = buildApp({ catalog, source, workspace: workspace() });
    try {
      const get = () => app.inject({ url: "/api/gaps", query: { dataRef: "car" } });
      const three = await Promise.all([get(), get()]);
      three.push(await get());
      expect(three.map((r) => r.statusCode)).toEqual([200, 200, 200]);
      expect(calls).toMatchObject({ logger: 1, samples: 1 });
      expect(three[0]?.json()).toEqual({
        dataRef: "car",
        through: (9n * S).toString(),
        logger: [{ from: (1n * S).toString(), to: (4n * S).toString() }],
        periods: {
          "car/Cyc": { ns: (100n * MS).toString(), source: "measured" },
          "car/Odd": { ns: (100n * MS).toString(), source: "measured" },
        },
      });
      expect(three[1]?.body).toBe(three[0]?.body);

      // A catalog reload computes again, once (the prefetch and the request share it).
      await new Promise((r) => setTimeout(r, 5));
      await catalog.refresh();
      expect((await get()).statusCode).toBe(200);
      expect((await get()).statusCode).toBe(200);
      expect(calls).toMatchObject({ logger: 2, samples: 2 });
    } finally {
      await app.close();
    }

    // A failure is answered 502 once and not kept: the next request computes again and succeeds.
    const second = stubSource();
    const catalog2 = new Catalog(second.source, async () => new Map());
    await catalog2.refresh();
    const app2 = buildApp({ catalog: catalog2, source: second.source, workspace: workspace() });
    try {
      second.calls.failNext = true;
      const failed = await app2.inject({ url: "/api/gaps", query: { dataRef: "car" } });
      expect(failed.statusCode).toBe(502);
      expect(failed.json().error.code).toBe("source_error");
      expect(failed.json().error.message).toContain("boom");
      const retry = await app2.inject({ url: "/api/gaps", query: { dataRef: "car" } });
      expect(retry.statusCode).toBe(200);
      expect(second.calls.logger).toBe(2);
      const again = await app2.inject({ url: "/api/gaps", query: { dataRef: "car" } });
      expect(again.statusCode).toBe(200);
      expect(second.calls.logger).toBe(2);
    } finally {
      await app2.close();
    }
  });

  it("answers 502 for a value without gap info", async () => {
    const real = testSource();
    // The real test DB, but the logger-gap query fails.
    const source = new Proxy(real, {
      get(target, key) {
        if (key === "loggerGaps") return () => Promise.reject(new Error("connect ECONNREFUSED"));
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const catalog = new Catalog(source, async () => new Map());
    await catalog.refresh();
    const app = buildApp({ catalog, source, workspace: workspace() });
    try {
      const res = await app.inject({
        url: "/api/value",
        query: { signal: "testcar/Sna_800h.SPEED", t: "2026-10-01T02:00:01.05Z" },
      });
      expect(res.statusCode).toBe(502);
      const body = res.json();
      expect(body.error.code).toBe("source_error");
      expect(body.error.signalId).toBe("testcar/Sna_800h.SPEED");
      expect(body).not.toHaveProperty("value");
    } finally {
      await app.close();
    }
  });
});
