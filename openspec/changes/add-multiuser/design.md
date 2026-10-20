# Design

## Context

- **Jan's decisions:**
  - D-079: „das soll auf einem server laufen, dem gleichen vielleicht wie Ki ping. lokal ist immer nur der browser. Multiuser ist also pflicht. eine zugriffsberechtigung im Server muss später auch einbaubar sein".
  - D-083: „jedes sesseion braucht rechte, ja. ADX rechte sind serverrechte hier keine unterscheidung" (its SSO part is superseded by D-084).
  - D-084: „1: bei mir lokal ohne login, bin mein eigener herr. für corp usage brauche ich was mit regeln und rechten. PING id sollte möglich sein mit unterschiedlichen rechten. 2. keine Ahnung es gibt rollen,. die bestätigt ein tool in verbindung mit PIng id. not my business. muss halt anpassbar sein. da darf jeder auch seinen eigenen krams einbauben. nur rollen und recht müssen wirken können und sicher genug sein, also hier darf nicht jeder nutezer alle platformen sehen. q4 views je nutzer, ja". Its rules part is superseded by D-085.
  - D-085: „wir können das rechtemanagement in kiping packen. das mit der zeitlichen session set stimmt nicht. die liste kann beliebig sortiert sein beliebige VINs." Rights live in KI.ping; the KIPscope rules file is in question.
  - D-086: „unlink ist aktuelles fahrzeug. unlink ist für den user unbegrenzt, rechte haben keinen zeit bezug des objekts. der ist ja". Read as: rights per object with no time part, and the exploration's other recommendations accepted. Q1: "session" is the data section; the server state is the invisible "workspace", renamed in this change. Q11: the rules file drops out of this change. Q13: a view grants nothing.
  - On a workspace per case with its own URL („old tabs keep their case"), Jan answered „ja". D-082: catalogs are keyed by scope. D-081: query classes. D-078: the finder hands over cases.
- **Concept:** §7 „Vollständige CLI-Fernsteuerung … Eine KI verwendet diese reguläre Schnittstelle" (the CLI needs an identity without a browser). §8 „Ein eigenes Rechteverwaltungssystem kommt später. Ein autorisierter Datenbankzugang bleibt erforderlich".
- **Exploration** [2026-10-20-sessions-and-handoff.md](../../../docs/explore/2026-10-20-sessions-and-handoff.md):
  - "Root cause": "session" meant two things.
  - "What the app does today", measured on smart451 on 2026-10-20: rows 1–4 are the Sessions menu, duplicate titles, the two link actions, and two tabs on `/` mirroring each other.
  - "Security": the grant lives in the workspace.
  - "`add-multiuser` vs `add-case-open`": what moves where.
- **Style to follow:** the data-source spec (a lean, documented adapter contract, built-in adapters, one conformance suite an adapter author reuses).

## Revision 2026-10-20: what changes in the built code

Rounds 1–4 built every part below under the name "session", with a rules file. This revision keeps the mechanics and changes four things.

1. **Rename** (D-086 Q1). One word per meaning:
   - **Workspace**, the server state: address, routes, header, CLI, DTOs, files and code names.
   - **Session**, the finder's data section: reserved for `add-case-open`.

   | Was | Becomes |
   |---|---|
   | `/s/<id>` | `/w/<id>` (old addresses redirect in the web) |
   | `/api/s/<id>/…` | `/api/w/<id>/…` (no alias) |
   | `X-KIPscope-Session` | `X-KIPscope-Workspace` |
   | `/api/sessions…` | `/api/workspaces…` |
   | `--session`, `KIPSCOPE_SESSION` | `--workspace`, `KIPSCOPE_WORKSPACE` |
   | `kipscope session list\|new\|share\|delete` | `kipscope workspace list\|new\|share\|delete` |
   | `KIPSCOPE_SESSION_IDLE_DAYS` | `KIPSCOPE_WORKSPACE_IDLE_DAYS` |
   | `<stateDir>/sessions/<id>.json` (`kipscope: "session"`, v1) | `<stateDir>/workspaces/<id>.json` (`kipscope: "workspace"`, v2) |
   | codes `unknown_session`, `session_limit` | `unknown_workspace`, `workspace_limit` |
   | live `{type: "session", session}` | `{type: "summary", summary}` |
   | `packages/shared/src/session.ts`, `apps/server/src/sessions.ts`, `routes/sessions.ts`, `apps/web/src/session/` | `workspaces.ts`, `workspaces.ts`, `routes/workspaces.ts`, `apps/web/src/workspaces/` |
   | `SessionStore`, `Session`, `SessionRecord`, `SessionSummary`, `SessionShare`, `SessionRights`, `sessionOf`, `sessionRights`, `SESSION_ID`, `SESSION_HEADER`, `MAX_SESSIONS_PER_USER` | `WorkspaceRegistry`, `WorkspaceEntry`, `WorkspaceRecord`, `WorkspaceSummary`, `WorkspaceShare`, `WorkspaceRights`, `workspaceOf`, `workspaceRights`, `WORKSPACE_ID`, `WORKSPACE_HEADER`, `MAX_WORKSPACES_PER_USER` |
   | capability `sessions` | `workspaces` |

   Legacy names stay only in constants named `LEGACY_*` (the `sessions` folder, the `session` file tag, the `/s/` path), so the rename check (workspaces "No session in the code") can exclude exactly those lines.
2. **Grant instead of the rules file** (D-085, D-086 Q11, Q12): M3. `KIPSCOPE_RULES`, `loadRules`, `rightsOf`, `hasRights`, the pattern matcher, `no_rights` and the `identity` access level are removed. `Me.rights` becomes `Me.canShare`.
3. **UI** (exploration "Workspaces become invisible"): M12. The Sessions menu goes. A Share… overflow item and a Recent list in the Views menu replace it. `/` reuses a free workspace atomically, and an empty grant shows a gate page.
4. **Share right:** `KIPSCOPE_SHARE=on|off` (M2) instead of the per-role `share` of the rules file. It is the leaner choice for three reasons:
   - The share right is no security boundary. Sharing never widens data (M6), and every user of a server comes from its one identity provider.
   - A role-based right would need a role naming convention, which is a small rules file again; Q11 drops that.
   - It needs no change to the adapter contract.

## Goals / Non-Goals

**Goals:**
- Identity as a pluggable adapter, with `none` as the default and a built-in that works with Ping Identity.
- Data access decided per workspace by a grant that only the server widens, and that is enforced at one place for every route, the CLI included. Deny by default on a server; nothing leaks through errors or counts.
- Many workspaces with owner, share level, grant, own URL, live channel and state file, invisible in daily use. Sharing never widens data access.
- Views per user. The CLI and AI callers authenticate through the same adapter.
- A server deployment behind a TLS proxy.
- The interface `add-case-open` widens a grant through (M3).

**Non-goals:** proposal "Out of scope".

## Jan's answers

- **Q-1 Identity mechanism → pluggable adapter (D-084).** `none` stays the default (M1); the built-in `oidc` validates Ping-issued tokens (M15); a module adapter is loaded from config (M1).
- **Q-2 CLI identity → the same adapter (D-084).** The CLI sends a bearer token the company's tool obtained (M13).
- **Q-3 Rights → KI.ping (D-085, D-086 Q11).** Superseded: the rules file of D-084 is dropped. KIPscope holds what KI.ping vouched for as a grant per workspace (M3) and enforces it in one guard (M6).
- **Q-4 Saved views → per user.** „q4 views je nutzer, ja".
- **Q-5 CLI token → the company's tool (a).** Lead's reading of D-084, 2026-10-19; Jan can veto.
- **Open:** Q-6 (what an invited user sees) and Q-7 (`#view=` links on a server) in proposal "Open questions". Tasks follow the recommended answers.

## Decisions

### M1: Identity adapter (pinned contract, `apps/server/src/identity.ts`)

Built in round 1; this revision changes only comments that say "session".

```ts
/** What an adapter sees of a request (HTTP or the live channel's upgrade). */
export interface IdentityRequest {
  /** Header names lower-case; a repeated header is joined with ", " (Node's rule). */
  readonly headers: Readonly<Record<string, string | undefined>>;
  /** The TCP peer, IPv4-mapped IPv6 as IPv4. Never taken from X-Forwarded-For. */
  readonly peer: string;
  readonly method: string;
  /** Path without query, after the workspace prefix was removed (M5). */
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

- **Selection:** `KIPSCOPE_IDENTITY` is `none` (the default), `oidc` (M15), or `module:<path>`. A module is imported once at start. A missing file, a default export that is not a function, or a result without `kind` and `identify` stops the server, naming the variable and the reason.
- **`none`:** no adapter runs. Every request is `{user: "local", roles: []}`, and every workspace's effective grant is `all` (M3).
- **What the server checks of every result:**
  - `user` matches `USER_ID`.
  - `roles` is an array of at most 200 strings of 1–128 characters, without control characters.
  - Anything else is refused as `unauthenticated`, with one warning per minute.
  - A thrown error answers 503 `identity_unavailable` (fail closed).
- **Roles** are passed through to `GET /api/me` and the footer so an operator can check them. They decide nothing in KIPscope (D-085).
- **Where it runs:** once per request, in the `onRequest` hook of M6, for every path under `/api/` except `GET /api/license`, the live upgrade included.
- **Conformance suite:**
  - `apps/server/test/identity/conformance.ts` exports `identityConformance(name, setup)`. It runs against `oidc` and against the example module.
  - The example module, `apps/server/examples/forward-header.mjs`, trusts `X-Forwarded-User` and `X-Forwarded-Groups` only from peers in `KIPSCOPE_TRUSTED_PROXIES`.
  - Both were built in round 1 and are unchanged.

### M2: Variables (pinned, `apps/server/src/config.ts`, `.env.example`)

| Variable | Default | Rule |
|---|---|---|
| `KIPSCOPE_IDENTITY` | `none` | `none`, `oidc` or `module:<path>`. Any other value stops the server, naming the variable and the three forms. |
| `KIPSCOPE_OIDC_ISSUER` | — | Required with `oidc`. An `https` URL (`http` only for a loopback host, for tests). |
| `KIPSCOPE_OIDC_AUDIENCE` | — | Required with `oidc`. |
| `KIPSCOPE_OIDC_JWKS_URL` | discovered | Otherwise the `jwks_uri` of `<issuer>/.well-known/openid-configuration`. If the fetch fails, the server starts and requests answer 503 `identity_unavailable`; the fetch is retried at most every 30 s. |
| `KIPSCOPE_OIDC_USER_CLAIM` | `sub` | A claim name. |
| `KIPSCOPE_OIDC_ROLES_CLAIM` | `roles` | A claim name or a dotted path. |
| `KIPSCOPE_OIDC_HEADER` | `authorization` | For `authorization` the value is `Bearer <jwt>`; for any other header, the bare JWT. |
| `KIPSCOPE_OIDC_ALGS` | `RS256,PS256,ES256` | A subset of RS/PS/ES 256–512 and EdDSA; `none` and `HS*` are refused at start. |
| `KIPSCOPE_ORIGINS` | empty | A comma list of origins. Required (non-empty) unless `none`. A bad entry stops the server. |
| `KIPSCOPE_SHARE` | `on` | `on` or `off`. With `off`, setting a share level `read` or `write` answers 403 `share_not_permitted`. Any other value stops the server, naming the variable. Ignored with `none` (`canShare` is true there). **New.** |
| `KIPSCOPE_WORKSPACE_IDLE_DAYS` | `30` | An integer ≥ 1. **Renamed** from `KIPSCOPE_SESSION_IDLE_DAYS`. |
| `KIPSCOPE_WEB_DIR` | unset | A directory holding `index.html`. |

- **Removed:** `KIPSCOPE_RULES`. It is no longer read; no server ran with it outside tests.
- **Config type:** `IdentityConfig = { kind: "none" } | { kind: "oidc"; oidc: OidcConfig } | { kind: "module"; path: string }`, and `Config.share: boolean`.
- **Dev users:** the web's dev proxy adds `X-Forwarded-User: <KIPSCOPE_DEV_USER>` and `X-Forwarded-Groups: <KIPSCOPE_DEV_ROLES>` when they are set (built).

### M3: The grant (pinned, `packages/shared/src/workspaces.ts`, `apps/server/src/rights.ts`, `apps/server/src/workspaces.ts`)

This is the interface `add-case-open` uses. It does not specify the signed catalog; that is `add-case-open`'s.

```ts
// packages/shared/src/workspaces.ts
/** Data refs one workspace may read (D-085: KI.ping decides; D-086: whole objects, no time part). */
export type Grant = { readonly objects: "all" } | { readonly objects: readonly string[] /* data refs */ };
export const Grant: z.ZodType<Grant>; // strict: {objects: "all"} | {objects: DataRef[] (≤ MAX_GRANT_OBJECTS, unique)}
export const MAX_GRANT_OBJECTS = 2000;
export const GRANT_ALL: Grant = { objects: "all" };
export const GRANT_NONE: Grant = { objects: [] };
/** What a client learns of a grant: "all", or the number of objects (0 = nothing granted). */
export type Granted = "all" | number;
```

```ts
// apps/server/src/rights.ts (pure)
/** true for "all"; else exact membership of the data ref (one Set per grant object, cached). */
export function covers(grant: Grant, dataRef: string): boolean;
/** The grant the guard uses: GRANT_ALL with identity none; GRANT_NONE for a stored "all" with any
 *  other identity (state carried over from local use never grants on a server); else as stored. */
export function effectiveGrant(stored: Grant, identity: IdentityConfig["kind"]): Grant;
/** A new workspace's grant: GRANT_ALL with identity none, else GRANT_NONE. */
export function initialGrant(identity: IdentityConfig["kind"]): Grant;
export function grantedOf(grant: Grant): Granted;
```

```ts
// apps/server/src/workspaces.ts (WorkspaceRegistry, M4)
export class GrantLimitError extends Error {}
/**
 * The only code that widens a grant. Adds `dataRefs` (each matching DataRef) to the workspace's
 * grant: unique, existing order kept, new ones appended; a no-op on "all". Writes the file
 * (debounced, M4) and fires onChange {type: "grant"}, so open live clients get a new `summary`.
 * Throws GrantLimitError (grant unchanged) above MAX_GRANT_OBJECTS; returns undefined for an
 * unknown ID. Never reachable from a client payload: no route, command or view sets a grant.
 */
grantObjects(workspaceId: string, dataRefs: readonly string[]): WorkspaceEntry | undefined;
```

- **Stored with the workspace** (M4 file). It is never sent by a client. `CreateWorkspaceRequest` is strict and has no grant field, no command touches the grant, and view documents carry none. A client only reads `granted` in the summary.
- **Creation:**
  - With `none`, a new workspace's grant is `all`, so nothing changes for Jan.
  - With `oidc` or `module:`, a new workspace's grant is empty. It shows data only after `add-case-open` has verified a signed handoff and called `grantObjects`. Until then the web shows the gate "Open a session from KI.ping" (M12).
- **Unit:** a grant object is a data ref, matched exactly. There are no patterns and no time part (D-086: whoever may see a vehicle may see all of it). Scope windows, Unlink and Widen stay `add-case-open`'s and are not limited by the grant.
- **Invariant:** a workspace's data refs (scope, window signals, events-line signals) are always covered by its effective grant. Every command that names a data ref is checked (M6), and a new workspace is seeded only with covered events-line signals (M4). The one exception: a state dir carried over from `none` to a server. There a stored `all` reads as empty, and the data routes refuse its data refs (Risks).
- **Views grant nothing** (D-086 Q13). Opening a view in a workspace checks the view's data refs against that workspace's grant. A view opened from a link goes into a new workspace, whose grant is the initial one (Q-7).
- **Numbers:**
  - `MAX_GRANT_OBJECTS = 2000` equals the most sessions `add-case-open` takes by file or API (exploration "Security"), and every session has one object, so a full catalog of distinct vehicles fits.
  - At ×2 (4,000), a workspace file holds about 80 KB of data refs, which is harmless.
  - At ÷2 (1,000), a large catalog of distinct vehicles would be refused, so `add-case-open` would have to name a fallback.

### M4: Workspace registry (pinned file format, `apps/server/src/workspaces.ts`)

A workspace entry is one `WorkspaceStore` plus:

```ts
interface WorkspaceRecord {
  id: string;            // WORKSPACE_ID: 10 × [a-z0-9] from crypto.randomInt
  owner: string;         // USER_ID
  share: WorkspaceShare; // "private" at create
  grant: Grant;          // M3; initialGrant(identity) at create
  createdAt: string;     // ISO
  lastActiveAt: string;  // ISO; create, live connect, accepted command
}
```

- **State file** `<stateDir>/workspaces/<id>.json`:
  - Its content is `{kipscope: "workspace", version: 2, id, owner, share, grant, createdAt, lastActiveAt, revision, workspace}`. Version 2 tells it apart from the legacy single `workspace.json`, which is version 1.
  - Writes as built: a 500 ms trailing debounce, at once on `SIGINT`/`SIGTERM`, atomic. They also follow a share change, a grant change and a live connect.
  - A file that fails validation is renamed `<id>.bad.json` with one warning.
- **Legacy files:**
  - The reader also accepts `{kipscope: "session", version: 1, …}` without `grant` (`LEGACY_SESSION_TAG`), read as grant `all`.
  - The next write turns such a file into version 2.
- **Migration** (once, at start, in this order, one info line per step):
  1. If `<stateDir>/sessions/` (`LEGACY_SESSIONS_DIR`) exists and `workspaces/` does not, the folder is renamed to `workspaces/`.
  2. If `<stateDir>/workspace.json` exists and `workspaces/` still does not, its workspace becomes an entry owned by `local` with grant `all`, and the file is renamed `workspace.migrated.json` (built).
  3. If `views/` exists and `users/local/views/` does not, the folder is renamed (built).
- **New workspace:** an empty workspace seeded with the project file's `measurement` and its events-line signals, minus events-line signals whose data ref the initial grant does not cover. On a server that means all of them. The new workspace has revision 0, the requester as owner, share `private` and `initialGrant`.
- **Limits:** as built (`MAX_WORKSPACES_PER_USER = 200`, LRU eviction of an entry without a live client, else 409 `workspace_limit`; idle cleanup after `KIPSCOPE_WORKSPACE_IDLE_DAYS`).
- **Default workspace** for a request without the prefix (scripts, the CLI without `--workspace`): the requester's own workspace with the latest `lastActiveAt`; if there is none, a new one. The built `canOpen` filter goes. An owner can always open their own workspace, because its data stays covered by its grant.
- **Reuse for `/`** (`POST /api/workspaces {reuse: true}`) is one synchronous step in the registry, so two requests can never pick the same entry:
  1. Take the requester's own workspace with the latest `lastActiveAt` that has no live client and no claim younger than `REUSE_CLAIM_MS = 10_000`.
  2. Stamp the claim (in memory) and return the entry with `reused: true`.
  3. If no entry qualifies, create one (`reused: false`).

  A live connect clears the claim. Numbers:
  - ×2 (20 s): a tab that never connected keeps its entry unpickable for 20 s, so a new workspace is made instead. That is harmless.
  - ÷2 (5 s): a tab on a slow start (live connect later than 5 s after the claim) could be picked again by a second tab, which is the mirroring of exploration row 4. 10 s leaves room for a cold Vite load measured at 2–4 s.

Server interface between the registry task and the route tasks (pinned):

```ts
export interface WorkspaceEntry { readonly record: WorkspaceRecord; readonly store: WorkspaceStore }
export class WorkspaceLimitError extends Error {}
export class WorkspaceRegistry {
  constructor(options: {
    dir: string;                      // <stateDir>
    seed: (grant: Grant) => Workspace; // events-line signals filtered by covers(grant, ·)
    identity: IdentityConfig["kind"]; // for initialGrant / effectiveGrant
    idleDays: number;
    now?: () => number;
    log?: { info(m: string): void; warn(m: string): void };
    limit?: number;                   // default MAX_WORKSPACES_PER_USER
  });
  start(): void;                      // migration, read every file, hourly cleanup
  get(id: string): WorkspaceEntry | undefined;
  create(owner: string): WorkspaceEntry; // grant = initialGrant(identity); throws WorkspaceLimitError
  /** Atomic pick for "/" (above); creates when nothing qualifies. Throws WorkspaceLimitError. */
  reuseOf(owner: string): { entry: WorkspaceEntry; reused: boolean };
  defaultOf(user: string): WorkspaceEntry;
  listOf(user: string): WorkspaceEntry[]; // own, latest lastActiveAt first
  grantOf(id: string): Grant;          // effectiveGrant of the stored grant
  grantObjects(workspaceId: string, dataRefs: readonly string[]): WorkspaceEntry | undefined; // M3
  setShare(id: string, share: WorkspaceShare): WorkspaceEntry;
  delete(id: string): boolean;
  touch(id: string): void;
  open(): WorkspaceEntry[];            // entries with at least one live client
  onChange(listener: (event: { type: "share" | "grant" | "delete" | "command"; entry: WorkspaceEntry; scopeChanged: boolean }) => void): () => void;
  flush(): void;
  cleanup(): number;
  stop(): void;
}
export function summaryOf(entry: WorkspaceEntry, rights: WorkspaceRights | undefined, grant: Grant): WorkspaceSummary;
```

`WorkspaceStore` keeps its API as built: `execute(input, ctx?, beforeOpen?)`, and `connect(user)` with `user` in `renderStatus()`.

### M5: Addressing (pinned)

- **UI:** `/w/<id>` is the page of workspace `<id>`. `/` is the start-up page (M12). The web reads `/s/<id>` (`LEGACY_UI_PATH`) as `/w/<id>` and replaces the address with `/w/<id>` without a reload, because Jan's open tabs and bookmarks hold such addresses. The server's SPA catch-all (M11) already answers `index.html` for both.
- **API prefix:**
  - `/api/w/<id>/<rest>` serves `/api/<rest>` for workspace `<id>`, through `rewriteUrl` as built.
  - `/api/s/<id>/…` gets no alias. It is an unknown route (404), because the web, the CLI and the tests change in this change.
- **Workspace-resolving routes:** those with access `workspace` or `change` in the M6 table. With the prefix they serve that workspace; without it, the requester's default workspace (M4). Every answer that served a workspace carries `X-KIPscope-Workspace: <id>` (`WORKSPACE_HEADER`).
- **Helpers:** `apps/server/src/http.ts` exports:
  - `workspaceOf(request): WorkspaceEntry`
  - `grantOf(request): Grant` (effective)
  - `userOf(request): { identity: Identity }`

  The M6 hooks set all three. Routes never call `identify` or decide access themselves.

### M6: The guard: one place for every route (pinned, `apps/server/src/guard.ts` using `rights.ts`)

```ts
export type Level = "public" | "user" | "workspace" | "change";
export type Access = {
  /** public: no user. user: a signed-in user. workspace: + open right on the workspace. change: + change right. */
  level: Level | { body: (request: FastifyRequest) => "user" | "workspace" | "change" }; // body form: only POST /api/views/import
  /** Every data ref the request names (query, body); checked before the handler runs. */
  dataRefs?: (request: FastifyRequest) => string[];
};
```

The `onRoute` check is kept as built: a route under `/api/` without `config.access` stops the server. Two hooks decide all access:

1. **`onRequest`** (after the Host/Origin guard; the live upgrade included):
   - Level `public`: pass.
   - Otherwise `identify` (M1). A refusal answers 401 with its code; a throw answers 503 `identity_unavailable`.
   - There is no `no_rights` step any more: a signed-in user may use KIPscope, and the grant decides what data they see.
2. **`preHandler`** (body parsed):
   - **Levels `workspace` and `change`:**
     - Resolve the workspace: the prefix, or the default workspace. An unknown ID answers 404 `unknown_workspace`.
     - Compute `workspaceRights` (below). Without the open right: 403 `forbidden`. Level `change` without the change right: 403 `read_only`.
     - Every data ref of `dataRefs(request)` must pass `covers(effective grant of that workspace, ref)`, else 403 `forbidden_data`.
   - **Level `user` with `dataRefs`** (only `POST /api/workspaces {open}`): the data refs must pass `covers(initialGrant(identity), ref)`. That is the grant the new workspace will have.

| Route | Level | `dataRefs` |
|---|---|---|
| `GET /api/license` | public | — |
| `GET /api/me` | user | — |
| `GET /api/workspaces`, `GET /api/workspaces/:id`, `POST /api/workspaces/:id/share`, `DELETE /api/workspaces/:id` | user | — (the routes check owner, share level and `KIPSCOPE_SHARE`, below) |
| `POST /api/workspaces` | user | the `open` view's (`dataRefsOfView`, or of the saved view named), against the initial grant |
| `GET /api/views`, `GET /api/views/:name`, `DELETE /api/views/:name` | user | — |
| `POST /api/views/import` | user, or change with `open: true` | with `open: true`: `dataRefsOfView(body.view)`; without: none (storing a layout reveals no data) |
| `POST /api/views` (save) | change | — |
| `POST /api/views/open` | change | the view's (named: read from the requester's store) |
| `POST /api/commands` | change | `dataRefsOfCommand` (built: `window.addSignal`, `events.addSignal`, `scope.set`, `view.open`) |
| `GET /api/workspace`, `GET /api/render-status`, `GET /api/live`, `GET /api/meta` | workspace | — |
| `GET /api/catalog`, `GET /api/signals`, `POST /api/catalog/refresh` | workspace | — (the answer is filtered by the grant) |
| `GET /api/extent`, `GET /api/series`, `GET /api/value` | workspace | the `signal`'s data ref |
| `GET /api/density` | workspace | `dataRef` |
| `GET /api/gaps`, `GET /api/events` | workspace | `dataRef` and each `signal`'s |

**Workspace rights** (`rights.ts`):

```ts
export function workspaceRights(user: string, entry: WorkspaceEntry): WorkspaceRights | undefined;
// owner           → {open: true, change: true,  owner: true}
// share "write"   → {open: true, change: true,  owner: false}
// share "read"    → {open: true, change: false, owner: false}
// share "private" → undefined
```

- **No data condition.** The data condition of the built `sessionRights` goes, because a workspace's data is always covered by its own grant (M3 invariant). Under Q-6 (b), the receiver would also need every data ref of the workspace covered by the union of the grants of their own workspaces: one more argument and one function.
- **Same Ping tenant by construction:** a server has exactly one identity adapter, and with `oidc` one issuer. A token of another issuer is refused (`invalid_token`, M15), so every user who can be invited is of the same tenant. There is no tenant field.
- **What an invited user sees** (Q-6 (a)): the shared workspace's grant, while they are in that workspace. Their own workspaces never gain it. "Copy link (own copy)" or `POST /api/workspaces {open}` made from it gets the initial grant, so on a server that open is refused `forbidden_data`.
- **Share and delete:** `POST /api/workspaces/:id/share` and `DELETE` need the owner, else 403 `not_owner`. Setting `read` or `write` with `KIPSCOPE_SHARE=off` answers 403 `share_not_permitted`; `private` is always allowed.

**Filtered lists:** `routeScope` returns `catalogView(catalog, grantOf(request))` instead of the shared `Catalog`. The `CatalogView` interface is as built; the second parameter changes from `Rights` to `Grant`, and it gives the identity view for `all`. `/api/catalog`, `/api/signals`, `/api/meta` and the command context read the view. The shared catalogs and caches stay keyed by scope and data ref.

**No leaks through errors or counts:**
- `forbidden_data` is decided from the grant alone, before any catalog lookup, cache read or source query. The answer for a data ref that exists and for one that does not differ only in the name the request sent. Its message is `data ref <ref> is not permitted`.
- A refused workspace answers 403 `forbidden`.
- Lists and counts never include data refs outside the grant, nor other users' workspaces.

**Live channel:** after each `onChange` event (share, grant, command), every open connection of that workspace re-runs `workspaceRights` for its user. It then gets a `summary` message with its rights and `granted`, or is closed with 4403 when the open right is gone. A delete closes with 4404.

**ADX access** stays the server's identity (D-083).

### M7: HTTP payloads (pinned, `packages/shared/src/workspaces.ts`)

```ts
export const WORKSPACE_ID = /^[a-z0-9]{10}$/;
export const USER_ID = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,63}$/;
export const LOCAL_USER = "local";
export const MAX_WORKSPACES_PER_USER = 200;
export const WORKSPACE_HEADER = "x-kipscope-workspace";
export const RECENT_WORKSPACES = 10;   // M12 Recent list
export const CLOSE_NO_ACCESS = 4403;
export const CLOSE_WORKSPACE_GONE = 4404;
// Grant, MAX_GRANT_OBJECTS, GRANT_ALL, GRANT_NONE, Granted: M3

