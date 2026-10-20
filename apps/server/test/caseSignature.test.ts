import { deflateRawSync } from "node:zlib";
import { CasesDocument, encodeCasesLink } from "@kipscope/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type FinderConfig, readCases } from "../src/case.ts";
import {
  AUD,
  C4_IDS,
  c4,
  caseClaims,
  ed25519,
  finderConfig,
  ISS,
  jwksFile,
  p256,
  signCases,
  signHs256Cases,
  tamperPayload,
} from "./caseKit.ts";
import { type JwksServer, jwksServer } from "./jwks.ts";

const good = ed25519();
const goodEc = p256();
const stranger = ed25519();
const keys = jwksFile([good, goodEc]);
afterAll(() => keys.cleanup());

const config = (over: Partial<FinderConfig> = {}): FinderConfig =>
  finderConfig({ jwks: keys.path, ...over });

/** Reads as a signed-in user (identity other than none). */
const read = (
  token: string,
  over: Partial<FinderConfig> = {},
  user: string | undefined = "alice",
) => readCases(token, config(over), "other", user);

/** The refusal of a call: code, HTTP status and reason. */
async function refused(call: Promise<unknown>) {
  const error = await call.then(
    () => {
      throw new Error("expected the catalog to be refused");
    },
    (e: unknown) => e as { code: string; status: number; reason?: string; message: string },
  );
  return { code: error.code, status: error.status, reason: error.reason, message: error.message };
}

const now = () => Math.floor(Date.now() / 1000);

