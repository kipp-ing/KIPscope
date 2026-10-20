/**
 * Shared bits of the add-case-open server tests: catalog C4 of the design's "Test fixtures",
 * finder keys (Ed25519 and P-256), signed catalogs (JWS with a deflate-raw payload, design K3) and
 * a finder configuration. Signing uses only `node:crypto` and `node:zlib`, so the tokens do not
 * depend on the library the server verifies with.
 */
import {
  createHmac,
  createSign,
  sign as cryptoSign,
  type KeyObject,
  randomBytes,
} from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import type { FinderConfig } from "../src/case.ts";
import type { DataSource, Scope, SourceAdapter } from "../src/datasource.ts";
import { currentPriority, type QueryClass } from "../src/priority.ts";
import { makeKey, type TestKey } from "./jwks.ts";
import type { MemorySignal } from "./scopeApp.ts";

export const ISS = "https://finder.example";
export const AUD = "https://kipscope.example";

/** 2026-10-01T00:00:00Z = 1790812800 s, so 01:00:00 = 1790816400 s (by hand). */
export const NS = 1_000_000_000n;
export const BASE = 1790812800n;
/** Decimal ns of 2026-10-01 + h:m:s. */
export const at = (h: number, m: number, s = 0): string =>
  String((BASE + BigInt(h * 3600 + m * 60 + s)) * NS);

/** Catalog C4 as the finder sends it (ISO times). Not in time order, two vehicles (D-085). */
export function c4(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kipscope: "cases",
    version: 1,
    cases: [
      {
        id: "testcar|driving|2026-10-01T01:00:00Z",
        object: "testcar",
        kind: "driving",
        from: "2026-10-01T01:00:00Z",
        to: "2026-10-01T01:10:00Z",
        meta: { distance_km: 6.2 },
      },
      {
        id: "othercar|driving|2026-10-01T00:00:00Z",
        object: "othercar",
        kind: "driving",
        from: "2026-10-01T00:00:00Z",
        to: "2026-10-01T00:00:01Z",
      },
      {
        id: "testcar|charging|2026-10-01T04:50:00Z",
        object: "testcar",
        kind: "charging",
        from: "2026-10-01T04:50:00Z",
        to: "2026-10-01T05:10:00Z",
        anchor: "2026-10-01T04:55:00Z",
      },
      {
        id: "testcar|idle|2026-10-01T04:58:00Z",
        object: "testcar",
        kind: "idle",
        from: "2026-10-01T04:58:00Z",
        to: "2026-10-01T05:02:00Z",
      },
    ],
    ...over,
  };
}

/** The ids of C4, in the order sent. */
export const C4_IDS = (c4().cases as { id: string }[]).map((c) => c.id);

/** The DTC the 9 events at 05:00:00 of the test DB include (design T of add-events). */
export const DTC_MATCH = { kind: "dtc", source: "BMS", name: "P0CA700" } as const;

export const ed25519 = (): TestKey => makeKey("EdDSA");
export const p256 = (): TestKey => makeKey("ES256");

/** A FinderConfig as `loadConfig` would give it, with test values. */
export function finderConfig(over: Partial<FinderConfig> = {}): FinderConfig {
  return {
    issuer: ISS,
    audience: AUD,
    algs: ["EdDSA", "ES256"],
    userClaim: "sub",
    maxAgeNs: 3_600n * NS,
    origins: [],
    dataRefTemplate: "{object}",
    padNs: 60n * NS,
    ...over,
  };
}

/** Claims of a valid signed catalog; `over` replaces or (with `undefined`) removes claims. */
export function caseClaims(
  doc: Record<string, unknown> = c4(),
  over: Record<string, unknown> = {},
  now = Math.floor(Date.now() / 1000),
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    iss: ISS,
    aud: AUD,
    sub: "alice",
    iat: now,
    exp: now + 600,
    cases: doc,
    ...over,
  };
  for (const [key, value] of Object.entries(out)) if (value === undefined) delete out[key];
  return out;
}

const b64 = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** The signing input: header and payload (deflate-raw of the JSON, or the given bytes). */
function signingInput(
  header: Record<string, unknown>,
  payload: Record<string, unknown> | Buffer,
): { head: string; body: string } {
  const bytes = Buffer.isBuffer(payload)
    ? payload
    : deflateRawSync(Buffer.from(JSON.stringify(payload)));
  return { head: b64(JSON.stringify(header)), body: b64(bytes) };
}