export const WorkspaceShare = z.enum(["private", "read", "write"]);
export type WorkspaceShare = z.infer<typeof WorkspaceShare>;
export interface WorkspaceRights { open: true; change: boolean; owner: boolean }

export interface WorkspaceSummary {
  id: string;
  owner: string;
  share: WorkspaceShare;
  granted: Granted;          // M3; 0 on a server before a handoff
  createdAt: string;         // ISO
  lastActiveAt: string;      // ISO
  revision: number;
  windows: number;
  scope?: WorkspaceScope;
  view?: { name?: string; title: string; modified: boolean };
  measurement?: string;
  clients: number;           // open live connections
  rights?: WorkspaceRights;  // of the requester; absent when they may not open it
}

export const OpenViewRequest = z.union([
  z.object({ name: z.string() }),
  z.object({ view: z.record(z.string(), z.unknown()) }),
]);
export const CreateWorkspaceRequest = z.strictObject({
  open: OpenViewRequest.optional(),
  reuse: z.literal(true).optional(),   // M4 reuse; not together with open (400 bad_request)
});
export const ShareRequest = z.strictObject({ share: WorkspaceShare });

export interface Me {
  user: string;
  identity: string;          // "none", "oidc" or the module adapter's kind
  roles: string[];           // shown only; decide nothing (D-085)
  canShare: boolean;         // identity none → true; else KIPSCOPE_SHARE === "on"
}
export interface WorkspaceList { workspaces: WorkspaceSummary[] }      // own, latest lastActiveAt first
export interface WorkspaceAnswer { workspace: WorkspaceSummary }
export interface CreateWorkspaceAnswer { workspace: WorkspaceSummary; reused?: boolean; result?: CommandResult }

