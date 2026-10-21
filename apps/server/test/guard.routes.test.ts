import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Access, Level } from "../src/guard.ts";
import type { IdentityAdapter } from "../src/identity.ts";
import { codeOf, type MultiApp, multiApp } from "./identityApp.ts";
import { clearRoutes, routeKey, routeLog } from "./routeLog.ts";

vi.mock("fastify", async (importOriginal) =>
  (await import("./routeLog.ts")).recordRoutes(await importOriginal()),
);

/**
 * The access table of design M6, written out by hand: the level of every route under `/api/` and
 * whether it names data refs (`dataRefs`). A route that is not in the table fails the test, so a
 * new route cannot bypass the guard unseen.
 */
const TABLE: Record<string, { level: Level | "body"; dataRefs: boolean }> = {
  "GET /api/license": { level: "public", dataRefs: false },
  "GET /api/me": { level: "user", dataRefs: false },
  "GET /api/workspaces": { level: "user", dataRefs: false },
  "POST /api/workspaces": { level: "user", dataRefs: true },
  "GET /api/workspaces/:id": { level: "user", dataRefs: false },
  "POST /api/workspaces/:id/share": { level: "user", dataRefs: false },
  "DELETE /api/workspaces/:id": { level: "user", dataRefs: false },
  "GET /api/views": { level: "user", dataRefs: false },
  "GET /api/views/:name": { level: "user", dataRefs: false },
  "DELETE /api/views/:name": { level: "user", dataRefs: false },
  "POST /api/views/import": { level: "body", dataRefs: true },
  "POST /api/views": { level: "change", dataRefs: false },
  "POST /api/views/open": { level: "change", dataRefs: true },
  "POST /api/commands": { level: "change", dataRefs: true },
  "GET /api/workspace": { level: "workspace", dataRefs: false },
  "GET /api/render-status": { level: "workspace", dataRefs: false },
  "GET /api/live": { level: "workspace", dataRefs: false },
  "GET /api/meta": { level: "workspace", dataRefs: false },
  // add-case-open K10: the catalog and the preview of a neighbour, both of the workspace.
  "GET /api/case": { level: "workspace", dataRefs: false },
  "GET /api/case/preview": { level: "workspace", dataRefs: false },
  "GET /api/catalog": { level: "workspace", dataRefs: false },
  "GET /api/signals": { level: "workspace", dataRefs: false },
  "POST /api/catalog/refresh": { level: "workspace", dataRefs: false },
  "GET /api/extent": { level: "workspace", dataRefs: true },
  "GET /api/series": { level: "workspace", dataRefs: true },
  "GET /api/value": { level: "workspace", dataRefs: true },
  "GET /api/density": { level: "workspace", dataRefs: true },
  "GET /api/calendar": { level: "workspace", dataRefs: true },
  "GET /api/gaps": { level: "workspace", dataRefs: true },
  "GET /api/events": { level: "workspace", dataRefs: true },
};

let t: MultiApp | undefined;
beforeEach(() => clearRoutes());
afterEach(async () => {
  await t?.close();
  t = undefined;
});

