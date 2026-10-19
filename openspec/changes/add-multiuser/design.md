# Design

## Context

- **Jan's decisions:** D-079: „das soll auf einem server laufen, dem gleichen vielleicht wie Ki ping. lokal ist immer nur der browser. Multiuser ist also pflicht. eine zugriffsberechtigung im Server muss später auch einbaubar sein". D-083: „jedes sesseion braucht rechte, ja. ADX rechte sind serverrechte hier keine unterscheidung" (its SSO part, „ping oder authentik", is superseded by D-084). D-084: „1: bei mir lokal ohne login, bin mein eigener herr. für corp usage brauche ich was mit regeln und rechten. PING id sollte möglich sein mit unterschiedlichen rechten. 2. keine Ahnung es gibt rollen,. die bestätigt ein tool in verbindung mit PIng id. not my business. muss halt anpassbar sein. da darf jeder auch seinen eigenen krams einbauben. nur rollen und recht müssen wirken können und sicher genug sein, also hier darf nicht jeder nutezer alle platformen sehen. q4 views je nutzer, ja". On the recommendation „a workspace per session/case with its own URL (old tabs keep their case), not one workspace per user" Jan answered „ja". Platform (2026-10-19): „platform ist nur für riesen corp dinger. bei mir wären es smarts, ein fiat , ein SUV hab aber nicht von jeder platform mehrere instanzen". D-082: catalogs are keyed by scope. D-081: query classes. D-078: the finder hands over cases.
- **Concept:** §7 „Vollständige CLI-Fernsteuerung … Eine KI verwendet diese reguläre Schnittstelle" (the CLI needs an identity without a browser). §8 „Ein eigenes Rechteverwaltungssystem kommt später. Ein autorisierter Datenbankzugang bleibt erforderlich; Zugangsdaten gehören nicht in exportierte Templates".
- **Style to follow:** the data-source spec (a lean, documented adapter contract, built-in adapters, one conformance suite an adapter author reuses).
- **Code today:** one `WorkspaceStore` (`apps/server/src/workspace.ts`) in `AppDeps.workspace`. `routes/workspace.ts` serves `/api/commands`, `/api/workspace`, `/api/render-status` and `/api/live`. `scopeOf(request, workspace)` (`scope.ts`) returns that workspace's scope; add-scope named it as the one hook this change replaces. Every data route already passes `routeScope(deps, request, reply)` (`http.ts`), which returns the scope and the signal list the route reads; routes decide `unknown_signal` and `unknown_data_ref` from that list. `catalogContext(catalog)` gives commands their signal lookups. `scope.set` does not check that its data ref exists. `CatalogStore.keep()` returns the one scope that is never dropped. `GapCache` measures periods for `workspaceSignals(workspace)`. `StatePersister` writes `<stateDir>/workspace.json`. `ViewStore(<stateDir>/views)` holds the views. `access.ts` admits loopback hosts plus `KIPSCOPE_HOST`. The web calls fixed `/api/...` paths. The server does not serve the built UI. Vite proxies `/api` with `ws: true`.

## Goals / Non-Goals

**Goals:** identity as a pluggable adapter (request → user and roles, or refused) with `none` as the default and a built-in that works with Ping Identity. Roles mapped to rights by a rules file, enforced by KIPscope on the server at one place for every route, the CLI included, deny by default, with no data leaking through errors or counts. A workspace per session with owner, share level, own URL, live channel and state file; sharing never widens data access. Views per user. The CLI and AI callers authenticate through the same adapter. A server deployment behind a TLS proxy. Interfaces that `add-case-open` and `add-signal-books` build on.

**Non-goals:** proposal "Out of scope".

## Jan's answers (2026-10-19)

- **Q-1 Identity mechanism → pluggable adapter (D-084).** „bei mir lokal ohne login, bin mein eigener herr": `none` stays the default (M1). „PING id sollte möglich sein mit unterschiedlichen rechten": the built-in `oidc` adapter validates Ping-issued tokens (M15). „da darf jeder auch seinen eigenen krams einbauen": a module adapter loaded from config (M1).
- **Q-2 CLI identity → the same adapter (D-084).** „es gibt rollen, die bestätigt ein tool in verbindung mit PIng id. not my business. muss halt anpassbar sein": the CLI sends a bearer token that the company's tool obtained; the adapter checks it like a browser request. KIPscope's own personal tokens are dropped (M13, Q-5).
- **Q-3 Rights → roles map to rights; share levels stay for sessions (D-084).** „nur rollen und recht müssen wirken können und sicher genug sein, also hier darf nicht jeder nutzer alle platformen sehen": rules (M3) and one guard (M6).
- **Q-4 Saved views → per user.** „q4 views je nutzer, ja".
- **Platform → data-ref patterns.** „platform ist nur für riesen corp dinger. bei mir wären es smarts, ein fiat , ein SUV hab aber nicht von jeder platform mehrere instanzen": rights name data refs by glob patterns in the rules file. There is no platform column in the source and no platform concept in KIPscope; a large company groups its data refs by naming patterns (`px-*`).

## Questions for Jan

Tasks are written for the recommended answer. The lead confirms it with Jan before round 1.

