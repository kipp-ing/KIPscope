# Design

## Context

See proposal.md for the why. Current state, as far as it shapes this design:

- `apps/server/src/queue.ts`: `QueryQueue(limit)` is one FIFO (`waiting.shift()`); `queuedAdapter` wraps every adapter method except `ping` and `info`. `main.ts` builds `completeSource(queuedAdapter(adapter, new QueryQueue(KIPSCOPE_QUERY_CONCURRENCY = 4)))`, so the fallbacks sit outside the queue and each of their inner queries takes its own slot (data-source design C3).
- `apps/server/src/routes/series.ts`: after each catalog load, `density.prefetch` then `gaps.prefetch` over every data ref, then a 5 min `gaps.refresh` poll chain. `routes/events.ts`: `events.prefetch` over every data ref plus the events-line signals, in parallel to the density chain.
- `apps/server/src/gaps.ts`: `GapCache.get(dataRef)` computes `refCount`, then `loggerGaps` and `firstTimes(dataRef, every catalog signal without a static period, 1001)` in parallel. `/api/gaps` and `/api/value` both await it. ClickHouse has a native `firstTimes` (one query); ADX has none today, so the fallback sends one `raw(…, limit 1001)` per name: ~2,400 on the ADX testers' vehicle (the ADX feedback).
- `apps/web/src/chart/gaps.ts`: `GapInfoStore` fetches `/api/gaps?dataRef=` once per data ref per tab, refetches every 5 min; a window's render acknowledgement waits for `settled`.

## Goals / Non-Goals

**Goals:** an interactive query never waits for a background query to end; background work never takes the last free slot; periods are measured for the handful of signals in use; the later classes (`metadata`, `preload`) exist so `add-scope`, `add-signal-books` and `add-case-open` only tag their work.

**Non-Goals:** see proposal "Out of scope". In particular no change to any query text, the adapter contract, or which data refs are prefetched.

## Decisions

### P1 Mechanism: priority classes with one kept slot

Chosen: **priority classes**, plus the rule that work below `interactive` never takes the last free slot. Either half alone misses the goal; numbers for limit 4:

| Option | First interactive query after a background burst starts | Throughput of an 8-signal window while background is busy |
|---|---|---|
| FIFO (today) | after every query queued before it: 2,400 fallback `raw` calls on ADX, minutes (the ADX feedback) | after the burst |
| Kept slot only (FIFO otherwise) | at once | 1 slot: 8 series × (count + data) ≈ 16 queries in a row, ≈ 8 s at 0.5 s each instead of ≈ 2 s |
| Priority only | when the first of 4 running background queries ends: CH `loggerGaps` ≈ 7 s (data-gaps "Load on carserver"); an unscoped ADX `refBuckets` runs into the 120 s timeout (the ADX feedback) | every freed slot |
| **Priority + kept slot** | at once | 1 slot at once, then every slot that frees |

Cost: background work gets 3 of 4 slots. The prefetches run mostly one or two queries at a time (density and gap info per data ref in turn, events beside them), so they lose little; only fan-outs (a `firstTimes` fallback, now ≤ 100 names) are slowed by ≤ 4/3.

Rule (series-query "Interactive queries first", "A slot kept for interactive queries"): on every pick, the waiting query with the best (class rank, sequence number) starts (sequence number: given when queued, renewed on each raise, P4) if `running < limit` for `interactive`, or `running < limit − kept` for every other class, where `kept = limit > 1 ? 1 : 0`. If the best waiting query may not start, nothing starts (a lower class has the same or a stricter bound). No preemption; running queries end normally or by abort.

### P2 One kept slot (spec owner's default, Jan can veto)

Off by ×2 (kept 2 of 4): background gets 2 slots; a 50-name fallback fan-out takes 25 instead of 17 rounds; an interactive burst gets 2 slots at once. Off by ×½ (kept 0): today's behaviour, background can hold every slot. With `KIPSCOPE_QUERY_CONCURRENCY=1` nothing is kept (else background would never run); with 2 background gets 1 slot. Not configurable: one more variable for a number nobody has asked to tune.

### P3 Classes travel in the async context

