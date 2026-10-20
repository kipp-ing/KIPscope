import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IdentityAdapter } from "../src/identity.ts";
import { codeOf, type MultiApp, multiApp } from "./identityApp.ts";
import { clearRoutes, routeLog, warnLog } from "./routeLog.ts";

vi.mock("fastify", async (importOriginal) =>
  (await import("./routeLog.ts")).recordRoutes(await importOriginal()),
);

let t: MultiApp | undefined;
beforeEach(() => clearRoutes());
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const refuseAll = (
  refused: "unauthenticated" | "invalid_token" = "unauthenticated",
): IdentityAdapter => ({
  kind: "test-refuse",
  identify: async () => ({ refused }),
});

describe("identity over HTTP", () => {
  it("answers the local user without login", async () => {
    t = await multiApp({ identity: "none" });
    const plain = await t.anon.get("/api/me");
    expect(plain.status).toBe(200);
    expect(plain.body).toEqual({
      user: "local",
      identity: "none",
      roles: [],
      canShare: true,
    });
    // Headers do not change who the user is: no adapter runs.
    const headers = {
      authorization: "Bearer x",
      "x-forwarded-user": "mallory",
      "x-test-user": "mallory",
      "x-test-roles": "admins",
    };
    const forged = await t.anon.get("/api/me", headers);
    expect(forged.status).toBe(200);
    expect(forged.body).toEqual(plain.body);
  });

  it("makes workspaces of the user local in none mode whatever headers say", async () => {
    t = await multiApp({ identity: "none" });
    const created = await t.anon.post("/api/workspaces", {}, { "x-test-user": "mallory" });
    expect(created.status).toBe(200);
    expect(created.body.workspace.owner).toBe("local");
    expect(t.workspaces.listOf("mallory")).toEqual([]);
  });

  it("refuses every API route without a user", async () => {
    t = await multiApp({ identity: refuseAll(), licenseText: "AAL" });
    const owned = t.workspaces.create("alice");
    const revision = owned.store.revision;
    const callsBefore = t.calls.length;

    // The two the scenario names, then every registered route but the license.
    const command = await t.anon.post("/api/commands", {
      type: "window.create",
      from: "0",
      to: "10",
    });
    expect(command.status).toBe(401);
    expect(codeOf(command.body)).toBe("unauthenticated");
    const series = await t.anon.get("/api/series?signal=testcar/Fast_100h.SIG_A");
    expect(series.status).toBe(401);
    expect(codeOf(series.body)).toBe("unauthenticated");

    const filled = (url: string) => url.replace(":id", owned.record.id).replace(":name", "speeds");
    const api = routeLog.filter((r) => r.url.startsWith("/api/") && r.url !== "/api/license");
    expect(api.length).toBeGreaterThan(20);
    for (const route of api) {
      if (route.method === "GET" && route.url === "/api/live") continue;
      const res = await t.anon.request(
        route.method as "GET" | "POST" | "DELETE",
        filled(route.url),
        route.method === "POST" ? {} : undefined,
      );
      expect(res.status, `${route.method} ${route.url}`).toBe(401);
      expect(codeOf(res.body), `${route.method} ${route.url}`).toBe("unauthenticated");
    }
    // Under a workspace prefix as well.
    const prefixed = await t.anon.get(`/api/w/${owned.record.id}/workspace`);
    expect(prefixed.status).toBe(401);

    const live = await t.anon.live();
    expect(live.messages).toEqual([]);
    expect(live.status === 401 || live.closeCode !== undefined).toBe(true);
    expect(live.opened && live.messages.length > 0).toBe(false);

    expect(t.calls.length).toBe(callsBefore);
    expect(owned.store.revision).toBe(revision);
    expect(t.workspaces.listOf("alice")).toHaveLength(1);

    // The license is public.
    const license = await t.anon.get("/api/license");
    expect(license.status).toBe(200);
    expect(license.text).toContain("AAL");
  });

  it("answers invalid_token for a refusal with that code", async () => {
    t = await multiApp({ identity: refuseAll("invalid_token") });
    const res = await t.anon.get("/api/me");
    expect(res.status).toBe(401);
    expect(codeOf(res.body)).toBe("invalid_token");
  });

  it("fails closed on a bad adapter", async () => {
    const throwing: IdentityAdapter = {
      kind: "test-throws",
      identify: async () => {
        throw new Error("jwks down: secret-detail");
      },
    };
    const badUser: IdentityAdapter = {
      kind: "test-baduser",
      identify: async () => ({ user: "../x", roles: ["all"] }),
    };
    const tooManyRoles: IdentityAdapter = {
      kind: "test-roles",
      identify: async () => ({
        user: "alice",
        roles: Array.from({ length: 201 }, (_, i) => `r${i}`),
      }),
    };
    const results: {
      name: string;
      status: number;
      code: string | undefined;
      text: string;
      warns: number;
    }[] = [];
    for (const [name, identity] of [
      ["throws", throwing],
      ["bad user", badUser],
      ["201 roles", tooManyRoles],
    ] as const) {
      clearRoutes();
      const app = await multiApp({ identity });
      const res = await app.anon.get("/api/me");
      results.push({
        name,
        status: res.status,
        code: codeOf(res.body),
        text: res.text,
        warns: warnLog.length,
      });
      await app.close();
    }
    expect(results.map((r) => [r.status, r.code])).toEqual([
      [503, "identity_unavailable"],
      [401, "unauthenticated"],
      [401, "unauthenticated"],
    ]);
    expect(results[0]?.text).not.toContain("secret-detail");
    // Each logged one warning.
    expect(results.map((r) => r.warns)).toEqual([1, 1, 1]);
  });

  it("logs a repeated adapter failure once per minute", async () => {
    let now = 1_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => now);
    try {
      t = await multiApp({
        identity: {
          kind: "test-throws",
          identify: async () => {
            throw new Error("idp unreachable");
          },
        },
      });
      for (let i = 0; i < 5; i++) expect((await t.anon.get("/api/me")).status).toBe(503);
      expect(warnLog).toHaveLength(1);
      now += 61_000;
      await t.anon.get("/api/me");
      expect(warnLog).toHaveLength(2);
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses a result with malformed roles or a malformed user", async () => {
    const odd = (result: unknown): IdentityAdapter => ({
      kind: "test-odd",
      identify: async () => result as never,
    });
    for (const [name, result] of [
      ["empty user", { user: "", roles: [] }],
      ["no roles", { user: "alice" }],
      ["roles not an array", { user: "alice", roles: "all" }],
      ["number role", { user: "alice", roles: [1] }],
      ["empty role", { user: "alice", roles: [""] }],
      ["long role", { user: "alice", roles: ["r".repeat(129)] }],
      ["control role", { user: "alice", roles: ["a\u0000b"] }],
      ["long user", { user: "a".repeat(65), roles: [] }],
      ["slash user", { user: "a/b", roles: [] }],
      ["undefined", undefined],
      ["null", null],
      ["string", "alice"],
    ] as const) {
      const app = await multiApp({ identity: odd(result) });
      const res = await app.anon.get("/api/me");
      expect([res.status, codeOf(res.body)], name).toEqual([401, "unauthenticated"]);
      await app.close();
    }
  });

  it("reports roles and the share switch", async () => {
    const users: [string, string[]][] = [
      ["alice", ["testers", "viewers"]],
      ["bob", []],
    ];
    // KIPSCOPE_SHARE unset (on), then off: roles are shown only and canShare follows the switch.
    for (const share of [undefined, false]) {
      t = await multiApp(share === undefined ? {} : { share });
      for (const [user, roles] of users) {
        const res = await t.as(user, roles).get("/api/me");
        expect(res.status, user).toBe(200);
        expect(res.body, user).toEqual({
          user,
          identity: "test",
          roles,
          canShare: share === undefined,
        });
        expect(res.body, user).not.toHaveProperty("rights");
      }
      await t.close();
      t = undefined;
    }
  });

  it("identifies the user of the live channel's upgrade", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const created = await alice.post("/api/workspaces", {});
    const id = created.body.workspace.id as string;
    const live = await alice.live(id);
    await live.next((m) => m.type === "state");
    expect(live.messages.map((m) => m.type)).toEqual(["hello", "summary", "state"]);
    const summary = live.messages.find((m) => m.type === "summary");
    expect(summary).toMatchObject({ summary: { id, owner: "alice" } });
    live.close();
  });

  it("uses a fresh identity for every request", async () => {
    t = await multiApp();
    const a = await t.as("alice", ["all"]).get("/api/me");
    const b = await t.as("bob", ["testers"]).get("/api/me");
    const c = await t.anon.get("/api/me");
    expect([a.body.user, b.body.user, c.status]).toEqual(["alice", "bob", 401]);
    // Same connection pool, headers swapped: nothing sticks to the server side.
    const again = await t.as("alice", ["all"]).get("/api/me");
    expect(again.body.user).toBe("alice");
  });

  it("hands the adapter the path as the router reads it, without the query string", async () => {
    const paths: string[] = [];
    const recorder: IdentityAdapter = {
      kind: "test-record",
      identify: async (request) => {
        paths.push(request.path);
        return { user: "alice", roles: ["all"] };
      },
    };
    t = await multiApp({ identity: recorder });
    const cases: [string, string][] = [
      ["/%61pi/me", "/api/me"],
      ["/a%70i/me?x=1&y=%61", "/api/me"],
      ["/%61%70%69/me", "/api/me"],
      ["/api/me?x=1", "/api/me"],
      // A plain workspace prefix is rewritten away before the guard runs; an encoded workspace ID
      // is not (no such route), and the adapter sees it decoded.
      ["/api/w/abcdefghij/workspace?rev=3", "/api/workspace"],
      ["/api/w/%61bcdefghij/workspace", "/api/w/abcdefghij/workspace"],
      ["/api/w/abcdefghij/%77orkspace?rev=3", "/api/workspace"],
    ];
    for (const [url, routed] of cases) {
      paths.length = 0;
      await t.anon.get(url);
      expect(paths, url).toEqual([routed]);
    }
  });
});
