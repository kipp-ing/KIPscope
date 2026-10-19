# HTTP API

The routes of the KIPscope server (default `http://127.0.0.1:7310`), for your own client or to connect KIPscope to other tools. The UI and the CLI use the same routes; the CLI reference is in the [README](../README.md#cli). Payload types live in `packages/shared/src`; each route's fields, answers and errors are in the spec named in the table. Data sources: [data-sources.md](data-sources.md).

## Shared rules

- **Local access only** ([server-access](../openspec/specs/server-access/spec.md)): a request is answered only when its `Host` names `localhost`, `127.0.0.1` or `[::1]` (any port), or the configured non-loopback `KIPSCOPE_HOST`; otherwise 403 `forbidden_host`. A request with an `Origin` must be `http`/`https` with such a host; otherwise (`null` included) 403 `forbidden_origin`. Requests without `Origin` (curl, the CLI) pass. The live channel's upgrade follows the same rules. There is no authentication.
- **JSON bodies:** request bodies are `application/json` only; any other type, `text/plain` included, gets 415. A POST without a body is fine. Bodies up to 1 MiB (Fastify's default, else 413); a view text for import at most 256 KiB (413 `view_too_large`); a live channel message at most 256 KiB (the connection closes with 1009).
- **Times** are decimal nanoseconds since 1970-01-01T00:00:00Z as strings (`"1791158400000000000"`), in answers and in query fields; query fields also accept ISO-8601 (`2026-10-05T00:00:00Z`). Bounds lie within 1900-01-01 … 2262-04-11.
- **Signal IDs** are `<dataRef>/<name>`, e.g. `smart451/BMS.SOC`; URL-encode them in query strings.
- **Errors** answer `{"error": {"code": "...", "message": "..."}}`, sometimes with more fields (`signalId`, `reason`, the range). 400 `invalid_request` for a bad query or body; 404 for an unknown signal, data ref or view; 502 `source_error` when the database query failed.
- **Catalog not loaded:** routes that need the signal catalog answer 503 `catalog_unavailable` with `reason` (still loading, or source unreachable) until the first load succeeded.
- **Commands** answer a `CommandResult` (`{ok: true, revision, …}` or `{ok: false, code, message}`): 200, 400 `invalid_command`, 503 `catalog_unavailable`, else 422.

## Routes

| Route | Purpose | Query or body | Spec |
|---|---|---|---|
| `GET /api/meta` | build commit, data source (kind, database, table, reachable), catalog state; never addresses or credentials | — | [app-footer](../openspec/specs/app-footer/spec.md) |
| `GET /api/license` | the repo's `LICENSE` as text | — | [app-footer](../openspec/specs/app-footer/spec.md) |
| `GET /api/signals` | search the catalog, one page | `q`, `offset`, `limit` | [signal-catalog](../openspec/specs/signal-catalog/spec.md) |
| `GET /api/catalog` | the whole catalog, unpaged | — | [signal-catalog](../openspec/specs/signal-catalog/spec.md) |
| `POST /api/catalog/refresh` | reload signals from the source and the DBC files | no body | [signal-catalog](../openspec/specs/signal-catalog/spec.md) |
| `GET /api/extent` | first and last time of a signal | `signal` | [series-query](../openspec/specs/series-query/spec.md) |
| `GET /api/series` | points or buckets of a signal for a range, sized to the target | `signal`, `from`, `to`, `target` (default 2000) | [series-query](../openspec/specs/series-query/spec.md) |
| `GET /api/value` | a signal's value at a time (cursor reading) | `signal`, `t`, `mode` (`line` or `step`) | [series-query](../openspec/specs/series-query/spec.md) |
| `GET /api/density` | row counts of a data ref over its whole extent, drive grid and drives (time strip) | `dataRef` | [time-strip](../openspec/specs/time-strip/spec.md) |
| `GET /api/gaps` | logger gaps and periods of a data ref | `dataRef`, `signal` (repeated, at most 100) | [data-gaps](../openspec/specs/data-gaps/spec.md) |
| `GET /api/events` | events of a data ref plus the state changes of listed signals | `dataRef`, `signal` (repeated), `filter`, `from` and `to` (together) | [events](../openspec/specs/events/spec.md) |
| `POST /api/commands` | apply one workspace command (what the UI and the CLI send) | a command `{type, …}` | [workspace-state](../openspec/specs/workspace-state/spec.md) |
| `GET /api/workspace` | the current workspace and its revision | — | [workspace-state](../openspec/specs/workspace-state/spec.md) |
| `GET /api/render-status` | current revision and each connected browser's last rendered revision | — | [workspace-state](../openspec/specs/workspace-state/spec.md) |
| `GET /api/live` | WebSocket: pushes the workspace after each accepted command; receives render acknowledgements | messages `{type: "rendered", …}` | [workspace-state](../openspec/specs/workspace-state/spec.md) |
| `GET /api/views` | list the saved views | — | [saved-views](../openspec/specs/saved-views/spec.md) |
| `GET /api/views/:name` | one saved view as YAML | `download=1` for a file download | [saved-views](../openspec/specs/saved-views/spec.md) |
| `POST /api/views` | save the open workspace as a view (409 `view_exists` unless `overwrite`) | `title`, `note`, `name`, `overwrite` | [saved-views](../openspec/specs/saved-views/spec.md) |
| `POST /api/views/open` | open a saved view or a view document | `{name}` or `{view}` | [saved-views](../openspec/specs/saved-views/spec.md) |
| `DELETE /api/views/:name` | delete a saved view | — | [saved-views](../openspec/specs/saved-views/spec.md) |
| `POST /api/views/import` | import a view from YAML text, optionally open it | `text`, `name`, `overwrite`, `open` | [saved-views](../openspec/specs/saved-views/spec.md) |
