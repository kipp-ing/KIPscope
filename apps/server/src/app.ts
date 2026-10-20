import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { type AccessOptions, hostAllowed, originAllowed } from "./access.ts";
import type { FinderConfig } from "./case.ts";
import { type RequestUser, registerGuard } from "./guard.ts";
import { apiError, rewriteUrl, type ScopeDeps, workspacePrefixOf } from "./http.ts";
import type { IdentityAdapter } from "./identity.ts";
import { type MetaDeps, metaRoutes } from "./meta.ts";
import type { ObjectExtents } from "./objectScope.ts";
import { caseRoutes } from "./routes/case.ts";
import { eventsRoutes } from "./routes/events.ts";
import { identityRoutes } from "./routes/identity.ts";
import { seriesRoutes } from "./routes/series.ts";
import { signalRoutes } from "./routes/signals.ts";
import { viewRoutes } from "./routes/views.ts";
import { workspaceRoutes } from "./routes/workspace.ts";
import { workspacesRoutes } from "./routes/workspaces.ts";
import type { ViewStore, ViewsOf } from "./views.ts";
import { webRoutes } from "./web.ts";
import type { WorkspaceStore } from "./workspace.ts";
import {
  singleWorkspace,
  type WorkspaceEntry,
  WorkspaceLimitError,
  type Workspaces,
} from "./workspaces.ts";

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
  /**
   * The identity adapter (add-multiuser M1); absent in `none` mode: every request is `local` and
   * every workspace reads everything (M3).
   */
  identity?: IdentityAdapter;
  /** `KIPSCOPE_SHARE` (add-multiuser M2); absent: on. Ignored without `identity`. */
  share?: boolean;
  /** `KIPSCOPE_WEB_DIR` (add-multiuser M11); absent: no static files. */
  webDir?: string;
  /** Ping interval of the live channel in ms; default LIVE_HEARTBEAT_MS (tests use a short one). */
  liveHeartbeatMs?: number;
  /** The finder handoff (add-case-open K4); absent: the defaults of `loadConfig` without variables. */
  finder?: FinderConfig;
  /** The vehicles' extents for Unlink (K11); absent: one over `source`. */
  objectExtents?: ObjectExtents;
}

/**
 * What `buildApp` takes: the deps with a workspace registry, or with one workspace store that
 * becomes the only workspace, owned by `local` (tests written before workspaces).
 */
export type AppInput = Omit<AppDeps, "workspaces"> &
  (
    | { workspaces: Workspaces; workspace?: never }
    | { workspace: WorkspaceStore; workspaces?: never }
  );

/**
 * The workspace a `workspace` or `change` request serves (add-multiuser M5): the one of its
 * `/api/w/<id>/` prefix (undefined when there is none: 404 `unknown_workspace`), else the user's
 * latest own workspace, or a new one.
 */
export function workspaceResolver(workspaces: Workspaces) {
  return (request: FastifyRequest, user: RequestUser): WorkspaceEntry | undefined => {
    const id = workspacePrefixOf(request);
    if (id !== undefined) return workspaces.get(id);
    return workspaces.defaultOf(user.identity.user);
  };
}

export function buildApp(
  input: AppInput,
  options: { logger?: boolean; extraHost?: string; origins?: readonly string[] } = {},
): FastifyInstance {
  const { workspace, workspaces, ...rest } = input;
  const registry = workspaces ?? singleWorkspace(workspace as WorkspaceStore);
  const deps: AppDeps = {
    // `case=N` reads the workspace's catalog (add-case-open K10).
    caseCatalog: (id) => registry.caseOf(id),
    ...rest,
    workspaces: registry,
  };
  // `/api/w/<id>/…` serves `/api/…` for workspace <id> (add-multiuser M5).
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
      resolveWorkspace: workspaceResolver(deps.workspaces),
      grantOf: (entry: WorkspaceEntry) => deps.workspaces.grantOf(entry.record.id),
      log: { warn: (message) => app.log.warn(message) },
    });
  });
  app.setErrorHandler((error, _request, reply) => {
    // A user whose every workspace has a live client cannot get a new default one.
    if (error instanceof WorkspaceLimitError)
      return apiError(reply, 409, "workspace_limit", error.message);
    throw error;
  });
  app.register(identityRoutes(deps));
  app.register(signalRoutes(deps));
  app.register(seriesRoutes(deps));
  app.register(eventsRoutes(deps));
  app.register(workspaceRoutes(deps));
  app.register(workspacesRoutes(deps));
  app.register(caseRoutes(deps));
  app.register(viewRoutes(deps));
  app.register(metaRoutes(deps));
  app.register(webRoutes(deps.webDir));
  return app;
}
