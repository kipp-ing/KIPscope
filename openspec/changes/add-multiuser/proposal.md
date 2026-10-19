# Proposal

## Why

KIPscope becomes a server application next to KI.ping, with only the browser on the user's machine (D-079: „das soll auf einem server laufen … lokal ist immer nur der browser. Multiuser ist also pflicht. eine zugriffsberechtigung im Server muss später auch einbaubar sein"). Today the server holds one workspace that every tab and the CLI share, and it answers only local requests (server-access). Jan answered the multiuser questions on 2026-10-19 (D-083): „Ein SSO hook mit ping oder authentik wäre gut. jedes sesseion braucht rechte, ja. ADX rechte sind serverrechte hier keine unterscheidung". He also said „ja" to the recommendation of one workspace per session (case) with its own URL, so old tabs keep their case. This change is item 3 of status.md "Next". It comes before `add-case-open` (the finder's handoff creates a session) and `add-signal-books` (a learned book per user).

## What Changes

- **One identity hook** (D-083, D-079): one function turns a request into a user. `KIPSCOPE_AUTH=none` (the default) keeps today's local behaviour, and every request is the user `local`. `KIPSCOPE_AUTH=header` trusts one identity header (default `X-authentik-username`) set by the reverse proxy's forward auth (authentik outpost, nginx `auth_request` against KI.ping or authentik), but only from configured proxy addresses. KIPscope keeps no user store. An OIDC client mode stays possible behind the same hook (design M1, Q-1).
- **Personal tokens for the CLI and AI callers** (concept §7, Q-2): a signed-in user creates a token in the UI. The CLI sends it as `Authorization: Bearer`. The server keeps only its hash, in the user's folder.
- **A workspace per session** (D-083, Jan's „ja"): sessions with a random ID, an owner and their own revision, live channel, render acknowledgements and state file. The UI address is `/s/<id>`. Every workspace route also answers as `/api/s/<id>/…`. Without the prefix, a request serves the user's most recently active session, so today's routes, scripts and the CLI keep working.
- **Rights per session** (D-083, Q-3): the owner always has every right. Others get rights from the session's share level: `private`, `read` (open) or `write` (open and change). One function decides, and data-ref rights can be added there later (D-079).
- **Session management:** list, create (optionally opening a view in the same step: the hook `add-case-open` extends), share, delete. A limit per user and an idle cleanup. The single workspace and the views of today migrate to the user `local`.
- **Views per user** (Q-4): `<stateDir>/users/<user>/views/`. `#view=` links and `?view=` open in a new session of the person opening them.
- **Server deployment:** `KIPSCOPE_ORIGINS` admits the public origin behind a TLS proxy, and `KIPSCOPE_WEB_DIR` lets the server serve the built UI. `docs/deploy.md` gives proxy examples for authentik and KI.ping, the token bypass and the ADX service identity.
- **CLI:** `--session` (an ID or a session link), `--token`, `whoami`, `session list|new|share|delete`, and the session named in every output.
- **UI:** the session in the address, a Sessions menu (list, new, share, copy link), a `Read-only` pill, "CLI access…" for tokens, and the user in the footer.

## Capabilities

### New Capabilities

- `user-identity`: auth modes, the trusted identity header, personal tokens, `/api/me`, the CLI access dialog.
- `sessions`: sessions with owner and share level, addressing (`/s/<id>`, `/api/s/<id>/…`, default session), rights, management routes, live channel per session, persistence, migration, limits and cleanup, signal lists of open sessions, the session parts of the UI.

### Modified Capabilities

- `server-access`: configured origins, start warnings in header mode, the built UI served by the server.
- `workspace-state`: one workspace per session; render status, state file and restore per session.
- `saved-views`: views per user, "Before last open" per user, links and the address open a new session.
- `cli`: session and token options, session commands, one session per call.
- `app-footer`: the signed-in user.
- `signal-catalog`: background retries follow the open sessions' scopes instead of the one restored scope.

## Out of scope

- Sharing with named users or groups, roles, admin views, audit log (Q-3 (a) keeps share levels only).
- Rights on data refs: ADX is read as the server (D-083). The place where they go is named in design M6, but none is built.
- An OIDC client in KIPscope, a device flow for the CLI, token expiry, and CLI commands for tokens (Q-1, Q-2).
- A shared view store, copying a session, renaming a session, sessions of other users in the list.
- Edits by two users in the same session at the same time beyond today's "last command wins" (concept §7: „Gleichzeitig konkurrierende Änderungen müssen nicht unterstützt werden").
- The finder handoff, case context and neighbours (`add-case-open`). Signal books and the learned book (`add-signal-books`). Snapshots and undo (concept §8, status "Next" 2).
- New ADX auth code: on a server `az login --service-principal` or `az login --identity` feeds today's `KIPSCOPE_ADX_AUTH=azcli` (documented only).
- Query quotas per user.

## Impact

- `packages/shared/src`: new `session.ts` (IDs, share levels, summaries, requests, header and close-code constants, `parseSessionLink`). `OpenViewRequest` moves here from the server. `LiveServerMessage` gains `session`, and `ClientRenderStatus` gains `user`.
- `apps/server/src`: new `identity.ts`, `tokens.ts`, `sessions.ts`, `rights.ts`, `web.ts`, `routes/sessions.ts`, `routes/identity.ts`. Changes in `app.ts` (URL rewrite, identity and rights hook), `access.ts`, `config.ts`, `http.ts`, `scope.ts`, `workspace.ts`, `persist.ts`, `views.ts`, `routes/*`, `meta.ts`, `main.ts`, `.env.example`.
- `apps/web/src`: new `session/` (start-up, API prefix, gate pages, Sessions menu, CLI access). Changes in `api.ts`, `live.ts`, `App.tsx`, `bar/`, `footer/`. `apps/web/vite.config.ts` gets the dev user.
- `apps/cli/src`: options, client, forms, output.
- Docs: new `docs/deploy.md`, plus `docs/http-api.md` and the README.
- Breaking: the state dir layout (migrated automatically) and the location of the views (migrated). Unprefixed routes keep working.
