import {
  type CursorValueResult,
  type EdgePoint,
  type Extent,
  evaluateAt,
  parseSignalId,
  TimeInput,
  ValuesMode,
} from "@kipscope/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import { DensityCache } from "../density.ts";
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

const DensityQuery = z.object({ dataRef: z.string().min(1) });

const ValueQuery = z.object({
  signal: z.string().min(1),
  t: Time,
  mode: ValuesMode.default("line"),
});

export const seriesRoutes =
  ({ catalog, source }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const density = new DensityCache(source, () => catalog.loadedAt);
    // Warm the cache after each catalog load (design Q4 (b)); the load does not wait for it.
    const stopPrefetch = catalog.onLoaded(() => {
      const dataRefs = new Set(catalog.all().map((s) => s.dataRef));
      void density.prefetch(dataRefs, (message) => app.log.warn(message));
    });
    app.addHook("onClose", async () => {
      stopPrefetch();
    });

    /** Rows per bucket of a data ref over its whole extent (spec time-strip). */
    app.get("/api/density", async (request, reply) => {
      const query = parseInput(DensityQuery, request.query, reply);
      if (!query) return reply;
      const { dataRef } = query;
      if (catalog.loadedAt && !catalog.all().some((s) => s.dataRef === dataRef)) {
        return apiError(reply, 404, "unknown_data_ref", `unknown data ref: ${dataRef}`);
      }
      try {
        // Shared and cached, so a client close does not abort it (design T7).
        const body = await density.get(dataRef);
        if (!body) return apiError(reply, 404, "no_data", `no data for data ref: ${dataRef}`);
        return body;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message);
      }
    });

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
      const controller = new AbortController();
      request.raw.on("close", () => {
        if (!reply.raw.writableEnded) controller.abort();
      });

      try {
        const extent = await source.extent(ref, controller.signal);
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
        if (controller.signal.aborted) return reply;
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message, { signalId: query.signal });
      }
    });

    /** Signal data for a time range at a target resolution (spec series-query). */
    app.get("/api/series", async (request, reply) => {
      const query = parseInput(SeriesQuery, request.query, reply);
      if (!query) return reply;
      const range = {
        signalId: query.signal,
        from: query.from.toString(),
        to: query.to.toString(),
      };
      // Without a catalog the server cannot tell SNA from valid values (spec series-query).
      if (!catalog.loadedAt) {
        return apiError(
          reply,
          503,
          "catalog_unavailable",
          "signal catalog not loaded yet; SNA values cannot be identified",
          range,
        );
      }
      const ref = parseSignalId(query.signal);
      if (!ref || !catalog.get(query.signal)) {
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
          { ...ref, sna: catalog.snaRanges(query.signal) },
          query.signal,
          query.from,
          query.to,
          query.target,
          controller.signal,
        );
      } catch (error) {
        if (controller.signal.aborted) return reply;
        const message = error instanceof Error ? error.message : String(error);
        // The server's own computation failed on valid input: a retry would fail again (design H2).
        if (error instanceof RangeError)
          return apiError(reply, 400, "invalid_request", message, range);
        return apiError(reply, 502, "source_error", message, range);
      }
    });

    /** Value of a signal at one time from its raw neighbours (spec series-query, design C4/S3). */
    app.get("/api/value", async (request, reply) => {
      const query = parseInput(ValueQuery, request.query, reply);
      if (!query) return reply;
      const details = { signalId: query.signal };
      if (!catalog.loadedAt) {
        return apiError(
          reply,
          503,
          "catalog_unavailable",
          "signal catalog not loaded yet; SNA values cannot be identified",
          details,
        );
      }
      const ref = parseSignalId(query.signal);
      if (!ref || !catalog.get(query.signal)) {
        return apiError(reply, 404, "unknown_signal", `unknown signal: ${query.signal}`, {
          signalId: query.signal,
        });
      }

      const controller = new AbortController();
      request.raw.on("close", () => {
        if (!reply.raw.writableEnded) controller.abort();
      });

      try {
        const seriesRef = { ...ref, sna: catalog.snaRanges(query.signal) };
        // before(t + 1) is the last point at or before t, after(t + 1) the first point after t.
        const [at, next] = await Promise.all([
          source.before(seriesRef, query.t + 1n, controller.signal),
          source.after(seriesRef, query.t + 1n, controller.signal),
        ]);
        const body: CursorValueResult = {
          signalId: query.signal,
          t: query.t.toString(),
          mode: query.mode,
          value: evaluateAt(query.t, query.mode, at, next),
        };
        if (at) body.at = edge(at);
        if (next) body.next = edge(next);
        return body;
      } catch (error) {
        if (controller.signal.aborted) return reply;
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message, details);
      }
    });
  };

const edge = (p: { t: bigint; v: number | null }): EdgePoint => ({ t: p.t.toString(), v: p.v });
