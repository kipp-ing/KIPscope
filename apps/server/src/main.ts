import { buildApp } from "./app.ts";
import { Catalog, warnDisplayFallbacks } from "./catalog.ts";
import { ClickHouseSource, createClickHouseClient } from "./clickhouse.ts";
import { loadConfig } from "./config.ts";
import { loadDbcFiles } from "./dbc.ts";
import { NO_RULES } from "./names.ts";
import { loadProjectFile, ProjectFileError } from "./project.ts";
import { QueryQueue, queuedSource } from "./queue.ts";
import { WorkspaceStore } from "./workspace.ts";

const config = loadConfig();

// Before listen: an invalid project file stops the server (design N6).
let rules = NO_RULES;
try {
  rules = loadProjectFile(config.projectFile);
} catch (error) {
  if (!(error instanceof ProjectFileError)) throw error;
  process.stderr.write(`letsview: invalid project file\n${error.message}\n`);
  process.exit(1);
}

const source = queuedSource(
  new ClickHouseSource(
    createClickHouseClient(config.clickhouse),
    config.mapping,
    config.queryTimeoutSeconds,
  ),
  new QueryQueue(config.queryConcurrency),
);

const dbcWarnings: string[] = [];
const catalog = new Catalog(
  source,
  () => loadDbcFiles(config.dbcFiles, (path, error) => dbcWarnings.push(`${path}: ${error}`)),
  rules,
);
const workspace = new WorkspaceStore({
  signalExists: (id) => catalog.get(id) !== undefined,
  unitOf: (id) => catalog.get(id)?.unit,
});
const app = buildApp({ catalog, source, workspace }, { logger: true });
// loadProjectFile returns NO_RULES itself only for a missing optional file.
if (rules === NO_RULES)
  app.log.info(`project file ${config.projectFile.path} not found; signals show their full names`);

async function loadCatalog() {
  dbcWarnings.length = 0;
  try {
    await catalog.refresh();
    app.log.info({ signals: catalog.size }, "catalog loaded");
    warnDisplayFallbacks(app.log, catalog);
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