- **Q-5 Where does a CLI or AI caller get its token?** (a) **The company's tool (recommended):** a Ping-connected tool (PingFederate or PingOne device flow, or client credentials for an AI service account) prints an access token; the CLI takes it from `--token`, `KIPSCOPE_TOKEN` or `KIPSCOPE_TOKEN_COMMAND` (M13). No KIPscope code beyond that. (b) KIPscope's own personal tokens again (created in the UI by a signed-in user, about 150 lines, M3 of the earlier draft), for a company without such a tool. (c) An OIDC device flow inside the CLI (needs a public client registered at Ping; about 120 lines). Only Jan, or his company, knows whether such a tool exists.
  **Lead's reading of Jan's answer (2026-10-19, Jan can veto): (a).** Jan: „es gibt rollen, die bestätigt ein tool in verbindung mit PIng id. not my business. muss halt anpassbar sein“: the company's tool provides the token; a company without one plugs in its own adapter.

## Decisions

### M1: Identity adapter (pinned contract, `apps/server/src/identity.ts`)

```ts
/** What an adapter sees of a request (HTTP or the live channel's upgrade). */
export interface IdentityRequest {
  /** Header names lower-case; a repeated header is joined with ", " (Node's rule). */
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** The TCP peer, IPv4-mapped IPv6 as IPv4. Never taken from X-Forwarded-For. */
  readonly peer: string;
  readonly method: string;
  /** Path without query, after the session prefix was removed (M5). */
  readonly path: string;
}
export interface Identity { readonly user: string; readonly roles: readonly string[] }
export type IdentifyResult =
  | Identity
  | { readonly refused: "unauthenticated" | "invalid_token"; readonly reason?: string };
export interface IdentityAdapter {
  /** "oidc" or the module's own name; shown by GET /api/me and the start log. */
  readonly kind: string;
  /** No credential: refused "unauthenticated"; a bad one: "invalid_token". Throws only when it cannot decide (IdP unreachable). */
  identify(request: IdentityRequest): Promise<IdentifyResult>;
  close?(): Promise<void>;
}
/** The default export of a module adapter. */
export type IdentityFactory = (options: {
  env: Readonly<Record<string, string | undefined>>;
  log: { info(message: string): void; warn(message: string): void };
}) => IdentityAdapter | Promise<IdentityAdapter>;
```

