import Fastify, { type FastifyInstance } from "fastify";
import type { Catalog } from "./catalog.ts";
import { signalRoutes } from "./routes/signals.ts";

export interface AppDeps {
  catalog: Catalog;
}

export function buildApp(deps: AppDeps, options: { logger?: boolean } = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  app.register(signalRoutes(deps));
  return app;
}
