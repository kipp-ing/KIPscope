import type { Me } from "@kipscope/shared";
import type { FastifyPluginAsync } from "fastify";
import { userOf } from "../http.ts";
import { NONE_KIND } from "../identity.ts";

/**
 * `GET /api/me` (add-multiuser M7): the request's user, identity kind, roles and rights, also for
 * a user without rights (level `identity`).
 */
export function identityRoutes(deps: {
  /** The adapter's kind; absent in `none` mode. */
  identity?: { readonly kind: string };
}): FastifyPluginAsync {
  const kind = deps.identity?.kind ?? NONE_KIND;
  return async (app) => {
    app.get("/api/me", { config: { access: { level: "identity" } } }, async (request) => {
      const { identity, rights } = userOf(request);
      const me: Me = {
        user: identity.user,
        identity: kind,
        roles: [...identity.roles],
        rights: { data: [...rights.data], share: rights.share },
      };
      return me;
    });
  };
}