/** "https://h/w/<id>", "https://h/api/w/<id>/x", and the legacy "https://h/s/<id>" → {origin, workspace}; else undefined. */
export function parseWorkspaceLink(url: string): { origin: string; workspace: string } | undefined;
export const workspacePath = (id: string) => `/w/${id}`;
export const workspaceApi = (id: string) => `/api/w/${id}`;
```

**Routes:**

| Route | Body | Answer |
|---|---|---|
| `GET /api/me` | — | `Me` |
| `GET /api/workspaces` | — | `WorkspaceList` |
| `POST /api/workspaces` | `CreateWorkspaceRequest` (may be `{}` or no body) | 200 `CreateWorkspaceAnswer`. When the open fails, no workspace is created and the answer is the failed `CommandResult` with `commandStatus`. 409 `workspace_limit`. 403 `forbidden_data`. 400 for an unknown key (e.g. `grant`). |
| `GET /api/workspaces/:id` | — | `WorkspaceAnswer` (open right) |
| `POST /api/workspaces/:id/share` | `ShareRequest` | `WorkspaceAnswer` |
| `DELETE /api/workspaces/:id` | — | `{deleted: id}` |

- **Error codes:** `unauthenticated` (401), `invalid_token` (401), `identity_unavailable` (503), `forbidden_data` (403), `unknown_workspace` (404), `forbidden` (403), `read_only` (403), `not_owner` (403), `share_not_permitted` (403), `workspace_limit` (409). `no_rights` is removed.
- **`workspace.ts` additions:** `LiveServerMessage` gains `{ type: "summary"; summary: WorkspaceSummary }` instead of `session`. `ClientRenderStatus.user?: string` stays.

### M8: Live channel per workspace

- **On connect,** `GET /api/live` (prefixed or default) sends, in order:
  1. `hello {clientId}`
  2. `summary {…}`, with this connection's rights
  3. `state`

  Connecting sets `lastActiveAt` and clears a reuse claim (M4).
- **After a share change, a grant change or a command,** each open connection gets `summary` when its rights or `granted` changed. It is closed with 4403 when its user lost `open`. A delete closes every connection with 4404. The web does not reconnect after these two codes.
- **`render-status` and `--wait`** see only the clients of that workspace.

### M9: Server state that was "the one workspace"

Built; renamed only.
- `CatalogStore.keep()` returns the scopes of `workspaces.open()`.
- Periods and the events-line prefetch cover the open workspaces' signals.
- `viewsOf(user)` gives one `ViewStore` per `<stateDir>/users/<user>/views/`.
- There is one `StatePersister` per workspace.
- `GET /api/meta` reports through the request's `CatalogView`.

### M10: Access guard with configured origins (`access.ts`)

As built, with one change: the start log `accessLog(config)` no longer names a rules file. With an identity other than `none` it logs one info line naming:
- the identity kind (`oidc` with issuer and audience, or the module path)
- `sharing on` or `sharing off`
- the origins

It warns that only the proxy should reach `<host>:<port>` when `KIPSCOPE_HOST` is not loopback.

### M11: Built UI served by the server (`apps/server/src/web.ts`)

As built. The SPA catch-all answers `index.html` for `/w/<id>` and for the legacy `/s/<id>`.

### M12: Web (`apps/web/src/workspaces/`)

- **Start-up** (`startup.ts`: the pure `startupTarget(location)` plus the effect), before the live channel opens:
  - `/w/<id>`, or the legacy `/s/<id>`, without a view part: that workspace; `replaceState` to `/w/<id>` (no reload).
  - Any path with `#view=` or `?view=`: `POST /api/workspaces {open}`. On success, `replaceState` to `/w/<new>`. On failure, the same as `/`, with the open's error (e.g. `forbidden_data`) in the message line.
  - `/` or any other path: `POST /api/workspaces {reuse: true}`, then `replaceState` to `/w/<id>`. A second tab never mirrors the first (M4).
