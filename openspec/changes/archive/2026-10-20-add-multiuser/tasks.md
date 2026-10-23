# Tasks

Rounds 1–4 (2026-10-19) built groups 1–6 under the name "session" and with a rules file. The revision of 2026-10-20 (D-085, D-086; design "Revision 2026-10-20") adds groups 7–12.

- **Ticked tasks** were built and are still valid in substance. Group 7–12 tasks rename them and replace the rules file; their scenarios now carry the new names and evidence files.
- **Pinned interfaces** that two areas share: design M3 (grant), M4 (registry), M5 (addressing), M6 (guard and route table), M7 (DTOs and routes), M8 (live), M12 (web texts and the `OptionBar` props), M13 (CLI). All tasks of groups 7–12 can run in one round in parallel; an engineer stubs a type from another task until it lands.
- **Tests:** the tester writes group 12 test-first from the specs.

Write areas of groups 7–12 (disjoint):

- 7.1: `packages/shared/src/workspaces.ts` (from `session.ts`), `workspace.ts`, `index.ts`
- 8.1: `apps/server/src/workspaces.ts` (from `sessions.ts`), `persist.ts`
- 8.2: `apps/server/src/rights.ts`, `guard.ts`, `config.ts`, `access.ts`, `.env.example`
- 8.3: `apps/server/src/app.ts`, `http.ts`, `scope.ts`, `meta.ts`, `main.ts`, `web.ts`, `identity.ts` (comments), `routes/*` (`routes/workspaces.ts` from `routes/sessions.ts`)
- 9.1: `apps/web/src/workspaces/` (from `session/`: `startup.ts`, `apiPath.ts`, `gate.ts`, `Gate.tsx`, `ReadOnlyPill.tsx`, `title.ts`, `workspaces.css`), `api.ts`, `live.ts`, `main.tsx`, `App.tsx`
- 9.2: `apps/web/src/workspaces/ShareMenu.tsx` (new), `workspaces/share.ts` (new), `workspaces/recent.ts` (new), `bar/*`, `views/*`, `help/hints.ts`
- 10.1: `apps/cli/src/*`
- 11.1: `docs/deploy.md`, `docs/http-api.md`, `README.md`
- 12.x: tests as listed per task; `apps/server/scripts/grant.ts` (new, 12.4)

## 1. packages/shared (built)

- [x] 1.1 Session DTOs (M7, M8): IDs, share levels, summaries, `OpenViewRequest`, create and share requests, `Me`, link parsing, live `session` message, `ClientRenderStatus.user`. Renamed and extended by 7.1.

## 2. apps/server/src (built)

- [x] 2.1 Identity adapters, config, access (M1, M2, M10, M15): `none`, `oidc` with `jose`, `module:<path>`, the example forward-header module, origins, `accessLog`, `GET /api/me`. Still valid. 8.2 removes `KIPSCOPE_RULES` and adds `KIPSCOPE_SHARE`.
- [x] 2.2 Rights and the guard (M3, M6): the guard hooks, the `onRoute` check, `dataRefsOfView`, `dataRefsOfCommand`, `catalogView`. Still valid. The rules part (`loadRules`, `rightsOf`, `hasRights`, `canSee`, `no_rights`) is removed by 8.2.
- [x] 2.3 Session store (M4): files, debounce, restore, bad files aside, migration of `workspace.json`, limit, idle cleanup, `onChange`. Renamed and extended by 8.1.
- [x] 2.4 Addressing, wiring of the guard, live channel, session routes (M5, M6, M8, M9). Renamed by 8.3.
- [x] 2.5 Data routes, views per user, background signals (M6, M9). Still valid; renames ride with 8.3.
- [x] 2.6 Wiring and the built UI (M2, M4, M10, M11). Renamed by 8.3.

## 3. apps/web/src (built)

