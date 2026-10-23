import { USER_ID } from "@kipscope/shared";
import {
  createLocalJWKSet,
  decodeProtectedHeader,
  errors,
  type JSONWebKeySet,
  type JWTPayload,
  type JWTVerifyGetKey,
  jwtVerify,
} from "jose";
import type { OidcConfig } from "../config.ts";
import type { IdentifyResult, IdentityAdapter, IdentityLog, IdentityRequest } from "../identity.ts";

/**
 * The `oidc` built-in (add-multiuser M15): KIPscope as an OIDC resource server. It validates a JWT
 * access token (any OIDC IdP, e.g. Entra ID, Keycloak, Okta, PingFederate) and takes user and roles from its claims.
 * Signature checks are jose's. The token is never logged or echoed.
 */

/** Largest token accepted (design "Numbers"). */
export const MAX_TOKEN_BYTES = 16_384;
/** Clock tolerance for `exp` and `nbf`, in seconds. */
export const CLOCK_TOLERANCE_S = 30;
/** At most one JWKS fetch per this many ms for an unknown `kid`, and between failed loads. */
export const JWKS_REFETCH_MS = 30_000;
const FETCH_TIMEOUT_MS = 5_000;
const MAX_DOCUMENT_BYTES = 1_048_576;
const BEARER = /^bearer[ \t]+(\S+)[ \t]*$/i;

/** The key set cannot be had; the guard answers 503 `identity_unavailable`. */
class KeySetUnavailable extends Error {}

export interface OidcOptions {
  log: IdentityLog;
  fetch?: typeof fetch;
  now?: () => number;
}

/** An `https` URL, or `http` with a loopback host (tests). */
function trustedUrl(raw: unknown, what: string): string {
  if (typeof raw !== "string") throw new Error(`${what} missing`);
  const url = new URL(raw);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new Error(`${what} is not https: ${raw}`);
  return url.href;
}