- **API prefix:** `apiPath(path, id)` gives `/api/w/<id>` plus the rest, for workspace-resolving paths. The workspace-independent paths (`/api/me`, `/api/workspaces…`, `/api/views` list, get and delete) stay unprefixed.
- **Gate pages** (`gate.ts` `gateOf`, `Gate.tsx`):

  | Cause | Title | Text | Buttons |
  |---|---|---|---|
  | 404 `unknown_workspace` or close 4404 | `Workspace not found` | — | `My latest workspace` (navigates to `/`), `New workspace` (`POST /api/workspaces {}`) |
  | 403 `forbidden` or close 4403 | `No access to this workspace` | — | same two |
  | **Empty grant:** `me.identity !== "none"` and `summary.granted === 0` | `Open a session from KI.ping` | `This workspace has no data yet. KI.ping decides which vehicles you may see: open a session there and it opens here.` | none |
  | 401 | `Not signed in` | `Reload to sign in.` | none |
  | 503 `identity_unavailable` | `Sign-in service unreachable` | `Try again later.` | none |

  - The empty-grant gate lifts without a reload when a `summary` message arrives with `granted` other than 0.
  - The `no_rights` gate is removed.
  - The live channel does not reconnect after 4403 or 4404.
- **Share…** (`workspaces/ShareMenu.tsx`) is an overflow item (saved-views "Top-row overflow menu"): a `Share…` button in the row on a wide top row, the same entry in "⋯" on a short one. Its popover holds two parts. Their labels and lines come from the pure `shareItems(me, summary)`:
  1. **`Copy link (own copy)`**, with the line `The receiver gets their own copy of this layout; changes stay apart.` With an identity other than `none`, a second line follows: `On this server they see data only for vehicles KI.ping opened for them.` It copies `viewLinkUrl(workspace, location.origin + "/")`, as "Copy link" did, and shows the notice `Link copied (<n> characters)`.
  2. **`Invite to this workspace`**:
     - For the owner with an identity other than `none`: the radio `Private · Read · Write`, with the lines `Read: they watch this workspace live.` and `Write: they change it with you.` `Read` and `Write` are disabled, with the tooltip `Sharing is turned off on this server`, when `me.canShare` is false.
     - For a non-owner: the line `Shared by <owner> (<read|write>)`.
     - In every case, the button `Copy workspace link`, which copies `<origin>/w/<id>`. With `none` it is labelled `Copy workspace link (same live workspace)`, and there is no radio, since every tab is the owner.
