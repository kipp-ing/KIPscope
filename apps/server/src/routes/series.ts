import {
  type CursorValue,
  type CursorValueResult,
  type Extent,
  evaluateAt,
  GAP_REFRESH_MS,
  MAX_GAP_SIGNALS,
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
import type { RawPoint, Scope, SeriesRef } from "../datasource.ts";
import { DensityCache } from "../density.ts";
import { GapCache, workspaceSignals } from "../gaps.ts";
import { type Access, queryDataRefs } from "../guard.ts";
import {
  apiError,
  catalogsOf,
  chainPrefetch,
  outOfScope,
  parseInput,
  routeScope,
} from "../http.ts";
import { withPriority } from "../priority.ts";
import { sourceScope } from "../scope.ts";
import { edgePoint, MAX_TARGET, MIN_TARGET, querySeries, textLabel } from "../series.ts";
import type { Workspaces } from "../workspaces.ts";

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

const GapsQuery = z.object({
  dataRef: z.string().min(1),
  /** Signals whose measured period the answer lists (design P7); repeated, at most MAX_GAP_SIGNALS. */
  signal: z
    .union([z.string(), z.array(z.string()).max(MAX_GAP_SIGNALS)])
    .optional()
    .transform((s) => (s === undefined ? [] : Array.isArray(s) ? s : [s])),
});

const ValueQuery = z.object({
  signal: z.string().min(1),
  t: Time,
  mode: ValuesMode.default("line"),
});

/** Window and events-line signals of every workspace with a live client, united (add-multiuser M9). */
export function openSignals(workspaces: Workspaces): string[] {
  return [...new Set(workspaces.open().flatMap((w) => workspaceSignals(w.store.workspace)))];
}

/**
 * Scopes of the workspaces with a live client, one per scope key; `unscoped` when one of them has
 * none or no workspace has a client (add-multiuser M9).
 */
function openScopeList(workspaces: Workspaces): { scopes: Scope[]; unscoped: boolean } {
  const open = workspaces.open();
  const scopes = new Map<string, Scope>();
  let unscoped = open.length === 0;
  for (const entry of open) {
    const scope = entry.store.workspace.scope;
    if (!scope) unscoped = true;
    else scopes.set(`${scope.dataRef} ${scope.from} ${scope.to}`, sourceScope(scope));
  }
  return { scopes: [...scopes.values()], unscoped };
}

/** Access of the data routes (add-multiuser M6): the data refs each request names. */
const SIGNAL_ACCESS: Access = { level: "workspace", dataRefs: queryDataRefs({ signal: "signal" }) };
const DENSITY_ACCESS: Access = {
  level: "workspace",
  dataRefs: queryDataRefs({ dataRef: "dataRef" }),
};
const GAPS_ACCESS: Access = {
  level: "workspace",
  dataRefs: queryDataRefs({ dataRef: "dataRef", signal: "signal" }),
};

/** The workspace form of a source scope, for the catalog store. */
const workspaceScope = (scope: Scope) => ({
  dataRef: scope.dataRef,
  from: scope.from.toString(),
  to: scope.to.toString(),
});

export const seriesRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const { catalog, source, workspaces } = deps;
    const catalogs = catalogsOf(deps);
    // A scope's caches follow that scope's signal list (add-scope Z9).
    const scopeCatalog = (scope: Scope) => catalogs.get(workspaceScope(scope));
    const density = new DensityCache(source, (scope) =>
      scope ? scopeCatalog(scope)?.loadedAt : catalog.loadedAt,
    );
    // Periods are measured for the open workspaces' signals and the requests' only (design P6, M9).
    const gaps = new GapCache(source, catalog, () => openSignals(workspaces), scopeCatalog);
    const warn = (message: string) => app.log.warn(message);
    // Gap info polls (design G9 (b)): a setTimeout chain, each poll GAP_REFRESH_MS after the
    // previous poll or the catalog load's prefetch ended, so polls never overlap each other or a
    // prefetch and at most one gap recompute runs at a time.
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let polling: Promise<void> = Promise.resolve();
    const schedule = () => {
      if (closed) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(poll, GAP_REFRESH_MS);
    };
    // The gap info of the open workspaces' scopes is polled (add-scope Z9, add-multiuser M9); the
    // full catalog's only in full mode while an open workspace has no scope or none is open.
    const poll = () => {
      timer = undefined;
      const { scopes, unscoped } = openScopeList(workspaces);
      if (scopes.length > 0 && !(unscoped && catalogs.mode === "full")) {
        polling = withPriority("background", async () => {
          for (const s of scopes) await gaps.refresh([s.dataRef], warn, s);
        }).then(schedule);
        return;
      }
      if (catalogs.mode === "scoped") return schedule();
      const loadedAt = catalog.loadedAt;
      const dataRefs = new Set(catalog.all().map((s) => s.dataRef));
      // Background class (design P9): requests go first and keep a slot of their own.
      polling = withPriority("background", async () => {
        for (const s of scopes) await gaps.refresh([s.dataRef], warn, s);
        await gaps.refresh(dataRefs, warn);
      }).then(() => {
        // A newer load stopped this poll; its prefetch schedules the next one.
        if (catalog.loadedAt === loadedAt) schedule();
      });
    };
    // Warm the caches after each catalog load (design Q4 (b)); the load does not wait for it. The
    // gap info follows the density, so carserver sees one full scan at a time (design G6); a newer
    // load starts its own run, after a running poll ended. The whole chain runs as background
    // (design P9), so a request never waits for it; a request that joins its work raises that (P4).
    const stopPrefetch = catalog.onLoaded(() =>
      withPriority("background", () => {
        const loadedAt = catalog.loadedAt;
        const dataRefs = new Set(catalog.all().map((s) => s.dataRef));
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        void polling
          .then(() => density.prefetch(dataRefs, warn))
          .then(() => {
            if (catalog.loadedAt === loadedAt) return gaps.prefetch(dataRefs, warn);
          })
          .then(() => {
            if (catalog.loadedAt === loadedAt) schedule();
          });
      }),
    );
    // After a scope's list loads: its density, then its gap info, one after another and before the
    // scope's events (add-scope Z9), as background work; then the poll is scheduled.
    const stopScopePrefetch = catalogs.onLoaded((scope) => {
      const s = sourceScope(scope);
      chainPrefetch(deps, () =>
        withPriority("background", async () => {
          try {
            await density.get(s.dataRef, s);
          } catch (error) {
            warn(`density prefetch for ${s.dataRef} failed: ${String(error)}`);
          }
          await polling;
          await gaps.prefetch([s.dataRef], warn, s);
          if (timer === undefined) schedule();
        }),
      );
    });
    app.addHook("onClose", async () => {
      stopPrefetch();
      stopScopePrefetch();
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
    });

    /** Rows per bucket of a data ref over its whole extent (spec time-strip). */
    app.get("/api/density", { config: { access: DENSITY_ACCESS } }, async (request, reply) => {
      const query = parseInput(DensityQuery, request.query, reply);
      if (!query) return reply;
      const { dataRef } = query;
      const scoped = routeScope(deps, request, reply);
      if (!scoped) return reply;
      const scope = scoped.source;
      if (scope && dataRef !== scope.dataRef) {
        return outOfScope(reply, `data ref ${dataRef} is outside the scope on ${scope.dataRef}`);
      }
      const visible = scoped.catalog;
      if (!scope && visible?.loadedAt && !visible.all().some((s) => s.dataRef === dataRef)) {
        return apiError(reply, 404, "unknown_data_ref", `unknown data ref: ${dataRef}`);
      }
      try {
        // Shared and cached, so a client close does not abort it (design T7).
        const body = await density.get(dataRef, scope);
        if (!body) return apiError(reply, 404, "no_data", `no data for data ref: ${dataRef}`);
        return body;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message);
      }
    });

    /** Logger gaps and periods of a data ref and its named signals (spec data-gaps, design G6, P7). */
    app.get("/api/gaps", { config: { access: GAPS_ACCESS } }, async (request, reply) => {
      const query = parseInput(GapsQuery, request.query, reply);
      if (!query) return reply;
      const { dataRef, signal } = query;
      const scoped = routeScope(deps, request, reply);
      if (!scoped) return reply;
      const scope = scoped.source;
      if (scope && dataRef !== scope.dataRef) {
        return outOfScope(reply, `data ref ${dataRef} is outside the scope on ${scope.dataRef}`);
      }
      // Periods come from the catalog, so there is no gap info without one.
      if (!scoped.catalog?.loadedAt) {
        return apiError(
          reply,
          503,
          "catalog_unavailable",
          "signal catalog not loaded yet; gaps cannot be computed",
        );
      }
      // A scope's list may be empty while the scope itself is valid.
      if (!scope && !scoped.catalog.all().some((s) => s.dataRef === dataRef)) {
        return apiError(reply, 404, "unknown_data_ref", `unknown data ref: ${dataRef}`);
      }
      try {
        // Shared and cached, so a client close does not abort it.
        return await gaps.get(dataRef, signal, scope);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message);
      }
    });

    /** First and last timestamp of a signal (spec series-query, signal extent). */
    app.get("/api/extent", { config: { access: SIGNAL_ACCESS } }, async (request, reply) => {
      const query = parseInput(ExtentQuery, request.query, reply);
      if (!query) return reply;
      const scoped = routeScope(deps, request, reply);
      if (!scoped) return reply;
      const { catalog } = scoped;
      const scope = scoped.source;
      const ref = parseSignalId(query.signal);
      if (ref && scope && ref.dataRef !== scope.dataRef) {
        return outOfScope(
          reply,
          `signal ${query.signal} is outside the scope on ${scope.dataRef}`,
          {
            signalId: query.signal,
          },
        );
      }
      if (!ref || (catalog?.loadedAt && !catalog.get(query.signal))) {
        return apiError(reply, 404, "unknown_signal", `unknown signal: ${query.signal}`, {
          signalId: query.signal,
        });
      }
      const controller = new AbortController();
      request.raw.on("close", () => {
        if (!reply.raw.writableEnded) controller.abort();
      });

      try {
        const extent = await source.extent(ref, scope, controller.signal);
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
    app.get("/api/series", { config: { access: SIGNAL_ACCESS } }, async (request, reply) => {
      const query = parseInput(SeriesQuery, request.query, reply);
      if (!query) return reply;
      const scoped = routeScope(deps, request, reply);
      if (!scoped) return reply;
      const scope = scoped.source;
      const range = {
        signalId: query.signal,
        from: query.from.toString(),
        to: query.to.toString(),
      };
      // The range within the scope (add-scope Z10): never a query outside it.
      let { from, to } = query;
      if (scope) {
        if (parseSignalId(query.signal)?.dataRef !== scope.dataRef) {
          return outOfScope(
            reply,
            `signal ${query.signal} is outside the scope on ${scope.dataRef}`,
            range,
          );
        }
        if (from < scope.from) from = scope.from;
        if (to > scope.to) to = scope.to;
        if (to <= from) return outOfScope(reply, "the range lies outside the scope", range);
      }
      const catalog = scoped.catalog;
      // Without a catalog the server cannot tell SNA from valid values (spec series-query).
      if (!catalog?.loadedAt) {
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
          from,
          to,
          query.target,
          scope,
          controller.signal,
          query.to - query.from,
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
    app.get("/api/value", { config: { access: SIGNAL_ACCESS } }, async (request, reply) => {
      const query = parseInput(ValueQuery, request.query, reply);
      if (!query) return reply;
      const details = { signalId: query.signal };
      const scoped = routeScope(deps, request, reply);
      if (!scoped) return reply;
      const scope = scoped.source;
      if (scope && parseSignalId(query.signal)?.dataRef !== scope.dataRef) {
        return outOfScope(
          reply,
          `signal ${query.signal} is outside the scope on ${scope.dataRef}`,
          details,
        );
      }
      if (scope && (query.t < scope.from || query.t >= scope.to)) {
        return outOfScope(reply, "the time lies outside the scope", details);
      }
      const catalog = scoped.catalog;
      if (!catalog?.loadedAt) {
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
          source.before(ref, query.t + 1n, scope, controller.signal),
          source.after(ref, query.t + 1n, scope, controller.signal),
          // Its own period only, not every signal's (design P6).
          gaps.get(info.dataRef, [query.signal], scope),
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
