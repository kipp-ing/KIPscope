import { isAbsolute, resolve } from "node:path";

/** Column names of the long-format table (design D5). */
export interface TableMapping {
  database: string;
  table: string;
  dataRef: string;
  signal: string;
  time: string;
  value: string;
  /** Text column (state names, design E1); a missing column is no config error (textSignals → []). */
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

export interface Config {
  host: string;
  port: number;
  clickhouse: { url: string; username: string; password: string };
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

/** Defaults of `KIPSCOPE_EVENTS_TABLE` and `KIPSCOPE_EVENT_COLUMN_*` (design E1). */
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
      text: identifier(env, "KIPSCOPE_COLUMN_TEXT", "text"),
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
  };
}
