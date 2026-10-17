# Tasks

Written for A-1 (a), A-2 (a), A-3 (a) (design "Questions for Jan"); the lead confirms with Jan before round 1. All interfaces are pinned in design C1–C10, so every task below can run in one round in parallel; an engineer stubs a type from another task until it lands. The tester writes group 6 test-first from the specs and design C7. A second round only for findings.

Write areas (disjoint):

- 1.1: `packages/shared/src/meta.ts`
- 2.1: `apps/server/src/datasource.ts`, `fallbacks.ts` (new), `queue.ts`
- 2.2: `apps/server/src/catalog.ts`, `density.ts`, `events.ts`, `meta.ts`, `series.ts`
- 2.3: `apps/server/src/clickhouse.ts`
- 2.4: `apps/server/src/config.ts`, `sources.ts` (new), `main.ts`, `.env.example`
- 3.1: `apps/server/src/kusto.ts`, `azcli.ts` (new)
- 3.2: `apps/server/src/adx.ts` (new)
- 4.1: `apps/web/src/footer/items.ts`
- 5.1: `docs/data-sources.md` (new)
- 5.2: `docs/http-api.md` (new), `README.md`
- 6.1: `apps/server/test/conformance/fixture.ts`, `suite.ts`, `clickhouse.conformance.test.ts` (new), `apps/server/scripts/seed-test-db.ts`, `apps/server/test/globalSetup.ts`
- 6.2: `docker-compose.yml`, `apps/server/package.json` (scripts), `apps/server/vitest.config.ts`, `vitest.adx.config.ts`, `scripts/seed-adx.ts`, `test/adxGlobalSetup.ts`, `test/conformance/adx.conformance.test.ts`, `test/adx.test.ts` (new)
- 6.3: `apps/server/test/fallbacks.test.ts`, `kusto.test.ts`, `azcli.test.ts`, `docs.test.ts` (new), `config.test.ts`
- 6.4: `apps/server/test/catalog.test.ts`, `density.test.ts`, `density.http.test.ts`, `gaps.test.ts`, `queue.test.ts`, `events.test.ts`, `events.http.test.ts`, `meta.http.test.ts`, `series.abort.test.ts`, `testdb.ts`, `viewsApp.ts`, `apps/cli/test/helpers.ts`
- 6.5: `apps/web/test/footer.test.ts`

## 1. packages/shared

- [ ] 1.1 `ServerMeta.source.kind` becomes `string` (C10). Verify: `pnpm --filter @kipscope/shared build`.

## 2. apps/server/src: contract and ClickHouse

- [ ] 2.1 Contract and fallbacks (C1–C3): `SourceAdapter`, `DataSource = Required<SourceAdapter>`, `SourceSignal`, `RefBucket`, `LoggerGaps`, `SourceInfo` in `datasource.ts`; `completeSource`, `coreOnly`, `nativeMethods`, `ScanLimitError`, `STATE_SCAN_PAGE`, `STATE_SCAN_MAX` with every fallback of the C2 table in `fallbacks.ts`; `queuedAdapter` (present methods queued, `ping`/`info` unqueued) replaces `queuedSource` in `queue.ts`. Verify: `pnpm --filter @kipscope/server build`; scenarios "Same answers natively and from the core", "No query for no names", "Queue holds for a fallback fan-out", "Abort stops a fallback", "Scan cap".
- [ ] 2.2 Consumers (C1, C2, C10): `catalog.ts` reads `text` from `listSignals` (no `textSignals` call) and skips entries with an empty data ref, a `/` in it, or an empty name, one warning per load; `density.ts` calls `refBuckets(…, false)`; `events.ts` takes the label from `info.eventsTable` and maps `ScanLimitError` to `too_many_changes` with its warning; `meta.ts` `MetaDeps.source` from `SourceInfo`; `series.ts` passes `limit` `undefined`. Verify: scenarios "Data refs that would break IDs", "Adapter without events", "Density query unchanged", "Server meta" › "Reachable source".
- [ ] 2.3 ClickHouse to the contract (C4): `info`, `ping` (moved from `main.ts`), `listSignals` with text flags from today's two queries, `raw` with optional `LIMIT`, `refBuckets` with optional row times; `textSignals` removed; all other queries byte for byte as today. Verify: `pnpm --filter @kipscope/server test` green with unchanged expectations; scenarios "Existing suite", conformance `clickhouse native` and `clickhouse core only`.
- [ ] 2.4 Configuration and wiring (C3, C5): `SourceConfig` and `KIPSCOPE_SOURCE` with the ADX variables, checks and per-source defaults in `config.ts`; `createAdapter` in `sources.ts`; `main.ts` builds `completeSource(queuedAdapter(createAdapter(config), queue))`, logs the native methods, passes `source.info` and `source.ping` to meta; every source variable in `.env.example` (ADX block commented out). Verify: scenarios "Selecting a source", "Defaults and checks", "ClickHouse defaults unchanged"; the dev server on carserver starts and logs `source clickhouse sdlog: native …` naming all 8 optional methods, `events` included (lead).

## 3. apps/server/src: ADX