- [x] 3.1 Session start-up, API prefix, gate pages (M12). Renamed and changed by 9.1.
- [x] 3.2 Sessions menu and read-only pill: the menu is removed by 9.2. The `Read-only` pill was built and stays, with its tooltip changed by 9.2. Not reopened; its UI checks moved to 12.5.
- [x] 3.3 Footer user and dev users (M2, M12): built in round 1. Open only for the UI evidence. Verify: app-footer "User item" (green since round 1); UI check "Two users on real data" (footer part), now in workspaces "Read-only workspace in the UI" (run in 12.5).

## 4. apps/cli/src (built)

- [x] 4.1 Session and token (M13). Token handling still valid; renamed by 10.1.

## 5. Docs (built)

- [x] 5.1 Deployment and API docs (M14). Revised by 11.1.

## 6. Tests (built)

- [x] 6.1 Shared and server unit tests. Renamed and rewritten by 12.1, 12.2.
- [x] 6.2 Identity conformance suite (`apps/server/test/identity/conformance.ts`, its two runs, `oidc.test.ts`). Still valid.
- [x] 6.3 Server HTTP tests. Renamed and rewritten by 12.2.
- [x] 6.4 Web and CLI tests. Renamed and rewritten by 12.3.
- [x] 6.5 Crash guard: `pnpm smoke` against the dev server and `--preview` passes with the start-up redirect to `/w/<id>`. If `scripts/smoke.mjs` asserts the page path, the tester adapts only that assertion. Verify: ks-smoke pass.

## 7. packages/shared: rename and grant

- [x] 7.1 `session.ts` → `workspaces.ts` exactly as design M7 and M3:
  - `WORKSPACE_ID`, `USER_ID`, `LOCAL_USER`, `MAX_WORKSPACES_PER_USER`, `WORKSPACE_HEADER`, `RECENT_WORKSPACES`, `CLOSE_NO_ACCESS`, `CLOSE_WORKSPACE_GONE`
  - `Grant` (zod and type), `MAX_GRANT_OBJECTS`, `GRANT_ALL`, `GRANT_NONE`, `Granted`
  - `WorkspaceShare`, `WorkspaceRights`, `WorkspaceSummary` with `granted`
  - `OpenViewRequest`, `CreateWorkspaceRequest` with `reuse`, `ShareRequest`
  - `Me` with `canShare` and without `rights`
  - `WorkspaceList`, `WorkspaceAnswer`, `CreateWorkspaceAnswer` with `reused`
  - `parseWorkspaceLink`, accepting `/w/`, `/api/w/` and the legacy `/s/` (constant `LEGACY_UI_PATH`); `workspacePath`, `workspaceApi`

  In `workspace.ts`, `LiveServerMessage` gets `{type: "summary"; summary}` instead of `session`. Export from `index.ts`. Verify: `pnpm --filter @kipscope/shared build`; `packages/shared/test/workspaces.test.ts` › "parses workspace links" (`https://k.example/w/abcdefghij`, `https://k.example/api/w/abcdefghij/live` and `https://k.example/s/abcdefghij` all give origin and ID; `https://k.example/x`, `/w/ABC` and `https://k.example/api/s/abcdefghij/live` give undefined).

## 8. apps/server/src: registry, grant, guard, routes

- [x] 8.1 Registry (M3, M4): `sessions.ts` → `workspaces.ts` with `WorkspaceRegistry` exactly as pinned:
  - the `grant` on the record and in the file (version 2), and `initialGrant` at create
  - `seed(grant)`, `grantOf`, and `grantObjects` with `GrantLimitError` and an `onChange` `grant` event
  - `reuseOf`, with an in-memory claim of `REUSE_CLAIM_MS` that a live connect clears
  - `defaultOf(user)` without `canOpen`
  - `WorkspaceLimitError`
  - the migration order of M4: the legacy `sessions/` folder and `kipscope: "session"` v1 files through `LEGACY_SESSIONS_DIR` and `LEGACY_SESSION_TAG`
  - `summaryOf(entry, rights, grant)` with `granted`

  `persist.ts` reads and writes the v2 file and reads the legacy one. Verify: workspaces "Two start-ups at once" (unit part), "Restart keeps every workspace", "Broken workspace file", "Old state dir", "Session folder of round 1", "Limit", "Idle cleanup"; data-access "Widening"; workspace-state "Debounced, atomic writes", "Restart keeps the workspace", "Broken state file".
