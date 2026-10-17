import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { Catalog } from "../src/catalog.ts";
import type { DataSource } from "../src/datasource.ts";
import { ViewStore } from "../src/views.ts";
import { WorkspaceStore } from "../src/workspace.ts";

const ROOT = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

describe("documents", () => {
  it("documents every source variable", () => {
    // Every KIPSCOPE_* and CLICKHOUSE_* key config.ts reads (a wildcard like KIPSCOPE_COLUMN_* is no key).
    const keys = [
      ...new Set(
        read("apps/server/src/config.ts").match(/\b(?:KIPSCOPE|CLICKHOUSE)_[A-Z0-9_]*[A-Z0-9]\b/g),
      ),
    ].sort();
    // A sanity floor, so a broken pattern cannot pass by finding nothing.
    expect(keys).toEqual(
      expect.arrayContaining([
        "CLICKHOUSE_URL",
        "KIPSCOPE_SOURCE",
        "KIPSCOPE_ADX_CLUSTER",
        "KIPSCOPE_ADX_DATABASE",
        "KIPSCOPE_ADX_AUTH",
        "KIPSCOPE_TABLE",
        "KIPSCOPE_EVENTS_TABLE",
      ]),
    );
    const guide = read("docs/data-sources.md");
    const example = read(".env.example");
    const missingInGuide = keys.filter((key) => !guide.includes(key));
    const missingInExample = keys.filter((key) => !example.includes(key));
    expect(missingInGuide, "missing in docs/data-sources.md").toEqual([]);
    expect(missingInExample, "missing in .env.example").toEqual([]);
  });

  it("documents every HTTP route", async () => {
    const source = {} as DataSource;
    const app = buildApp({
      catalog: new Catalog(source, async () => new Map()),
      source,
      workspace: new WorkspaceStore({ signalExists: () => true, hasStates: () => false }),
      views: new ViewStore(resolve(ROOT, "node_modules/.kipscope-docs-test-views")),
    });
    const registered = new Set<string>();
    app.addHook("onRoute", (route) => {
      for (const method of [route.method].flat()) {
        // Fastify adds HEAD for every GET; the guide lists the GET.
        if (method === "HEAD" || !route.url.startsWith("/api/")) continue;
        registered.add(`${method} ${route.url}`);
      }
    });
    try {
      await app.ready();
    } finally {
      await app.close();
    }
    expect(registered.size).toBeGreaterThan(15);
    expect(registered).toContain("GET /api/live");

    const guide = read("docs/http-api.md");
    const documented = new Set(
      [...guide.matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/api\/[^`\s]*)`/g)].map(
        (m) => `${m[1]} ${m[2]}`,
      ),
    );
    expect(
      [...registered].filter((route) => !documented.has(route)).sort(),
      "not documented",
    ).toEqual([]);
    expect(
      [...documented].filter((route) => !registered.has(route)).sort(),
      "not registered",
    ).toEqual([]);
  });
});
