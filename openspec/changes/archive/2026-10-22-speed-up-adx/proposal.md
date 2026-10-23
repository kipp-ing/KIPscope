# Proposal

## Why

The ADX testers measured KIPscope on a real ADX cluster (the ADX feedback, comment of 2026-10-22, sections 1 and 2): one open of a 37-min drive takes about 11 s, 19 HTTP requests cause about 35–55 ADX queries, and "the cost is the number of serial ADX round trips, not payload or rendering". A single ADX round trip costs 0.6–8 s; the `extent` fallback (two `top 1` scans) took 4–17 s per signal; `/api/series` waits for a `count` before it sends its data query; the queue of 4 slots, sized for ClickHouse, makes most of the `/api/series` p90 of 8.9 s queue wait; `/api/meta` pinged ADX 1,590 times in 12 h. Jan agreed on 2026-10-22 to the lead's cut: the server-side items P1, P2, P5, P6 and an investigation of P9 now, everything else later.

## What Changes

- **P1, native `extent` on ADX:** the ADX adapter answers it with one KQL query (`summarize min, max` of the time column). The server's fallback stays for adapters without it. `count` and `refExtent` stay on the fallback (D-097: Jan dropped the native `count`, following D-074; design A1).
- **P2, one source query per `/api/series` on ADX:** a new optional adapter method `series` answers "raw points with both edge neighbours, or buckets" in one call; the ADX adapter implements it as one KQL query (`toscalar(count)` plus a `union` of the raw, edge and bucket branches). Without it the server's fallback runs today's steps (`count`, then `raw` + `before` + `after` or `buckets`), so ClickHouse sends the same queries as before. The `/api/series` answer stays byte-identical on both paths. **BREAKING for adapter authors** only in that the contract gains an optional method (the guide and the conformance suite say so); no HTTP payload changes.
- **P5, queue width per source kind:** `KIPSCOPE_QUERY_CONCURRENCY` defaults to 8 for ADX and stays 4 for ClickHouse; a set value still wins for both. The kept `interactive` slot stays one (D-081).
- **P6, cached ping:** `/api/meta` reuses a reachable ping result for 15 s; a failed ping is not reused. The ping stays outside the query queue (it already is).
- **P9, `/api/value` latency investigated:** its edge lookups already carry the scope filter; no change in this change. The findings are in design A6.

Timing targets of the report (`/api/extent` p90 < 1.5 s, no series request waiting > 0.5 s in the queue, first curve < 1.5 s) are **measured by the ADX testers after release** on their cluster. This change's evidence is local: query counts per request on a fake Kusto client, KQL shape, answers on the Kusto emulator and the ClickHouse test DB, cache hits and config defaults.

## Non-goals (later changes)

- P3 batch endpoints (`/api/series/batch`, `/api/extent/batch`).
- P4 one tile wave on open (web loader).
- P7 `/open` without the full scoped signal list.
- P8 visible loading state and blocking a second open.
- Functional items F1–F6 of the report (aliases, handoff handles, layout per kind, meta columns, ADX without events, docs).
- Any web change: the web's polling, tile waves and extent requests stay as they are.
- A native `series` for ClickHouse, a native `refExtent` on ADX, and any change to `/api/value`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `data-source`: the optional method `series` with its fallback; it takes a scope and its range stays inside the active scope; ClickHouse uses its fallback; the guide documents it.
- `adx-source`: native `extent` and `series`, one ADX query each; `count` stays on the fallback.
- `series-query`: the default query limit per source kind.
- `app-footer`: the source ping is reused for 15 s while reachable.

## Impact

- `apps/server/src`: `datasource.ts`, `fallbacks.ts`, `queue.ts`, `scope.ts`, `series.ts` (contract and fallback of `series`), `adx.ts` (native `extent`, `series`), `config.ts` (default per kind), `meta.ts` (ping cache).
- `apps/server/test`: conformance suite, a new fake-client test `adxQueries.test.ts` (runs in `pnpm test`), `adx.test.ts`, `fallbacks.test.ts`, `queue.test.ts`, `config.test.ts`, `meta.http.test.ts`, `scope.test.ts` or `scope.http.test.ts`, `docs.test.ts`, `scopeCalls.ts`.
- Docs: `docs/data-sources.md` (method table, ADX natives, queue default, scope list), `.env.example`.
- No change to `packages/shared`, `apps/web`, the CLI or any HTTP payload.
- Decisions: D-097 (Jan, 2026-10-22): no native ADX `count` (D-074), and the ADX default of 8, which supersedes D-011 (D7, "at most 4 concurrent DB queries") for ADX only.
