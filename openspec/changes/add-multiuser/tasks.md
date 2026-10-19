# Tasks

Written for Q-1 (a), Q-2 (a), Q-3 (a) and Q-4 (a) (design "Questions for Jan"). The lead confirms them with Jan before round 1. Every interface two areas share is pinned: the shared DTOs and routes in design M7, the session store in M4, addressing in M5, rights in M6, the live channel in M8, the variables in M2. So all tasks below can run in one round in parallel. An engineer stubs a type from another task until it lands. The tester writes group 6 test-first from the specs. A second round is only for findings.

Write areas (disjoint):

- 1.1: `packages/shared/src/session.ts` (new), `workspace.ts`, `index.ts`
- 2.1: `apps/server/src/identity.ts` (new), `tokens.ts` (new), `config.ts`, `access.ts`, `routes/identity.ts` (new), `.env.example`
- 2.2: `apps/server/src/sessions.ts` (new), `rights.ts` (new), `persist.ts`, `workspace.ts`
- 2.3: `apps/server/src/app.ts`, `http.ts`, `scope.ts`, `meta.ts`, `routes/workspace.ts`, `routes/sessions.ts` (new)
- 2.4: `apps/server/src/views.ts`, `routes/views.ts`, `routes/series.ts`, `routes/events.ts`, `routes/signals.ts`
- 2.5: `apps/server/src/main.ts`, `web.ts` (new)
- 3.1: `apps/web/src/session/startup.ts`, `session/apiPath.ts`, `session/Gate.tsx` (new), `api.ts`, `live.ts`, `main.tsx`, `App.tsx`, `views/*` (Copy link page only)
- 3.2: `apps/web/src/session/SessionsMenu.tsx`, `session/ReadOnlyPill.tsx`, `session/CliAccess.tsx`, `session/title.ts` (new), `bar/*`
- 3.3: `apps/web/src/footer/*`, `apps/web/vite.config.ts`
- 4.1: `apps/cli/src/*`
- 5.1: `docs/deploy.md` (new), `docs/http-api.md`, `README.md`
- 6.x: tests as listed per task

## 1. packages/shared

- [ ] 1.1 Session DTOs (M7, M8): new `session.ts` with `SESSION_ID`, `USER_ID`, `LOCAL_USER`, the limits, `SESSION_HEADER`, the close codes, `SessionShare`, `AuthMode`, `SessionRights`, `SessionSummary`, `OpenViewRequest` (moved from `apps/server/src/routes/views.ts`), `CreateSessionRequest`, `ShareRequest`, `CreateTokenRequest`, `Me`, `SessionList`, `SessionAnswer`, `CreateSessionAnswer`, `TokenSummary`, `TokenList`, `CreateTokenAnswer`, `parseSessionLink`, `sessionPath`, `sessionApi`. `workspace.ts`: `LiveServerMessage` `session` and `ClientRenderStatus.user`. Export from `index.ts`. Verify: `pnpm --filter @kipscope/shared build`; `packages/shared/test/session.test.ts` › "parses session links" (`https://k.example/s/abcdefghij` → origin and ID, `https://k.example/api/s/abcdefghij/live` → the same, `https://k.example/x` and `/s/ABC` → undefined).

## 2. apps/server/src

