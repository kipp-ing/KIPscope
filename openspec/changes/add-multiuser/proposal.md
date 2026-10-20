# Proposal

## Why

KIPscope becomes a server application, with only the browser on the user's machine (D-079: „das soll auf einem server laufen … lokal ist immer nur der browser. Multiuser ist also pflicht. eine zugriffsberechtigung im Server muss später auch einbaubar sein"). Today the server holds one workspace that every tab and the CLI share, and it answers only local requests (server-access). Jan answered the multiuser questions (D-083, D-084): „jedes sesseion braucht rechte, ja"; „bei mir lokal ohne login, bin mein eigener herr. für corp usage brauche ich was mit regeln und rechten. PING id sollte möglich sein mit unterschiedlichen rechten … muss halt anpassbar sein. da darf jeder auch seinen eigenen krams einbauen … q4 views je nutzer, ja". He also said „ja" to one workspace per case with its own URL.

**Revision 2026-10-20 (D-085, D-086).** The change was built in four rounds with a "session" that is a server-side workspace and a KIPscope rules file (role → data-ref patterns). Two later decisions change it before the archive:

- D-085: „wir können das rechtemanagement in kiping packen … die liste kann beliebig sortiert sein beliebige VINs." Rights live in KI.ping, not in a KIPscope rules file.
- D-086: „unlink ist aktuelles fahrzeug. unlink ist für den user unbegrenzt, rechte haben keinen zeit bezug des objekts." The other recommendations of the exploration [2026-10-20-sessions-and-handoff.md](../../../docs/explore/2026-10-20-sessions-and-handoff.md) were accepted: "session" means the finder's data section and the server state is an invisible "workspace" renamed in this change (Q1); the rules file drops out (Q11); a view grants nothing (Q13).

The exploration measured why: two tabs on `/` landed in one workspace and mirrored each other; the Sessions menu listed workspaces under data-section names, two with the same title; "Copy link" and "Copy session link" gave the receiver different things with nothing on screen saying which (exploration "What the app does today", rows 1–4).

This change is item 3 of status.md "Next". It comes before `add-case-open` and `add-signal-books`.

## What Changes

- **Identity as a pluggable adapter** (D-084), built: `none` (default: no login, user `local`), `oidc` (Ping-issued JWT access tokens, for the browser through a proxy and for the CLI as a bearer token), `module:<path>` for an organisation's own adapter, and one conformance suite. Roles are still read and shown; they decide nothing in KIPscope any more (D-085).
- **Rights come from KI.ping, held as a grant per workspace** (D-085, D-086 Q11, Q12): each workspace stores `grant: {objects: "all"} | {objects: <data refs>}`, never set by a client. In `none` the grant is `all`. On a server a new workspace starts with an empty grant, and only one server function, `grantObjects(workspaceId, dataRefs)`, widens it; `add-case-open` calls it after it verified KI.ping's signed handoff. A grant names whole vehicles with no time part (D-086). The rules file (`KIPSCOPE_RULES`, role → data-ref patterns) is removed.
- **One guard on the server** (D-084, D-079), built: every `/api/` route declares its access level and the data refs it names. A data ref outside the workspace's grant is refused before any lookup and never appears in lists or counts.
- **Workspaces, renamed from "sessions"** (D-086 Q1): many workspaces with a random ID, an owner, a share level (`private`, `read`, `write`), a grant, and their own revision, live channel, render acknowledgements and state file. The UI address is `/w/<id>` (old `/s/<id>` addresses redirect); workspace routes also answer as `/api/w/<id>/…`; the header is `X-KIPscope-Workspace`; the state lives in `<stateDir>/workspaces/` (migrated from `sessions/`). "Session" is kept for the finder's data section (`add-case-open`).
- **Workspaces drop out of the UI** (exploration "Workspaces become invisible"): no Sessions menu. "Share…" (top-row overflow item) offers "Copy link (own copy)" and "Invite to this workspace" (read or write), each saying what the receiver gets. A "Recent workspaces" list (last 10) sits in the Views menu. `/` opens the user's latest workspace without a live client, else a new one, chosen atomically on the server, so a second tab never mirrors the first. A gate page "Open a session from KI.ping" shows when a server workspace has an empty grant.
- **Sharing never widens data:** an invited user gets read or write on that workspace only. Every user of one server comes from the same identity provider (one adapter, one issuer), which is "the same Ping tenant". Their own workspaces never gain the shared workspace's grant. The share switch is `KIPSCOPE_SHARE=on|off` (it replaces the rules file's per-role share right).
- **Views per user** (D-084, Q-4), built. A view grants nothing (D-086 Q13): `#view=` links and `?view=` open in a new workspace, whose grant on a server is empty.
- **Server deployment**, built: `KIPSCOPE_ORIGINS`, `KIPSCOPE_WEB_DIR`, `docs/deploy.md`.
- **CLI:** `--workspace` / `KIPSCOPE_WORKSPACE`, `--token` / `KIPSCOPE_TOKEN` / `KIPSCOPE_TOKEN_COMMAND`, `whoami`, `workspace list|new|share|delete`. Without `--workspace` the CLI still takes the most recently active workspace (scripts keep working) and names it in every output.

