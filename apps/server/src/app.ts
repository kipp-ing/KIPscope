import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { type AccessOptions, hostAllowed, originAllowed } from "./access.ts";
import { type RequestUser, registerGuard } from "./guard.ts";
import { apiError, rewriteUrl, type ScopeDeps, sessionPrefixOf } from "./http.ts";
import type { IdentityAdapter } from "./identity.ts";
import { type MetaDeps, metaRoutes } from "./meta.ts";
import { type Rules, sessionRights } from "./rights.ts";
import { eventsRoutes } from "./routes/events.ts";
import { identityRoutes } from "./routes/identity.ts";
import { seriesRoutes } from "./routes/series.ts";
import { sessionRoutes } from "./routes/sessions.ts";
import { signalRoutes } from "./routes/signals.ts";
import { viewRoutes } from "./routes/views.ts";
import { workspaceRoutes } from "./routes/workspace.ts";
import {
  type Session,
  SessionLimitError,
  type Sessions,
  seedFor,
  singleSession,
} from "./sessions.ts";
import type { ViewStore, ViewsOf } from "./views.ts";
import { webRoutes } from "./web.ts";
import type { WorkspaceStore } from "./workspace.ts";

/** Largest live channel message in bytes (design H4). */
export const MAX_LIVE_PAYLOAD = 262_144;

export interface AppDeps extends ScopeDeps {
  /** Build and source labels plus the ping for `/api/meta`; without it the route answers 404 (tests only). */
  meta?: MetaDeps;
  /** Content of `LICENSE`, read once at start; without it `/api/license` answers 404. */
  licenseText?: string;
  /** Each user's saved views (add-multiuser M9). */
  viewsOf?: ViewsOf;
  /** One view store for every user (tests); without it and `viewsOf` the view routes answer 404. */
  views?: ViewStore;
  /** The identity adapter (add-multiuser M1); absent in `none` mode: every request is `local` with all rights. */
  identity?: IdentityAdapter;
  /** The rules file's content (add-multiuser M3); required with `identity`. */
  rules?: Rules;
  /** `KIPSCOPE_WEB_DIR` (add-multiuser M11); absent: no static files. */
  webDir?: string;
}

/**
 * What `buildApp` takes: the deps with a session store, or with one workspace store that becomes
 * the only session, owned by `local` (tests written before sessions).
 */
export type AppInput = Omit<AppDeps, "sessions"> &
  ({ sessions: Sessions; workspace?: never } | { workspace: WorkspaceStore; sessions?: never });

/**
 * The session a `session` or `change` request serves (add-multiuser M5): the one of its
 * `/api/s/<id>/` prefix (undefined when there is none: 404 `unknown_session`), else the user's
 * latest own session they may open, or a new one.
 */
export function sessionResolver(sessions: Sessions) {
  return (request: FastifyRequest, user: RequestUser): Session | undefined => {
    const id = sessionPrefixOf(request);
    if (id !== undefined) return sessions.get(id);
    const name = user.identity.user;
    return sessions.defaultOf(
      name,
      (session) => sessionRights(name, user.rights, session) !== undefined,
      seedFor(sessions.seed(), user.rights),
    );
  };
}

export function buildApp(
  input: AppInput,
  options: { logger?: boolean; extraHost?: string; origins?: readonly string[] } = {},
): FastifyInstance {
  const { workspace, sessions, ...rest } = input;
  const deps: AppDeps = {
    ...rest,
    sessions: sessions ?? singleSession(workspace as WorkspaceStore),
  };
  // `/api/s/<id>/…` serves `/api/…` for session <id> (add-multiuser M5).
  const app = Fastify({ logger: options.logger ?? false, rewriteUrl });
  const access: AccessOptions = {
    ...(options.extraHost === undefined ? {} : { extraHost: options.extraHost }),
    ...(options.origins === undefined ? {} : { origins: options.origins }),
  };
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
    // The one guard (add-multiuser M6), after the Host/Origin check and before any route.
    registerGuard(app, {
      ...(deps.identity ? { identity: deps.identity } : {}),
      ...(deps.rules ? { rules: deps.rules } : {}),
      resolveSession: sessionResolver(deps.sessions),
      log: { warn: (message) => app.log.warn(message) },
    });
  });
  app.setErrorHandler((error, _request, reply) => {
    // A user whose every session has a live client cannot get a new default one.
    if (error instanceof SessionLimitError)
      return apiError(reply, 409, "session_limit", error.message);
    throw error;
  });
  app.register(identityRoutes(deps));
  app.register(signalRoutes(deps));
  app.register(seriesRoutes(deps));
  app.register(eventsRoutes(deps));
  app.register(workspaceRoutes(deps));
  app.register(sessionRoutes(deps));
  app.register(viewRoutes(deps));
  app.register(metaRoutes(deps));
  app.register(webRoutes(deps.webDir));
  return app;
}
