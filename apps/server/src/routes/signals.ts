import type { SignalPage } from "@letsview/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../catalog.ts";
import { apiError, parseInput } from "../http.ts";

const SearchQuery = z.object({
  q: z.string().max(200).default(""),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export const signalRoutes =
  ({ catalog }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    /** Searches the catalog (spec signal-catalog). */
    app.get("/api/signals", async (request, reply) => {
      const query = parseInput(SearchQuery, request.query, reply);
      if (!query) return reply;
      if (!catalog.loadedAt) {
        return apiError(
          reply,
          503,
          "catalog_unavailable",
          catalog.lastError ?? "catalog not loaded",
        );
      }
      const page: SignalPage = catalog.search(query.q, query.offset, query.limit);
      return page;
    });

    /** Reloads signals from the source and metadata from the DBC files. */
    app.post("/api/catalog/refresh", async (_request, reply) => {
      try {
        await catalog.refresh();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message);
      }
      return { size: catalog.size, loadedAt: catalog.loadedAt?.toISOString() };
    });
  };
