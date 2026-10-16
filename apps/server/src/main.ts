import { isLoopbackHost } from "./access.ts";
import { buildApp } from "./app.ts";
import { Catalog, keepCatalogLoaded, warnDisplayFallbacks } from "./catalog.ts";
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

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);
const loopback = isLoopbackHost(config.host);
const wildcard = WILDCARD_HOSTS.has(config.host);
// A configured LAN address is the one other name the Host check admits (design H3).
const extraHost = loopback || wildcard ? undefined : config.host;

const catalog = new Catalog(
  source,
  (warn) => loadDbcFiles(config.dbcFiles, (path, error) => warn(`${path}: ${error}`)),
  rules,
  { warn: (message) => app.log.warn(message) },
);
const workspace = new WorkspaceStore(
  {
    signalExists: (id) => catalog.get(id) !== undefined,
    unitOf: (id) => catalog.get(id)?.unit,
  },
  { onListenerError: (error) => app.log.error({ error: String(error) }, "live listener failed") },
);
const app = buildApp(
  { catalog, source, workspace },
  extraHost === undefined ? { logger: true } : { logger: true, extraHost },
);
// loadProjectFile returns NO_RULES itself only for a missing optional file.
if (rules === NO_RULES)
  app.log.info(`project file ${config.projectFile.path} not found; signals show their full names`);
if (!loopback)
  app.log.warn(
    `LETSVIEW_HOST ${config.host} is not loopback: every machine that reaches it can read signals and change the workspace` +
      (wildcard ? "; only loopback names pass the Host check" : ""),
  );

await app.listen({ host: config.host, port: config.port });
// Retries in the background until the source answers once (design H5).
keepCatalogLoaded(catalog, {
  loaded() {
    app.log.info({ signals: catalog.size }, "catalog loaded");
    warnDisplayFallbacks(app.log, catalog);
  },
  failed(error, retryInMs) {
    app.log.error({ error: String(error), retryInMs }, "catalog not loaded; retrying");
  },
});
