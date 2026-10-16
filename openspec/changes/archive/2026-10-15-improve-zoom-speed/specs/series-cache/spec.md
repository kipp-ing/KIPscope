## ADDED Requirements

### Requirement: Loading follows the shown range
A timeseries window SHALL load and draw the data of the range it shows, also while a gesture previews a range not yet committed; a fully cached shown range SHALL be drawn in the frame that first shows it, without a request. The range command SHALL still be sent 300 ms after the last step and SHALL load nothing more. Origin: D-040 (1) („loading on the preview range during the gesture, the command still delayed") and its target („a cached zoom draws sharp data within one frame").

#### Scenario: Cached zoom in the same update
- **WHEN** a loader has completed view A and view B of one signal, and its request changes back to A
- **THEN** within that `update` call the state is `complete` with A's data, `onChange` has been called, and no fetch was made
- **Evidence:** `apps/web/test/loader.test.ts` › "draws a cached zoom in the same update, without a request" (loader built with the window options: load interval 100 ms, overview, prefetch)

#### Scenario: Command still delayed, no load after it
- **WHEN** the UI timing check (design T1) zooms a settled window with one Ctrl+wheel event at time t0
- **THEN** after the command (sent at about t0 + 300 ms) no stroke burst is drawn until t0 + 1,000 ms, i.e. the command loads and changes nothing on screen (prefetch requests after the rest are allowed, they draw nothing)
- **Evidence:** UI timing check (design T1, steps 2 and 3, stroke bursts); command `grep -n "COMMIT_DELAY_MS = 300" apps/web/src/chart/TimeseriesWindow.tsx` prints one line

### Requirement: Loads during a gesture are throttled
A window SHALL start the requests for its missing tiles at once when it started none in the last 100 ms, else at the end of that interval for the range shown then. Tiles a run in flight still serves SHALL NOT be aborted. Origin: necessary consequence of D-040 (1): a request set per frame would outrun the server's 4 concurrent queries (`KIPSCOPE_QUERY_CONCURRENCY`); the number: design Z1.

#### Scenario: Wheel gesture of 250 ms
- **WHEN** a loader with load interval 100 ms gets a new uncached view of one signal every 16 ms from 0 ms to 240 ms
- **THEN** exactly four request sets start: at 0 ms for the 0 ms view, at 100 ms for the 96 ms view, at 200 ms for the 192 ms view and at 300 ms for the 240 ms view; each earlier run whose tiles the next view does not want is aborted
- **Evidence:** `apps/web/test/loader.test.ts` › "throttles loads during a gesture: first at once, then once per interval" (vitest fake timers)

#### Scenario: Single step after a pause
- **WHEN** a loader that started no request in the last 100 ms gets one new uncached view
- **THEN** its request starts within that `update` call
- **Evidence:** `apps/web/test/loader.test.ts` › "throttles loads during a gesture: first at once, then once per interval"

### Requirement: Coarse overview per signal
For every signal a window shows, the tab SHALL fetch its extent once and, after the signal's first view has loaded, load one coarse level of 1,024 to 2,048 buckets over the whole extent as ordinary tiles. A window SHALL keep them while it shows the signal, even when the cache drops them; a failed load is tried again when a window next adds the signal. Origin: D-040 (2) („a coarse overview of each signal's whole extent loaded once"); size: design Z2.

#### Scenario: Overview requested once
- **WHEN** two loaders of one tab each show a signal whose extent is `0` … `4294967295` and both first views have loaded
- **THEN** the extent is fetched once and exactly one series request `{from 0, to 4294967296, target 1025}` (level 22, tiles 0…3) is sent for the overview
- **Evidence:** `apps/web/test/loader.test.ts` › "loads the overview once per signal after its first view"; UI check: reload with one window showing `smart451/COMBI_412h.V_ANZ`; the network log shows one `/api/extent?signal=smart451%2FCOMBI_412h.V_ANZ` and, after the view's first `/api/series`, one more `/api/series` whose `target` is 1025 + 256 × n for some n ≥ 0 and whose span covers the extent

#### Scenario: Overview survives eviction
- **WHEN** the cache's limit is so small that the overview tiles are dropped right after they are stored, and the window then zooms to an uncached view
- **THEN** the window still draws a placeholder from the overview
- **Evidence:** `apps/web/test/loader.test.ts` › "keeps the overview tiles when the cache drops them"

### Requirement: Placeholder where tiles are missing
When a shown range lacks tiles, the window SHALL draw at once, until they arrive, the range at the finest coarser level that the cache or the overview fully provides (design Z4); without one it keeps its previous data. The placeholder is drawn data like any other (badge, loading status, live cursor). Origin: D-040 (2) („drawn at once where finer tiles are missing") and its target („coarse data within one frame"); one level per curve: design Q1.

