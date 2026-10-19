import {
  type CreateSessionAnswer,
  CreateSessionRequest,
  PREVIOUS_VIEW,
  SESSION_ID,
  type SessionAnswer,
  type SessionList,
  ShareRequest,
} from "@kipscope/shared";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import type { Access } from "../guard.ts";
import { apiError, parseInput, userOf } from "../http.ts";
import { dataRefsOfView, sessionRights } from "../rights.ts";
import { type Session, SessionLimitError, seedFor, summaryOf } from "../sessions.ts";
import { type ViewStore, validViewName } from "../views.ts";
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
  open: NonNullable<CreateSessionRequest["open"]>,
):
  | { ok: true; view: unknown; name?: string }
  | { ok: false; status: number; code: string; message: string } {
  if ("view" in open) return { ok: true, view: open.view };
  const { name } = open;
  if (!validViewName(name))
    return {
      ok: false,
      status: 400,
      code: "invalid_view_name",
      message: `not a valid view name: ${name}`,
    };
  const data = viewsFor(deps, request)?.data(name);
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

/** Data refs of `POST /api/sessions`: the opened view's (design M6); none for a body that is refused anyway. */
function createDataRefs(deps: AppDeps) {
  return (request: FastifyRequest): string[] => {
    const body = CreateSessionRequest.safeParse(request.body ?? {});
    if (!body.success || !body.data.open) return [];
    const view = openedView(deps, request, body.data.open);
    return view.ok ? dataRefsOfView(view.view) : [];
  };
}

/** Session management (add-multiuser M7): the requester's own sessions, owner-only share and delete. */
export const sessionRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const { sessions } = deps;

    /** The session `:id` names, else 404 `unknown_session` (sent) and undefined. */
    const named = (request: FastifyRequest, reply: FastifyReply): Session | undefined => {
      const { id } = IdParams.parse(request.params);
      const session = SESSION_ID.test(id) ? sessions.get(id) : undefined;
      if (!session) apiError(reply, 404, "unknown_session", "no such session");
      return session;
    };

    /** The owner check of share and delete: 403 `not_owner` (sent) and false for anyone else. */
    const owns = (request: FastifyRequest, reply: FastifyReply, session: Session): boolean => {
      if (session.record.owner === userOf(request).identity.user) return true;
      apiError(reply, 403, "not_owner", "only the owner may change or delete this session");
      return false;
    };

    const summary = (request: FastifyRequest, session: Session) => {
      const { identity, rights } = userOf(request);
      return summaryOf(session, sessionRights(identity.user, rights, session));
    };

    app.get("/api/sessions", { config: USER }, async (request) => {
      const { identity } = userOf(request);
      // An own session holding data the user may no longer see is listed without `rights`.
      const list: SessionList = {
        sessions: sessions.listOf(identity.user).map((s) => summary(request, s)),
      };
      return list;
    });

    app.post(
      "/api/sessions",
      { config: { access: { level: "user", dataRefs: createDataRefs(deps) } } },
      async (request, reply) => {
        const body = parseInput(CreateSessionRequest, request.body ?? {}, reply);
        if (!body) return reply;
        const { identity, rights } = userOf(request);
        const view = body.open && openedView(deps, request, body.open);
        if (view && !view.ok) return apiError(reply, view.status, view.code, view.message);
        let session: Session;
        try {
          session = sessions.create(identity.user, seedFor(sessions.seed(), rights));
        } catch (error) {
          if (error instanceof SessionLimitError)
            return apiError(reply, 409, "session_limit", error.message);
          throw error;
        }
        if (!view) {
          const answer: CreateSessionAnswer = { session: summary(request, session) };
          return answer;
        }
        // The same path as POST /api/views/open, in the new session; its empty workspace is no
        // `_previous` worth keeping.
        const command =
          view.name === undefined || view.name === PREVIOUS_VIEW
            ? { type: "view.open", view: view.view }
            : { type: "view.open", name: view.name, view: view.view };
        const result = await runCommand(deps, command, reply, { session, beforeOpen: () => {} });
        if (!result.ok) {
          // One step: a failed open leaves no session behind.
          sessions.delete(session.record.id);
          return result;
        }
        const answer: CreateSessionAnswer = { session: summary(request, session), result };
        return answer;
      },
    );

    app.get("/api/sessions/:id", { config: USER }, async (request, reply) => {
      const session = named(request, reply);
      if (!session) return reply;
      const { identity, rights } = userOf(request);
      const own = sessionRights(identity.user, rights, session);
      // Private and holding hidden data answer alike (design M6).
      if (!own) return apiError(reply, 403, "forbidden", "no access to this session");
      const answer: SessionAnswer = { session: summaryOf(session, own) };
      return answer;
    });

    app.post("/api/sessions/:id/share", { config: USER }, async (request, reply) => {
      const session = named(request, reply);
      if (!session || !owns(request, reply, session)) return reply;
      const body = parseInput(ShareRequest, request.body, reply);
      if (!body) return reply;
      if (body.share !== "private" && !userOf(request).rights.share)
        return apiError(
          reply,
          403,
          "share_not_permitted",
          "your roles do not allow sharing sessions",
        );
      const answer: SessionAnswer = {
        session: summary(request, sessions.setShare(session.record.id, body.share)),
      };
      return answer;
    });

    app.delete("/api/sessions/:id", { config: USER }, async (request, reply) => {
      const session = named(request, reply);
      if (!session || !owns(request, reply, session)) return reply;
      const { id } = session.record;
      if (!sessions.delete(id)) return apiError(reply, 404, "unknown_session", "no such session");
      return { deleted: id };
    });
  };
