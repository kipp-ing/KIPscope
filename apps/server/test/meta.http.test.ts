import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { loadDbcFiles } from "../src/dbc.ts";
import { type BuildInfo, type MetaDeps, PING_TIMEOUT_MS, readBuildInfo } from "../src/meta.ts";
import { WorkspaceStore } from "../src/workspace.ts";
import { testDbcFiles, testSource } from "./testdb.ts";

const LICENSE = readFileSync(resolve(import.meta.dirname, "../../../LICENSE"), "utf8");
const STARTED = new Date("2026-10-16T13:07:10.000Z");

function metaDeps(ping: MetaDeps["ping"], build?: Partial<BuildInfo>): MetaDeps {
  return {
    build: { commit: "7c1e2a9", dirty: true, startedAt: STARTED, ...build },
    source: { kind: "clickhouse", database: "sdlog", table: "signals" },
    ping,
  };
}

const workspace = () => new WorkspaceStore({ signalExists: () => true });
const never = {} as DataSource;
/** An unloaded catalog over a source that is never asked. */
const idleCatalog = () => new Catalog(never, async () => new Map());

describe("GET /api/license", () => {
  it("serves the license text", async () => {
    const app = buildApp({
      catalog: idleCatalog(),
      source: never,
      workspace: workspace(),
      licenseText: LICENSE,
    });
    try {
      const res = await app.inject({ url: "/api/license" });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toBe("text/plain; charset=utf-8");
      expect(res.body).toBe(LICENSE);
      expect(res.body.split("\n")[0]).toBe("Attribution Assurance License");
    } finally {
      await app.close();
    }
  });

  it("answers 404 without a license file", async () => {
    const app = buildApp({ catalog: idleCatalog(), source: never, workspace: workspace() });
    try {
      const res = await app.inject({ url: "/api/license" });
      expect(res.statusCode).toBe(404);
      expect(res.json().error.code).toBe("license_missing");
    } finally {
      await app.close();
    }
  });

  it("keeps the access guard on meta and license", async () => {
    const app = buildApp({
      catalog: idleCatalog(),
      source: never,
      workspace: workspace(),
      licenseText: LICENSE,
      meta: metaDeps(async () => {}),
    });
    try {
      for (const url of ["/api/license", "/api/meta"]) {
        const res = await app.inject({ url, headers: { host: "evil.example:7310" } });
        expect(res.statusCode, url).toBe(403);
        expect(res.json().error.code, url).toBe("forbidden_host");
      }
    } finally {
      await app.close();
    }
  });
});

describe("GET /api/meta with the test database", () => {
  const source = testSource();
  const catalog = new Catalog(source, () => loadDbcFiles(testDbcFiles));
  const app = buildApp({
    catalog,
    source,
    workspace: workspace(),
    meta: metaDeps(async () => {}),
  });
  beforeAll(() => catalog.refresh());
  afterAll(() => app.close());

  it("reports build, source and catalog", async () => {
    const res = await app.inject({ url: "/api/meta" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.build).toEqual({
      commit: "7c1e2a9",
      dirty: true,
      startedAt: "2026-10-16T13:07:10.000Z",
    });
    expect(body.source).toMatchObject({
      kind: "clickhouse",
      database: "sdlog",
      table: "signals",
      reachable: true,
    });
    expect(body.source).not.toHaveProperty("error");
    expect(new Date(body.source.checkedAt).toISOString()).toBe(body.source.checkedAt);
    const items = (await app.inject({ url: "/api/catalog" })).json().items;
    expect(body.catalog.state).toBe("loaded");
    expect(body.catalog.size).toBe(items.length);
    expect(body.catalog.size).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(body.catalog.loadedAt))).toBe(false);
    expect(body.catalog).not.toHaveProperty("reason");
  });
});

describe("GET /api/meta catalog states", () => {
  it("reports a catalog that has not loaded", async () => {
    let fail = false;
    const source = {
      listSignals: () =>
        fail ? Promise.reject(new Error("connect ECONNREFUSED")) : new Promise<never>(() => {}),
    } as unknown as DataSource;
    const catalog = new Catalog(source, async () => new Map());
    const app = buildApp({
      catalog,
      source,
      workspace: workspace(),
      meta: metaDeps(async () => {}),
    });
    try {
      // Before the first load finished.
      void catalog.refresh().catch(() => {});
      const loading = (await app.inject({ url: "/api/meta" })).json().catalog;
      expect(loading).toMatchObject({
        state: "loading",
        size: 0,
        reason: catalog.unavailableReason,
      });
      expect(loading.reason).toContain("still loading");

      // After a failed load (a fresh catalog, since the first refresh is still pending).
      fail = true;
      const failing = new Catalog(source, async () => new Map());
      await expect(failing.refresh()).rejects.toThrow();
      const app2 = buildApp({
        catalog: failing,
        source,
        workspace: workspace(),
        meta: metaDeps(async () => {}),
      });
      try {
        const failed = (await app2.inject({ url: "/api/meta" })).json().catalog;
        expect(failed).toMatchObject({
          state: "failed",
          size: 0,
          reason: failing.unavailableReason,
        });
        expect(failed.reason).toContain("ECONNREFUSED");
      } finally {
        await app2.close();
      }
    } finally {
      await app.close();
    }
  });
});

