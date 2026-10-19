import {
  ImportViewRequest,
  MAX_VIEW_BYTES,
  OpenViewRequest,
  PREVIOUS_VIEW,
  parseViewDoc,
  SaveViewRequest,
  VIEW_NAME,
  type ViewDoc,
  type ViewSummary,
  viewName,
  workspaceToView,
} from "@kipscope/shared";
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import type { Access } from "../guard.ts";
import { apiError, parseInput, sessionOf, userOf } from "../http.ts";
import { dataRefsOfView } from "../rights.ts";
import { parseViewText, savedNow, type ViewStore, validViewName, viewSummary } from "../views.ts";
import { type CommandAnswer, runCommand } from "./workspace.ts";

const NameParams = z.object({ name: z.string() });

function invalidName(reply: FastifyReply, name: string) {
  return apiError(reply, 400, "invalid_view_name", `not a valid view name: ${name}`);
}

/** 409 with the view that is in the way, so the UI can ask "Replace?". */
function viewExists(reply: FastifyReply, existing: ViewSummary) {
  return reply.code(409).send({
    error: { code: "view_exists", message: `view ${existing.name} exists`, existing },
  });
}

/**
 * Opens a view like POST /api/commands in the request's session, its scope's signal list loaded
 * first (add-scope Z10); the workspace it replaces becomes the requester's `_previous` (M9).
 */
function open(
  deps: AppDeps,
  reply: FastifyReply,
  views: ViewStore,
  view: unknown,
  name?: string,
): Promise<CommandAnswer> {
  // Opening `_previous` names no view, so a save afterwards asks for a title instead of failing.
  const command =
    name === undefined || name === PREVIOUS_VIEW
      ? { type: "view.open", view }
      : { type: "view.open", name, view };
  return runCommand(deps, command, reply, { beforeOpen: (previous) => views.beforeOpen(previous) });
}

/** The view document a request names: the body's, or the requester's saved view by name. */
function namedView(views: ViewStore, body: unknown): unknown {
  const parsed = OpenViewRequest.safeParse(body);
  if (!parsed.success) return undefined;
  if ("view" in parsed.data) return parsed.data.view;
  const data = views.data(parsed.data.name);
  return data?.ok ? data.data : undefined;
}

/** The document of an import body: its text as parsed, if it parses and fits. */
function importedView(body: unknown): unknown {
  const parsed = ImportViewRequest.safeParse(body);
  if (!parsed.success || Buffer.byteLength(parsed.data.text) > MAX_VIEW_BYTES) return undefined;
  const text = parseViewText(parsed.data.text);
  return text.ok ? text.data : undefined;
}

/**
 * Saved views (design V6), each user's own (add-multiuser M9); registered only when the app has a
 * view store.
 */
