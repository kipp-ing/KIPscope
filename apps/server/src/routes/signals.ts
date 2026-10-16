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
import { apiError, parseInput } from "../http.ts";

const SearchQuery = z.object({
  q: z.string().max(200).default(""),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

/** 503 before the first load; `reason` says still loading vs. source unreachable. */
function catalogUnavailable(reply: FastifyReply, catalog: Catalog) {
  return apiError(reply, 503, "catalog_unavailable", catalog.lastError ?? "catalog not loaded", {
    reason: catalog.unavailableReason,
  });
}

export const signalRoutes =
  ({ catalog }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    /** Searches the catalog (spec signal-catalog). */
    app.get("/api/signals", async (request, reply) => {
      const query = parseInput(SearchQuery, request.query, reply);
      if (!query) return reply;
      if (!catalog.loadedAt) {
        return catalogUnavailable(reply, catalog);
      }
      const page: SignalPage = catalog.search(query.q, query.offset, query.limit);
      return page;
    });

    /** Full catalog, unpaged, for clients that search locally (design E3). */
    app.get("/api/catalog", async (_request, reply) => {
      if (!catalog.loadedAt) {
        return catalogUnavailable(reply, catalog);
      }
      const snapshot: CatalogSnapshot = {
        items: [...catalog.all()],
        loadedAt: catalog.loadedAt.toISOString(),
      };
      return snapshot;
    });

    /** Reloads signals from the source and metadata from the DBC files. */
    app.post("/api/catalog/refresh", async (_request, reply) => {
      try {
        await catalog.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message);
      }
      warnDisplayFallbacks(app.log, catalog);
      return { size: catalog.size, loadedAt: catalog.loadedAt?.toISOString() };
    });
  };
