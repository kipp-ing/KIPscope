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
  queryConcurrency: number;
  queryTimeoutSeconds: number;
}

export const REPO_ROOT = resolve(import.meta.dirname, "../../..");

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

const DEFAULT_DBC_FILES = [
  "../CarController/vehicles/smart451/dbc/h-can.dbc",
  "../CarController/vehicles/smart451/dbc/hybrid-can.dbc",
];

type Env = Record<string, string | undefined>;

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
  const dbc = env.LETSVIEW_DBC_FILES ? env.LETSVIEW_DBC_FILES.split(",") : DEFAULT_DBC_FILES;
  return {
    host: env.LETSVIEW_HOST || "127.0.0.1",
    port: positiveInt(env, "LETSVIEW_PORT", 8080),
    clickhouse: {
      url,
      username: env.CLICKHOUSE_USER || "default",
      password: env.CLICKHOUSE_PASSWORD ?? "",
    },
    mapping: {
      database: identifier(env, "CLICKHOUSE_DATABASE", "sdlog"),
      table: identifier(env, "LETSVIEW_TABLE", "signals"),
      dataRef: identifier(env, "LETSVIEW_COLUMN_DATAREF", "vehicle"),
      signal: identifier(env, "LETSVIEW_COLUMN_SIGNAL", "signal"),
      time: identifier(env, "LETSVIEW_COLUMN_TIME", "utc"),
      value: identifier(env, "LETSVIEW_COLUMN_VALUE", "value"),
    },
    dbcFiles: dbc
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => (isAbsolute(p) ? p : resolve(root, p))),
    queryConcurrency: positiveInt(env, "LETSVIEW_QUERY_CONCURRENCY", 4),
    queryTimeoutSeconds: positiveInt(env, "LETSVIEW_QUERY_TIMEOUT_S", 30),
  };
}
