import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { attributionText, type Measurement, scopeKey } from "@kipscope/shared";
import { isLoopbackHost } from "./access.ts";
import { buildApp } from "./app.ts";
import { Catalog, keepCatalogLoaded, warnDisplayFallbacks } from "./catalog.ts";
import { loadConfig, REPO_ROOT } from "./config.ts";
import type { Scope } from "./datasource.ts";
import { loadDbcFiles } from "./dbc.ts";
import { loadDiagCatalogs } from "./diag.ts";
import { completeSource, nativeMethods } from "./fallbacks.ts";
import { readBuildInfo } from "./meta.ts";
import { NO_RULES } from "./names.ts";
import { loadState, STATE_FILE, StatePersister } from "./persist.ts";
import { loadProject, ProjectFileError } from "./project.ts";
import { QueryQueue, queuedAdapter } from "./queue.ts";
import { CatalogStore, guardScoped } from "./scope.ts";
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
const completed = completeSource(queuedAdapter(adapter, new QueryQueue(config.queryConcurrency)));
// Scoped mode (add-scope Z10): a data call without a scope, or a range outside every held scope,
// is refused before the queue and logged once per method as a bug.
const source =
  config.catalogMode === "scoped"
    ? guardScoped(completed, () => catalogs.scopes(), {
        error: (message) => app.log.error(message),
      })
    : completed;

const WILDCARD_HOSTS = new Set(["0.0.0.0", "::", "[::]"]);
const loopback = isLoopbackHost(config.host);
const wildcard = WILDCARD_HOSTS.has(config.host);
// A configured LAN address is the one other name the Host check admits (design H3).
const extraHost = loopback || wildcard ? undefined : config.host;

// Default metadata paths that don't exist are skipped with one info line; set paths still warn per load (issue #1).
const skippedDefaults: string[] = [];
const metadataPaths = (key: string, paths: string[]): string[] => {
  if (process.env[key]) return paths;
  const present = paths.filter((path) => existsSync(path));
  skippedDefaults.push(...paths.filter((path) => !present.includes(path)));
  return present;
};
const dbcFiles = metadataPaths("KIPSCOPE_DBC_FILES", config.dbcFiles);
const diagCatalogs = metadataPaths("KIPSCOPE_DIAG_CATALOGS", config.diagCatalogs);

// The full catalog, or with a scope that scope's signal list, each with the same metadata.
const newCatalog = (scope?: Scope) =>
  new Catalog(
    source,
    (warn) => loadDbcFiles(dbcFiles, (path, error) => warn(`${path}: ${error}`)),
    rules,
    { warn: (message) => app.log.warn(message) },
    (warn) => loadDiagCatalogs(diagCatalogs, warn),
    scope,
  );
// In scoped mode this catalog never loads: there is no start-up list (add-scope Z10).
const catalog = newCatalog();
const catalogs = new CatalogStore({
  mode: config.catalogMode,
  full: catalog,
  create: newCatalog,
  // The workspace's scope list stays held however many other scopes load (design Z10).
  keep: () => workspace.workspace.scope,
});
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
const deps = {
  catalog,
  catalogs,
  scopePad: config.scopePad,
  source,
  workspace,
  meta: {
    build,
    // Labels only: URLs, users, passwords and tokens stay in the adapter.
    source: source.info,
    // Outside the query queue, so a busy queue does not read as an unreachable source.
    // Aborted on the 2 s timeout, so a hung tunnel does not hold a socket per poll.
    ping: (signal: AbortSignal) => source.ping(signal),
  },
  ...(licenseText === undefined ? {} : { licenseText }),
  views,
};
const app = buildApp(
  deps,
  extraHost === undefined ? { logger: true } : { logger: true, extraHost },
);
// loadProjectFile returns NO_RULES itself only for a missing optional file.
if (rules === NO_RULES)
  app.log.info(`project file ${config.projectFile.path} not found; signals show their full names`);
if (licenseMissing) app.log.warn("LICENSE not found; /api/license answers 404");
if (skippedDefaults.length > 0)
  app.log.info(`default metadata files not found, skipped: ${skippedDefaults.join(", ")}`);
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
app.log.info(`catalog mode ${config.catalogMode}`);
app.log.info(
  `source ${source.info.kind} ${source.info.database}: native ${nativeMethods(adapter).join(", ") || "none"}`,
);
catalogs.onLoaded((scope, loaded) => {
  app.log.info({ signals: loaded.size, scope: scopeKey(scope) }, "scope catalog loaded");
  warnDisplayFallbacks(app.log, loaded);
});
await app.listen({ host: config.host, port: config.port });
// Retries in the background until the source answers once (design H5); full mode only.
const full = catalogs.full;
if (full)
  keepCatalogLoaded(full, {
    loaded() {
      app.log.info({ signals: full.size }, "catalog loaded");
      warnDisplayFallbacks(app.log, full);
    },
    failed(error, retryInMs) {
      app.log.error({ error: String(error), retryInMs }, "catalog not loaded; retrying");
    },
  });
// A restored scope's list is kept loaded the same way, in both modes (signal-catalog H5).
const restored = workspace.workspace.scope;
if (restored)
  keepCatalogLoaded(catalogs.entry(restored), {
    loaded() {},
    failed(error, retryInMs) {
      app.log.error(
        { error: String(error), retryInMs, scope: scopeKey(restored) },
        "scope catalog not loaded; retrying",
      );
    },
  });
