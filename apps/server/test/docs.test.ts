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
    // The identity, rules, origins, session and web variables belong to the deployment guide
    // (add-multiuser M14); every other key to the data-source guide.
    const deployment = /^KIPSCOPE_(IDENTITY|OIDC_[A-Z_]+|ORIGINS|RULES|SESSION_IDLE_DAYS|WEB_DIR)$/;
    const guide = read("docs/data-sources.md");
    const deploy = read("docs/deploy.md");
    const example = read(".env.example");
    const missingInGuide = keys.filter((key) => !deployment.test(key) && !guide.includes(key));
    const missingInDeploy = keys.filter((key) => deployment.test(key) && !deploy.includes(key));
    const missingInExample = keys.filter((key) => !example.includes(key));
    expect(keys.filter((key) => deployment.test(key)).length).toBeGreaterThanOrEqual(10);
    expect(missingInGuide, "missing in docs/data-sources.md").toEqual([]);
    expect(missingInDeploy, "missing in docs/deploy.md").toEqual([]);
    expect(missingInExample, "missing in .env.example").toEqual([]);
  });

  it("documents the deployment: Ping, the own adapter, the rules and the trust boundary", () => {
    const deploy = read("docs/deploy.md");
    for (const word of [
      "PingFederate",
      "PingOne",
      "KIPSCOPE_TOKEN_COMMAND",
      "KIPSCOPE_TRUSTED_PROXIES",
      "module:",
      "forward-header",
      "rules",
    ])
      expect(deploy, `docs/deploy.md names ${word}`).toContain(word);
    expect(read("README.md"), "README links the deployment guide").toContain("docs/deploy.md");
    // The environment variables of the CLI are named in the README.
    for (const key of ["KIPSCOPE_TOKEN", "KIPSCOPE_SESSION"])
      expect(read("README.md"), `README names ${key}`).toContain(key);
  });

  it("documents the scope argument", () => {
    const guide = read("docs/data-sources.md");
    // The section "Scope" (a heading line that is just that word).
    const start = guide.search(/^#{1,6}\s+Scope\s*$/m);
    expect(start, 'docs/data-sources.md has a section "Scope"').toBeGreaterThanOrEqual(0);
    const rest = guide.slice(start);
    const level = (/^(#{1,6})\s/.exec(rest)?.[1] ?? "##").length;
    // Search the end only after the heading line itself.
    const headingEnd = rest.indexOf("\n") + 1;
    const next = rest.slice(headingEnd).search(new RegExp(`^#{1,${level}}\\s`, "m"));
    const section = next === -1 ? rest : rest.slice(0, headingEnd + next);
    // The 11 methods that take a scope (design Z1) and the rule's wording.
    for (const method of [
      "listSignals",
      "before",
      "after",
      "refBuckets",
      "extent",
      "refExtent",
      "refCount",
      "loggerGaps",
      "firstTimes",
      "stateChanges",
      "events",
    ]) {
      expect(section, `section "Scope" names ${method}`).toContain(method);
    }
    expect(section).toContain("as if the source held only");
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
    /** The declared level of each route (add-multiuser M6); `body` for the import route. */
    const levels = new Map<string, string>();
    app.addHook("onRoute", (route) => {
      for (const method of [route.method].flat()) {
        // Fastify adds HEAD for every GET; the guide lists the GET.
        if (method === "HEAD" || !route.url.startsWith("/api/")) continue;
        registered.add(`${method} ${route.url}`);
        const level = route.config?.access?.level;
        levels.set(`${method} ${route.url}`, typeof level === "string" ? level : "user");
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

    // The Access column names the level each route declares (`user` first for the import route,
    // whose level the body decides).
    const accessOf = new Map<string, string>();
    for (const m of guide.matchAll(
      /^\| `(GET|POST|PUT|PATCH|DELETE) (\/api\/[^`\s]*)` \| ([^|]+) \|/gm,
    ))
      accessOf.set(`${m[1]} ${m[2]}`, (m[3] ?? "").trim());
    for (const [route, level] of levels) {
      expect(accessOf.get(route), `${route} has an Access entry`).toBeDefined();
      expect(accessOf.get(route)?.startsWith(level), `${route}: ${accessOf.get(route)}`).toBe(true);
    }
  });
});
