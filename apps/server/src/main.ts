import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { attributionText, type Measurement } from "@kipscope/shared";
import { isLoopbackHost } from "./access.ts";
import { buildApp } from "./app.ts";
import { Catalog, keepCatalogLoaded, warnDisplayFallbacks } from "./catalog.ts";
import { ClickHouseSource, createClickHouseClient } from "./clickhouse.ts";
import { loadConfig, REPO_ROOT } from "./config.ts";
import { loadDbcFiles } from "./dbc.ts";
import { loadDiagCatalogs } from "./diag.ts";
import { readBuildInfo } from "./meta.ts";
import { NO_RULES } from "./names.ts";
import { loadProject, ProjectFileError } from "./project.ts";
import { QueryQueue, queuedSource } from "./queue.ts";
import { WorkspaceStore } from "./workspace.ts";

const config = loadConfig();
const build = readBuildInfo(REPO_ROOT);

// Before listen: an invalid project file stops the server (design N6).
let rules = NO_RULES;
let measurement: Measurement | undefined;
let eventSignals: string[] = [];
try {
  let events: { signals: string[] } | undefined;
  ({ rules, measurement, events } = loadProject(config.projectFile));
  eventSignals = events?.signals ?? [];
} catch (error) {
  if (!(error instanceof ProjectFileError)) throw error;
  process.stderr.write(`kipscope: invalid project file\n${error.message}\n`);
  process.exit(1);
}

let licenseText: string | undefined;
let licenseMissing = false;
try {
  licenseText = readFileSync(resolve(REPO_ROOT, "LICENSE"), "utf8");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  licenseMissing = true;
}

const client = createClickHouseClient(config.clickhouse);
const source = queuedSource(
  new ClickHouseSource(client, config.mapping, config.queryTimeoutSeconds),
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
  (warn) => loadDiagCatalogs(config.diagCatalogs, warn),
);
const workspace = new WorkspaceStore(
  {
    signalExists: (id) => catalog.get(id) !== undefined,
    unitOf: (id) => catalog.get(id)?.unit,
    hasStates: (id) => catalog.get(id)?.states !== undefined,
  },
  {
    onListenerError: (error) => app.log.error({ error: String(error) }, "live listener failed"),
    ...(measurement ? { measurement } : {}),
    eventSignals,
  },
);
const app = buildApp(
  {
    catalog,
    source,
    workspace,
    meta: {
      build,
      // Labels only: the URL, user and password stay in the client config.
      source: {
        kind: "clickhouse",
        database: config.mapping.database,
        table: config.mapping.table,
      },
      // Outside the query queue, so a busy queue does not read as an unreachable source.
      // Aborted on the 2 s timeout, so a hung tunnel does not hold a socket per poll.
      ping: async (signal) => {
        const result = await client.ping({ select: false, abort_signal: signal });
        if (!result.success) throw result.error;
      },
    },
    ...(licenseText === undefined ? {} : { licenseText }),
  },
  extraHost === undefined ? { logger: true } : { logger: true, extraHost },
);
// loadProjectFile returns NO_RULES itself only for a missing optional file.
if (rules === NO_RULES)
  app.log.info(`project file ${config.projectFile.path} not found; signals show their full names`);
if (licenseMissing) app.log.warn("LICENSE not found; /api/license answers 404");
if (!loopback)
  app.log.warn(
    `KIPSCOPE_HOST ${config.host} is not loopback: every machine that reaches it can read signals and change the workspace` +
      (wildcard ? "; only loopback names pass the Host check" : ""),
  );

app.log.info(attributionText());
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
