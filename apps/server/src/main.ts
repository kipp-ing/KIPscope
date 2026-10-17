import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { attributionText, type Measurement } from "@kipscope/shared";
import { isLoopbackHost } from "./access.ts";
import { buildApp } from "./app.ts";
import { Catalog, keepCatalogLoaded, warnDisplayFallbacks } from "./catalog.ts";
import { loadConfig, REPO_ROOT } from "./config.ts";
import { loadDbcFiles } from "./dbc.ts";
import { loadDiagCatalogs } from "./diag.ts";
import { completeSource, nativeMethods } from "./fallbacks.ts";
import { readBuildInfo } from "./meta.ts";
import { NO_RULES } from "./names.ts";
import { loadState, STATE_FILE, StatePersister } from "./persist.ts";
import { loadProject, ProjectFileError } from "./project.ts";
import { QueryQueue, queuedAdapter } from "./queue.ts";
import { createAdapter } from "./sources.ts";
import { ViewStore } from "./views.ts";
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

// Fallbacks outside the queue: each inner query of a fallback takes its own slot (design C3).
const adapter = createAdapter(config);
const source = completeSource(queuedAdapter(adapter, new QueryQueue(config.queryConcurrency)));

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
// Views and the state file (design V4, V5); the warnings wait for the logger.
const views = new ViewStore(join(config.stateDir, "views"));
const statePath = join(config.stateDir, STATE_FILE);
const restoreWarnings: string[] = [];
const initial = loadState(statePath, (message) => restoreWarnings.push(message));
const workspace = new WorkspaceStore(
  {
    signalExists: (id) => catalog.get(id) !== undefined,
    unitOf: (id) => catalog.get(id)?.unit,
    hasStates: (id) => catalog.get(id)?.states !== undefined,
    catalogReady: () => catalog.loadedAt !== undefined,
  },
  {
    onListenerError: (error) => app.log.error({ error: String(error) }, "live listener failed"),
    // A restored workspace is used whole; the project file seeds only a fresh one (V4, S-3 (b)).
    ...(initial ? { initial } : { ...(measurement ? { measurement } : {}), eventSignals }),
    beforeOpen: (previous) => views.beforeOpen(previous),
  },
);
const app = buildApp(
  {
    catalog,
    source,
    workspace,
    meta: {
      build,
      // Labels only: URLs, users, passwords and tokens stay in the adapter.
      source: source.info,
      // Outside the query queue, so a busy queue does not read as an unreachable source.
      // Aborted on the 2 s timeout, so a hung tunnel does not hold a socket per poll.
      ping: (signal) => source.ping(signal),
    },
    ...(licenseText === undefined ? {} : { licenseText }),
    views,
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

for (const message of restoreWarnings) app.log.warn(message);
if (initial) app.log.info({ revision: initial.revision }, `workspace restored from ${statePath}`);
const persister = new StatePersister(statePath, { warn: (message) => app.log.warn(message) });
persister.subscribe(workspace);
// node --watch restarts with SIGTERM: write the last changes, then exit as the signal would.
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    persister.flush();
    process.kill(process.pid, signal);
  });

app.log.info(attributionText());
app.log.info(
  `source ${source.info.kind} ${source.info.database}: native ${nativeMethods(adapter).join(", ") || "none"}`,
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
