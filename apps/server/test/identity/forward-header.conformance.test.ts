import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { type IdentityRequest, loadIdentity } from "../../src/identity.ts";
import { identityConformance } from "./conformance.ts";

const EXAMPLE = resolve(import.meta.dirname, "../../examples/forward-header.mjs");
const env = { KIPSCOPE_TRUSTED_PROXIES: "127.0.0.1,10.0.0.0/8" };
const log = { info() {}, warn() {} };
const load = async () => {
  const adapter = await loadIdentity({ kind: "module", path: EXAMPLE }, { env, log });
  if (!adapter) throw new Error("adapter expected");
  return adapter;
};

const from = (peer: string, headers: Record<string, string>): IdentityRequest => ({
  headers,
  peer,
  method: "GET",
  path: "/api/me",
});
const alice = { "x-forwarded-user": "alice", "x-forwarded-groups": "testers, viewers" };

identityConformance("forward-header example module", async () => ({
  adapter: await load(),
  signedIn: { request: from("127.0.0.1", alice), user: "alice", roles: ["testers", "viewers"] },
  missing: from("127.0.0.1", {}),
  forged: [
    // The right headers from a peer that is no proxy, with and without a forged X-Forwarded-For.
    from("192.168.1.5", alice),
    from("192.168.1.5", { ...alice, "x-forwarded-for": "127.0.0.1" }),
    from("203.0.113.9", alice),
    from("", alice),
    from("not-an-ip", alice),
    // A trusted peer, but no or a malformed user.
    from("127.0.0.1", { "x-forwarded-user": "" }),
    from("127.0.0.1", { "x-forwarded-user": "../x" }),
    from("127.0.0.1", { "x-forwarded-user": "a b" }),
    from("127.0.0.1", { "x-forwarded-groups": "testers" }),
  ],
}));

describe("forward-header example module", () => {
  it("trusts the headers from proxies only", async () => {
    const adapter = await load();
    const identify = (peer: string, extra: Record<string, string> = {}) =>
      adapter.identify(from(peer, { ...alice, ...extra }));
    const expected = { user: "alice", roles: ["testers", "viewers"] };
    expect(await identify("127.0.0.1")).toEqual(expected);
    expect(await identify("::ffff:127.0.0.1")).toEqual(expected);
    expect(await identify("10.1.2.3")).toEqual(expected);
    expect(await identify("192.168.1.5")).toMatchObject({ refused: "unauthenticated" });
    expect(await identify("192.168.1.5", { "x-forwarded-for": "127.0.0.1" })).toMatchObject({
      refused: "unauthenticated",
    });
  });

  it("defaults to the loopback proxies and rejects a bad proxy list at start", async () => {
    const defaults = await loadIdentity({ kind: "module", path: EXAMPLE }, { env: {}, log });
    expect(await defaults?.identify(from("127.0.0.1", alice))).toMatchObject({ user: "alice" });
    expect(await defaults?.identify(from("::1", alice))).toMatchObject({ user: "alice" });
    expect(await defaults?.identify(from("10.1.2.3", alice))).toMatchObject({
      refused: "unauthenticated",
    });
    await expect(
      loadIdentity(
        { kind: "module", path: EXAMPLE },
        { env: { KIPSCOPE_TRUSTED_PROXIES: "not-an-ip" }, log },
      ),
    ).rejects.toThrow(/KIPSCOPE_TRUSTED_PROXIES/);
  });

  it("splits groups on commas, trims them and drops blanks and repeats", async () => {
    const adapter = await load();
    const result = await adapter.identify(
      from("127.0.0.1", { "x-forwarded-user": "bob", "x-forwarded-groups": " a ,, b,a, " }),
    );
    expect(result).toEqual({ user: "bob", roles: ["a", "b"] });
    const none = await adapter.identify(from("127.0.0.1", { "x-forwarded-user": "bob" }));
    expect(none).toEqual({ user: "bob", roles: [] });
  });
});
