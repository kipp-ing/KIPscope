## ADDED Requirements

### Requirement: Query classes
Every source query SHALL run in one of the classes `interactive`, `metadata`, `background`, `preload` (highest first): queries for an HTTP request and the catalog load `interactive`, the prefetches after a catalog load and the gap polls `background`, a fallback's inner queries in their caller's class. Origin: the ADX feedback item 7; D-078 („Background preloading must never delay interactive queries"); `metadata`: D-080 P1; `preload`: D-078 neighbours.

#### Scenario: Prefetch and polls run as background
- **WHEN** a stub adapter with only the required methods plus `events`, behind a queue of limit 4 and the server's fallbacks, records the class of every call it gets; its catalog (data ref `car`, 3 signals, one of them in a window and on the events line) loads; a `/api/series` request for that signal follows; and a gap poll runs 5 min later (fake timers)
- **THEN** every call caused by the density, gap info and events prefetch (including the `raw` calls of the `firstTimes` and `refBuckets` of the `loggerGaps` and `refExtent` fallbacks) and by the poll records `background`, and every call of the series request and of the catalog load records `interactive`
- **Evidence:** `apps/server/test/priority.test.ts` › "tags prefetches and polls as background and requests as interactive"

### Requirement: Interactive queries first
When a query slot is free, the server SHALL start the oldest waiting query of the highest-ranked class that may start; a waiting query never starts before a waiting query of a higher class. Running queries SHALL run to their end (no preemption); aborts work as in "Bounded database load". Origin: the ADX feedback item 7 („give series, extent and value requests priority"); D-078.

#### Scenario: Start order by class
- **WHEN** a queue of limit 4 gets 20 `background` tasks B1–B20 that each run until the test releases them, then one `preload` task P, one `metadata` task M and three `interactive` tasks I1–I3, in this order; then the test releases B1, I1, I2, I3, M and after that every running task, one at a time
- **THEN** the tasks start in the order B1, B2, B3, I1, I2, I3, M, B4 … B20, P, and all 25 complete
- **Evidence:** `apps/server/test/queue.test.ts` › "starts waiting queries by class, oldest first"

#### Scenario: Aborted while waiting in a class
- **WHEN** in the setup above I3 is aborted while it waits
- **THEN** I3 rejects with the abort reason and never runs, and M starts as soon as I1 and I2 have both ended (the stats show `interactive` waiting 0 right after the abort)
- **Evidence:** `apps/server/test/queue.test.ts` › "drops an aborted query from its class"

### Requirement: A slot kept for interactive queries
With a query limit L above 1, a query below `interactive` SHALL start only while fewer than L − 1 queries run, so that an interactive query that finds no other interactive query running or waiting starts at once. With L = 1 no slot is kept. Origin: the ADX feedback item 7 („should never hold every query slot … or reserve a slot for them"); one slot: design P2.

#### Scenario: Interactive query during a background fan-out
- **WHEN** a queue of limit 4 gets 2,400 `background` tasks that each run until released, then one `interactive` task
- **THEN** exactly 3 background tasks run, the interactive task starts before any of them ends, and the queue's per-class stats read `background` running 3 / waiting 2,397 and `interactive` running 1 / waiting 0
- **Evidence:** `apps/server/test/queue.test.ts` › "keeps one slot for interactive queries"

#### Scenario: Limit of one
- **WHEN** a queue of limit 1 gets `background` tasks B1 and B2, then `interactive` task I1
- **THEN** B1 starts at once, I1 starts when B1 ends, and B2 starts after I1
- **Evidence:** `apps/server/test/queue.test.ts` › "has no kept slot with a limit of one"

### Requirement: Shared work takes its most urgent class
When a request joins a density, gap info or events computation that is already in flight, the computation's waiting and later queries SHALL rank in the request's class if that is higher; a class is never lowered. A raised waiting query SHALL rank within its new class by the time it was raised, not by when it first arrived. Origin: consequence of "Interactive queries first" (else the request waits as `background`); raise time: lead, on Jan's note (design "Lead's decisions after round 1").

#### Scenario: Request joins the density prefetch
- **WHEN** a queue of limit 4 holds 3 running `background` tasks that are never released, the density prefetch of data ref `car` waits behind them, and `GET /api/density?dataRef=car` arrives
- **THEN** the prefetch's `refExtent` and `refBuckets` start as `interactive` without any of the 3 tasks ending, the request answers 200, and the prefetch computed the density once (one `refExtent`, one `refBuckets`)
- **Evidence:** `apps/server/test/priority.test.ts` › "raises a prefetch that a request joins"

#### Scenario: Raised while waiting
- **WHEN** a `background` task waits in a queue of limit 4 with 3 running `background` tasks, and its class is raised to `interactive`
- **THEN** it starts at once, before any running task ends
- **Evidence:** `apps/server/test/queue.test.ts` › "starts a raised query at once"

#### Scenario: Raised query ranks by the time it was raised
- **WHEN** a queue of limit 4 runs 4 `interactive` tasks R1–R4 that each run until released; `background` task B is queued; then `interactive` task S1 is queued; then B's class is raised to `interactive`; then the test releases R1, and after that R2
- **THEN** neither B nor S1 starts before R1 ends; S1 starts when R1 ends, B when R2 ends
- **Evidence:** `apps/server/test/queue.test.ts` › "ranks a raised query by the time it was raised"