- **Selection:** `KIPSCOPE_IDENTITY` = `none` (default), `oidc` (M15), or `module:<path>` (absolute, or relative to the working directory; `.mjs`, `.js` or `.ts` as Node runs it). A module is imported once at start; a missing file, a default export that is not a function, or a result without `kind` and `identify` stops the server naming the variable and the reason.
- **`none`:** no adapter runs. Every request is `{user: "local", roles: []}` with all rights (`ALL_RIGHTS`, M3); the rules file is not read. Local use stays as today (D-084 „bei mir lokal ohne login").
- **What the server checks of every result** (so a custom adapter cannot hand over a malformed user): `user` matches `USER_ID` (M7), `roles` is an array of at most 200 strings of 1–128 characters without control characters. Anything else is refused as `unauthenticated` with one warning per minute naming the adapter. A thrown error answers 503 `identity_unavailable` (fail closed) with one warning per minute; the error text is not sent to the client.
- **Where it runs:** once per request, in the `onRequest` hook of M6, for every path under `/api/` except `GET /api/license`, after the Host/Origin guard, the live channel's upgrade included. No other server file reads `authorization` or an identity header.
- **Conformance suite:** `apps/server/test/identity/conformance.ts` exports `identityConformance(name, setup)`. `setup()` returns `{adapter, signedIn: {request, user, roles}, missing: request, forged: request[]}`. The suite checks: the signed-in request gives exactly that user and those roles; the missing one is refused `unauthenticated`; each forged one is refused (`invalid_token` or `unauthenticated`), never a user; 1,000 random header sets (fixed seed) never yield a user and never throw; `identify` leaves the request object unchanged. It runs against `oidc` (`apps/server/test/identity/oidc.conformance.test.ts`, a local JWKS server and keys made in the test) and the example module (`apps/server/test/identity/forward-header.conformance.test.ts`). An adapter author copies one of these files.
- **Example module** `apps/server/examples/forward-header.mjs` (plain JS, about 40 lines, no dependency): trusts `X-Forwarded-User` and `X-Forwarded-Groups` (comma list) only from peers in `KIPSCOPE_TRUSTED_PROXIES` (IPs and CIDRs via `node:net` `BlockList`, default `127.0.0.1,::1`). It is the documented way to plug in one's own adapter, the forward-auth alternative to M15, and the adapter of the two-user UI checks (Vite injects the headers, M2).

### M2: Variables (pinned, `apps/server/src/config.ts`, `.env.example`)

| Variable | Default | Rule |
|---|---|---|
| `KIPSCOPE_IDENTITY` | `none` | `none`, `oidc` or `module:<path>`. Any other value stops the server naming the variable and the three forms. |
| `KIPSCOPE_RULES` | unset | Path of the rules file (M3). Required unless `none`; missing or invalid stops the server naming the file and the bad entry. With `none` it is ignored with one info line. |
| `KIPSCOPE_OIDC_ISSUER` | — | Required with `oidc`. An `https` URL (`http` only for a loopback host, for tests). |
| `KIPSCOPE_OIDC_AUDIENCE` | — | Required with `oidc`. |
| `KIPSCOPE_OIDC_JWKS_URL` | discovered | Else `jwks_uri` of `<issuer>/.well-known/openid-configuration`, fetched at start (failure: the server starts, and requests answer 503 `identity_unavailable` until it succeeds; retried at most every 30 s). |
| `KIPSCOPE_OIDC_USER_CLAIM` | `sub` | A claim name. |
| `KIPSCOPE_OIDC_ROLES_CLAIM` | `roles` | A claim name or dotted path (`realm_access.roles`). |
| `KIPSCOPE_OIDC_HEADER` | `authorization` | The header holding the token; for `authorization` the value must be `Bearer <jwt>`, for any other header the bare JWT. |
| `KIPSCOPE_OIDC_ALGS` | `RS256,PS256,ES256` | Subset of `RS256 RS384 RS512 PS256 PS384 PS512 ES256 ES384 ES512 EdDSA`; `none` and `HS*` are refused at start. |
| `KIPSCOPE_ORIGINS` | empty | Comma list of origins `http(s)://host[:port]` without path. Required (non-empty) unless `none`. A bad entry stops the server. |
| `KIPSCOPE_SESSION_IDLE_DAYS` | `30` | Integer ≥ 1. |
| `KIPSCOPE_WEB_DIR` | unset | A directory holding `index.html`. Unset: no static files (today). |

`IdentityConfig = { kind: "none" } | { kind: "oidc"; oidc: OidcConfig } | { kind: "module"; path: string }`. A module reads its own variables from `env`. The web's dev proxy (`apps/web/vite.config.ts`) adds `X-Forwarded-User: <KIPSCOPE_DEV_USER>` and `X-Forwarded-Groups: <KIPSCOPE_DEV_ROLES>` to `/api` requests, the WebSocket included, when `KIPSCOPE_DEV_USER` is set. Two Vite servers with different users let one person test two users against a server running the example module on loopback.

### M3: Rules and rights (pinned, `apps/server/src/rights.ts`)

Rules file (YAML, read once at start; a change needs a restart):

```yaml
kipscope: rules
version: 1
roles:
  - role: px-engineering      # a role string exactly as the adapter returns it (case-sensitive)
    data: ["px-*", "demo"]    # data-ref patterns
    share: true               # may share sessions (read/write); default false
  - role: kipscope-admin
    data: ["*"]
    share: true
```

- Validation: `kipscope: rules`, `version: 1`, `roles` a list of at most 1,000 entries with only the keys `role`, `data`, `share`; `role` 1–128 characters without control characters, each role at most once; `data` a list of at most 200 patterns, each 1–128 characters without `/`, whitespace or control characters. Anything else stops the server naming the file and the entry's index and key.
- **Pattern:** a glob over the whole data ref, case-sensitive: `*` any run of characters (also none), `?` one character, every other character literal. `px-*` matches `px-01`, not `apx-01`.
- **Rights of a request:** the union over the entries whose `role` is one of the identity's roles: `data` = all their patterns, `share` = any `share: true`. No matching entry: no rights (deny by default). `none` mode: `ALL_RIGHTS`.

```ts
export interface Rules { readonly roles: readonly { role: string; data: readonly string[]; share: boolean }[] }
export interface Rights { readonly data: readonly string[]; readonly share: boolean }
export const ALL_RIGHTS: Rights; // { data: ["*"], share: true }
export function loadRules(path: string): Rules;                 // throws naming file, index and key
export function rightsOf(identity: Identity, rules: Rules): Rights;
export function hasRights(rights: Rights): boolean;             // data.length > 0
export function canSee(rights: Rights, dataRef: string): boolean; // one compiled RegExp per pattern set, cached
export function dataRefsOfWorkspace(workspace: Workspace): string[]; // scope, window signals, events-line signals; unique
export function dataRefsOfView(document: unknown): string[];    // scope, window signals, events signals of a view document (any version the parser reads)
export function dataRefsOfCommand(command: Command): string[];  // M6 table
```

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

- **State file** `<stateDir>/sessions/<id>.json`: `{kipscope: "session", version: 1, id, owner, share, createdAt, lastActiveAt, revision, workspace}`. It is written like today's state file (`StatePersister`: 500 ms trailing debounce after a change, at once on `SIGINT`/`SIGTERM`, atomic), also after a share change or a live connect. A file that fails validation is renamed `<id>.bad.json` with one warning, and the other sessions still load. Delete removes the file.
- **At start** every session file is read into memory (200 sessions × 20 users × ~10 KB ≈ 40 MB, read in < 2 s).
- **New session:** an empty workspace seeded with the project file's `measurement` and events-line signals, as a fresh workspace is today, minus events-line signals of data refs the creator may not see. Revision 0, owner the requester, share `private`.
- **Migration** (once, at start, before reading `sessions/`): if `<stateDir>/workspace.json` exists and `<stateDir>/sessions/` does not, the file's workspace and revision become a session owned by `local` (share `private`), and the file is renamed `workspace.migrated.json`. If `<stateDir>/views/` exists and `<stateDir>/users/local/views/` does not, the folder is renamed to it. Each step logs one info line. An unreadable `workspace.json` is moved to `workspace.bad.json` as today.
- **Limits:** `MAX_SESSIONS_PER_USER = 200`. Creating one more deletes that user's least recently active session without a live client; if every one has a client, 409 `session_limit`. Idle cleanup at start and every hour deletes sessions whose `lastActiveAt` is older than `KIPSCOPE_SESSION_IDLE_DAYS` and that have no live client.
- **Default session** of a user: among the sessions they own and may open (M6: every data ref visible), the one with the latest `lastActiveAt`; if none, a new empty one is created on the first request that needs a session.

Server interface between the session task and the route tasks (pinned):

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
  /** Runs the migration, reads every session file, starts the hourly cleanup. */
  start(): void;
  get(id: string): Session | undefined;
  create(owner: string, seed?: Workspace): Session; // throws SessionLimitError
  /** Latest own session that `canOpen` accepts, else a new one. */
  defaultOf(user: string, canOpen: (session: Session) => boolean): Session;
  listOf(user: string): Session[];    // own, latest lastActiveAt first
  setShare(id: string, share: SessionShare): Session;
  delete(id: string): boolean;
  touch(id: string): void;            // lastActiveAt = now, debounced write
  /** Sessions with at least one live client. */
  open(): Session[];
  /** Fires after a share change, a delete, or any accepted command. */
  onChange(listener: (event: { type: "share" | "delete" | "command"; session: Session; scopeChanged: boolean }) => void): () => void;
  flush(): void;
  cleanup(): number;                  // deleted count
  stop(): void;                       // timers off (tests, close)
}
export function summaryOf(session: Session, rights: SessionRights): SessionSummary;
```

`WorkspaceStore` keeps its API, with two changes: `execute(input, ctx?, beforeOpen?)` takes the `_previous` hook per call (it writes to the requester's view store, M9), and `connect(user)` records the user per client, listed as `user` by `renderStatus()`.

### M5: Addressing (pinned)

- **UI:** `/s/<id>` is the page of session `<id>`. `/` is the start-up page (M12).
- **API prefix:** `/api/s/<id>/<rest>` serves `/api/<rest>` for session `<id>`. Fastify's `rewriteUrl` turns `/api/s/<id>/…` (`<id>` matching `SESSION_ID`) into `/api/…` before routing and records `<id>` on the raw request. Routes are registered once; `docs/http-api.md` names each route once, plus the prefix rule.
- **Session-resolving routes:** those with access `session` or `change` in the M6 table. With the prefix they serve that session; without it the requester's default session (M4). Every answer that served a session carries `X-KIPscope-Session: <id>` (`SESSION_HEADER`).
- **Session-independent routes:** the others. A prefix on them is ignored.
- `scopeOf(request)` becomes `sessionOf(request).store.workspace.scope`. Routes use `sessionOf(request).store` where they used `deps.workspace`. `apps/server/src/http.ts` exports `sessionOf(request): Session` and `userOf(request): { identity: Identity; rights: Rights }`, both set by the M6 hooks. Routes never call `identify` or decide rights themselves.

### M6: The guard: one place for every route (pinned, `apps/server/src/guard.ts` using `rights.ts`)

Every route under `/api/` declares its access in its Fastify route options, `config: { access: Access }`:

```ts
export type Level = "public" | "identity" | "user" | "session" | "change";
export type Access = {
  /** public: no user. identity: a user, rights not needed. user: a user with rights. session: + open right on the session. change: + change right. */
  level: Level | { body: (request: FastifyRequest) => "user" | "session" | "change" }; // body form: decided in preHandler (only POST /api/views/import); counts as "user" in onRequest
  /** Every data ref the request names (query, body); checked before the handler runs. */
  dataRefs?: (request: FastifyRequest) => string[];
};
```

An `onRoute` hook throws at start for a route under `/api/` without `config.access`, so a new route cannot bypass the guard (fail closed). Two app-level hooks, in `guard.ts`, are the only code that decides access:

1. **`onRequest`** (after the Host/Origin guard; before body parsing; the live upgrade included): level `public` → pass. Else `identify` (M1): refused → 401 with the refusal code; thrown → 503 `identity_unavailable`. Then `rightsOf`. Level ≥ `user` without rights → 403 `no_rights`.
2. **`preHandler`** (body parsed): for `session` and `change`: resolve the session (prefix or default; unknown ID → 404 `unknown_session`) and `sessionRights` (below); no open right → 403 `forbidden`; `change` without the change right → 403 `read_only`. Then every data ref of `dataRefs(request)` must pass `canSee`, else 403 `forbidden_data`.

| Route | Level | `dataRefs` |
|---|---|---|
| `GET /api/license` | public | — |
| `GET /api/me` | identity | — |
| `GET /api/sessions`, `GET /api/sessions/:id`, `POST /api/sessions/:id/share`, `DELETE /api/sessions/:id` | user | — (the routes check owner and share right, below) |
| `POST /api/sessions` | user | the `open` view's: `dataRefsOfView`, or of the saved view named |
| `GET /api/views`, `GET /api/views/:name`, `DELETE /api/views/:name` | user | — |
| `POST /api/views/import` | user, or change with `open: true` | `dataRefsOfView(body.view)` |
| `POST /api/views` (save) | change | — |
| `POST /api/views/open` | change | the view's (named: read from the requester's store) |
| `POST /api/commands` | change | `dataRefsOfCommand`: `window.addSignal` and `events.addSignal` the signal's data ref; `scope.set` its `dataRef`; `view.open` `dataRefsOfView` of its document; others none |
| `GET /api/workspace`, `GET /api/render-status`, `GET /api/live`, `GET /api/meta` | session | — |
| `GET /api/catalog`, `GET /api/signals`, `POST /api/catalog/refresh` | session | — (the answer is filtered, below) |
| `GET /api/extent`, `GET /api/series`, `GET /api/value` | session | the `signal`'s data ref (a malformed ID: none; the route answers as today) |
| `GET /api/density` | session | `dataRef` |
| `GET /api/gaps`, `GET /api/events` | session | `dataRef` and each `signal`'s |

**Session rights** (`rights.ts`):

```ts
export function sessionRights(user: string, rights: Rights, session: Session): SessionRights | undefined;
// undefined (no open right) when any data ref of the session's workspace fails canSee, whoever the user is;
// else owner → {open: true, change: true, owner: true}
//      share "write" → {open: true, change: true, owner: false}
//      share "read"  → {open: true, change: false, owner: false}
//      share "private" → undefined
```

Sharing never widens data access: a session holding a data ref the user may not see is refused as a whole (403 `forbidden`, the same answer as a private session), never shown filtered. Why refuse rather than filter: a filtered view would need a per-user workspace (its own revision, live state and windows with hidden signals), and a writer would change windows whose content they cannot see. Refusing is one check. The owner may still list and delete such a session.

`POST /api/sessions/:id/share` and `DELETE` need the owner (else 403 `not_owner`); setting `read` or `write` also needs `rights.share` (else 403 `share_not_permitted`); `private` is always allowed.

**Filtered lists:** `routeScope` returns, instead of the shared `Catalog`, a `CatalogView` of it for the request's rights (`apps/server/src/rights.ts`):

```ts
export interface CatalogView extends Pick<Catalog, "loadedAt" | "lastError" | "unavailableReason" | "refresh"> {
  get(id: string): SignalInfo | undefined;   // undefined for a signal the user may not see
  all(): readonly SignalInfo[];              // visible signals only
  search(q: string, offset: number, limit: number): SignalPage; // over visible signals; total counts them only
  snaRanges(id: string): ReturnType<Catalog["snaRanges"]>;
  readonly size: number;                     // visible signals
}
export function catalogView(catalog: Catalog, rights: Rights): CatalogView; // identity view for ALL_RIGHTS
```

`/api/catalog`, `/api/signals`, `/api/meta` (`catalog.size`) and the command context (`catalogContext(view)`) read the view. The shared catalogs, caches and prefetches stay keyed by scope and data ref as today; they never reach a user except through a guarded route.

**No leaks through errors or counts:**

- `forbidden_data` is decided from the patterns alone, before any catalog lookup, cache read or source query, so the answer for a data ref that exists and one that does not are equal except for the name the request sent. Its message is `data ref <ref> is not permitted`.
- A refused session answers 403 `forbidden` whether it is private or holds hidden data.
- Lists and counts (catalog items, `/api/signals` `total`, meta `size`, `/api/sessions`) never include hidden data refs or other users' sessions.
- `unknown_signal` and `unknown_data_ref` are answered only for visible data refs, as today.
- In scoped mode the scope's data ref is visible (session check), and any other data ref answers `out_of_scope` or `forbidden_data`, both independent of existence.

**Live channel:** after each `onChange` event, every open connection of that session re-runs `sessionRights` for its user: a `session` message with the new rights, or a close with 4403 when the open right is gone (a share change, or a command that added a data ref this user may not see).

**ADX access** stays the server's identity (D-083); the data limits are KIPscope's own and never reach the source.

### M7: HTTP payloads (pinned, `packages/shared/src/session.ts`)

```ts
export const SESSION_ID = /^[a-z0-9]{10}$/;
export const USER_ID = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/;
export const LOCAL_USER = "local";
export const MAX_SESSIONS_PER_USER = 200;
export const SESSION_HEADER = "x-kipscope-session";
/** Live channel close codes. */
export const CLOSE_NO_ACCESS = 4403;
export const CLOSE_SESSION_GONE = 4404;

