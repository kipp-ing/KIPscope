import {
  CALENDAR_GRID_NS,
  CALENDAR_SPAN_MAX_NS,
  type ComputedParams,
  type CursorValue,
  type CursorValueResult,
  computedSignalGaps,
  computedValueAt,
  type Extent,
  evaluateAt,
  GAP_REFRESH_MS,
  type GapInfo,
  holdLimit,
  isComputedId,
  MAX_GAP_SIGNALS,
  parseSignalId,
  type SignalInfo,
  scopeKey,
  signalGaps,
  stateLabel,
  TimeInput,
  ValuesMode,
  type WorkspaceScope,
  workWindow,
} from "@kipscope/shared";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import { CalendarCache } from "../calendar.ts";
import { fillAhead } from "../calendarDays.ts";
import { queryComputed, type ResolvedComputed, resolveComputed, withSeed } from "../computed.ts";
import type { ComputedRef, RawPoint, Scope, SeriesRef, SignalRef } from "../datasource.ts";
import { type CacheScope, DensityCache, type DensityPart } from "../density.ts";
import { ComputedTooLargeError } from "../fallbacks.ts";
import { GapCache, workspaceSignals } from "../gaps.ts";
import { type Access, queryDataRefs } from "../guard.ts";
import {
  apiError,
  cacheScopeOf,
  caseRouteScope,
  catalogsOf,
  chainPrefetch,
  outOfScope,
  parseInput,
  routeScope,
  scopeHolders,
  tooWide,
  withRequestClass,
} from "../http.ts";
import { WorkWindowError, workWindowOf } from "../objectScope.ts";
import { withPriority } from "../priority.ts";
import { TooWideError } from "../scanBound.ts";
import { linkedScopeOf, openScopes, sourceScope } from "../scope.ts";
import { edgePoint, MAX_TARGET, MIN_TARGET, querySeries, textLabel } from "../series.ts";
import type { WorkspaceEntry, Workspaces } from "../workspaces.ts";
import { addScopeWarmer } from "./case.ts";

const Time = TimeInput.transform(BigInt);

/** `case=N` (add-case-open K10): bounded by catalog entry N's scope instead of the workspace's. */
const CaseIndex = z.coerce.number().int().min(0).optional();

/**
 * A computed signal's parameter (design F8); the formula's length and grammar are the parser's
 * checks (`invalid_formula`).
 */
const ComputedQuery = { formula: z.string().optional() };

const SeriesQuery = z
  .object({
    signal: z.string().min(1),
    from: Time,
    to: Time,
    target: z.coerce.number().int().min(MIN_TARGET).max(MAX_TARGET).default(2000),
    case: CaseIndex,
    ...ComputedQuery,
  })
  .refine((q) => q.to > q.from, { message: "to must be after from", path: ["to"] });

const ExtentQuery = z.object({ signal: z.string().min(1), case: CaseIndex, ...ComputedQuery });

/** `from` and `to` go together and `to` is after `from` (add-case-open K10). */
const pairedRange = <T extends z.ZodType<{ from?: bigint | undefined; to?: bigint | undefined }>>(
  schema: T,
) =>
  schema
    .refine((q) => (q.from === undefined) === (q.to === undefined), {
      message: "from and to go together",
      path: ["to"],
    })
    .refine((q) => q.from === undefined || q.to === undefined || q.to > q.from, {
      message: "to must be after from",
      path: ["to"],
    });

const DensityQuery = pairedRange(
  z.object({ dataRef: z.string().min(1), from: Time.optional(), to: Time.optional() }),
);

/** A calendar window (design R4 of add-range-picker): on the 60 s grid, at most 32 days. */
const CalendarQuery = z
  .object({ dataRef: z.string().min(1), from: Time, to: Time })
  .refine((q) => q.to > q.from, { message: "to must be after from", path: ["to"] })
  .refine((q) => q.to - q.from <= CALENDAR_SPAN_MAX_NS, {
    message: "from and to lie at most 32 days apart",
    path: ["to"],
  })
  .refine((q) => q.from % CALENDAR_GRID_NS === 0n && q.to % CALENDAR_GRID_NS === 0n, {
    message: "from and to are whole minutes",
    path: ["from"],
  });

