# Proposal

## Why

Issue #1, item 7 (Azure users, measured on a real ADX table): „Interactive queries first. Background work (density, gap prefetch) should never hold every query slot. Either give series, extent and value requests priority, or reserve a slot for them. Also measure periods only for the signals in the open view, not the whole catalog: 17–34 s for ~2,400 signals, against a handful in a view."

Today every source query goes through one FIFO queue with 4 slots (series-query "Bounded database load", D-011 D7). After each catalog load the server prefetches density, gap info and events for every data ref (time-strip, data-gaps, events), and the gap info measures a period for every catalog signal without a DBC or diag period (data-gaps "Measured period", D-068). Without a native `firstTimes` that is one `raw` query per signal (data-source "Optional methods fall back"): ~2,400 queries on the Azure users' vehicle. A series request queued behind them waits until all have run; issue #1: „plots stay empty for minutes". `/api/value` also waits for the whole gap info of its data ref, so cursor readouts wait the same.

D-078 (Jan, 2026-10-19): „Background preloading must never delay interactive queries (issue #1, item 7)." Planned changes add more work to the same queue: `add-scope` (every query bounded by scope), D-080's P1 metadata batch at case open, D-078's neighbour preloading. They need a place in the order now.

## What Changes

- **Query classes.** Every source query runs in one of four classes, highest first: `interactive` (everything a browser or CLI request asks for: series, value, extent, catalog, strip, gaps, events), `metadata` (D-080 P1 batch, later), `background` (prefetches after a catalog load, gap polls), `preload` (D-078 neighbours, later). Only `interactive` and `background` are used in this change; the other two are named so later changes only tag their work.
- **Priority with a kept slot.** A free slot goes to the oldest waiting query of the highest class. A query below `interactive` starts only while at least one other slot stays free, so an interactive query never waits for background work to finish. A request that joins shared work already in flight (density, gap info, events) raises that work to its own class.
- **Periods only for the signals in use.** A measured period is measured only for signals that are asked for (`/api/gaps?…&signal=…`, `/api/value`) or that are in the workspace (window signals and events-line signals), once per catalog load and batched per data ref. DBC and diag periods stay listed for every signal, as they cost no query. `/api/gaps` takes repeated `signal` parameters (at most 100), like `/api/events`.
- **Web asks for its signals.** The tab's gap info store sends the signals of its timeseries windows with each gap request and fetches again when a window shows a signal the last answer did not cover.

### Out of scope

- Scope in the source contract, scoped catalog, bounded strip/gaps/events, `scope set` (change `add-scope`, issue #1 items 1–5). Logger gaps, density and events still cover a data ref's whole history here.
- A native ADX `firstTimes` (the Azure users offered it, issue #1 "Contribution").
- The `metadata` and `preload` work itself (D-080 books, D-078 neighbours); fairness between users (D-079, `add-multiuser`).
- Preempting or cancelling running background queries; a second queue or a second connection pool; per-class timeouts; a UI for queue state.
- Changes to any ClickHouse or ADX query text.
- Which data refs are prefetched and in which order (unchanged: every data ref of the catalog, as today).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `series-query`: query classes, priority order and the slot kept for interactive queries, raised shared work (next to "Bounded database load").
- `data-gaps`: measured periods only for asked-for and workspace signals; `/api/gaps` `signal` parameter and its limit; the web's gap info covers its windows' signals.

## Impact

- `apps/server/src`: `queue.ts` (classes, order, kept slot, stats per class), a new `priority.ts` (class context), `gaps.ts` (logger part per data ref, periods per signal), `density.ts`, `events.ts` (class handle per shared entry), `routes/series.ts` (prefetch and polls as `background`, `signal` on `/api/gaps`, `/api/value` asks for one signal).
- `apps/web/src`: `api.ts` (`fetchGaps` with signals), `chart/gaps.ts` (store asks per signal), `chart/TimeseriesWindow.tsx` (passes its signal IDs).
- `packages/shared/src/gaps.ts`: `MAX_GAP_SIGNALS`, doc comment of `GapInfo.periods`.
- `docs/http-api.md`: `signal` on `/api/gaps`; `docs/data-sources.md`: the queue paragraph.
- No change to the adapter contract, the source queries, the workspace state or the view format.