/** A claim by name or dotted path (`realm_access.roles`). */
function claimAt(payload: JWTPayload, path: string): unknown {
  let value: unknown = payload;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    if (!Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** An array of strings, or one space- or comma-separated string; missing: none; else undefined. */
function rolesOf(value: unknown): string[] | undefined {
  if (value === undefined) return [];
  if (typeof value === "string") return [...new Set(value.split(/[\s,]+/).filter(Boolean))];
  if (Array.isArray(value) && value.every((r) => typeof r === "string"))
    return [...new Set(value as string[])];
  return undefined;
}

/** A refusal's reason for the debug log, from jose's error. */
function reasonOf(error: unknown): string {
  if (error instanceof errors.JWTExpired) return "expired";
  if (error instanceof errors.JWTClaimValidationFailed) {
    if (error.claim === "aud") return "wrong_audience";
    if (error.claim === "iss") return "wrong_issuer";
    if (error.claim === "nbf") return "not_yet_valid";
    return `bad_claim_${error.claim}`;
  }
  if (error instanceof errors.JWSSignatureVerificationFailed) return "bad_signature";
  if (error instanceof errors.JWKSNoMatchingKey) return "unknown_kid";
  if (error instanceof errors.JWKSMultipleMatchingKeys) return "ambiguous_kid";
  if (error instanceof errors.JOSEAlgNotAllowed) return "bad_alg";
  return "malformed";
}

/** The `oidc` adapter; its first key set load runs here, and a failure only delays requests (503). */
export async function oidcAdapter(
  config: OidcConfig,
  options: OidcOptions,
): Promise<IdentityAdapter> {
  const { log } = options;
  const fetchFn = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const algorithms: string[] = [...config.algs];

  let jwksUrl: string | undefined = config.jwksUrl;
  let keys: ReturnType<typeof createLocalJWKSet> | undefined;
  let loadedOnce = false;
  let lastLoadAttempt = Number.NEGATIVE_INFINITY;
  let lastKidRefetch = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | undefined;

  async function getJson(url: string): Promise<unknown> {
    const response = await fetchFn(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { accept: "application/json" },
      redirect: "error",
    });
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_DOCUMENT_BYTES) throw new Error(`${url} answered too much`);
    return JSON.parse(text);
  }

  /** Discovery (once) and the key set; replaces the keys only on success. */
  async function load(): Promise<void> {
    if (jwksUrl === undefined) {
      const base = config.issuer.replace(/\/+$/, "");
      const discovery = (await getJson(`${base}/.well-known/openid-configuration`)) as {
        jwks_uri?: unknown;
      } | null;
      jwksUrl = trustedUrl(discovery?.jwks_uri, "jwks_uri of the discovery document");
    }
    const set = (await getJson(jwksUrl)) as JSONWebKeySet;
    keys = createLocalJWKSet(set); // throws JWKSInvalid for a malformed set
    loadedOnce = true;
  }

  function reload(): Promise<void> {
    lastLoadAttempt = now();
    inFlight ??= load().finally(() => {
      inFlight = undefined;
    });
    return inFlight;
  }

  async function initialLoad(): Promise<void> {
    try {
      await reload();
    } catch (error) {
      log.warn(
        `oidc: key set of ${config.issuer} not loaded (${error instanceof Error ? error.message : String(error)}); requests answer 503 until it loads`,
      );
    }
  }

  await initialLoad();

  /** Keys, loading them first if they never loaded (at most once per JWKS_REFETCH_MS). */
  async function ensureKeys(): Promise<void> {
    if (loadedOnce) return;
    if (inFlight) await inFlight.catch(() => undefined);
    else if (now() - lastLoadAttempt >= JWKS_REFETCH_MS) await initialLoad();
    if (!loadedOnce) throw new KeySetUnavailable(`oidc: key set of ${config.issuer} unavailable`);
  }

  /** Looks the key up; an unknown `kid` refetches the set at most once per JWKS_REFETCH_MS. */
  const getKey: JWTVerifyGetKey = async (header, token) => {
    const current = keys;
    if (current === undefined) throw new KeySetUnavailable("no key set");
    try {
      return await current(header, token);
    } catch (error) {
      if (!(error instanceof errors.JWKSNoMatchingKey)) throw error;
      if (now() - lastKidRefetch < JWKS_REFETCH_MS) throw error;
      lastKidRefetch = now();
      try {
        await reload();
      } catch (reloadError) {
        log.warn(
          `oidc: key set refetch failed (${reloadError instanceof Error ? reloadError.message : String(reloadError)})`,
        );
        throw error;
      }
      const fresh = keys;
      if (fresh === undefined) throw error;
      return fresh(header, token);
    }
  };

  function refuse(reason: string, kid?: unknown): IdentifyResult {
    const kidText = typeof kid === "string" ? ` kid ${JSON.stringify(kid.slice(0, 64))}` : "";
    log.debug?.(`oidc: token refused: ${reason}${kidText}`);
    return { refused: "invalid_token", reason };
  }

  async function identify(request: IdentityRequest): Promise<IdentifyResult> {
    const raw = request.headers[config.header];
    if (raw === undefined || raw.trim() === "") return { refused: "unauthenticated" };
    if (raw.length > MAX_TOKEN_BYTES + 64) return refuse("too_large");
    let token = raw.trim();
    if (config.header === "authorization") {
      const m = BEARER.exec(token);
      if (m === null) return refuse("not_bearer");
      token = m[1] ?? "";
    }
    if (token.length > MAX_TOKEN_BYTES) return refuse("too_large");

    let kid: unknown;
    try {
      const header = decodeProtectedHeader(token);
      kid = header.kid;
      if (typeof header.alg !== "string" || !algorithms.includes(header.alg))
        return refuse("bad_alg", kid);
    } catch {
      return refuse("malformed");
    }

    await ensureKeys();
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, getKey, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms,
        clockTolerance: CLOCK_TOLERANCE_S,
        requiredClaims: ["exp"],
        currentDate: new Date(now()),
      }));
    } catch (error) {
      if (error instanceof KeySetUnavailable) throw error;
      return refuse(reasonOf(error), kid);
    }

    const user = claimAt(payload, config.userClaim);
    if (typeof user !== "string" || !USER_ID.test(user)) return refuse("bad_user", kid);
    const roles = rolesOf(claimAt(payload, config.rolesClaim));
    if (roles === undefined) return refuse("bad_roles", kid);
    return { user, roles };
  }

  return { kind: "oidc", identify };
}