const GapsQuery = pairedRange(
  z.object({
    dataRef: z.string().min(1),
    /** Signals whose measured period the answer lists (design P7); repeated, at most MAX_GAP_SIGNALS. */
    signal: z
      .union([z.string(), z.array(z.string()).max(MAX_GAP_SIGNALS)])
      .optional()
      .transform((s) => (s === undefined ? [] : Array.isArray(s) ? s : [s])),
    /** The work window; required in an object scope, refused outside one (add-case-open K10, K11). */
    from: Time.optional(),
    to: Time.optional(),
  }),
);

const ValueQuery = z.object({
  signal: z.string().min(1),
  t: Time,
  mode: ValuesMode.default("line"),
  ...ComputedQuery,
});

/**
 * The computed parameters of a request (design F8): a computed signal (`=<id>`) needs `formula`;
 * a plain signal takes none.
 */
function computedQuery(q: {
  signal: string;
  formula?: string | undefined;
}): { ok: true; params?: ComputedParams } | { ok: false; message: string } {
  if (!isComputedId(q.signal)) {
    return q.formula === undefined
      ? { ok: true }
      : { ok: false, message: "formula goes with a computed signal only" };
  }
  if (q.formula === undefined) return { ok: false, message: "a computed signal needs formula" };
  return { ok: true, params: { formula: q.formula } };
}

/** The refusal of a computed request's checks (design F8). */
const refuseComputed = (
  reply: Parameters<typeof apiError>[0],
  r: Extract<ResolvedComputed, { ok: false }>,
) => apiError(reply, r.status, r.code, r.message, r.signalId ? { signalId: r.signalId } : {});

/** Hold limit of an input (design C2) from the gap info of the inputs. */
const holdOf = (info: GapInfo, input: SignalRef) =>
  holdLimit(signalGaps(info, `${input.dataRef}/${input.name}`).period);

/** Window and events-line signals of every workspace with a live client, united (add-multiuser M9). */
export function openSignals(workspaces: Workspaces): string[] {
  return [...new Set(workspaces.open().flatMap((w) => workspaceSignals(w.store.workspace)))];
}

/**
 * Scopes of the workspaces with a live client, one per scope key; `unscoped` when one of them has
 * none or no workspace has a client (add-multiuser M9). An object scope keeps its flag, so its
 * poll recounts only its held work windows (add-case-open K11).
 */
function openScopeList(workspaces: Workspaces): { scopes: CacheScope[]; unscoped: boolean } {
  const open = workspaces.open();
  const scopes = new Map<string, CacheScope>();
  let unscoped = open.length === 0;
  for (const entry of open) {
    const scope = entry.store.workspace.scope;
    if (!scope) unscoped = true;
    else scopes.set(scopeKey(scope), cacheScopeOf(scope));
  }
  return { scopes: [...scopes.values()], unscoped };
}

/**
 * Whether a loaded scope list is an object scope's (add-case-open K11): flagged, or the scope of
 * an open workspace that is one; its whole span gets no grid, gap or events prefetch.
 */
export function isObjectScope(scope: WorkspaceScope, workspaces: Workspaces): boolean {
  if (scope.object) return true;
  return openScopes(workspaces).some(
    (s) =>
      s.object === true &&
      s.dataRef === scope.dataRef &&
      s.from === scope.from &&
      s.to === scope.to,
  );
}

/**
 * Whether a scope's queued prefetch still runs, checked when the job starts (add-case-open K11):
 * not when `holders` (scopeHolders) now hold the scope as an object scope, or only as the session
 * list an unlinked workspace left, none of them as its own scope.
 */
