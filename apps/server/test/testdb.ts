import { resolve } from "node:path";
import { ClickHouseSource, createClickHouseClient } from "../src/clickhouse.ts";
import type { EventMapping, TableMapping } from "../src/config.ts";

/** Client for the seeded test DB (`docker compose up -d` + `seed:test`); never the real one. */
export function testClient() {
  return createClickHouseClient({
    url: process.env.TEST_CLICKHOUSE_URL || "http://localhost:8124",
    username: process.env.TEST_CLICKHOUSE_USER || "kipscope",
    password: process.env.TEST_CLICKHOUSE_PASSWORD ?? "kipscope",
  });
}

export const testMapping: TableMapping = {
  database: "sdlog",
  table: "signals",
  dataRef: "vehicle",
  signal: "signal",
  time: "utc",
  value: "value",
  text: "text",
};

/** Events table of the test DB (design T): carserver's defaults. */
export const testEventMapping: EventMapping = {
  table: "events",
  source: "source",
  kind: "kind",
  name: "name",
  value: "value",
  text: "text",
  detail: "detail",
};

export function testSource(table = "signals", events: EventMapping = testEventMapping) {
  return new ClickHouseSource(testClient(), { ...testMapping, table }, 30, events);
}

export const fixture = (name: string) => resolve(import.meta.dirname, "fixtures", name);
export const testDbcFiles = [fixture("test-a.dbc"), fixture("test-b.dbc")];
export const testDiagCatalogs = [fixture("test-diag.manifest.json")];