- [ ] 2.1 Identity, tokens, config, access (M1, M2, M3, M10): `identify`; `TokenStore` (hash only, per-user file, in-memory index, limit, `lastUsedAt` at most once a minute); the M2 variables in `config.ts` and `.env.example`; `access.ts` with the configured origins and `accessLog(config)`; `routes/identity.ts` with `GET /api/me` and the three token routes (409 `auth_disabled` in `none` mode). Verify: scenarios "Configuration", "Local user without SSO" (with 2.3's hook), "Header from trusted and untrusted peers", "Create, use, revoke", "Only the hash is stored, kept across a restart", "Bad label and none mode", "Host of a configured origin", "Configured origin exactly", "Origins configuration", "Start lines per mode"; `grep` of "One place".
- [ ] 2.2 Session store and rights (M4, M6): `SessionStore` exactly as pinned in M4 (files, debounced writes per session, restore, bad files aside, migration, limit with eviction, idle cleanup on a fake clock, `onChange`); `rightsOf`; `summaryOf`; `persist.ts` reads and writes the session file format; `WorkspaceStore.execute(input, ctx?, beforeOpen?)` and `connect(user)` with `user` in `renderStatus()`. Verify: scenarios "Restart keeps every session", "Broken session file", "Old state dir", "Limit", "Idle cleanup", "Rights function", workspace-state "Debounced, atomic writes", "Restart keeps the workspace", "Broken state file".
- [ ] 2.3 Addressing, rights hook, live channel, session routes (M5, M6, M8, M9 meta): `rewriteUrl` for `/api/s/<id>/…`; one `onRequest` hook after the access guard: `identify` (401), session resolution (prefix or `defaultOf`, 404 `unknown_session`), rights per the M6 table (403), and the `X-KIPscope-Session` header; `sessionOf(request)` in `http.ts`; `scopeOf(request)` from the session; `CatalogStore.keep()` returns the scopes of `sessions.open()`; `routes/workspace.ts` per session (live: `hello`, `session`, `state`; `touch` on connect; `session` messages and close codes 4403 and 4404 on `onChange`; `keepCatalogLoaded` for the scope on the first connect and on a scope change); `routes/sessions.ts` with the M7 routes (create with `open` through the same path as `POST /api/views/open`, atomic); `meta.ts` per session. Verify: scenarios "Sessions stay apart", "Prefix routes", "Most recently active", "Private, read, write", "Bob loses rights", "List, share, delete", "Create with an open view" (with 2.4), "Nothing runs unauthenticated", "Clients of another session", "Shared and kept lists", "Restored scope in scoped mode"; existing `workspace.http`, `access.http`, `scope.http` and `meta.http` tests stay green.
- [ ] 2.4 Views per user and background signals (M9): `viewsOf(user)` with one cached `ViewStore` per `<stateDir>/users/<user>/views/`; `routes/views.ts` uses the requester's store, the request's session and `OpenViewRequest` from shared, and passes the `_previous` hook per call; `routes/series.ts` and `routes/events.ts` take the window and events-line signals of `sessions.open()` (union) instead of the one workspace; `routes/signals.ts` reads the session's scope through `routeScope` only. Verify: saved-views scenarios "Save, list, overwrite", "Views per user", "Open, then go back"; sessions "Periods for every open session"; existing `views.http`, `events.http`, `gaps.http` tests stay green.
- [ ] 2.5 Wiring and the built UI (M2, M4, M10, M11): `main.ts` builds the `SessionStore` (seed from the project file, `start()`, flush on `SIGINT`/`SIGTERM`), the token store, the auth config, and logs `accessLog`; it drops the single `WorkspaceStore`, the single `StatePersister` and the start-up `keepCatalogLoaded` of a restored scope; `web.ts` serves `KIPSCOPE_WEB_DIR` per M11. Verify: scenario "Files, app routes and traversal"; `grep -n "accessLog" apps/server/src/main.ts`; `pnpm --filter @kipscope/server build`; the dev server starts on Jan's `.kipscope` and migrates it (log lines of "Old state dir").

## 3. apps/web/src

- [ ] 3.1 Session start-up and API prefix (M12): `startupTarget` and the start-up effect before the live channel opens (`replaceState` to `/s/<id>`, address views through `POST /api/sessions {open}`, errors in the message line); `apiPath` used by every session-resolving call in `api.ts` and by `live.ts`; no reconnect after 4403 and 4404; gate pages for 401, 403 and 404 with "My latest session" and "New session"; `session` live messages kept in app state (`rights`, `owner`); "Copy link" on the page origin. Verify: scenarios "Start-up target", "API paths of a session", "Link page is the origin", "Start-up from a link"; UI checks "Old tabs keep their case", "Link in a second browser", "Bookmark by name", workspace-state "Browser reload".
- [ ] 3.2 Sessions menu, read-only pill, CLI access (M12): Sessions menu in the top row (list, current marked, client mark, new, copy session link, share for the owner, delete with confirm); `sessionTitle`; `Read-only` pill; "CLI access…" dialog in the overflow menu in header mode only, with `cliAccessLines`. Takes `rights`, `owner` and `me` from 3.1's app state (stub until it lands). Verify: scenarios "Title rule", "Shell lines"; UI checks "Menu on real data", "Token from the dialog drives the CLI", "Two users on real data".
- [ ] 3.3 Footer user and dev user (M2, M12): `footerItems(meta, zone, me?)` adds the user item in header mode, and `GET /api/me` is read once at start; `vite.config.ts` adds the identity header from `KIPSCOPE_DEV_USER` (header name from `KIPSCOPE_AUTH_HEADER`, default `X-authentik-username`) to the `/api` proxy, the WebSocket included. Verify: scenario "User item"; UI check "Two users on real data" (footer part).

## 4. apps/cli/src

- [ ] 4.1 Session and token (M13): `--session`, `KIPSCOPE_SESSION`, a session link as `--server`, `--token`, `KIPSCOPE_TOKEN`; `Authorization: Bearer`; the session pinned from the first answer's header for the rest of the call; `CliOutput.session`; the forms `whoami`, `session list|new|share|delete`; the help text. Verify: scenarios "Session and server from options", "Session named in the output", "Token against a server in header mode", "Wait sees only its session", "Forms", "Over HTTP", "Help lists the forms", "Usage".

## 5. Docs

- [ ] 5.1 Deployment and API docs (M14): `docs/deploy.md` (proxy with authentik forward auth, the KI.ping shape, the token route, trust boundary, `KIPSCOPE_WEB_DIR` with `pnpm build`, ADX via `az login --service-principal` or `--identity`); `docs/http-api.md` (prefix rule, default session, session header, new routes and codes); README (variables, CLI forms, link to `docs/deploy.md`). Verify: api-reference "Every route listed" (`apps/server/test/docs.test.ts`) passes with the new routes; `grep -n "docs/deploy.md" README.md` prints a line.

## 6. Tests (tester, test-first)

- [ ] 6.1 Shared and server unit tests: `packages/shared/test/session.test.ts`; `apps/server/test/config.test.ts` ("reads the auth settings"); `apps/server/test/rights.test.ts`; `apps/server/test/sessions.test.ts`; `apps/server/test/sessions.persist.test.ts`; `apps/server/test/persist.test.ts` (adapted to session files). A test helper builds the app in header mode with injected peers (`remoteAddress`) and headers. Verify: `pnpm test` runs the named scenarios.
- [ ] 6.2 Server HTTP tests: `apps/server/test/identity.http.test.ts`, `tokens.http.test.ts`, `sessions.http.test.ts`, `web.http.test.ts`; the additions to `access.http.test.ts`, `views.http.test.ts`, `workspace.http.test.ts`, `scope.http.test.ts` ("keeps an open session's scope list loaded" replaces "keeps the restored scope's list loaded"). Verify: `pnpm test`.
- [ ] 6.3 Web and CLI tests: `apps/web/test/session.test.ts`, `footer.test.ts` ("shows the signed-in user"), `viewlink.test.ts` (origin page); `apps/cli/test/args.test.ts` ("reads the session and the token", "maps the session forms") and `cli.test.ts` ("addresses a session", "sends the token", "waits for a UI of the same session", "manages sessions", help). Verify: `pnpm test`; then `pnpm build && pnpm lint`.
- [ ] 6.4 Crash guard: `pnpm smoke` against the dev server and `--preview` passes with the start-up redirect to `/s/<id>`. If `scripts/smoke.mjs` asserts the page path, the tester adapts only that assertion. Verify: ks-smoke pass.

## Workflow follow-up

- The lead asks Jan Q-1 … Q-4 before round 1.
- Not checked here: a real authentik or KI.ping proxy in front (Jan's deployment check with `docs/deploy.md`).
- At archive: copy the project-wide decisions (identity hook, sessions, rights, views per user, spec owner's defaults) into `docs/decisions.md`. Update the purpose lines of `server-access` and `workspace-state`, which still say "local only" and "the open workspace".