export function wantsScopePrefetch(scope: WorkspaceScope, holders: WorkspaceEntry[]): boolean {
  if (scope.object) return false;
  const same = (s: WorkspaceScope | undefined) =>
    s !== undefined && s.dataRef === scope.dataRef && s.from === scope.from && s.to === scope.to;
  const held = holders.map((w) => w.store.workspace);
  if (held.some((w) => w.scope?.object === true && same(w.scope))) return false;
  if (!held.some((w) => same(linkedScopeOf(w)))) return true;
  return held.some((w) => w.scope?.object !== true && same(w.scope));
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

/** The workspace form of a cache scope, for the catalog store. */
export const workspaceScope = (scope: CacheScope): WorkspaceScope => {
  const s: WorkspaceScope = {
    dataRef: scope.dataRef,
    from: scope.from.toString(),
    to: scope.to.toString(),
  };
  if (scope.object) s.object = true;
  return s;
};

/** A source scope cut to another one; undefined when they do not overlap. */
function cut(range: Scope, scope: Scope | undefined): Scope | undefined {
  if (!scope) return range;
  const from = range.from > scope.from ? range.from : scope.from;
  const to = range.to < scope.to ? range.to : scope.to;
  return to > from ? { dataRef: range.dataRef, from, to } : undefined;
}

export const seriesRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const { catalog, source, workspaces, bound } = deps;
    const catalogs = catalogsOf(deps);
    const holders = scopeHolders(deps);
    // A scope's caches follow that scope's signal list (add-scope Z9).
    const scopeCatalog = (scope: CacheScope) => catalogs.get(workspaceScope(scope));
    // An object scope's density follows the vehicle's own list, not the session's that stands in
    // for it while that loads (K11).
    const loadedAt = (scope?: CacheScope) =>
      scope
        ? scope.object
          ? catalogs.own(workspaceScope(scope))?.loadedAt
          : scopeCatalog(scope)?.loadedAt
        : catalog.loadedAt;
    // Every density and gap info checks its range against the scan bound first (B2).
    const density = new DensityCache(source, loadedAt, bound);
    // The range picker's calendar follows the same catalog loads (add-range-picker R3); object
    // scopes and full mode without a scope answer from the vehicle-days (B6).
    const calendar = new CalendarCache(source, loadedAt, deps.calendarDays);
    // The open workspaces' shown months are counted ahead, at idle (B6).
    const stopFill = fillAhead(deps.calendarDays, workspaces);
    // Periods are measured for the open workspaces' signals and the requests' only (design P6, M9).
    const gaps = new GapCache(source, catalog, () => openSignals(workspaces), scopeCatalog, bound);
    const warn = (message: string) => app.log.warn(message);
    // Gap info polls (design G9 (b)): a setTimeout chain, each poll GAP_REFRESH_MS after the
    // previous poll or the catalog load's prefetch ended, so polls never overlap each other or a
    // prefetch and at most one gap recompute runs at a time. Only gap info within the scan bound is
    // held, so only that is polled (D-117).
    let closed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Work windows whose gap info a request asked for (K11): a new one schedules the poll. */
    const polledWindows = new Set<string>();
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
      // The held work windows of object scopes poll in every mode (K11).
      if (scopes.length > 0 && !(unscoped && catalogs.mode === "full")) {
        polling = withPriority("background", async () => {
          for (const s of scopes) await gaps.refresh([s.dataRef], warn, s);
          await gaps.refreshWindows(warn);
        }).then(schedule);
        return;
      }
      if (catalogs.mode === "scoped") {
        polling = withPriority("background", () => gaps.refreshWindows(warn)).then(schedule);
        return;
      }
      const loadedAt = catalog.loadedAt;
      const dataRefs = new Set(catalog.all().map((s) => s.dataRef));
      // Background class (design P9): requests go first and keep a slot of their own.
      polling = withPriority("background", async () => {
        for (const s of scopes) await gaps.refresh([s.dataRef], warn, s);
        await gaps.refreshWindows(warn);
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
    // Data refs over the scan bound cost one count each and are left to a request (B7).
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
    // scope's events (add-scope Z9), as background work (preload after a preview's load, K10);
    // then the poll is scheduled. An object scope gets none: its density and gap info follow the
    // asked work windows (K11, speed-up-whole-scans B5).
    const stopScopePrefetch = catalogs.onLoaded((scope) => {
      if (isObjectScope(scope, workspaces)) return;
      const s: CacheScope = sourceScope(scope);
      chainPrefetch(deps, async () => {
        // Checked again when the job runs: the workspace may have unlinked meanwhile (K11).
        if (!wantsScopePrefetch(scope, holders())) return;
        try {
          await density.get(s.dataRef, s);
        } catch (error) {
          warn(`density prefetch for ${s.dataRef} failed: ${String(error)}`);
        }
        await polling;
        // The scope may have turned into an unlinked workspace's stand-in list meanwhile (K11).
        if (!wantsScopePrefetch(scope, holders())) return;
        await gaps.prefetch([s.dataRef], warn, s);
        if (timer === undefined) schedule();
      });
    });
    // A preview's warm work (K10), in the preview's class: the session's density, then the gap
    // info of the workspace's window signals; an object scope has neither of its own (K11, B5).
    const stopWarmer = addScopeWarmer(deps, async (scope, signals) => {
      if (scope.object) return;
      await density.get(scope.dataRef, scope);
      await gaps.get(scope.dataRef, signals, scope);
    });
    app.addHook("onClose", async () => {
      stopFill();
      stopPrefetch();
      stopScopePrefetch();
      stopWarmer();
      closed = true;
      if (timer !== undefined) clearTimeout(timer);
    });

    /**
     * Rows per bucket of a data ref over its whole extent (spec time-strip); with `from` and `to`
     * over that part of the scope (add-case-open K11), which an object scope needs (B5). In scoped
     * mode without a scope, `from` and `to` are the request's own window (B10). Within the scan
     * bound, else 422 `too_wide`.
     */
    app.get("/api/density", { config: { access: DENSITY_ACCESS } }, async (request, reply) => {
      const query = parseInput(DensityQuery, request.query, reply);
      if (!query) return reply;
      const { dataRef, from, to } = query;
      const own: Scope | undefined =
        from !== undefined && to !== undefined ? { dataRef, from, to } : undefined;
      const scoped = routeScope(deps, request, reply, own ? { ownWindow: own } : {});
      if (!scoped) return reply;
      const scope = scoped.source;
      if (scope && dataRef !== scope.dataRef) {
        return outOfScope(reply, `data ref ${dataRef} is outside the scope on ${scope.dataRef}`);
      }
      let part: DensityPart | undefined;
      if (own && scoped.scope) {
        let window: Scope | undefined;
        try {
          const w = workWindowOf(own, scoped.scope, bound.spanNs);
          window = w ? { dataRef, ...w } : cut(own, scope);
        } catch (error) {
          if (error instanceof WorkWindowError)
            return apiError(reply, 400, "invalid_request", error.message);
          if (error instanceof TooWideError) return tooWide(reply, error);
          throw error;
        }
        if (!window) return outOfScope(reply, "the range lies outside the scope");
        part = { window };
      } else if (own && !scope) {
        // Full mode without a scope: that window of the data ref.
        part = { window: own };
      } else if (scoped.scope?.object) {
        // No coarse density over the whole vehicle (B5).
        return apiError(
          reply,
          400,
          "invalid_request",
          "from and to are required in an object scope (the work window)",
        );
      }
      // Else the whole scope, the whole data ref (full mode), or the request's own window
      // (scoped mode without a scope), which `scope` then is.
      const visible = scoped.catalog;
      if (!scope && visible?.loadedAt && !visible.all().some((s) => s.dataRef === dataRef)) {
        return apiError(reply, 404, "unknown_data_ref", `unknown data ref: ${dataRef}`);
      }
      try {
        // Shared and cached, so a client close does not abort it (design T7).
        const cacheScope = scoped.scope ? cacheScopeOf(scoped.scope) : scope;
        const body = await density.get(dataRef, cacheScope, part);
        if (!body) return apiError(reply, 404, "no_data", `no data for data ref: ${dataRef}`);
        return body;
      } catch (error) {
        if (error instanceof TooWideError) return tooWide(reply, error);
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message);
      }
    });

    /**
     * Rows per hour and drives of one window of ≤ 32 d for the range picker (spec range-picker,
     * design R4 of add-range-picker), cut to the scope; an empty window answers zeros.
     */
    app.get("/api/calendar", { config: { access: DENSITY_ACCESS } }, async (request, reply) => {
      const query = parseInput(CalendarQuery, request.query, reply);
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
        // Shared and cached, so a client close does not abort it (as the density, design T7). A
        // plain scope's single bucket query goes behind the bound, sharing the scope's count (B2,
        // B6); the vehicle-days count themselves.
        return await withRequestClass(request, async () => {
          if (scope && !scoped.scope?.object) await bound.check(dataRef, scope);
          return calendar.get(
            dataRef,
            query.from,
            query.to,
            scoped.scope && cacheScopeOf(scoped.scope),
          );
        });
      } catch (error) {
        if (error instanceof TooWideError) return tooWide(reply, error);
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
      // One meaning per parameter (K10): `from`/`to` are the work window of an object scope only.
      if (!scoped.scope?.object && query.from !== undefined) {
        return apiError(
          reply,
          400,
          "invalid_request",
          "from and to apply in an object scope only (the work window)",
        );
      }
      let window: Scope | undefined;
      try {
        const w = workWindowOf(query, scoped.scope, bound.spanNs);
        if (w) window = { dataRef, ...w };
      } catch (error) {
        if (error instanceof WorkWindowError)
          return apiError(reply, 400, "invalid_request", error.message);
        if (error instanceof TooWideError) return tooWide(reply, error);
        throw error;
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
      // A new work window is polled from now on (K11): the next poll comes GAP_REFRESH_MS later.
      const windowKey = window && `${scopeKey(scoped.scope)} ${window.from} ${window.to}`;
      if (windowKey && !polledWindows.has(windowKey)) {
        if (polledWindows.size >= 64) polledWindows.clear();
        polledWindows.add(windowKey);
        schedule();
      }
      try {
        // Shared and cached, so a client close does not abort it.
        return await gaps.get(dataRef, signal, scoped.scope && cacheScopeOf(scoped.scope), window);
      } catch (error) {
        if (error instanceof TooWideError) return tooWide(reply, error);
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message);
      }
    });

    /** First and last timestamp of a signal (spec series-query, signal extent). */
    app.get("/api/extent", { config: { access: SIGNAL_ACCESS } }, async (request, reply) => {
      const query = parseInput(ExtentQuery, request.query, reply);
      if (!query) return reply;
      const computed = computedQuery(query);
      if (!computed.ok) {
        return apiError(reply, 400, "invalid_request", computed.message, {
          signalId: query.signal,
        });
      }
      const scoped =
        query.case === undefined
          ? routeScope(deps, request, reply)
          : await caseRouteScope(deps, request, reply, query.case);
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
      if (!ref || (!computed.params && catalog?.loadedAt && !catalog.get(query.signal))) {
        return apiError(reply, 404, "unknown_signal", `unknown signal: ${query.signal}`, {
          signalId: query.signal,
        });
      }
      // A computed signal's extent spans its inputs' (design C5); its inputs need the catalog.
      let refs: SignalRef[] = [ref];
      if (computed.params) {
        if (!catalog?.loadedAt) {
          return apiError(
            reply,
            503,
            "catalog_unavailable",
            "signal catalog not loaded yet; computed inputs cannot be checked",
            { signalId: query.signal },
          );
        }
        const resolved = resolveComputed(computed.params, ref.dataRef, catalog);
        if (!resolved.ok) return refuseComputed(reply, resolved);
        refs = resolved.inputs;
      }
      const controller = new AbortController();
      request.raw.on("close", () => {
        if (!reply.raw.writableEnded) controller.abort();
      });

      try {
        const extents = await withRequestClass(request, () =>
          Promise.all(refs.map((r) => source.extent(r, scope, controller.signal))),
        );
        // The latest first and the latest last of the inputs; a plain signal's own.
        let first: bigint | undefined;
        let last: bigint | undefined;
        for (const extent of extents) {
          if (!extent) {
            return apiError(reply, 404, "no_data", `no data for signal: ${query.signal}`, {
              signalId: query.signal,
            });
          }
          if (first === undefined || extent.first > first) first = extent.first;
          if (last === undefined || extent.last > last) last = extent.last;
        }
        const body: Extent = {
          signalId: query.signal,
          first: String(first),
          last: String(last),
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
      const computed = computedQuery(query);
      if (!computed.ok) {
        return apiError(reply, 400, "invalid_request", computed.message, {
          signalId: query.signal,
        });
      }
      const scoped =
        query.case === undefined
          ? routeScope(deps, request, reply)
          : await caseRouteScope(deps, request, reply, query.case);
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
      if (!ref || (!computed.params && !catalog.get(query.signal))) {
        return apiError(reply, 404, "unknown_signal", `unknown signal: ${query.signal}`, {
          signalId: query.signal,
        });
      }
      const resolved = computed.params && resolveComputed(computed.params, ref.dataRef, catalog);
      if (resolved && !resolved.ok) return refuseComputed(reply, resolved);

      // A client that goes away (e.g. after zooming on) aborts its queued and running queries.
      const controller = new AbortController();
      request.raw.on("close", () => {
        if (!reply.raw.writableEnded) controller.abort();
      });

      try {
        if (resolved) {
          // Hold limits from the gap info of the inputs (design C2, C8), cached like a value's.
          return await withRequestClass(request, async () => {
            const { inputs } = resolved;
            const info = await gaps.get(
              ref.dataRef,
              inputs.map((i) => `${i.dataRef}/${i.name}`),
              scoped.scope && cacheScopeOf(scoped.scope),
              rangeWindow(from, to, scoped.scope, bound.spanNs),
            );
            const computedRef: ComputedRef = {
              dataRef: ref.dataRef,
              ast: resolved.ast,
              inputs: inputs.map((i) => withSeed(i, undefined, holdOf(info, i))),
            };
            return queryComputed(
              source,
              computedRef,
              query.signal,
              from,
              to,
              query.target,
              scope,
              controller.signal,
              query.to - query.from,
            );
          });
        }
        return await withRequestClass(request, () =>
          querySeries(
            source,
            seriesRef(catalog.get(query.signal) as SignalInfo, catalog.snaRanges(query.signal)),
            query.signal,
            from,
            to,
            query.target,
            scope,
            controller.signal,
            query.to - query.from,
          ),
        );
      } catch (error) {
        if (controller.signal.aborted) return reply;
        const message = error instanceof Error ? error.message : String(error);
        // The server's own computation failed on valid input: a retry would fail again (design H2).
        if (error instanceof RangeError)
          return apiError(reply, 400, "invalid_request", message, range);
        // The fallback's row cap (design C8): the caller zooms in.
        if (error instanceof ComputedTooLargeError)
          return apiError(reply, 422, "computed_too_large", message, range);
        // The series fallback's or the gap info's scan bound (B2, B9).
        if (error instanceof TooWideError) return tooWide(reply, error);
        return apiError(reply, 502, "source_error", message, range);
      }
    });

    /** Value of a signal at one time from its raw neighbours (spec series-query, design C4/S3). */
    app.get("/api/value", { config: { access: SIGNAL_ACCESS } }, async (request, reply) => {
      const query = parseInput(ValueQuery, request.query, reply);
      if (!query) return reply;
      const details = { signalId: query.signal };
      const computed = computedQuery(query);
      if (!computed.ok) return apiError(reply, 400, "invalid_request", computed.message, details);
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
      const signalRef = parseSignalId(query.signal);
      if (signalRef && computed.params) {
        const resolved = resolveComputed(computed.params, signalRef.dataRef, catalog);
        if (!resolved.ok) return refuseComputed(reply, resolved);
        const controller = new AbortController();
        request.raw.on("close", () => {
          if (!reply.raw.writableEnded) controller.abort();
        });
        try {
          // Each input's raw neighbours and the gap info of the inputs (design C4).
          const { inputs } = resolved;
          const [neighbours, gapInfo] = await Promise.all([
            Promise.all(
              inputs.map((i) =>
                Promise.all([
                  source.before(i, query.t + 1n, scope, controller.signal),
                  source.after(i, query.t + 1n, scope, controller.signal),
                ]),
              ),
            ),
            gaps.get(
              signalRef.dataRef,
              inputs.map((i) => `${i.dataRef}/${i.name}`),
              scoped.scope && cacheScopeOf(scoped.scope),
              valueWindow(query.t, scoped.scope, bound.spanNs),
            ),
          ]);
          const near = (i: number) => {
            const [at, next] = neighbours[i] as [RawPoint | undefined, RawPoint | undefined];
            const n: { at?: RawPoint; next?: RawPoint; holdNs?: bigint } = {};
            if (at) n.at = at;
            if (next) n.next = next;
            const hold = holdOf(gapInfo, inputs[i] as SeriesRef);
            if (hold !== undefined) n.holdNs = hold;
            return n;
          };
          const result = computedValueAt(
            query.t,
            query.mode,
            resolved.ast,
            inputs.map((_, i) => near(i)),
            computedSignalGaps(
              gapInfo,
              signalRef.dataRef,
              inputs.map((i) => i.name),
            ),
          );
          const body: CursorValueResult = {
            signalId: query.signal,
            t: query.t.toString(),
            mode: query.mode,
            value: result.value,
          };
          if (result.at) body.at = edgePoint(result.at, false);
          if (result.next) body.next = edgePoint(result.next, false);
          return body;
        } catch (error) {
          if (controller.signal.aborted) return reply;
          // Without bounded gap info there is no value (series-query "Value when its gap info is too wide").
          if (error instanceof TooWideError) return tooWide(reply, error);
          const message = error instanceof Error ? error.message : String(error);
          return apiError(reply, 502, "source_error", message, details);
        }
      }
      const info = catalog.get(query.signal);
      if (!signalRef || !info) {
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
          // Its own period only, not every signal's (design P6); in an object scope the gap info
          // of the work window around t (add-case-open K11).
          gaps.get(
            info.dataRef,
            [query.signal],
            scoped.scope && cacheScopeOf(scoped.scope),
            valueWindow(query.t, scoped.scope, bound.spanNs),
          ),
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
        if (error instanceof TooWideError) return tooWide(reply, error);
        const message = error instanceof Error ? error.message : String(error);
        return apiError(reply, 502, "source_error", message, details);
      }
    });
  };

/**
 * The work window of `[t, t + 1 ns)` in an object scope (add-case-open K11), at most `maxSpanNs`
 * (B3); else undefined.
 */
const valueWindow = (
  t: bigint,
  scope: WorkspaceScope | undefined,
  maxSpanNs: bigint,
): Scope | undefined => rangeWindow(t, t + 1n, scope, maxSpanNs);

/**
 * The work window of `[from, to)` in an object scope (add-case-open K11), at most `maxSpanNs`
 * (B3); else undefined.
 */
function rangeWindow(
  from: bigint,
  to: bigint,
  scope: WorkspaceScope | undefined,
  maxSpanNs: bigint,
): Scope | undefined {
  if (!scope?.object) return undefined;
  const w = workWindow({ from: from.toString(), to: to.toString() }, scope, maxSpanNs);
  return { dataRef: scope.dataRef, from: BigInt(w.from), to: BigInt(w.to) };
}

/** Value query ref of a catalog signal; text signals read their row text (add-events N3). */
function seriesRef(info: SignalInfo, sna: SeriesRef["sna"]): SeriesRef {
  const ref: SeriesRef = { dataRef: info.dataRef, name: info.name, sna };
  if (info.states === "text") ref.text = true;
  return ref;
}