- **Recent workspaces** (in the Views menu, `views/ViewsMenu.tsx`, data from `GET /api/workspaces` when the menu opens):
  - A section headed `Recent workspaces` below the saved views, with the first `RECENT_WORKSPACES` (10) own workspaces, latest first.
  - Each row shows `workspaceTitle(summary)`, the relative last-active time, and `●` when it has clients (tooltip `Open in another tab`). The current workspace is marked.
  - Title rule: the view title, else the measurement name, else `<dataRef> <scope start, local>`, else `New workspace`.
  - Rows are plain links to `/w/<id>`: a click is a page load in the same tab, and a middle or Ctrl click opens a new tab.
  - No delete and no "New" entry.
  - The Views menu's own "Copy link" moves into Share….
- **Read-only:** when `rights.change` is false, the top row shows the `Read-only` pill, as built, with the tooltip `<owner> shares this workspace read-only. "Copy link (own copy)" gives you your own copy.`
- **Footer:** as built. It uses `me.user`, `me.identity` and `me.roles`.
- **Props between the two web tasks (pinned):** `OptionBar` receives `workspaceId: string`, `summary: WorkspaceSummary | undefined` and `me: Me | undefined` from `App.tsx`; it passes them to `ShareMenu`, the Views menu and `ReadOnlyPill`.

