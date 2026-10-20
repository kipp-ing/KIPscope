import {
  type CaseOpenReport,
  type CreateWorkspaceAnswer,
  CreateWorkspaceRequest,
  caseScope,
  isTimeseries,
  MAX_CASES_TEXT,
  type OpenViewRequest,
  openCase,
  PREVIOUS_VIEW,
  parseSignalId,
  rebindLayout,
  ShareRequest,
  WORKSPACE_HEADER,
  WORKSPACE_ID,
  type Workspace,
  type WorkspaceAnswer,
  type WorkspaceList,
} from "@kipscope/shared";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import { CaseOpenError, readCases } from "../case.ts";
import { defaultFinderConfig } from "../config.ts";
import type { Access } from "../guard.ts";
import { apiError, catalogsOf, parseInput, userOf } from "../http.ts";
import { catalogView, dataRefsOfView, workspaceRights } from "../rights.ts";
import type { ViewStore } from "../views.ts";
import {
  GrantLimitError,
  summaryOf,
  type WorkspaceEntry,
  WorkspaceLimitError,
} from "../workspaces.ts";
import { alignmentOf } from "./case.ts";
import { runCommand } from "./workspace.ts";

/** Largest body of `POST /api/workspaces`: a `cases` string of MAX_CASES_TEXT plus its envelope. */
const CREATE_BODY_LIMIT = MAX_CASES_TEXT + 65_536;

const IdParams = z.object({ id: z.string() });

const USER: { access: Access } = { access: { level: "user" } };

/** The requester's view store; undefined when the app has none. */
function viewsFor(deps: AppDeps, request: FastifyRequest): ViewStore | undefined {
  return deps.viewsOf ? deps.viewsOf(userOf(request).identity.user) : deps.views;
}

/** The view document a create request opens: its `view`, or the saved view it names. */
function openedView(
  deps: AppDeps,
  request: FastifyRequest,
  open: OpenViewRequest,
):
  | { ok: true; view: unknown; name?: string }
  | { ok: false; status: number; code: string; message: string } {
  if ("view" in open) return { ok: true, view: open.view };
  const views = viewsFor(deps, request);
  if (!views)
    return { ok: false, status: 404, code: "unknown_view", message: `no view ${open.name}` };
  // `?view=` carries a name or the title the Views menu shows.
  const resolved = views.resolve(open.name);
  if (!resolved.ok) return resolved;
  const { name } = resolved;
  const data = views.data(name);
  if (data === undefined)
    return { ok: false, status: 404, code: "unknown_view", message: `no view ${name}` };
  if (!data.ok)
    return {
      ok: false,
      status: 422,
      code: "invalid_view",
      message: `view ${name}: ${data.message}`,
    };
  return { ok: true, view: data.data, name };
}

/**
 * Data refs of `POST /api/workspaces`: the opened view's, checked against the grant the new
 * workspace gets (design M6); none for a body that is refused anyway.
 */
function createDataRefs(deps: AppDeps) {
  return (request: FastifyRequest): string[] => {
    const body = CreateWorkspaceRequest.safeParse(request.body ?? {});
    // A catalog names none: its signature is the access decision for its objects (add-case-open K5).
    if (!body.success || !body.data.open || "cases" in body.data.open) return [];
    const view = openedView(deps, request, body.data.open);
    return view.ok ? dataRefsOfView(view.view) : [];
  };
}

/** A layout without the open view of the workspace it came from. */
function withoutView(workspace: Workspace): Workspace {
  const { view: _view, ...rest } = workspace;
  return rest;
}

/** The data ref a layout's signals are on (K8): its scope's, else its first window signal's. */
function layoutRef(workspace: Workspace): string | undefined {
  if (workspace.scope) return workspace.scope.dataRef;
  for (const w of workspace.windows)
    if (isTimeseries(w))
      for (const s of w.signals) {
        const ref = parseSignalId(s.signalId)?.dataRef;
        if (ref !== undefined) return ref;
      }
  return undefined;
}

/**
 * Workspace management (add-multiuser M7): the requester's own workspaces, owner-only share and
 * delete. Sharing `read` or `write` needs `KIPSCOPE_SHARE` on (always on with identity `none`).
 */
