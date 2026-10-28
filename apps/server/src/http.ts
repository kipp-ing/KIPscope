import type { IncomingMessage } from "node:http";
import {
  type ApiError,
  type CaseCatalog,
  type CaseEntry,
  CLASS_HEADER,
  type CommandResult,
  caseScope,
  type Grant,
  WORKSPACE_ID,
  type WorkspaceScope,
} from "@kipscope/shared";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { Catalog } from "./catalog.ts";
import type { DataSource, Scope } from "./datasource.ts";
import type { CacheScope } from "./density.ts";
import { type RequestUser, requestGrant, requestUser, requestWorkspace } from "./guard.ts";
import { currentPriority, lowerClass, withPriority } from "./priority.ts";
import { type CatalogView, catalogView } from "./rights.ts";
import type { ScanBound, TooWideError } from "./scanBound.ts";
import { CatalogStore, openScopes, scopeOf, sourceScope } from "./scope.ts";
import type { WorkspaceEntry, Workspaces } from "./workspaces.ts";

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

/**
 * 422 `too_wide` of a range the scan bound refused (scope "Too wide answers"): `rows` and `limit`,
 * or `span` and `maxSpan`, as decimal strings.
 */
export function tooWide(reply: FastifyReply, error: TooWideError): FastifyReply {
  const extra: Omit<ApiError["error"], "code" | "message"> = {};
  if (error.rows !== undefined) extra.rows = String(error.rows);
  if (error.limit !== undefined) extra.limit = String(error.limit);
  if (error.span !== undefined) extra.span = String(error.span);
  if (error.maxSpan !== undefined) extra.maxSpan = String(error.maxSpan);
  return apiError(reply, 422, "too_wide", error.message, extra);
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
  /** Every workspace (add-multiuser M4); routes reach the request's one through `workspaceOf`. */
  workspaces: Workspaces;
  /** The scan bound over `source` (speed-up-whole-scans B2), shared by every check. */
  bound: ScanBound;
  /** The signal lists (add-scope Z10); without it a full-mode store over `catalog` (tests). */
  catalogs?: CatalogStore;
  /** `KIPSCOPE_SCOPE_PAD` in ns; default config's DEFAULT_SCOPE_PAD. */
  scopePad?: bigint;
  /**
   * The open catalog of a workspace by its ID (add-case-open K9, K10), for `case=N` on
   * `/api/series` and `/api/extent`; without it only the current entry (`workspace.case.entry`)
   * is known.
   */
  caseCatalog?: (workspaceId: string) => CaseCatalog | undefined;
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
      keep: () => openScopes(deps.workspaces),
      bound: deps.bound,
    });
    defaultStores.set(deps, store);
  }
  return store;
}

const changedWorkspaces = new WeakMap<object, Map<string, WorkspaceEntry>>();

/**
 * The workspaces a queued scope prefetch is judged by when it runs (add-case-open K11): those with
 * a live client and those a change touched since the first call, one per ID (a deleted one gone).
 * Call it when the routes register, so every later change is seen.
 */
export function scopeHolders(deps: ScopeDeps): () => WorkspaceEntry[] {
  let changed = changedWorkspaces.get(deps);
  if (!changed) {
    const map = new Map<string, WorkspaceEntry>();
    deps.workspaces.onChange((event) => {
      if (event.type === "delete") map.delete(event.entry.record.id);
      else map.set(event.entry.record.id, event.entry);
    });
    changedWorkspaces.set(deps, map);
    changed = map;
  }
  const seen = changed;
  return () => {
    const all = new Map(seen);
    for (const entry of deps.workspaces.open()) all.set(entry.record.id, entry);
    return [...all.values()];
  };
}

const prefetchChains = new WeakMap<object, Promise<void>>();

