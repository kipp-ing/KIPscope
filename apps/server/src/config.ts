import { isAbsolute, resolve } from "node:path";

/** Column names of the long-format table (design D5). */
export interface TableMapping {
  database: string;
  table: string;
  dataRef: string;
  signal: string;
  time: string;
  value: string;
}

export interface Config {
  host: string;
  port: number;
  clickhouse: { url: string; username: string; password: string };
  mapping: TableMapping;
  /** Absolute paths, in priority order (first file wins). */
  dbcFiles: string[];
  /** Diagnostic catalog manifests, absolute paths in priority order (design M2); names file next to each. */
  diagCatalogs: string[];
  queryConcurrency: number;
  queryTimeoutSeconds: number;
  /** Project file (D-035). Default `<repo root>/kipscope.yaml`, optional; `KIPSCOPE_PROJECT_FILE` overrides it and must exist. */
  projectFile: { path: string; required: boolean };
}

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const DEFAULT_DBC_FILES = [
  "../CarController/vehicles/smart451/dbc/h-can.dbc",
  "../CarController/vehicles/smart451/dbc/hybrid-can.dbc",
];

export const DEFAULT_DIAG_CATALOGS = [
  "../CarController/vehicles/smart451/uds/bms-live.manifest.json",
];

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

/** Reads the server config from environment variables (see .env.example). */
export function loadConfig(env: Env = process.env, root = REPO_ROOT): Config {
  const url = env.CLICKHOUSE_URL;
  if (!url) throw new Error("CLICKHOUSE_URL is not set (see .env.example)");
  const project = env.KIPSCOPE_PROJECT_FILE;
  return {
    host: env.KIPSCOPE_HOST || "127.0.0.1",
    port: positiveInt(env, "KIPSCOPE_PORT", 7310),
    clickhouse: {
      url,
      username: env.CLICKHOUSE_USER || "default",
      password: env.CLICKHOUSE_PASSWORD ?? "",
    },
    mapping: {
      database: identifier(env, "CLICKHOUSE_DATABASE", "sdlog"),
      table: identifier(env, "KIPSCOPE_TABLE", "signals"),
      dataRef: identifier(env, "KIPSCOPE_COLUMN_DATAREF", "vehicle"),
      signal: identifier(env, "KIPSCOPE_COLUMN_SIGNAL", "signal"),
      time: identifier(env, "KIPSCOPE_COLUMN_TIME", "utc"),
      value: identifier(env, "KIPSCOPE_COLUMN_VALUE", "value"),
    },
    dbcFiles: pathList(env, "KIPSCOPE_DBC_FILES", DEFAULT_DBC_FILES, root),
    diagCatalogs: pathList(env, "KIPSCOPE_DIAG_CATALOGS", DEFAULT_DIAG_CATALOGS, root),
    queryConcurrency: positiveInt(env, "KIPSCOPE_QUERY_CONCURRENCY", 4),
    queryTimeoutSeconds: positiveInt(env, "KIPSCOPE_QUERY_TIMEOUT_S", 30),
    projectFile: project
      ? { path: isAbsolute(project) ? project : resolve(root, project), required: true }
      : { path: resolve(root, "kipscope.yaml"), required: false },
  };
}
