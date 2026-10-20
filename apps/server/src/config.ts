import { isAbsolute, resolve } from "node:path";
import { parseDuration } from "@kipscope/shared";

/** Column names of the long-format table (design D5). */
export interface TableMapping {
  database: string;
  table: string;
  dataRef: string;
  signal: string;
  time: string;
  value: string;
  /** Text column (state names, design E1); a missing column is no config error (no signal has text). */
  text: string;
}

/**
 * Columns of the events table (design E1). Database, data-ref and time columns come from the
 * signals `mapping`; a missing table is no config error (the source answers none).
 */
export interface EventMapping {
  table: string;
  source: string;
  kind: string;
  name: string;
  value: string;
  text: string;
  detail: string;
}

export interface ClickHouseConfig {
  kind: "clickhouse";
  url: string;
  username: string;
  password: string;
}

/** ADX cluster and sign-in (design C5); the database is `mapping.database`. */
export interface AdxConfig {
  kind: "adx";
  /** Origin only, without trailing `/`. */
  cluster: string;
  /** `azcli`: token from the user's `az login`; `none`: no token (loopback emulator only). */
  auth: "azcli" | "none";
}

/** The server's one source, by `KIPSCOPE_SOURCE` (design C5, A-2 (a)). */
export type SourceConfig = ClickHouseConfig | AdxConfig;

export interface Config {
  host: string;
  port: number;
  source: SourceConfig;
  mapping: TableMapping;
  events: EventMapping;
  /** Absolute paths, in priority order (first file wins). */
  dbcFiles: string[];
  /** Diagnostic catalog manifests, absolute paths in priority order (design M2); names file next to each. */
  diagCatalogs: string[];
  queryConcurrency: number;
  queryTimeoutSeconds: number;
  /** Project file (D-035). Default `<repo root>/kipscope.yaml`, optional; `KIPSCOPE_PROJECT_FILE` overrides it and must exist. */
  projectFile: { path: string; required: boolean };
  /** Views and the state file (design V4); `KIPSCOPE_STATE_DIR`, default `<repo root>/.kipscope`. */
  stateDir: string;
  /** `KIPSCOPE_CATALOG` (add-scope Z11): `full` loads the whole catalog at start, `scoped` only a scope's list. */
  catalogMode: CatalogMode;
  /** `KIPSCOPE_SCOPE_PAD` in ns, ≥ 0: padding on each side of a scope derived from a view (Z8, Z11). */
  scopePad: bigint;
  /** `KIPSCOPE_IDENTITY` (add-multiuser M1). */
  identity: IdentityConfig;
  /** `KIPSCOPE_ORIGINS`, normalised origins; required (non-empty) unless identity `none` (M10). */
  origins: string[];
  /** `KIPSCOPE_SHARE` (M2): whether owners may set the share level `read` or `write`; default on. */
  share: boolean;
  /** `KIPSCOPE_WORKSPACE_IDLE_DAYS` (M4). */
  workspaceIdleDays: number;
  /** `KIPSCOPE_WEB_DIR`, absolute: the built UI the server serves (M11); unset serves none. */
  webDir?: string;
}

/** A JWS algorithm `KIPSCOPE_OIDC_ALGS` may name; never `none` or `HS*` (add-multiuser M15). */
export const OIDC_ALGORITHMS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
] as const;
export type OidcAlgorithm = (typeof OIDC_ALGORITHMS)[number];

/** The built-in `oidc` adapter (add-multiuser M2, M15). */
export interface OidcConfig {
  issuer: string;
  audience: string;
  /** Unset: `jwks_uri` of the issuer's discovery document. */
  jwksUrl?: string;
  userClaim: string;
  /** A claim name or dotted path (`realm_access.roles`). */
  rolesClaim: string;
  /** Lower-case header name; `authorization` carries `Bearer <jwt>`, any other the bare JWT. */
  header: string;
  algs: OidcAlgorithm[];
}

/** `KIPSCOPE_IDENTITY` (add-multiuser M1, M2). A module path is as given, resolved against the working directory when loaded. */
export type IdentityConfig =
  | { kind: "none" }
  | { kind: "oidc"; oidc: OidcConfig }
  | { kind: "module"; path: string };

export const CATALOG_MODES = ["full", "scoped"] as const;
export type CatalogMode = (typeof CATALOG_MODES)[number];

