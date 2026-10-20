# HTTP API

The routes of the KIPscope server (default `http://127.0.0.1:7310`), for your own client or to connect KIPscope to other tools. The UI and the CLI use the same routes; the CLI reference is in the [README](../README.md#cli). Payload types live in `packages/shared/src`; each route's fields, answers and errors are in the spec named in the table. Data sources: [data-sources.md](data-sources.md).

## Shared rules

- **Host and Origin** ([server-access](../openspec/specs/server-access/spec.md)): a request is answered only when its `Host` names `localhost`, `127.0.0.1` or `[::1]` (any port), the configured non-loopback `KIPSCOPE_HOST`, or the host of a `KIPSCOPE_ORIGINS` entry; otherwise 403 `forbidden_host`. A request with an `Origin` must be `http`/`https` with a loopback host or the `KIPSCOPE_HOST` name, or exactly one of `KIPSCOPE_ORIGINS`; otherwise (`null` included) 403 `forbidden_origin`. Requests without `Origin` (curl, the CLI) pass. The live channel's upgrade follows the same rules.
- **Identity** ([user-identity](../openspec/specs/user-identity/spec.md), [deploy.md](deploy.md)): with `KIPSCOPE_IDENTITY=none` (the default) every request is the user `local`, every workspace is granted everything, and nothing below needs a credential. Otherwise the identity adapter checks every `/api/` request but `GET /api/license`, the live upgrade included: no credential answers 401 `unauthenticated`, a bad one 401 `invalid_token`, an adapter that cannot decide (IdP unreachable) 503 `identity_unavailable`. With `oidc` the credential is `Authorization: Bearer <JWT>` (or the header `KIPSCOPE_OIDC_HEADER` names).
- **Access levels** ([data-access](../openspec/specs/data-access/spec.md)): every route declares one, checked in this order before the route runs. `public`: no user. `user`: a signed-in user. `workspace`: also the open right on the workspace, else 403 `forbidden`. `change`: also the change right, else 403 `read_only`. Then every data ref the request names (`signal`, `dataRef`, a command's signal or scope, a view's data refs) must be covered by the workspace's grant, else 403 `forbidden_data` with the message `data ref <ref> is not permitted`; for `POST /api/workspaces {open}` that is the grant the new workspace will get. That answer is decided from the grant alone, before any lookup or source query, so it is the same for a data ref that exists and one that does not. Lists and counts (catalog, `/api/signals` `total`, meta `size`) never include data refs outside the grant, and `/api/workspaces` never lists other users' workspaces.
- **Grant** ([deploy.md](deploy.md#rights)): each workspace holds the data refs it may read, decided by KI.ping. With `none` it is everything; on a server a new workspace's grant is empty until a handoff from KI.ping widens it. No request sets a grant; a client only reads `granted` (`"all"` or the number of data refs) in the workspace summary.
- **JSON bodies:** request bodies are `application/json` only; any other type, `text/plain` included, gets 415. A POST without a body is fine. Bodies up to 1 MiB (Fastify's default, else 413); a view text for import at most 256 KiB (413 `view_too_large`); a live channel message at most 256 KiB (the connection closes with 1009).
- **Times** are decimal nanoseconds since 1970-01-01T00:00:00Z as strings (`"1791158400000000000"`), in answers and in query fields; query fields also accept ISO-8601 (`2026-10-05T00:00:00Z`). Bounds lie within 1900-01-01 … 2262-04-11.
- **Signal IDs** are `<dataRef>/<name>`, e.g. `smart451/BMS.SOC`; URL-encode them in query strings.
- **Errors** answer `{"error": {"code": "...", "message": "..."}}`, sometimes with more fields (`signalId`, `reason`, the range). 400 `invalid_request` for a bad query or body; 404 for an unknown signal, data ref or view; 502 `source_error` when the database query failed.
- **Catalog not loaded:** routes that need the signal catalog answer 503 `catalog_unavailable` with `reason` (still loading, or source unreachable) until the first load succeeded.
- **Scope** ([scope](../openspec/changes/add-scope/specs/scope/spec.md), D-078): the workspace may hold a scope, one data ref and a half-open time window `[from, to)`. While it does, every data route answers as if the source held only that window of that data ref: the catalog and signal search list the scope's signals (`scope` in the answer), density, gaps and events cover the scope, series ranges are cut to it, and every source query carries the data ref and both time bounds. A signal or `dataRef` of another data ref, a series range wholly outside, or a `value` time outside answers 409 `out_of_scope`. With `KIPSCOPE_CATALOG=scoped` and no scope, the catalog and data routes answer 409 `scope_required`, and `/api/meta` reports catalog state `no_scope`. The scope changes only through the commands `scope.set` and `scope.clear` and through opening a view (which sets the view's scope, else one derived from its windows, cursors and `KIPSCOPE_SCOPE_PAD`); loading the new scope's signal list first can answer 503 `catalog_unavailable`, with the workspace unchanged. Range commands are clamped into the scope (`clamped: true` in the result); commands refused for the scope (`scope_required`, `out_of_scope`) answer 422 like other rejected commands.
- **Commands** answer a `CommandResult` (`{ok: true, revision, …}` or `{ok: false, code, message}`): 200, 400 `invalid_command`, 503 `catalog_unavailable`, 403 `forbidden_data`, else 422.

## Workspaces

Each workspace ([workspaces](../openspec/specs/workspaces/spec.md)) has an ID of 10 characters `[a-z0-9]`, an owner, a share level (`private`, `read`, `write`), a grant and its own live channel. The UI page of a workspace is `/w/<id>`.

- **Prefix rule:** every route of access level `workspace` or `change` (table below) also answers as `/api/w/<id>/<rest>` for workspace `<id>`, e.g. `/api/w/abcdefghij/workspace` or the live channel `/api/w/abcdefghij/live`. An ID of the right form that names no workspace answers 404 `unknown_workspace`. On the other routes a prefix is ignored. The table names each route once, without the prefix. The old prefix `/api/s/<id>/…` is an unknown route (404).
- **Default workspace:** without the prefix, a `workspace` or `change` route serves the requester's default workspace: their own with the latest activity, or a new empty one when there is none. Scripts and the CLI without `--workspace` keep working this way.
- **Workspace header:** every answer that served a workspace carries `X-KIPscope-Workspace: <id>`; a client that wants to stay in one workspace takes it from the first answer and prefixes later requests (the CLI does).
- **Live channel:** on connect it sends `{type: "hello", clientId}`, then `{type: "summary", summary}` (the workspace summary with this connection's `rights`, `owner` and `granted`), then `{type: "state", …}`. After a share change, a grant change or a command it sends `summary` again when this user's rights or `granted` changed, or closes with code 4403 when the user lost the open right; deleting the workspace closes every connection with 4404. Clients do not reconnect after these two codes.
- **Reuse:** `POST /api/workspaces {reuse: true}` (what the UI sends for `/`) returns the requester's latest workspace that has no open tab and was not handed out in the last 10 s, with `reused: true`, else a new one; two tabs never get the same one. `reuse` and `open` together answer 400.
- **Sharing** never widens data access: an invited user sees the shared workspace's grant while in it, and their own workspaces never gain it. Only the owner may share or delete a workspace (else 403 `not_owner`); `read` and `write` need sharing turned on (`KIPSCOPE_SHARE=on`, the default; else 403 `share_not_permitted`). `GET /api/me` reports it as `canShare`. A user has at most 200 workspaces; creating one more removes the least recently active without an open tab, or answers 409 `workspace_limit`.

## Routes

| Route | Access | Purpose | Query or body | Spec |
|---|---|---|---|---|
| `GET /api/meta` | workspace | build commit, data source (kind, database, table, reachable), catalog state; never addresses or credentials | — | [app-footer](../openspec/specs/app-footer/spec.md) |
| `GET /api/license` | public | the repo's `LICENSE` as text | — | [app-footer](../openspec/specs/app-footer/spec.md) |
| `GET /api/signals` | workspace | search the catalog, one page | `q`, `offset`, `limit` | [signal-catalog](../openspec/specs/signal-catalog/spec.md) |
| `GET /api/catalog` | workspace | the whole catalog, unpaged | — | [signal-catalog](../openspec/specs/signal-catalog/spec.md) |
| `POST /api/catalog/refresh` | workspace | reload signals from the source and the DBC files | no body | [signal-catalog](../openspec/specs/signal-catalog/spec.md) |
| `GET /api/extent` | workspace, `signal` | first and last time of a signal | `signal` | [series-query](../openspec/specs/series-query/spec.md) |
| `GET /api/series` | workspace, `signal` | points or buckets of a signal for a range, sized to the target | `signal`, `from`, `to`, `target` (default 2000) | [series-query](../openspec/specs/series-query/spec.md) |
| `GET /api/value` | workspace, `signal` | a signal's value at a time (cursor reading) | `signal`, `t`, `mode` (`line` or `step`) | [series-query](../openspec/specs/series-query/spec.md) |
| `GET /api/density` | workspace, `dataRef` | row counts of a data ref over its whole extent, drive grid and drives (time strip) | `dataRef` | [time-strip](../openspec/specs/time-strip/spec.md) |
| `GET /api/gaps` | workspace, `dataRef`, `signal` | logger gaps and periods of a data ref | `dataRef`, `signal` (repeated, at most 100) | [data-gaps](../openspec/specs/data-gaps/spec.md) |
| `GET /api/events` | workspace, `dataRef`, `signal` | events of a data ref plus the state changes of listed signals | `dataRef`, `signal` (repeated), `filter`, `from` and `to` (together) | [events](../openspec/specs/events/spec.md) |
| `POST /api/commands` | change, the command's data refs | apply one workspace command (what the UI and the CLI send) | a command `{type, …}` | [workspace-state](../openspec/specs/workspace-state/spec.md) |
| `GET /api/workspace` | workspace | the current workspace and its revision | — | [workspace-state](../openspec/specs/workspace-state/spec.md) |
| `GET /api/render-status` | workspace | current revision and each connected browser's last rendered revision, with its user | — | [workspace-state](../openspec/specs/workspace-state/spec.md) |
| `GET /api/live` | workspace | WebSocket: pushes the workspace after each accepted command; receives render acknowledgements | messages `{type: "rendered", …}` | [workspace-state](../openspec/specs/workspace-state/spec.md) |
| `GET /api/views` | user | list the requester's saved views | — | [saved-views](../openspec/specs/saved-views/spec.md) |
| `GET /api/views/:name` | user | one saved view as YAML | `download=1` for a file download | [saved-views](../openspec/specs/saved-views/spec.md) |
| `POST /api/views` | change | save the open workspace as a view (409 `view_exists` unless `overwrite`) | `title`, `note`, `name`, `overwrite` | [saved-views](../openspec/specs/saved-views/spec.md) |
| `POST /api/views/open` | change, the view's data refs | open a saved view or a view document | `{name}` or `{view}` | [saved-views](../openspec/specs/saved-views/spec.md) |
| `DELETE /api/views/:name` | user | delete a saved view | — | [saved-views](../openspec/specs/saved-views/spec.md) |
| `POST /api/views/import` | user; with `open`: change and the view's data refs (storing a layout reveals no data) | import a view from YAML text, optionally open it | `text`, `name`, `overwrite`, `open` | [saved-views](../openspec/specs/saved-views/spec.md) |
| `GET /api/me` | user | the requester: `user`, `identity` (`none`, `oidc` or the module's kind), `roles` (shown only), `canShare` | — | [user-identity](../openspec/specs/user-identity/spec.md) |
| `GET /api/workspaces` | user | the requester's own workspaces, latest activity first | — | [workspaces](../openspec/specs/workspaces/spec.md) |
| `POST /api/workspaces` | user, the view's data refs (against the new workspace's grant) | create a workspace (owner the requester, `private`, the initial grant), optionally with a view opened in it, or reuse a free one; answers `{workspace, reused?, result?}`; a failed open creates none and answers its `CommandResult`; 409 `workspace_limit`; 400 for an unknown key (e.g. `grant`) or `reuse` with `open` | `{}`, `{reuse: true}`, `{open: {name}}` or `{open: {view}}` | [workspaces](../openspec/specs/workspaces/spec.md) |
| `GET /api/workspaces/:id` | user | one workspace's summary (open right needed: 403 `forbidden`, 404 `unknown_workspace`) | — | [workspaces](../openspec/specs/workspaces/spec.md) |
| `POST /api/workspaces/:id/share` | user | set the share level (owner only: 403 `not_owner`; `read`/`write` with `KIPSCOPE_SHARE=off`: 403 `share_not_permitted`) | `{share: "private" \| "read" \| "write"}` | [workspaces](../openspec/specs/workspaces/spec.md) |
| `DELETE /api/workspaces/:id` | user | delete a workspace (owner only); its live connections close with 4404 | — | [workspaces](../openspec/specs/workspaces/spec.md) |

Access: the level of "Access levels" above, then the request fields whose data refs are checked against the workspace's grant (403 `forbidden_data`). Catalog, signals and meta answer only the granted data refs. Views are per user: a user never sees or changes another user's views.

## Error codes of identity, grants and workspaces

| Status | Code | When |
|---|---|---|
| 401 | `unauthenticated` | no credential |
| 401 | `invalid_token` | a credential the adapter refused (bad signature, expired, wrong audience, …) |
| 503 | `identity_unavailable` | the adapter could not decide (IdP or its keys unreachable) |
| 403 | `forbidden` | no open right on the workspace (private to someone else) |
| 403 | `read_only` | the workspace is shared `read` to this user |
| 403 | `forbidden_data` | a named data ref the workspace's grant does not cover |
| 403 | `not_owner` | share or delete by someone other than the owner |
| 403 | `share_not_permitted` | `read` or `write` with `KIPSCOPE_SHARE=off` |
| 404 | `unknown_workspace` | a workspace ID of the right form that names no workspace |
| 409 | `workspace_limit` | 200 workspaces, each with an open tab |
