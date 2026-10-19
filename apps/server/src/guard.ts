import {
  LOCAL_USER,
  parseSignalId,
  SESSION_HEADER,
  type SessionRights,
  type SessionShare,
  USER_ID,
  type Workspace,
} from "@kipscope/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest, RouteOptions } from "fastify";
import { apiError } from "./http.ts";
import type { IdentifyResult, Identity, IdentityAdapter, IdentityRequest } from "./identity.ts";
import {
  ALL_RIGHTS,
  canSee,
  hasRights,
  type Rights,
  type Rules,
  rightsOf,
  sessionRights,
} from "./rights.ts";

/**
 * The one place that decides access (design M6): every route under `/api/` declares its level and
 * the data refs it names; two hooks enforce them before any handler runs.
 */

export type Level = "public" | "identity" | "user" | "session" | "change";
export type Access = {
  /**
   * public: no user. identity: a user, rights not needed. user: a user with rights. session: +
   * open right on the session. change: + change right. The body form is decided in preHandler
   * (only `POST /api/views/import`) and counts as "user" in onRequest.
   */
  level: Level | { body: (request: FastifyRequest) => "user" | "session" | "change" };
  /** Every data ref the request names (query, body); checked before the handler runs. */
  dataRefs?: (request: FastifyRequest) => string[];
};

declare module "fastify" {
  interface FastifyContextConfig {
    access?: Access;
  }
}

/** The user a request runs as, set by the onRequest hook. */
export interface RequestUser {
  readonly identity: Identity;
  readonly rights: Rights;
}

/** What the guard needs of a session (design M4 `Session`). */
export interface GuardSession {
  readonly record: { readonly id: string; readonly owner: string; readonly share: SessionShare };
  readonly store: { readonly workspace: Workspace };
}

export interface GuardOptions<S extends GuardSession> {
  /** The identity adapter; undefined in `none` mode, where every request is `local` with all rights. */
  identity?: IdentityAdapter;
  /** The rules file's content; required with an adapter. */
  rules?: Rules;
  /**
   * The session a `session` or `change` request serves: the prefix's, else the user's default
   * (design M5). Undefined: 404 `unknown_session`.
   */
  resolveSession(request: FastifyRequest, user: RequestUser): S | undefined;
  log?: { warn(message: string): void };
  now?: () => number;
}

const users = new WeakMap<FastifyRequest, RequestUser>();
const sessions = new WeakMap<FastifyRequest, { session: GuardSession; rights: SessionRights }>();

/** The user the guard identified for this request; undefined for `public` routes and non-API paths. */
export function requestUser(request: FastifyRequest): RequestUser | undefined {
  return users.get(request);
}

/** The session the guard resolved and admitted for this request, with the user's rights on it. */
export function requestSession<S extends GuardSession>(
  request: FastifyRequest,
): { session: S; rights: SessionRights } | undefined {
  return sessions.get(request) as { session: S; rights: SessionRights } | undefined;
}

const LOCAL: RequestUser = { identity: { user: LOCAL_USER, roles: [] }, rights: ALL_RIGHTS };

const MAX_ROLES = 200;
const MAX_ROLE = 128;
const CONTROL = /\p{Cc}/u;
const WARN_EVERY_MS = 60_000;

const isApi = (url: string) => url.startsWith("/api/");
const pathOf = (url: string) => url.split("?", 1)[0] ?? url;

/** A level's place in the order public < identity < user < session < change. */
const RANK: Record<Level, number> = { public: 0, identity: 1, user: 2, session: 3, change: 4 };

/** What an adapter sees of a request (design M1); the request itself stays untouched. */
function identityRequest(request: FastifyRequest): IdentityRequest {
  const headers: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(request.raw.headers))
    headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
  const peer = request.raw.socket.remoteAddress ?? "";
  return {
    headers,
    peer: peer.startsWith("::ffff:") ? peer.slice("::ffff:".length) : peer,
    method: request.method,
    path: routerPath(request.url),
  };
}

