import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { loadDbcFiles } from "../src/dbc.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { testDbcFiles, testSource } from "./testdb.ts";

describe("GET /api/signals", () => {
  const source = testSource();
  const catalog = new Catalog(source, () => loadDbcFiles(testDbcFiles));
  const app = buildApp({
    catalog,
    source,
    workspace: new WorkspaceStore({ signalExists: () => true }),
  });
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());

  it("returns a page of matches with metadata", async () => {
    const res = await app.inject({ url: "/api/signals?q=motordrehzahl" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [
        {
          id: "othercar/Fast_100h.SIG_A",
          dataRef: "othercar",
          name: "Fast_100h.SIG_A",
          unit: "rpm",
          description: "Motordrehzahl hinten",
          dbc: {
            file: "test-a.dbc",
            message: "Fast_100h",
            messageId: 256,
            factor: 0.1,
            offset: 0,
            min: 0,
            max: 6553.5,
          },
        },
        {
          id: "testcar/Fast_100h.SIG_A",
          dataRef: "testcar",
          name: "Fast_100h.SIG_A",
          unit: "rpm",
          description: "Motordrehzahl hinten",
          dbc: {
            file: "test-a.dbc",
            message: "Fast_100h",
            messageId: 256,
            factor: 0.1,
            offset: 0,
            min: 0,
            max: 6553.5,
          },
        },
      ],
      total: 2,
      more: false,
    });
  });

  it("applies offset and limit", async () => {
    const res = await app.inject({ url: "/api/signals?q=many&offset=10&limit=5" });
    const page = res.json();
    expect(page.items.map((s: { name: string }) => s.name)).toEqual([
      "Many_700h.S0010",
      "Many_700h.S0011",
      "Many_700h.S0012",
      "Many_700h.S0013",
      "Many_700h.S0014",
    ]);
    expect(page.more).toBe(true);
  });

  it("rejects invalid parameters with 400", async () => {
    for (const url of [
      "/api/signals?limit=0",
      "/api/signals?limit=1000",
      "/api/signals?offset=-1",
    ]) {
      const res = await app.inject({ url });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe("invalid_request");
    }
  });

  it("returns the full catalog without a page limit", async () => {
    const res = await app.inject({ url: "/api/catalog" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const total = (await app.inject({ url: "/api/signals?q=" })).json().total;
    expect(total).toBe(1013);
    expect(body.items).toHaveLength(total);
    expect(body.items.map((s: { id: string }) => s.id)).toContain("testcar/Many_700h.S0999");
    expect(Number.isNaN(Date.parse(body.loadedAt))).toBe(false);
    const first = (await app.inject({ url: "/api/signals?q=&limit=1" })).json().items[0];
    expect(body.items[0]).toEqual(first);
  });

  it("refreshes the catalog", async () => {
    const res = await app.inject({ method: "POST", url: "/api/catalog/refresh" });
    expect(res.statusCode).toBe(200);
    expect(res.json().size).toBe(1013);
  });
});

describe("GET /api/signals without a reachable source", () => {
  const failing = {
    listSignals: () => Promise.reject(new Error("connect ECONNREFUSED")),
  } as unknown as DataSource;
  const catalog = new Catalog(failing, async () => new Map());
  const app = buildApp({
    catalog,
    source: failing,
    workspace: new WorkspaceStore({ signalExists: () => true }),
  });
  afterAll(() => app.close());

  it("answers 503 before the catalog was ever loaded, and 502 on refresh", async () => {
    await expect(catalog.refresh()).rejects.toThrow();
    const res = await app.inject({ url: "/api/signals" });
    expect(res.statusCode).toBe(503);
    expect(res.json().error).toEqual({
      code: "catalog_unavailable",
      message: "connect ECONNREFUSED",
    });
    const full = await app.inject({ url: "/api/catalog" });
    expect(full.statusCode).toBe(503);
    expect(full.json().error.code).toBe("catalog_unavailable");
    const refresh = await app.inject({ method: "POST", url: "/api/catalog/refresh" });
    expect(refresh.statusCode).toBe(502);
  });
});