describe("the guard's route table", () => {
  it("every API route declares its access", async () => {
    t = await multiApp({ licenseText: "AAL" });
    const api = routeLog.filter((r) => r.url.startsWith("/api/"));
    expect(api.length).toBeGreaterThan(20);
    const seen = new Set<string>();
    for (const route of api) {
      const key = routeKey(route);
      expect(route.access, `${key} declares no config.access`).toBeDefined();
      const expected = TABLE[key];
      expect(expected, `${key} is not in the access table of design M6`).toBeDefined();
      const level = route.access?.level;
      expect(typeof level === "string" ? level : "body", key).toBe(expected?.level);
      expect(typeof route.access?.dataRefs === "function", `${key} dataRefs`).toBe(
        expected?.dataRefs,
      );
      seen.add(key);
    }
    // Every route of the table is registered (none dropped by mistake).
    expect([...seen].sort()).toEqual(Object.keys(TABLE).sort());
  });

  it("refuses to start when a route under /api/ declares no access", async () => {
    await expect(
      multiApp({
        extend: (app) => {
          app.register(async (inner) => {
            inner.get("/api/x", async () => ({ leaked: true }));
          });
        },
      }),
    ).rejects.toThrow(/\/api\/x/);
  });

  it("refuses to start for a route with another method or a nested path", async () => {
    for (const [method, url] of [
      ["post", "/api/w/anything"],
      ["delete", "/api/deep/er/path"],
      ["put", "/api/x"],
    ] as const) {
      await expect(
        multiApp({
          extend: (app) => {
            app.register(async (inner) => {
              inner[method](url, async () => ({}));
            });
          },
        }),
        `${method} ${url}`,
      ).rejects.toThrow(url);
    }
  });

  it("lets routes outside /api/ declare nothing", async () => {
    t = await multiApp({
      extend: (app) => {
        app.register(async (inner) => {
          inner.get("/health", async () => ({ ok: true }));
        });
      },
    });
    const res = await t.anon.get("/health");
    expect(res.status).toBe(200);
  });

  it("accepts a route that declares its access", async () => {
    const access: Access = { level: "user" };
    t = await multiApp({
      extend: (app) => {
        app.register(async (inner) => {
          inner.get("/api/ok", { config: { access } }, async () => ({ ok: true }));
        });
      },
    });
    expect((await t.anon.get("/api/ok")).status).toBe(401);
    expect((await t.as("alice", ["all"]).get("/api/ok")).status).toBe(200);
  });
});

describe("unknown paths and methods under /api/", () => {
  it("asks for a user before it admits that a path does not exist", async () => {
    t = await multiApp();
    const anon = await t.anon.get("/api/nosuchroute");
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe("unauthenticated");
    // Any signed-in user gets the plain 404, whatever their roles (roles decide nothing).
    expect((await t.as("alice", ["all"]).get("/api/nosuchroute")).status).toBe(404);
    expect((await t.as("eve", ["nobody"]).get("/api/nosuchroute")).status).toBe(404);
    expect((await t.as("eve").get("/api/nosuchroute")).status).toBe(404);
  });

  it("guards the HEAD route Fastify adds to every GET", async () => {
    t = await multiApp();
    for (const url of [
      "/api/workspace",
      "/api/catalog",
      "/api/series?signal=testcar/Fast_100h.SIG_A",
    ]) {
      const anon = await t.app.inject({ method: "HEAD", url });
      expect(anon.statusCode, `HEAD ${url}`).toBe(401);
    }
    // A signed-in user's new workspace has an empty grant: the data ref is refused.
    const hidden = await t.app.inject({
      method: "HEAD",
      url: "/api/series?signal=othercar/Fast_100h.SIG_A",
      headers: { "x-test-user": "alice", "x-test-roles": "testers" },
    });
    expect(hidden.statusCode).toBe(403);
  });
});

/** An adapter that refuses every request, as a misconfigured or expired sign-in does. */
const denyAll: IdentityAdapter = {
  kind: "deny-all",
  identify: async () => ({ refused: "unauthenticated" }),
};

/** Spellings of the `/api/` prefix that the router decodes to the plain one (RFC 3986: unreserved). */
const DECODED_PREFIXES = ["/%61pi", "/a%70i", "/ap%69", "/%61%70%69"];
/** Spellings that must not reach a handler: an encoded slash or another case is no `/api/`. */
const OTHER_PREFIXES = ["/api%2F", "/api%2f", "/%41pi/", "/%2Fapi/", "/api%252F"];

/** `/api/x` with its prefix spelled as `prefix` (a prefix ending in `/` keeps the one slash). */
const spelled = (url: string, prefix: string) =>
  prefix.endsWith("/") ? `${prefix}${url.slice("/api/".length)}` : `${prefix}${url.slice(4)}`;

