# Proposal

## Why

The server reads exactly one ADX database (`KIPSCOPE_ADX_DATABASE`, one `KustoClient`, one table mapping). The ADX testers' feedback (comment of 2026-10-22, item M1) needs several databases of one cluster behind one KIPscope: recordings of different platforms live in different databases, and a case from the search tool may point into any of them. Today that means one server per database and no way to open a view or a catalog across them. Jan (2026-11-06): "wir müssen mit mehreren Datenbanken umgehen können".

## What Changes

- **Configuration:** `KIPSCOPE_ADX_DATABASES=a,b,c` (a list) next to today's `KIPSCOPE_ADX_DATABASE` (exactly one of the two). All databases share the table and column mapping by default; a database may override table and columns (design D3).
- **Database in the data ref (Jan's choice):** with two or more databases every data ref is qualified, `<database>:<ref>` (e.g. `prod:smart451`). It cannot be `db/ref`, because the signal ID `<dataRef>/<name>` splits at the first `/` and a data ref holds no `/`. With exactly one database nothing changes: refs stay bare, so existing views, grants, links and workspaces keep working (design D1).
- **One adapter over many databases:** an `AdxSource` per database (one `KustoClient` each, same cluster, same token, one shared query queue) behind a router that strips the database off the data ref on the way in and puts it back on the way out. Scope, `SignalRef`, `refBuckets`, `events` and the rest of the contract stay as they are; the router is the only place that knows databases (design D2).
- **Lists:** a scoped signal list reads only the scope's database; an unscoped list (catalog mode `full`) fans out to every database and merges (design D4).
- **Grants and handoff:** a grant names qualified refs exactly, so `a:car` does not cover `b:car` (no code change, now specified and tested). `KIPSCOPE_CASE_DATAREF` can carry the database as a literal prefix (`prod:{object}`); a catalog whose mapped ref names an unconfigured database is refused when it opens (design D5).
- **Meta and footer:** `/api/meta` source gains the list of databases; `database` becomes the names joined by `, ` (design D6).
- **Docs:** [data-sources.md](../../../docs/data-sources.md) variables table and a "Several databases" section; [handoff.md](../../../docs/handoff.md) one paragraph for the finder.
- ClickHouse behaviour and the data-source contract are unchanged.
- **Out of scope:** M2 (signals by logical name bound per case) is a separate later change; several clusters; per-database credentials; a database picker in the UI.

## Capabilities

### New Capabilities

none

### Modified Capabilities

- `adx-source`: configuration accepts a database list; qualified data refs, routing per database, fan-out of unscoped lists, grants by qualified ref, meta; conformance run over two databases.
- `case-handoff`: a mapped data ref that names an unconfigured database is refused on open.

## Impact

- Code: `apps/server/src/config.ts` (list, per-database mapping), `sources.ts` (build one source per database and the router), new `apps/server/src/adxRouter.ts`, `meta.ts`, `calendarDays.ts` (its cache file is written for one source/database/table), `routes/case.ts` (database check), `main.ts` log line. `adx.ts` and `kusto.ts` stay per database.
- Docs: `docs/data-sources.md`, `docs/handoff.md`, `docs/status.md`, `docs/decisions.md`.
- Tests: `apps/server/test/config.test.ts`, a router test with fake clients, `rights.test.ts`, the ADX conformance suite through the router.
- Existing deployments with one database: no change in behaviour, data refs or stored files.
- Moving a one-database deployment to two changes its data refs (`smart451` → `prod:smart451`); stored views and grants with bare refs are then refused with a message that names the qualified form (design Q-1).
