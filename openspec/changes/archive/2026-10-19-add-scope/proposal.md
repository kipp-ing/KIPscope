# Proposal

## Why

On a large shared ADX table KIPscope never becomes usable: the signal list, the strip, the gap info and the events scan a data ref's whole history or the whole table, time out after 120 s and retry forever (the ADX feedback: unscoped catalog and history buckets time out; the same queries for one data ref and 24 h take ≤ 1.6 s for ≈ 2,300 signals). Jan decided the direction on 2026-10-19 (D-078): „KIPscope shows one case at a time: a **scope** (one data ref and one time window) … Every source query is bounded by the scope; nothing scans a data ref's whole history. The scope is a hard edge for now: navigation stops there, widening it is an explicit step." This change is item 2 of status.md "Next" and unblocks the ADX testers, who will send the ADX adapter part once the contract is settled.

## What Changes

- **Scope in the source contract** (the ADX feedback item 1): an optional `scope: Scope { dataRef, from, to }` argument on every method that has no time range of its own: `listSignals`, `before`, `after`, `refBuckets` (required) and `extent`, `refExtent`, `refCount`, `loggerGaps`, `firstTimes`, `stateChanges`, `events` (optional or capability). With a scope a method answers as if the source held only that data ref's rows in `[from, to)`. Without a scope everything answers as today. Every fallback passes the scope on. **BREAKING** for adapter authors: the four required methods gain the parameter before `abort`. ClickHouse and ADX get the scope filters. The conformance suite gains scoped cases. `docs/data-sources.md` documents the contract.
- **Scope in the workspace** (item 2): optional `workspace.scope`, commands `scope.set` and `scope.clear`. While a scope is set, every window range lies inside it, every cursor too, and every server query for the workspace is bounded by it.
- **Catalog modes** (item 2): `KIPSCOPE_CATALOG=full` (default, today's start-up catalog over all data refs) or `scoped`: no signal list at start, no prefetch, and no source query without a scope. In both modes a set scope has its own signal list, loaded before the command that sets it is applied. `signalExists` and the unit check answer against that list.
- **Scope from a view** (item 3): opening a view or a `#view=` link sets the scope. It uses the view's explicit optional `scope`, else the data ref of its first signal and the union of its window ranges and cursors, padded by `KIPSCOPE_SCOPE_PAD` (default 1 h). The view document stays `version: 1`, and older readers drop `scope` with their usual unknown-key warning.
- **Bounded strip, gaps and events** (item 4): with a scope, density, drives, logger gaps, periods, table events and state changes cover the scope only. The strip spans the scope and names it.
- **Hard edge** (item 4, D-078): range commands are clamped into the scope. Zoom out, pan, "Go to", presets, Home, strip actions and drive keys stop at the edge, and the UI says so. "Widen" is the explicit step. It adds one scope span on each side.
- **CLI** (item 5): `scope set REF FROM TO`, `scope show`, `scope widen`, `scope clear`.

## Capabilities

### New Capabilities

- `scope`: the scope of a workspace: its shape, commands, invariants and clamp rule, the catalog modes, the pad, how routes resolve and enforce it, and the "Widen" step.

### Modified Capabilities

- `data-source`: the scope argument, its semantics, scoped fallbacks, scoped conformance cases, scoped queries in ClickHouse and ADX, the guide.
- `signal-catalog`: one signal list per scope, the explorer following the scope, the empty state without a scope.
- `time-strip`: the density of a scope, and the strip label and controls for the scope.
- `data-gaps`: gap info of a scope.
- `events`: events and state changes of a scope.
- `time-navigation`: navigation stops at the scope edge.
- `saved-views`: the optional `scope` in the view document, open sets the scope, open loads the scope's signal list.
- `workspace-state`: open replaces the scope too.
- `cli`: the `scope` forms.

## Out of scope

- Native ADX `firstTimes`, and any other new ADX fast path. The ADX testers send it (the ADX feedback "Contribution"). This change keeps the fallback and only bounds it.
- Query priority, reserved slots, and which signals get periods measured (the ADX feedback item 7): change `improve-query-priority`. This change only bounds those queries by the scope.
- Handoff from the finder, case context, neighbouring sessions and their preloading (D-078: `add-case-open`). Workspaces per user and access control (D-079: `add-multiuser`). Signal books and lazy metadata (D-080: `add-signal-books`). ADX metadata (the ADX feedback item 6).
- A scope over several data refs. A maximum scope span. An automatic scope for a workspace in full mode without a view.
- Papercuts (the ADX feedback item 8): done separately.

## Impact

- `apps/server/src`: `datasource.ts`, `fallbacks.ts`, `clickhouse.ts`, `adx.ts`, `catalog.ts` (one catalog per scope), new `scope.ts` (catalog store, route resolution, scoped-mode guard), `density.ts`, `gaps.ts`, `events.ts`, `series.ts`, `routes/*`, `workspace.ts`, `views.ts`, `meta.ts`, `config.ts`, `main.ts`, `.env.example`.
- `packages/shared/src`: `WorkspaceScope`, the scope commands, `clampToScope`, `widenScope`, `viewScope`, view document `scope`, `CommandResult.clamped`, new error codes, `Density.scope`, `CatalogSnapshot.scope`, `ServerMeta.catalog.mode/scope`.
- `apps/web/src`: explorer reload per scope, strip scope label and "Widen"/"Clear", clamp message, `out_of_scope` window message, footer state.
- `apps/cli/src`: the `scope` forms.
- Docs: `docs/data-sources.md` (scope contract, variables), `docs/http-api.md` (errors), README CLI list.
- Tests: conformance suite (scoped cases, both adapters, native and core only), scoped-mode guard, shared clamp and view-scope tests, web and CLI tests.
