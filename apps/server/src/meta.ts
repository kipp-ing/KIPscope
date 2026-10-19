import { execFileSync } from "node:child_process";
import type { CatalogState, ServerMeta } from "@kipscope/shared";
import type { FastifyPluginAsync } from "fastify";
import type { Catalog } from "./catalog.ts";
import type { SourceInfo } from "./datasource.ts";
import { apiError, userOf } from "./http.ts";
import { type CatalogView, catalogView, type Rights } from "./rights.ts";
import { type CatalogStore, scopeOf } from "./scope.ts";

/** The repo's commit when the server started (design F2). */
export interface BuildInfo {
  commit: string | null;
  dirty: boolean;
  startedAt: Date;
}

/** Runs git with `args`; returns stdout, throws on failure. */
export type GitRunner = (args: readonly string[]) => string;

/** Short commit and whether tracked files had uncommitted changes; any failure gives `{commit: null, dirty: false}`. */
export function readBuildInfo(root: string, run?: GitRunner, now: Date = new Date()): BuildInfo {
  const git: GitRunner =
    run ??
    ((args) =>
      execFileSync("git", args, {
        cwd: root,
        timeout: 2000,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }));
  try {
    const commit = git(["rev-parse", "--short=7", "HEAD"]).trim();
    const dirty = git(["status", "--porcelain", "--untracked-files=no"]).trim() !== "";
    return { commit: commit || null, dirty, startedAt: now };
  } catch {
    return { commit: null, dirty: false, startedAt: now };
  }
}

export const PING_TIMEOUT_MS = 2000;

export interface MetaDeps {
  build: BuildInfo;
  /** Labels only; the source URL and credentials never enter here. */
  source: Pick<SourceInfo, "kind" | "database" | "table">;
  /** Resolves when the source answers; rejects with the reason. Must not use the query queue.
   *  `signal` aborts on the timeout, so a hung source does not keep the request (and its socket) open. */
  ping: (signal: AbortSignal) => Promise<void>;
}

type PingResult = Pick<ServerMeta["source"], "reachable" | "checkedAt" | "error">;

/** Non-empty message without URL credentials (`//user:pass@` → `//`). */
function pingError(error: unknown): string {
  const message = error instanceof Error ? error.message || error.name : String(error);
  return (message || "unknown error").replace(/\/\/[^/@\s]*@/g, "//");
}

/** One ping raced against PING_TIMEOUT_MS, aborted when the time is up; never rejects. */
async function pingOnce(ping: MetaDeps["ping"]): Promise<PingResult> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`no answer within ${PING_TIMEOUT_MS / 1000} s`));
      controller.abort();
    }, PING_TIMEOUT_MS);
  });
  try {
    // The race still ends at the timeout when a ping ignores the signal.
    await Promise.race([ping(controller.signal), timeout]);
    return { reachable: true, checkedAt: new Date().toISOString() };
  } catch (error) {
    return { reachable: false, checkedAt: new Date().toISOString(), error: pingError(error) };
  } finally {
    clearTimeout(timer);
  }
}

type CatalogStatus = Omit<ServerMeta["catalog"], "mode" | "scope">;

function catalogStatus(catalog: CatalogView): CatalogStatus {
  if (catalog.loadedAt)
    return { state: "loaded", size: catalog.size, loadedAt: catalog.loadedAt.toISOString() };
  const state: CatalogState = catalog.lastError !== undefined ? "failed" : "loading";
  return { state, size: catalog.size, reason: catalog.unavailableReason };
}

/**
 * The catalog the session uses (add-scope Z5, Z10) as the requester sees it (add-multiuser M9):
 * with a scope that scope's list, else the full catalog in full mode and `no_scope` in scoped
 * mode. Without a store: full mode.
 */
function catalogMeta(
  catalogs: CatalogStore | undefined,
  full: Catalog,
  scope: ServerMeta["catalog"]["scope"],
  rights: Rights,
): ServerMeta["catalog"] {
  const mode = catalogs?.mode ?? "full";
  if (!scope) {
    if (mode === "scoped") return { mode, state: "no_scope", size: 0 };
    return { mode, ...catalogStatus(catalogView(catalogs?.full ?? full, rights)) };
  }
  const held = catalogs?.get(scope);
  const catalog = held && catalogView(held, rights);
  const status: CatalogStatus = catalog
    ? catalogStatus(catalog)
    : {
        state: "loading",
        size: 0,
        reason: "still loading: the scope's signal list has not loaded",
      };
  return { mode, ...status, scope };
}

/**
 * `GET /api/meta` (build, source reachability, the session's catalog state) and `GET /api/license`
 * (design F2, F4; add-multiuser M6, M9).
 */
export function metaRoutes(deps: {
  meta?: MetaDeps;
  catalog: Catalog;
  /** Catalog mode and scope lists (add-scope Z10); absent: full mode with `catalog`. */
  catalogs?: CatalogStore;
  licenseText?: string;
}): FastifyPluginAsync {
  const { meta, catalog, catalogs, licenseText } = deps;
  /** The ping in progress; concurrent requests share it (single flight), no cache beyond it. */
  let running: Promise<PingResult> | undefined;
  const check = (ping: MetaDeps["ping"]) => {
    running ??= pingOnce(ping).finally(() => {
      running = undefined;
    });
    return running;
  };

  return async (app) => {
    app.get("/api/meta", { config: { access: { level: "session" } } }, async (request, reply) => {
      if (!meta) return apiError(reply, 404, "not_configured", "server meta not configured");
      const ping = await check(meta.ping);
      const body: ServerMeta = {
        build: {
          commit: meta.build.commit,
          dirty: meta.build.dirty,
          startedAt: meta.build.startedAt.toISOString(),
        },
        source: {
          kind: meta.source.kind,
          database: meta.source.database,
          table: meta.source.table,
          ...ping,
        },
        catalog: catalogMeta(catalogs, catalog, scopeOf(request), userOf(request).rights),
      };
      return body;
    });

    app.get(
      "/api/license",
      { config: { access: { level: "public" } } },
      async (_request, reply) => {
        if (licenseText === undefined)
          return apiError(reply, 404, "license_missing", "LICENSE not found at server start");
        return reply.type("text/plain; charset=utf-8").send(licenseText);
      },
    );
  };
}
