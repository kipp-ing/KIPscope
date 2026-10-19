/**
 * Records every route the app registers, with its `config.access` (add-multiuser M6), by wrapping
 * Fastify's factory: a test file that calls `vi.mock("fastify", ...)` with `recordRoutes` sees the
 * routes of every app built in that file. The list comes from the registered routes, so a route
 * added later shows up without a change here.
 */
import type { FastifyInstance, RouteOptions } from "fastify";
import type { Access } from "../src/guard.ts";

export interface RegisteredRoute {
  method: string;
  url: string;
  access: Access | undefined;
  websocket: boolean;
}

/** Routes registered since the last `clearRoutes()`, in order; the live channel once per method. */
export const routeLog: RegisteredRoute[] = [];

/** Warnings the apps logged since the last `clearRoutes()` (apps built without `logger: true`). */
export const warnLog: string[] = [];

export const clearRoutes = () => {
  routeLog.length = 0;
  warnLog.length = 0;
};

/** A Fastify logger that keeps the warnings of `app.log.warn` and drops the rest. */
function collector() {
  const text = (a: unknown, b: unknown) =>
    typeof a === "string" ? a : String(b ?? JSON.stringify(a));
  const noop = () => {};
  const self = {
    level: "info",
    fatal: noop,
    error: noop,
    info: noop,
    debug: noop,
    trace: noop,
    silent: noop,
    warn: (a: unknown, b?: unknown) => {
      warnLog.push(text(a, b));
    },
    child: () => self,
  };
  return self;
}

/** The module `fastify` with a factory that records routes. */
export function recordRoutes<T extends { default: (...args: never[]) => FastifyInstance }>(
  real: T,
): T {
  const wrapped = (...args: never[]) => {
    // An app built without `logger: true` gets a logger that collects its warnings.
    const options = (args[0] ?? {}) as { logger?: unknown };
    const app = options.logger
      ? real.default(...args)
      : real.default({ ...options, logger: undefined, loggerInstance: collector() } as never);
    app.addHook("onRoute", (route: RouteOptions) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) {
        // @fastify/websocket adds a HEAD route for each GET; the GET is the one that counts.
        if (method === "HEAD" || method === "OPTIONS") continue;
        routeLog.push({
          method,
          url: route.url,
          access: route.config?.access,
          websocket: (route as { wsHandler?: unknown }).wsHandler !== undefined,
        });
      }
    });
    return app;
  };
  return { ...real, default: Object.assign(wrapped, real.default), fastify: wrapped };
}

/** `GET /api/series`-style key of a route. */
export const routeKey = (route: Pick<RegisteredRoute, "method" | "url">) =>
  `${route.method} ${route.url}`;
