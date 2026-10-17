# Proposal

## Why

Jan (2026-10-17): „nice. before we upgrade some more we nee more user feedback archive it. Next task would be adoptability. if one wants to cennect this to azur cli as data aquisition. the interfaces shall be lean and documented"

Jan's answers to the lead (2026-10-17): „ADX via az login" (measurements live in Azure Data Explorer; KIPscope queries ADX directly; auth comes from the user's `az login`, so no secrets in KIPscope) and „Not yet, emulate" (build against the Kusto emulator in Docker with synthetic data; a real cluster comes later).

Today KIPscope reads only ClickHouse. Its `DataSource` interface (`apps/server/src/datasource.ts`) has 15 members shaped around ClickHouse (row counts from part metadata, logger gaps on a floor grid, window functions for state changes, a separate text-signal query, an events-table label), so a second source means writing all 15 and guessing their semantics from the ClickHouse code. Nothing documents how to connect a source. D-006: „The first data adapter targets ClickHouse … ADX follows behind the same adapter interface." Concept §2 and §3 name ADX and ClickHouse as the sources; concept §10: „Ein Datenadapter übersetzt Signalauswahl, Zeitraum und Zielauflösung in Abfragen für ADX beziehungsweise ClickHouse."

## What Changes

- **Lean source contract.** An adapter implements 7 required methods (`ping`, `listSignals`, `raw`, `before`, `after`, `buckets`, `refBuckets`) and a label (`info`). Seven more are optional fast paths (`count`, `extent`, `refExtent`, `refCount`, `loggerGaps`, `firstTimes`, `stateChanges`): when an adapter leaves one out, the server computes it from the required ones, with the same result. One is a capability (`events`): without it the source has no events. `textSignals` folds into `listSignals` (a `text` flag per signal) and `eventsTable` into `info`. Each fallback's cost is measured and stated (design C2).
- **ClickHouse keeps every fast path** and answers the same as today: it implements all 15 methods natively; only its method shapes follow the new contract (`raw` takes an optional limit, `refBuckets` an optional row-time flag, `listSignals` carries the text flag).
- **ADX adapter.** A second implementation in KQL over the Kusto REST API. Auth from the Azure CLI login (`az account get-access-token`, no secrets in KIPscope, A-1); `KIPSCOPE_SOURCE=adx` selects it for the whole server (A-2). Neutral default table layout (`signals`, `events`) or any stored function that returns those columns. ADX implements the optional methods whose fallback costs more than twice the native query on the measurements, and uses the fallbacks for the rest.
- **One conformance suite** for every adapter: a small portable fixture (two data refs, ~17 k rows, events), seeded into the ClickHouse test DB and the Kusto emulator; every case runs against each adapter twice, natively and with only the required methods, so fallbacks are proven equal to native answers. A third adapter author runs the same suite.
- **Emulator for tests.** Kustainer (`mcr.microsoft.com/azuredataexplorer/kustainer-linux`) runs on this machine (arm64, through Docker Desktop's amd64 emulation; evidence in design C8). It joins `docker-compose.yml` under a profile, with its own seed and test command (A-3).
- **Documentation.** `docs/data-sources.md` (English): data model, every method with semantics, the fallbacks and their cost, the conformance suite, and a step-by-step "Connect your ADX". `docs/http-api.md`: a lean table of the existing HTTP routes (none exists today; the CLI already has its reference in the README, which stays as it is).
- **Footer:** the source item reads `ADX <database>` for an ADX source; an unknown source kind shows as given. No other UI change.

### Out of scope (follow-up list)

- Several sources at once, routed per data ref (A-2 (b)); a source picker in the UI.
- Other Azure credentials (managed identity, service principal, device code), token caches on disk; `@azure/identity` unless A-1 says so.
- A check against a real ADX cluster (Jan: „Not yet, emulate"); it needs `az` installed (not on this machine today) and a cluster.
- ADX time columns as `long` nanoseconds (KIPscope reads `datetime`, 100 ns resolution); wide-table auto-mapping or schema discovery; KQL query editors.
- Writing to any source, ingestion tools, ADX result caches or materialized views (concept §2: no rollups, no second data store).
- Loading adapters from outside the repo (plugins); a third adapter itself.
- A `source` section in `kipscope.yaml` (source settings stay in the environment, like the ClickHouse ones and the credentials today).
- New features in the UI (Jan: „before we upgrade some more we nee more user feedback").

## Capabilities

### New Capabilities

- `data-source`: the contract between the server and a time-series source: data model, required and optional methods with their semantics, generic fallbacks and capabilities, bounded load through fallbacks, source selection, the shared conformance suite and the adapter guide.
- `adx-source`: the Azure Data Explorer adapter: configuration, Azure CLI credential, table layout or stored-function mapping, exact times at ADX's 100 ns resolution, errors and partial results, aborts, and the Kusto emulator for tests.
- `api-reference`: a lean, checked reference of the server's HTTP routes for people building their own clients.

### Modified Capabilities

- `app-footer`: "Server meta" (the source kind is the adapter's, `adx` for ADX) and "Automatic meta items" (`ADX <database>`, unknown kinds as given).

## Impact

- `packages/shared/src/meta.ts`: `ServerMeta.source.kind` becomes a string.
- `apps/server/src`: `datasource.ts` (contract types), new `fallbacks.ts`, `queue.ts`, `clickhouse.ts`, new `adx.ts`, `kusto.ts`, `azcli.ts`, `config.ts`, `main.ts`, `catalog.ts`, `density.ts`, `events.ts`, `meta.ts`.
- `apps/web/src/footer/items.ts`: one label.
- Tests: new `apps/server/test/conformance/`, `apps/server/scripts/seed-adx.ts`, `vitest.adx.config.ts`; conformance tables in `seed-test-db.ts`; stubs updated to the new shapes (`apps/cli/test/helpers.ts` and server tests).
- `docker-compose.yml`: an `adx` profile with the emulator (image ~1.2 GB, amd64). `apps/server/package.json`: `seed:adx`, `test:adx`.
- Docs: new `docs/data-sources.md`, `docs/http-api.md`; `README.md` links; `.env.example` source keys.
- No new npm dependency (A-1 (a)); the ADX path needs the Azure CLI on the server's PATH for a real cluster, not for the emulator.
