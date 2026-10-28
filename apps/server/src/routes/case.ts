import {
  alignPoint,
  type CaseAlign,
  type CaseCatalog,
  type CaseEntry,
  type CasePreview,
  caseScope,
  type DiagEvent,
  firstMatch,
  mergeEvents,
  parseSignalId,
  rebindSignalId,
  type Workspace,
  type WorkspaceScope,
} from "@kipscope/shared";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import type { CacheScope } from "../density.ts";
import { EventsCache } from "../events.ts";
import type { Access } from "../guard.ts";
import { apiError, catalogsOf, parseInput, withRequestClass, workspaceOf } from "../http.ts";
import { ObjectExtents } from "../objectScope.ts";
import { covers } from "../rights.ts";
import { sourceScope } from "../scope.ts";
import type { WorkspaceEntry } from "../workspaces.ts";

const WORKSPACE: { access: Access } = { access: { level: "workspace" } };

const PreviewQuery = z.object({ index: z.coerce.number().int().min(0) });

/**
 * Warm work of a route's caches for a session's scope (K10 preview): the density and gap routes
 * warm density and gap info, the events route the events. `signals` are the workspace's window
 * signals and `eventSignals` its events-line signals, both rebound to the scope's data ref.
 */
export type ScopeWarmer = (
  scope: CacheScope,
  signals: readonly string[],
  eventSignals: readonly string[],
) => Promise<void>;

const warmers = new WeakMap<object, Set<ScopeWarmer>>();

/** Registers a route's warm work for the preview (K10); returns the function that removes it. */
export function addScopeWarmer(deps: object, warmer: ScopeWarmer): () => void {
  let set = warmers.get(deps);
  if (!set) {
    set = new Set();
    warmers.set(deps, set);
  }
  set.add(warmer);
  return () => set.delete(warmer);
}

const eventCaches = new WeakMap<object, EventsCache>();
const extentCaches = new WeakMap<object, ObjectExtents>();

/**
 * The events case alignment reads (add-case-open K9), one cache per deps: a session's events are
 * loaded once per scope list and shared by its preview and the step to it.
 */
function eventsOf(deps: AppDeps): EventsCache {
  let cache = eventCaches.get(deps);
  if (!cache) {
    const catalogs = catalogsOf(deps);
    cache = new EventsCache(
      deps.source,
      deps.catalog,
      () => {},
      (scope: CacheScope) =>
        catalogs.get({
          dataRef: scope.dataRef,
          from: scope.from.toString(),
          to: scope.to.toString(),
        }),
    );
    eventCaches.set(deps, cache);
  }
  return cache;
}

/** The vehicles' extents for Unlink (K9, K11): `deps.objectExtents`, else one per deps. */
export function objectExtentsOf(deps: AppDeps): ObjectExtents {
  if (deps.objectExtents) return deps.objectExtents;
  let extents = extentCaches.get(deps);
  if (!extents) {
    extents = new ObjectExtents(deps.source);
    extentCaches.set(deps, extents);
  }
  return extents;
}

/** Catalog entry `index` of a workspace (K6): from its catalog, else the current entry it holds. */
export function caseEntryOf(
  deps: AppDeps,
  entry: WorkspaceEntry,
  index: number,
): CaseEntry | undefined {
  const open = entry.store.workspace.case;
  if (!open || index < 0 || index >= open.count) return undefined;
  const catalog: CaseCatalog | undefined = deps.workspaces.caseOf(entry.record.id);
  return catalog?.entries[index] ?? (index === open.current ? open.entry : undefined);
}

/** Signal IDs moved onto `toRef` (K8): those of the workspace's data ref rebound, others left out. */
function rebound(workspace: Workspace, ids: readonly string[], toRef: string): string[] {
  const fromRef = workspace.scope?.dataRef ?? workspace.case?.entry.dataRef;
  return [
    ...new Set(
      ids.flatMap((id) => {
        const ref = parseSignalId(id)?.dataRef;
        if (ref === toRef) return [id];
        return ref !== undefined && ref === fromRef ? [rebindSignalId(id, toRef)] : [];
      }),
    ),
  ];
}

/** The workspace's events-line signals moved onto `toRef` (K8). */
export const reboundEventSignals = (workspace: Workspace, toRef: string): string[] =>
  rebound(workspace, workspace.eventSignals ?? [], toRef);

/**
 * The events of a session's scope, unfiltered (K9): the data ref's table events and the state
 * changes of the given events-line signals. Signals the scope's list lacks give none.
 */