describe("readBuildInfo", () => {
  const now = new Date("2026-10-16T13:07:10.000Z");
  const runner = (status: string) => (args: readonly string[]) => {
    if (args.includes("rev-parse")) return "7c1e2a9\n";
    if (args.includes("status")) return status;
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };

  it("reads the commit and the dirty flag from git", () => {
    expect(readBuildInfo("/repo", runner(" M apps/web/src/App.tsx\n"), now)).toEqual({
      commit: "7c1e2a9",
      dirty: true,
      startedAt: now,
    });
    expect(readBuildInfo("/repo", runner(""), now)).toEqual({
      commit: "7c1e2a9",
      dirty: false,
      startedAt: now,
    });
    const broken = () => {
      throw new Error("git: not found");
    };
    expect(readBuildInfo("/repo", broken, now)).toEqual({
      commit: null,
      dirty: false,
      startedAt: now,
    });
  });
});

describe("source ping", () => {
  it("reports an unreachable source", async () => {
    const app = buildApp({
      catalog: idleCatalog(),
      source: never,
      workspace: workspace(),
      meta: metaDeps(() => Promise.reject(new Error("connect ECONNREFUSED 127.0.0.1:18123"))),
    });
    try {
      const res = await app.inject({ url: "/api/meta" });
      expect(res.statusCode).toBe(200);
      const { source } = res.json();
      expect(source.reachable).toBe(false);
      expect(source.error).toContain("ECONNREFUSED");
      expect(Number.isNaN(Date.parse(source.checkedAt))).toBe(false);
    } finally {
      await app.close();
    }
  });

  it("gives up the ping after 2 s", async () => {
    expect(PING_TIMEOUT_MS).toBe(2000);
    const app = buildApp({
      catalog: idleCatalog(),
      source: never,
      workspace: workspace(),
      meta: metaDeps(() => new Promise<void>(() => {})),
    });
    try {
      const started = performance.now();
      const res = await app.inject({ url: "/api/meta" });
      const took = performance.now() - started;
      expect(res.statusCode).toBe(200);
      expect(res.json().source).toMatchObject({
        reachable: false,
        error: "no answer within 2 s",
      });
      expect(took).toBeGreaterThanOrEqual(1900);
      expect(took).toBeLessThan(3000);
    } finally {
      await app.close();
    }
  }, 10_000);

  it("aborts the hung ping at the timeout", async () => {
    let seen: AbortSignal | undefined;
    let settled = false;
    const app = buildApp({
      catalog: idleCatalog(),
      source: never,
      workspace: workspace(),
      meta: metaDeps(
        (signal) =>
          new Promise<void>((_, reject) => {
            seen = signal;
            signal.addEventListener("abort", () => {
              settled = true;
              reject(signal.reason);
            });
          }),
      ),
    });
    try {
      const res = await app.inject({ url: "/api/meta" });
      expect(res.json().source.error).toBe("no answer within 2 s");
      expect(seen?.aborted).toBe(true);
      expect(settled).toBe(true);
    } finally {
      await app.close();
    }
  }, 10_000);

  it("does not abort a ping that answered", async () => {
    let seen: AbortSignal | undefined;
    const app = buildApp({
      catalog: idleCatalog(),
      source: never,
      workspace: workspace(),
      meta: metaDeps(async (signal) => {
        seen = signal;
      }),
    });
    try {
      expect((await app.inject({ url: "/api/meta" })).json().source.reachable).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, PING_TIMEOUT_MS + 100));
      expect(seen?.aborted).toBe(false);
    } finally {
      await app.close();
    }
  }, 10_000);

  it("shares one ping between concurrent requests", async () => {
    let calls = 0;
    const app = buildApp({
      catalog: idleCatalog(),
      source: never,
      workspace: workspace(),
      meta: metaDeps(async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }),
    });
    try {
      const results = await Promise.all([0, 1, 2].map(() => app.inject({ url: "/api/meta" })));
      expect(calls).toBe(1);
      const stamps = results.map((r) => r.json().source.checkedAt);
      expect(new Set(stamps).size).toBe(1);
      for (const r of results) expect(r.json().source.reachable).toBe(true);
    } finally {
      await app.close();
    }
  });
});

describe("credentials", () => {
  it("never sends source credentials", async () => {
    // The source URL lives in the ClickHouse client config; MetaDeps carries only the labels, so a
    // source config of http://default:s3cret@127.0.0.1:18123 cannot reach the answer.
    const app = buildApp({
      catalog: idleCatalog(),
      source: never,
      workspace: workspace(),
      meta: metaDeps(async () => {}),
    });
    try {
      const body = (await app.inject({ url: "/api/meta" })).body;
      for (const secret of ["s3cret", "18123", "127.0.0.1", "default:"]) {
        expect(body, secret).not.toContain(secret);
      }
    } finally {
      await app.close();
    }
  });
});