## Capabilities

### New Capabilities

- `user-identity`: the identity adapter contract, `none`, `oidc`, module adapters, the conformance suite, `/api/me`.
- `data-access`: the grant per workspace, the one widening function, the guard on every route, filtered lists, refusal without leaks, sharing and views that never widen data.
- `workspaces`: workspaces with owner, share level and grant; addressing; the start-up choice; workspace rights; management routes; live channel per workspace; persistence and migration; limits and cleanup; signal lists of open workspaces; the workspace parts of the UI (Share…, Recent, gate pages, Read-only).

### Modified Capabilities

- `server-access`: configured origins, start lines per identity, the built UI served by the server.
- `workspace-state`: one workspace per entry of the registry; render status, state file and restore per workspace.
- `saved-views`: views per user, "Before last open" per user, links and the address open a new workspace, "Copy link" moves to Share…, the Views menu gains "Recent workspaces", Share… joins the overflow items.
- `cli`: workspace and token options, workspace commands, one workspace per call.
- `app-footer`: the signed-in user and roles.
- `signal-catalog`: background retries follow the open workspaces' scopes instead of the one restored scope.

## Open questions

For Jan. Tasks are written for the recommended answer; each alternative is small.

- **Q-6 What does an invited user see?** (a) **The workspace's grant (recommended):** KI.ping vouched for those vehicles to the owner, and the owner chose to share this one workspace. The receiver sees exactly what the owner sees there, and nothing of it reaches the receiver's own workspaces. (b) Stricter: the receiver needs their own grant. The workspace opens for them only when every data ref it holds is in the grant of one of their own workspaces, so they must have opened those vehicles from KI.ping themselves. Under (b), a shared workspace is mostly useful between users with the same KI.ping rights. The exploration's Security section had (b); D-086 does not name it. Cost of (b): one function more in `rights.ts` (the union of the receiver's own grants) and one scenario.
- **Q-7 A `#view=` or `?view=` link on a server:** it opens in a new workspace, whose grant is empty (Q13: a view grants nothing). So on a server the open is refused with `forbidden_data` until `add-case-open` brings layout and data together (its payload has a `view` field). (a) **Accept this for now (recommended).** (b) The new workspace takes over the grant of the opener's latest own workspace. The opener is the same user, and KI.ping vouched for that grant, but it is a second way to widen a grant. In `none` mode nothing changes either way.

## Out of scope

- A login flow inside KIPscope (OIDC code flow, cookies, refresh), a device flow in the CLI, and KIPscope's own personal tokens.
- The signed catalog, its verification (JWS, `KIPSCOPE_FINDER_JWKS`), the object → data ref mapping and every caller of `grantObjects`: `add-case-open`.
- Narrowing or revoking a grant, grant expiry, time windows in a grant (D-086: no time part), patterns in a grant.
- Any role → rights mapping in KIPscope, deny rules, rights per signal (D-085: rights are KI.ping's).
- Sharing with named users or groups, users of another identity provider, an audit log, query quotas or rate limits per user.
- A shared view store, copying, renaming or deleting a workspace in the UI (`kipscope workspace delete` and the idle cleanup remain), other users' workspaces in the Recent list, a "New workspace" entry in the UI.
- An alias for the old API prefix `/api/s/<id>/…` and for the old CLI option `--session` (only the UI address `/s/<id>` redirects).
- Switching workspaces without a page load, and keeping tiles across scopes (`add-case-open`, `add-tile-store`).
- Edits by two users in the same workspace at the same time beyond today's "last command wins" (concept §7).
- New ADX auth code (documented only); per-user ADX access (D-083: ADX is read as the server).

## Impact

- `packages/shared/src`: `session.ts` becomes `workspaces.ts` (IDs, share levels, `Grant`, summaries, `Me`, requests, header and close-code constants, `parseWorkspaceLink`). `LiveServerMessage` gets `summary` instead of `session`.
- `apps/server/src`: `sessions.ts` becomes `workspaces.ts` (registry with grant, `grantObjects`, atomic reuse, migration of `sessions/`); `routes/sessions.ts` becomes `routes/workspaces.ts`; `rights.ts` loses the rules and gains the grant checks; `guard.ts` loses `no_rights` and checks the grant; `config.ts` loses `KIPSCOPE_RULES` and gains `KIPSCOPE_SHARE`; renames in `app.ts`, `http.ts`, `persist.ts`, `scope.ts`, `meta.ts`, `main.ts`, `access.ts`, `web.ts`, `routes/*`, `.env.example`.
- `apps/web/src`: `session/` becomes `workspaces/`; the Sessions menu goes; new Share… item and Recent list (`bar/`, `views/`); the empty-grant gate; renames in `api.ts`, `live.ts`, `main.tsx`, `App.tsx`.
- `apps/cli/src`: options, forms and output renamed.
- Docs: `docs/deploy.md` (rules section replaced by the grant), `docs/http-api.md`, README.
- Breaking: the state dir layout (migrated automatically twice: `workspace.json` → `workspaces/`, `sessions/` → `workspaces/`), the API prefix, the CLI option and forms, the header. In `none` mode Jan's workspaces, views and old `/s/<id>` tabs keep working.