/**
 * Runs `job` after every job queued before for the same deps, so a scope's density, gap info and
 * events prefetches run one after another (add-scope Z9); a failing job does not stop the chain.
 * The job runs as `background`, or lower when the work that queued it ran lower: a preview's load
 * keeps its prefetch in `preload` (D-081, add-case-open K10).
 */
export function chainPrefetch(deps: ScopeDeps, job: () => Promise<unknown>): void {
  const cls = lowerClass("background", currentPriority().cls);
  const run = () => withPriority(cls, job);
  const next = (prefetchChains.get(deps) ?? Promise.resolve()).then(run).then(
    () => {},
    () => {},
  );
  prefetchChains.set(deps, next);
}

/** Workspace IDs of `/api/w/<id>/…` requests, recorded by `rewriteUrl` (add-multiuser M5). */
const prefixes = new WeakMap<IncomingMessage, string>();
const PREFIX = /^\/api\/w\/([^/?]*)(?=[/?]|$)/;

/**
 * Fastify's `rewriteUrl` (add-multiuser M5): `/api/w/<id>/<rest>` → `/api/<rest>` when `<id>`
 * matches WORKSPACE_ID, recording `<id>` on the raw request. Any other URL stays as it is, so the
 * address of round 1 (`/api/s/<id>/…`) is an unknown route.
 */
export function rewriteUrl(raw: IncomingMessage): string {
  const url = raw.url ?? "/";
  const match = PREFIX.exec(url);
  const id = match?.[1];
  if (match === null || id === undefined || !WORKSPACE_ID.test(id)) return url;
  prefixes.set(raw, id);
  const rest = url.slice(match[0].length);
  return rest.startsWith("/") ? `/api${rest}` : `/api/${rest}`;
}

/** The workspace ID of the request's `/api/w/<id>/` prefix, if it had one. */
export function workspacePrefixOf(request: FastifyRequest): string | undefined {
  return prefixes.get(request.raw);
}

/** The user of a guarded request (add-multiuser M5), set by the guard's onRequest. */
export function userOf(request: FastifyRequest): RequestUser {
  const user = requestUser(request);
  // A route that reads the user without the guard having set one is a server bug: fail closed.
  if (!user) throw new Error(`no user for ${request.method} ${request.url}`);
  return user;
}

/** The workspace a `workspace` or `change` route serves (add-multiuser M5), set by the guard's preHandler. */
export function workspaceOf(request: FastifyRequest): WorkspaceEntry {
  const admitted = requestWorkspace<WorkspaceEntry>(request);
  // A route that reads a workspace the guard did not admit is a server bug: fail closed.
  if (!admitted) throw new Error(`no workspace for ${request.method} ${request.url}`);
  return admitted.entry;
}

/**
 * The grant the guard checked the request against (add-multiuser M3, M5): the served workspace's
 * effective grant, or on a `user` route the initial grant a new workspace gets.
 */
export function grantOf(request: FastifyRequest): Grant {
  const grant = requestGrant(request);
  if (!grant) throw new Error(`no grant for ${request.method} ${request.url}`);
  return grant;
}

/** What a route reads within (add-scope Z10). */
export interface RouteScope {
  /** The workspace's scope; undefined in full mode without one. */
  scope?: WorkspaceScope;
  /** Its source form. */
  source?: Scope;
  /**
   * The scope's signal list (loaded or not), else the full catalog, as the workspace's grant
   * shows it (add-multiuser M6).
   */
  catalog: CatalogView | undefined;
}

/**
 * The scope of the workspace a request serves and its signal list, filtered by the workspace's
 * grant (add-scope Z10, add-multiuser M6). In scoped mode without a scope it answers 409
 * `scope_required` and returns undefined, unless the route gives `ownWindow`: that window is then
 * the source scope, with no workspace scope and no signal list (speed-up-whole-scans B10). A
 * scope's list that is not loaded starts loading, so the caller's 503 `catalog_unavailable` lasts
 * only until it has.
 */