- [x] 8.2 Grant checks, guard, config (M2, M3, M6, M10):
  - `rights.ts`: remove `loadRules`, `rightsOf`, `hasRights`, `canSee`, `ALL_RIGHTS` and the `Rules`/`Rights` types. Add `covers`, `effectiveGrant`, `initialGrant` and `grantedOf`; make `workspaceRights(user, entry)` per M6; `catalogView(catalog, grant)`. `dataRefsOfWorkspace` goes if nothing uses it.
  - `guard.ts`: `Level` without `identity`; no `no_rights`. The `preHandler` checks `dataRefs` against the resolved workspace's effective grant, or for level `user` against `initialGrant`. It sets `workspaceOf` and `grantOf`; `unknown_workspace`.
  - `config.ts`: no `KIPSCOPE_RULES`; `KIPSCOPE_SHARE` → `Config.share`; `KIPSCOPE_WORKSPACE_IDLE_DAYS`.
  - `access.ts` `accessLog`: `sharing on|off`, no rules.
  - `.env.example`.

  Verify: data-access "Grant functions", "Every API route declares its access"; workspaces "Rights function"; server-access "Start lines per mode"; user-identity "Selection"; workspaces "Idle days configuration"; data-access "Share switch" (config part).
- [x] 8.3 Routes and wiring (M5, M6, M7, M8, M11):
  - `rewriteUrl` for `/api/w/<id>/…` only; `X-KIPscope-Workspace`; `workspaceOf`, `grantOf`, `userOf` in `http.ts`
  - `routes/sessions.ts` → `routes/workspaces.ts` with the M7 routes: `reuse` (400 together with `open`, 400 for unknown keys), the share route with `share_not_permitted` from `Config.share`, `workspace_limit`
  - `routes/workspace.ts`: live `hello`, `summary`, `state`; a `summary` or 4403 after share, grant and command events; 4404 on delete
  - `routes/identity.ts`: `Me` with `canShare`
  - `routes/views.ts`, `series.ts`, `events.ts`, `signals.ts`, `meta.ts`, `scope.ts`: renames and `routeScope` with `catalogView(…, grantOf(request))`
  - `POST /api/views/import` without `open` names no data refs
  - `main.ts`: builds the `WorkspaceRegistry` with the identity kind and drops the rules loading
  - `web.ts`: comments only (the catch-all already serves `/w/` and `/s/`)

  Verify:
  - workspaces "Workspaces stay apart", "Prefix routes", "Most recently active", "Two start-ups at once" (HTTP part), "Private, read, write", "Bob loses rights", "List, share, delete", "Open into a new workspace", "Clients of another workspace", "Shared and kept lists", "Periods for every open workspace"
  - data-access "New workspace on a server sees nothing", "Carried-over grant on a server", "Local mode unchanged", "A client cannot set a grant", "A workspace keeps to its grant on every route", "Granted data still answers", "Filtered catalog", "Invited user and the owner's grant", "Share switch", "View into a granted workspace"
  - user-identity "Local user", "Roles and sharing", "Nothing runs unauthenticated"
  - server-access "Files, app routes and traversal"; signal-catalog "Restored scope in scoped mode"
  - `pnpm --filter @kipscope/server build`; the dev server starts on Jan's `.kipscope` in `none` mode and logs the migration of `sessions/` to `workspaces/`

## 9. apps/web/src: rename, start-up, Share…, Recent