#### Scenario: Uncached zoom draws a placeholder, then sharp data
- **WHEN** a loader holds the level-22 overview of a signal and its request changes to an uncached view `[0, 1000 × 2^20)` with target 1001 (level 20)
- **THEN** within that `update` call the state is `loading` with `placeholder` true and a bucket result of width 4,194,304 (level 22); after the response it is `complete` with `placeholder` absent and width 1,048,576
- **Evidence:** `apps/web/test/loader.test.ts` › "shows a placeholder at once and sharp data after the response"; UI timing check (design T1, step 2)

#### Scenario: Finest available level
- **WHEN** the placeholder search for a level-20 view finds no tiles at level 21 and all touched tiles at level 23
- **THEN** the placeholder is the stitched level-23 result of the view
- **Evidence:** `apps/web/test/tiles.test.ts` › "finds the finest coarser level for a placeholder"

#### Scenario: Live cursor on a placeholder
- **WHEN** a window shows a placeholder and the pointer hovers it
- **THEN** each L cell shows the placeholder bucket's mean with tooltip "bucket mean (avg)"
- **Evidence:** `apps/web/test/live.test.ts` passes unchanged (a placeholder is an ordinary bucket result); `apps/web/test/loader.test.ts` › "shows a placeholder at once and sharp data after the response" (placeholder is a `BucketSeries`)

### Requirement: Cached finer tiles merge into coarser ones
A tile that is not stored SHALL be served without a request from its two available children one level finer, at most 2 levels down, equal to the server's answer for it (mean within relative 1e-12), and SHALL NOT be stored. Origin: necessary consequence of D-040 (2) and its target: an aligned bucket aggregates exactly its two children's points (series-query "Reusable buckets for aligned requests"); merge rules: design Z3.

#### Scenario: Merge like the server
- **WHEN** two adjacent level-10 bucket tiles of a fake signal with SNA points are merged into their level-11 parent, and two raw tiles likewise
- **THEN** the bucket parent equals the fake server's level-11 tile (count, sna, min, max exactly, mean within 1e-12 relative) and the raw parent equals the fake server's raw answer for its range, edge neighbours included
- **Evidence:** `apps/web/test/tiles.test.ts` › "merges two child tiles into their parent like the server"

#### Scenario: Zoom out over loaded tiles
- **WHEN** a cache holds level-10 tiles 0 to 3 of a signal and `find` asks for level-11 tile 0, level-12 tile 0 and level-13 tile 0
- **THEN** the first two return tiles without a fetch and are not stored (`peek` undefined); the third returns undefined
- **Evidence:** `apps/web/test/cache.test.ts` › "finds a tile merged from cached children, at most two levels down"

### Requirement: Prefetch when the view rests
When a window's shown range has rested 300 ms with its loads done, it SHALL prefetch per signal the next coarser level over three view widths and its own level one view width on each side, skipping cached, unstorable and out-of-extent tiles, at most 256 tiles per rest. A range change SHALL cancel prefetch no visible load wants; none starts while the range changes. Origin: D-040 (3) („prefetch in idle time"); numbers: design Z7.

#### Scenario: Prefetch after rest, none during the gesture
- **WHEN** a loader with prefetch gets a changing view every 50 ms for 1 s, then rests on `[0, 1000 × 2^20)` with target 1001 whose tiles are answered
- **THEN** no prefetch request is sent during the second of changes; 300 ms after the last change the prefetch requests are `{from −1073741824, to 2147483648, target 1537}` (level 21, tiles −2…3), `{from −1073741824, to 0, target 1025}` and `{from 1073741824, to 2147483648, target 1025}` (level 20, tiles −4…−1 and 4…7), at most two in flight at once
- **Evidence:** `apps/web/test/loader.test.ts` › "prefetches after the view rests, never during a gesture"; `apps/web/test/tiles.test.ts` › "plans the prefetch: next coarser level three views wide, one view each side"

#### Scenario: Gesture cancels the prefetch
- **WHEN** prefetch requests are in flight or queued and the shown range changes to a view that wants none of their tiles
- **THEN** the running ones are aborted and the queued ones are never sent
- **Evidence:** `apps/web/test/loader.test.ts` › "prefetches after the view rests, never during a gesture"; `apps/web/test/cache.test.ts` › "drops a queued prefetch run nobody wants"

