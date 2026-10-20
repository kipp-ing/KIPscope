import {
  type CreateWorkspaceAnswer,
  CreateWorkspaceRequest,
  PREVIOUS_VIEW,
  ShareRequest,
  WORKSPACE_HEADER,
  WORKSPACE_ID,
  type WorkspaceAnswer,
  type WorkspaceList,
} from "@kipscope/shared";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import type { Access } from "../guard.ts";
import { apiError, parseInput, userOf } from "../http.ts";
import { dataRefsOfView, workspaceRights } from "../rights.ts";
import type { ViewStore } from "../views.ts";
import { summaryOf, type WorkspaceEntry, WorkspaceLimitError } from "../workspaces.ts";
import { runCommand } from "./workspace.ts";

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
  open: NonNullable<CreateWorkspaceRequest["open"]>,
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
    if (!body.success || !body.data.open) return [];
    const view = openedView(deps, request, body.data.open);
    return view.ok ? dataRefsOfView(view.view) : [];
  };
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

    app.post(
      "/api/workspaces",
      { config: { access: { level: "user", dataRefs: createDataRefs(deps) } } },
      async (request, reply) => {
        // Strict: an unknown key such as `grant` answers 400 and creates nothing (M3).
        const body = parseInput(CreateWorkspaceRequest, request.body ?? {}, reply);
        if (!body) return reply;
        if (body.reuse && body.open)
          return apiError(reply, 400, "invalid_request", "reuse and open do not go together");
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
