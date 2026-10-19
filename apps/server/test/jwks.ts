/**
 * Test keys, a JWKS server on a free loopback port and signed test tokens for the `oidc` identity
 * adapter (add-multiuser M15). Uses only `node:crypto`, so the tokens do not depend on the library
 * the adapter validates with.
 */
import {
  createHmac,
  createSign,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
} from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export type TestAlg = "RS256" | "ES256";

export interface TestKey {
  kid: string;
  alg: TestAlg;
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** The public key as a JWK with `kid`, `alg` and `use`. */
  jwk: Record<string, unknown>;
}

let counter = 0;

/** A fresh key pair. RSA keys are 2048 bits (the smallest size jose accepts for RS256). */
export function makeKey(
  alg: TestAlg,
  kid = `k${++counter}-${randomBytes(3).toString("hex")}`,
): TestKey {
  const pair =
    alg === "RS256"
      ? generateKeyPairSync("rsa", { modulusLength: 2048 })
      : generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid, alg, use: "sig" };
  return { kid, alg, privateKey: pair.privateKey, publicKey: pair.publicKey, jwk };
}

const b64 = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** Claims of a valid access token; `over` replaces or (with `undefined`) removes claims. */
export function claims(
  over: Record<string, unknown> = {},
  base: { iss: string; aud: string; now?: number },
): Record<string, unknown> {
  const now = base.now ?? Math.floor(Date.now() / 1000);
  const out: Record<string, unknown> = {
    iss: base.iss,
    aud: base.aud,
    sub: "alice",
    roles: ["testers"],
    iat: now - 5,
    exp: now + 300,
    ...over,
  };
  for (const [key, value] of Object.entries(out)) if (value === undefined) delete out[key];
  return out;
}

/** A compact JWS signed with `key`; `header` adds or replaces header fields. */
export function signToken(
  key: TestKey,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = {},
): string {
  const head = b64(JSON.stringify({ alg: key.alg, typ: "JWT", kid: key.kid, ...header }));
  const body = b64(JSON.stringify(payload));
  const signer = createSign("sha256");
  signer.update(`${head}.${body}`);
  const signature =
    key.alg === "RS256"
      ? signer.sign(key.privateKey)
      : signer.sign({ key: key.privateKey, dsaEncoding: "ieee-p1363" });
  return `${head}.${body}.${b64(signature)}`;
}

/** The algorithm-confusion forgery: HS256 signed with `secret` (e.g. the public key's text). */
export function signHs256(
  secret: string | Buffer,
  payload: Record<string, unknown>,
  header: Record<string, unknown> = {},
): string {
  const head = b64(JSON.stringify({ alg: "HS256", typ: "JWT", ...header }));
  const body = b64(JSON.stringify(payload));
  const mac = createHmac("sha256", secret).update(`${head}.${body}`).digest();
  return `${head}.${body}.${b64(mac)}`;
}

/** `alg: none`, with and without an empty signature part. */
export function unsignedToken(
  payload: Record<string, unknown>,
  header: Record<string, unknown> = {},
) {
  const head = b64(JSON.stringify({ alg: "none", typ: "JWT", ...header }));
  return `${head}.${b64(JSON.stringify(payload))}.`;
}

export interface JwksServer {
  /** `http://127.0.0.1:<port>`; also the issuer the server's discovery document names. */
  issuer: string;
  jwksUrl: string;
  /** Requests answered, by kind. */
  fetches: { jwks: number; discovery: number };
  /** Replaces the published keys (a rotation). */
  setKeys(keys: readonly TestKey[]): void;
  /** Makes the JWKS endpoint answer 500 until `up()`; `down` keeps the discovery document. */
  down(): void;
  up(): void;
  close(): Promise<void>;
}

/** Serves `/.well-known/openid-configuration` and `/jwks` on a free loopback port. */
export async function jwksServer(initial: readonly TestKey[]): Promise<JwksServer> {
  let keys = [...initial];
  let failing = false;
  const fetches = { jwks: 0, discovery: 0 };
  let issuer = "";
  const server: Server = createServer((req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    if (req.url === "/.well-known/openid-configuration") {
      fetches.discovery++;
      return send(200, { issuer, jwks_uri: `${issuer}/jwks` });
    }
    if (req.url === "/jwks") {
      fetches.jwks++;
      if (failing) return send(500, { error: "down" });
      return send(200, { keys: keys.map((k) => k.jwk) });
    }
    send(404, { error: "not found" });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${port}`;
  return {
    issuer,
    jwksUrl: `${issuer}/jwks`,
    fetches,
    setKeys(next) {
      keys = [...next];
    },
    down() {
      failing = true;
    },
    up() {
      failing = false;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}