describe("readCases: signed catalogs", () => {
  it("verifies a signed catalog", async () => {
    const withEd = await read(signCases(good));
    const withEc = await read(signCases(goodEc));
    for (const read_ of [withEd, withEc]) {
      expect(read_.catalog.entries.map((e) => e.id)).toEqual(C4_IDS);
      expect(read_.catalog.entries.map((e) => e.dataRef)).toEqual([
        "testcar",
        "othercar",
        "testcar",
        "testcar",
      ]);
      expect(read_.catalog.catalogId).toMatch(/^[a-z0-9]{10}$/);
      expect(read_.current).toBe(0);
      expect(read_.pad).toBe(60_000_000_000n);
      expect(read_.align).toEqual({ mode: "start" });
      expect(read_.catalog.entries[0]?.from).toBe("1790816400000000000");
    }
    expect(withEc.catalog.entries).toEqual(withEd.catalog.entries);
    expect(withEd.catalog.catalogId).not.toBe(withEc.catalog.catalogId);
  });

  it("refuses forged, expired and foreign catalogs", async () => {
    const t = now();
    const cases: [string, string, string][] = [
      ["a changed payload byte", tamperPayload(signCases(good)), "bad_signature"],
      ["an unknown key", signCases(stranger), "unknown_key"],
      [
        "HS256 keyed by the public key",
        signHs256Cases(JSON.stringify(good.jwk), caseClaims(), good.kid),
        "algorithm",
      ],
      [
        "an expired token",
        signCases(good, caseClaims(c4(), { iat: t - 720, exp: t - 120 })),
        "expired",
      ],
      [
        "a lifetime of 2 h",
        signCases(good, caseClaims(c4(), { iat: t, exp: t + 7_200 })),
        "lifetime",
      ],
      [
        "another issuer",
        signCases(good, caseClaims(c4(), { iss: "https://evil.example" })),
        "issuer",
      ],
      [
        "another audience",
        signCases(good, caseClaims(c4(), { aud: "https://other.example" })),
        "audience",
      ],
    ];
    for (const [what, token, reason] of cases) {
      expect(await refused(read(token)), what).toMatchObject({
        code: "invalid_signature",
        status: 403,
        reason,
      });
    }
  });

  it("refuses an algorithm outside the allowed list", async () => {
    expect(await refused(read(signCases(goodEc), { algs: ["EdDSA"] }))).toMatchObject({
      code: "invalid_signature",
      reason: "algorithm",
    });
  });

  it("refuses an alg none token", async () => {
    const head = Buffer.from(JSON.stringify({ alg: "none", typ: "kipscope-cases" })).toString(
      "base64url",
    );
    const body = deflateRawSync(Buffer.from(JSON.stringify(caseClaims()))).toString("base64url");
    expect(await refused(read(`${head}.${body}.`))).toMatchObject({ code: "invalid_signature" });
  });

  it("accepts an audience list and refuses a token that lacks times", async () => {
    const ok = await read(signCases(good, caseClaims(c4(), { aud: ["https://x.example", AUD] })));
    expect(ok.catalog.entries).toHaveLength(4);
    expect(
      await refused(read(signCases(good, caseClaims(c4(), { exp: undefined })))),
    ).toMatchObject({
      code: "invalid_signature",
      reason: "malformed",
    });
    expect(await refused(read(signCases(good, caseClaims(c4(), { iat: "now" }))))).toMatchObject({
      code: "invalid_signature",
      reason: "malformed",
    });
  });

  it("refuses a token issued in the future and tolerates 30 s of clock skew", async () => {
    const t = now();
    expect(
      await refused(read(signCases(good, caseClaims(c4(), { iat: t + 300, exp: t + 900 })))),
    ).toMatchObject({ code: "invalid_signature", reason: "not_yet_valid" });
    const skewed = await read(signCases(good, caseClaims(c4(), { iat: t + 10, exp: t + 610 })));
    expect(skewed.catalog.entries).toHaveLength(4);
    const justExpired = await read(
      signCases(good, caseClaims(c4(), { iat: t - 400, exp: t - 10 })),
    );
    expect(justExpired.catalog.entries).toHaveLength(4);
  });

  it("reads the lifetime limit from the configuration", async () => {
    const t = now();
    const token = signCases(good, caseClaims(c4(), { iat: t, exp: t + 7_200 }));
    const lenient = await read(token, { maxAgeNs: 86_400n * 1_000_000_000n });
    expect(lenient.catalog.entries).toHaveLength(4);
  });

  it("refuses a payload that is not deflate-raw JSON", async () => {
    const token = signCases(good, Buffer.from("this is not compressed json"));
    expect(await refused(read(token))).toMatchObject({
      code: "invalid_signature",
      reason: "malformed",
    });
  });

  it("refuses a catalog that inflates past the limit", async () => {
    // 10 MB of spaces inside a valid signature: a bomb of a few kB.
    const bomb = deflateRawSync(Buffer.alloc(10 * 1024 * 1024, 0x20));
    expect(bomb.length).toBeLessThan(100_000);
    expect(await refused(read(signCases(good, bomb)))).toMatchObject({
      code: "invalid_catalog",
      status: 400,
    });
  });

  it("names the first bad path of a signed document", async () => {
    const bad = c4({ cases: [] });
    const error = await refused(read(signCases(good, caseClaims(bad))));
    expect(error).toMatchObject({ code: "invalid_catalog", status: 400 });
    expect(error.message).toMatch(/cases/);
  });

  it("reads the user from the configured claim", async () => {
    const token = signCases(good, caseClaims(c4(), { sub: "other", email: "alice" }));
    expect(await refused(read(token))).toMatchObject({ code: "wrong_user", status: 403 });
    const ok = await read(token, { userClaim: "email" });
    expect(ok.catalog.entries).toHaveLength(4);
  });
});

describe("readCases: user and form", () => {
  it("binds a signed catalog to its user", async () => {
    const forAlice = signCases(good, caseClaims(c4(), { sub: "alice" }));
    expect((await read(forAlice, {}, "alice")).catalog.entries).toHaveLength(4);
    expect(await refused(read(forAlice, {}, "bob"))).toMatchObject({
      code: "wrong_user",
      status: 403,
    });
  });

  it("skips the user check in none mode", async () => {
    const token = signCases(good, caseClaims(c4(), { sub: "anyone" }));
    const result = await readCases(token, config(), "none", undefined);
    expect(result.catalog.entries).toHaveLength(4);
  });

  it("refuses unsigned catalogs with a sign-in", async () => {
    const code = await encodeCasesLink(CasesDocument.parse(c4()));
    for (const input of [c4(), code]) {
      expect(await refused(readCases(input, config(), "other", "alice"))).toMatchObject({
        code: "signature_required",
        status: 403,
      });
    }
  });

  it("answers finder_not_configured without keys", async () => {
    const bare = finderConfig();
    expect(await refused(readCases(signCases(good), bare, "other", "alice"))).toMatchObject({
      code: "finder_not_configured",
      status: 503,
    });
  });

  it("reads the forms in none mode: document, link code and unverified JWS", async () => {
    const bare = finderConfig();
    const fromDoc = await readCases(c4(), bare, "none", undefined);
    const fromCode = await readCases(
      await encodeCasesLink(CasesDocument.parse(c4())),
      bare,
      "none",
      undefined,
    );
    const fromJws = await readCases(signCases(good), bare, "none", undefined);
    for (const result of [fromDoc, fromCode, fromJws]) {
      expect(result.catalog.entries.map((e) => e.id)).toEqual(C4_IDS);
    }
  });

  it("verifies a signed catalog in none mode when keys are configured", async () => {
    const forged = tamperPayload(signCases(good));
    expect(await refused(readCases(forged, config(), "none", undefined))).toMatchObject({
      code: "invalid_signature",
      reason: "bad_signature",
    });
  });

  it("refuses a text over the size limit", async () => {
    const big = "A".repeat(4_000_001);
    expect(await refused(readCases(big, finderConfig(), "none", undefined))).toMatchObject({
      code: "invalid_catalog",
      status: 400,
    });
  });

  it("refuses an unsigned code that inflates past the limit", async () => {
    const bomb = deflateRawSync(Buffer.alloc(10 * 1024 * 1024, 0x20)).toString("base64url");
    expect(await refused(readCases(bomb, finderConfig(), "none", undefined))).toMatchObject({
      code: "invalid_catalog",
      status: 400,
    });
  });
});

