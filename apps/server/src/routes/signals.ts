import type { CatalogSnapshot, SignalPage } from "@kipscope/shared";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import {
  type Catalog,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  warnDisplayFallbacks,
} from "../catalog.ts";
import type { Access } from "../guard.ts";
import {
  apiError,
  catalogsOf,
  grantOf,
  parseInput,
  routeScope,
  tooWide,
  workspaceOf,
} from "../http.ts";
import { type CatalogView, catalogView } from "../rights.ts";
import { TooWideError } from "../scanBound.ts";
import { noteObjectScope } from "../scope.ts";

const SearchQuery = z.object({
  q: z.string().max(200).default(""),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

/** 503 before the first load; `reason` says still loading vs. source unreachable. */
function catalogUnavailable(reply: FastifyReply, catalog: CatalogView | undefined) {
  return apiError(reply, 503, "catalog_unavailable", catalog?.lastError ?? "catalog not loaded", {
    reason: catalog?.unavailableReason ?? "still loading: the scope's signal list",
  });
}

/** The workspace's lists, filtered by its grant (add-multiuser M6): no data ref named. */
const ACCESS: Access = { level: "workspace" };

/**
 * The workspace's scope's signal list, else the full catalog (add-scope Z10); in an object scope
 * the session's (B5). A list the scan bound refused answers 422 `too_wide`.
 */
export const signalRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    /** The request's scope and list; in an object scope the session's list (K11, B5). */
    const scopedList = (request: FastifyRequest, reply: FastifyReply) => {
      noteObjectScope(catalogsOf(deps), workspaceOf(request).store.workspace);
      return routeScope(deps, request, reply);
    };

    /** Searches the catalog (spec signal-catalog). */
    app.get("/api/signals", { config: { access: ACCESS } }, async (request, reply) => {
      const query = parseInput(SearchQuery, request.query, reply);
      if (!query) return reply;
      const scoped = scopedList(request, reply);
      if (!scoped) return reply;
      const { catalog } = scoped;
      if (!catalog?.loadedAt) {
        const refused = catalogsOf(deps).refusal(scoped.scope);
        return refused ? tooWide(reply, refused) : catalogUnavailable(reply, catalog);
      }
      const page: SignalPage = catalog.search(query.q, query.offset, query.limit);
      return page;
    });

    /** Full catalog, unpaged, for clients that search locally (design E3). */
    app.get("/api/catalog", { config: { access: ACCESS } }, async (request, reply) => {
      const scoped = scopedList(request, reply);
      if (!scoped) return reply;
      const { catalog, scope } = scoped;
      if (!catalog?.loadedAt) {
        const refused = catalogsOf(deps).refusal(scope);
        return refused ? tooWide(reply, refused) : catalogUnavailable(reply, catalog);
      }
      const snapshot: CatalogSnapshot = {
        items: [...catalog.all()],
        loadedAt: catalog.loadedAt.toISOString(),
      };
      if (scope) snapshot.scope = scope;
      if (catalogsOf(deps).partial(scope)) snapshot.partial = true;
      return snapshot;
    });

    /** Reloads signals from the source (of the scope, if any) and metadata from the DBC files. */
    app.post("/api/catalog/refresh", { config: { access: ACCESS } }, async (request, reply) => {
      const scoped = routeScope(deps, request, reply);
      if (!scoped) return reply;
      const { scope } = scoped;
      let catalog: Catalog;
      try {
        if (scope) {
          // A loaded list loads again; one that never loaded joins its first load. An object
          // scope's is its session's (B5).
          const catalogs = catalogsOf(deps);
          const held = catalogs.get(scope);
          if (held?.loadedAt) {
            catalog = held;
            await catalog.refresh();
          } else catalog = await catalogs.load(scope);
        } else {
          catalog = catalogsOf(deps).full ?? deps.catalog;
          await catalog.refresh();
        }
      } catch (error) {
        if (error instanceof TooWideError) return tooWide(reply, error);
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message);
      }
      warnDisplayFallbacks(app.log, catalog);
      // The count of what the workspace's grant covers (add-multiuser M6).
      const visible = catalogView(catalog, grantOf(request));
      return { size: visible.size, loadedAt: visible.loadedAt?.toISOString() };
    });
  };
