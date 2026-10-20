import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  attributionText,
  EMPTY_WORKSPACE,
  type Grant,
  type Measurement,
  scopeKey,
  type Workspace,
} from "@kipscope/shared";
import { accessLog, isLoopbackHost } from "./access.ts";
import { buildApp } from "./app.ts";
import { Catalog, keepCatalogLoaded, warnDisplayFallbacks } from "./catalog.ts";
import { loadConfig, REPO_ROOT } from "./config.ts";
import type { Scope } from "./datasource.ts";
import { loadDbcFiles } from "./dbc.ts";
import { loadDiagCatalogs } from "./diag.ts";
import { completeSource, nativeMethods } from "./fallbacks.ts";
import { type IdentityAdapter, type IdentityLog, loadIdentity } from "./identity.ts";
import { readBuildInfo } from "./meta.ts";
import { NO_RULES } from "./names.ts";
import { loadProject, ProjectFileError } from "./project.ts";
import { QueryQueue, queuedAdapter } from "./queue.ts";
import { CatalogStore, guardScoped, openScopes } from "./scope.ts";
import { createAdapter } from "./sources.ts";
import { userViews } from "./views.ts";
import { seedFor, WorkspaceRegistry } from "./workspaces.ts";

const config = loadConfig();
const build = readBuildInfo(REPO_ROOT);

// Log lines from before the logger exists (an adapter's factory, the registry's start) wait
// for it; later ones go straight to it.
const early: { level: "info" | "warn" | "debug"; message: string }[] = [];
let ready: IdentityLog | undefined;
const log: Required<IdentityLog> = {
  info: (message) => (ready ? ready.info(message) : early.push({ level: "info", message })),
  warn: (message) => (ready ? ready.warn(message) : early.push({ level: "warn", message })),
  debug: (message) => (ready ? ready.debug?.(message) : early.push({ level: "debug", message })),
};

// Before listen: the identity adapter, or `none` (add-multiuser M1). A bad adapter stops the
// server naming the variable and the reason. What a workspace may read is its grant (M3).
let identity: IdentityAdapter | undefined;
try {
  identity = await loadIdentity(config.identity, { log });
} catch (error) {
  process.stderr.write(`kipscope: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

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
// Every workspace, each in `<stateDir>/workspaces/<id>.json` (add-multiuser M4). A new one starts
// from the project file's measurement and the events-line signals its grant covers; `start()` first
// migrates the state of earlier rounds (M4 "Migration") and logs each step.
const seed = (grant: Grant): Workspace =>
  seedFor(
    {
      ...EMPTY_WORKSPACE,
      ...(measurement ? { measurement } : {}),
      ...(eventSignals.length > 0 ? { eventSignals: [...eventSignals] } : {}),
    },
    grant,
  );
const workspaces = new WorkspaceRegistry({
  dir: config.stateDir,
  seed,
  identity: config.identity.kind,
  idleDays: config.workspaceIdleDays,
  log,
});
workspaces.start();
const catalogs = new CatalogStore({
  mode: config.catalogMode,
  full: catalog,
  create: newCatalog,
  // The lists of workspaces with a live client stay held however many other scopes load (M9).
  keep: () => openScopes(workspaces),
});
const deps = {
  catalog,
  catalogs,
  scopePad: config.scopePad,
  source,
  workspaces,
  // Each user's saved views in `<stateDir>/users/<user>/views/` (add-multiuser M9).
  viewsOf: userViews(config.stateDir),
  ...(identity ? { identity } : {}),
  share: config.share,
  ...(config.webDir === undefined ? {} : { webDir: config.webDir }),
  meta: {
    build,
    // Labels only: URLs, users, passwords and tokens stay in the adapter.
    source: source.info,
    // Outside the query queue, so a busy queue does not read as an unreachable source.
    // Aborted on the 2 s timeout, so a hung tunnel does not hold a socket per poll.
    ping: (signal: AbortSignal) => source.ping(signal),
  },
  ...(licenseText === undefined ? {} : { licenseText }),
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
// Identity, sharing and origins, or the loopback warning of `none` (add-multiuser M10).
for (const line of accessLog(config)) app.log[line.level](line.message);

ready = {
  info: (message) => app.log.info(message),
  warn: (message) => app.log.warn(message),
  debug: (message) => app.log.debug(message),
};
for (const { level, message } of early.splice(0)) app.log[level](message);

/** How long shutdown waits for the adapter to close. */
const CLOSE_ADAPTER_MS = 2_000;
// node --watch restarts with SIGTERM: write every workspace's last changes, close the adapter, then
// exit as the signal would.
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    workspaces.stop();
    const closing = identity?.close?.().catch(() => {}) ?? Promise.resolve();
    const timeout = new Promise((done) => setTimeout(done, CLOSE_ADAPTER_MS).unref());
    void Promise.race([closing, timeout]).finally(() => process.kill(process.pid, signal));
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
// No scope list loads at start: a workspace's loads when a live client connects (add-multiuser M9).
