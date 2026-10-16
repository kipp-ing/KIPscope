import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { loadDbcFiles } from "../src/dbc.ts";
import { loadProjectFile } from "../src/project.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { fixture, testDbcFiles, testSource } from "./testdb.ts";

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
            sender: "TEST",
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
            sender: "TEST",
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
    expect(total).toBe(1017);
    expect(body.items).toHaveLength(total);
    expect(body.items.map((s: { id: string }) => s.id)).toContain("testcar/Many_700h.S0999");
    expect(Number.isNaN(Date.parse(body.loadedAt))).toBe(false);
    const first = (await app.inject({ url: "/api/signals?q=&limit=1" })).json().items[0];
    expect(body.items[0]).toEqual(first);
  });

  it("refreshes the catalog", async () => {
    const res = await app.inject({ method: "POST", url: "/api/catalog/refresh" });
    expect(res.statusCode).toBe(200);
    expect(res.json().size).toBe(1017);
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
      reason: "source unreachable: connect ECONNREFUSED",
    });
    const full = await app.inject({ url: "/api/catalog" });
    expect(full.statusCode).toBe(503);
    expect(full.json().error.code).toBe("catalog_unavailable");
    expect(full.json().error.reason).toMatch(/^source unreachable/);
    const refresh = await app.inject({ method: "POST", url: "/api/catalog/refresh" });
    expect(refresh.statusCode).toBe(502);
  });
});

describe("503 reason while the catalog is still loading", () => {
  const source = testSource();
  const catalog = new Catalog(source, async () => new Map());
  const app = buildApp({
    catalog,
    source,
    workspace: new WorkspaceStore({ signalExists: () => true }),
  });
  afterAll(() => app.close());

  it("carries a non-empty reason when no refresh has completed yet", async () => {
    for (const url of ["/api/signals", "/api/catalog"]) {
      const res = await app.inject({ url });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("catalog_unavailable");
      expect(res.json().error.reason).toMatch(/^still loading/);
    }
  });
});

describe("display names over HTTP (test project file)", () => {
  const source = testSource();
  const rules = loadProjectFile({ path: fixture("kipscope.test.yaml"), required: true });
  const catalog = new Catalog(source, () => loadDbcFiles(testDbcFiles), rules);
  const app = buildApp({
    catalog,
    source,
    workspace: new WorkspaceStore({ signalExists: () => true }),
  });
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());

  it("returns displayName in search and full catalog and keeps IDs", async () => {
    const hit = (await app.inject({ url: "/api/signals?q=Sna_800h.RPM" })).json().items[0];
    expect(hit.id).toBe("testcar/Sna_800h.RPM");
    expect(hit.name).toBe("Sna_800h.RPM");
    expect(hit.displayName).toBe("RPM");

    const all = (await app.inject({ url: "/api/catalog" })).json().items as {
      id: string;
      name: string;
      displayName?: string;
    }[];
    const rpm = all.find((s) => s.id === "testcar/Sna_800h.RPM");
    expect(rpm).toMatchObject({ name: "Sna_800h.RPM", displayName: "RPM" });
    const siga = all.find((s) => s.id === "testcar/Fast_100h.SIG_A");
    expect(siga).toBeDefined();
    expect(siga).not.toHaveProperty("displayName");

    const spee = (await app.inject({ url: "/api/signals?q=spee" })).json().items;
    expect(spee.slice(0, 2).map((s: { id: string }) => s.id)).toEqual([
      "testcar/Irr_200h.JITTER",
      "testcar/Sna_800h.SPEED",
    ]);
  });
});

describe("collision warning on refresh (N5)", () => {
  const real = testSource();
  let failing = false;
  const source = {
    ...real,
    listSignals: () =>
      failing ? Promise.reject(new Error("connect ECONNREFUSED")) : real.listSignals(),
    // No rows, so the density prefetch after each load (design Q4) logs no warn line of its own.
    refExtent: async () => undefined,
  } as unknown as DataSource;
  const rules = loadProjectFile({ path: fixture("kipscope.test.yaml"), required: true });
  const catalog = new Catalog(source, () => loadDbcFiles(testDbcFiles), rules);
  const app = buildApp({
    catalog,
    source,
    workspace: new WorkspaceStore({ signalExists: () => true }),
  });
  // buildApp only takes a boolean logger, so the fake logger replaces app.log.warn.
  const warn = vi.spyOn(app.log, "warn").mockImplementation(() => undefined);
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());

  it("logs exactly one warn line naming the three Fast_100h.SIG_* signals", async () => {
    warn.mockClear();
    const res = await app.inject({ method: "POST", url: "/api/catalog/refresh" });
    expect(res.statusCode).toBe(200);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0]?.[0]);
    for (const name of ["Fast_100h.SIG_A", "Fast_100h.SIG_B", "Fast_100h.SIG_C"])
      expect(line).toContain(name);
  });

  it("logs no warn line when the refresh fails with 502", async () => {
    warn.mockClear();
    failing = true;
    try {
      const res = await app.inject({ method: "POST", url: "/api/catalog/refresh" });
      expect(res.statusCode).toBe(502);
    } finally {
      failing = false;
    }
    expect(warn).not.toHaveBeenCalled();
  });
});
