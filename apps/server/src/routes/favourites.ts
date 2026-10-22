import { FavouritesChange } from "@kipscope/shared";
import type { FastifyPluginAsync, FastifyRequest } from "fastify";
import type { AppDeps } from "../app.ts";
import type { Access } from "../guard.ts";
import { apiError, parseInput, userOf } from "../http.ts";

/**
 * The requester's favourites (add-favourites F1): per user, outside every workspace, so level
 * `user` and no workspace right. Registered only when the app has a favourites store.
 */
export const favouritesRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    const { favouritesOf } = deps;
    if (!favouritesOf) return;
    const USER: { access: Access } = { access: { level: "user" } };
    const storeFor = (request: FastifyRequest) => favouritesOf(userOf(request).identity.user);

    app.get("/api/favourites", { config: USER }, async (request) => storeFor(request).get());

    app.post("/api/favourites", { config: USER }, async (request, reply) => {
      const change = parseInput(FavouritesChange, request.body, reply);
      if (!change) return reply;
      const result = storeFor(request).change(change);
      if (!result.ok) return apiError(reply, result.status, result.code, result.message);
      return { names: result.names };
    });
  };
