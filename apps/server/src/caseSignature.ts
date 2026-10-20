import { readFile } from "node:fs/promises";
import { inflateRawSync } from "node:zlib";
import { MAX_CASES_JSON } from "@kipscope/shared";
import {
  type CompactVerifyGetKey,
  compactVerify,
  createLocalJWKSet,
  createRemoteJWKSet,
  decodeProtectedHeader,
  errors,
  type JSONWebKeySet,
} from "jose";

/**
 * The finder's signature on a catalog (add-case-open K3, K4): a JWS in compact form whose payload
 * is deflate-raw of the claims' UTF-8 JSON. Checks are jose's; the JWS is never logged or echoed.
 */

/** Clock tolerance for `exp` and `iat`, in seconds (as add-multiuser's tokens). */
export const CASES_CLOCK_TOLERANCE_S = 30;
/** At most one JWKS fetch per this many ms for an unknown `kid`. */
export const FINDER_JWKS_REFETCH_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;
/** The protected header's `typ` of a catalog (K3). */
export const CASES_TYP = "kipscope-cases";

/** Why a signed catalog was refused (K4 step 3). */
export type SignatureReason =
  | "bad_signature"
  | "unknown_key"
  | "algorithm"
  | "expired"
  | "not_yet_valid"
  | "lifetime"
  | "issuer"
  | "audience"
  | "malformed";

/** A refused signature: 403 `invalid_signature` with `reason`. */
export class SignatureError extends Error {
  readonly reason: SignatureReason;

  constructor(reason: SignatureReason) {
    super(`the catalog's signature is not valid: ${reason.replaceAll("_", " ")}`);
    this.name = "SignatureError";
    this.reason = reason;
  }
}

/** The key set cannot be had and never loaded: 503 `finder_keys_unavailable`. */
export class FinderKeysUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinderKeysUnavailable";
  }
}

/** The inflated payload passed `MAX_CASES_JSON` bytes, or is no deflate-raw: 400 `invalid_catalog`. */
export class PayloadTooLarge extends Error {
  constructor() {
    super(`the catalog inflates to more than ${MAX_CASES_JSON} bytes`);
    this.name = "PayloadTooLarge";
  }
}

/** What the signature check needs of the finder config (FinderConfig, K4). */
export interface SignatureConfig {
  jwks: string;
  issuer: string;
  audience: string;
  algs: string[];
  /** Largest `exp − iat`, ns. */
  maxAgeNs: bigint;
}

const isUrl = (jwks: string) => /^https?:\/\//i.test(jwks);

/** One key lookup per JWKS source: a local set read once from the file, or a remote set. */
interface KeySource {
  getKey: CompactVerifyGetKey;
}

const sources = new Map<string, KeySource>();

