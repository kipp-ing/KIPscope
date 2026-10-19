# Design

## Context

- **Jan's decisions:** D-079: „das soll auf einem server laufen, dem gleichen vielleicht wie Ki ping. lokal ist immer nur der browser. Multiuser ist also pflicht. eine zugriffsberechtigung im Server muss später auch einbaubar sein". D-083: „Ein SSO hook mit ping oder authentik wäre gut. jedes sesseion braucht rechte, ja. ADX rechte sind serverrechte hier keine unterscheidung". Decision text: „no own user store. Every session (one opened case, its own workspace) carries rights: who may open and change it". On the recommendation „a workspace per session/case with its own URL (old tabs keep their case), not one workspace per user" Jan answered „ja". D-082: catalogs are keyed by scope. D-081: query classes. D-078: the finder hands over cases, and neighbours are one click away.
- **Concept:** §7 „Vollständige CLI-Fernsteuerung … Eine KI verwendet diese reguläre Schnittstelle" (the CLI needs an identity without a browser). §8 „Ein eigenes Rechteverwaltungssystem kommt später. Ein autorisierter Datenbankzugang bleibt erforderlich; Zugangsdaten gehören nicht in exportierte Templates".
- **Code today:** one `WorkspaceStore` (`apps/server/src/workspace.ts`) in `AppDeps.workspace`. `routes/workspace.ts` serves `/api/commands`, `/api/workspace`, `/api/render-status` and `/api/live`. `scopeOf(request, workspace)` (`scope.ts`) returns that workspace's scope; add-scope named it as the one hook this change replaces. `CatalogStore.keep()` returns the one scope that is never dropped (4 others LRU). `GapCache` measures periods for `workspaceSignals(workspace)`. The events prefetch reads `workspace.eventSignals`. `StatePersister` writes `<stateDir>/workspace.json`. `ViewStore(<stateDir>/views)` holds the views, and `beforeOpen` writes `_previous`. `access.ts` admits loopback hosts plus `KIPSCOPE_HOST`. The web calls fixed `/api/...` paths (`api.ts`, `live.ts`). The CLI's `client.ts` builds URLs from `--server`. The server does not serve the built UI. Vite proxies `/api` with `ws: true`.

## Goals / Non-Goals

**Goals:** one identity hook (request → user) that works with KI.ping and authentik with the least code. Today's local use unchanged without SSO. A workspace per session with an owner, rights, its own URL, live channel and state file. The CLI and AI callers address a session and authenticate without a browser. A server deployment behind a TLS proxy. Interfaces that `add-case-open` and `add-signal-books` build on.

**Non-goals:** proposal "Out of scope".

## Questions for Jan

Tasks are written for the recommended answers. The lead confirms them with Jan before round 1.

