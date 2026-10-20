import { afterEach, describe, expect, it, vi } from "vitest";
import type { IdentityAdapter } from "../../src/identity.ts";
import { codeOf, type MultiApp, multiApp } from "../identityApp.ts";
import {
  claims,
  type JwksServer,
  jwksServer,
  makeKey,
  signHs256,
  signToken,
  type TestKey,
  unsignedToken,
} from "../jwks.ts";
import { AUDIENCE, oidcAdapter, tokenClaims } from "./oidcKit.ts";

/** Everything written to the logs and the console while a test runs. */
function captureLogs() {
  const lines: string[] = [];
  const collect = (m: unknown) => {
    lines.push(typeof m === "string" ? m : JSON.stringify(m));
  };
  const spies = [
    vi.spyOn(console, "log").mockImplementation(collect),
    vi.spyOn(console, "info").mockImplementation(collect),
    vi.spyOn(console, "warn").mockImplementation(collect),
    vi.spyOn(console, "error").mockImplementation(collect),
    vi.spyOn(console, "debug").mockImplementation(collect),
    vi.spyOn(process.stderr, "write").mockImplementation((m) => {
      collect(m);
      return true;
    }),
    vi.spyOn(process.stdout, "write").mockImplementation((m) => {
      collect(m);
      return true;
    }),
  ];
  return {
    lines,
    stop: () => {
      for (const spy of spies) spy.mockRestore();
    },
  };
}

let apps: MultiApp[] = [];
let servers: JwksServer[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(apps.map((a) => a.close()));
  await Promise.all(servers.map((s) => s.close()));
  apps = [];
  servers = [];
});

/** A server running `oidc` against a fresh JWKS server. */
async function oidcApp(
  keys: TestKey[],
  env: Record<string, string> = {},
  log: { info(m: string): void; warn(m: string): void; debug?(m: string): void } = {
    info() {},
    warn() {},
  },
) {
  const jwks = await jwksServer(keys);
  servers.push(jwks);
  const identity: IdentityAdapter = await oidcAdapter(jwks, env, log);
  const t = await multiApp({ identity });
  apps.push(t);
  return { jwks, t, identity };
}

const me = (t: MultiApp, token: string | undefined, header = "authorization") =>
  t.anon.get(
    "/api/me",
    token === undefined ? {} : { [header]: header === "authorization" ? `Bearer ${token}` : token },
  );

