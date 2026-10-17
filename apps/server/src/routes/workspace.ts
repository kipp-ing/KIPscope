import { type CommandResult, type LiveServerMessage, RenderedMessage } from "@kipscope/shared";
import type { FastifyPluginAsync } from "fastify";
import type { AppDeps } from "../app.ts";
import { commandStatus } from "../http.ts";

export const workspaceRoutes =
  ({ workspace }: AppDeps): FastifyPluginAsync =>
  async (app) => {
    /** Applies one command; the endpoint the UI and the CLI share. */
    app.post("/api/commands", async (request, reply) => {
      // Only the view routes name the open view, so a save in place writes its own file (V2 round 2).
      if (namedViewOpen(request.body)) {
        const refused: CommandResult = {
          ok: false,
          code: "invalid_command",
          message: "open a saved view through POST /api/views/open",
        };
        return reply.code(400).send(refused);
      }
      const result = workspace.execute(request.body);
      reply.code(commandStatus(result));
      return result;
    });

    app.get("/api/workspace", async () => ({
      revision: workspace.revision,
      workspace: workspace.workspace,
    }));

    /** Latest rendered revision per connected browser. */
    app.get("/api/render-status", async () => workspace.renderStatus());

    /** Pushes the state after each accepted command; receives render acknowledgements. */
    app.get("/api/live", { websocket: true }, (socket) => {
      const clientId = workspace.connect();
      const send = (message: LiveServerMessage) => socket.send(JSON.stringify(message));
      send({ type: "hello", clientId });
      send({ type: "state", revision: workspace.revision, workspace: workspace.workspace });
      const unsubscribe = workspace.subscribe((revision, state, command) =>
        send({ type: "state", revision, workspace: state, command }),
      );

      socket.on("message", (data: Buffer) => {
        let json: unknown;
        try {
          json = JSON.parse(data.toString());
        } catch {
          return;
        }
        const parsed = RenderedMessage.safeParse(json);
        if (parsed.success) workspace.rendered(clientId, parsed.data);
      });
      socket.on("close", () => {
        unsubscribe();
        workspace.disconnect(clientId);
      });
    });
  };

/** A `view.open` that carries `name`. */
function namedViewOpen(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const { type, name } = body as { type?: unknown; name?: unknown };
  return type === "view.open" && name !== undefined;
}
