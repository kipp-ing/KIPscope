import { execFileSync } from "node:child_process";
import type { CatalogState, ServerMeta } from "@kipscope/shared";
import type { FastifyPluginAsync } from "fastify";
import type { Catalog } from "./catalog.ts";
import { apiError } from "./http.ts";

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
  source: { kind: "clickhouse"; database: string; table: string };
  /** Resolves when the source answers; rejects with the reason. Must not use the query queue. */
  ping: () => Promise<void>;
}

type PingResult = Pick<ServerMeta["source"], "reachable" | "checkedAt" | "error">;

/** Non-empty message without URL credentials (`//user:pass@` → `//`). */
function pingError(error: unknown): string {
  const message = error instanceof Error ? error.message || error.name : String(error);
  return (message || "unknown error").replace(/\/\/[^/@\s]*@/g, "//");
}

/** One ping raced against PING_TIMEOUT_MS; never rejects. */
async function pingOnce(ping: () => Promise<void>): Promise<PingResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`no answer within ${PING_TIMEOUT_MS / 1000} s`)),
      PING_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([ping(), timeout]);
    return { reachable: true, checkedAt: new Date().toISOString() };
  } catch (error) {
    return { reachable: false, checkedAt: new Date().toISOString(), error: pingError(error) };
  } finally {
    clearTimeout(timer);
  }
}

function catalogMeta(catalog: Catalog): ServerMeta["catalog"] {
  if (catalog.loadedAt)
    return { state: "loaded", size: catalog.size, loadedAt: catalog.loadedAt.toISOString() };
  const state: CatalogState = catalog.lastError !== undefined ? "failed" : "loading";
  return { state, size: catalog.size, reason: catalog.unavailableReason };
}

/** `GET /api/meta` (build, source reachability, catalog state) and `GET /api/license` (design F2, F4). */
export function metaRoutes(deps: {
  meta?: MetaDeps;
  catalog: Catalog;
  licenseText?: string;
}): FastifyPluginAsync {
  const { meta, catalog, licenseText } = deps;
  /** The ping in progress; concurrent requests share it (single flight), no cache beyond it. */
  let running: Promise<PingResult> | undefined;
  const check = (ping: () => Promise<void>) => {
    running ??= pingOnce(ping).finally(() => {
      running = undefined;
    });
    return running;
  };

  return async (app) => {
    app.get("/api/meta", async (_request, reply) => {
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
        catalog: catalogMeta(catalog),
      };
      return body;
    });

    app.get("/api/license", async (_request, reply) => {
      if (licenseText === undefined)
        return apiError(reply, 404, "license_missing", "LICENSE not found at server start");
      return reply.type("text/plain; charset=utf-8").send(licenseText);
    });
  };
}