#### Scenario: Zoom out after rest is cached
- **WHEN** a window on V_ANZ has rested for 2 s and is then zoomed out ×2 with one Ctrl+wheel event at the plot centre
- **THEN** no `/api/series` request starts before t0 + 290 ms and there is exactly one stroke burst before t0 + 1,000 ms, within 50 ms (the first frame of the new range draws sharp data)
- **Evidence:** UI timing check (design T1, step 4)

### Requirement: Prefetch never delays visible loads
At most 2 prefetch requests SHALL be in flight per tab; further prefetch requests wait in the browser. Visible loads SHALL start without waiting for prefetch; a waiting prefetch request whose tile a visible load wants SHALL start at once as a visible load. Origin: D-040 (3) („in idle time"); the number: design Z3, against `KIPSCOPE_QUERY_CONCURRENCY` 4 (`apps/server/src/config.ts`).

#### Scenario: Two in flight, visible first
- **WHEN** four prefetch runs are queued, then a visible load for other tiles arrives, then one prefetch run answers
- **THEN** two prefetch fetches start at first, the visible fetch starts at once (third call), and the third prefetch fetch starts only after the answer
- **Evidence:** `apps/web/test/cache.test.ts` › "runs at most two prefetch requests at once, visible loads first"

#### Scenario: Visible load wants a queued prefetch tile
- **WHEN** a prefetch run is queued and a visible load asks for one of its tiles
- **THEN** that run is fetched at once and the visible load completes from it
- **Evidence:** `apps/web/test/cache.test.ts` › "starts a queued prefetch run at once when a visible load wants it"

### Requirement: Zoom timing
On localhost with real data, a fully cached zoom SHALL draw sharp data in the first frame of the new range, within 50 ms of the wheel event; an uncached zoom SHALL draw a placeholder in that frame within 50 ms, start its request within 50 ms and draw sharp data within 200 ms. Origin: D-040 targets („within one frame (~16 ms)", „sharp data within ~150 ms"); bounds with frame wait and measurement: design T1.

#### Scenario: Uncached zoom in
- **WHEN** a window shows `smart451/COMBI_412h.V_ANZ` from 2026-10-13T09:00:00Z to 10:00:00Z, has rested 2 s, and one Ctrl+wheel event with deltaY −500 arrives at the plot centre
- **THEN** the first stroke burst is within 50 ms, a `/api/series` request starts within 50 ms, and the last stroke burst before t0 + 290 ms is within 200 ms and after that request's response end
- **Evidence:** UI timing check (design T1, step 2), median of 3 runs, each on a fresh 1 h range

#### Scenario: Cached zoom out
- **WHEN** after that zoom has rested 2 s one Ctrl+wheel event with deltaY +500 arrives at the plot centre (back to the 1 h view)
- **THEN** no `/api/series` request starts before t0 + 290 ms and there is exactly one stroke burst before t0 + 1,000 ms, within 50 ms
- **Evidence:** UI timing check (design T1, step 3)

## MODIFIED Requirements

### Requirement: Render acknowledgement unchanged
A window SHALL count as settled when every tile of each signal's committed view is present or its request failed and the drawn data is that view's own: a shown preview range that differs from the committed range, a placeholder, or a pending throttled load SHALL NOT count as settled. A fully cached committed view SHALL be settled at once. Origin: necessary consequence of D-005/D-011 (`--wait` reports the rendered state) and series-cache "Loaded series data stays in the tab"; placeholders and previews are not the committed revision's data (D-040 (1), (2)).

#### Scenario: Cached view settles at once
- **WHEN** a window's new view is fully cached
- **THEN** the loader is settled in the same update, with no pending request
- **Evidence:** `apps/web/test/loader.test.ts` › "is settled only when every current request has finished" (kept) and "draws a previous view again without a request" (settled right after the update); UI check with the CLI: on a window `<w>` zoomed from its overview into one hour, `kipscope --wait window range <w> <the overview's from> <the overview's to>` exits 0 and reports `complete`

#### Scenario: Placeholder does not settle
- **WHEN** a loader shows a placeholder for its current request
- **THEN** `settled` is false until the sharp data has arrived, and true right after
- **Evidence:** `apps/web/test/loader.test.ts` › "shows a placeholder at once and sharp data after the response" (checks `settled` before and after); UI check with the CLI: `kipscope --wait window range <w>` to a range not loaded before exits 0 with `complete`

#### Scenario: Acknowledged on the committed range
- **WHEN** a window previews a range during a gesture
- **THEN** its acknowledgement is computed from the requests of the committed range, not the shown one
- **Evidence:** command `grep -n "loader.settled(committedRequests)" apps/web/src/chart/TimeseriesWindow.tsx` prints one line
