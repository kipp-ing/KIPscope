import type { ApiError, CommandResult, Workspace, WorkspaceScope } from "@kipscope/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { Catalog } from "./catalog.ts";
import type { DataSource, Scope } from "./datasource.ts";
import { CatalogStore, scopeOf, sourceScope } from "./scope.ts";

export function apiError(
  reply: FastifyReply,
  status: number,
  code: string,
  message: string,
  extra: Omit<ApiError["error"], "code" | "message"> = {},
) {
  const body: ApiError = { error: { code, message, ...extra } };
  return reply.code(status).send(body);
}

/** Parses request input with a Zod schema; on failure sends 400 and returns undefined. */
export function parseInput<T extends z.ZodType>(
  schema: T,
  input: unknown,
  reply: FastifyReply,
): z.infer<T> | undefined {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const message = result.error.issues
    .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
    .join("; ");
  apiError(reply, 400, "invalid_request", message);
  return undefined;
}

/** What the scope-aware routes need of the app's deps (add-scope Z10). */
export interface ScopeDeps {
  /** Full catalog; in scoped mode one that never loads. */
  catalog: Catalog;
  /** Source for series queries; in production wrapped by the query queue. */
  source: DataSource;
  workspace: { readonly workspace: Workspace };
  /** The signal lists (add-scope Z10); without it a full-mode store over `catalog` (tests). */
  catalogs?: CatalogStore;
  /** `KIPSCOPE_SCOPE_PAD` in ns; default config's DEFAULT_SCOPE_PAD. */
  scopePad?: bigint;
}

const defaultStores = new WeakMap<object, CatalogStore>();

/**
 * The deps' catalog store, one per deps object: `deps.catalogs`, else a full-mode store over
 * `deps.catalog` whose scope catalogs carry no DBC or diag metadata.
 */
export function catalogsOf(deps: ScopeDeps): CatalogStore {
  if (deps.catalogs) return deps.catalogs;
  let store = defaultStores.get(deps);
  if (!store) {
    store = new CatalogStore({
      mode: "full",
      full: deps.catalog,
      create: (scope) =>
        new Catalog(deps.source, async () => new Map(), undefined, undefined, undefined, scope),
      keep: () => deps.workspace.workspace.scope,
    });
    defaultStores.set(deps, store);
  }
  return store;
}

const prefetchChains = new WeakMap<object, Promise<void>>();

/**
 * Runs `job` after every job queued before for the same deps, so a scope's density, gap info and
 * events prefetches run one after another (add-scope Z9); a failing job does not stop the chain.
 */
export function chainPrefetch(deps: ScopeDeps, job: () => Promise<unknown>): void {
  const next = (prefetchChains.get(deps) ?? Promise.resolve()).then(job).then(
    () => {},
    () => {},
  );
  prefetchChains.set(deps, next);
}

/** What a route reads within (add-scope Z10). */
export interface RouteScope {
  /** The workspace's scope; undefined in full mode without one. */
  scope?: WorkspaceScope;
  /** Its source form. */
  source?: Scope;
  /** The scope's signal list (loaded or not), else the full catalog. */
  catalog: Catalog | undefined;
}

/**
 * The scope of the workspace a request serves and its signal list (add-scope Z10). In scoped mode
 * without a scope it answers 409 `scope_required` and returns undefined. A scope's list that is
 * not loaded starts loading, so the caller's 503 `catalog_unavailable` lasts only until it has.
 */
export function routeScope(
  deps: ScopeDeps,
  request: FastifyRequest,
  reply: FastifyReply,
): RouteScope | undefined {
  const catalogs = catalogsOf(deps);
  const scope = scopeOf(request, deps.workspace);
  if (!scope) {
    if (catalogs.mode === "scoped") {
      scopeRequired(reply);
      return undefined;
    }
    return { catalog: catalogs.full ?? deps.catalog };
  }
  if (!catalogs.get(scope)?.loadedAt) catalogs.load(scope).catch(() => {});
  return { scope, source: sourceScope(scope), catalog: catalogs.get(scope) };
}

/** 409 of a route in scoped mode without a scope (add-scope Z10). */
export function scopeRequired(reply: FastifyReply) {
  return apiError(
    reply,
    409,
    "scope_required",
    "set a scope first: no source query runs without one",
  );
}

/** 409 of a route asked for data outside the workspace's scope (add-scope Z10). */
export function outOfScope(
  reply: FastifyReply,
  message: string,
  extra: Omit<ApiError["error"], "code" | "message"> = {},
) {
  return apiError(reply, 409, "out_of_scope", message, extra);
}

/**
 * HTTP status of a command result: 400 invalid command, 503 catalog not loaded, else 422
 * (`scope_required` and `out_of_scope` included, add-scope Z10).
 */
export function commandStatus(result: CommandResult): number {
  if (result.ok) return 200;
  if (result.code === "invalid_command") return 400;
  if (result.code === "catalog_unavailable") return 503;
  return 422;
}
