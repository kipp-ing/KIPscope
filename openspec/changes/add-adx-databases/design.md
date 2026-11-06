# Design

## Context

Source: the ADX feedback (comment of 2026-10-22, M1), D-100 consequences, Jan (2026-11-06): configuration as a list, the database part of the data ref, grants and handoff name it, one `KustoClient` per database, M2 later. Motivation: proposal.md.

Today (read before writing this design):

- `createAdapter` (`apps/server/src/sources.ts`) builds one `AdxSource` over one `KustoClient`; the database is `mapping.database` and goes into every request body (`kusto.ts`, `db:`). `AdxSource.info` carries `database`, `table`, `eventsTable`.
- `main.ts` wraps the adapter once: `completeSource(queuedAdapter(adapter, new QueryQueue(config.queryConcurrency)), …)`. So a single adapter object means a single queue, and `useQueue` gives computed series (K-12) the same queue.
- The contract takes the data ref as a plain string everywhere (`Scope.dataRef`, `SignalRef.dataRef`, `refBuckets(dataRef, …)`, `events`, `firstTimes`, `ComputedRef.dataRef`). Only `listSignals` (unscoped) and `ping` name none.
- A data ref holds no `/`: `parseSignalId` splits at the first `/`, and the shared schemas (`DataRef` in `workspace.ts`, `views.ts`, `case.ts`, `apply.ts`, `catalog.ts:303`) refuse a `/`. A database name matches `KUSTO_ENTITY` (`[A-Za-z0-9_.\- ]`), so it never holds `:` or `/`.
- Grants are exact strings (`rights.ts: covers`); the guard takes data refs from signal IDs, scopes and commands (`dataRefOf`). `calendarDays.ts` writes its cache file for `kind`, `database`, `table`. `meta.ts` and the start log print `info.database`.

## Goals / Non-Goals

**Goals:** several databases of one cluster behind the unchanged contract; every other module keeps seeing opaque data refs; a one-database deployment behaves and stores exactly as before.

**Non-Goals:** see proposal.md (M2, several clusters, per-database credentials, a UI picker). Also not: a join or computed signal across databases (a computed signal's sources must share one data ref, which already pins one database).

## Decisions

### D1 Qualified data ref `<database>:<ref>`, only with two or more databases

- Jan chose "the database is part of the data ref". The separator cannot be `/` (see Context), so `:`; split at the first `:`, which is unambiguous because a database name holds none. A ref's own text may hold `:` (it is split only once).
- With two or more databases every ref is qualified; with one it stays bare. Why: a one-database deployment must not see any change in its stored views, grants, workspaces and links; and a mixed mode ("the first database is the default and needs no prefix") would give one recording two names, which breaks exact-string grants and duplicates catalog entries.
- A bare ref with two or more databases and a qualified ref of an unconfigured database fail with `unknown_database` (400). The guard runs first on every route, so an unauthorised caller never learns which databases exist (data-access "refusals that leak nothing" stays true).
- Alternatives: a `db/ref` form would need the shared `/` rules and `parseSignalId` changed in a dozen places and in every stored file; a separate `database` field next to `dataRef` in scope, grants, views, links and the signal ID touches all of the same places and gives each of them a second key to compare.

### D2 One router adapter, one `AdxSource` per database

- New `apps/server/src/adxRouter.ts`: `class MultiDatabaseSource implements SourceAdapter` holds `Map<database, AdxSource>` in configuration order. For each call it splits the data ref of the scope, the `SignalRef`, the `dataRef` parameter or the `ComputedRef`, picks the source and passes the bare ref; for results that carry a data ref (`listSignals`, `events`' rows if they carry one, `ComputedRef` echoes) it puts the qualified ref back. Everything else in the answers (times, buckets) passes through.
- `AdxSource` and `KustoClient` stay as they are. Each `AdxSource` gets its database's mapping; the `KustoClient` already takes the database in its options. All clients share the cluster and the token provider (`azCliToken(cluster)` is built once, so one cached token and one running request, as the Azure CLI credential requirement says).
- With one database `createAdapter` returns the bare `AdxSource` as today; the router exists only for two or more (D1). Why: no code path of a deployed single-database server changes.
- The router exposes an optional method only when every member does (all are `AdxSource`, so they do), and forwards `useQueue` to every member. The one `queuedAdapter` in `main.ts` wraps the router, so all databases share one queue (`KIPSCOPE_QUERY_CONCURRENCY`, default 8). Why: the limit protects the cluster, not a database. A per-database queue would multiply the load by the number of databases.
- Alternative: a `Map` of full adapters in `main.ts` and routing in the HTTP layer would repeat the routing in every route and leave the guard and catalog with two code paths.

### D3 Mapping per database

- Shared variables give the default mapping for every database (Jan: "default shared"). A database overrides table, columns and the events table under `adx.databases.<database>` in `kipscope.yaml`, the project file that already holds per-deployment rules (display, groups, events line). Why: a database name may hold `.`, `-` and spaces, which make poor environment variable names, and a per-database override of ~10 columns does not belong in one flat variable list.
- Override keys: `table`, `eventsTable` and `columns.{dataRef,signal,time,value,text,unit}`. Everything else (`KIPSCOPE_SNA_TEXTS`, the query timeout) stays shared. A database name not in the list is a config error naming it.
- `TableMapping.database` is already per mapping, so `AdxSource` needs no change; `loadConfig` returns `mappings: Map<database, TableMapping>` next to today's `mapping` (the first database's, for the code that reads one: info, calendar cache, ClickHouse).

### D4 Lists

- Scoped list: the scope's database only. Unscoped list (catalog mode `full`): `Promise.all` over the databases; if one fails, the whole list fails with a message that names the database (a half list would silently hide a platform's signals). A scoped read of a healthy database does not touch a failing one (spec "One database down").
- The catalog gets qualified refs, so the "same signal name in two databases" case gives two entries; DBC and diagnostic metadata are still keyed by the bare name (the catalog strips the database where it already strips the data ref for these lookups; one check task).
- `ping` pings every database in parallel and fails naming the first that fails, so the footer's source item turns red when any database is unreachable.

