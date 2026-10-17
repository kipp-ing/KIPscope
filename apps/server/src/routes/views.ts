import {
  type CommandResult,
  ImportViewRequest,
  MAX_VIEW_BYTES,
  PREVIOUS_VIEW,
  parseViewDoc,
  SaveViewRequest,
  VIEW_NAME,
  type ViewDoc,
  type ViewSummary,
  viewName,
  workspaceToView,
} from "@kipscope/shared";
import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../app.ts";
import { apiError, commandStatus, parseInput } from "../http.ts";
import { parseViewText, savedNow, validViewName, viewSummary } from "../views.ts";
import type { WorkspaceStore } from "../workspace.ts";

const OpenBody = z.union([
  z.object({ name: z.string() }),
  z.object({ view: z.record(z.string(), z.unknown()) }),
]);

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

function open(
  workspace: WorkspaceStore,
  reply: FastifyReply,
  view: unknown,
  name?: string,
): CommandResult {
  // Opening `_previous` names no view, so a save afterwards asks for a title instead of failing.
  const command =
    name === undefined || name === PREVIOUS_VIEW
      ? { type: "view.open", view }
      : { type: "view.open", name, view };
  const result = workspace.execute(command);
  reply.code(commandStatus(result));
  return result;
}

/** Saved views (design V6); registered only when the app has a `ViewStore`. */
export const viewRoutes =
  ({ workspace, views }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    if (!views) return;

    app.get("/api/views", async () => ({ views: views.list() }));

    app.get("/api/views/:name", async (request, reply) => {
      const { name } = NameParams.parse(request.params);
      if (!validViewName(name)) return invalidName(reply, name);
      const text = views.read(name);
      if (text === undefined) return apiError(reply, 404, "unknown_view", `no view ${name}`);
      reply.type("application/yaml; charset=utf-8");
      if ((request.query as Record<string, unknown>).download === "1")
        reply.header("content-disposition", `attachment; filename="${name}.kipscope.yaml"`);
      return text;
    });

    app.post("/api/views", async (request, reply) => {
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

    app.post("/api/views/open", async (request, reply) => {
      const body = parseInput(OpenBody, request.body, reply);
      if (!body) return reply;
      if ("view" in body) return open(workspace, reply, body.view);
      const { name } = body;
      if (!validViewName(name)) return invalidName(reply, name);
      // Read before executing: opening `_previous` reads it before the hook replaces it.
      const data = views.data(name);
      if (data === undefined) return apiError(reply, 404, "unknown_view", `no view ${name}`);
      if (!data.ok) return apiError(reply, 422, "invalid_view", `view ${name}: ${data.message}`);
      return open(workspace, reply, data.data, name);
    });

    app.delete("/api/views/:name", async (request, reply) => {
      const { name } = NameParams.parse(request.params);
      if (!validViewName(name)) return invalidName(reply, name);
      if (!views.remove(name)) return apiError(reply, 404, "unknown_view", `no view ${name}`);
      return { deleted: name };
    });

    app.post("/api/views/import", async (request, reply) => {
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
      const answer: { view: ViewSummary; warnings: string[]; opened?: CommandResult } = {
        view: viewSummary(name, doc),
        warnings: parsed.warnings,
      };
      if (body.open === true)
        answer.opened = workspace.execute({ type: "view.open", name, view: doc });
      return answer;
    });
  };