const DEFAULT_SCOPE_PAD_TEXT = "1h";
/** `KIPSCOPE_SCOPE_PAD` default (add-scope Z11), in ns. */
export const DEFAULT_SCOPE_PAD = parseDuration(DEFAULT_SCOPE_PAD_TEXT);

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** A Kusto entity name, e.g. an ADX database (design C5). */
const KUSTO_ENTITY = /^[A-Za-z0-9_.\- ]{1,260}$/;
const SOURCE_KINDS = ["clickhouse", "adx"] as const;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const DEFAULT_DBC_FILES = [
  "../CarController/vehicles/smart451/dbc/h-can.dbc",
  "../CarController/vehicles/smart451/dbc/hybrid-can.dbc",
];

export const DEFAULT_DIAG_CATALOGS = [
  "../CarController/vehicles/smart451/uds/bms-live.manifest.json",
];

/** Default columns per source of `KIPSCOPE_TABLE` and `KIPSCOPE_COLUMN_*`; ADX's are neutral (design C5). */
const DEFAULT_COLUMNS: Record<SourceConfig["kind"], Omit<TableMapping, "database">> = {
  clickhouse: {
    table: "signals",
    dataRef: "vehicle",
    signal: "signal",
    time: "utc",
    value: "value",
    text: "text",
  },
  adx: {
    table: "signals",
    dataRef: "dataref",
    signal: "signal",
    time: "timestamp",
    value: "value",
    text: "text",
  },
};

/** Defaults of `KIPSCOPE_EVENTS_TABLE` and `KIPSCOPE_EVENT_COLUMN_*` (design E1), the same for both sources. */
export const DEFAULT_EVENT_MAPPING: EventMapping = {
  table: "events",
  source: "source",
  kind: "kind",
  name: "name",
  value: "value",
  text: "text",
  detail: "detail",
};

type Env = Record<string, string | undefined>;

/** Comma list of paths, trimmed, blanks dropped, relative ones against `root`; unset or empty → fallback. */
function pathList(env: Env, key: string, fallback: string[], root: string): string[] {
  const raw = env[key];
  return (raw ? raw.split(",") : fallback)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (isAbsolute(p) ? p : resolve(root, p)));
}

function identifier(env: Env, key: string, fallback: string): string {
  const value = env[key] || fallback;
  if (!IDENTIFIER.test(value)) throw new Error(`${key}: not a valid identifier: ${value}`);
  return value;
}

function positiveInt(env: Env, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0)
    throw new Error(`${key}: not a positive integer: ${raw}`);
  return value;
}

function catalogMode(env: Env): CatalogMode {
  const raw = env.KIPSCOPE_CATALOG || "full";
  if (!(CATALOG_MODES as readonly string[]).includes(raw))
    throw new Error(`KIPSCOPE_CATALOG: ${CATALOG_MODES.join(" or ")}, not ${raw}`);
  return raw as CatalogMode;
}

/** A CLI duration (`30min`, `1h`, `0s`) of at least 0. */
function scopePad(env: Env): bigint {
  const key = "KIPSCOPE_SCOPE_PAD";
  const raw = env[key] || DEFAULT_SCOPE_PAD_TEXT;
  let pad: bigint;
  try {
    pad = parseDuration(raw);
  } catch {
    pad = -1n;
  }
  if (pad < 0n)
    throw new Error(`${key}: a duration of at least 0 (e.g. 30min, 1h, 0s), not ${raw}`);
  return pad;
}

function required(env: Env, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is not set (see .env.example)`);
  return value;
}

/** `https:` origin, or `http:` for a loopback host; path, query and user info are refused. */
function adxCluster(env: Env): { cluster: string; loopback: boolean } {
  const key = "KIPSCOPE_ADX_CLUSTER";
  const raw = required(env, key);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${key}: not a URL: ${raw}`);
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw new Error(`${key}: only the cluster origin, without path, query or user: ${raw}`);
  const loopback = LOOPBACK_HOSTS.has(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
    throw new Error(`${key}: must be https:// (http:// only for a loopback host): ${raw}`);
  return { cluster: url.origin, loopback };
}

