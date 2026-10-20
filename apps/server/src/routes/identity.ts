import type { Me } from "@kipscope/shared";
import type { FastifyPluginAsync } from "fastify";
import { userOf } from "../http.ts";
import { NONE_KIND } from "../identity.ts";

/**
 * `GET /api/me` (add-multiuser M7): the request's user, identity kind, roles (shown only, they
 * decide nothing) and whether they may share a workspace: always with `none`, else as
 * `KIPSCOPE_SHARE` says.
 */
export function identityRoutes(deps: {
  /** The adapter's kind; absent in `none` mode. */
  identity?: { readonly kind: string };
  /** `KIPSCOPE_SHARE` (Config.share); absent: on. */
  share?: boolean;
}): FastifyPluginAsync {
  const kind = deps.identity?.kind ?? NONE_KIND;
  const canShare = deps.identity === undefined || deps.share !== false;
  return async (app) => {
    app.get("/api/me", { config: { access: { level: "user" } } }, async (request) => {
      const { identity } = userOf(request);
      const me: Me = {
        user: identity.user,
        identity: kind,
        roles: [...identity.roles],
        canShare,
      };
      return me;
    });
  };
}
