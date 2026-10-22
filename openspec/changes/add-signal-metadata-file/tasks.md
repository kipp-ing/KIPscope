# Tasks

The interfaces two groups share are pinned in design.md: shared types and helpers (F4), `metadata.ts` and the `Catalog` parameter (F5), the format functions of the card (F7), the fixtures (F9). So groups 1–5 run in parallel; a group stubs a pinned import until its owner lands. Every round that touched `apps/web` or `packages/shared` ends with the UI user (group 6) and the crash guard (group 7). Open questions Q1–Q3 (design) are answered as recommended unless the lead says otherwise.

Write areas (disjoint per group):

- 1.x: `packages/shared/src/`
- 2.x: `apps/server/src/metadata.ts` (new), `apps/server/src/config.ts`
- 3.x: `apps/server/src/catalog.ts`, `apps/server/src/main.ts`
- 4.x: `apps/web/src/explorer/`
- 5.x: `docs/`, `README.md`, `.env.example`
- tests: `*/test/`, `apps/server/test/fixtures/` (tester)

## 1. packages/shared

- [ ] 1.1 `signals.ts`: `SnaSource` `"metadata"`, `SnaValue.raw` optional, `SignalDetails`, `MetaInfo`, `SignalInfo.meta`, `detailsOf` exactly as pinned in F4; comments on `sna` and `dbc` updated. Verify: `pnpm build` (type errors in readers of `SnaValue.raw` are fixed by their groups).
- [ ] 1.2 `states.ts`: `labelTolerance`, `isSnaValue`, `valueLabels` read `detailsOf(info)` (F4). Verify: scenario "Value labels and SNA in shared helpers"; existing `states.test.ts` green.
- [ ] 1.3 `gaps.ts`: `PeriodSource` `"metadata"`, `staticPeriod` dbc → meta → diag (F4). Verify: scenario "Period from a metadata file"; existing `gaps.test.ts` green.

## 2. apps/server/src: metadata.ts and config.ts

- [ ] 2.1 `metadata.ts`: `MetadataSignal`, `parseMetadataFile` with the F1 rules (validation, `null`/blank/empty as absent, trimming, sorting, SNA dedupe, `sources: ["metadata"]`) and the entry warnings of F5 (aggregated per kind, at most 10 names). Verify: scenarios "Fixture entries", "Null and empty fields", "Bad entries", "Example reads cleanly".
- [ ] 2.2 `metadata.ts`: `metadataLoader(paths)`: priority order, earlier file wins with one warning, file skips of F5, cache by mtimeMs and size that re-reports the cached warnings. Verify: scenarios "Unusable files and the earlier file wins", "Unchanged, then changed".
- [ ] 2.3 `config.ts`: `metadataFiles` from `KIPSCOPE_METADATA_FILES` via `pathList`, default `[]` (F2). Verify: scenario "Config".

## 3. apps/server/src: catalog.ts and main.ts

- [ ] 3.1 `catalog.ts`: seventh constructor parameter `loadFiles` (F5) in the load's `Promise.all`, warnings prefixed `metadata file: `; per name DBC → metadata file → diag, first wins whole (F6); a metadata entry sets `unit`, `description`, `meta`, `sna`, and SNA ranges `value ± labelTolerance(info)` (F3); the two new precedence warnings of F6. Verify: scenarios "Unit and description from a metadata file", "SNA ranges from a metadata file", "Three sources", "One entry for every data ref", "Server starts without the file", "Signal not in any DBC" (unchanged `toEqual`), "Metadata over HTTP".
- [ ] 3.2 `main.ts`: one `metadataLoader(config.metadataFiles)` passed to the full and every scoped catalog (F5). Verify: scenario "Card from a metadata file on real data" (UI user); `pnpm build`.

## 4. apps/web/src/explorer