export const SessionShare = z.enum(["private", "read", "write"]);
export type SessionShare = z.infer<typeof SessionShare>;

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
  rights?: SessionRights; // of the requester; absent when they may not open it (an own session holding hidden data)
}

/** The body of POST /api/views/open, moved from the server. */
export const OpenViewRequest = z.union([
  z.object({ name: z.string() }),
  z.object({ view: z.record(z.string(), z.unknown()) }),
]);
export const CreateSessionRequest = z.strictObject({ open: OpenViewRequest.optional() });
export const ShareRequest = z.strictObject({ share: SessionShare });

export interface Me {
  user: string;
  identity: string;       // "none", "oidc" or the module adapter's kind
  roles: string[];
  rights: { data: string[]; share: boolean };
}
export interface SessionList { sessions: SessionSummary[] }        // own, latest lastActiveAt first
export interface SessionAnswer { session: SessionSummary }
export interface CreateSessionAnswer { session: SessionSummary; result?: CommandResult } // result: of the open

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
| `POST /api/sessions` | `CreateSessionRequest` (may be `{}` or no body) | 200 `CreateSessionAnswer`. If the open fails: no session, the failed `CommandResult` with `commandStatus`. 409 `session_limit`. 403 `forbidden_data`. |
| `GET /api/sessions/:id` | — | `SessionAnswer` (open right) |
| `POST /api/sessions/:id/share` | `ShareRequest` | `SessionAnswer` |
| `DELETE /api/sessions/:id` | — | `{deleted: id}` |

