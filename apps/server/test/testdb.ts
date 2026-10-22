import { resolve } from "node:path";
import { Catalog } from "../src/catalog.ts";
import { ClickHouseSource, createClickHouseClient } from "../src/clickhouse.ts";
import type { EventMapping, TableMapping } from "../src/config.ts";
import type { DataSource } from "../src/datasource.ts";
import { loadDbcFiles } from "../src/dbc.ts";
import { loadDiagCatalogs } from "../src/diag.ts";
import { completeSource } from "../src/fallbacks.ts";

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

/** The ClickHouse adapter alone: what the server gets as an adapter (it has no native `series`). */
export function testSource(table = "signals", events: EventMapping = testEventMapping) {
  return new ClickHouseSource(testClient(), { ...testMapping, table }, 30, events);
}

/** The adapter completed with the server's fallbacks (`series` among them): what the routes read from. */
export function testDataSource(
  table = "signals",
  events: EventMapping = testEventMapping,
): DataSource {
  return completeSource(testSource(table, events));
}

export const fixture = (name: string) => resolve(import.meta.dirname, "fixtures", name);
export const testDbcFiles = [fixture("test-a.dbc"), fixture("test-b.dbc")];
export const testDiagCatalogs = [fixture("test-diag.manifest.json")];

/** Catalog with the test DBCs and the test diag catalog, so DBC cycle times and diag intervals are known (add-gap-display). */
export function testCatalog(source: DataSource = testDataSource()) {
  return new Catalog(
    source,
    () => loadDbcFiles(testDbcFiles),
    undefined,
    undefined,
    (warn) => loadDiagCatalogs(testDiagCatalogs, warn),
  );
}