describe("oidc identity adapter", () => {
  it("validates Ping-style access tokens", async () => {
    const key = makeKey("RS256");
    const wrongKey = makeKey("RS256", key.kid);
    const captured = captureLogs();
    // The adapter's own log (all levels) is read with the console: no line may hold a token.
    const adapterLog = (m: string) => captured.lines.push(m);
    const { jwks, t } = await oidcApp(
      [key],
      {},
      { info: adapterLog, warn: adapterLog, debug: adapterLog },
    );
    const now = Math.floor(Date.now() / 1000);
    const c = (over: Record<string, unknown> = {}) => tokenClaims(jwks, over);
    // The HS256 forgery uses the published key as the secret, in both of its text forms.
    const pem = key.publicKey.export({ type: "spki", format: "pem" }) as string;
    const modulus = String((key.jwk as { n: string }).n);

    const tokens: Record<string, string> = {
      valid: signToken(key, c()),
      spaceRoles: signToken(key, c({ roles: "testers viewers" })),
      wrongKey: signToken(wrongKey, c()),
      none: unsignedToken(c(), { kid: key.kid }),
      hsPem: signHs256(pem, c(), { kid: key.kid }),
      hsModulus: signHs256(modulus, c(), { kid: key.kid }),
      wrongIss: signToken(key, c({ iss: "https://evil.example" })),
      issSlash: signToken(key, c({ iss: `${jwks.issuer}/` })),
      wrongAud: signToken(key, c({ aud: "someone-else" })),
      expired31: signToken(key, c({ exp: now - 31 })),
      expired29: signToken(key, c({ exp: now - 29 })),
      noExp: signToken(key, c({ exp: undefined })),
      nbfFuture: signToken(key, c({ nbf: now + 60 })),
      nbfPast: signToken(key, c({ nbf: now - 60 })),
      badUser: signToken(key, c({ sub: "../x" })),
      noUser: signToken(key, c({ sub: undefined })),
      audArray: signToken(key, c({ aud: ["other", AUDIENCE] })),
      audArrayWithout: signToken(key, c({ aud: ["other", "another"] })),
    };

    const ok = async (name: string, user: string, roles: string[]) => {
      const res = await me(t, tokens[name]);
      expect(res.status, name).toBe(200);
      expect(res.body, name).toMatchObject({ user, identity: "oidc", roles });
    };
    await ok("valid", "alice", ["testers"]);
    await ok("spaceRoles", "alice", ["testers", "viewers"]);
    await ok("expired29", "alice", ["testers"]);
    await ok("nbfPast", "alice", ["testers"]);
    await ok("audArray", "alice", ["testers"]);

    const none = await me(t, undefined);
    expect(none.status).toBe(401);
    expect(codeOf(none.body)).toBe("unauthenticated");

    const invalid = [
      "wrongKey",
      "none",
      "hsPem",
      "hsModulus",
      "wrongIss",
      "issSlash",
      "wrongAud",
      "expired31",
      "noExp",
      "nbfFuture",
      "badUser",
      "noUser",
      "audArrayWithout",
    ];
    for (const name of invalid) {
      const res = await me(t, tokens[name]);
      expect(res.status, name).toBe(401);
      expect(codeOf(res.body), name).toBe("invalid_token");
    }
    const garbage = await me(t, "garbage");
    expect([garbage.status, codeOf(garbage.body)]).toEqual([401, "invalid_token"]);

    // No token in the logs, none echoed in an answer. A refusal is logged with its reason and the
    // key ID of the token, never the token.
    captured.stop();
    const logged = captured.lines.join("\n");
    for (const reason of ["expired", "wrong_audience", "bad_signature"])
      expect(logged, reason).toContain(reason);
    expect(logged).toContain(key.kid);
    for (const token of Object.values(tokens)) {
      for (const line of captured.lines) expect(line).not.toContain(token);
    }
    for (const name of invalid)
      expect((await me(t, tokens[name])).text).not.toContain(tokens[name]);
  });

  it("refuses an oversized token and a non-bearer scheme", async () => {
    const key = makeKey("RS256");
    const { jwks, t } = await oidcApp([key]);
    // 16 KB cap: a token of valid shape but 20 KB of roles is refused unread.
    const huge = signToken(key, tokenClaims(jwks, { roles: ["r".repeat(20_000)] }));
    expect(huge.length).toBeGreaterThan(16 * 1024);
    const big = await me(t, huge);
    expect(big.status).toBe(401);
    expect(codeOf(big.body)).toBe("invalid_token");
    // The scheme is case-insensitive.
    const good = signToken(key, tokenClaims(jwks));
    const lower = await t.anon.get("/api/me", { authorization: `bearer ${good}` });
    expect(lower.status).toBe(200);
    // Another scheme carries no bearer token.
    const basic = await t.anon.get("/api/me", { authorization: `Basic ${good}` });
    expect(basic.status).toBe(401);
    // The bare token without a scheme is no bearer token either.
    const bare = await t.anon.get("/api/me", { authorization: good });
    expect(bare.status).toBe(401);
  });

  it("accepts ES256 and refuses an algorithm outside KIPSCOPE_OIDC_ALGS", async () => {
    const rsa = makeKey("RS256");
    const ec = makeKey("ES256");
    const { jwks, t } = await oidcApp([rsa, ec], { KIPSCOPE_OIDC_ALGS: "ES256" });
    const ok = await me(t, signToken(ec, tokenClaims(jwks)));
    expect(ok.status).toBe(200);
    const refused = await me(t, signToken(rsa, tokenClaims(jwks)));
    expect(refused.status).toBe(401);
    expect(codeOf(refused.body)).toBe("invalid_token");
  });

  it("reads the token from another header as the bare JWT", async () => {
    const key = makeKey("ES256");
    const { jwks, t } = await oidcApp([key], { KIPSCOPE_OIDC_HEADER: "x-forwarded-access-token" });
    const token = signToken(key, tokenClaims(jwks));
    const ok = await me(t, token, "x-forwarded-access-token");
    expect(ok.status).toBe(200);
    // A bearer token in Authorization is not looked at then.
    const wrongHeader = await t.anon.get("/api/me", { authorization: `Bearer ${token}` });
    expect(wrongHeader.status).toBe(401);
    expect(codeOf(wrongHeader.body)).toBe("unauthenticated");
  });

  it("refetches the key set on rotation, rate-limited", async () => {
    const key1 = makeKey("RS256");
    const { jwks, t } = await oidcApp([key1]);
    const first = await me(t, signToken(key1, tokenClaims(jwks)));
    expect(first.status).toBe(200);
    const fetched = jwks.fetches.jwks;

    // The IdP rotates: a token with the new kid arrives and is accepted after one fetch.
    const key2 = makeKey("RS256");
    jwks.setKeys([key2]);
    const rotated = await me(t, signToken(key2, tokenClaims(jwks)));
    expect(rotated.status).toBe(200);
    expect(jwks.fetches.jwks).toBe(fetched + 1);

    // 20 tokens with random unknown kids within 10 s cause no further fetch and are refused.
    const attacker = makeKey("RS256");
    for (let i = 0; i < 20; i++) {
      const res = await me(
        t,
        signToken(attacker, tokenClaims(jwks), { kid: `unknown-${i}-${Math.random()}` }),
      );
      expect(res.status).toBe(401);
      expect(codeOf(res.body)).toBe("invalid_token");
    }
    expect(jwks.fetches.jwks).toBe(fetched + 1);
  });

  it("refetches an unknown key again after 30 seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
    const key1 = makeKey("RS256");
    const { jwks, t } = await oidcApp([key1]);
    expect((await me(t, signToken(key1, tokenClaims(jwks)))).status).toBe(200);
    const key2 = makeKey("RS256");
    const key3 = makeKey("RS256");
    jwks.setKeys([key2]);
    expect((await me(t, signToken(key2, tokenClaims(jwks)))).status).toBe(200);
    jwks.setKeys([key3]);
    const early = await me(t, signToken(key3, tokenClaims(jwks)));
    expect(early.status).toBe(401);
    vi.setSystemTime(Date.now() + 31_000);
    const later = await me(t, signToken(key3, tokenClaims(jwks)));
    expect(later.status).toBe(200);
  });

  it("answers 503 while the key set cannot be fetched and recovers", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date() });
    const key = makeKey("ES256");
    const jwks = await jwksServer([key]);
    servers.push(jwks);
    jwks.down();
    const identity = await oidcAdapter(jwks);
    const t = await multiApp({ identity });
    apps.push(t);
    const token = signToken(key, tokenClaims(jwks));
    const before = jwks.fetches.jwks;
    for (let i = 0; i < 5; i++) {
      const res = await me(t, token);
      expect(res.status).toBe(503);
      expect(codeOf(res.body)).toBe("identity_unavailable");
    }
    // Retried at most every 30 s: five requests in a burst fetch at most once more.
    expect(jwks.fetches.jwks - before).toBeLessThanOrEqual(1);
    jwks.up();
    vi.setSystemTime(Date.now() + 31_000);
    expect((await me(t, token)).status).toBe(200);
  });

  it("reads user and roles from configured claims", async () => {
    const key = makeKey("RS256");
    const { jwks, t } = await oidcApp([key], {
      KIPSCOPE_OIDC_ROLES_CLAIM: "realm_access.roles",
      KIPSCOPE_OIDC_USER_CLAIM: "preferred_username",
    });
    const token = signToken(
      key,
      claims(
        {
          preferred_username: "bob",
          realm_access: { roles: ["viewers"] },
          roles: ["admins"],
          sub: "x-1",
        },
        {
          iss: jwks.issuer,
          aud: AUDIENCE,
        },
      ),
    );
    const res = await me(t, token);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ user: "bob", roles: ["viewers"] });
    // A token without the roles claim has no roles (not an error).
    const bare = signToken(
      key,
      tokenClaims(jwks, { realm_access: undefined, preferred_username: "carol" }),
    );
    const noRoles = await me(t, bare);
    expect(noRoles.status).toBe(200);
    expect(noRoles.body).toMatchObject({ user: "carol", roles: [] });
  });

  it("reads comma-separated roles and none from a missing claim", async () => {
    const key = makeKey("RS256");
    const { jwks, t } = await oidcApp([key]);
    const comma = await me(t, signToken(key, tokenClaims(jwks, { roles: "testers,viewers" })));
    expect(comma.body).toMatchObject({ roles: ["testers", "viewers"] });
    const missing = await me(t, signToken(key, tokenClaims(jwks, { roles: undefined })));
    expect(missing.status).toBe(200);
    expect(missing.body.roles).toEqual([]);
    expect(missing.body).not.toHaveProperty("rights");
    // Roles decide nothing (D-085): a token without roles uses the workspace routes like any other.
    const token = signToken(key, tokenClaims(jwks, { roles: undefined }));
    const used = await t.anon.get("/api/workspace", { authorization: `Bearer ${token}` });
    expect(used.status).toBe(200);
  });

  it("refuses a token of another issuer on a workspace route", async () => {
    const key = makeKey("RS256");
    const { jwks, t } = await oidcApp([key]);
    const bearer = (over: Record<string, unknown>) => ({
      authorization: `Bearer ${signToken(key, tokenClaims(jwks, over))}`,
    });
    // alice owns a workspace shared for writing.
    const created = await t.anon.post("/api/workspaces", {}, bearer({ sub: "alice" }));
    expect(created.status).toBe(200);
    const id = created.body.workspace.id as string;
    const shared = await t.anon.post(
      `/api/workspaces/${id}/share`,
      { share: "write" },
      bearer({ sub: "alice" }),
    );
    expect(shared.body.workspace.share).toBe("write");

    // bob of the same issuer opens it; a token signed by the same key with another issuer does not.
    const good = await t.anon.get(`/api/w/${id}/workspace`, bearer({ sub: "bob" }));
    expect(good.status).toBe(200);
    const other = await t.anon.get(
      `/api/w/${id}/workspace`,
      bearer({ sub: "bob", iss: "https://other.example" }),
    );
    expect([other.status, codeOf(other.body)]).toEqual([401, "invalid_token"]);
    const posted = await t.anon.post(
      `/api/w/${id}/commands`,
      { type: "window.create", from: "0", to: "10" },
      bearer({ sub: "bob", iss: "https://other.example" }),
    );
    expect([posted.status, codeOf(posted.body)]).toEqual([401, "invalid_token"]);
    expect(t.workspaces.get(id)?.store.revision).toBe(0);
  });

  it("identifies the live channel's upgrade by its token", async () => {
    const key = makeKey("ES256");
    const { jwks, t } = await oidcApp([key]);
    const bearer = (over: Record<string, unknown> = {}) => ({
      authorization: `Bearer ${signToken(key, tokenClaims(jwks, over))}`,
    });
    const good = await t.anon.live(undefined, bearer());
    await good.next((m) => m.type === "state");
    expect(good.messages.map((m) => m.type)).toEqual(["hello", "summary", "state"]);
    expect(good.last("summary")?.summary.owner).toBe("alice");
    good.close();

    const now = Math.floor(Date.now() / 1000);
    for (const [name, headers] of [
      ["no token", {}],
      ["expired", bearer({ exp: now - 600 })],
      ["wrong audience", bearer({ aud: "someone-else" })],
      ["garbage", { authorization: "Bearer garbage" }],
    ] as const) {
      const refused = await t.anon.live(undefined, headers);
      expect(refused.messages, name).toEqual([]);
      expect(refused.status, name).toBe(401);
    }
    // Roles decide nothing: a token without any gets a channel as well.
    const bare = await t.anon.live(undefined, bearer({ roles: undefined }));
    await bare.next((m) => m.type === "state");
    bare.close();
  });

  it("refuses roles that are no strings", async () => {
    const key = makeKey("RS256");
    const { jwks, t } = await oidcApp([key]);
    for (const roles of [["testers", 5], [{ admin: true }], 7, { admin: true }, [["nested"]]]) {
      const res = await me(t, signToken(key, tokenClaims(jwks, { roles })));
      expect(res.status, JSON.stringify(roles)).toBe(401);
    }
  });

  it("works without the discovery document when KIPSCOPE_OIDC_JWKS_URL is set", async () => {
    const key = makeKey("RS256");
    const jwks = await jwksServer([key]);
    servers.push(jwks);
    const identity = await oidcAdapter(jwks, { KIPSCOPE_OIDC_JWKS_URL: jwks.jwksUrl });
    const t = await multiApp({ identity });
    apps.push(t);
    expect((await me(t, signToken(key, tokenClaims(jwks)))).status).toBe(200);
    expect(jwks.fetches.discovery).toBe(0);
  });
});
