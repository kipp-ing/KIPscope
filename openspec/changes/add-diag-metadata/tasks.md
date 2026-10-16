# Tasks

Every task has its own files; all build in one round against the interfaces pinned in design M1–M7. Group 1 lands the types the others import; engineers of group 2 may stub them until it is in. The tester writes group 4 test-first, in parallel. No `apps/web` task: units already drive axes; the web is checked by the UI user only. Group 5 is the lead's.

- 1.1: `packages/shared/src/signals.ts`
- 2.1: `apps/server/src/diag.ts` (new), `apps/server/package.json`, `pnpm-lock.yaml`
- 2.2: `apps/server/src/config.ts`, `catalog.ts`, `main.ts`, `.env.example`
- 4.1: `apps/server/test/diag.test.ts` (new), `config.test.ts`, `catalog.test.ts`, `signals.http.test.ts`, `testdb.ts`, `fixtures/test-diag.manifest.json` (new), `fixtures/test-diag.names.toml` (new)
- 5.1: `README.md`

## 1. packages/shared

- [ ] 1.1 Types (M1): `DiagScaleRow`, `DiagInfo`, `SignalInfo.diag?`, exported from the package index. Verify: `pnpm --filter @kipscope/shared build`.

## 2. apps/server/src

- [ ] 2.1 Diagnostic catalog reader (M3, M7): add `smol-toml` (exact version); new `diag.ts` with `DiagSignal`, `parseDiagCatalog` (zod shape, names resolution, element names, rows, kind, warnings) and `loadDiagCatalogs` (names path, per-file errors, earlier catalog wins). Verify: scenarios "Fixture names", "Real catalog names", "Fixture details", "Earlier catalog wins", "Bad names entries", "Missing names file, broken manifest".
- [ ] 2.2 Config and catalog (M2, M4, M5): `Config.diagCatalogs`, `DEFAULT_DIAG_CATALOGS`, `KIPSCOPE_DIAG_CATALOGS`; `Catalog` fifth argument `loadDiag`, merge (unit, `diag`, no SNA), DBC-wins warning per load with the `diag catalog: ` prefix; `main.ts` wiring; commented line in `.env.example`. Verify: scenarios "Config", "Merged into the catalog", "DBC wins", "Server starts without the catalog", "Signal not in any metadata file", "Diag metadata over HTTP", then after a server restart "Unit counts on carserver" (curl).

## 4. Tests

- [ ] 4.1 Server tests and fixtures (M6): fixture pair exactly as M6; `testdb.ts` exports `testDiagCatalogs`; new `diag.test.ts` ("names fields like the decoder", "carries unit, kind, states and invalid rows", "keeps the earlier catalog's signals", "ignores bad names entries with a warning", "skips missing and foreign manifests, falls back without names file", "reads the real bms-live catalog" with `it.skipIf` when the file is missing); `config.test.ts` (both defaults/overrides tests extended); `catalog.test.ts` ("merges diag catalog metadata", "DBC wins over a diag catalog and warns once per load", "logs diag catalog warnings once per load"; the test-DB catalog gets `testDiagCatalogs`, its existing `toEqual`s unchanged); `signals.http.test.ts` (new describe "diag catalog over HTTP" › "returns diag metadata", stub source). Verify: `pnpm --filter @kipscope/server test`.

## UI check (UI user, no task)

- Scenario "Cell voltages share one axis" on smart451 after the lead restarts the server with the change.

## 5. Docs (lead)

- [ ] 5.1 README: `KIPSCOPE_DIAG_CATALOGS` next to `KIPSCOPE_DBC_FILES` (what is read, names file next to the manifest, DBC wins, warnings). Verify: `grep -n "KIPSCOPE_DIAG_CATALOGS" README.md .env.example`.

## Workflow follow-up

- On archive: copy the ledger entry of design.md into `docs/decisions.md`.
