/** Builds the built-in `oidc` adapter against a test JWKS server, through the real config path. */
import { loadConfig } from "../../src/config.ts";
import { type IdentityAdapter, type IdentityLog, loadIdentity } from "../../src/identity.ts";
import { claims, type JwksServer } from "../jwks.ts";

export const AUDIENCE = "kipscope";

/** The environment of an `oidc` server for the JWKS server; `extra` overrides or adds variables. */
export const oidcEnv = (jwks: JwksServer, extra: Record<string, string> = {}) => ({
  CLICKHOUSE_URL: "http://localhost:18123",
  KIPSCOPE_IDENTITY: "oidc",
  KIPSCOPE_OIDC_ISSUER: jwks.issuer,
  KIPSCOPE_OIDC_AUDIENCE: AUDIENCE,
  KIPSCOPE_RULES: "/etc/kipscope/rules.yaml",
  KIPSCOPE_ORIGINS: "https://kipscope.example.org",
  ...extra,
});

/** The adapter `KIPSCOPE_IDENTITY=oidc` gives for `jwks`. */
export async function oidcAdapter(
  jwks: JwksServer,
  extra: Record<string, string> = {},
  log: IdentityLog = { info() {}, warn() {} },
): Promise<IdentityAdapter> {
  const config = loadConfig(oidcEnv(jwks, extra), "/repo/kipscope");
  const adapter = await loadIdentity(config.identity, { env: {}, log });
  if (!adapter) throw new Error("oidc adapter expected");
  return adapter;
}

/** Claims for a token the adapter built by `oidcAdapter` accepts, `over` replacing claims. */
export const tokenClaims = (jwks: JwksServer, over: Record<string, unknown> = {}) =>
  claims(over, { iss: jwks.issuer, aud: AUDIENCE });
