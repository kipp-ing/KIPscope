import { randomInt } from "node:crypto";
import {
  type CaseAlign,
  type CaseCatalog,
  decodeCasesLink,
  isSignedCases,
  MAX_CASES_TEXT,
  parseCasesDocument,
} from "@kipscope/shared";
import { decodeProtectedHeader } from "jose";
import { isLoopbackHost } from "./access.ts";
import {
  FinderKeysUnavailable,
  PayloadTooLarge,
  SignatureError,
  unverifiedClaims,
  verifyCasesJws,
} from "./caseSignature.ts";

/** The finder handoff's configuration (add-case-open K4), from `KIPSCOPE_FINDER_*` and `KIPSCOPE_CASE_*`. */
export interface FinderConfig {
  /** A JWKS file path or an https URL; unset: no signed catalog on a server. */
  jwks?: string;
  /** Required with `jwks`. */
  issuer?: string;
  /** Required with `jwks`. */
  audience?: string;
  algs: string[];
  userClaim: string;
  /** Largest `exp − iat`, ns. */
  maxAgeNs: bigint;
  /** Normalised origins a kept `origin.url` must have. */
  origins: string[];
  dataRefTemplate: string;
  /** The pad of a catalog without one, ns. */
  padNs: bigint;
}

/** A refused catalog open: the API error's code, HTTP status and message, and `reason` for `invalid_signature`. */
export class CaseOpenError extends Error {
  readonly code: string;
  readonly status: number;
  readonly reason: string | undefined;
  /** The JWS header's `kid` of a refused signature, for the debug log only. */
  kid?: string;

  constructor(code: string, status: number, message: string, reason?: string) {
    super(message);
    this.name = "CaseOpenError";
    this.code = code;
    this.status = status;
    this.reason = reason;
  }
}

/** What `readCases` gives: the checked catalog with its defaults applied. */
export interface ReadCases {
  catalog: CaseCatalog;
  current: number;
  pad: bigint;
  align: CaseAlign;
  view?: string | Record<string, unknown>;
  warnings: string[];
}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A catalog ID: 10 characters of [a-z0-9], each from crypto.randomInt. */
function newCatalogId(): string {
  let id = "";
  for (let i = 0; i < 10; i++) id += ID_CHARS[randomInt(ID_CHARS.length)];
  return id;
}

const invalid = (message: string) => new CaseOpenError("invalid_catalog", 400, message);