- [ ] 4.1 `format.ts`: `formatMessage`, `formatSnaLine` as pinned in F7; `formatSource` with the `meta` branch and `no metadata`; doc comment updated. Verify: scenarios "Card formatting rules", "Card lines of a metadata-file signal".
- [ ] 4.2 `SignalCard.tsx`: details from `detailsOf(signal)`; Message line from `formatMessage` (none when undefined), SNA lines from `formatSnaLine`; nothing else changes. Verify: scenarios "Card for SPEED_DISP", "Card with offset", "Card from a metadata file on real data" (UI user).

## 5. Docs

- [ ] 5.1 `docs/signal-metadata.md` and `docs/signal-metadata.example.json` as F8 (example values pinned there); a section "Signal metadata" in `docs/handoff.md` linking the guide; README metadata paragraph (next to the diagnostic catalog paragraph) linking it; `docs/data-sources.md` env row `KIPSCOPE_METADATA_FILES` (default none); `.env.example` line; `docs/http-api.md` refresh row (F8). Verify: scenarios "Linked and complete", "Documented variable", "Example reads cleanly"; `apps/server/test/docs.test.ts` › "documents every HTTP route" stays green.

## 6. Tests (tester, test-first from the specs)

- [ ] 6.1 Fixtures `apps/server/test/fixtures/test-metadata.json` and `ui-metadata.json` exactly as F9.
- [ ] 6.2 `apps/server/test/metadata.test.ts` (new): "reads the fixture entries", "treats null, blank and empty fields as absent", "ignores bad entries with one warning per kind", "skips unusable files, the earlier file wins", "reads a file again only when it changed", "reads the documented example without warnings".
- [ ] 6.3 `apps/server/test/catalog.test.ts`: "merges metadata file entries", "takes SNA ranges from a metadata file", "DBC, then metadata file, then diag catalog", "applies a metadata file entry to every data ref", "logs metadata file warnings once per load" ("merges metadata file entries" also lists `car/Nodbc_500h.RAW`, name only). Do not add the metadata fixture to the shared "Catalog (test DB)": the test DB holds `Fast_100h.SIG_C` and `gapcar/TBMS.current`, whose existing expectations would change.
- [ ] 6.4 `apps/server/test/series.test.ts` › "nulls the SNA value from a metadata file"; `apps/server/test/signals.http.test.ts` › "metadata file over HTTP" › "returns metadata file details"; `apps/server/test/config.test.ts` (two tests extended); `apps/server/test/docs.test.ts` › "documents the signal metadata file".
- [ ] 6.5 `packages/shared/test/states.test.ts` › "reads labels, SNA and tolerance from a metadata file"; `packages/shared/test/gaps.test.ts` › "takes the period from a metadata file".
- [ ] 6.6 `apps/web/test/explorer.test.ts`: "formats the source line" expects `smart451 · no metadata` and the `meta` cases; new "formats the message line", "formats SNA lines with and without raw".
- [ ] 6.7 Run `pnpm build && pnpm test && pnpm lint`; report per scenario of the delta specs pass, fail or not_run.

## 7. UI check (UI user, carserver, real data)

- [ ] 7.1 Without `KIPSCOPE_METADATA_FILES`: scenarios "Card for SPEED_DISP" and "Card with offset" unchanged (one screenshot each).
- [ ] 7.2 After the lead restarted the dev server with `KIPSCOPE_METADATA_FILES=apps/server/test/fixtures/ui-metadata.json`: scenario "Card from a metadata file on real data" (one screenshot); the lead then restarts without it.

## 8. Crash guard

- [ ] 8.1 `pnpm build`, `pnpm smoke` against the running Vite and `pnpm smoke --preview`: pass.

## Out of scope

ARXML parsing, aliases, name mapping; per-session, per-vehicle or per-variant metadata; a `sender` field or grouping by it; a per-entry origin; SNA labels apart from the value table; a size limit for the files; live reload without a catalog load; writing the file (the search tool's job); signal metadata per data ref instead of per scope (D-096 backlog); any change to DBC or diagnostic catalog parsing.