### M13: CLI (`apps/cli/src`)

As built, renamed:
- **Options:**
  - `--workspace ID|URL`, else `KIPSCOPE_WORKSPACE`. `--server` may be a workspace link (`parseWorkspaceLink`, `/w/` or legacy `/s/`). A `--workspace` value that is neither an ID nor a link is a usage error (exit 2). `--session` is an unknown option (exit 2).
  - Token options as built.
- **One workspace per call:** with a workspace, every request goes to `/api/w/<id>/…`. Without one, the CLI takes the workspace from the first answer's `X-KIPscope-Workspace` (the most recently active, M4) and prefixes every later request.
- **Output:** `CliOutput.workspace?: string` names the workspace the call served, so a call without `--workspace` prints which one it took.
- **Forms:**
  - `whoami` → `data: Me`
  - `workspace list` → `data: WorkspaceList`
  - `workspace new` → `data: CreateWorkspaceAnswer` plus `local.url` = `<server>/w/<id>`
  - `workspace share private|read|write` → `data: WorkspaceAnswer`
  - `workspace delete ID` → `data: {deleted}`
- **Exit codes:** as built (401/403 → exit 1 `rejected`; 503 `identity_unavailable` → exit 7).

### M14: Docs

- **`docs/deploy.md`:**
  - The "Rules" section is replaced by "Rights": KI.ping decides; each workspace holds a grant; in `none` it is `all`; on a server a workspace shows data only after a handoff from KI.ping (`add-case-open`); `KIPSCOPE_SHARE`.
  - The rest is as built, renamed.
