# Tasks

Built on the defaults of design.md Q-1 (bare refs refused on a multi-database server) and Q-2 (per-database overrides in `kipscope.yaml`); if Jan picks an alternative, the spec owner revises before round 1.

No ClickHouse adapter, `AdxSource`, `KustoClient`, `parseSignalId` or HTTP-route change except where a task below says so. Interfaces the groups share (pinned here so they can run in parallel): `Config.databases: string[]` and `Config.mappings: Map<string, TableMapping>` (config.ts); `splitDataRef(ref, databases): {database, ref}` and `qualifyDataRef(database, ref)` in `apps/server/src/adxRouter.ts`; `SourceInfo.databases?: string[]` (datasource.ts); `SourceMeta.databases?: string[]` (packages/shared/src/meta.ts).

Write areas (disjoint per group):

- 1.x: `apps/server/src/config.ts`, `apps/server/src/project.ts`, `docs/data-sources.md`, `.env.example`
- 2.x: `apps/server/src/adxRouter.ts` (new), `apps/server/src/sources.ts`, `apps/server/src/datasource.ts`
- 3.x: `apps/server/src/meta.ts`, `apps/server/src/main.ts`, `apps/server/src/calendarDays.ts`, `apps/server/src/routes/workspaces.ts`, `packages/shared/src/meta.ts`, `apps/web/src/footer/`, `docs/handoff.md`
- 4.x: `apps/server/test/`, `apps/server/scripts/seed-adx.ts` (tester)

## 1. Configuration

- [ ] 1.1 `config.ts`: read `KIPSCOPE_ADX_DATABASES` next to `KIPSCOPE_ADX_DATABASE` (exactly one of the two; trim, drop blanks, reject repeats and names failing `KUSTO_ENTITY`; ignored with ClickHouse); `Config.databases` and `Config.mappings` as pinned, `mapping` stays the first database's. Verify: scenario "The database list" (`config.test.ts` › "reads the ADX database list") and the unchanged "reads the ADX settings".
- [ ] 1.2 Per-database overrides: `project.ts` reads `adx.databases.<database>.{table,eventsTable,columns.*}` from `kipscope.yaml`; `loadConfig` (or `createAdapter`, whichever sees the project file; decide in the task and note it in the design) merges them over the shared mapping and refuses a name that is not in the list. Verify: scenario "Override" (`config.test.ts` › "maps each database").
- [ ] 1.3 `docs/data-sources.md` and `.env.example`: the two variables in "All variables", a "Several databases" section (qualified refs, shared queue, overrides, migration steps of design "Migration Plan"). Verify: every new variable appears in the table and the section's example config loads with `loadConfig` (a docs test already checks the variables table; extend it if it does not cover ADX).

## 2. Router adapter

- [ ] 2.1 `adxRouter.ts`: `splitDataRef`, `qualifyDataRef` and `MultiDatabaseSource` (design D2): every contract method routes by the data ref of its scope, `SignalRef`, `dataRef` parameter or `ComputedRef`; results carry qualified refs; `unknown_database` (400) for bare or unknown databases with the message of the spec; `useQueue` forwarded to every member; optional methods present only when every member has them. Verify: scenarios "Qualified and bare refs", "Routing" and "One database keeps bare refs" (`adxRouter.test.ts` with fake `KustoClient`s).
- [ ] 2.2 Lists and ping: unscoped `listSignals` in parallel over all databases and merged in configuration order, failures naming the database; scoped lists touch only the scope's database; `ping` over all, naming the first that fails. Verify: scenarios "Merge" and "One database down".
- [ ] 2.3 `sources.ts`: one `AdxSource` and `KustoClient` per database sharing one token provider; the router only with two or more databases, the bare `AdxSource` otherwise (design D2). Verify: with one database `createAdapter` returns an `AdxSource` (`adxRouter.test.ts` › "does not qualify with one database"); one `azCliToken` call per cluster.
- [ ] 2.4 Queue: confirm that `queuedAdapter` around the router limits in-flight queries across databases and that computed series go through the same queue. Verify: scenario "Shared queue".

## 3. Server and web: info, handoff, grants

- [ ] 3.1 `datasource.ts` / `packages/shared/src/meta.ts` / `meta.ts` / `main.ts`: `databases` in `SourceInfo` and the meta `source`; `database` is the joined text; start log shows it. `calendarDays.ts`: nothing to change but the test that a different joined text invalidates the cache. Verify: scenario "Meta" (`meta.http.test.ts` › "names every database") and `calendarDays.test.ts` › "ignores a file written for other databases".
- [ ] 3.2 `routes/workspaces.ts`: refuse a signed catalog whose mapped data ref names an unconfigured database with `invalid_catalog` naming `cases[i]`, only with two or more databases. Verify: scenario "Unknown database in a catalog" (`case.http.test.ts` › "checks the database of a mapped data ref").
- [ ] 3.3 Grants: no code; pin the behaviour. Verify: scenario "Same ref in two databases" (`rights.test.ts` › "covers qualified data refs by grant") and a guard test that an unknown database answers `forbidden_data` before `unknown_database` can leak it.
- [ ] 3.4 `apps/web/src/footer/`: check that the source item shows `ADX prod, test` and that the tooltip lists the databases one per line; a signal ID with `prod:car1/A` renders in the hover card source line, search and values window without cutting at `:`. Verify: `pnpm --filter @kipscope/web test` with a qualified-ref case in `footer` and `explorer` tests; no web code change if they pass.
- [ ] 3.5 `docs/handoff.md`: one paragraph for the finder (`KIPSCOPE_CASE_DATAREF=<database>:{object}`, the refusal, M2 follows). Verify: the paragraph names the variable and the error code.

## 4. Tests and evidence

- [ ] 4.1 Check whether the Kusto emulator can host a second database (docs/data-sources.md "Try it on the emulator"); record the answer in `docs/status.md`. Verify: the command used and its output are in the round's evidence.
- [ ] 4.2 `conformance/adx-databases.conformance.test.ts`: the suite through the router over two databases (spec "Conformance over two databases"); if 4.1 says the emulator cannot, run it against one database under both names via the fake wiring and report the emulator part as `not_run`. Verify: `pnpm --filter @kipscope/server test` green; the report names which variant ran.
- [ ] 4.3 Edge cases in `adxRouter.test.ts`: a ref with its own `:` (`prod:a:b`), a database name with `.` and space, a computed signal across one database, events of one database only. Verify: the four tests pass.
- [ ] 4.4 Integration: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm smoke`; one server on the emulator (or fakes) with `KIPSCOPE_ADX_DATABASES=a,b` opens a scope `a:<ref>`, shows the footer text and lists signals; one with `KIPSCOPE_ADX_DATABASE=a` behaves as before. Verify: the script outputs are in the round's evidence; anything not run is `not_run`.

## Workflow follow-up

- Archive after Jan's OK; copy D1 … D6 into `docs/decisions.md` (archive guidance of `openspec/config.yaml`) and update `docs/status.md` (M1 done; M2 next, separate change).