- [x] 9.1 Start-up, prefix, gates (M5, M12):
  - `session/` → `workspaces/`
  - `startupTarget` per M12: `/s/<id>` read as `/w/<id>` (`LEGACY_UI_PATH`), and `/` or a bad path → `{create: {reuse: true}}`; `replaceState` to `/w/<id>`
  - `apiPath` with `/api/w/`
  - `gateOf` and `Gate.tsx` with the M12 table: the empty-grant gate from `me.identity` and `summary.granted`, lifting on a `summary` message; no `no_rights` gate
  - `live.ts` handles `summary`; `api.ts` uses the `/api/workspaces` routes and `CreateWorkspaceAnswer`
  - `App.tsx` passes `workspaceId`, `summary` and `me` to `OptionBar` (M12 props); the Sessions menu's mount goes

  Verify: workspaces "Start-up target", "Gate texts", "API paths of a workspace"; saved-views "Start-up from a link"; workspace-state "Browser reload".
- [x] 9.2 Share… and Recent (M12):
  - `workspaces/share.ts` `shareItems(me, summary)` with the M12 texts, and `workspaces/ShareMenu.tsx` as an overflow item in `bar/OptionBar.tsx` (row or "⋯")
  - `workspaces/recent.ts` `recentRows(summaries, currentId)` and `workspaceTitle` (from `title.ts`); the "Recent workspaces" section in `views/ViewsMenu.tsx`, loaded on open
  - "Copy link" removed from the Views menu; `views/link.ts` comments
  - delete `SessionsMenu.tsx` and `session/hints.ts`, moving the needed tooltips into `help/hints.ts`
  - the `Read-only` tooltip text of M12

  Verify: workspaces "Share items", "Title rule", "Recent rows"; saved-views "Link page is the origin"; the grep of workspaces "No session in the code" for `apps/web/src`.

## 10. apps/cli/src

- [x] 10.1 Rename (M13):
  - `--workspace`, `KIPSCOPE_WORKSPACE`, and `parseWorkspaceLink` for `--server` and `--workspace`
  - `X-KIPscope-Workspace` pinning, `/api/w/<id>/…`, `CliOutput.workspace`
  - the forms `workspace list|new|share|delete` (`local.url` `/w/<id>`); `session` forms and `--session` are usage errors
  - `whoami` prints `Me` with `canShare`; the help text

  Verify: cli "Usage", "Workspace and server from options", "Workspace named in the output", "Token against a server with `oidc`", "Wait sees only its workspace", "Forms", "Over HTTP", "Help lists the forms", "Keeps a workspace to its grant".

## 11. Docs

- [x] 11.1 (M14):
  - `docs/deploy.md`: replace the rules section with "Rights" (the search tool decides, grant per workspace, empty until a handoff from the search tool, `KIPSCOPE_SHARE`, start a server on a fresh state dir); the renames
  - `docs/http-api.md`: `/api/w/<id>` prefix, `/api/workspaces…`, `X-KIPscope-Workspace`, the error codes of M7, the access levels of M6, `reuse`
  - README: the variables and CLI forms

  Verify: api-reference "Every route listed" (`apps/server/test/docs.test.ts`) passes with the renamed routes; `grep -n "KIPSCOPE_RULES" docs README.md` prints nothing; `grep -n "KIPSCOPE_SHARE" docs/deploy.md README.md` prints lines; the grep of workspaces "No session in the code" for the three docs.

## 12. Tests (tester, test-first)

- [x] 12.1 Shared and server unit tests:
  - `packages/shared/test/session.test.ts` → `workspaces.test.ts`
  - `apps/server/test/sessions.test.ts` → `workspaces.test.ts`, including "reuses a free workspace once" and "widens a grant only through grantObjects"
  - `apps/server/test/sessions.persist.test.ts` → `workspaces.persist.test.ts`, including "migrates the session folder of round 1"
  - `apps/server/test/rights.test.ts`: the rules cases out; "covers data refs by grant" and "derives workspace rights from owner and share level"
  - `apps/server/test/config.test.ts`: identity settings without rules; auth settings with `KIPSCOPE_SHARE` and `KIPSCOPE_WORKSPACE_IDLE_DAYS`
  - `apps/server/test/persist.test.ts`: v2 files

  Verify: `pnpm test` runs the named scenarios.