- **`docs/http-api.md`:** the `/api/w/<id>` prefix rule, the default workspace, the access level of every route, `/api/workspaces…`, the error codes and `X-KIPscope-Workspace`.
- **README:** the variables (`KIPSCOPE_SHARE`, `KIPSCOPE_WORKSPACE_IDLE_DAYS`, no `KIPSCOPE_RULES`) and the CLI forms.

### M15: The `oidc` built-in for Ping Identity (`apps/server/src/identity/oidc.ts`)

Built in round 1, unchanged:
- KIPscope acts as an OIDC resource server with `jose`.
- Validation, in order:
  1. Header and size (≤ 16 KB).
  2. `alg` in the allow list (never `none` or `HS*`).
  3. `kid` in the JWKS; an unknown `kid` refetches it at most once per 30 s.
  4. Signature, exact `iss`, `aud` contains the audience, `exp`/`nbf` with 30 s tolerance.
  5. The user claim matches `USER_ID`, and the roles claim has the expected form.
- A token is never logged.

## Security notes

- **Deny by default on a server:** a new workspace has an empty grant (M3). Every data route answers `forbidden_data`, and catalog, signals and meta list nothing, until `grantObjects` runs. With `none` everything is visible, as today.
- **One widening path:** only `WorkspaceRegistry.grantObjects` adds to a grant. No route, command, view or file a client sends sets one, and a stored `all` reads as empty on a server. Checks: data-access "Only the server widens a grant" (unit test, a strict body, a grep).
- **One guard:** `guard.ts` and `rights.ts` hold every access decision, and an undeclared route stops the server (built test "every API route declares its access").
- **Proof that a grant separates data:** `apps/server/test/rights.http.test.ts` › "keeps a workspace to its grant on every route". Across every data route, a workspace granted `testcar` asks for `othercar` (exists) and `nosuchcar` (absent). The answers are equal 403s, and no source query names either. The route list comes from the registered routes.
- **Origins and tokens:** M10, M15 (built).
- **Not covered:** timing differences, rate limits, an audit log, revoking a grant.

