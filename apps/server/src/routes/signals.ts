import type { CatalogSnapshot, SignalPage } from "@kipscope/shared";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import {
  type Catalog,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  warnDisplayFallbacks,
} from "../catalog.ts";
import type { Access } from "../guard.ts";
import { apiError, catalogsOf, parseInput, routeScope, userOf } from "../http.ts";
import { type CatalogView, catalogView } from "../rights.ts";

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

/** The session's lists, filtered by the requester's rights (add-multiuser M6): no data ref named. */
const ACCESS: Access = { level: "session" };

/** The session's scope's signal list, else the full catalog (add-scope Z10). */
export const signalRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    /** Searches the catalog (spec signal-catalog). */
    app.get("/api/signals", { config: { access: ACCESS } }, async (request, reply) => {
      const query = parseInput(SearchQuery, request.query, reply);
      if (!query) return reply;
      const scoped = routeScope(deps, request, reply);
      if (!scoped) return reply;
      const { catalog } = scoped;
      if (!catalog?.loadedAt) {
        return catalogUnavailable(reply, catalog);
      }
      const page: SignalPage = catalog.search(query.q, query.offset, query.limit);
      return page;
    });

    /** Full catalog, unpaged, for clients that search locally (design E3). */
    app.get("/api/catalog", { config: { access: ACCESS } }, async (request, reply) => {
      const scoped = routeScope(deps, request, reply);
      if (!scoped) return reply;
      const { catalog, scope } = scoped;
      if (!catalog?.loadedAt) {
        return catalogUnavailable(reply, catalog);
      }
      const snapshot: CatalogSnapshot = {
        items: [...catalog.all()],
        loadedAt: catalog.loadedAt.toISOString(),
      };
      if (scope) snapshot.scope = scope;
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
          // A loaded list loads again; one that never loaded joins its first load.
          const held = catalogsOf(deps).get(scope);
          if (held?.loadedAt) {
            catalog = held;
            await catalog.refresh();
          } else catalog = await catalogsOf(deps).load(scope);
        } else {
          catalog = catalogsOf(deps).full ?? deps.catalog;
          await catalog.refresh();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message);
      }
      warnDisplayFallbacks(app.log, catalog);
      // The count of what the requester may see (add-multiuser M6).
      const visible = catalogView(catalog, userOf(request).rights);
      return { size: visible.size, loadedAt: visible.loadedAt?.toISOString() };
    });
  };