- [x] 12.2 Server HTTP tests:
  - `apps/server/test/identityApp.ts`: a test adapter (`x-test-user`, `x-test-roles`), no rules object, and a helper `grant(app, workspaceId, dataRefs)` that calls the app's registry `grantObjects`
  - `sessions.http.test.ts` → `workspaces.http.test.ts`, with the renamed cases plus "never hands one free workspace to two tabs" and "applies share, grant and delete to open connections"
  - `rights.http.test.ts` rewritten for the data-access scenarios ("starts a server workspace with an empty grant", "reads a stored all as empty on a server", "grants everything in local mode", "takes no grant from a client", "keeps a workspace to its grant on every route", "answers granted data as before", "filters lists and counts by grant", "shows an invited user the shared grant only there", "needs sharing turned on to share", "opens a view only within the grant")
  - `identity.http.test.ts` "reports roles and the share switch"
  - `identity/oidc.test.ts` "refuses a token of another issuer on a workspace route"
  - the renames in `guard.routes.test.ts`, `web.http.test.ts`, `access.http.test.ts`, `views.http.test.ts`, `workspace.http.test.ts` and `scope.http.test.ts`

  Verify: `pnpm test`.
- [x] 12.3 Web and CLI tests:
  - `apps/web/test/session.test.ts` → `workspaces.test.ts`: "chooses the workspace from the address", "chooses the gate page", "prefixes workspace routes only", "offers the share items", "titles workspaces", "lists recent workspaces"
  - `viewlink.test.ts` with a `/w/` page
  - `apps/cli/test/args.test.ts`: "reads the workspace and the token", "maps the workspace forms"
  - `cli.test.ts`: "addresses a workspace", "sends the token", "keeps a workspace to its grant", "waits for a UI of the same workspace", "manages workspaces", help

  Verify: `pnpm test`; then `pnpm build && pnpm lint`.
- [x] 12.4 Dev grant script `apps/server/scripts/grant.ts <stateDir> <workspaceId> <dataRef…>`: builds a `WorkspaceRegistry` on a stopped state dir, calls `grantObjects`, `flush()`, `stop()`, and prints the new `granted`. It is for the UI checks only, and is not shipped in the server build. Verify: run it on a temp copy of a test state dir, then `GET /api/w/<id>/workspace` on a server started there shows the new `granted`.
- [ ] 12.5 UI checks (UI user, after 7–12.4): workspaces "Two tabs on real data", "Gate on a server workspace without data", "Share on real data", "Recent on real data", "Two users on real data"; data-access "Explorer of a server workspace"; saved-views "Link in a second browser", "Bookmark by name", "Overflow menu by keyboard", "Share in the row when there is room", "Menu entries"; workspace-state "Browser reload". Verify: one screenshot per scenario, as named in each.

## Workflow follow-up

- **Before round 5,** the lead asks Jan Q-6 and Q-7 (proposal "Open questions"). Tasks follow the recommended answers. Q-6 (b) adds one function in 8.2 and one scenario.
- **Not checked here:** a real OIDC provider, the company's token tool, and the search tool's signing (`add-case-open`).
- **At archive:** copy the project-wide decisions into `docs/decisions.md`: the identity adapter, `oidc` for Ping, the grant and `grantObjects` as the one widening path, the guard, the workspaces, views per user, `KIPSCOPE_SHARE`, and the spec owner's defaults. Update the purpose lines of `server-access` and `workspace-state`, which still say "local only" and "the open workspace".
- **Round log 1–4** (2026-10-19): `rounds.md`. Open from round 4, still for the lead: the CLI test hang in `apps/cli/test/multi.ts` (fixed in commit c49a6e9); `catalog_unavailable` shown as loading has no scenario (spec owner if wanted); the coulds listed there.
