# Proposal

## Why

KIPscope becomes a server application, with only the browser on the user's machine (D-079: „das soll auf einem server laufen … lokal ist immer nur der browser. Multiuser ist also pflicht. eine zugriffsberechtigung im Server muss später auch einbaubar sein"). Today the server holds one workspace that every tab and the CLI share, and it answers only local requests (server-access). Jan answered the multiuser questions (D-083, D-084): „jedes sesseion braucht rechte, ja"; „bei mir lokal ohne login, bin mein eigener herr. für corp usage brauche ich was mit regeln und rechten. PING id sollte möglich sein mit unterschiedlichen rechten … muss halt anpassbar sein. da darf jeder auch seinen eigenen krams einbauen. nur rollen und recht müssen wirken können und sicher genug sein, also hier darf nicht jeder nutzer alle platformen sehen. q4 views je nutzer, ja". A platform is a naming pattern of data refs („platform ist nur für riesen corp dinger"). He also said „ja" to one workspace per session (case) with its own URL. This change is item 3 of status.md "Next". It comes before `add-case-open` and `add-signal-books`.

## What Changes

- **Identity as a pluggable adapter** (D-084), like the data source: a lean contract (request → `{user, roles}` or refused), one conformance suite an adapter author reuses, and three ways in: `none` (the default: no login, user `local` with every right), `oidc` (validates Ping-issued JWT access tokens, PingFederate or PingOne, for the browser through a proxy and for the CLI as a bearer token), and `module:<path>` for an organisation's own adapter, with a forward-auth header example.
- **Roles map to rights** (D-084): a rules file maps each role to data-ref patterns (globs) and the right to share sessions. Deny by default.
- **One guard on the server** (D-084, D-079): every `/api/` route declares its access level and the data refs it names; two hooks decide all access. Hidden data refs are refused before any lookup and never appear in lists or counts. ADX is still read as the server (D-083).
- **A workspace per session** (D-083, Jan's „ja"): sessions with a random ID, an owner, a share level (`private`, `read`, `write`) and their own revision, live channel, render acknowledgements and state file. The UI address is `/s/<id>`; every workspace route also answers as `/api/s/<id>/…`; without the prefix a request serves the user's most recently active session. Sharing never widens data access: a session holding data the viewer may not see is refused.
- **Session management:** list, create (optionally opening a view), share (needs the share right), delete. A limit per user and an idle cleanup. The single workspace and the views of today migrate to the user `local`.
- **Views per user** (D-084, Q-4): `<stateDir>/users/<user>/views/`. `#view=` links and `?view=` open in a new session of the person opening them.
- **Server deployment:** `KIPSCOPE_ORIGINS` admits the public origin behind a TLS proxy, and `KIPSCOPE_WEB_DIR` lets the server serve the built UI. `docs/deploy.md` gives the Ping setup, the own-adapter guide, the rules format and the ADX service identity.
- **CLI:** `--session`, `--token` / `KIPSCOPE_TOKEN` / `KIPSCOPE_TOKEN_COMMAND` (the company's tool supplies the token), `whoami`, `session list|new|share|delete`, and the session named in every output.
- **UI:** the session in the address, a Sessions menu, a `Read-only` pill, gate pages (no access, no rights, not signed in), and the user with roles in the footer.

## Capabilities

### New Capabilities

- `user-identity`: the identity adapter contract, `none`, `oidc`, module adapters, the conformance suite, `/api/me`.
- `data-access`: the rules file, rights per user, the guard on every route, filtered lists, refusal without leaks.
- `sessions`: sessions with owner and share level, addressing, default session, session rights, management routes, live channel per session, persistence, migration, limits and cleanup, signal lists of open sessions, the session parts of the UI.

### Modified Capabilities

- `server-access`: configured origins, start lines per identity, the built UI served by the server.
- `workspace-state`: one workspace per session; render status, state file and restore per session.
- `saved-views`: views per user, "Before last open" per user, links and the address open a new session.
- `cli`: session and token options, session commands, one session per call.
- `app-footer`: the signed-in user and roles.
- `signal-catalog`: background retries follow the open sessions' scopes instead of the one restored scope.

## Out of scope

- A login flow inside KIPscope (OIDC code flow, cookies, refresh), a device flow in the CLI, and KIPscope's own personal tokens (Q-5 (b) and (c) if Jan asks for them).
- A platform concept or a platform column in the source (Jan: data-ref patterns suffice).
- Deny rules, rights per signal or per time range, a `*` role for every signed-in user, reloading rules without a restart, an admin UI for rules.
- Sharing with named users or groups, an audit log, query quotas or rate limits per user.
- A shared view store, copying a session, renaming a session, sessions of other users in the list.
- Edits by two users in the same session at the same time beyond today's "last command wins" (concept §7).
- The finder handoff, case context and neighbours (`add-case-open`). Signal books (`add-signal-books`). Snapshots and undo (concept §8).
- New ADX auth code: on a server `az login --service-principal` or `az login --identity` feeds today's `KIPSCOPE_ADX_AUTH=azcli` (documented only). Per-user ADX access (D-083: ADX is read as the server).

## Impact

- `packages/shared/src`: new `session.ts` (IDs, share levels, summaries, `Me`, requests, header and close-code constants, `parseSessionLink`). `OpenViewRequest` moves here from the server. `LiveServerMessage` gains `session`, `ClientRenderStatus` gains `user`.
- `apps/server/src`: new `identity.ts`, `identity/oidc.ts`, `rights.ts`, `guard.ts`, `sessions.ts`, `web.ts`, `routes/sessions.ts`, `routes/identity.ts`; new `apps/server/examples/forward-header.mjs`. Changes in `app.ts`, `access.ts`, `config.ts`, `http.ts`, `scope.ts`, `workspace.ts`, `persist.ts`, `views.ts`, `routes/*`, `meta.ts`, `main.ts`, `.env.example`. New dependency `jose`.
- `apps/web/src`: new `session/` (start-up, API prefix, gate pages, Sessions menu). Changes in `api.ts`, `live.ts`, `App.tsx`, `bar/`, `footer/`. `apps/web/vite.config.ts` gets the dev user and roles.
- `apps/cli/src`: options, token command, client, forms, output.
- Docs: new `docs/deploy.md`, plus `docs/http-api.md` and the README.
- Breaking: the state dir layout (migrated automatically) and the location of the views (migrated). Unprefixed routes keep working. In `none` mode nothing else changes.