/**
 * The level onRequest enforces, from the matched route: its declared level (the body form counts
 * as "user"); "user" for an `/api/` route without access (fail closed) and for an unknown path
 * under `/api/`, so a 404 there answers only a user; undefined for every other path.
 */
function levelOf(request: FastifyRequest): Level | undefined {
  const access = request.routeOptions.config?.access;
  if (access) return typeof access.level === "string" ? access.level : "user";
  // The URL only adds a check here: a path under `/api/` that no route declares, also behind a
  // catch-all, spelled as the router reads it.
  return isApi(request.routeOptions.url ?? "") || isApi(routerPath(request.url))
    ? "user"
    : undefined;
}

/** Escapes the router keeps as they are: `/`, `?`, `#` and `%` itself. */
const KEPT_ESCAPES = new Set(["2f", "3f", "23", "25"]);

/** The path as the router matches it: percent escapes decoded, except the ones it keeps. */
export function routerPath(url: string): string {
  return pathOf(url).replace(/%([0-9a-f]{2})/gi, (kept, hex: string) =>
    KEPT_ESCAPES.has(hex.toLowerCase()) ? kept : String.fromCharCode(Number.parseInt(hex, 16)),
  );
}

/** A result the server accepts as a user (design M1); anything else counts as refused. */
function validIdentity(result: unknown): result is Identity {
  if (typeof result !== "object" || result === null || "refused" in result) return false;
  const { user, roles } = result as Partial<Identity>;
  return (
    typeof user === "string" &&
    USER_ID.test(user) &&
    Array.isArray(roles) &&
    roles.length <= MAX_ROLES &&
    roles.every(
      (r) => typeof r === "string" && r.length >= 1 && r.length <= MAX_ROLE && !CONTROL.test(r),
    )
  );
}

/** The refusal code of a well-formed refusal; undefined for anything else. */
function refusalOf(
  result: unknown,
): Extract<IdentifyResult, { refused: unknown }>["refused"] | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const { refused } = result as { refused?: unknown };
  return refused === "unauthenticated" || refused === "invalid_token" ? refused : undefined;
}

/**
 * Adds the guard to the app (design M6): the onRoute check, then the onRequest and preHandler
 * hooks. Call it before any route is registered and after the Host/Origin hook.
 */
export function registerGuard<S extends GuardSession>(
  app: FastifyInstance,
  options: GuardOptions<S>,
): void {
  const hooks = guardHooks(options);
  app.addHook("onRoute", hooks.onRoute);
  app.addHook("onRequest", hooks.onRequest);
  app.addHook("preHandler", hooks.preHandler);
}