export function routeScope(
  deps: ScopeDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  opts: { ownWindow?: Scope } = {},
): RouteScope | undefined {
  const catalogs = catalogsOf(deps);
  const grant = grantOf(request);
  const view = (catalog: Catalog | undefined) => catalog && catalogView(catalog, grant);
  const scope = scopeOf(request);
  if (!scope) {
    if (catalogs.mode === "scoped") {
      if (opts.ownWindow) return { source: opts.ownWindow, catalog: undefined };
      scopeRequired(reply);
      return undefined;
    }
    return { catalog: view(catalogs.full ?? deps.catalog) };
  }
  if (!catalogs.get(scope)?.loadedAt) catalogs.load(scope).catch(() => {});
  return { scope, source: sourceScope(scope), catalog: view(catalogs.get(scope)) };
}

/** The cache form of a workspace scope: the source form plus the object flag (add-case-open K11). */
export function cacheScopeOf(scope: WorkspaceScope): CacheScope {
  const s: CacheScope = sourceScope(scope);
  if (scope.object) s.object = true;
  return s;
}

/**
 * The query class a request asks for with `X-KIPscope-Class` (add-case-open K10): `preload` for
 * that value only; any other value leaves the request `interactive`.
 */
export function requestClass(request: FastifyRequest): "preload" | undefined {
  return request.headers[CLASS_HEADER] === "preload" ? "preload" : undefined;
}

/**
 * Runs a route's source work in the request's class (K10): under `withPriority("preload")` when
 * it asked for `preload`, else as today. Only `/api/series`, `/api/extent`, `/api/calendar` and
 * `/api/case/preview` call it, so the header on another route is ignored.
 */
export function withRequestClass<T>(request: FastifyRequest, fn: () => T): T {
  return requestClass(request) ? withPriority("preload", fn) : fn();
}

/**
 * `routeScope` for `case=N` (add-case-open K10): the scope `caseScope(entry, pad)` of catalog
 * entry N instead of the workspace's, with that scope's signal list, waited for when it is not
 * loaded (the session is not shown yet; its preload asks first). Answers 404 `no_case` without a
 * catalog, 400 `invalid_request` for N ≥ count and 503 `catalog_unavailable` when the list does
 * not load, and then returns undefined.
 */
export async function caseRouteScope(
  deps: ScopeDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  index: number,
): Promise<RouteScope | undefined> {
  const workspace = workspaceOf(request);
  const open = workspace.store.workspace.case;
  if (!open) {
    apiError(reply, 404, "no_case", "this workspace has no open catalog");
    return undefined;
  }
  if (index >= open.count) {
    apiError(reply, 400, "invalid_request", `case: the catalog has ${open.count} entries`);
    return undefined;
  }
  const entry: CaseEntry | undefined =
    deps.caseCatalog?.(workspace.record.id)?.entries[index] ??
    (index === open.current ? open.entry : undefined);
  if (!entry) {
    apiError(reply, 404, "no_case", "the workspace's catalog is not available");
    return undefined;
  }
  const scope = caseScope(entry, BigInt(open.pad));
  let catalog: Catalog;
  try {
    catalog = await catalogsOf(deps).load(scope);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    apiError(
      reply,
      503,
      "catalog_unavailable",
      `the session's signal list did not load: ${message}`,
    );
    return undefined;
  }
  return {
    scope,
    source: sourceScope(scope),
    catalog: catalog && catalogView(catalog, grantOf(request)),
  };
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
 * HTTP status of a command result: 400 invalid command, 503 catalog not loaded, 403 hidden data
 * (add-multiuser M7), else 422 (`scope_required` and `out_of_scope` included, add-scope Z10).
 */
export function commandStatus(result: CommandResult): number {
  if (result.ok) return 200;
  if (result.code === "invalid_command") return 400;
  if (result.code === "catalog_unavailable") return 503;
  if (result.code === "forbidden_data") return 403;
  return 422;
}
