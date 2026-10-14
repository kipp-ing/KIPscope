import { type Extent, parseSignalId, TimeInput } from "@letsview/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import { apiError, parseInput } from "../http.ts";
import { MAX_TARGET, MIN_TARGET, querySeries } from "../series.ts";

const Time = TimeInput.transform(BigInt);

const SeriesQuery = z
  .object({
    signal: z.string().min(1),
    from: Time,
    to: Time,
    target: z.coerce.number().int().min(MIN_TARGET).max(MAX_TARGET).default(2000),
  })
  .refine((q) => q.to > q.from, { message: "to must be after from", path: ["to"] });

const ExtentQuery = z.object({ signal: z.string().min(1) });

export const seriesRoutes =
  ({ catalog, source }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    /** First and last timestamp of a signal (spec series-query, signal extent). */
    app.get("/api/extent", async (request, reply) => {
      const query = parseInput(ExtentQuery, request.query, reply);
      if (!query) return reply;
      const ref = parseSignalId(query.signal);
      if (!ref || (catalog.loadedAt && !catalog.get(query.signal))) {
        return apiError(reply, 404, "unknown_signal", `unknown signal: ${query.signal}`, {
          signalId: query.signal,
        });
      }
      try {
        const extent = await source.extent(ref);
        if (!extent) {
          return apiError(reply, 404, "no_data", `no data for signal: ${query.signal}`, {
            signalId: query.signal,
          });
        }
        const body: Extent = {
          signalId: query.signal,
          first: extent.first.toString(),
          last: extent.last.toString(),
        };
        return body;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message, { signalId: query.signal });
      }
    });

    /** Signal data for a time range at a target resolution (spec series-query). */
    app.get("/api/series", async (request, reply) => {
      const query = parseInput(SeriesQuery, request.query, reply);
      if (!query) return reply;
      const ref = parseSignalId(query.signal);
      if (!ref || (catalog.loadedAt && !catalog.get(query.signal))) {
        return apiError(reply, 404, "unknown_signal", `unknown signal: ${query.signal}`, {
          signalId: query.signal,
        });
      }

      // A client that goes away (e.g. after zooming on) aborts its queued and running queries.
      const controller = new AbortController();
      request.raw.on("close", () => {
        if (!reply.raw.writableEnded) controller.abort();
      });

      try {
        return await querySeries(
          source,
          ref,
          query.signal,
          query.from,
          query.to,
          query.target,
          controller.signal,
        );
      } catch (error) {
        if (controller.signal.aborted) return reply;
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message, {
          signalId: query.signal,
          from: query.from.toString(),
          to: query.to.toString(),
        });
      }
    });
  };