/** The selected source and its database; variables of the other source are ignored. */
function sourceConfig(env: Env): { source: SourceConfig; database: string } {
  const kind = env.KIPSCOPE_SOURCE || "clickhouse";
  if (kind === "clickhouse")
    return {
      source: {
        kind,
        url: required(env, "CLICKHOUSE_URL"),
        username: env.CLICKHOUSE_USER || "default",
        password: env.CLICKHOUSE_PASSWORD ?? "",
      },
      database: identifier(env, "CLICKHOUSE_DATABASE", "sdlog"),
    };
  if (kind === "adx") {
    const { cluster, loopback } = adxCluster(env);
    const database = required(env, "KIPSCOPE_ADX_DATABASE");
    if (!KUSTO_ENTITY.test(database))
      throw new Error(`KIPSCOPE_ADX_DATABASE: not a valid database name: ${database}`);
    const auth = env.KIPSCOPE_ADX_AUTH || "azcli";
    if (auth !== "azcli" && auth !== "none")
      throw new Error(`KIPSCOPE_ADX_AUTH: azcli or none, not ${auth}`);
    if (auth === "none" && !loopback)
      throw new Error("KIPSCOPE_ADX_AUTH: none only for a loopback cluster");
    return { source: { kind, cluster, auth }, database };
  }
  throw new Error(`KIPSCOPE_SOURCE: ${SOURCE_KINDS.join(" or ")}, not ${kind}`);
}

const IDENTITY_FORMS = "none, oidc or module:<path>";

/** `https:` URL, or `http:` for a loopback host (tests). */
function httpsUrl(key: string, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${key}: not a URL: ${raw}`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname)))
    throw new Error(`${key}: must be https:// (http:// only for a loopback host): ${raw}`);
  return raw;
}

/** A claim name, or a dotted path of names. */
function claim(env: Env, key: string, fallback: string): string {
  const value = env[key] || fallback;
  if (!/^[^.\s]+(\.[^.\s]+)*$/.test(value))
    throw new Error(`${key}: not a claim name or path: ${value}`);
  return value;
}

function oidcAlgorithms(env: Env): OidcAlgorithm[] {
  const key = "KIPSCOPE_OIDC_ALGS";
  const raw = env[key] || "RS256,PS256,ES256";
  const names = raw
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  if (names.length === 0) throw new Error(`${key}: no algorithm named`);
  for (const name of names)
    if (!(OIDC_ALGORITHMS as readonly string[]).includes(name))
      throw new Error(`${key}: ${name} is not allowed; use some of ${OIDC_ALGORITHMS.join(" ")}`);
  return [...new Set(names)] as OidcAlgorithm[];
}

function oidcConfig(env: Env): OidcConfig {
  const jwks = env.KIPSCOPE_OIDC_JWKS_URL;
  const header = (env.KIPSCOPE_OIDC_HEADER || "authorization").toLowerCase();
  if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(header))
    throw new Error(`KIPSCOPE_OIDC_HEADER: not a header name: ${header}`);
  return {
    issuer: httpsUrl("KIPSCOPE_OIDC_ISSUER", required(env, "KIPSCOPE_OIDC_ISSUER")),
    audience: required(env, "KIPSCOPE_OIDC_AUDIENCE"),
    ...(jwks ? { jwksUrl: httpsUrl("KIPSCOPE_OIDC_JWKS_URL", jwks) } : {}),
    userClaim: claim(env, "KIPSCOPE_OIDC_USER_CLAIM", "sub"),
    rolesClaim: claim(env, "KIPSCOPE_OIDC_ROLES_CLAIM", "roles"),
    header,
    algs: oidcAlgorithms(env),
  };
}

function identityConfig(env: Env): IdentityConfig {
  const raw = env.KIPSCOPE_IDENTITY || "none";
  if (raw === "none") return { kind: "none" };
  if (raw === "oidc") return { kind: "oidc", oidc: oidcConfig(env) };
  if (raw.startsWith("module:") && raw.length > "module:".length)
    return { kind: "module", path: raw.slice("module:".length) };
  throw new Error(`KIPSCOPE_IDENTITY: ${IDENTITY_FORMS}, not ${raw}`);
}

/** `KIPSCOPE_SHARE` (add-multiuser M2): `on` (the default) or `off`. */
function share(env: Env): boolean {
  const raw = env.KIPSCOPE_SHARE || "on";
  if (raw !== "on" && raw !== "off") throw new Error(`KIPSCOPE_SHARE: on or off, not ${raw}`);
  return raw === "on";
}