/** The guard's three hooks, for an app that orders its hooks itself. */
export function guardHooks<S extends GuardSession>(options: GuardOptions<S>) {
  const { identity: adapter, rules } = options;
  if (adapter && !rules) throw new Error("guard: an identity adapter needs rules");
  const now = options.now ?? Date.now;
  /** A warning at most once per minute per kind (design M1). */
  const throttled = () => {
    let warnedAt = Number.NEGATIVE_INFINITY;
    return (message: string) => {
      if (now() - warnedAt < WARN_EVERY_MS) return;
      warnedAt = now();
      options.log?.warn(message);
    };
  };
  const warnFailed = throttled();
  const warnMalformed = throttled();

  /** A route under `/api/` without `config.access` stops the server (fail closed). */
  const onRoute = (route: RouteOptions) => {
    if (!isApi(route.url)) return;
    if (!route.config?.access) {
      const methods = Array.isArray(route.method) ? route.method.join(",") : route.method;
      throw new Error(`route ${methods} ${route.url} declares no config.access (design M6)`);
    }
  };

  /**
   * Identify, rights, `no_rights`; before the body is read, the live upgrade included. Keyed on
   * the matched route, never on the raw URL: the router decodes percent escapes, so `/%61pi/…`
   * reaches an `/api/` route as well.
   */
  const onRequest = async (request: FastifyRequest, reply: FastifyReply) => {
    const level = levelOf(request);
    if (level === undefined || level === "public") return;
    let user: RequestUser = LOCAL;
    if (adapter && rules) {
      let result: unknown;
      try {
        result = await adapter.identify(identityRequest(request));
      } catch (error) {
        // Fail closed; the error text stays in the log.
        warnFailed(
          `identity adapter ${adapter.kind} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        return apiError(reply, 503, "identity_unavailable", "sign-in service unreachable");
      }
      if (!validIdentity(result)) {
        const refused = refusalOf(result);
        if (refused === "invalid_token")
          return apiError(reply, 401, "invalid_token", "the credential was not accepted");
        if (refused === undefined)
          warnMalformed(`identity adapter ${adapter.kind} returned a malformed identity`);
        return apiError(reply, 401, "unauthenticated", "not signed in");
      }
      const identity: Identity = { user: result.user, roles: [...result.roles] };
      user = { identity, rights: rightsOf(identity, rules) };
    }
    users.set(request, user);
    if (RANK[level] >= RANK.user && !hasRights(user.rights))
      return apiError(reply, 403, "no_rights", "your roles match no rule of this server");
  };

  /**
   * Data refs, then the session: every data ref the request names must be visible, decided from
   * the patterns alone before any session, catalog or source is looked at; then the session's
   * open and change rights.
   */
  const preHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const access = request.routeOptions.config?.access;
    if (!access) {
      // A matched `/api/` route without access cannot exist (onRoute); should one, run nothing.
      if (isApi(request.routeOptions.url ?? ""))
        return apiError(reply, 403, "forbidden", "this route declares no access");
      return;
    }
    const declared = access.level;
    if (declared === "public") return;
    const user = users.get(request);
    // onRequest answered already (or a public route); never run a guarded handler without a user.
    if (!user) return apiError(reply, 401, "unauthenticated", "not signed in");
    const level: Level = typeof declared === "string" ? declared : declared.body(request);
    if (level === "identity") return;
    for (const ref of access.dataRefs?.(request) ?? [])
      if (!canSee(user.rights, ref))
        return apiError(reply, 403, "forbidden_data", `data ref ${ref} is not permitted`);
    if (level === "user") return;
    const session = options.resolveSession(request, user);
    if (!session) return apiError(reply, 404, "unknown_session", "no such session");
    const rights = sessionRights(user.identity.user, user.rights, session);
    // Private and holding hidden data answer alike (design M6).
    if (!rights) return apiError(reply, 403, "forbidden", "no access to this session");
    if (level === "change" && !rights.change)
      return apiError(reply, 403, "read_only", "this session is shared read-only");
    sessions.set(request, { session, rights });
    reply.header(SESSION_HEADER, session.record.id);
  };

  return { onRoute, onRequest, preHandler };
}

/** String values of a query parameter (one or repeated); anything else gives none. */
function queryValues(request: FastifyRequest, name: string): string[] {
  const value = (request.query as Record<string, unknown> | undefined)?.[name];
  const values = Array.isArray(value) ? value : [value];
  return values.filter((v): v is string => typeof v === "string");
}

/**
 * `dataRefs` of a route that names data refs in its query (design M6 table): the values of the
 * `dataRef` parameters as they are, and the data ref of each signal ID in the `signal` parameters
 * (a malformed ID names none; the route answers it as before).
 */
export function queryDataRefs(names: {
  dataRef?: string;
  signal?: string;
}): (request: FastifyRequest) => string[] {
  return (request) => {
    const refs = names.dataRef ? queryValues(request, names.dataRef) : [];
    if (names.signal)
      for (const id of queryValues(request, names.signal)) {
        const ref = parseSignalId(id)?.dataRef;
        if (ref !== undefined) refs.push(ref);
      }
    return [...new Set(refs)];
  };
}
