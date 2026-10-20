import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { IdentityConfig } from "./config.ts";
import { oidcAdapter } from "./identity/oidc.ts";

/**
 * The identity contract (add-multiuser M1): an adapter turns a request into a user and roles, or
 * refuses it. `none` runs no adapter; `oidc` is built in (M15); `module:<path>` loads one's own.
 * The server checks every result and fails closed on a throw (`guard.ts`).
 */

/** What an adapter sees of a request (HTTP or the live channel's upgrade). */
export interface IdentityRequest {
  /** Header names lower-case; a repeated header is joined with ", " (Node's rule). */
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** The TCP peer, IPv4-mapped IPv6 as IPv4. Never taken from X-Forwarded-For. */
  readonly peer: string;
  readonly method: string;
  /** Path without query, after the workspace prefix was removed (M5). */
  readonly path: string;
}
export interface Identity {
  readonly user: string;
  readonly roles: readonly string[];
}
export type IdentifyResult =
  | Identity
  | { readonly refused: "unauthenticated" | "invalid_token"; readonly reason?: string };
export interface IdentityAdapter {
  /** "oidc" or the module's own name; shown by GET /api/me and the start log. */
  readonly kind: string;
  /** No credential: refused "unauthenticated"; a bad one: "invalid_token". Throws only when it cannot decide (IdP unreachable). */
  identify(request: IdentityRequest): Promise<IdentifyResult>;
  close?(): Promise<void>;
}
/** The default export of a module adapter. */
export type IdentityFactory = (options: {
  env: Readonly<Record<string, string | undefined>>;
  log: { info(message: string): void; warn(message: string): void };
}) => IdentityAdapter | Promise<IdentityAdapter>;

export interface IdentityLog {
  info(message: string): void;
  warn(message: string): void;
  debug?(message: string): void;
}

/** The kind `GET /api/me` reports without an adapter. */
export const NONE_KIND = "none";

const VAR = "KIPSCOPE_IDENTITY";

/**
 * The adapter `KIPSCOPE_IDENTITY` selects; undefined for `none`. A module is imported once; a
 * missing file, a default export that is not a function, or an adapter without `kind` and
 * `identify` throws naming the variable and the reason (the server does not start).
 */
export async function loadIdentity(
  config: IdentityConfig,
  options: {
    env?: Readonly<Record<string, string | undefined>>;
    log: IdentityLog;
    /** Base of a relative module path; default the working directory. */
    cwd?: string;
  },
): Promise<IdentityAdapter | undefined> {
  if (config.kind === "none") return undefined;
  if (config.kind === "oidc") return oidcAdapter(config.oidc, { log: options.log });
  const path = isAbsolute(config.path)
    ? config.path
    : resolve(options.cwd ?? process.cwd(), config.path);
  if (!existsSync(path)) throw new Error(`${VAR}: module file not found: ${path}`);
  let factory: unknown;
  try {
    factory = ((await import(pathToFileURL(path).href)) as { default?: unknown }).default;
  } catch (error) {
    throw new Error(`${VAR}: module ${path} cannot be loaded: ${messageOf(error)}`);
  }
  if (typeof factory !== "function")
    throw new Error(`${VAR}: module ${path}: the default export is not a function`);
  let adapter: unknown;
  try {
    adapter = await (factory as IdentityFactory)({
      env: options.env ?? process.env,
      log: { info: (m) => options.log.info(m), warn: (m) => options.log.warn(m) },
    });
  } catch (error) {
    throw new Error(`${VAR}: module ${path}: the factory failed: ${messageOf(error)}`);
  }
  const candidate = adapter as Partial<IdentityAdapter> | null | undefined;
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    typeof candidate.kind !== "string" ||
    candidate.kind === "" ||
    typeof candidate.identify !== "function"
  )
    throw new Error(
      `${VAR}: module ${path}: the factory must return an adapter with kind and identify`,
    );
  // "none" means "no adapter, every workspace reads everything" elsewhere (GET /api/me, the footer).
  if (candidate.kind === NONE_KIND)
    throw new Error(`${VAR}: module ${path}: the adapter kind must not be "${NONE_KIND}"`);
  return candidate as IdentityAdapter;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
