# Proposal

## Why

On ADX every signal's hover card reads `· no DBC entry`: KIPscope reads metadata only from DBC files and diagnostic catalogs keyed by the source name, while the search tool computes its metadata for all vehicle variants from different base ARXMLs through an alias catalog that ADX does not have. Metadata is not cosmetic: SNA values turn values into gaps in the queries, value tables give state names, units decide the shared y axes. Jan decided (D-099): KIPscope reads a third source, plain metadata files keyed by the source (ADX) signal name, one entry per name, in a format KIPscope defines and documents; the search tool writes it. A signal without any metadata reads `no metadata`.

## What Changes

- **New source:** `KIPSCOPE_METADATA_FILES` (comma list of paths, default empty) names JSON metadata files `{"kipscope": "signal-metadata", "version": 1, "signals": [...]}`, one entry per source signal name: unit, description, value table, SNA values as physical values, optional factor/offset, range, cycle time, message name and ID. Read on every catalog load; a file that did not change is not parsed again.
- **Catalog:** an entry applies to its name under every data ref (one entry for all variants, D-099). A signal from a metadata file carries `unit`, `description`, `sna` and a new `meta` field (pinned in design F4); its SNA values become SNA ranges for the series queries like a DBC's.
- **Precedence:** DBC files, then metadata files in list order, then diagnostic catalogs; the first source wins whole; one warning per load and per losing source.
- **Problems** never stop the server or a load: unusable files are skipped, bad entries ignored, each problem warned once per load.
- **Hover card:** shows a metadata-file signal's message, scaling, range, SNA values (raw only where given), value table and the file as source; a signal without any metadata reads `<dataRef> · no metadata` (was `· no DBC entry`).
- **Period:** a metadata file's `cycleMs` is the signal's period, `source` `"metadata"` in `/api/gaps`.
- **Docs:** `docs/signal-metadata.md` documents the format for the file's writer, with the example file `docs/signal-metadata.example.json`; linked from `docs/handoff.md` and the README.

## Non-goals

- Parsing ARXML, aliases, or any name mapping (D-099).
- Per-session, per-vehicle or per-variant metadata (D-099: "Per-name metadata stays global").
- A sender field and grouping by it for metadata-file signals; a per-entry origin (e.g. the ARXML the entry came from).
- Signal metadata per data ref instead of per scope (D-096 backlog), live reload without a catalog load, a size limit for the files.
- Writing the file: that is the search tool's job.

## Capabilities

### New Capabilities

- `signal-metadata-file`: the metadata file format, its configuration, how entries and problems are read, and its documentation for the writer.

### Modified Capabilities

- `signal-catalog`: "Signal metadata" (third source), "SNA values per signal" (SNA from a metadata file), "Metadata source precedence" (three sources), "Signal hover card" (metadata-file lines, `no metadata` label).
- `data-gaps`: "Period of a signal" (cycle time from a metadata file, source `metadata`).

## Impact

- `packages/shared/src/signals.ts` (`SnaValue.raw` optional, `SnaSource` `"metadata"`, `SignalDetails`, `MetaInfo`, `SignalInfo.meta`, `detailsOf`), `packages/shared/src/states.ts` (`labelTolerance`, `isSnaValue`, `valueLabels` via `detailsOf`), `packages/shared/src/gaps.ts` (`PeriodSource` `"metadata"`, `staticPeriod`).
- `apps/server/src/metadata.ts` (new: parse and load), `apps/server/src/catalog.ts` (third loader, precedence, SNA ranges), `apps/server/src/config.ts` (`metadataFiles`), `apps/server/src/main.ts` (wiring).
- `apps/web/src/explorer/format.ts` (`formatSource`, `formatMessage`, `formatSnaLine`), `apps/web/src/explorer/SignalCard.tsx`.
- Docs: `docs/signal-metadata.md`, `docs/signal-metadata.example.json`, `docs/handoff.md`, `docs/data-sources.md` (env table), `docs/http-api.md` (refresh row), README, `.env.example`.
- HTTP: `/api/signals` and `/api/catalog` items may carry `meta`; `/api/gaps` `periods[].source` may be `"metadata"`. No new route.
