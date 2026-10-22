# Tasks

Built on the recommendations of design.md Q-1 (ADX only), Q-2 (unscoped list too) and Q-3 (`unit from the table`); if Jan picks an alternative, the spec owner revises before round 1.

No `packages/shared`, HTTP payload, CLI, ClickHouse adapter or conformance fixture change. The interfaces two groups share are pinned in design.md ("Pinned interfaces": `TableMapping.unit`, `TableMapping.snaTexts`, `SourceSignal.unit`), so groups 1, 2, 3 and the tester's group 5 run in parallel; group 1 adds the two `TableMapping` fields and group 2 the `SourceSignal` field first thing, the other group compiles against the pinned shape.

Write areas (disjoint per group):

- 1.x: `apps/server/src/config.ts`, `apps/server/src/catalog.ts`, `docs/data-sources.md`, `.env.example`
- 2.x: `apps/server/src/adx.ts`, `apps/server/src/datasource.ts`
- 3.x: `apps/web/src/explorer/format.ts`
- 5.x: `apps/server/test/`, `apps/server/scripts/seed-adx.ts`, `apps/web/test/explorer.test.ts` (tester)

## 1. apps/server/src: config, catalog, docs

- [ ] 1.1 `config.ts`: `TableMapping.unit` and `TableMapping.snaTexts` as pinned; read `KIPSCOPE_COLUMN_UNIT` (identifier, empty = absent) and `KIPSCOPE_SNA_TEXTS` (design R1: split, trim, drop empty and repeats, absent when empty); throw `<VAR>: only with KIPSCOPE_SOURCE=adx` for either with ClickHouse; keys absent, not `undefined`, when unset. Verify: scenario "Row metadata variables" (`config.test.ts` › "reads the ADX row metadata settings"); existing `config.test.ts` green.
- [ ] 1.2 `catalog.ts`: after DBC and diag, `info.unit ??= listed unit` (design R5); comment on the group lookup ("metadata is keyed by name") stays true for DBC/diag and names the per-data-ref table unit. Verify: scenarios "Unit from the table", "Table unit never overrides" (`catalog.test.ts`); "Signal not in any DBC" unchanged.
- [ ] 1.3 `docs/data-sources.md`: the two variables in "All variables" (Source `adx`, default none, rules of R1, the missing-column rules of R2); `listSignals` row of the interface table and the data model's "Text" bullet name `unit` and that SNA texts do not count as text; the SNA rules name SNA texts (ADX only, exact, case-sensitive, row-based methods count the rows); "Connect your ADX" mentions `take_anyif` and both variables. `.env.example`: both variables commented with an example (`# KIPSCOPE_COLUMN_UNIT=unit`, `# KIPSCOPE_SNA_TEXTS=SNA,INVLD`) and "ADX only". Verify: scenario "Guide documents the row metadata" (`docs.test.ts`).

## 2. apps/server/src: ADX adapter

