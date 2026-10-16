import {
  type CursorValue,
  type CursorValueResult,
  type Extent,
  evaluateAt,
  parseSignalId,
  type SignalInfo,
  signalGaps,
  stateLabel,
  TimeInput,
  ValuesMode,
} from "@kipscope/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import type { RawPoint, SeriesRef } from "../datasource.ts";
import { DensityCache } from "../density.ts";
import { GapCache } from "../gaps.ts";
import { apiError, parseInput } from "../http.ts";
import { edgePoint, MAX_TARGET, MIN_TARGET, querySeries, textLabel } from "../series.ts";

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

const GapsQuery = z.object({ dataRef: z.string().min(1) });

const ValueQuery = z.object({
  signal: z.string().min(1),
  t: Time,
  mode: ValuesMode.default("line"),
});

export const seriesRoutes =
  ({ catalog, source }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const density = new DensityCache(source, () => catalog.loadedAt);
    const gaps = new GapCache(source, catalog);
    // Warm the caches after each catalog load (design Q4 (b)); the load does not wait for it. The
    // gap info follows the density, so carserver sees one full scan at a time (design G6); a newer
    // load starts its own run.
    const stopPrefetch = catalog.onLoaded(() => {
      const loadedAt = catalog.loadedAt;
      const dataRefs = new Set(catalog.all().map((s) => s.dataRef));
      const warn = (message: string) => app.log.warn(message);
      void density.prefetch(dataRefs, warn).then(() => {
        if (catalog.loadedAt === loadedAt) return gaps.prefetch(dataRefs, warn);
      });
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

    /** Logger gaps and periods of a data ref (spec data-gaps, design G6). */
    app.get("/api/gaps", async (request, reply) => {
      const query = parseInput(GapsQuery, request.query, reply);
      if (!query) return reply;
      const { dataRef } = query;
      // Periods come from the catalog, so there is no gap info without one.
      if (!catalog.loadedAt) {
        return apiError(
          reply,
          503,
          "catalog_unavailable",
          "signal catalog not loaded yet; gaps cannot be computed",
        );
      }
      if (!catalog.all().some((s) => s.dataRef === dataRef)) {
        return apiError(reply, 404, "unknown_data_ref", `unknown data ref: ${dataRef}`);
      }
      try {
        // Shared and cached, so a client close does not abort it.
        return await gaps.get(dataRef);
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
          seriesRef(catalog.get(query.signal) as SignalInfo, catalog.snaRanges(query.signal)),
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
      const info = catalog.get(query.signal);
      if (!parseSignalId(query.signal) || !info) {
        return apiError(reply, 404, "unknown_signal", `unknown signal: ${query.signal}`, {
          signalId: query.signal,
        });
      }

      const controller = new AbortController();
      request.raw.on("close", () => {
        if (!reply.raw.writableEnded) controller.abort();
      });

      try {
        const ref = seriesRef(info, catalog.snaRanges(query.signal));
        const text = ref.text === true;
        // before(t + 1) is the last point at or before t, after(t + 1) the first point after t.
        // Without gap info there is no value: it could lie across a gap (design G6).
        const [at, next, gapInfo] = await Promise.all([
          source.before(ref, query.t + 1n, controller.signal),
          source.after(ref, query.t + 1n, controller.signal),
          gaps.get(info.dataRef),
        ]);
        // State names (add-events N2): the row text of a text signal, else the VAL_ label.
        const labelOf = (p: RawPoint | undefined): string | undefined =>
          !p || p.v === null ? undefined : text ? textLabel(p) : stateLabel(info, p.v);
        const atLabel = labelOf(at);
        const nextLabel = labelOf(next);
        // Line mode next to a named point holds instead of interpolating (spec state-names).
        let value: CursorValue = evaluateAt(
          query.t,
          query.mode,
          at,
          next,
          (p) => (p === at ? atLabel : nextLabel) !== undefined,
          signalGaps(gapInfo, query.signal),
        );
        // Raw and held values are at's.
        if ((value.kind === "raw" || value.kind === "held") && atLabel !== undefined)
          value = { ...value, label: atLabel };
        const body: CursorValueResult = {
          signalId: query.signal,
          t: query.t.toString(),
          mode: query.mode,
          value,
        };
        if (at) body.at = edgePoint(at, text);
        if (next) body.next = edgePoint(next, text);
        return body;
      } catch (error) {
        if (controller.signal.aborted) return reply;
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message, details);
      }
    });
  };

/** Value query ref of a catalog signal; text signals read their row text (add-events N3). */
function seriesRef(info: SignalInfo, sna: SeriesRef["sna"]): SeriesRef {
  const ref: SeriesRef = { dataRef: info.dataRef, name: info.name, sna };
  if (info.states === "text") ref.text = true;
  return ref;
}