export const workspacesRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const { workspaces } = deps;
    const canShare = deps.identity === undefined || deps.share !== false;

    /** The workspace `:id` names, else 404 `unknown_workspace` (sent) and undefined. */
    const named = (request: FastifyRequest, reply: FastifyReply): WorkspaceEntry | undefined => {
      const { id } = IdParams.parse(request.params);
      const entry = WORKSPACE_ID.test(id) ? workspaces.get(id) : undefined;
      if (!entry) apiError(reply, 404, "unknown_workspace", "no such workspace");
      return entry;
    };

    /** The owner check of share and delete: 403 `not_owner` (sent) and false for anyone else. */
    const owns = (request: FastifyRequest, reply: FastifyReply, entry: WorkspaceEntry): boolean => {
      if (entry.record.owner === userOf(request).identity.user) return true;
      apiError(reply, 403, "not_owner", "only the owner may change or delete this workspace");
      return false;
    };

    /** The summary with the requester's rights and the workspace's effective grant. */
    const summary = (request: FastifyRequest, entry: WorkspaceEntry) =>
      summaryOf(
        entry,
        workspaceRights(userOf(request).identity.user, entry),
        workspaces.grantOf(entry.record.id),
      );

    const limited = (reply: FastifyReply, error: unknown) => {
      if (error instanceof WorkspaceLimitError)
        return apiError(reply, 409, "workspace_limit", error.message);
      throw error;
    };

    app.get("/api/workspaces", { config: USER }, async (request) => {
      const { identity } = userOf(request);
      const list: WorkspaceList = {
        workspaces: workspaces.listOf(identity.user).map((entry) => summary(request, entry)),
      };
      return list;
    });

    /**
     * `POST /api/workspaces {open: {cases}}` (add-case-open K9): checks the catalog, creates the
     * workspace, widens its grant by the catalog's data refs, lays out the current session (the
     * payload's view, else the latest own workspace with a window), writes the catalog file and
     * answers the open report. Any failure after the create deletes the workspace again.
     */
    const openCases = async (
      request: FastifyRequest,
      reply: FastifyReply,
      cases: string | Record<string, unknown>,
    ) => {
      const user = userOf(request).identity.user;
      const identity = deps.identity ? "other" : "none";
      let read: Awaited<ReturnType<typeof readCases>>;
      try {
        read = await readCases(
          cases,
          deps.finder ?? defaultFinderConfig(),
          identity,
          identity === "none" ? undefined : user,
        );
      } catch (error) {
        if (!(error instanceof CaseOpenError)) throw error;
        // Reason and key ID only: the catalog itself is never logged.
        if (error.reason !== undefined)
          request.log.debug({ reason: error.reason, kid: error.kid }, "catalog refused");
        return apiError(
          reply,
          error.status,
          error.code,
          error.message,
          error.reason === undefined ? {} : { reason: error.reason },
        );
      }
      const { catalog, current, pad, align } = read;
      const warnings = [...read.warnings];
      const entry = catalog.entries[current];
      if (!entry) throw new Error("readCases gave no current entry");
      const dataRefs = [...new Set(catalog.entries.map((e) => e.dataRef))];
      // A named view must exist before anything is created.
      let view: { view: unknown; name?: string } | undefined;
      if (read.view !== undefined) {
        const opened = openedView(
          deps,
          request,
          typeof read.view === "string" ? { name: read.view } : { view: read.view },
        );
        if (!opened.ok) return apiError(reply, opened.status, opened.code, opened.message);
        view = opened;
      }
      const latest = view
        ? undefined
        : workspaces.listOf(user).find((e) => e.store.workspace.windows.length > 0);
      let created: WorkspaceEntry;
      try {
        created = workspaces.create(user);
      } catch (error) {
        return limited(reply, error);
      }
      const { id } = created.record;
      const fail = (status: number, code: string, message: string, extra = {}) => {
        workspaces.delete(id);
        return apiError(reply, status, code, message, extra);
      };
      try {
        workspaces.grantObjects(id, dataRefs);
      } catch (error) {
        if (error instanceof GrantLimitError) return fail(409, "grant_limit", error.message);
        throw error;
      }
      const scope = caseScope(entry, pad);
      const catalogs = catalogsOf(deps);
      let list: Awaited<ReturnType<typeof catalogs.load>>;
      try {
        list = await catalogs.load(scope);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail(
          503,
          "catalog_unavailable",
          `signal list of the session not loaded: ${message}`,
          {
            reason: catalogs.get(scope)?.unavailableReason ?? message,
          },
        );
      }
      // The layout: the latest workspace (or the new one's seed) moved onto the session's vehicle.
      const source = latest?.store.workspace ?? created.store.workspace;
      const { workspace: layout, warnings: dropped } = rebindLayout(
        withoutView(source),
        layoutRef(source) ?? entry.dataRef,
        entry.dataRef,
      );
      warnings.push(...dropped);
      let point: { t: string; fallback: boolean };
      try {
        point = await alignmentOf(
          deps,
          entry,
          align,
          pad,
          (layout.eventSignals ?? []).filter((s) => parseSignalId(s)?.dataRef === entry.dataRef),
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return fail(502, "source_error", message);
      }
      const visible = catalogView(list, workspaces.grantOf(id));
      const layoutAlignAt = latest?.store.workspace.case?.alignAt;
      const opened = openCase({
        catalog,
        current,
        pad,
        align,
        alignAt: point.t,
        ...(point.fallback ? { alignFallback: true } : {}),
        layout,
        ...(layoutAlignAt === undefined ? {} : { layoutAlignAt }),
        known: (signalId) => visible.get(signalId) !== undefined,
      });
      const missing = new Set(opened.missing);
      let caseEntry: WorkspaceEntry | undefined;
      try {
        caseEntry = workspaces.openCase(id, opened.workspace, catalog);
      } catch (error) {
        workspaces.delete(id);
        throw error;
      }
      if (!caseEntry) return fail(404, "unknown_workspace", "the new workspace is gone");
      if (view) {
        // The same path as POST /api/views/open in the new case workspace (K6, K8).
        const command =
          view.name === undefined || view.name === PREVIOUS_VIEW
            ? { type: "view.open", view: view.view }
            : { type: "view.open", name: view.name, view: view.view };
        const result = await runCommand(deps, command, reply, {
          entry: caseEntry,
          beforeOpen: () => {},
        });
        if (!result.ok) {
          workspaces.delete(id);
          return result;
        }
        missing.clear();
        for (const signalId of result.report?.missing ?? []) missing.add(signalId);
        warnings.push(...(result.report?.warnings ?? []));
        reply.code(200);
      }
      const report: CaseOpenReport = {
        count: catalog.entries.length,
        current,
        dataRefs,
        missing: [...missing].sort(),
        ...(point.fallback ? { alignFallback: true as const } : {}),
        warnings,
      };
      reply.header(WORKSPACE_HEADER, id);
      const answer: CreateWorkspaceAnswer = {
        workspace: summary(request, caseEntry),
        case: report,
      };
      return answer;
    };

    app.post(
      "/api/workspaces",
      {
        bodyLimit: CREATE_BODY_LIMIT,
        config: { access: { level: "user", dataRefs: createDataRefs(deps) } },
      },
      async (request, reply) => {
        // A catalog too long is a bad catalog, not a bad request (add-case-open K4 step 1).
        const cases = (request.body as { open?: { cases?: unknown } } | undefined)?.open?.cases;
        if (typeof cases === "string" && cases.length > MAX_CASES_TEXT)
          return apiError(
            reply,
            400,
            "invalid_catalog",
            `cases: longer than ${MAX_CASES_TEXT} characters`,
          );
        // Strict: an unknown key such as `grant` answers 400 and creates nothing (M3).
        const body = parseInput(CreateWorkspaceRequest, request.body ?? {}, reply);
        if (!body) return reply;
        if (body.reuse && body.open)
          return apiError(reply, 400, "invalid_request", "reuse and open do not go together");
        if (body.open && "cases" in body.open) return openCases(request, reply, body.open.cases);
        const user = userOf(request).identity.user;
        const view = body.open && openedView(deps, request, body.open);
        if (view && !view.ok) return apiError(reply, view.status, view.code, view.message);
        let entry: WorkspaceEntry;
        let reused: boolean | undefined;
        try {
          if (body.reuse) ({ entry, reused } = workspaces.reuseOf(user));
          else entry = workspaces.create(user);
        } catch (error) {
          return limited(reply, error);
        }
        if (!view) {
          reply.header(WORKSPACE_HEADER, entry.record.id);
          const answer: CreateWorkspaceAnswer = {
            workspace: summary(request, entry),
            ...(reused === undefined ? {} : { reused }),
          };
          return answer;
        }
        // The same path as POST /api/views/open, in the new workspace; its empty state is no
        // `_previous` worth keeping.
        const command =
          view.name === undefined || view.name === PREVIOUS_VIEW
            ? { type: "view.open", view: view.view }
            : { type: "view.open", name: view.name, view: view.view };
        const result = await runCommand(deps, command, reply, { entry, beforeOpen: () => {} });
        if (!result.ok) {
          // One step: a failed open leaves no workspace behind.
          workspaces.delete(entry.record.id);
          return result;
        }
        reply.header(WORKSPACE_HEADER, entry.record.id);
        const answer: CreateWorkspaceAnswer = { workspace: summary(request, entry), result };
        return answer;
      },
    );

    app.get("/api/workspaces/:id", { config: USER }, async (request, reply) => {
      const entry = named(request, reply);
      if (!entry) return reply;
      const answer: WorkspaceAnswer = { workspace: summary(request, entry) };
      // Without the open right the summary has no rights: 403 like every workspace route (M6).
      if (!answer.workspace.rights)
        return apiError(reply, 403, "forbidden", "no access to this workspace");
      return answer;
    });

    app.post("/api/workspaces/:id/share", { config: USER }, async (request, reply) => {
      const entry = named(request, reply);
      if (!entry || !owns(request, reply, entry)) return reply;
      const body = parseInput(ShareRequest, request.body, reply);
      if (!body) return reply;
      if (body.share !== "private" && !canShare)
        return apiError(
          reply,
          403,
          "share_not_permitted",
          "sharing is turned off on this server (KIPSCOPE_SHARE)",
        );
      const answer: WorkspaceAnswer = {
        workspace: summary(request, workspaces.setShare(entry.record.id, body.share)),
      };
      return answer;
    });

    app.delete("/api/workspaces/:id", { config: USER }, async (request, reply) => {
      const entry = named(request, reply);
      if (!entry || !owns(request, reply, entry)) return reply;
      const { id } = entry.record;
      if (!workspaces.delete(id))
        return apiError(reply, 404, "unknown_workspace", "no such workspace");
      return { deleted: id };
    });
  };