- **Q-1 Identity mechanism.** (a) **Forward-auth header (recommended):** the reverse proxy authenticates (authentik's proxy outpost, or nginx/Traefik `auth_request`/`forwardAuth` against authentik or KI.ping) and sets a user header. KIPscope trusts it only from the proxy's address. About 80 lines, no dependency, no cookies or callback in KIPscope, and it works with any IdP the proxy can ask. (b) KIPscope as an OIDC client: login redirect, callback, its own session cookie and refresh. It needs an OIDC library or about 400 lines, and it works with KI.ping only if KI.ping is an OIDC provider. (c) Both now. Either way, (b) can come later behind the same `identify()` (M1).
- **Q-2 Identity of the CLI and AI callers.** (a) **Personal tokens (recommended):** created in the UI by a signed-in user, sent as `Authorization: Bearer kst_…`, checked by KIPscope against a stored hash. They work with any proxy that lets `Bearer kst_` requests through, or straight to KIPscope's port. (b) The IdP's own tokens checked by the proxy (authentik app passwords via HTTP Basic). No KIPscope code is needed, but it depends on the IdP, and it is unknown whether KI.ping can do it. (c) OIDC device flow: needs Q-1 (b).
- **Q-3 Rights of a session.** (a) **Owner plus one share level (recommended):** `private` (owner only), `read` (every signed-in user may open it), `write` (every signed-in user may open and change it). (b) As (a) plus lists of named users per right. (c) Owner only. A reader copies a session through "Copy link", which opens it as their own new session.
- **Q-4 Saved views.** (a) **Per user (recommended):** each user has their own view list. Sharing works through links and shared sessions. (b) One store for all users, as today (names collide, anyone can overwrite). (c) Per user plus one shared folder.

## Decisions

### M1: One identity hook (Q-1 (a), Q-2 (a))

```ts
// apps/server/src/identity.ts
export interface User { id: string; via: "local" | "header" | "token" }
/** The one place a request becomes a user (D-079, D-083). Undefined: not signed in. */
export function identify(request: FastifyRequest, auth: AuthConfig, tokens: TokenStore): User | undefined;
```

Rules, in order:

1. `auth.mode === "none"` → `{id: "local", via: "local"}` for every request (after the access guard).
2. `Authorization: Bearer <t>` present → the token's user (`via: "token"`), from any peer. An unknown token → undefined, and the request answers 401 `invalid_token`. The identity header is then ignored, so a proxy route that lets `Bearer kst_` requests through without forward auth cannot be spoofed with a forged header.
3. The peer address (`request.socket.remoteAddress`, `::ffff:` prefix stripped; never `X-Forwarded-For`) is in `auth.trustedProxies` (a `node:net` `BlockList` built from IPs and CIDRs) and the header `auth.header` holds one value matching `USER_ID` → `{id, via: "header"}`.
4. Else undefined → 401 `unauthenticated`.

`identify` runs in the `onRequest` hook for every path that starts with `/api/` except `GET /api/license`, after the Host/Origin guard and before routing to a handler (the live upgrade included). Static UI files (M11) need no identity: the proxy guards the page, and the files hold no data. No other file reads the identity header or `authorization`.

**Why the header over OIDC:** authentik and an `auth_request` in front of KI.ping both end in "the proxy knows the user". KI.ping's login („ping") is reachable this way as long as it answers an auth subrequest, and nothing in KIPscope depends on KI.ping's protocol. An OIDC mode later implements step 3 differently (a cookie of its own) and leaves everything after `identify` unchanged.

**Trust boundary:** the proxy must overwrite the header on every request it forwards (authentik's outpost does; nginx `proxy_set_header`). KIPscope trusts the header only from `KIPSCOPE_TRUSTED_PROXIES` (default loopback). A direct client on another address gets 401 unless it sends a token. `docs/deploy.md` states both.

### M2: Variables (pinned, `apps/server/src/config.ts`, `.env.example`)

| Variable | Default | Rule |
|---|---|---|
| `KIPSCOPE_AUTH` | `none` | `none` or `header`. Any other value stops the server, naming the variable and both values. |
| `KIPSCOPE_AUTH_HEADER` | `X-authentik-username` | An HTTP header name (`^[A-Za-z0-9-]{1,64}$`), case-insensitive. |
| `KIPSCOPE_TRUSTED_PROXIES` | `127.0.0.1,::1` | Comma list of IPv4/IPv6 addresses or CIDRs. A bad entry stops the server, naming it. |
| `KIPSCOPE_ORIGINS` | empty | Comma list of origins `http(s)://host[:port]` without path. Required (non-empty) when `KIPSCOPE_AUTH=header`. A bad entry stops the server. |
| `KIPSCOPE_SESSION_IDLE_DAYS` | `30` | Integer ≥ 1. |
| `KIPSCOPE_WEB_DIR` | unset | A directory holding `index.html`. Unset: no static files (today). |

`AuthConfig = { mode: "none" } | { mode: "header"; header: string; trustedProxies: BlockList; origins: string[] }`. The origins also feed the access guard (M10). The web's dev proxy (`apps/web/vite.config.ts`) adds `KIPSCOPE_AUTH_HEADER` (default `X-authentik-username`) with the value of `KIPSCOPE_DEV_USER` when that is set. Two Vite servers with different users let one person test two users against a server in header mode on loopback.

### M3: Personal tokens (pinned, `apps/server/src/tokens.ts`)

- Format: `kst_` + 32 random bytes in base64url (47 characters). Shown once in the create answer.
- Stored in `<stateDir>/users/<user>/tokens.json`: `{kipscope: "tokens", version: 1, tokens: [{id, label, hash, createdAt, lastUsedAt?}]}`. `hash` = sha256 hex of the whole token. `id` = 8 characters `[a-z0-9]`. The file is written atomically (`writeAtomic`). `lastUsedAt` is written at most once per minute per token.
- In memory: a map hash → `{user, id}`, built at start by reading every `users/*/tokens.json`. Lookup is constant time; compare with `timingSafeEqual` on the hash bytes.
- At most `MAX_TOKENS_PER_USER = 10`; one more answers 409 `token_limit`. Label: 1–60 characters, trimmed, no control characters.
- Routes (M7) are for a signed-in user. In `none` mode they answer 409 `auth_disabled` (no token is needed there).

### M4: Sessions (pinned file format, `apps/server/src/sessions.ts`)

A session is one `WorkspaceStore` plus:

```ts
interface SessionRecord {
  id: string;            // SESSION_ID: 10 × [a-z0-9] from crypto.randomInt
  owner: string;         // USER_ID
  share: SessionShare;   // "private" at create
  createdAt: string;     // ISO
  lastActiveAt: string;  // ISO; create, live connect, accepted command
}
```

- **State file** `<stateDir>/sessions/<id>.json`: `{kipscope: "session", version: 1, id, owner, share, createdAt, lastActiveAt, revision, workspace}`. It is written like today's state file (`StatePersister`: 500 ms trailing debounce after a change, at once on `SIGINT`/`SIGTERM`, atomic). It is also written after a share change or a live connect (debounced the same way). A file that fails validation is renamed `<id>.bad.json` with one warning, and the other sessions still load. Delete removes the file.
- **At start** every session file is read into memory (all sessions stay loaded, no unloading: 200 sessions × 20 users × ~10 KB ≈ 40 MB, and read in < 2 s).
- **New session:** an empty workspace seeded with the project file's `measurement` and events-line signals, as a fresh workspace is today. Revision 0, owner the requester, share `private`.
- **Migration** (once, at start, before reading `sessions/`): if `<stateDir>/workspace.json` exists and `<stateDir>/sessions/` does not, the file's workspace and revision become a session owned by `local` (share `private`), and the file is renamed `workspace.migrated.json`. If `<stateDir>/views/` exists and `<stateDir>/users/local/views/` does not, the folder is renamed to it. Each step logs one info line. An unreadable `workspace.json` is moved to `workspace.bad.json` as today, and no session is made from it.
- **Limits:** `MAX_SESSIONS_PER_USER = 200`. Creating one more deletes that user's least recently active session without a live client. If every one has a client, the answer is 409 `session_limit`. Idle cleanup at start and every hour deletes sessions whose `lastActiveAt` is older than `KIPSCOPE_SESSION_IDLE_DAYS` and that have no live client.
- **Default session** of a user: the one with the latest `lastActiveAt` among those they own. If they own none, a new empty one is created on the first request that needs a session.

Server interface between the session task and the route tasks (pinned, `apps/server/src/sessions.ts`):

```ts
export interface Session { readonly record: SessionRecord; readonly store: WorkspaceStore }
export class SessionLimitError extends Error {}
export class SessionStore {
  constructor(options: {
    dir: string;                      // <stateDir>
    seed: () => Workspace;            // a new session's workspace (project measurement, events-line signals)
    idleDays: number;
    now?: () => number;               // fake clocks in tests
    log?: { info(m: string): void; warn(m: string): void };
    limit?: number;                   // default MAX_SESSIONS_PER_USER
  });
  /** Runs the migration (M4), reads every session file, starts the hourly cleanup. */
  start(): void;
  get(id: string): Session | undefined;
  create(owner: string): Session;     // throws SessionLimitError
  defaultOf(user: string): Session;   // latest own, else create
  listOf(user: string): Session[];    // own, latest lastActiveAt first
  setShare(id: string, share: SessionShare): Session;
  delete(id: string): boolean;
  touch(id: string): void;            // lastActiveAt = now, debounced write
  /** Sessions with at least one live client. */
  open(): Session[];
  /** Fires after a share change, a delete, or an accepted command that changed `scope`. */
  onChange(listener: (event: { type: "share" | "delete" | "scope"; session: Session }) => void): () => void;
  flush(): void;
  cleanup(): number;                  // deleted count
  stop(): void;                       // timers off (tests, close)
}
export function summaryOf(session: Session, user: User): SessionSummary;
```

`WorkspaceStore` keeps its API. Two changes:

- `execute(input, ctx?, beforeOpen?)`: the `_previous` hook comes per call (it writes to the requester's view store, M9) instead of per store.
- `connect(user)` records the user per client. `renderStatus()` lists it as `user`.

### M5: Addressing (pinned)

- **UI:** `/s/<id>` is the page of session `<id>`. `/` is the start-up page (M12).
- **API prefix:** `/api/s/<id>/<rest>` serves `/api/<rest>` for session `<id>`. Fastify's `rewriteUrl` turns `/api/s/<id>/…` (`<id>` matching `SESSION_ID`) into `/api/…` before routing and records `<id>` on the raw request. `sessionIdOf(request)` reads it. Routes are registered once, so the route list and `docs/http-api.md` name each route once, plus the prefix rule.
- **Session-resolving routes** (all routes that read or change a workspace or its scope): `POST /api/commands`, `GET /api/workspace`, `GET /api/render-status`, `GET /api/live`, `GET /api/catalog`, `GET /api/signals`, `POST /api/catalog/refresh`, `GET /api/extent`, `GET /api/series`, `GET /api/value`, `GET /api/density`, `GET /api/gaps`, `GET /api/events`, `GET /api/meta`, `POST /api/views` (save), `POST /api/views/open`, and `POST /api/views/import` with `open: true`. With the prefix they serve that session. Without it they serve the requester's default session (M4). Every answer that served a session carries the header `X-KIPscope-Session: <id>` (`SESSION_HEADER`).
- **Session-independent routes:** `/api/me`, `/api/sessions*`, `/api/tokens*`, `/api/license`, `GET /api/views`, `GET /api/views/:name`, `DELETE /api/views/:name`, and `POST /api/views/import` without `open`. A prefix on them is ignored.
- `scopeOf(request)` becomes `sessionOf(request).store.workspace.scope`. `routeScope` and every route use `sessionOf(request).store` where they used `deps.workspace`. In `apps/server/src/http.ts`: `sessionOf(request): Session` returns the session the hook resolved. Routes never call `identify` or check rights themselves.

### M6: Rights (pinned, `apps/server/src/rights.ts`)

```ts
export function rightsOf(user: User, session: SessionRecord): SessionRights | undefined;
// owner → {open: true, change: true, owner: true}
// share "write" → {open: true, change: true, owner: false}
// share "read"  → {open: true, change: false, owner: false}
// share "private" → undefined (no open right)
```

The `onRequest` hook resolves the session of a session-resolving route and checks:

| Route | Needs |
|---|---|
| every session-resolving route | `open`, else 403 `forbidden` (unknown ID: 404 `unknown_session`) |
| `POST /api/commands`, `POST /api/views/open`, `POST /api/views` (save marks the view: a command), `POST /api/views/import` with `open` | `change`, else 403 `read_only` (nothing applied) |
| `POST /api/sessions/:id/share`, `DELETE /api/sessions/:id` | owner, else 403 `not_owner` |
| `GET /api/sessions/:id` | `open` |

In `none` mode every request is `local`, which owns every session, so nothing changes for local use. **Later access control (D-079):** data-ref rights go into `rightsOf` (session level) and into `routeScope`/`scope.set` (a `canRead(user, dataRef)` check). That is the one place, and it is not built now (D-083: ADX is read as the server).

### M7: HTTP payloads (pinned, `packages/shared/src/session.ts`)

```ts
export const SESSION_ID = /^[a-z0-9]{10}$/;
export const USER_ID = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/;
export const LOCAL_USER = "local";
export const MAX_SESSIONS_PER_USER = 200;
export const MAX_TOKENS_PER_USER = 10;
export const MAX_TOKEN_LABEL = 60;
export const SESSION_HEADER = "x-kipscope-session";
/** Live channel close codes. */
export const CLOSE_NO_ACCESS = 4403;
export const CLOSE_SESSION_GONE = 4404;

export const SessionShare = z.enum(["private", "read", "write"]);
export type SessionShare = z.infer<typeof SessionShare>;
export type AuthMode = "none" | "header";

export interface SessionRights { open: true; change: boolean; owner: boolean }

export interface SessionSummary {
  id: string;
  owner: string;
  share: SessionShare;
  createdAt: string;      // ISO
  lastActiveAt: string;   // ISO
  revision: number;
  windows: number;
  scope?: WorkspaceScope;
  view?: { name?: string; title: string; modified: boolean };
  measurement?: string;   // measurement name
  clients: number;        // open live connections
  rights: SessionRights;  // of the requester
}

/** The body of POST /api/views/open, moved from the server. */
export const OpenViewRequest = z.union([
  z.object({ name: z.string() }),
  z.object({ view: z.record(z.string(), z.unknown()) }),
]);
export const CreateSessionRequest = z.strictObject({ open: OpenViewRequest.optional() });
export const ShareRequest = z.strictObject({ share: SessionShare });
export const CreateTokenRequest = z.strictObject({ label: z.string() }); // trimmed 1..60, no control chars: checked by the server

export interface Me { user: string; auth: AuthMode }
export interface SessionList { sessions: SessionSummary[] }        // own, latest lastActiveAt first
export interface SessionAnswer { session: SessionSummary }
export interface CreateSessionAnswer { session: SessionSummary; result?: CommandResult } // result: of the open
export interface TokenSummary { id: string; label: string; createdAt: string; lastUsedAt?: string }
export interface TokenList { tokens: TokenSummary[] }
export interface CreateTokenAnswer { token: string; summary: TokenSummary }

/** "https://h/s/abc…" or "https://h/api/s/abc…/x" → {origin, session}; else undefined. */
export function parseSessionLink(url: string): { origin: string; session: string } | undefined;
export const sessionPath = (id: string) => `/s/${id}`;
export const sessionApi = (id: string) => `/api/s/${id}`;
```

Routes:

| Route | Body | Answer |
|---|---|---|
| `GET /api/me` | — | `Me` |
| `GET /api/sessions` | — | `SessionList` |
| `POST /api/sessions` | `CreateSessionRequest` (may be empty `{}` or no body) | 200 `CreateSessionAnswer`. If the open fails: no session, the failed `CommandResult` with `commandStatus` (as `POST /api/views/open`). 409 `session_limit`. |
| `GET /api/sessions/:id` | — | `SessionAnswer` |
| `POST /api/sessions/:id/share` | `ShareRequest` | `SessionAnswer` |
| `DELETE /api/sessions/:id` | — | `{deleted: id}` |
| `GET /api/tokens` | — | `TokenList` |
| `POST /api/tokens` | `CreateTokenRequest` | `CreateTokenAnswer`; 400 `invalid_request` for a bad label; 409 `token_limit`; 409 `auth_disabled` in `none` mode |
| `DELETE /api/tokens/:id` | — | `{deleted: id}`; 404 `unknown_token` |

New error codes (`ApiError.error.code`): `unauthenticated` (401), `invalid_token` (401), `unknown_session` (404), `forbidden` (403), `read_only` (403), `not_owner` (403), `session_limit` (409), `token_limit` (409), `auth_disabled` (409), `unknown_token` (404).

`workspace.ts` additions: `LiveServerMessage` gains `{ type: "session"; session: SessionSummary }`, and `ClientRenderStatus` gains `user?: string`.

### M8: Live channel per session

- `GET /api/live` (prefixed or default) connects to one session. Order on connect: `hello {clientId}`, `session {summary}` (rights of this connection's user), then `state`. Connecting sets `lastActiveAt`.
- After a share change, each open connection gets `session` with its own rights, or is closed with `CLOSE_NO_ACCESS` (4403) when its user lost `open`. Delete closes every connection with `CLOSE_SESSION_GONE` (4404). The web does not reconnect after these two codes (M12).
- `render-status` and `--wait` see only the clients of that session.

### M9: Server state that was "the one workspace"

- **Signal lists:** `CatalogStore.keep()` returns the set of scopes of all sessions with at least one live client (was: the one workspace's scope). These are never dropped. Up to `MAX_SCOPE_CATALOGS` (4) other lists stay LRU. Two sessions on one scope share one list (D-082). When a live client connects to a session with a scope, or such a session's scope changes, `keepCatalogLoaded` runs for that scope (idempotent while it runs). At start no scope list loads.
- **Periods and events-line prefetch:** `workspaceSignals` and the events-line signals become the union over the sessions with a live client (D-081: „plus the workspace's window and events-line signals").
- **Views per user:** `viewsOf(userId)` returns one cached `ViewStore` on `<stateDir>/users/<user>/views/`. The save, open, import and `_previous` hooks use the requester's store.
- **Persistence:** one `StatePersister` per session (M4). `flush()` of all of them on `SIGINT`/`SIGTERM`.
- **Meta:** `GET /api/meta` (session-resolving) reports that session's scope list, as today for the one workspace.

### M10: Access guard with configured origins (`access.ts`)

- **Host:** loopback names, the `KIPSCOPE_HOST` name (non-loopback, non-wildcard), and the host of each `KIPSCOPE_ORIGINS` entry, any port. A proxy may forward its upstream host (loopback) or the public one.
- **Origin:** none; `http(s)` with a loopback host or the `KIPSCOPE_HOST` name, any port (today); or exactly one of the `KIPSCOPE_ORIGINS` (scheme, host and port compared after URL normalisation, so `https://h` equals `https://h:443`).
- JSON bodies only and bounded live frames stay as they are. In header mode the Origin check is what stops cross-site requests that carry the user's proxy cookie (CSRF and cross-site WebSocket).
- **Start log:** in `none` mode with a non-loopback host, today's warning. In header mode one info line names the header, the trusted proxies and the origins. If `KIPSCOPE_HOST` is not loopback, a warning says that only the proxy should reach `<host>:<port>`. The lines come from the pure function `accessLog(config): {level: "info" | "warn"; message: string}[]`.

### M11: Built UI served by the server (`apps/server/src/web.ts`)

With `KIPSCOPE_WEB_DIR` set, a `GET` of a path outside `/api/` answers the file below that directory, or `index.html` when there is no such file (so `/s/<id>` loads the app). Content types: `.html` `text/html; charset=utf-8`, `.js` `text/javascript; charset=utf-8`, `.css` `text/css; charset=utf-8`, `.svg` `image/svg+xml`, `.png` `image/png`, `.ico` `image/x-icon`, `.woff2` `font/woff2`, `.json` and `.map` `application/json`, `.txt` and `.md` `text/plain; charset=utf-8`; anything else is `application/octet-stream`. A path that resolves outside the directory answers 404. `index.html` is sent with `cache-control: no-cache`, and files under `assets/` with `max-age=31536000, immutable`. Implemented with `node:fs` and no new dependency. Without the variable these paths answer 404 as today.

### M12: Web (`apps/web/src/session/`)

- **Start-up** (`startup.ts`, a pure `startupTarget(location, sessions)` plus the effect in `main.tsx`/`App.tsx`), before the live channel opens:
  - `/s/<id>` without a view in the address → that session.
  - Any path with `#view=` or `?view=` → `POST /api/sessions {open}`. On success, `history.replaceState` to `/s/<new>` (no reload). On failure, the user's latest session, with the open's error in the message line.
  - `/` → `GET /api/sessions`, the first entry, else `POST /api/sessions {}`. Then `replaceState` to `/s/<id>`.
- **API prefix:** `apiPath(path)` → `/api/s/<id>` + the rest of the path for session-resolving paths. `api.ts` and `live.ts` use it. Session-independent calls (`/api/me`, `/api/sessions`, `/api/tokens`, `/api/views` list, get and delete) stay unprefixed.
- **Gate pages:** if `GET /api/sessions/<id>` answers 404 or the live channel closes with 4404: "Session not found", with buttons "My latest session" and "New session". If it answers 403 or the channel closes with 4403: "No access to this session", with the same buttons. 401: "Not signed in. Reload to sign in." The live channel does not reconnect after 4403 or 4404.
- **Sessions menu** (top row, next to Views): own sessions from `GET /api/sessions`, latest first. Each row shows the title (`sessionTitle(summary)`: view title, else measurement name, else `<dataRef> <scope start, local>`, else `New session`), the last active time (relative), and `●` when it has clients; the current session is marked. A click opens the session in the same tab, and a middle or Ctrl click in a new tab (plain links to `/s/<id>`). Below the list: "New session", "Copy session link" (the page address `/s/<id>`), share radio `Private · Read · Write` (owner only), and `×` per row to delete a session other than the current one, with a confirm.
- **Read-only:** when `rights.change` is false, the top row shows a `Read-only` pill. Its tooltip: `<owner> shares this session read-only. Copy link opens your own copy.` Commands are still sent, and their `read_only` rejections show in the message line like any rejection.
- **CLI access…** (overflow menu, only when `me.auth === "header"`): a dialog that lists the tokens (label, created, last used, Revoke) and has a label field with "Create token". After a create it shows the token once, with `export KIPSCOPE_URL=<origin>` and `export KIPSCOPE_TOKEN=<token>` lines and a Copy button.
- **Footer:** in header mode, an item with the user ID after the build item. Its tooltip: `Signed in as <user> (SSO)`. Nothing is shown in `none` mode. `footerItems(meta, zone, me?)`.
- "Copy link" builds `viewLinkUrl(workspace, location.origin + "/")`, so the link opens a new session wherever it is opened.

### M13: CLI (`apps/cli/src`)

- **Options:** `--session ID|URL` (else `KIPSCOPE_SESSION`). `--token T` (else `KIPSCOPE_TOKEN`), sent as `Authorization: Bearer T`. `--server` may be a session link (`parseSessionLink`): server = its origin, session = its ID, unless `--session` is given. A `--session` value that is neither an ID nor a link is a usage error (exit 2).
- **One session per call:** with a session, every request goes to `/api/s/<id>/…`. Without one, the client takes the session from the first answer's `X-KIPscope-Session` and prefixes every later request of the same call (so `--wait` polls the session the command went to).
- **Output:** `CliOutput.session?: string`, the session the call served.
- **Forms:** `whoami` → `data: Me`. `session list` → `data: SessionList`. `session new` → `data: CreateSessionAnswer` plus `local.url` = `<server>/s/<id>`. `session share private|read|write` (the call's session) → `data: SessionAnswer`. `session delete ID` → `data: {deleted}`. All honour `--server`, `--token` and `--timeout`. A 401 or 403 maps to exit 1 `rejected` with the server's code (the existing 4xx rule).

### M14: Docs

- `docs/deploy.md` (new): the server behind a TLS proxy, with `KIPSCOPE_AUTH=header`, `KIPSCOPE_ORIGINS`, `KIPSCOPE_WEB_DIR` and the build. One authentik example (proxy provider, forward auth, nginx `auth_request` to the outpost, `proxy_set_header X-authentik-username`) and the shape for KI.ping (an `auth_request` endpoint that answers 2xx with a user header). The token route: requests with `Authorization: Bearer kst_` skip forward auth (nginx `map`, Traefik router rule), or the CLI reaches KIPscope's port directly. The trust boundary. ADX on a server: `az login --service-principal` or `az login --identity`, with today's `KIPSCOPE_ADX_AUTH=azcli`.
- `docs/http-api.md`: the prefix rule, the default session, the new routes, error codes and the session header.
- README: the new variables and CLI forms, and a link to `docs/deploy.md`.

## Numbers

| Number | Value | If off by ×2 |
|---|---|---|
| Session ID | 10 × `[a-z0-9]` ≈ 51.7 bits | Rights guard access, not the ID's secrecy. Creation draws again on a collision (chance ≈ 2 · 10⁻⁹ at 4,000 sessions). 5 or 20 characters change nothing else. |
| Sessions per user | 200 | 100: a user opening 20 cases a day loses sessions after 5 days instead of 10, and an old tab then shows "Session not found". 400: 4 MB per user on disk. Neither matters for correctness. |
| Idle days | 30 (configurable) | 15 or 60: only how long an untouched case link stays valid. |
| Tokens per user | 10 | Only a bound on the token file. |
| `lastUsedAt` write | ≤ 1 per minute per token | Bounds writes under a CLI loop. |
| Kept scope lists | every scope with a live client, plus 4 LRU | Memory: a list of 10,000 signals (D-080) is ~10 MB, so 20 users on 20 scopes ≈ 200 MB. At ×2 (400 MB), the next change can cap the kept set. Goal: measured and reported in the two-user UI check (server RSS). |
| Start read of session files | all files | 4,000 × 10 KB ≈ 40 MB, < 2 s. At ×2 it is still < 5 s. |
| Close codes | 4403, 4404 | Private range 4000–4999. |

## Fit for the next changes

- **`add-case-open`:** the handoff is `POST /api/sessions {open: {view}}` extended by a `case` field (context, book, neighbours). The link form `/?case=…` follows the start-up path of M12 that `#view=` takes. A neighbour click is a `scope.set` in the same session, and neighbour preloading is the `preload` query class.
- **`add-signal-books`:** the learned book is `<stateDir>/users/<user>/book.yaml`, keyed by `identify(request).id`. M4 and M9 already create `users/<user>/`.
- **Later rights (D-079):** `rightsOf` and a `canRead(user, dataRef)` in `routeScope`/`scope.set` (M6).

## Spec owner's defaults (Jan can veto)

- The default session for requests without a session (M4, M5): the user's most recently active one, created if none. This keeps today's routes, scripts and the CLI without `--session` working.
- A `#view=` link and `?view=` open a new session. "Open" from the Views menu still replaces the current session's workspace and writes `_previous`.
- The session list shows own sessions only. Others' sessions are reached by link.
- A new session starts `private`.
- The identity header default `X-authentik-username`, and the trusted proxies default loopback.
- Tokens do not expire. They are revoked by hand.
- 200 sessions per user with LRU eviction, and 30 idle days.
- Migration of `workspace.json` and `views/` to the user `local`.
- The server serves the built UI from `KIPSCOPE_WEB_DIR` (no new dependency).
- The user is shown in the footer in header mode only.

## Risks

- **A misconfigured proxy that passes a client's own identity header** would let anyone act as anyone. Mitigations: the trusted-peer check, the docs' "overwrite the header" rule, and the start log naming the header and proxies.
- **Read-only sessions are passive:** a reader's zoom is rejected. That is intended (a shared case is watched); "Copy link" gives an own copy.
- **Two writers in one session** overwrite each other's ranges (last command wins), as two tabs do today (concept §7 accepts this).
- **Not testable here:** a real authentik or KI.ping in front. The header mode is tested with injected peers and headers and in the UI with the Vite dev user; the real proxy is Jan's deployment check (`docs/deploy.md`).
