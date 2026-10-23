# Proposal

## Why

On ADX a computed signal has no native query. It uses the bounded fallback: `raw` of every input into the server, at most 200,000 rows for all inputs together, else "zoom in". So a computed signal over a long range shows nothing there. The users of the search tool work on ADX. Jan, on the lead's offer of a native ADX query with the chunking of D-110 (D-111): „ja, wär cool".

D-102 already named the shape: „On ADX the same single scan needs `serialize` and `scan` (fill forward); not measured yet, only the emulator is at hand." A probe on the emulator (2026-10-23, design "Context") ran that shape: one query that reads the inputs once, carries each input's last value forward with `scan`, keeps the last row per time and answers count and rows together.

## What Changes

- **Native `computedSeries` on ADX** (`apps/server/src/adx.ts`). One KQL query per answer, built from the parsed formula only:
  - Signal names, constants and seeds go in as query parameters (`declare query_parameters`). No formula text reaches the query.
  - 1 to 8 inputs, read once with `signal in (s0, …)`.
  - One `scan` carries each input's last value and time forward over the union of their times. Seeds enter as rows before `from`.
  - Hold limits per input. SNA per input, from the DBC ranges and the row texts (`KIPSCOPE_SNA_TEXTS`), folded into the value as NaN.
  - One row per time (the last row at that time). A non-finite result is SNA. `min`/`max` give SNA when any argument is SNA or NaN.
  - The count of the input rows comes back in the same query. At most `target` rows: a raw answer. Otherwise: buckets of the exact rows. One round trip, not two (D-097).
- **Chunked bucket scan on ADX** (round 2, D-110 as D-111 asks). A bucket answer over several inputs with more than 1,000,000 input rows, where every input has a finite hold limit, is split at bucket starts into k = min(3, ceil(count / 1,000,000)) chunks. The chunks run in parallel, each through the query queue (the existing `useQueue` hook). Later chunks read back by the largest hold limit, never before `from`, and carry the request's seeds. The answer stays identical.
- **Real query parameters** in the Kusto client (`apps/server/src/kusto.ts`): `real` joins string, datetime, long and dynamic.
- **Docs**: `docs/data-sources.md` lists `computedSeries` as native on ADX.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `adx-source`: adds "Computed series in one ADX query" and "Chunked computed scan on ADX". Changes "ADX passes the conformance suite" (`computedSeries` is native) and "ADX query limits" (real parameters).
- `data-source`: changes "Computed method in the adapter guide" (ADX native).

## Impact

- Code: `apps/server/src/adx.ts` (`computedSeries`, `formulaKql`, `useQueue`, constructor option), `apps/server/src/kusto.ts` (`real` parameter). Tests: `apps/server/test/adxQueries.test.ts`, `apps/server/test/adx.test.ts`, `apps/server/test/kusto.test.ts`, new `apps/server/test/computed.adx.test.ts`. The conformance suite is unchanged. Its computed cases now run the native ADX query in `adx native`.
- Docs: `docs/data-sources.md`.
- No change to `packages/shared`, `apps/web`, the HTTP payloads, `datasource.ts`, `queue.ts`, the fallback or ClickHouse.
- Builds on `speed-up-computed` (D-109, D-110): its design C-1 … C-4, the `useQueue`/`QueryRunner` hook and the SNA-as-NaN and `min`/`max` rules. That change is not archived yet, so this one adds ADX requirements of its own and modifies none of the requirements that change adds.

## Out of scope

- Timing on a real ADX cluster. That belongs to the search tool team after release (D-111). The lead notes it as a follow-up in `docs/status.md`. It is not a gate.
- Folding the seeds (`before` per input) and the raw answer's edges into the native query. `queryComputed` keeps reading them as today.
- A separate per-row path without `scan` for one input (design Q-4).
- More than 3 chunks, chunks split by row counts, chunking the raw answer or a one-input formula.
- `materialize`, materialized views, update policies, pre-aggregation (D-102).
- Any change to ClickHouse, the fallback, the web app or `packages/shared`.