/** Comma list of `http(s)://host[:port]` origins without path, normalised (`https://h:443` → `https://h`). */
export function parseOrigins(raw: string | undefined): string[] {
  const key = "KIPSCOPE_ORIGINS";
  const origins: string[] = [];
  for (const entry of (raw ?? "").split(",").map((e) => e.trim())) {
    if (!entry) continue;
    let url: URL | undefined;
    try {
      url = new URL(entry);
    } catch {
      url = undefined;
    }
    if (
      url === undefined ||
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      /[/?#]/.test(entry.slice(url.protocol.length + 2).replace(/\/$/, ""))
    )
      throw new Error(`${key}: an http(s)://host[:port] origin without path, not ${entry}`);
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  return origins;
}

/** Reads the server config from environment variables (see .env.example). */
export function loadConfig(env: Env = process.env, root = REPO_ROOT): Config {
  const { source, database } = sourceConfig(env);
  const columns = DEFAULT_COLUMNS[source.kind];
  const project = env.KIPSCOPE_PROJECT_FILE;
  const identity = identityConfig(env);
  const origins = parseOrigins(env.KIPSCOPE_ORIGINS);
  if (identity.kind !== "none" && origins.length === 0)
    throw new Error(
      `KIPSCOPE_ORIGINS is not set; it is required with KIPSCOPE_IDENTITY=${identity.kind}`,
    );
  const webDir = env.KIPSCOPE_WEB_DIR;
  return {
    host: env.KIPSCOPE_HOST || "127.0.0.1",
    port: positiveInt(env, "KIPSCOPE_PORT", 7310),
    source,
    mapping: {
      database,
      table: identifier(env, "KIPSCOPE_TABLE", columns.table),
      dataRef: identifier(env, "KIPSCOPE_COLUMN_DATAREF", columns.dataRef),
      signal: identifier(env, "KIPSCOPE_COLUMN_SIGNAL", columns.signal),
      time: identifier(env, "KIPSCOPE_COLUMN_TIME", columns.time),
      value: identifier(env, "KIPSCOPE_COLUMN_VALUE", columns.value),
      text: identifier(env, "KIPSCOPE_COLUMN_TEXT", columns.text),
    },
    events: {
      table: identifier(env, "KIPSCOPE_EVENTS_TABLE", DEFAULT_EVENT_MAPPING.table),
      source: identifier(env, "KIPSCOPE_EVENT_COLUMN_SOURCE", DEFAULT_EVENT_MAPPING.source),
      kind: identifier(env, "KIPSCOPE_EVENT_COLUMN_KIND", DEFAULT_EVENT_MAPPING.kind),
      name: identifier(env, "KIPSCOPE_EVENT_COLUMN_NAME", DEFAULT_EVENT_MAPPING.name),
      value: identifier(env, "KIPSCOPE_EVENT_COLUMN_VALUE", DEFAULT_EVENT_MAPPING.value),
      text: identifier(env, "KIPSCOPE_EVENT_COLUMN_TEXT", DEFAULT_EVENT_MAPPING.text),
      detail: identifier(env, "KIPSCOPE_EVENT_COLUMN_DETAIL", DEFAULT_EVENT_MAPPING.detail),
    },
    dbcFiles: pathList(env, "KIPSCOPE_DBC_FILES", DEFAULT_DBC_FILES, root),
    diagCatalogs: pathList(env, "KIPSCOPE_DIAG_CATALOGS", DEFAULT_DIAG_CATALOGS, root),
    queryConcurrency: positiveInt(env, "KIPSCOPE_QUERY_CONCURRENCY", 4),
    queryTimeoutSeconds: positiveInt(env, "KIPSCOPE_QUERY_TIMEOUT_S", 30),
    projectFile: project
      ? { path: isAbsolute(project) ? project : resolve(root, project), required: true }
      : { path: resolve(root, "kipscope.yaml"), required: false },
    stateDir: resolve(root, env.KIPSCOPE_STATE_DIR || ".kipscope"),
    catalogMode: catalogMode(env),
    scopePad: scopePad(env),
    identity,
    origins,
    share: share(env),
    workspaceIdleDays: positiveInt(env, "KIPSCOPE_WORKSPACE_IDLE_DAYS", 30),
    ...(webDir ? { webDir: isAbsolute(webDir) ? webDir : resolve(root, webDir) } : {}),
  };
}