/** A file's key set, read on first use; a read or parse failure is retried on the next use. */
function fileKeys(path: string): KeySource {
  let keys: ReturnType<typeof createLocalJWKSet> | undefined;
  let reading: Promise<ReturnType<typeof createLocalJWKSet>> | undefined;
  return {
    async getKey(header, token) {
      if (!keys) {
        reading ??= readFile(path, "utf8")
          .then((text) => createLocalJWKSet(JSON.parse(text) as JSONWebKeySet))
          .finally(() => {
            reading = undefined;
          });
        try {
          keys = await reading;
        } catch (error) {
          throw new FinderKeysUnavailable(
            `finder key set ${path} not readable: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      return keys(header, token);
    },
  };
}

/** A remote key set that refetches on an unknown `kid` at most every FINDER_JWKS_REFETCH_MS. */
function urlKeys(url: string): KeySource {
  const remote = createRemoteJWKSet(new URL(url), {
    cooldownDuration: FINDER_JWKS_REFETCH_MS,
    timeoutDuration: FETCH_TIMEOUT_MS,
  });
  return {
    async getKey(header, token) {
      try {
        return await remote(header, token);
      } catch (error) {
        if (remote.jwks() === undefined && !(error instanceof errors.JOSEAlgNotAllowed))
          throw new FinderKeysUnavailable(
            `finder key set ${url} not fetched: ${error instanceof Error ? error.message : String(error)}`,
          );
        throw error;
      }
    },
  };
}

function keySource(jwks: string): KeySource {
  let source = sources.get(jwks);
  if (!source) {
    source = isUrl(jwks) ? urlKeys(jwks) : fileKeys(jwks);
    sources.set(jwks, source);
  }
  return source;
}

/** The refusal reason of a jose error; others are passed on. */
function reasonOf(error: unknown): SignatureReason | undefined {
  if (error instanceof errors.JWSSignatureVerificationFailed) return "bad_signature";
  if (error instanceof errors.JWKSNoMatchingKey) return "unknown_key";
  if (error instanceof errors.JWKSMultipleMatchingKeys) return "unknown_key";
  if (error instanceof errors.JOSEAlgNotAllowed) return "algorithm";
  if (error instanceof errors.JOSENotSupported) return "algorithm";
  if (error instanceof errors.JWSInvalid || error instanceof errors.JWKInvalid) return "malformed";
  if (error instanceof errors.JOSEError) return "malformed";
  return undefined;
}

/** Inflates at most MAX_CASES_JSON bytes and parses JSON; a bad payload is `malformed`. */
function inflateJson(bytes: Uint8Array): unknown {
  let text: string;
  try {
    text = inflateRawSync(bytes, { maxOutputLength: MAX_CASES_JSON }).toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_BUFFER_TOO_LARGE")
      throw new PayloadTooLarge();
    throw new SignatureError("malformed");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new SignatureError("malformed");
  }
}

/**
 * The claims of an unverified JWS (identity `none` without keys, K4 step 3): the payload inflated
 * and parsed, nothing checked. Throws SignatureError `malformed` or PayloadTooLarge.
 */
export function unverifiedClaims(jws: string): Record<string, unknown> {
  const payload = jws.split(".")[1] ?? "";
  if (!/^[A-Za-z0-9_-]*$/.test(payload)) throw new SignatureError("malformed");
  const claims = inflateJson(Buffer.from(payload, "base64url"));
  if (typeof claims !== "object" || claims === null || Array.isArray(claims))
    throw new SignatureError("malformed");
  return claims as Record<string, unknown>;
}

/**
 * Verifies a signed catalog (K4 step 3): `compactVerify` with the finder's key set and allowed
 * algorithms, then inflate (≤ MAX_CASES_JSON), then `iss` exact, `aud` containing the audience,
 * numeric `iat` and `exp`, `exp > now − 30 s`, `iat < now + 30 s`, `exp − iat ≤ maxAge`. Returns
 * the claims. Throws SignatureError, FinderKeysUnavailable or PayloadTooLarge.
 */
export async function verifyCasesJws(
  jws: string,
  config: SignatureConfig,
  now: () => number = Date.now,
): Promise<Record<string, unknown>> {
  let header: ReturnType<typeof decodeProtectedHeader>;
  try {
    header = decodeProtectedHeader(jws);
  } catch {
    throw new SignatureError("malformed");
  }
  if (header.typ !== undefined && header.typ !== CASES_TYP) throw new SignatureError("malformed");
  let payload: Uint8Array;
  try {
    ({ payload } = await compactVerify(jws, keySource(config.jwks).getKey, {
      algorithms: config.algs,
    }));
  } catch (error) {
    if (error instanceof FinderKeysUnavailable) throw error;
    const reason = reasonOf(error);
    if (reason === undefined) throw error;
    throw new SignatureError(reason);
  }
  const claims = inflateJson(payload);
  if (typeof claims !== "object" || claims === null || Array.isArray(claims))
    throw new SignatureError("malformed");
  const { iss, aud, iat, exp } = claims as Record<string, unknown>;
  if (iss !== config.issuer) throw new SignatureError("issuer");
  const audiences = Array.isArray(aud) ? aud : [aud];
  if (!audiences.includes(config.audience)) throw new SignatureError("audience");
  if (typeof iat !== "number" || typeof exp !== "number" || !Number.isFinite(iat + exp))
    throw new SignatureError("malformed");
  const seconds = now() / 1000;
  if (exp <= seconds - CASES_CLOCK_TOLERANCE_S) throw new SignatureError("expired");
  if (iat >= seconds + CASES_CLOCK_TOLERANCE_S) throw new SignatureError("not_yet_valid");
  if ((exp - iat) * 1e9 > Number(config.maxAgeNs)) throw new SignatureError("lifetime");
  return claims as Record<string, unknown>;
}