## Numbers

| Number | Value | If off by ×2 |
|---|---|---|
| Workspace ID | 10 × `[a-z0-9]` ≈ 51.7 bits | Rights guard access, not the ID's secrecy. 5 or 20 characters change nothing else. |
| Workspaces per user | 200 | 100: a user opening 20 cases a day loses workspaces after 5 days instead of 10 ("Workspace not found" in an old tab). 400: 4 MB per user on disk. |
| Idle days | 30 (configurable) | Only how long an untouched link stays valid. |
| Grant objects | ≤ 2,000 | M3. |
| Reuse claim | 10 s | M4. |
| Recent list | 10 | 5: Jan's way back to the tenth latest workspace needs the CLI; 20: a taller menu, and the rows are still links. |
| Grant lookup | one `Set` per grant, cached | O(1) per data ref; filtering 10,000 signals stays ~1 ms at ×2. |
| JWT tolerance, JWKS refetch, token size, roles per identity, token command timeout | as built (30 s, 30 s, 16 KB, 200, 10 s) | Unchanged from round 1. |
| Kept scope lists | every scope with a live client, plus 4 LRU | A list of 10,000 signals is ~10 MB, so 20 users on 20 scopes ≈ 200 MB; at ×2 the next change can cap the kept set. Goal: measured in the two-user UI check (server RSS). |
| Close codes | 4403, 4404 | Private range 4000–4999. |

## Fit for the next changes

- **`add-case-open`:**
  - Verifies KI.ping's signed catalog (its own design).
  - Creates the workspace through the registry.
  - Maps each session's object to a data ref and calls `grantObjects(id, dataRefs)` once, before the first `case.*` command.
  - Its routes declare their access like every other (M6).
  - The empty-grant gate lifts on the `summary` message.
- **`add-signal-books`:** `<stateDir>/users/<user>/book.yaml`, keyed by `userOf(request).identity.user`.

## Spec owner's defaults (Jan can veto)

- **Share switch:** `KIPSCOPE_SHARE=on|off`, default `on`, instead of a share right per role (Revision, item 4).
- **Fail closed on a server:** a stored grant `all` reads as empty when the identity is not `none`.
- **Unknown routes:** `/api/s/<id>/…` and `--session` get no alias; only the UI address `/s/<id>` redirects.
- **Recent list:** no delete and no "New workspace" entry. Rows are links (a page load).
- **The empty-grant gate** has no buttons. Its text names KI.ping, the finder of D-078.
- **Kept from round 1:** `forbidden_data` (403) for a data ref outside the grant; views per user; migration to `local`; the user shown in the footer unless the identity is `none`; the server serving the built UI.

## Risks

- **A state dir carried over from `none` to a server:** its workspaces read as empty grants, so their windows show `forbidden_data` errors. That is correct (fail closed) but looks broken. `docs/deploy.md` says to start a server on a fresh state dir.
- **A misconfigured proxy** breaks the trust boundary. Mitigations are as built (`oidc` trusts signatures; the example checks the peer; the start log).
- **An invited user with write** can change the owner's windows within the grant (last command wins; concept §7).
- **An own copy on a server shows nothing** until `add-case-open` (Q-7).
- **Not testable here:** a real PingFederate or PingOne, the company's token tool, and KI.ping's signing. `grantObjects` is exercised by tests only until `add-case-open`.
