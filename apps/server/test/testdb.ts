import { resolve } from "node:path";
import { ClickHouseSource, createClickHouseClient } from "../src/clickhouse.ts";
import type { TableMapping } from "../src/config.ts";

/** Client for the seeded test DB (`docker compose up -d` + `seed:test`); never the real one. */
export function testClient() {
  return createClickHouseClient({
    url: process.env.TEST_CLICKHOUSE_URL || "http://localhost:8124",
    username: process.env.TEST_CLICKHOUSE_USER || "letsview",
    password: process.env.TEST_CLICKHOUSE_PASSWORD ?? "letsview",
  });
}

export const testMapping: TableMapping = {
  database: "sdlog",
  table: "signals",
  dataRef: "vehicle",
  signal: "signal",
  time: "utc",
  value: "value",
};

export function testSource(table = "signals") {
  return new ClickHouseSource(testClient(), { ...testMapping, table }, 30);
}

export const fixture = (name: string) => resolve(import.meta.dirname, "fixtures", name);
export const testDbcFiles = [fixture("test-a.dbc"), fixture("test-b.dbc")];