describe("readCases: mapping and back link", () => {
  it("maps objects by the template and takes the pad from the configuration", async () => {
    const result = await readCases(
      c4(),
      finderConfig({ dataRefTemplate: "fleet-{object}", padNs: 30_000_000_000n }),
      "none",
      undefined,
    );
    expect(result.catalog.entries.map((e) => e.dataRef)).toEqual([
      "fleet-testcar",
      "fleet-othercar",
      "fleet-testcar",
      "fleet-testcar",
    ]);
    expect(result.pad).toBe(30_000_000_000n);
    const own = await readCases(c4({ pad: "2min" }), finderConfig(), "none", undefined);
    expect(own.pad).toBe(120_000_000_000n);
  });

  it("keeps only a back link to a listed finder", async () => {
    const listed = { tool: "search tool", url: "https://finder.example/#f=1" };
    const withLink = (url: string) =>
      readCases(
        c4({ origin: { tool: "search tool", url } }),
        finderConfig({ origins: ["https://finder.example"] }),
        "none",
        undefined,
      );
    const kept = await withLink(listed.url);
    expect(kept.catalog.origin).toEqual(listed);
    expect(kept.warnings).toEqual([]);
    const dropped = await withLink("https://evil.example/");
    expect(dropped.catalog.origin?.url).toBeUndefined();
    expect(dropped.catalog.origin?.tool).toBe("search tool");
    expect(dropped.warnings.join(" ")).toMatch(/origin\.url|evil\.example/);
  });

  it("passes current, align and view on", async () => {
    const result = await readCases(
      c4({ current: 2, align: { mode: "anchor" }, view: "my-view" }),
      finderConfig(),
      "none",
      undefined,
    );
    expect(result).toMatchObject({ current: 2, align: { mode: "anchor" }, view: "my-view" });
  });
});

describe("readCases: remote keys", () => {
  let jwks: JwksServer;
  beforeAll(async () => {
    jwks = await jwksServer([good]);
  });
  afterAll(() => jwks.close());

  it("verifies against a JWKS URL", async () => {
    const result = await readCases(
      signCases(good),
      finderConfig({ jwks: jwks.jwksUrl }),
      "other",
      "alice",
    );
    expect(result.catalog.entries).toHaveLength(4);
    expect(jwks.fetches.jwks).toBeGreaterThanOrEqual(1);
  });

  it("answers finder_keys_unavailable when the keys never loaded", async () => {
    const down = await jwksServer([good]);
    down.down();
    try {
      expect(
        await refused(
          readCases(signCases(good), finderConfig({ jwks: down.jwksUrl }), "other", "alice"),
        ),
      ).toMatchObject({ code: "finder_keys_unavailable", status: 503 });
    } finally {
      await down.close();
    }
  });

  it("issuer and audience come from the configuration", async () => {
    expect(ISS).toBe("https://finder.example");
    const other = finderConfig({ jwks: keys.path, issuer: "https://other.example" });
    expect(await refused(readCases(signCases(good), other, "other", "alice"))).toMatchObject({
      reason: "issuer",
    });
  });
});