async function scopeEvents(
  deps: AppDeps,
  scope: WorkspaceScope,
  eventSignals: readonly string[],
): Promise<DiagEvent[]> {
  const events = eventsOf(deps);
  const s = sourceScope(scope);
  const [table, signals] = await Promise.all([
    events.table(scope.dataRef, s),
    Promise.all(eventSignals.map((id) => events.signal(id, s))),
  ]);
  return mergeEvents(table.events, ...signals.filter((r) => typeof r !== "string"));
}

/**
 * The alignment point of a session (K7, K9): start, end and anchor from the entry (`alignPoint`);
 * event mode the first match in the session's padded scope, else its start with `fallback`. The
 * scope's signal list must be loaded first. A source failure rejects.
 */
export async function alignmentOf(
  deps: AppDeps,
  entry: CaseEntry,
  align: CaseAlign,
  pad: bigint,
  eventSignals: readonly string[],
): Promise<{ t: string; fallback: boolean }> {
  if (align.mode !== "event") return alignPoint(entry, align);
  const scope = caseScope(entry, pad);
  const match = firstMatch(await scopeEvents(deps, scope, eventSignals), align.event, scope);
  return match ? { t: match.t, fallback: false } : { t: entry.from, fallback: true };
}

/** Aborts when the connection closes before the answer was sent. */
function abortOnClose(reply: FastifyReply): AbortSignal {
  const controller = new AbortController();
  reply.raw.once("close", () => {
    if (!reply.raw.writableFinished) controller.abort();
  });
  return controller.signal;
}

/**
 * The open catalog of a workspace (K10): `GET /api/case` and the neighbour preview
 * `GET /api/case/preview` (K13), which warms that session's signal list (and in event mode the
 * events it aligns by) in the request's class (`X-KIPscope-Class: preload`). A newly loaded list
 * starts the scope's density, gap and events prefetch (add-scope Z9).
 */
export const caseRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const catalogs = catalogsOf(deps);

    app.get("/api/case", { config: WORKSPACE }, async (request, reply) => {
      const entry = workspaceOf(request);
      const catalog = entry.store.workspace.case && deps.workspaces.caseOf(entry.record.id);
      if (!catalog) return apiError(reply, 404, "no_case", "this workspace has no open catalog");
      return catalog;
    });

    app.get("/api/case/preview", { config: WORKSPACE }, async (request, reply) => {
      const query = parseInput(PreviewQuery, request.query, reply);
      if (!query) return reply;
      const entry = workspaceOf(request);
      const { workspace } = entry.store;
      const open = workspace.case;
      if (!open) return apiError(reply, 404, "no_case", "this workspace has no open catalog");
      if (query.index >= open.count)
        return apiError(
          reply,
          400,
          "invalid_request",
          `index: the catalog has ${open.count} sessions`,
        );
      const target = caseEntryOf(deps, entry, query.index);
      if (!target)
        return apiError(reply, 404, "no_case", "the workspace's catalog is not available");
      // The data ref comes from the catalog, not the request, so the guard never saw it (T-03).
      if (!covers(deps.workspaces.grantOf(entry.record.id), target.dataRef))
        return apiError(
          reply,
          403,
          "forbidden_data",
          `data ref ${target.dataRef} is not permitted`,
        );
      const pad = BigInt(open.pad);
      const scope = caseScope(target, pad);
      const abort = abortOnClose(reply);
      return withRequestClass(request, async () => {
        try {
          await catalogs.load(scope, abort);
        } catch (error) {
          if (abort.aborted) return reply;
          const message = error instanceof Error ? error.message : String(error);
          return apiError(reply, 503, "catalog_unavailable", message, {
            reason: catalogs.get(scope)?.unavailableReason ?? message,
          });
        }
        if (abort.aborted) return reply;
        const signals = reboundEventSignals(workspace, target.dataRef);
        const windowSignals = rebound(
          workspace,
          workspace.windows.flatMap((w) => w.signals.map((s) => s.signalId)),
          target.dataRef,
        );
        // One after another; work not started when the client went away is dropped (D-081).
        for (const warm of warmers.get(deps) ?? []) {
          if (abort.aborted) return reply;
          try {
            await warm(sourceScope(scope), windowSignals, signals);
          } catch (error) {
            request.log.warn({ error: String(error) }, "preview warm-up failed");
          }
        }
        let point: { t: string; fallback: boolean };
        try {
          // Event mode: the events the step aligns by, cached for it.
          point = await alignmentOf(deps, target, open.align, pad, signals);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return apiError(reply, 502, "source_error", message);
        }
        const preview: CasePreview = { index: query.index, scope, alignAt: point.t };
        if (point.fallback) preview.alignFallback = true;
        return preview;
      });
    });
  };
