/**
 * The conformance suite of identity adapters (add-multiuser M1, "One conformance suite"). An
 * adapter author copies `oidc.conformance.test.ts` or `forward-header.conformance.test.ts` and
 * passes a `setup` that builds the adapter and the requests to check.
 */
import { describe, expect, it } from "vitest";
import type { IdentityAdapter, IdentityRequest } from "../../src/identity.ts";

export interface ConformanceSetup {
  adapter: IdentityAdapter;
  /** A request that must be accepted, and the exact identity it yields. */
  signedIn: { request: IdentityRequest; user: string; roles: string[] };
  /** A request without any credential. */
  missing: IdentityRequest;
  /** Requests with a forged or wrong credential; each must be refused. */
  forged: IdentityRequest[];
  /** Called after the suite. */
  close?(): Promise<void> | void;
}

/** A small seeded generator (mulberry32), so the random cases are the same on every run. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HEADER_NAMES = [
  "authorization",
  "x-forwarded-user",
  "x-forwarded-groups",
  "x-forwarded-for",
  "x-forwarded-access-token",
  "x-access-token",
  "x-test-user",
  "x-user",
  "cookie",
  "host",
  "x-remote-user",
  "user-agent",
];
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_.=+/, :;é\u0001";
/** A character no valid user ID or token holds, so a random value is never a credential. */
const TAINT = [" ", "/", "\u0001", "é", ":", "\\", "‮"];

function randomValue(next: () => number): string {
  const length = Math.floor(next() ** 3 * 300);
  let value = "";
  for (let i = 0; i < length; i++) value += ALPHABET[Math.floor(next() * ALPHABET.length)];
  const style = Math.floor(next() * 5);
  if (style === 1) value = `Bearer ${value}`;
  else if (style === 2) value = `bearer ${value}.${value}.${value}`;
  else if (style === 3) value = `${value}.${value}.${value}`;
  const at = Math.floor(next() * (value.length + 1));
  const taint = TAINT[Math.floor(next() * TAINT.length)] ?? " ";
  return `${value.slice(0, at)}${taint}${value.slice(at)}`;
}

/** A random header set: 0 to 6 headers of the usual names, values that are never a credential. */
function randomHeaders(next: () => number): Record<string, string | undefined> {
  const headers: Record<string, string | undefined> = {};
  const count = Math.floor(next() * 7);
  for (let i = 0; i < count; i++) {
    const name = HEADER_NAMES[Math.floor(next() * HEADER_NAMES.length)] ?? "authorization";
    headers[name] = next() < 0.1 ? undefined : next() < 0.1 ? "" : randomValue(next);
  }
  return headers;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}

const isUser = (result: unknown): result is { user: string } =>
  typeof result === "object" && result !== null && "user" in result;

/** Defines the suite for one adapter; `setup` runs once before the cases. */
export function identityConformance(
  name: string,
  setup: () => Promise<ConformanceSetup> | ConformanceSetup,
): void {
  describe(`identity conformance: ${name}`, () => {
    let state: ConformanceSetup | undefined;
    // Set up lazily by the first case, so a failing setup fails that case with its own message.
    const ready = async (): Promise<ConformanceSetup> => {
      state ??= await setup();
      return state;
    };

    it("has a kind, shown by /api/me and the start log", async () => {
      const { adapter } = await ready();
      expect(typeof adapter.kind).toBe("string");
      expect(adapter.kind.length).toBeGreaterThan(0);
      expect(typeof adapter.identify).toBe("function");
    });

    it("gives the signed-in request exactly its user and roles", async () => {
      const { adapter, signedIn } = await ready();
      expect(await adapter.identify(signedIn.request)).toEqual({
        user: signedIn.user,
        roles: signedIn.roles,
      });
    });

    it("refuses a request without a credential as unauthenticated", async () => {
      const { adapter, missing } = await ready();
      expect(await adapter.identify(missing)).toMatchObject({ refused: "unauthenticated" });
    });

    it("refuses every forged request and never yields a user", async () => {
      const { adapter, forged } = await ready();
      expect(forged.length).toBeGreaterThan(0);
      for (const request of forged) {
        const result = await adapter.identify(request);
        expect(isUser(result), JSON.stringify(request)).toBe(false);
        expect(["unauthenticated", "invalid_token"]).toContain(
          (result as { refused: string }).refused,
        );
      }
    });

    it("never yields a user and never throws for 1,000 random header sets", async () => {
      const { adapter, missing } = await ready();
      const next = seeded(20261019);
      for (let i = 0; i < 1000; i++) {
        const request: IdentityRequest = { ...missing, headers: randomHeaders(next) };
        let result: unknown;
        try {
          result = await adapter.identify(request);
        } catch (error) {
          throw new Error(
            `identify threw for ${JSON.stringify(request.headers)}: ${String(error)}`,
          );
        }
        expect(isUser(result), JSON.stringify(request.headers)).toBe(false);
        expect(["unauthenticated", "invalid_token"]).toContain(
          (result as { refused?: string }).refused,
        );
      }
    });

    it("leaves the request object unchanged", async () => {
      const { adapter, signedIn, missing, forged } = await ready();
      for (const request of [signedIn.request, missing, ...forged]) {
        const before = structuredClone(request);
        // Frozen: an adapter that writes to its input throws.
        await adapter.identify(deepFreeze(structuredClone(request)));
        await adapter.identify(request);
        expect(request).toEqual(before);
      }
    });

    it("closes", async () => {
      const done = await ready();
      await done.adapter.close?.();
      await done.close?.();
    });
  });
}