describe("an encoded /api/ prefix is guarded like the plain one", () => {
  type Method = "GET" | "POST" | "DELETE";
  const body = (method: string) => (method === "POST" ? {} : undefined);

  /** The registered API routes with their parameters filled in. */
  const concrete = (id: string) =>
    routeLog
      .filter((r) => r.url.startsWith("/api/") && !["HEAD", "OPTIONS"].includes(r.method))
      .map((r) => ({
        method: r.method as Method,
        url: r.url.replace(":id", id).replace(":name", "speeds"),
      }));

  for (const [label, identity] of [
    ["a deny-all adapter", denyAll],
    ["the test adapter without a user", undefined],
  ] as const) {
    it(`answers every route like its plain form with ${label}`, async () => {
      t = await multiApp({ ...(identity ? { identity } : {}), licenseText: "AAL" });
      const owned = t.workspaces.create("alice");
      const routes = concrete(owned.record.id);
      expect(routes.length).toBeGreaterThan(20);
      const callsBefore = t.calls.length;
      let checked = 0;
      for (const { method, url } of routes) {
        const plain = await t.anon.request(method, url, body(method));
        const isPublic = url === "/api/license";
        expect(plain.status, `plain ${method} ${url}`).toBe(isPublic ? 200 : 401);
        for (const prefix of DECODED_PREFIXES) {
          const res = await t.anon.request(method, spelled(url, prefix), body(method));
          const key = `${method} ${spelled(url, prefix)}`;
          expect([res.status, codeOf(res.body)], key).toEqual([plain.status, codeOf(plain.body)]);
          expect(res.text, key).toBe(plain.text);
          checked++;
        }
        for (const prefix of OTHER_PREFIXES) {
          const res = await t.anon.request(method, spelled(url, prefix), body(method));
          const key = `${method} ${spelled(url, prefix)}`;
          // No handler: not found, or the guard's refusal; never data and never a crash.
          expect([401, 404], key).toContain(res.status);
          // Fastify's own 404 echoes the path the caller sent; it holds nothing of the workspace.
          expect(res.text, key).not.toContain("alice");
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(200);
      // Nothing got through to a source, and no workspace appeared.
      expect(t.calls.length).toBe(callsBefore);
      expect(t.workspaces.listOf("alice")).toHaveLength(1);
    });
  }

  it("does not read a workspace prefix after an encoded /api/ as a prefix", async () => {
    t = await multiApp();
    const owned = t.workspaces.create("alice");
    const eve = t.as("eve", ["nobody"]);
    const revision = owned.store.revision;
    // The rewrite knows the plain `/api/w/<id>/` only: after an encoded `api` the path names no
    // route, so it never reaches alice's private workspace, whatever the spelling.
    for (const prefix of DECODED_PREFIXES) {
      for (const [method, rest] of [
        ["GET", "workspace"],
        ["GET", "catalog"],
        ["POST", "commands"],
      ] as const) {
        const url = `${prefix}/w/${owned.record.id}/${rest}`;
        const res = await eve.request(
          method,
          url,
          method === "POST" ? { type: "cursor.setDiff", diff: true } : undefined,
        );
        expect(res.status, `${method} ${url}`).toBe(404);
        expect(res.text, `${method} ${url}`).not.toContain("alice");
      }
    }
    expect(owned.store.revision).toBe(revision);
    expect(t.workspaces.listOf("eve")).toEqual([]);
  });

  it("guards an encoded prefix of a path that names no route", async () => {
    t = await multiApp();
    for (const prefix of DECODED_PREFIXES) {
      const anon = await t.anon.get(`${prefix}/nosuchroute`);
      expect([anon.status, codeOf(anon.body)], prefix).toEqual([401, "unauthenticated"]);
      const signedIn = await t.as("eve", ["nobody"]).get(`${prefix}/nosuchroute`);
      expect(signedIn.status, prefix).toBe(404);
    }
  });

  it("answers an existing and a missing workspace alike for a caller who is not signed in", async () => {
    for (const identity of [denyAll, undefined]) {
      t = await multiApp(identity ? { identity } : {});
      const owned = t.workspaces.create("alice");
      const missing = "zzzzzzzzzz";
      expect(t.workspaces.get(missing)).toBeUndefined();
      for (const prefix of [...DECODED_PREFIXES, "/api"]) {
        for (const [method, rest] of [
          ["GET", ""],
          ["POST", "/share"],
          ["DELETE", ""],
        ] as const) {
          const answer = async (id: string) => {
            const res = await t?.anon.request(
              method,
              `${prefix}/workspaces/${id}${rest}`,
              method === "POST" ? { share: "read" } : undefined,
            );
            return { status: res?.status, text: res?.text.replaceAll(id, "ID") };
          };
          const existing = await answer(owned.record.id);
          const absent = await answer(missing);
          const key = `${method} ${prefix}/workspaces/<id>${rest}`;
          expect(existing.status, key).toBe(401);
          expect(existing, key).toEqual(absent);
        }
        // And through the workspace prefix of a workspace route.
        const viaExisting = await t.anon.get(`${prefix}/w/${owned.record.id}/workspace`);
        const viaMissing = await t.anon.get(`${prefix}/w/${missing}/workspace`);
        expect([401, 404], prefix).toContain(viaExisting.status);
        expect(viaExisting.status, prefix).toBe(viaMissing.status);
        expect(viaExisting.text.replaceAll(owned.record.id, "ID"), prefix).toBe(
          viaMissing.text.replaceAll(missing, "ID"),
        );
      }
      expect(t.workspaces.get(owned.record.id)).toBeDefined();
      await t.close();
      t = undefined;
    }
  });

  it("answers a signed-in caller as the plain form does, a foreign and a missing workspace each", async () => {
    t = await multiApp();
    const bob = t.workspaces.create("bob");
    const alice = t.as("alice", ["all"]);
    for (const id of [bob.record.id, "zzzzzzzzzz"]) {
      const plain = await alice.get(`/api/workspaces/${id}`);
      expect([403, 404], id).toContain(plain.status);
      for (const prefix of DECODED_PREFIXES) {
        const res = await alice.get(`${prefix}/workspaces/${id}`);
        expect([res.status, res.text], `${prefix} ${id}`).toEqual([plain.status, plain.text]);
        expect(res.text).not.toContain("bob");
      }
    }
  });
});

describe("a 16 KB query string through the guard", () => {
  it("refuses a 16 KB data ref in the time of a short one", async () => {
    t = await multiApp();
    const user = t.as("alice", ["many"]);
    const own = t.workspaces.create("alice");
    t.workspaces.grantObjects(own.record.id, ["testcar"]);
    const long = "a".repeat(16 * 1024);
    for (const url of [
      `/api/density?dataRef=${long}`,
      `/api/gaps?dataRef=testcar&signal=${long}/Fast_100h.SIG_A`,
      `/api/series?signal=${long}/Fast_100h.SIG_A`,
      // A repeated parameter: the long value comes second.
      `/api/events?dataRef=${long.slice(0, 20)}b&dataRef=${long}`,
    ]) {
      const started = performance.now();
      const res = await user.get(url);
      const took = performance.now() - started;
      const key = url.slice(0, 60);
      expect([res.status, codeOf(res.body)], key).toEqual([403, "forbidden_data"]);
      expect(took, `ms for ${key}`).toBeLessThan(750);
    }
    // The same through an encoded prefix and a workspace prefix.
    for (const url of [
      `/%61pi/density?dataRef=${long}`,
      `/api/w/${own.record.id}/density?dataRef=${long}`,
    ]) {
      const started = performance.now();
      const res = await user.get(url);
      expect([res.status, codeOf(res.body)], url.slice(0, 40)).toEqual([403, "forbidden_data"]);
      expect(performance.now() - started, url.slice(0, 40)).toBeLessThan(750);
    }
  });
});
