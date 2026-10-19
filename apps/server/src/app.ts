import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { type AccessOptions, hostAllowed, originAllowed } from "./access.ts";
import { apiError, type ScopeDeps } from "./http.ts";
import { type MetaDeps, metaRoutes } from "./meta.ts";
import { eventsRoutes } from "./routes/events.ts";
import { seriesRoutes } from "./routes/series.ts";
import { signalRoutes } from "./routes/signals.ts";
import { viewRoutes } from "./routes/views.ts";
import { workspaceRoutes } from "./routes/workspace.ts";
import type { ViewStore } from "./views.ts";
import type { WorkspaceStore } from "./workspace.ts";

/** Largest live channel message in bytes (design H4). */
export const MAX_LIVE_PAYLOAD = 262_144;

export interface AppDeps extends ScopeDeps {
  workspace: WorkspaceStore;
  /** Build and source labels plus the ping for `/api/meta`; without it the route answers 404 (tests only). */
  meta?: MetaDeps;
  /** Content of `LICENSE`, read once at start; without it `/api/license` answers 404. */
  licenseText?: string;
  /** Saved views (saved-views V5); without it the view routes answer 404 (tests that do not need them). */
  views?: ViewStore;
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
  app.register(eventsRoutes(deps));
  app.register(workspaceRoutes(deps));
  app.register(viewRoutes(deps));
  app.register(metaRoutes(deps));
  return app;
}
