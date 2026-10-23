# Tasks

Server only. No `packages/shared`, `apps/web` or CLI change, so no UI user run and no crash guard (`pnpm smoke`) are needed; the tester's `pnpm build && pnpm test && pnpm lint` plus `test:adx` on the emulator are the gates. D-097 (Jan, 2026-10-22): no native ADX `count` (task 2.1 dropped; `count` stays on the fallback) and the ADX queue default 8. Every interface two tasks share is pinned in design.md (A2 `SeriesAnswer` and `series`, A3 the ADX row layout, A4 `DEFAULT_QUERY_CONCURRENCY`, A5 `PING_CACHE_MS`), so groups 1–5 and the tester's group 6 can run in parallel; an engineer stubs a pinned import until its task lands. P9 has no task (design A6).

Write areas (disjoint per group):

- 1.x: `apps/server/src/datasource.ts`, `fallbacks.ts`, `queue.ts`, `scope.ts`, `series.ts`
- 2.x: `apps/server/src/adx.ts`
- 3.1: `apps/server/src/config.ts`
- 4.1: `apps/server/src/meta.ts`
- 5.x: `docs/data-sources.md`, `.env.example`
- 6.x: `apps/server/test/` (tester)

## 1. apps/server/src: the `series` contract

- [x] 1.1 `datasource.ts`: `SeriesAnswer` and the optional `series` in `SourceAdapter`, exactly as design A2 pins them (after `extent`). Verify: `pnpm build`.
- [x] 1.2 `fallbacks.ts`: `series` in `OPTIONAL` in the order of A2; the `series` fallback in `completeSource` (completed `count` first, then `raw` + `before` + `after` in parallel, or `buckets`; A2). Verify: scenarios "The fallback runs today's calls", "No native series on ClickHouse" (`fallbacks.test.ts`).
- [x] 1.3 `queue.ts`: wrap a native `series` in `queuedAdapter` (one `queue.run`). Verify: scenario "One slot and one query per series request" (`adxQueries.test.ts`); `queue.test.ts` › "wraps only the optional methods the adapter has" and "covers the … methods of the contract that take a scope" (12 now).
- [x] 1.4 `scope.ts`: `guardScoped` wraps `series` with both checks (scope present, range inside a held scope of its data ref; A2). Verify: scenario "Guard on series" (`scope.test.ts`).
- [x] 1.5 `series.ts`: `querySeries` computes the width first and calls `source.series` once (A2); output unchanged. Verify: scenarios "Unchanged series answers", "Full mode with a scope" (`scope.http.test.ts`).

## 2. apps/server/src/adx.ts

- [x] 2.2 Native `extent` with the scope (A1). Verify: conformance "finds the extent", "bounds the signal methods by a scope" (`adx native`); scenario "Query count per call" (extent part).
- [x] 2.3 Native `series`: one query of the shape of A3 with its pinned row layout; every table reference through `scoped()`; the kind from the `n` row; error without it. Verify: scenarios "Series natively and from the core" (`adx native`), "Query count per call", "Scoped series query carries both filters", "Byte-identical on the emulator", "Native methods without the emulator".

## 3. apps/server/src/config.ts

- [x] 3.1 `DEFAULT_QUERY_CONCURRENCY` `{clickhouse: 4, adx: 8}` as the default of `KIPSCOPE_QUERY_CONCURRENCY` by source kind (A4). Verify: scenario "Defaults and override" (`config.test.ts`).

## 4. apps/server/src/meta.ts

- [x] 4.1 Reuse a reachable ping result for `PING_CACHE_MS` 15,000 ms after its ping ended; never a failed one; single flight and the 2 s timeout unchanged; the doc comment "no cache beyond it" replaced (A5). Verify: scenarios "Reachable ping reused for 15 s", "Failed ping not reused", "One ping for concurrent requests", "Source down" (`meta.http.test.ts`).

## 5. Docs

- [x] 5.1 `docs/data-sources.md`: method table row for `series` (semantics, fallback, measured cost on the emulator: native → fallback), `extent` native in ADX with the report's cluster figures next to the emulator ones (`count` stays a fallback on ADX, D-097), the "ADX implements N" sentence and the "Fallback ≤ 2×?" table updated; the "Scope" section names `series` (12 methods); the queue rule and the variable table give the default 4 for ClickHouse and 8 for ADX. Verify: scenario "Guide names every scoped method" (`docs.test.ts`).
- [x] 5.2 `.env.example`: the `KIPSCOPE_QUERY_CONCURRENCY` comment names both defaults. Verify: `docs.test.ts` › "documents every source variable".

## 6. Tests (tester, test-first from the specs)

- [x] 6.1 Conformance suite (`test/conformance/suite.ts`): case "answers a series" with requests (a)–(g) and the expected values of data-source "Series natively and from the core", taken from the fixture definition. Runs in `clickhouse native/core only` (`pnpm test`) and `adx native/core only` (`test:adx`).
- [x] 6.2 New `test/adxQueries.test.ts` (fake Kusto client, no emulator, runs in `pnpm test`): "sends one query per extent and series" (and no `count` method on the adapter), "answers a series request with one query" (queue `peak` 1, results from the A3 rows), "lists the native methods" (`extent`, `series`, `refCount`, `loggerGaps`, `stateChanges`, `events`).
- [x] 6.3 `test/adx.test.ts`: "implements the measured fast paths only" with the new list (`count` still not native); "scopes every query by data ref and time" without `extent` in its fallback list and with `series` covered; new "answers series requests as the fallback does" (JSON identity, A7).
- [x] 6.4 `test/scopeCalls.ts`: a `series` entry in `SCOPED_CALLS` (raw path within S2); ClickHouse sends nothing for it, so `clickhouse.scope.test.ts`'s recorded unscoped texts stay unchanged. `test/fallbacks.test.ts`: "computes a series from count, then raw and edges or buckets", "takes series from the fallback on ClickHouse".
- [x] 6.5 `test/scope.test.ts`: "guards series by scope and range". `test/scope.http.test.ts` › "keeps every call inside the scope in full mode" also checks `series` calls.
- [x] 6.6 `test/queue.test.ts`: "runs eight at once with the ADX default"; the scope-method count test at 12. `test/config.test.ts`: "defaults the query limit per source kind". `test/meta.http.test.ts`: "reuses a reachable ping for 15 s", "pings again after a failed ping". `test/docs.test.ts`: 12 methods in "documents the scope argument".
- [x] 6.7 Run `pnpm build && pnpm test && pnpm lint`, then with the emulator `docker compose --profile adx up -d`, `pnpm --filter @kipscope/server seed:adx`, `pnpm --filter @kipscope/server test:adx`; report case counts per run (`clickhouse native`, `clickhouse core only`, `adx native`, `adx core only`). A run that could not start is `not_run`.

## 7. Lead

- [x] 7.1 Record D-097 in `docs/decisions.md` (no native ADX `count`; ADX default 8 superseding D-011 D7 for ADX); done by the lead.
- [x] 7.2 Send the ADX testers the release commit and ask them to measure their section 5 timeline (report targets: `/api/extent` p90 < 1.5 s, no series request waiting > 0.5 s in the queue); their numbers are not a gate of this change.