- [ ] 2.1 `datasource.ts`: `SourceSignal.unit` as pinned; the `listSignals` comment of `SourceAdapter` names `unit` and that SNA texts are not text. Verify: `pnpm --filter @kipscope/server build` (type check).
- [ ] 2.2 `adx.ts` `listSignals`: the pinned query of design R2 (text flag without SNA texts, `take_anyif` unit, `snat` parameter only when set), the three fallbacks on a missing text column (error with the pinned message when `snaTexts` is set; unit-only summarize; today's `distinct`), units trimmed, empty → no key. Verify: scenarios "Unit in the signal list query", "Units on the emulator", "Missing text column with row metadata"; existing `adxQueries.test.ts` and "treats a missing events table and text column as none" green.
- [ ] 2.3 `adx.ts` SNA predicate: `isSna` becomes a method (design R3) with the ranges part and `tostring(<text>) in (snat)`; `snat` (type `dynamic`) added to the params of `raw`, `edge`, `series`, `buckets`, `stateChanges` exactly when `snaTexts` is set; without it every query text and parameter set as today. Verify: scenarios "SNA list as a parameter", "Sentinels on the emulator", "Native series with sentinels answers as the fallback does", state-names "No state name on a sentinel row"; ADX conformance run (`test:adx`) green.

## 3. apps/web/src: hover card source line

- [ ] 3.1 `explorer/format.ts` `formatSource`: no `dbc`, no `diag`, `unit` → `<dataRef> · unit from the table` (design R6); doc comment updated. Verify: scenario "Card formatting rules" (`explorer.test.ts` › "formats the source line"); `pnpm lint`.

## 4. packages/shared

None (design R8).

## 5. Tests (tester, test-first from the specs)

- [ ] 5.1 `apps/server/scripts/seed-adx.ts`: table `KMeta` (design R7: schema, 22 rows, drop-and-refill with the others) and the two spot checks; header comment lists `KMeta`. Verify: scenario "Row metadata table seeded" (command output).
- [ ] 5.2 `config.test.ts` › "reads the ADX row metadata settings" (cases a–f).
- [ ] 5.3 `catalog.test.ts` › "takes the table unit when no DBC or diag unit exists" (stub source and DBC loader of "Unit from the table", fixture diag catalog, refreshed twice, warnings checked).
- [ ] 5.4 `adxQueries.test.ts` (recording fake): "reads the unit in the signal list query", "passes the SNA texts to every value query", "falls back without the text column" (fake answers SEM0100 naming the text column to the first query).
- [ ] 5.5 `adx.test.ts` (emulator): "reads units from the table per data ref", "treats SNA texts as SNA in every value query" (incl. the `textLabel` check of state-names), "answers KMeta series requests as the fallback does", "treats a missing text column with row metadata", "builds the catalog from the table's units and sentinels".
- [ ] 5.6 Conformance suite › "lists signals with their text flag": add `listed.every((s) => !("unit" in s))` (data-source "No unit without a unit column").
- [ ] 5.7 `docs.test.ts` › "documents the row metadata" (the checks of "Guide documents the row metadata").
- [ ] 5.8 `apps/web/test/explorer.test.ts` › "formats the source line": add unit only → `smart451 · unit from the table`; unit with `dbc` → `smart451 · DBC`; unit with a diag field → the diag line.
- [ ] 5.9 Run `pnpm build && pnpm test && pnpm lint`, and with the emulator `seed:adx` then `test:adx`; report per scenario of the delta specs pass, fail or not_run (the emulator ones `not_run` if the emulator is down, never pass).

## 6. Lead's check and UI check

- [ ] 6.1 Lead: scenario adx-source "Server on the emulator" (second server on 7311 with `KIPSCOPE_TABLE=KMeta`, `KIPSCOPE_COLUMN_UNIT=unit`, `KIPSCOPE_SNA_TEXTS=SNA,INVLD`, `KIPSCOPE_WEB_DIR=apps/web/dist` after `pnpm build`); the two `curl` outputs.
- [ ] 6.2 UI user: scenario "Card for a table unit" on that server; one screenshot. Regression by eye on carserver (port 7310): "Card for SPEED_DISP" source line still `smart451 · h-can.dbc`.

## 7. Crash guard

- [ ] 7.1 `pnpm build`, `pnpm smoke` against the running Vite and `pnpm smoke --preview`: pass.

## Out of scope

M1 (several databases), M2 (logical signal names); unit or SNA texts on ClickHouse; description, range, cycle or value tables from the table; a metadata file or aliases (D-099); metadata of signals without rows in the scope (D-096 backlog); SNA texts in the hover card or elsewhere in the UI; case-insensitive or trimmed text matching; resolving disagreeing units within one signal; any `packages/shared`, HTTP payload, CLI, `clickhouse.ts`, conformance fixture or `seed-test-db.ts` change.