### D5 Grants, handoff, links

- Grants need no code: refs are exact strings, so qualified refs cover exactly their database. A scenario and a test pin it.
- `KIPSCOPE_CASE_DATAREF` is a free template; `prod:{object}` already yields a qualified ref. The new check on open (`routes/workspaces.ts`, next to `invalid_catalog`) splits each mapped ref and refuses a catalog whose database is not configured, naming `cases[i]`. Why now rather than at the first query: the grant is widened before any data is read, and a grant of a ref that can never be read hides a configuration mistake.
- Saved views and `#view=` links carry qualified refs as they carry bare ones; no schema changes. A view saved under one database and opened on a multi-database server fails `unknown_database`; the message names `<database>:<ref>` (Q-1).

### D6 Meta, footer, calendar cache, log

- `SourceInfo` gains `databases: string[]`; `database` is the names joined by `, `; `table` and `eventsTable` stay those of the first database (all of them when the mappings are shared; the footer tooltip lists the databases). `meta.ts` and `main.ts` print the joined text.
- `calendarDays.ts` compares `source.database` as text, so with the joined text a changed list invalidates the cache file as a changed database does today; no format change.

## Risks / Trade-offs

- [Moving one database to two renames every ref (`smart451` → `prod:smart451`), which breaks stored views, workspaces' grants and finder links] → refusal message names the qualified form; docs state it as a migration step; a deployment that wants to avoid it keeps one server per database until it migrates the finder's template.
- [Fan-out on unscoped lists multiplies catalog load time by the slowest database] → only catalog mode `full` fans out; the default `scoped` mode reads one database; the fan-out is parallel.
- [A database with a different table layout than the shared one silently returns no rows] → the override is explicit in `kipscope.yaml`; the start log prints each database's table; the emulator conformance run covers an override.
- [`:` in a data ref's own text, e.g. `prod:a:b`] → split at the first `:` only; a test pins it.
- [The Kusto emulator may not host a second database] → task 6.1 checks it first; if it does not, the router conformance runs both names against one emulator database through fake client wiring and says so (as `not_run` for the emulator part, not `pass`).

## Migration Plan

1. Configure `KIPSCOPE_ADX_DATABASES` (or keep `KIPSCOPE_ADX_DATABASE`: nothing changes).
2. For two or more databases: change the finder's `KIPSCOPE_CASE_DATAREF` to `<database>:{object}` (or per-database templates once M2 lands), grant the qualified refs, re-save views that used bare refs.
3. Rollback: set one database again; refs are bare again; qualified views are refused with the message of D1.

## Open Questions

- **Q-1 Bare refs on a multi-database server:** default is refusing with `unknown_database` and a hint. If Jan wants old views to keep opening, a later change can add `KIPSCOPE_ADX_DEFAULT_DATABASE` that qualifies bare refs on read; deferred because it gives one recording two names (D1).
- **Q-2 Place of the override:** `kipscope.yaml` `adx.databases.<database>` is the default; if the ADX testers prefer one environment variable per database (`KIPSCOPE_ADX_<NAME>_TABLE`), only the config reader changes, no spec text.
