import { buildApp } from "./app.ts";
import { Catalog } from "./catalog.ts";
import { ClickHouseSource, createClickHouseClient } from "./clickhouse.ts";
import { loadConfig } from "./config.ts";
import { loadDbcFiles } from "./dbc.ts";
import { QueryQueue, queuedSource } from "./queue.ts";
import { WorkspaceStore } from "./workspace.ts";

const config = loadConfig();
const source = queuedSource(
  new ClickHouseSource(
    createClickHouseClient(config.clickhouse),
    config.mapping,
    config.queryTimeoutSeconds,
  ),
  new QueryQueue(config.queryConcurrency),
);

const dbcWarnings: string[] = [];
const catalog = new Catalog(source, () =>
  loadDbcFiles(config.dbcFiles, (path, error) => dbcWarnings.push(`${path}: ${error}`)),
);
const workspace = new WorkspaceStore({
  signalExists: (id) => catalog.get(id) !== undefined,
  unitOf: (id) => catalog.get(id)?.unit,
});
const app = buildApp({ catalog, source, workspace }, { logger: true });

async function loadCatalog() {
  dbcWarnings.length = 0;
  try {
    await catalog.refresh();
    app.log.info({ signals: catalog.size }, "catalog loaded");
  } catch (error) {
    app.log.error(
      { error: String(error) },
      "catalog not loaded; retry via POST /api/catalog/refresh",
    );
  }
  for (const warning of dbcWarnings) app.log.warn(`DBC file skipped: ${warning}`);
}

await app.listen({ host: config.host, port: config.port });
await loadCatalog();