export const viewRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const { viewsOf, views: shared } = deps;
    if (!viewsOf && !shared) return;
    /** The requester's view store. */
    const viewsFor = (request: FastifyRequest): ViewStore =>
      viewsOf ? viewsOf(userOf(request).identity.user) : (shared as ViewStore);

    // Access per route (design M6): listing and files are the user's own; save, open and an
    // import that opens change the session; the data refs of a view opened or imported are checked.
    const USER: { access: Access } = { access: { level: "user" } };
    const SAVE: { access: Access } = { access: { level: "change" } };
    const OPEN: { access: Access } = {
      access: {
        level: "change",
        dataRefs: (request) => dataRefsOfView(namedView(viewsFor(request), request.body)),
      },
    };
    const IMPORT: { access: Access } = {
      access: {
        level: {
          body: (request) =>
            (request.body as { open?: unknown } | undefined)?.open === true ? "change" : "user",
        },
        dataRefs: (request) => dataRefsOfView(importedView(request.body)),
      },
    };

    app.get("/api/views", { config: USER }, async (request) => ({
      views: viewsFor(request).list(),
    }));

    app.get("/api/views/:name", { config: USER }, async (request, reply) => {
      const views = viewsFor(request);
      const { name } = NameParams.parse(request.params);
      if (!validViewName(name)) return invalidName(reply, name);
      const text = views.read(name);
      if (text === undefined) return apiError(reply, 404, "unknown_view", `no view ${name}`);
      reply.type("application/yaml; charset=utf-8");
      if ((request.query as Record<string, unknown>).download === "1")
        reply.header("content-disposition", `attachment; filename="${name}.kipscope.yaml"`);
      return text;
    });

    app.post("/api/views", { config: SAVE }, async (request, reply) => {
      const views = viewsFor(request);
      const { store: workspace } = sessionOf(request);
      const body = parseInput(SaveViewRequest, request.body, reply);
      if (!body) return reply;
      const name = body.name ?? viewName(body.title);
      // `_previous` is the store's own; it cannot be the target of a save.
      if (!VIEW_NAME.test(name)) return invalidName(reply, name);
      const existing = views.exists(name) ? views.summary(name) : undefined;
      if (existing && body.overwrite !== true) return viewExists(reply, existing);
      // Snapshot, write and mark in one tick: no command can fall in between.
      const meta = {
        title: body.title,
        saved: savedNow(),
        ...(body.note === undefined ? {} : { note: body.note }),
      };
      const doc = workspaceToView(workspace.workspace, meta);
      try {
        views.write(name, doc);
      } catch (error) {
        return apiError(reply, 500, "view_io_failed", `view ${name} not written: ${String(error)}`);
      }
      const marked = workspace.execute({
        type: "view.markSaved",
        name,
        title: body.title,
        ...(body.note === undefined ? {} : { note: body.note }),
      });
      if (!marked.ok) return apiError(reply, 500, "view_io_failed", marked.message);
      return { view: viewSummary(name, doc), revision: marked.revision };
    });

    app.post("/api/views/open", { config: OPEN }, async (request, reply) => {
      const views = viewsFor(request);
      const body = parseInput(OpenViewRequest, request.body, reply);
      if (!body) return reply;
      if ("view" in body) return open(deps, reply, views, body.view);
      const { name } = body;
      if (!validViewName(name)) return invalidName(reply, name);
      // Read before executing: opening `_previous` reads it before the hook replaces it.
      const data = views.data(name);
      if (data === undefined) return apiError(reply, 404, "unknown_view", `no view ${name}`);
      if (!data.ok) return apiError(reply, 422, "invalid_view", `view ${name}: ${data.message}`);
      return open(deps, reply, views, data.data, name);
    });

    app.delete("/api/views/:name", { config: USER }, async (request, reply) => {
      const views = viewsFor(request);
      const { name } = NameParams.parse(request.params);
      if (!validViewName(name)) return invalidName(reply, name);
      if (!views.remove(name)) return apiError(reply, 404, "unknown_view", `no view ${name}`);
      return { deleted: name };
    });

    app.post("/api/views/import", { config: IMPORT }, async (request, reply) => {
      const views = viewsFor(request);
      const body = parseInput(ImportViewRequest, request.body, reply);
      if (!body) return reply;
      const bytes = Buffer.byteLength(body.text);
      if (bytes > MAX_VIEW_BYTES)
        return apiError(
          reply,
          413,
          "view_too_large",
          `view text has ${bytes} bytes; at most ${MAX_VIEW_BYTES}`,
        );
      const text = parseViewText(body.text);
      if (!text.ok) return apiError(reply, 400, "invalid_view_yaml", text.message);
      const parsed = parseViewDoc(text.data);
      if (!parsed.ok) return apiError(reply, 400, parsed.code, parsed.message);
      const name = body.name ?? viewName(parsed.doc.title);
      if (!VIEW_NAME.test(name)) return invalidName(reply, name);
      const existing = views.exists(name) ? views.summary(name) : undefined;
      if (existing && body.overwrite !== true) return viewExists(reply, existing);
      // Stored in canonical form (key order of ViewDoc), saved here and now.
      const { kipscope, version, title, note, saved: _uploaded, ...rest } = parsed.doc;
      const doc: ViewDoc = {
        kipscope,
        version,
        title,
        ...(note === undefined ? {} : { note }),
        saved: savedNow(),
        ...rest,
      };
      try {
        views.write(name, doc);
      } catch (error) {
        return apiError(reply, 500, "view_io_failed", `view ${name} not written: ${String(error)}`);
      }
      const answer: { view: ViewSummary; warnings: string[]; opened?: CommandAnswer } = {
        view: viewSummary(name, doc),
        warnings: parsed.warnings,
      };
      // The view is stored either way; `opened` tells whether it opened (503 when its scope's list
      // did not load).
      if (body.open === true) {
        const opened = await runCommand(deps, { type: "view.open", name, view: doc }, reply, {
          beforeOpen: (previous) => views.beforeOpen(previous),
        });
        answer.opened = opened;
        reply.code(!opened.ok && "reason" in opened ? 503 : 200);
      }
      return answer;
    });
  };
