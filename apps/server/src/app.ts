import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import type { Catalog } from "./catalog.ts";
import type { DataSource } from "./datasource.ts";
import { seriesRoutes } from "./routes/series.ts";
import { signalRoutes } from "./routes/signals.ts";
import { workspaceRoutes } from "./routes/workspace.ts";
import type { WorkspaceStore } from "./workspace.ts";

export interface AppDeps {
  catalog: Catalog;
  /** Source for series queries; in production wrapped by the query queue. */
  source: DataSource;
  workspace: WorkspaceStore;
}

export function buildApp(deps: AppDeps, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  app.register(websocket);
  app.register(signalRoutes(deps));
  app.register(seriesRoutes(deps));
  app.register(workspaceRoutes(deps));
  return app;
}