/** A signed catalog (K3): protected header `{alg, kid, typ: "kipscope-cases"}`, deflate-raw payload. */
export function signCases(
  key: TestKey,
  payload: Record<string, unknown> | Buffer = caseClaims(),
  header: Record<string, unknown> = {},
): string {
  const { head, body } = signingInput(
    { alg: key.alg, kid: key.kid, typ: "kipscope-cases", ...header },
    payload,
  );
  const input = Buffer.from(`${head}.${body}`);
  let signature: Buffer;
  if (key.alg === "EdDSA") signature = cryptoSign(null, input, key.privateKey);
  else if (key.alg === "ES256")
    signature = cryptoSign("sha256", input, { key: key.privateKey, dsaEncoding: "ieee-p1363" });
  else signature = createSign("sha256").update(input).sign(key.privateKey);
  return `${head}.${body}.${b64(signature)}`;
}

/** The algorithm-confusion forgery: HS256 keyed by the public key's text. */
export function signHs256Cases(
  secret: string | Buffer,
  payload: Record<string, unknown> = caseClaims(),
  kid?: string,
): string {
  const { head, body } = signingInput(
    { alg: "HS256", typ: "kipscope-cases", ...(kid ? { kid } : {}) },
    payload,
  );
  return `${head}.${body}.${b64(createHmac("sha256", secret).update(`${head}.${body}`).digest())}`;
}

/** Changes one character in the middle of the payload part; the token stays three base64url parts. */
export function tamperPayload(token: string): string {
  const [head, body, signature] = token.split(".") as [string, string, string];
  const i = Math.floor(body.length / 2);
  const swapped = body[i] === "A" ? "B" : "A";
  return `${head}.${body.slice(0, i)}${swapped}${body.slice(i + 1)}.${signature}`;
}

/** A JWKS file of the keys' public JWKs in a fresh temp dir; `cleanup` removes it. */
export function jwksFile(keys: readonly TestKey[]): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), `kipscope-finder-${randomBytes(3).toString("hex")}-`));
  const path = join(dir, "jwks.json");
  writeFileSync(path, JSON.stringify({ keys: keys.map((k) => k.jwk) }));
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export type { KeyObject, TestKey };

/** One source call with the query class it ran in. */
export interface ClassCall {
  method: string;
  args: unknown[];
  cls: QueryClass;
}

/** The adapter wrapped so that every call is logged with the class of the work that made it. */
export function classRecording<T extends SourceAdapter | DataSource>(
  adapter: T,
): { adapter: T; log: ClassCall[] } {
  const log: ClassCall[] = [];
  const wrapped = new Proxy(adapter, {
    get(target, key, receiver) {
      const member = Reflect.get(target, key, receiver);
      if (typeof member !== "function") return member;
      return (...args: unknown[]) => {
        log.push({ method: String(key), args, cls: currentPriority().cls });
        return member.apply(target, args);
      };
    },
    has: (target, key) => Reflect.has(target, key),
  });
  return { adapter: wrapped, log };
}

/** Where each scoped method takes its `scope` argument (add-scope design Z1). */
export const SCOPE_AT: Record<string, number> = {
  listSignals: 0,
  extent: 1,
  refExtent: 1,
  refCount: 1,
  before: 2,
  after: 2,
  events: 2,
  refBuckets: 3,
  loggerGaps: 3,
  firstTimes: 3,
  stateChanges: 3,
};

/** The scope argument of a recorded call, if the method takes one and it was given. */
export const scopeOfCall = (call: { method: string; args: unknown[] }): Scope | undefined => {
  const at_ = SCOPE_AT[call.method];
  return at_ === undefined ? undefined : (call.args[at_] as Scope | undefined);
};

export const sameScope = (a: Scope | undefined, b: Scope) =>
  a !== undefined && a.dataRef === b.dataRef && a.from === b.from && a.to === b.to;

/** `{dataRef, from, to}` of a scope from decimal-ns texts. */
export const scopeNs = (dataRef: string, from: string, to: string): Scope => ({
  dataRef,
  from: BigInt(from),
  to: BigInt(to),
});

/**
 * Signals of the case tests in memory: testcar holds `Fast_100h.SIG_A` and `Irr_200h.JITTER` every
 * 30 s from 00:00 to 10:00, othercar holds only `Fast_100h.SIG_A` every 15 s from 23:58 the day
 * before to 00:02 (so every catalog entry's scope has rows).
 */
export function caseSignals(): MemorySignal[] {
  const series = (fromSec: bigint, toSec: bigint, stepSec: bigint, offset: number) => {
    const rows: [bigint, number][] = [];
    for (let t = fromSec; t <= toSec; t += stepSec)
      rows.push([t * NS, offset + Number((t - fromSec) / stepSec)]);
    return rows;
  };
  return [
    { dataRef: "testcar", name: "Fast_100h.SIG_A", rows: series(BASE, BASE + 36_000n, 30n, 0) },
    { dataRef: "testcar", name: "Irr_200h.JITTER", rows: series(BASE, BASE + 36_000n, 30n, 1000) },
    {
      dataRef: "othercar",
      name: "Fast_100h.SIG_A",
      rows: series(BASE - 120n, BASE + 120n, 15n, 5000),
    },
  ];
}
