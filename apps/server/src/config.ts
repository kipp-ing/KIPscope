import { isAbsolute, resolve } from "node:path";

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
}

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

/** Reads the server config from environment variables (see .env.example). */
export function loadConfig(env: Env = process.env, root = REPO_ROOT): Config {
  const { source, database } = sourceConfig(env);
  const columns = DEFAULT_COLUMNS[source.kind];
  const project = env.KIPSCOPE_PROJECT_FILE;
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
  };
}
