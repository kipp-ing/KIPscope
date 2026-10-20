import {
  compileEventFilter,
  type DiagEvent,
  type EventCategory,
  type EventFilter,
  type EventList,
  formatEventFilter,
  mergeEvents,
  parseEventFilter,
  parseSignalId,
  TimeInput,
} from "@kipscope/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import type { Scope } from "../datasource.ts";
import { EventsCache } from "../events.ts";
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
import type { Workspaces } from "../workspaces.ts";

const Time = TimeInput.transform(BigInt);

const EventsQuery = z
  .object({
    dataRef: z.string().min(1),
    signal: z
      .union([z.string(), z.array(z.string())])
      .optional()
      .transform((s) => (s === undefined ? [] : Array.isArray(s) ? s : [s])),
    filter: z.string().optional(),
    from: Time.optional(),
    to: Time.optional(),
  })
  .refine((q) => (q.from === undefined) === (q.to === undefined), {
    message: "from and to go together",
    path: ["to"],
  })
  .refine((q) => q.from === undefined || q.to === undefined || q.to > q.from, {
    message: "to must be after from",
    path: ["to"],
  });

/** Access of `GET /api/events` (add-multiuser M6): its data ref and each signal's. */
const EVENTS_ACCESS: Access = {
  level: "workspace",
  dataRefs: queryDataRefs({ dataRef: "dataRef", signal: "signal" }),
};

/** Events-line signals of every workspace with a live client, united (add-multiuser M9). */
function openEventSignals(workspaces: Workspaces): string[] {
  return [...new Set(workspaces.open().flatMap((w) => w.store.workspace.eventSignals ?? []))];
}

export const eventsRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const { catalog, source, workspaces } = deps;
    const catalogs = catalogsOf(deps);
    // A scope's events follow that scope's signal list (add-scope Z9).
    const events = new EventsCache(
      source,
      catalog,
      (message) => app.log.warn(message),
      (scope: Scope) =>
        catalogs.get({
          dataRef: scope.dataRef,
          from: scope.from.toString(),
          to: scope.to.toString(),
        }),
    );
    // After each catalog load: every data ref's table events, then the events-line signals
    // (design E3). Independent of the density prefetch; both go through the query queue as
    // `background` work (series-query design P9).
    const stopPrefetch = catalog.onLoaded(() => {
      const dataRefs = new Set(catalog.all().map((s) => s.dataRef));
      const signals = openEventSignals(workspaces);
      void withPriority("background", () =>
        events.prefetch(dataRefs, signals, (message) => app.log.warn(message)),
      );
    });
    // After a scope's list loads: its table events and events-line signals, after its density and
    // gap info (add-scope Z9), as background work.
    const stopScopePrefetch = catalogs.onLoaded((scope) => {
      const s = sourceScope(scope);
      const signals = openEventSignals(workspaces).filter(
        (id) => parseSignalId(id)?.dataRef === s.dataRef,
      );
      chainPrefetch(deps, () =>
        withPriority("background", () =>
          events.prefetch([s.dataRef], signals, (message) => app.log.warn(message), s),
        ),
      );
    });
    app.addHook("onClose", async () => {
      stopPrefetch();
      stopScopePrefetch();
    });

    /** Table events of a data ref plus the state changes of listed signals (spec events). */
    app.get("/api/events", { config: { access: EVENTS_ACCESS } }, async (request, reply) => {
      const query = parseInput(EventsQuery, request.query, reply);
      if (!query) return reply;
      const { dataRef } = query;
      let filter: EventFilter | undefined;
      if (query.filter !== undefined) {
        const parsed = parseEventFilter(query.filter);
        if (!parsed.ok) return apiError(reply, 400, "invalid_filter", parsed.message);
        filter = parsed.filter;
      }
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
      // Signals of other data refs are ignored; each listed one counts once.
      const signals = [...new Set(query.signal)].filter(
        (id) => parseSignalId(id)?.dataRef === dataRef,
      );
      try {
        // Shared and cached, so a client close does not abort them (design E3).
        const [table, results] = await Promise.all([
          events.table(dataRef, scope),
          Promise.all(signals.map((id) => events.signal(id, scope))),
        ]);
        const lists: DiagEvent[][] = [table.events];
        const skipped: EventList["skipped"] = [];
        results.forEach((result, i) => {
          if (typeof result === "string")
            skipped.push({ signalId: signals[i] ?? "", reason: result });
          else lists.push(result);
        });
        let merged = mergeEvents(...lists);
        // With a scope the loads hold only its events; `from`/`to` narrow them further.
        const { from, to } = query;
        if (from !== undefined && to !== undefined) {
          merged = merged.filter((e) => {
            const t = BigInt(e.t);
            return t >= from && t < to;
          });
        }
        const counts: Partial<Record<EventCategory, number>> = {};
        const bySource = new Map<string, number>();
        for (const e of merged) {
          counts[e.category] = (counts[e.category] ?? 0) + 1;
          bySource.set(e.source, (bySource.get(e.source) ?? 0) + 1);
        }
        const sources = [...bySource]
          .map(([source, count]) => ({ source, count }))
          .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source));
        const body: EventList = {
          dataRef,
          total: merged.length,
          counts,
          sources,
          events: filter ? merged.filter(compileEventFilter(filter)) : merged,
          skipped,
        };
        if (filter) body.filter = formatEventFilter(filter);
        if (table.truncated) body.truncated = true;
        return body;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message);
      }
    });
  };