New error codes (`ApiError.error.code`): `unauthenticated` (401), `invalid_token` (401), `identity_unavailable` (503), `no_rights` (403), `forbidden_data` (403), `unknown_session` (404), `forbidden` (403), `read_only` (403), `not_owner` (403), `share_not_permitted` (403), `session_limit` (409). `commandStatus` maps a command result `forbidden_data` to 403 (the guard answers before the command runs; the mapping covers a view opened by name).

`workspace.ts` additions: `LiveServerMessage` gains `{ type: "session"; session: SessionSummary }`, and `ClientRenderStatus` gains `user?: string`.

### M8: Live channel per session

- `GET /api/live` (prefixed or default) connects to one session. Order on connect: `hello {clientId}`, `session {summary}` (rights of this connection's user), then `state`. Connecting sets `lastActiveAt`.
- After a share change or a command, each open connection gets `session` with its own rights when they changed, or is closed with `CLOSE_NO_ACCESS` (4403) when its user lost `open` (M6). Delete closes every connection with `CLOSE_SESSION_GONE` (4404). The web does not reconnect after these two codes (M12).
- `render-status` and `--wait` see only the clients of that session.

### M9: Server state that was "the one workspace"

- **Signal lists:** `CatalogStore.keep()` returns the set of scopes of all sessions with at least one live client. These are never dropped; up to `MAX_SCOPE_CATALOGS` (4) other lists stay LRU. Two sessions on one scope share one list (D-082), whatever their users' rights (the view filters per request). When a live client connects to a session with a scope, or such a session's scope changes, `keepCatalogLoaded` runs for that scope. At start no scope list loads.
- **Periods and events-line prefetch:** `workspaceSignals` and the events-line signals become the union over the sessions with a live client.
- **Views per user:** `viewsOf(userId)` returns one cached `ViewStore` on `<stateDir>/users/<user>/views/`. Save, open, import and `_previous` use the requester's store.
- **Persistence:** one `StatePersister` per session. `flush()` of all of them on `SIGINT`/`SIGTERM`.
- **Meta:** `GET /api/meta` (session-resolving) reports that session's scope list through the request's `CatalogView`.

### M10: Access guard with configured origins (`access.ts`)

- **Host:** loopback names, the `KIPSCOPE_HOST` name (non-loopback, non-wildcard), and the host of each `KIPSCOPE_ORIGINS` entry, any port.
- **Origin:** none; `http(s)` with a loopback host or the `KIPSCOPE_HOST` name, any port (today); or exactly one of the `KIPSCOPE_ORIGINS` (scheme, host and port compared after URL normalisation, so `https://h` equals `https://h:443`).
- Behind an SSO proxy the browser's requests carry the proxy's cookie and the proxy adds the credential, so the Origin check is what stops cross-site requests and cross-site WebSockets. Hence `KIPSCOPE_ORIGINS` is required unless `none`.
- **Start log** from the pure function `accessLog(config): {level: "info" | "warn"; message: string}[]`: in `none` mode with a non-loopback host, today's warning. Otherwise one info line naming the identity kind (`oidc` with issuer and audience, or the module path), the rules file with its role count, and the origins; plus, when `KIPSCOPE_HOST` is not loopback, a warning that only the proxy should reach `<host>:<port>`.

### M11: Built UI served by the server (`apps/server/src/web.ts`)

With `KIPSCOPE_WEB_DIR` set, a `GET` of a path outside `/api/` answers the file below that directory, or `index.html` when there is no such file (so `/s/<id>` loads the app). Content types: `.html` `text/html; charset=utf-8`, `.js` `text/javascript; charset=utf-8`, `.css` `text/css; charset=utf-8`, `.svg` `image/svg+xml`, `.png` `image/png`, `.ico` `image/x-icon`, `.woff2` `font/woff2`, `.json` and `.map` `application/json`, `.txt` and `.md` `text/plain; charset=utf-8`; anything else `application/octet-stream`. A path that resolves outside the directory answers 404. `index.html` is sent with `cache-control: no-cache`, files under `assets/` with `max-age=31536000, immutable`. `node:fs` only. These files hold no data and need no identity (the proxy guards the page). Without the variable these paths answer 404 as today.

### M12: Web (`apps/web/src/session/`)

- **Start-up** (`startup.ts`, a pure `startupTarget(location, sessions)` plus the effect in `main.tsx`/`App.tsx`), before the live channel opens:
  - `/s/<id>` without a view in the address → that session.
  - Any path with `#view=` or `?view=` → `POST /api/sessions {open}`. On success, `history.replaceState` to `/s/<new>` (no reload). On failure, the user's latest session, with the open's error in the message line.
  - `/` → `GET /api/sessions`, the first entry with `rights`, else `POST /api/sessions {}`. Then `replaceState` to `/s/<id>`.
- **API prefix:** `apiPath(path)` → `/api/s/<id>` + the rest of the path for session-resolving paths. `api.ts` and `live.ts` use it. Session-independent calls (`/api/me`, `/api/sessions`, `/api/views` list, get and delete) stay unprefixed.
- **Gate pages** (`Gate.tsx`): 404 `unknown_session` or close 4404: "Session not found". 403 `forbidden` or close 4403: "No access to this session". Both with the buttons "My latest session" and "New session". 403 `no_rights`: "No access rights. Your roles (<roles>) match no rule of this KIPscope server." 401: "Not signed in. Reload to sign in." 503 `identity_unavailable`: "Sign-in service unreachable. Try again later." The live channel does not reconnect after 4403 or 4404.
- **Sessions menu** (top row, next to Views): own sessions from `GET /api/sessions`, latest first. Each row shows the title (`sessionTitle(summary)`: view title, else measurement name, else `<dataRef> <scope start, local>`, else `New session`), the last active time (relative), and `●` when it has clients; the current session is marked; a session without `rights` is shown greyed with the tooltip `No access to its data`. A click opens the session in the same tab, a middle or Ctrl click in a new tab (plain links to `/s/<id>`). Below the list: "New session", "Copy session link", the share radio `Private · Read · Write` (owner only; `Read` and `Write` disabled with the tooltip `Your roles do not allow sharing` when `me.rights.share` is false), and `×` per row to delete a session other than the current one, with a confirm.
- **Read-only:** when `rights.change` is false, the top row shows a `Read-only` pill with the tooltip `<owner> shares this session read-only. Copy link opens your own copy.` Commands are still sent; their `read_only` rejections show in the message line.
- **Footer:** unless `me.identity === "none"`, an item with the user ID after the build item; tooltip `Signed in as <user> (<identity>) · roles: <roles, comma-separated, or none>`. `footerItems(meta, zone, me?)`.
- "Copy link" builds `viewLinkUrl(workspace, location.origin + "/")`, so the link opens a new session wherever it is opened, for whoever may see its data.

### M13: CLI (`apps/cli/src`)

- **Options:** `--session ID|URL` (else `KIPSCOPE_SESSION`). The token: `--token T`, else `KIPSCOPE_TOKEN`, else the trimmed stdout of `KIPSCOPE_TOKEN_COMMAND` run once per call through the shell (timeout 10 s; a non-zero exit, a timeout or empty output exits 2 `usage` with `error.code` `token_command_failed` and the command's stderr's last line, nothing sent). The token is sent as `Authorization: Bearer <T>` on every request; it is never printed. `--server` may be a session link (`parseSessionLink`). A `--session` value that is neither an ID nor a link is a usage error (exit 2).
- **One session per call:** with a session, every request goes to `/api/s/<id>/…`. Without one, the client takes the session from the first answer's `X-KIPscope-Session` and prefixes every later request of the same call.
- **Output:** `CliOutput.session?: string`, the session the call served.
- **Forms:** `whoami` → `data: Me`. `session list` → `data: SessionList`. `session new` → `data: CreateSessionAnswer` plus `local.url` = `<server>/s/<id>`. `session share private|read|write` (the call's session) → `data: SessionAnswer`. `session delete ID` → `data: {deleted}`. A 401 or 403 maps to exit 1 `rejected` with the server's code (the existing 4xx rule); 503 `identity_unavailable` to exit 7.
- The CLI never validates tokens and holds no secret of its own; how the company's tool gets a token (device flow, client credentials) is its business (D-084 „not my business").

### M14: Docs

- `docs/deploy.md` (new): the server behind a TLS proxy with `KIPSCOPE_IDENTITY`, `KIPSCOPE_RULES`, `KIPSCOPE_ORIGINS`, `KIPSCOPE_WEB_DIR` and the build. **Ping:** `oidc` with PingFederate (issuer `https://<pf-host>`) or PingOne (issuer `https://auth.pingone.<region>/<envId>/as`); the browser through an OIDC proxy that passes the user's access token as `Authorization: Bearer` on every request and WebSocket upgrade (oauth2-proxy with `--pass-authorization-header`, or PingAccess forwarding the token); the CLI with `KIPSCOPE_TOKEN_COMMAND` running the company's tool; roles from a claim the IdP fills (`KIPSCOPE_OIDC_ROLES_CLAIM`). **Own adapter:** the M1 contract, `module:<path>`, the example module and how to run the conformance suite against it. **Rules:** the file format with an example per data-ref naming scheme. The trust boundary (only the proxy reaches KIPscope's port; for the header example, `KIPSCOPE_TRUSTED_PROXIES`). ADX on a server: `az login --service-principal` or `az login --identity`, with today's `KIPSCOPE_ADX_AUTH=azcli`.
- `docs/http-api.md`: the prefix rule, the default session, the access level of every route, the new routes, error codes and the session header.
- README: the new variables and CLI forms, and a link to `docs/deploy.md`.

### M15: The `oidc` built-in for Ping Identity (`apps/server/src/identity/oidc.ts`)

**Choice:** KIPscope as an OIDC resource server: it validates a JWT access token and takes the user and roles from its claims. The same check serves the browser (a proxy in front adds the token) and the CLI and AI callers (a bearer token from the company's tool). It works with PingFederate and PingOne (both publish OIDC discovery and JWKS) and with any other OIDC IdP. About 100 lines plus the `jose` library (zero dependencies, maintained, used widely for exactly this); signature code is not written by hand.

| Option | Code in KIPscope | Browser | CLI | Trust rests on |
|---|---|---|---|---|
| **JWT validation (`oidc`, recommended)** | ~100 lines + `jose` | proxy adds the token | bearer token | the IdP's signature |
| Forward-auth headers (example module) | ~40 lines | proxy sets user and groups headers | needs a proxy route or personal tokens | the network (only the proxy may reach the port) |
| OIDC login in KIPscope (code flow, cookies, refresh) | ~400 lines + client library | KIPscope redirects | still needs bearer validation | the signature, plus KIPscope's own cookie sessions |

Headers stay possible through the example module; a login flow in KIPscope stays out (it would need routes in the adapter contract).

**Validation, in order** (any failure: refused `invalid_token`; no header: `unauthenticated`):

1. The token from `KIPSCOPE_OIDC_HEADER` (`Bearer ` prefix for `authorization`, case-insensitive scheme). At most 16 KB.
2. JWS compact form; header `alg` in `KIPSCOPE_OIDC_ALGS` (never `none`, never `HS*`, so a public key can never be used as an HMAC secret); `kid` looked up in the JWKS. An unknown `kid` refetches the JWKS at most once per 30 s (key rotation); a JWKS that cannot be fetched and has never loaded throws (503 `identity_unavailable`).
3. Signature valid. `iss` equals the issuer exactly. `aud` (string or array) contains the audience. `exp` present and in the future; `nbf`, when present, in the past; clock tolerance 30 s.
4. The user claim is a string matching `USER_ID`. The roles claim (dotted path) is an array of strings or one space- or comma-separated string; missing: no roles (and so, by the rules, no rights).

The token is never logged or echoed; a refusal is logged at debug level with its reason (`expired`, `bad_signature`, `wrong_audience`, …) and the token's `kid`, not the token.

## Security notes

- **Deny by default:** with an adapter other than `none`, a user whose roles match no rule has no rights: every route but `/api/me` and `/api/license` answers 403 `no_rights`. A missing rules file stops the server.
- **One guard:** `guard.ts` (two hooks) and `rights.ts` (pure functions) hold every access decision; every `/api/` route declares its level and the data refs it names, and an undeclared route stops the server. Routes only read `userOf` and `sessionOf`. Test: "every API route declares its access" (`apps/server/test/guard.routes.test.ts`).
- **Proof that roles separate data:** `apps/server/test/rights.http.test.ts` › "keeps role A out of data refs of role B on every route" runs, for every route of the M6 table that names a data ref, a request for a hidden data ref that exists (`othercar`) and one that does not (`nosuchcar`) as a user whose role sees only `test*`: equal status and code (403 `forbidden_data`), no source query naming either, and catalog, signals and meta never list or count `othercar`. The route list comes from the registered routes, so a new data route without a case fails the test. The CLI test "keeps a role to its data" does the same through `kipscope`.
- **Token checks:** M15. Trusted proxies apply only to the header example (M1). `X-Forwarded-For` is never the peer.
- **Origins:** M10 stops cross-site use of a proxy cookie.
- **Not covered:** timing differences between refusals and answers (the refusal runs no query, as an unknown signal often does not either); rate limits; an audit log.

## Numbers

| Number | Value | If off by ×2 |
|---|---|---|
| Session ID | 10 × `[a-z0-9]` ≈ 51.7 bits | Rights guard access, not the ID's secrecy. Creation draws again on a collision. 5 or 20 characters change nothing else. |
| Sessions per user | 200 | 100: a user opening 20 cases a day loses sessions after 5 days instead of 10 ("Session not found" in an old tab). 400: 4 MB per user on disk. |
| Idle days | 30 (configurable) | 15 or 60: only how long an untouched case link stays valid. |
| JWT clock tolerance | 30 s | 60 s: an expired token works one more minute. 15 s: a client with a skewed clock is refused sooner. |
| JWKS refetch on unknown `kid` | ≤ 1 per 30 s | 60 s: a rotated key works up to a minute later; 15 s: an attacker sending random `kid`s causes at most 4 fetches a minute. |
| Token size | ≤ 16 KB | Ping tokens with many groups are a few KB; 8 KB could refuse a large one, 32 KB changes nothing. |
| Roles per identity | ≤ 200 | 100 could refuse a user in many groups; 400 changes nothing (rights are a union). |
| Rules | ≤ 1,000 roles, ≤ 200 patterns each | Bounds start-up parsing only. |
| Pattern matching | one RegExp per pattern set, cached | Filtering a list of 10,000 signals is ~1 ms; at ×2 still negligible against the list's JSON. |
| Token command timeout | 10 s | 5 s could cut off an interactive device-flow login; 20 s only delays a failure. |
| Kept scope lists | every scope with a live client, plus 4 LRU | A list of 10,000 signals (D-080) is ~10 MB, so 20 users on 20 scopes ≈ 200 MB. At ×2 (400 MB), the next change can cap the kept set. Goal: measured in the two-user UI check (server RSS). |
| Start read of session files | all files | 4,000 × 10 KB ≈ 40 MB, < 2 s; at ×2 < 5 s. |
| Close codes | 4403, 4404 | Private range 4000–4999. |

## Fit for the next changes

- **`add-case-open`:** the handoff is `POST /api/sessions {open: {view}}` extended by a `case` field; its data refs go through the same `dataRefs` declaration, so a handed-over case outside the user's rights is refused.
- **`add-signal-books`:** the learned book is `<stateDir>/users/<user>/book.yaml`, keyed by `userOf(request).identity.user`.
- **More issuers or a login flow:** a second `oidc` issuer, or a module adapter; the contract stays.

## Spec owner's defaults (Jan can veto)

- A shared session holding a data ref the viewer may not see is refused as a whole (403 `forbidden`), not filtered (M6).
- The rules file is its own file (`KIPSCOPE_RULES`), not a section of `kipscope.yaml`: it belongs to the deployment, the project file to the analysis.
- Rules are read at start only; a change needs a restart.
- `forbidden_data` (403) for a hidden data ref, decided by patterns before any lookup, instead of pretending it does not exist (an absent data ref is accepted by `scope.set`, so "as if absent" would let a hidden one in).
- The `oidc` user claim defaults to `sub`, the roles claim to `roles`.
- The default session for requests without a session: the user's most recently active one they may open, created if none.
- A `#view=` link and `?view=` open a new session; "Open" from the Views menu still replaces the current session's workspace and writes `_previous`.
- The session list shows own sessions only; others' sessions are reached by link. A new session starts `private`.
- 200 sessions per user with LRU eviction, and 30 idle days.
- Migration of `workspace.json` and `views/` to the user `local`.
- The server serves the built UI from `KIPSCOPE_WEB_DIR`.
- The user is shown in the footer unless the identity is `none`.

## Risks

- **A misconfigured proxy** (one that lets clients reach KIPscope's port directly, or, with the header example, passes a client's own headers) breaks the trust boundary. Mitigations: `oidc` trusts signatures, not the network; the example checks the peer; the start log names identity, rules and origins; `docs/deploy.md` states the boundary.
- **Roles from a claim the company fills wrongly** give wrong rights. KIPscope enforces what the IdP says (D-084 „not my business"). `/api/me` and the footer tooltip show roles and rights for checking.
- **An own session's summary** still names its scope's data ref after the owner lost the right to it. That is metadata the owner once had, not data; the session cannot be opened.
- **Read-only sessions are passive:** a reader's zoom is rejected; "Copy link" gives an own copy.
- **Two writers in one session** overwrite each other (last command wins; concept §7 accepts this).
- **Not testable here:** a real PingFederate or PingOne and the company's token tool. `oidc` is tested with a local JWKS and test keys, and the UI with the example module and the Vite dev users; the real IdP is Jan's deployment check (`docs/deploy.md`).
