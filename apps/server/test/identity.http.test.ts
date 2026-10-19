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
      rights: { data: ["*"], share: true },
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

  it("makes sessions of the user local in none mode whatever headers say", async () => {
    t = await multiApp({ identity: "none" });
    const created = await t.anon.post("/api/sessions", {}, { "x-test-user": "mallory" });
    expect(created.status).toBe(200);
    expect(created.body.session.owner).toBe("local");
    expect(t.sessions.listOf("mallory")).toEqual([]);
  });

  it("refuses every API route without a user", async () => {
    t = await multiApp({ identity: refuseAll(), licenseText: "AAL" });
    const owned = t.sessions.create("alice");
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
    // Under a session prefix as well.
    const prefixed = await t.anon.get(`/api/s/${owned.record.id}/workspace`);
    expect(prefixed.status).toBe(401);

    const live = await t.anon.live();
    expect(live.messages).toEqual([]);
    expect(live.status === 401 || live.closeCode !== undefined).toBe(true);
    expect(live.opened && live.messages.length > 0).toBe(false);

    expect(t.calls.length).toBe(callsBefore);
    expect(owned.store.revision).toBe(revision);
    expect(t.sessions.listOf("alice")).toHaveLength(1);

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

  it("reports roles and rights", async () => {
    const rules = {
      roles: [
        { role: "testers", data: ["test*"], share: true },
        { role: "viewers", data: ["demo"], share: false },
      ],
    };
    t = await multiApp({ rules });
    const both = await t.as("alice", ["testers", "viewers"]).get("/api/me");
    expect(both.status).toBe(200);
    expect(both.body).toEqual({
      user: "alice",
      identity: "test",
      roles: ["testers", "viewers"],
      rights: { data: ["test*", "demo"], share: true },
    });
    const viewer = await t.as("bob", ["viewers"]).get("/api/me");
    expect(viewer.body).toEqual({
      user: "bob",
      identity: "test",
      roles: ["viewers"],
      rights: { data: ["demo"], share: false },
    });
    // Also for a user without rights.
    const nobody = await t.as("carol", ["nobody"]).get("/api/me");
    expect(nobody.status).toBe(200);
    expect(nobody.body).toEqual({
      user: "carol",
      identity: "test",
      roles: ["nobody"],
      rights: { data: [], share: false },
    });
  });

  it("identifies the user of the live channel's upgrade", async () => {
    t = await multiApp();
    const alice = t.as("alice", ["all"]);
    const created = await alice.post("/api/sessions", {});
    const id = created.body.session.id as string;
    const live = await alice.live(id);
    await live.next((m) => m.type === "state");
    expect(live.messages.map((m) => m.type)).toEqual(["hello", "session", "state"]);
    const session = live.messages.find((m) => m.type === "session");
    expect(session).toMatchObject({ session: { id, owner: "alice" } });
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
});