/** A claim by name or dotted path (`ping.user`). */
function claimAt(claims: Record<string, unknown>, path: string): unknown {
  let value: unknown = claims;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
    if (!Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function kidOf(jws: string): string | undefined {
  try {
    const { kid } = decodeProtectedHeader(jws);
    return typeof kid === "string" ? kid.slice(0, 64) : undefined;
  } catch {
    return undefined;
  }
}

/** The claims of a JWS (K4 step 3), verified when keys are configured; throws CaseOpenError. */
async function claimsOf(
  jws: string,
  config: FinderConfig,
  identity: "none" | "other",
  now: () => number,
): Promise<Record<string, unknown>> {
  const { jwks, issuer, audience } = config;
  if (jwks === undefined || issuer === undefined || audience === undefined) {
    if (identity !== "none")
      throw new CaseOpenError(
        "finder_not_configured",
        503,
        "this server takes no signed catalogs: KIPSCOPE_FINDER_JWKS is not set",
      );
    return unverifiedClaims(jws);
  }
  return verifyCasesJws(
    jws,
    { jwks, issuer, audience, algs: config.algs, maxAgeNs: config.maxAgeNs },
    now,
  );
}

/** The document a `cases` value carries (K3 forms, K4 steps 1–4); throws CaseOpenError. */
async function documentOf(
  input: string | Record<string, unknown>,
  config: FinderConfig,
  identity: "none" | "other",
  user: string | undefined,
  now: () => number,
): Promise<unknown> {
  if (typeof input !== "string") {
    if (identity !== "none")
      throw new CaseOpenError(
        "signature_required",
        403,
        "this server opens only catalogs signed by the finder",
      );
    return input;
  }
  const text = input.trim();
  if (text.length > MAX_CASES_TEXT)
    throw invalid(`cases: longer than ${MAX_CASES_TEXT} characters`);
  if (!isSignedCases(text)) {
    if (identity !== "none")
      throw new CaseOpenError(
        "signature_required",
        403,
        "this server opens only catalogs signed by the finder",
      );
    if (text.startsWith("{")) {
      try {
        return JSON.parse(text);
      } catch (error) {
        throw invalid(`cases: not JSON: ${(error as Error).message}`);
      }
    }
    try {
      return await decodeCasesLink(text);
    } catch (error) {
      throw invalid(`cases: not a catalog code: ${(error as Error).message}`);
    }
  }
  let claims: Record<string, unknown>;
  try {
    claims = await claimsOf(text, config, identity, now);
  } catch (error) {
    if (error instanceof CaseOpenError) throw error;
    if (error instanceof PayloadTooLarge) throw invalid(`cases: ${error.message}`);
    if (error instanceof FinderKeysUnavailable)
      throw new CaseOpenError("finder_keys_unavailable", 503, error.message);
    if (error instanceof SignatureError) {
      const refused = new CaseOpenError("invalid_signature", 403, error.message, error.reason);
      const kid = kidOf(text);
      if (kid !== undefined) refused.kid = kid;
      throw refused;
    }
    throw error;
  }
  if (identity !== "none" && claimAt(claims, config.userClaim) !== user)
    throw new CaseOpenError(
      "wrong_user",
      403,
      `this catalog was signed for another user (${config.userClaim})`,
    );
  if (typeof claims.cases !== "object" || claims.cases === null)
    throw invalid("cases: the signed claims hold no catalog");
  return claims.cases;
}

/**
 * Reads and checks a catalog (add-case-open K4 steps 1–5): its form, the signature, the user, the
 * document; maps each object to its data ref (K5), keeps `origin.url` only for a listed origin and
 * applies the pad and align defaults. Throws CaseOpenError. `user` undefined in none mode.
 */
export async function readCases(
  input: string | Record<string, unknown>,
  config: FinderConfig,
  identity: "none" | "other",
  user: string | undefined,
  now: () => number = Date.now,
): Promise<ReadCases> {
  const doc = await documentOf(input, config, identity, user, now);
  const parsed = parseCasesDocument(doc, {
    template: config.dataRefTemplate,
    defaultPad: config.padNs,
  });
  if (!parsed.ok) throw invalid(parsed.message);
  const warnings: string[] = [];
  const catalog: CaseCatalog = { catalogId: newCatalogId(), entries: parsed.entries };
  if (parsed.origin) {
    const { url, ...rest } = parsed.origin;
    const origin: NonNullable<CaseCatalog["origin"]> = { ...rest };
    if (url !== undefined) {
      if (listedOrigin(url, config.origins, identity)) origin.url = url;
      else warnings.push(`origin.url ${url} dropped: its origin is not in KIPSCOPE_FINDER_ORIGINS`);
    }
    if (Object.keys(origin).length > 0) catalog.origin = origin;
  }
  return {
    catalog,
    current: parsed.current,
    pad: parsed.pad,
    align: parsed.align,
    ...(parsed.view === undefined ? {} : { view: parsed.view }),
    warnings,
  };
}

/** `readCases` with the identity taken from `user`: undefined is none mode (K4 `verifyCases`). */
export function verifyCases(
  text: string | Record<string, unknown>,
  config: FinderConfig,
  user?: string,
  now?: () => number,
): Promise<ReadCases> {
  return readCases(text, config, user === undefined ? "none" : "other", user, now);
}

/** http(s) and a listed origin; in identity none also loopback on any port (X3). */
function listedOrigin(
  url: string,
  origins: readonly string[],
  identity: "none" | "other",
): boolean {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      (origins.includes(parsed.origin) || (identity === "none" && isLoopbackHost(parsed.hostname)))
    );
  } catch {
    return false;
  }
}
