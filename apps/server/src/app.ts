import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { type AccessOptions, hostAllowed, originAllowed } from "./access.ts";
import type { Catalog } from "./catalog.ts";
import type { DataSource } from "./datasource.ts";
import { apiError } from "./http.ts";
import { seriesRoutes } from "./routes/series.ts";
import { signalRoutes } from "./routes/signals.ts";
import { workspaceRoutes } from "./routes/workspace.ts";
import type { WorkspaceStore } from "./workspace.ts";

/** Largest live channel message in bytes (design H4). */
export const MAX_LIVE_PAYLOAD = 262_144;

export interface AppDeps {
  catalog: Catalog;
  /** Source for series queries; in production wrapped by the query queue. */
  source: DataSource;
  workspace: WorkspaceStore;
}

export function buildApp(
  deps: AppDeps,
  options: { logger?: boolean; extraHost?: string } = {},
): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const access: AccessOptions =
    options.extraHost === undefined ? {} : { extraHost: options.extraHost };
  // JSON bodies only: a text/plain POST is a cross-site request without preflight.
  app.removeContentTypeParser("text/plain");
  app.register(websocket, { options: { maxPayload: MAX_LIVE_PAYLOAD } });
  // Runs for HTTP and for the live channel's upgrade, which @fastify/websocket routes through the hooks.
  // Added after the plugin's own onRequest hook marks upgrades, so its onResponse hook destroys a refused upgrade socket.
  app.after(() => {
    app.addHook("onRequest", async (request, reply) => {
      const { host, origin } = request.headers;
      if (!hostAllowed(host, access))
        return apiError(reply, 403, "forbidden_host", `Host not allowed: ${host ?? "(none)"}`);
      if (!originAllowed(origin, access))
        return apiError(reply, 403, "forbidden_origin", `Origin not allowed: ${origin}`);
    });
  });
  app.register(signalRoutes(deps));
  app.register(seriesRoutes(deps));
  app.register(workspaceRoutes(deps));
  return app;
}