- [ ] 3.1 Kusto client and Azure CLI token (C6): `KustoClient` (`query`, `ping`, headers, `declare query_parameters` prologue, parameter encodings, `servertimeout`, frame parsing, `HasErrors` and in-data error rows, HTTP error messages with the 401/403 hint, abort through `fetch`), `KustoError`, `adxDatetime` (rounded up to 100 ns), `real`; `azCliToken` (`execFile`, win32 shell, 30 s timeout, expiry from `expires_on`/`expiresOn`, 5 min margin, one shared run, failures not cached, the two messages). No token in any message. Verify: scenarios "Token cached until near expiry", "CLI missing or logged out", "Token stays private", "Error frames and HTTP errors", "Request shape", "Bounds between ticks" (unit part).
- [ ] 3.2 ADX adapter (C6): `AdxSource` with `info`, `ping`, the 7 required methods and native `refCount`, `loggerGaps`, `stateChanges`, `events`, KQL as in the C6 table, every configured name bracket-quoted, times via `ns(…)` strings, missing events table / text column via SEM0100 and the configured name; registered in `createAdapter` (task 2.4 imports it). Verify: `pnpm --filter @kipscope/server test:adx` (emulator seeded): conformance `adx native` and `adx core only`; scenarios "Stored function as mapping", "Truncated answer", "Missing table and column", "Cancelled on abort", "ADX source" (meta), "Emulator run".

## 4. apps/web/src

- [ ] 4.1 Footer label `adx: "ADX"`, `KIND_LABEL` as `Record<string, string>` (C10); nothing else. Verify: `pnpm --filter @kipscope/web test`; scenario "ADX and other kinds"; `pnpm smoke` passes (crash guard).

## 5. Docs

- [ ] 5.1 `docs/data-sources.md` per the outline of C9, with the C2 cost table, the C5 layout and function examples, and the variables table. Verify: scenarios "Variables documented", "Guide followed on the emulator" (lead).
- [ ] 5.2 `docs/http-api.md` per C9 (shared rules, one row per route, links to the specs); `README.md`: links to both documents in "Data sources" and next to the CLI section, the emulator commands under "Test database". Verify: scenarios "Every route listed", "Linked from the README".

## 6. Tests (tester, test-first)

- [ ] 6.1 Conformance fixture, suite and ClickHouse run (C7): `fixture.ts` (rows of the C7 table, events), `suite.ts` with `describeConformance` and every case named in C7 (expected values from the fixture definition, each case also run core only), `clickhouse.conformance.test.ts` on `sdlog.conf_signals`/`conf_events` (with an `eventsMissing` adapter on `nope`); `seed-test-db.ts` creates and fills both tables from `fixture.ts` (header comment updated); `globalSetup.ts` also checks 17,082 rows in `conf_signals`. Verify: `pnpm --filter @kipscope/server seed:test && pnpm --filter @kipscope/server test`: `clickhouse native` and `clickhouse core only` pass every case.
- [ ] 6.2 Emulator infrastructure and ADX tests (C7, C8): `adx-test` service under profile `adx` in `docker-compose.yml`; `seed:adx` and `test:adx` scripts; `seed-adx.ts` (loopback guard, persistent `kipscope_test`, default layout, fixture rows, `KSignals()` over a renamed copy); `vitest.adx.config.ts` with `adxGlobalSetup.ts` (one "not reachable or not seeded" message); the default `vitest.config.ts` excludes the ADX files; `adx.conformance.test.ts`; `adx.test.ts` › "reads through a stored function", "fails on a truncated answer", "treats a missing events table and text column as none", "cancels a query on abort" (checks `.show queries`), "reports the ADX source in meta", "implements the measured fast paths only". Verify: `docker compose --profile adx up -d && pnpm --filter @kipscope/server seed:adx && pnpm --filter @kipscope/server test:adx`; scenarios "Not started" (emulator stopped), "Seed guard", "Default test run unchanged".
- [ ] 6.3 Unit tests: `fallbacks.test.ts` › "sends no query for an empty name list", "sends fallback queries through the queue", "stops a fallback on abort", "stops the state-change scan after 5,000,000 points" (pages generated lazily), "treats a source without events as one without an events table"; `kusto.test.ts` (fake fetch) › "sends parameters and limits", "rounds bounds up to the next tick", "fails on error frames and error answers", "never puts the token into errors"; `azcli.test.ts` (fake runner and clock) › "caches the token until five minutes before expiry", "explains a missing or logged-out CLI"; `docs.test.ts` › "documents every source variable", "documents every HTTP route"; `config.test.ts` › "selects the source", "reads the ADX settings". Verify: `pnpm --filter @kipscope/server test`.
- [ ] 6.4 Existing tests and stubs to the new shapes (C1): stub sources get `info`, `ping`, `raw(…, limit, abort)`, `refBuckets(…, times, abort)`, text flags in `listSignals`, no `textSignals`/`eventsTable` (`apps/cli/test/helpers.ts`, `viewsApp.ts`, `catalog.test.ts`, `density.test.ts`, `gaps.test.ts`, `events.test.ts`, `series.abort.test.ts`); `queue.test.ts` on `queuedAdapter`; `catalog.test.ts` › "skips listed signals whose data ref or name would break the ID"; `density.http.test.ts` › "sends the counts-only bucket query"; `meta.http.test.ts` › "never sends source credentials" gains an ADX case (cluster URL and a fake token absent from the answer). Expected values of existing tests stay unchanged. Verify: `pnpm --filter @kipscope/server test && pnpm --filter @kipscope/cli test`.
- [ ] 6.5 `apps/web/test/footer.test.ts` › "labels ADX and unknown source kinds". Verify: `pnpm --filter @kipscope/web test`.

## Workflow follow-up

- Lead: manual checks of design "Manual checks (lead)"; `pnpm build && pnpm test && pnpm lint`, `test:adx`, `pnpm smoke`.
- On archive: ledger entry of design "Ledger entry on archive", with Jan's answers to A-1 … A-3; `docs/status.md` "Next" item 1.