`apps/server/src/priority.ts` (new) holds the class in an `AsyncLocalStorage`. Entry points that start background work wrap it in `withPriority("background", …)`; everything else runs without a context and counts as `interactive` (every route, the CLI's requests, the catalog load and its retries). The fallbacks call the queued adapter inside their caller's async context, so their inner queries inherit the class with no change to `fallbacks.ts`.

The queue captures the context when a query is queued (`AsyncLocalStorage.snapshot()`) and starts the task inside it; otherwise a task would run in the context of whichever query freed the slot.

Rejected: a priority parameter on every adapter method. It changes the lean contract (data-source; Jan 2026-10-17: „the interfaces shall be lean") and every fallback, and adapters have no use for it.

### P4 Shared work is raised, never lowered

The density, gap and events caches share one computation between the prefetch and requests. Each cache entry gets its own `Priority` handle, created with the class of the caller that starts it, and the computation runs under `withPriority(handle, …)`. A caller that joins the entry calls `handle.raise(currentPriority().cls)`. The queue ranks a waiting query by its handle's class at pick time, and `raise` gives every waiting query of that handle a new sequence number and makes every queue re-pick at once (a raised query may now take the kept slot). So a raised query ranks behind the queries of its new class that were waiting before the raise (lead, after round 1). Raising never lowers a class and does not touch running queries.

Where entries live: `DensityCache` (per data ref), `GapCache` logger part (per data ref) and period batch (per batch, P6), `EventsCache` table (per data ref) and signal (per signal).

### P5 Waiting list (spec owner's default)

One waiting array; a pick scans it for the best (rank, sequence number). Waiting lists are ≤ a few hundred after this change (≤ 100 names per fan-out); even 2,400 entries cost 2,400 × 2,400 / 2 ≈ 2.9 M comparisons over a whole fan-out, well under 100 ms. Per-class FIFOs would need entries moved on `raise`; not worth it at this size.

### P6 Gap info: logger part per data ref, periods per signal

`GapCache` keeps per catalog load:

- **Logger part** per data ref: `{ count, logger, through }` from `refCount` then `loggerGaps`, shared, failure not kept (as today).
- **Measured periods** per signal: `Map<name, Promise<bigint | undefined>>` per data ref. A call `get(dataRef, signalIds)` measures, in **one** `firstTimes(dataRef, names, PERIOD_SAMPLE_ROWS)`, the union of (a) the named signals of that data ref and (b) the workspace signals of that data ref (`wanted()`), keeping only signals in the catalog without a static period and not already measured or in flight. No call when the union is empty. A failed batch drops its names (not kept) and the request answers 502, as today.
- **Answer** (`GapInfo`, unchanged shape): `logger`, `through`, and `periods` = the static (DBC, diag) period of every catalog signal of the data ref plus the measured period of each **named** signal that has one. Workspace signals measured along do not show up unless named, so the answer depends only on the request.

`prefetch(dataRefs)` computes each data ref's logger part in turn and measures the workspace signals of that data ref (one `firstTimes` per data ref). `refresh` (poll, G9 (b)): when a data ref's count changed, it recomputes the logger part and re-measures the names measured so far in this load for that data ref in one `firstTimes`, serves the old values until both are in, and keeps them on failure (data-gaps "Gap info follows new rows", unchanged).

`wanted()` returns the signal IDs of every window (timeseries and values) plus `eventSignals` of the current workspace; read at call time, so a signal added later is measured by its first request. With D-079 (`add-multiuser`) this becomes the requesting user's workspace; the hook stays one function.

`/api/value` asks `gaps.get(info.dataRef, [signalId])`: it waits for the logger part and its own period, not for every signal's.

### P7 HTTP

`GET /api/gaps?dataRef=<ref>&signal=<id>&signal=<id>…`: `signal` optional and repeatable (parsed like `/api/events`: a string or an array). Order of checks: query shape (400, including > `MAX_GAP_SIGNALS`), catalog loaded (503), data ref known (404), compute (502). Signals of other data refs and names not in the catalog are ignored silently, as `/api/events` ignores signals of other data refs. The answer type stays `GapInfo`.

`MAX_GAP_SIGNALS = 100` (spec owner's default, Jan can veto): twice concept §3's 50 signals shown at once. Off by ×2 up (200): a request with long IDs (≈ 90 characters URL-encoded with `&signal=`) reaches ≈ 18 KB and Node's default 16 KB header limit answers 431 before the route runs. Off by ×½ (50): a single window at the concept's maximum would leave no room; harmless otherwise.

### P8 Web: the store asks per signal

`useGapInfo(signalIds)` (data refs derived with `parseSignalId`); `GapInfoStore.ask(signalIds, listener)`. Each data ref entry counts asks per signal (insertion order = first asked first) and remembers the names of its last successful fetch. A fetch names the first `MAX_GAP_SIGNALS` asked signals. An ask that adds a signal not named by the last fetch starts a fetch at once (or right after the one in flight); the 5 min refetch and the 30 s retry name the signals asked at that time. `state(signalIds)` is `settled` when every data ref has failed or its last fetch named every asked signal among its first `MAX_GAP_SIGNALS`. A changed `settled` notifies listeners even when the new answer's JSON equals the old one.

`TimeseriesWindow` passes `w.signals.map((s) => s.signalId)`, memoised on content as it does for `dataRefs` today. A signal whose period has not arrived yet draws with logger splits only until the answer is in (same as today before the first gap answer; spec owner's default, Jan can veto).

### P9 Which work is which class

| Work | Class | Where it is set |
|---|---|---|
| Every HTTP route (series, value, extent, raw via series, signals, catalog, catalog refresh, density, gaps, events), the catalog load and its retries | `interactive` | default, nothing to do (Q-2) |
| Density, gap and events prefetch after a catalog load; gap polls | `background` | `routes/series.ts`, `routes/events.ts` wrap their `onLoaded` and poll callbacks |
| D-080 P1 metadata batch at case open | `metadata` | `add-signal-books` |
| D-078 neighbour preloading | `preload` | `add-case-open` |
| `ping` | none (bypasses the queue, unchanged) | — |

## Interfaces (pinned)

Server-internal, pinned so that the tester can write tests in parallel with the engineer.

```ts
// apps/server/src/priority.ts (new)
export type QueryClass = "interactive" | "metadata" | "background" | "preload";
/** Highest first; a class's rank is its index. */
export const QUERY_CLASSES: readonly QueryClass[] = ["interactive", "metadata", "background", "preload"];
/** Index of `cls` in QUERY_CLASSES (0 = highest); the queue uses this, no copy. */
export function rank(cls: QueryClass): number;
export class Priority {
  constructor(cls: QueryClass);
  get cls(): QueryClass;
  /** Raises to `cls` when that ranks higher; never lowers; notifies listeners on a change. */
  raise(cls: QueryClass): void;
  /** Called after each raise; returns the unsubscribe. */
  onRaise(listener: () => void): () => void;
}
/** Runs `fn` (and every async continuation of it) under `priority`; a class name makes a new handle. */
export function withPriority<T>(priority: Priority | QueryClass, fn: () => T): T;
/** The handle of the current context; a shared `interactive` handle outside any context. */
export function currentPriority(): Priority;

// apps/server/src/queue.ts
export class QueryQueue {
  constructor(limit: number);
  readonly limit: number;
  /** Slots only `interactive` queries may take: 1 when limit > 1, else 0 (design P2). */
  readonly kept: number;
  peak: number;
  get stats(): {
    running: number;
    waiting: number;
    peak: number;
    byClass: Record<QueryClass, { running: number; waiting: number }>;
  };
  /** Queues `task` in the class of `currentPriority()` at call time, inside the caller's async context. */
  run<T>(task: (abort?: AbortSignal) => Promise<T>, abort?: AbortSignal): Promise<T>;
}
// queuedAdapter: signature unchanged.

// apps/server/src/gaps.ts
export class GapCache {
  constructor(source: GapSource, catalog: GapCatalog, wanted?: () => Iterable<string>); // default: none
  get(dataRef: string, signalIds?: readonly string[]): Promise<GapInfo>;
  prefetch(dataRefs: Iterable<string>, warn: (message: string) => void): Promise<void>;
  refresh(dataRefs: Iterable<string>, warn: (message: string) => void): Promise<void>;
}
/** Signal IDs of every window plus the events line (design P6). */
export function workspaceSignals(workspace: Workspace): string[];
```

Shared (`packages/shared/src/gaps.ts`):

```ts
/** Most `signal` parameters of one `/api/gaps` request (design P7). */
export const MAX_GAP_SIGNALS = 100;
// GapInfo.periods doc comment: "Signal ID → period: the DBC or diag period of every catalog
// signal of the data ref, and the measured period of each signal the request named."
```

Web (`apps/web/src`):

```ts
// api.ts
export function fetchGaps(dataRef: string, signals: readonly string[], abort?: AbortSignal): Promise<GapInfo>;
// chart/gaps.ts
constructor(fetchInfo?: (dataRef: string, signals: readonly string[]) => Promise<GapInfo>, retryMs?, refreshMs?);
ask(signalIds: readonly string[], listener: () => void): () => void;
state(signalIds: readonly string[]): GapInfoState; // GapInfoState unchanged
export function useGapInfo(signalIds: readonly string[]): GapInfoState;
```

HTTP: `GET /api/gaps` gains `signal` (repeated, ≤ 100); answer unchanged (`GapInfo`).

## Risks / Trade-offs

- [Strict priority starves background work while interactive requests keep coming] → Interactive load comes in bursts (zoom, pan, open); background resumes in every pause. The strip's density can show later than today during heavy zooming (Q-1).
- [A context lost across a callback API (an event emitter, a timer started outside the context) runs background work as `interactive`] → The tests check the class of every prefetch and poll call (series-query "Prefetch and polls run as background"), including the fallbacks' inner calls.
- [A raised entry stays raised] → It only ever affects that one computation; the next catalog load creates new entries.
- [Workspace signals measured along with a request make that request's sample query wider] → At most 50 signals shown (concept §3), one query per data ref; the same query the prefetch would have sent.
- [A window with more than 100 signals of one data ref] → Beyond concept §3; signals after the first 100 split at logger gaps only.

## Migration Plan

Server and web change together; there is no stored state to migrate. A web build from before this change still gets an answer from `/api/gaps?dataRef=` (static periods only, so measured-period signals split at logger gaps only until the tab reloads). Rollback: revert the commit.

## Questions for Jan

- **Q-1 Strict priority or aging?** (a) strict: background waits as long as interactive queries wait (recommended: bursts are short, and series are what you look at); (b) aging: a background query that has waited 30 s goes ahead of interactive queries arriving after that.
- **Q-2 Strip, gaps and events requests from the browser: interactive like series?** (a) yes, every browser and CLI request is `interactive` (recommended: they are part of what you look at, and after `add-scope` they cover only the scope); (b) a class between `interactive` and `metadata`, so plots and cursor values always come before the strip and the event pins.

**Jan's answers (2026-10-19):** „Empfehlungen übernehmen“: Q-1 (a), Q-2 (a), and the spec owner's defaults stand. Jan also: handed-over sessions are usually checked for gaps beforehand; gaps can occur but are rare („die Sessions die üblicherweise übergeben [werden] sind vorher auf lücken geprüft. es kann vorkommen, ist aber selten“), so gap info must never delay the first draw of a curve.

## Lead's decisions after round 1

- **Raised work ranks by raise time** (on Jan's note above; no question to Jan): a background query raised to a higher class ranks, within that class, by the time it was raised, not by when it first arrived (P4; series-query "Shared work takes its most urgent class", scenario "Raised query ranks by the time it was raised"). Before, a browser `/api/gaps` or `/api/density` that joined background work could start that work ahead of series queries already waiting; now those series go first, and gap info no longer delays the first draw of a curve through the queue.
- **Unchanged on purpose:** `/api/value` still waits for the gap info of a cold logger part, and a window's render acknowledgement still waits for its gap info (data-gaps "Gap info covers the window's signals"), because D-062 says a cursor inside a gap shows „no data", never a value across it; `add-scope` bounds those queries to the scope.

## Spec owner's defaults (Jan can veto)

- One kept slot, not configurable (P2).
- `MAX_GAP_SIGNALS = 100`; a window's signals beyond it get no measured period (P7, P8).
- A request's sample query also measures the workspace's unmeasured signals of that data ref (P6).
- A new signal draws with logger splits only until its period arrives (P8).
- One waiting array with a scan per pick (P5).
- The gap poll re-measures the periods measured so far when a data ref's count changed (P6).

## Manual checks (lead)

- Dev server on carserver after `scripts/restart-server.sh`: `curl -X POST localhost:7310/api/catalog/refresh` and right after it `curl -s -o /dev/null -w '%{time_total}\n' 'localhost:7310/api/series?signal=smart451/BMS.cell_voltage.001&from=<1 h ago>&to=<now>'` prints under 2 s. On ClickHouse the prefetch seldom fills all 4 slots, so this is a sanity check, not proof; the proof is the stub tests.
- The two `curl` commands of data-gaps "smart451 periods".
