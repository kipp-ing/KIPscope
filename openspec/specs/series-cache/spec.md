# series-cache Specification

## Purpose
TBD - created by archiving change add-series-cache. Update Purpose after archive.

## Requirements

### Requirement: Loaded series data stays in the tab
Loaded series data SHALL stay in the tab's memory until the tab closes or reloads and SHALL serve every later view of the same signal, bucket width and time; a fully cached view SHALL be drawn without a request or loading state. Origin: D-037 (3) („loaded once stays in the browser's memory until the tab closes … so zooming and panning back is fast"); concept §2 („Bereits für eine Ansicht geladene Daten bleiben … nutzbar").

#### Scenario: Zoom back to a previous view
- **WHEN** a window shows a signal on view A, zooms to view B, both loads complete, and the window returns to view A (history back or the same range again)
- **THEN** no further series request is sent and the signal's state for view A is complete at once, with no loading state in between
- **Evidence:** `apps/web/test/loader.test.ts` › "draws a previous view again without a request"; UI check: window with `ICL_3A2h.SPEED_DISP` on its full extent, rectangle-zoom into one hour, wait for the curve, Backspace; the network log (filtered to `/api/series`) shows no request after the Backspace and the overview curve is drawn without a loading mark

#### Scenario: Re-add a removed signal
- **WHEN** a signal is removed from a window after its load completed and is added to the same window again on the same range
- **THEN** no series request is sent for it and it is drawn at once
- **Evidence:** `apps/web/test/loader.test.ts` › "serves a re-added signal from the cache"; UI check: remove `ICL_3A2h.SPEED_DISP` from a window and drop it back in; the network log shows no `/api/series` request for it

### Requirement: Fixed bucket widths and tiles
A view SHALL load its data as tiles of 256 buckets, each starting at a multiple of its span; the bucket width is the largest power of two ns at or below `ceil((to − from) / (target − 1))` (at least 1 ns), giving `target − 1` to 2 × (`target` − 1) buckets. A view SHALL use every tile that touches its range. Origin: necessary consequence of D-037 (3) (exact ranges are never reused); snapping down: D-038 („never coarser than before the cache").

#### Scenario: Power-of-two width
- **WHEN** a view of 1,000 × 2^20 ns starting at 0 is computed for target 1001
- **THEN** its bucket width is 2^20 ns, its tile span 2^28 ns, and it touches tiles 0 to 3
- **Evidence:** `apps/web/test/tiles.test.ts` › "picks the power-of-two width and the touched tiles"

#### Scenario: Width never coarser than today
- **WHEN** a view of ten hours is computed for target 2000
- **THEN** its bucket width is 2^34 ns (≈ 17.2 s), at most today's 18,009,004,503 ns, so about 2,096 buckets cover the view: at least today's 1,999, fewer than twice as many
- **Evidence:** `apps/web/test/tiles.test.ts` › "picks the power-of-two width and the touched tiles"

### Requirement: Only missing tiles are requested
A view SHALL request only tiles that are neither cached nor already being loaded, and SHALL request adjacent missing tiles of one signal together as one tile-aligned series request. Origin: D-037 (3) („so zooming and panning back is fast"); concept §5 („Daten werden bedarfsgerecht … abgefragt").

#### Scenario: First view
- **WHEN** a window with one signal opens on `[0, 1,000 × 2^20)` ns with target 1001 and nothing is cached
- **THEN** exactly one series request is sent, for `from` 0, `to` 1,073,741,824 and target 1025
- **Evidence:** `apps/web/test/loader.test.ts` › "requests only the tiles a pan uncovers"

#### Scenario: Pan by half a view
- **WHEN** that view has loaded and the window pans to `[524,288,000, 1,572,864,000)` ns
- **THEN** exactly one more request is sent, for `from` 1,073,741,824, `to` 1,610,612,736 and target 513
- **Evidence:** `apps/web/test/loader.test.ts` › "requests only the tiles a pan uncovers"; UI check: pan a loaded SPEED_DISP window by a few horizontal swipes back and forth; the network log shows requests only while new time comes into view

### Requirement: Raw tiles serve finer zooms
A tile that was loaded as raw points SHALL serve every finer bucket width inside its time span, without a request. Origin: necessary consequence of D-037 (3) and series-query "Raw points": raw points are the unmodified data, valid at any zoom where raw points are shown.

#### Scenario: Zoom further into raw data
- **WHEN** a view's tiles came back as raw points and the window zooms in by a factor of 4 inside that view
- **THEN** no request is sent and the new view shows exactly the raw points of its range, with the nearest point before and after as edge neighbours
- **Evidence:** `apps/web/test/loader.test.ts` › "zooms into raw tiles without a request"; `apps/web/test/tiles.test.ts` › "derives a finer raw tile with its edge neighbours"; UI check: zoom SPEED_DISP to 2026-10-13T09:56:59Z – 09:57:01Z (raw), wait, then Ctrl+wheel-zoom in twice; no `/api/series` request in the network log

### Requirement: Same drawn data as without cache
A view SHALL draw the raw points or complete buckets its tiles returned: raw inside its range with the nearest outside points as edge neighbours when all touched tiles are raw, else the buckets touching its range, raw tiles aggregated by the series-query bucket rules. SNA stays SNA. Origin: concept §2 („für Zeichnung und Cursor nutzbar"); D-032/D-034 (the live cursor reads the drawn data); D-010.

#### Scenario: Stitched raw tiles
- **WHEN** three adjacent raw tiles with an SNA point in the middle tile are stitched for a view inside them
- **THEN** the result holds exactly the points inside the view in time order, the SNA point as null, and the neighbours just outside the view from the tiles (or the outer tiles' own neighbours)
- **Evidence:** `apps/web/test/tiles.test.ts` › "stitches raw tiles like one request"

#### Scenario: Mixed raw and bucket tiles
- **WHEN** a view touches one raw tile (at the end of the recording) and one bucket tile
- **THEN** the view draws buckets; the raw tile's points become buckets of the view's width with the same count, SNA count, mean, minimum and maximum the server would compute
- **Evidence:** `apps/web/test/tiles.test.ts` › "aggregates raw tiles to buckets in a mixed view"

#### Scenario: Live cursor on cached data
- **WHEN** a window is drawn entirely from the cache and the pointer hovers it
- **THEN** the L cells show values as for freshly loaded data
- **Evidence:** `apps/web/test/live.test.ts` passes unchanged; UI check: after a zoom back (first scenario), hover; the L column shows values

### Requirement: Size limit, least recently used dropped first
The cache SHALL hold at most 4,000,000 values, counting 2 per raw point (edge neighbours included), 6 per bucket and 16 per tile. When a new tile would exceed the limit, the tiles used longest ago SHALL be dropped first until it fits; using a tile for a view counts as a use. Data a window currently shows SHALL stay drawn when its tiles are dropped. Origin: D-037 (3) („with a size limit (oldest dropped first)"); the number: design C5.

#### Scenario: Oldest used tile dropped
- **WHEN** a cache with room for two tiles holds tiles A and B, A is used again, and tile C is stored
- **THEN** B is dropped, A and C stay, and the cache's size is the sum of A's and C's values
- **Evidence:** `apps/web/test/cache.test.ts` › "drops the least recently used tile first"

#### Scenario: Shown data survives eviction
- **WHEN** the tiles of a window's current view are dropped from the cache
- **THEN** the window keeps drawing them and its state stays complete; only a later view needs a new request
- **Evidence:** `apps/web/test/loader.test.ts` › "keeps drawing a view whose tiles were dropped"

### Requirement: Not persisted
The cache SHALL live in the tab's memory only: a reload or a new tab starts empty, and nothing of it is written to browser storage. Origin: D-037 (3) („Not persisted across reloads"); concept §2 („ein eigener dauerhafter Datencache … gehören nicht zum Umfang").

#### Scenario: Reload starts empty
- **WHEN** the page is reloaded after views were loaded
- **THEN** every window requests its series again
- **Evidence:** UI check: reload, the network log shows `/api/series` requests for every shown signal; command `grep -nE "localStorage|sessionStorage|indexedDB" apps/web/src/chart/cache.ts apps/web/src/chart/tiles.ts apps/web/src/chart/loader.ts` prints nothing

### Requirement: One cache for all windows
All timeseries windows of a tab SHALL share one cache. A tile that one window is loading SHALL NOT be requested again by another window; both SHALL use the one response. A request SHALL be aborted only when no window wants any of its tiles any more. Origin: D-037 (3) (data loaded once stays in the browser); necessary consequence of design D7 (an abort reaches ClickHouse, so dropping a still-wanted request would waste the query).

#### Scenario: Two linked windows on the same signal
- **WHEN** two windows with the same width show the same signal on the same range and both start loading
- **THEN** one series request is sent and both windows complete from it
- **Evidence:** `apps/web/test/loader.test.ts` › "shares one request between two windows"

#### Scenario: One window moves on
- **WHEN** of those two windows one moves to another range while the request is in flight
- **THEN** the request is not aborted and the other window completes from it
- **Evidence:** `apps/web/test/cache.test.ts` › "aborts a run only when nobody wants it"

#### Scenario: Nobody wants it any more
- **WHEN** the only window wanting a request moves to a range none of whose tiles it covers
- **THEN** that request is aborted and its tiles are not stored
- **Evidence:** `apps/web/test/cache.test.ts` › "aborts a run only when nobody wants it"

### Requirement: Stale responses only fill the cache
A response that arrives after its window moved on SHALL NOT change what that window shows; it MAY be stored in the cache. Origin: concept §10 („Veraltete Abfrageantworten dürfen keinen neueren Zoomzustand überschreiben").

#### Scenario: Late response for an old view
- **WHEN** a window zooms twice quickly, the second view's tiles arrive first, and the first view's request still arrives afterwards because another window wanted it
- **THEN** the window shows the second view's data and the first view's tiles are in the cache
- **Evidence:** `apps/web/test/loader.test.ts` › "ignores a response that arrives after a newer request's response" (kept) and "lets a late response fill the cache only"

### Requirement: Recent data is not kept
A tile whose end lies less than 1 hour before the browser's current time, or after it, SHALL be used for the views waiting for it but SHALL NOT be stored, so data still being written is requested again by every later view. Origin: necessary consequence of D-037 (3) (a cached tile must show what a new request would show); the margin: design Q1 (recommended, built as recommended).

#### Scenario: Tile near now
- **WHEN** the clock reads T and a tile ending at T − 30 min arrives
- **THEN** its view completes from it, and the next view needing that tile requests it again
- **Evidence:** `apps/web/test/cache.test.ts` › "does not store tiles that end within the last hour"

### Requirement: Failed tiles are not kept
A failed request SHALL mark the signal of each waiting view as failed with the error message and SHALL store none of its tiles; the next view that needs those tiles SHALL request them again. Origin: timeseries-window "Loading and error state"; concept §10 („Fehler … müssen erkennbar bleiben").

#### Scenario: Request fails, then retried
- **WHEN** a tile request fails and the window then moves to a view that needs the same tiles
- **THEN** the first view's signal shows the error, and the second view sends a new request for the tiles
- **Evidence:** `apps/web/test/loader.test.ts` › "marks a failed signal and leaves the others alone" (kept) and "requests failed tiles again for the next view"

### Requirement: Render acknowledgement unchanged
A window SHALL count as settled when every tile of each signal's committed view is present or its request failed and the drawn data is that view's own: a shown preview range that differs from the committed range, a placeholder, or a pending throttled load SHALL NOT count as settled. A fully cached committed view SHALL be settled at once. A failed signal SHALL count as settled while it keeps data of another view and while its retry is only scheduled; while a retry loads, the window SHALL NOT be settled, and when the retry ends the window SHALL acknowledge the same revision again (`complete` if it succeeded, `error` if it failed). Origin: necessary consequence of D-005/D-011 (`--wait` reports the rendered state) and series-cache "Loaded series data stays in the tab"; placeholders and previews are not the committed revision's data (D-040 (1), (2)). Retries: D-042 (1), (2), with the acknowledgement behaviour as a necessary consequence (a failure stays reportable to `--wait`, and a recovered window must not keep reporting its old error).

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

#### Scenario: Settled while failed, not while a retry loads
- **WHEN** a signal's load fails, then its retry starts, then the retry answers
- **THEN** `settled` is true after the failure (state `error`), false while the retry loads, and true again after the answer (state `complete`, no `error`)
- **Evidence:** `apps/web/test/loader.test.ts` › "is settled while failed, not while a retry loads"; command `grep -n "JSON.stringify(\[revision, errors\])" apps/web/src/App.tsx` prints one line (the acknowledgement repeats a revision whose errors changed, design R5); lead's manual check (design R8): with the tunnel down, `kipscope --wait window range <w> <its current from> <its current to>` reports render status `error`; after the tunnel is back and without any command, `GET /api/render-status` shows this browser's last acknowledgement for the same revision as `complete` within 35 s

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
For every signal a window shows, the tab SHALL fetch its extent once per scope and use one coarse level of 1,024 to 2,048 buckets over the whole extent as ordinary tiles: requested as a visible load before the view when the view's level is at or above the overview's (the view is then computed from it); computed from the view's tiles when the view's level is below the overview's and the view's tiles span the extent; else requested after the signal's first view has loaded, as before. A window SHALL keep the overview tiles while it shows the signal, even when the cache drops them; a failed load is tried again when a window next adds the signal. A failed overview request that a view waits for SHALL fail that view like its own request. Origin: D-040 (2) („a coarse overview of each signal's whole extent loaded once"); size: design Z2 and D-043, unchanged; order: the report's P4 („fetch extent first …, then the overview once, and derive the view tiles from it"), agreed by Jan on 2026-10-22.

#### Scenario: Overview requested once
- **WHEN** two loaders of one tab each show a signal whose extent is `0` … `4294967295` on the view `[0, 262144)` at target 257 (level 10, below the overview's level 22) and both first views have loaded
- **THEN** the extent is fetched once, before any series request; the view is requested once `{0, 262144, 257}` and, only after it has answered, exactly one series request `{from 0, to 4294967296, target 1025}` (level 22, tiles 0…3) for the overview
- **Evidence:** `apps/web/test/loader.test.ts` › "loads the overview once per signal after its first view" (adjusted to the extent-first order)

#### Scenario: Overview serves the open view
- **WHEN** a loader with the window options opens DENSE on `[0, 4294967296)` at target 257 (level 24, above the overview's level 22)
- **THEN** the only series request is the overview `{0, 4294967296, 1025}`, it is fetched as a visible load (it does not wait for a prefetch slot), and the view completes with buckets of width 16777216 computed from it
- **Evidence:** `apps/web/test/loader.test.ts` › "opens on the extent with one series request per signal"; `apps/web/test/loader.test.ts` › "fetches the serving overview as a visible load" (two queued prefetch runs hold both slots; the overview request still starts at once)

#### Scenario: Overview from a wide view
- **WHEN** a loader with the window options opens SHIFTED (design W9, extent `536870912` … `4831838207`, overview level 22 tiles 0…4) on `[536870912, 4831838208)` at target 4001 (level 20, below the overview's level; its tiles 2…17 span the extent)
- **THEN** the only series request is the view `{536870912, 4831838208, 4097}`; afterwards the loader holds the five overview tiles without requesting them: tiles 1…3 found in the cache as before, tiles 0 and 4 (each with one child outside the view's tiles, which today cost the requests `{0, 1073741824, 257}` and `{4294967296, 5368709120, 257}`) computed, equal to `splitRun` of the fake server's answers to those two requests
- **Evidence:** `apps/web/test/loader.test.ts` › "computes the overview from a wide view's tiles"

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
When a window's shown range has rested 300 ms with its loads done, it SHALL prefetch per signal the next coarser level over three view widths and its own level one view width on each side, skipping cached, unstorable and out-of-extent tiles, at most 256 tiles per rest. A run of these tiles that the window's cover answers exactly (series-cache "Runs computed from a cover") SHALL be computed and stored instead of requested. A range change SHALL cancel prefetch no visible load wants; none starts while the range changes. Origin: D-040 (3) („prefetch in idle time"); numbers: design Z7; computed runs: the report's P4 („fetch finer tiles only on zoom").

#### Scenario: Prefetch after rest, none during the gesture
- **WHEN** a loader with prefetch gets a changing view every 50 ms for 1 s, then rests on `[0, 1000 × 2^20)` with target 1001 whose tiles are answered
- **THEN** no prefetch request is sent during the second of changes; 300 ms after the last change the prefetch requests are `{from −1073741824, to 2147483648, target 1537}` (level 21, tiles −2…3), `{from −1073741824, to 0, target 1025}` and `{from 1073741824, to 2147483648, target 1025}` (level 20, tiles −4…−1 and 4…7), at most two in flight at once
- **Evidence:** `apps/web/test/loader.test.ts` › "prefetches after the view rests, never during a gesture"; `apps/web/test/tiles.test.ts` › "plans the prefetch: next coarser level three views wide, one view each side"

#### Scenario: Gesture cancels the prefetch
- **WHEN** prefetch requests are in flight or queued and the shown range changes to a view that wants none of their tiles
- **THEN** the running ones are aborted and the queued ones are never sent
- **Evidence:** `apps/web/test/loader.test.ts` › "prefetches after the view rests, never during a gesture"; `apps/web/test/cache.test.ts` › "drops a queued prefetch run nobody wants"

#### Scenario: Zoom out after rest is cached
- **WHEN** a window on `COMBI_412h.V_ANZ` has rested for 2 s and is then zoomed out ×2 with one Ctrl+wheel event at the plot centre
- **THEN** no `/api/series` request starts before t0 + 290 ms and there is exactly one stroke burst before t0 + 1,000 ms, within 50 ms (the first frame of the new range draws sharp data)
- **Evidence:** UI timing check (design T1, step 4)

#### Scenario: Prefetch computed from the overview
- **WHEN** a loader with the window options and prefetch opens DENSE on `[0, 4294967296)` at target 257 and rests 300 ms (today its plan requests level 25 tile 0, whose level-24 children are not both cached)
- **THEN** no prefetch request is sent, and afterwards the cache answers level 25 tile 0 without a request
- **Evidence:** `apps/web/test/loader.test.ts` › "prefetches nothing the overview answers"

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
- **WHEN** a window shows `smart451/ICL_3A2h.SPEED_DISP` from 2026-10-13T09:00:00Z to 10:00:00Z, has rested 2 s, and one Ctrl+wheel event with deltaY −500 arrives at the plot centre
- **THEN** the first stroke burst is within 50 ms, a `/api/series` request starts within 50 ms, and the last stroke burst before t0 + 290 ms is within 200 ms and after that request's response end
- **Evidence:** UI timing check (design T1, step 2), median of 3 runs, each on a fresh 1 h range

#### Scenario: Cached zoom out
- **WHEN** after that zoom has rested 2 s one Ctrl+wheel event with deltaY +500 arrives at the plot centre (back to the 1 h view)
- **THEN** no `/api/series` request starts before t0 + 290 ms and there is exactly one stroke burst before t0 + 1,000 ms, within 50 ms
- **Evidence:** UI timing check (design T1, step 3)

### Requirement: Failed loads retry with backoff
A signal whose series load failed with a retryable error (no HTTP status, or status ≥ 500) SHALL be loaded again by itself after 1, 2, 4, 8, 16 s for the first five failures in a row and 30 s after each later one; a complete load SHALL reset this to 1 s. A 4xx failure SHALL NOT be retried by itself. Origin: D-042 (1) („retries by itself with backoff 1, 2, 4 … 30 s"); data fact: 502 `source_error` for ~5 min. 4xx: necessary consequence (refused again by series-query rules). Numbers: design R2.

#### Scenario: Backoff until the source is back
- **WHEN** a loader with the window options requests one signal whose fetch fails at once with HTTP 502 seven times and then answers
- **THEN** the fetches start at 0, 1, 3, 7, 15, 31 and 61 s, the eighth at 91 s, none in between, and after the eighth the state is `complete`
- **Evidence:** `apps/web/test/loader.test.ts` › "retries a failed load with backoff 1, 2, 4, 8, 16, 30 s"

#### Scenario: Success resets the backoff
- **WHEN** a signal failed twice (retried after 1 s, then waiting 2 s), its third fetch answers, and a later view of it fails
- **THEN** the retry of the later view starts 1 s after that failure
- **Evidence:** `apps/web/test/loader.test.ts` › "resets the backoff after a complete load"

#### Scenario: Error answers carry their status
- **WHEN** `/api/series` answers 502 with an `ApiError` body `source_error`, 502 with a non-JSON body, or 404 with `unknown_signal`
- **THEN** the fetch rejects with an error whose status is 502, 502 and 404, whose message is `source_error: …`, `http_502: …` and `unknown_signal: …`, and which counts as retryable, retryable and not retryable
- **Evidence:** `apps/web/test/api.test.ts` › "throws errors with HTTP status and code" (stubbed global `fetch`)

#### Scenario: Client errors wait for the user
- **WHEN** a signal's fetch fails with HTTP 404 `unknown_signal`
- **THEN** no further fetch starts within 120 s, and the state stays `error`
- **Evidence:** `apps/web/test/loader.test.ts` › "does not retry a 4xx failure by itself"

### Requirement: Retry at once on recovery
A failed signal SHALL be retried at once when any `/api/series` request of the tab succeeds or the live channel opens again, but not sooner than 1 s after its last failure; such a retry SHALL NOT reset the backoff. A success of another request SHALL pull a signal forward only once per run of failures in a row; after that, until the signal completes, only the backoff, the live channel opening and the same request again retry it. Origin: D-042 (1) („at once when a request succeeds again or the live channel reconnects"). The 1 s floor: necessary consequence (else a signal that keeps failing is fetched after every other answer); value: design R3. Once per run: design H9, Jan's answer to Q1 (2026-10-16).

#### Scenario: Another request succeeds
- **WHEN** signal A of window 1 has failed four times in a row (next retry due 8 s after the fourth failure) and 3 s after that failure a series request of window 2 on the same tab cache answers
- **THEN** A's fetch starts right after that answer, not 8 s after its failure
- **Evidence:** `apps/web/test/loader.test.ts` › "retries at once when another request of the tab succeeds"

#### Scenario: Floor of 1 s
- **WHEN** signal A failed for the third time at time F (next retry due at F + 4 s) and another request of the tab answers at F + 0.5 s
- **THEN** A's next fetch starts at F + 1 s
- **Evidence:** `apps/web/test/loader.test.ts` › "retries at once on recovery, not sooner than 1 s after the failure"

#### Scenario: Live channel reconnects
- **WHEN** signal A has failed three times in a row and the tab cache is told that the live channel opened
- **THEN** A's fetch starts at once (at least 1 s after its last failure)
- **Evidence:** `apps/web/test/loader.test.ts` › "retries at once when the cache reports a recovery"; command `grep -n "tabSeriesCache().recover()" apps/web/src/live.ts` prints one line, inside the `onopen` handler

#### Scenario: A signal that keeps failing is pulled forward once
- **WHEN** signal A fails at F1, another request of the tab answers at F1 + 0.2 s, A's pulled retry fails at F2 = F1 + 1 s, and from then on other requests of the tab answer every 100 ms for 10 s while A keeps failing
- **THEN** A's fetches after F2 start only at the backoff times (F2 + 2 s, then 4 s after that failure), not after the other answers
- **Evidence:** `apps/web/test/loader.test.ts` › "pulls a failing signal forward once per run of failures"

#### Scenario: Reconnect pulls forward again
- **WHEN** signal A was already pulled forward once in its current run of failures, and the live channel opens 2 s after A's last failure
- **THEN** A's fetch starts at once
- **Evidence:** `apps/web/test/loader.test.ts` › "a live reconnect pulls a failing signal forward again"

### Requirement: Same request retries a failed load
When a failed signal's request comes again unchanged, the window SHALL retry it at once (not sooner than 1 s after the failure), also after a 4xx; for a loading or complete signal nothing SHALL be fetched. Origin: D-042 (1) („setting the same range again also retries"); data fact: after the tunnel was back, a tab with an unchanged range kept its errors (D-042 „Why").

#### Scenario: Same range again
- **WHEN** a signal has failed three times in a row with HTTP 502 (next retry due 4 s later) and 2 s later the loader gets an update with the identical request in a new array
- **THEN** its fetch starts in that update (or at the end of a running throttle interval)
- **Evidence:** `apps/web/test/loader.test.ts` › "retries a failed load at once when the same request comes again"

#### Scenario: Same range after a client error
- **WHEN** a signal failed with HTTP 404 and 2 s later the loader gets the identical request again
- **THEN** its fetch starts in that update
- **Evidence:** `apps/web/test/loader.test.ts` › "does not retry a 4xx failure by itself" (second half)

#### Scenario: No refetch of a complete request
- **WHEN** a signal's request is complete and the identical request comes again
- **THEN** no fetch starts and `onChange` is not called
- **Evidence:** `apps/web/test/loader.test.ts` › "does not refetch an unchanged request and aborts removed signals" (existing, stays green)

### Requirement: Retries stop when the view is no longer wanted
A scheduled or running retry SHALL be cancelled when its signal leaves the window, its view changes (the new view loads as usual and a failure of it continues the backoff), or the window closes; a retry SHALL always load the current view. Origin: D-042 (1); necessary consequence of "Stale responses only fill the cache".

#### Scenario: Signal removed while waiting
- **WHEN** a signal failed and is removed from the loader before its retry is due
- **THEN** no fetch starts within the next 60 s
- **Evidence:** `apps/web/test/loader.test.ts` › "stops retrying when the signal is removed, the view changes or the loader is disposed"

#### Scenario: View changed while waiting
- **WHEN** a signal's view A failed and the loader gets view B for it before A's retry is due
- **THEN** B is fetched at once, A is never fetched again, and when B fails its retry comes after the next delay of the sequence (2 s after a first failure of A)
- **Evidence:** same test

#### Scenario: Loader disposed
- **WHEN** a loader with a failed signal is disposed
- **THEN** no fetch starts within the next 60 s
- **Evidence:** same test

### Requirement: Retries share requests
A retry SHALL load like a visible load of the window: join a request in flight for the same tiles, complete from the tab cache without a request when the tiles meanwhile arrived, and pass the window's load throttle. Origin: D-042 (1); necessary consequence of "One cache for all windows" and "Loads during a gesture are throttled".

#### Scenario: Two windows retry with one request
- **WHEN** two loaders on one tab cache show the same signal and view, their shared request fails, and both retries come due at the same time
- **THEN** one fetch starts for them, and both states become `complete` from its answer
- **Evidence:** `apps/web/test/loader.test.ts` › "two windows retry with one request"

#### Scenario: Retry served by the cache
- **WHEN** a signal's view failed in window 1 and window 2 loads the same tiles before window 1's retry is due
- **THEN** window 1 becomes `complete` without a fetch of its own, at the recovery trigger of window 2's answer (1 s after its failure at the earliest)
- **Evidence:** `apps/web/test/loader.test.ts` › "a retry completes from the cache without a request"

### Requirement: Prefetch failures dropped, overview restarted
A failed prefetch request SHALL NOT be retried. A failed overview SHALL be started again after the signal's next complete view and not otherwise. Origin: necessary consequences of "Prefetch when the view rests" (prefetch draws nothing) and D-042 (2) (without the restart a window gets no placeholders after an outage until the signal is added again).

#### Scenario: Prefetch failure dropped
- **WHEN** a loader with the window options rests after its view completed and every prefetch request fails with HTTP 502
- **THEN** none of those prefetch tiles is fetched again within the next 120 s while the view stays the same
- **Evidence:** `apps/web/test/loader.test.ts` › "does not retry a failed prefetch"

#### Scenario: Overview after the outage
- **WHEN** a signal's first view and its overview (extent request) fail, and its retry later completes
- **THEN** the extent is requested again right after that complete view, and once its tiles arrive placeholders come from it again
- **Evidence:** `apps/web/test/loader.test.ts` › "starts a failed overview again after a complete view"

### Requirement: Long views use tiles
Views and overviews whose span exceeds 2^53 ns (~104 days) SHALL load through the tile cache like shorter ones, as long as their tiles lie within the time bounds; only views outside the bounds SHALL fall back to an exact, uncached request. Origin: necessary consequence of D-043 (overview per signal's extent) and series-query "Exact times for any span": today a signal recorded over more than 104 days gets no overview and no placeholder. Design H1.

#### Scenario: A 200-day view is tileable
- **WHEN** `tileable` is asked for the tiles of a 200-day view at its level, and for a range whose last tile ends after `TIME_MAX`
- **THEN** it returns true and false
- **Evidence:** `apps/web/test/tiles.test.ts` › "views longer than 2^53 ns are tileable within the time bounds"

### Requirement: Malformed answers fail the load
A series answer whose times do not decode, whose kind is unknown or whose value arrays differ in length from its times SHALL fail that signal's load like a failed request (state `error`, legend `failed: …`), for tiled and exact loads alike; it SHALL NOT reach drawing. Origin: concept §10 („Fehler … müssen erkennbar bleiben"); necessary consequence: today the exact path stores the raw JSON and a bad answer blanks the app at draw time. Design H6.

#### Scenario: Exact view with a malformed answer
- **WHEN** an exact (non-tileable) view's fetch answers a raw result with 3 times and 2 values
- **THEN** the key's state is `error` with a message naming the malformed result, and `result` holds no part of that answer
- **Evidence:** `apps/web/test/loader.test.ts` › "fails an exact view whose answer is malformed"

#### Scenario: Tiled view with a malformed answer
- **WHEN** a tiled view's run answers with an offset `"abc"` in `t.dt`
- **THEN** the key's state is `error` and no tile of that run is stored
- **Evidence:** `apps/web/test/loader.test.ts` › "fails a tiled view whose answer is malformed"

### Requirement: Gaps across tile edges
Breaks, SNA marks and drawn values at gaps SHALL be the same whether a view's data comes from one request or is stitched from tiles, including a split whose two points lie in different tiles. Origin: necessary consequence of D-062 and series-cache "Same drawn data as without cache" (gaps are found on the stitched result, never per tile).

#### Scenario: Dropout at a tile edge
- **WHEN** raw points of a 20 ms signal with a dropout from the last point of one tile to the first point of the next are stitched for a view over both tiles, and the same points come back as one raw result
- **THEN** both give the same drawn columns (with the break) and the same drawn value inside the dropout (none `period_gap`)
- **Evidence:** `apps/web/test/build.test.ts` › "breaks a gap across a tile edge like one request"

### Requirement: Tiles kept across scopes
A scope change SHALL NOT clear the tab's tiles. A tile fetched under scope S that lies fully inside S SHALL be stored for every scope: under another scope it SHALL answer only when it lies inside that scope and, for a raw tile without its `before` or `after` point, when that scope does not reach past S on that side. Runs in flight SHALL be keyed by tile and scope. Origin: Jan („idealerweise wird auch der cache im browser sehr lange gehalten"); exploration "Caching plan" 1, accepted by D-086 Q6.

#### Scenario: Back to a seen session
- **WHEN** a cache with a fake fetch loads one window's tiles under entry 0's scope of C4, the scope changes to entry 2's, then back to entry 0's, and the window asks for the same range
- **THEN** the third load makes no fetch and draws the same data as the first
- **Evidence:** `apps/web/test/cache.test.ts` › "keeps tiles across scopes"

#### Scenario: Cut raw tile under a wider scope
- **WHEN** a raw tile inside scope S has no `before` point, and the same tile is asked under a scope starting 1 h before S, then under a scope starting at S's start
- **THEN** the first asks the server again; the second is served from memory
- **Evidence:** `apps/web/test/cache.test.ts` › "refetches a cut raw tile under a wider scope"

### Requirement: Edge tiles stored under their scope
A tile fetched under scope S that reaches past S's edge SHALL be stored under `scopeKey(S)` and answer only while that key is active, else be fetched again. It SHALL weigh in the tile limit and LRU and be dropped by it or when its key leaves the per-scope LRU of 4, whichever comes first (design K12). Origin: lead's decision after round 3 (replaces "Edge tiles not stored"); necessary consequence of D-078 („das nachladen muss für die nächste halt auch noch klappen").

#### Scenario: Edge tiles stored under the scope
- **WHEN** a cache with a fake fetch, under scope A = `{testcar, 100 s, 200 s}`, runs bucket tiles covering [64 s, 128 s), [128 s, 192 s) and [192 s, 256 s), then asks for the same three tiles under A again
- **THEN** the second ask makes no fetch; the middle tile is stored for every scope, the two outer ones under A's key
- **Evidence:** `apps/web/test/cache.test.ts` › "stores edge tiles under the scope that fetched them"

#### Scenario: Edge tile reused only in its scope
- **WHEN** after "Edge tiles stored under the scope" the scope changes to B = `{testcar, 110 s, 210 s}` (same tiles, cut at both ends again) and the three tiles are asked; then the scope goes back to A and they are asked; then scopes B, C, D and E (four keys other than A's) are entered in turn, and the scope goes back to A once more
- **THEN** under B only [64 s, 128 s) and [192 s, 256 s) are fetched (the middle tile comes from memory); back under A nothing is fetched; after B, C, D, E (A's key dropped from the LRU of 4) the two outer tiles are fetched again and the middle one is not
- **Evidence:** `apps/web/test/cache.test.ts` › "uses an edge tile only in the scope that fetched it"

### Requirement: Extents and gap info per scope
Signal extents and gap info SHALL be kept for the 4 most recently used scope keys, the least recently used dropped; in an object scope gap info SHALL be keyed by data ref and work window. Origin: exploration "Caching plan" 1 („Keep extents and gap info per scope key in a small LRU of four"), accepted by D-086 Q6; 4: the server's kept scope lists (add-scope Z10).

#### Scenario: Four scopes
- **WHEN** the tab enters scopes A, B, C, D, then A again, then E, then B
- **THEN** returning to A asks no extent or gap request; E drops B (least recently used); B then asks again
- **Evidence:** `apps/web/test/rescope.test.ts` › "keeps extents and gap info for four scopes"

### Requirement: Extent before the first load
A window SHALL get a signal's extent before it requests any series tile for that signal under the current scope, unless the view is complete from the cache. Once the extent is known, a load SHALL start within its `update` call. A failed extent request SHALL load the view at once, as before. Origin: data fact (ADX testers's measurement after `speed-up-adx`, 2026-10-22: `series` → `extent` → `series` → `series` per signal, serially); the report's P4, agreed by Jan on 2026-10-22.

#### Scenario: Extent before the first series request
- **WHEN** a loader with the window options (fake extent `0` … `4294967295`, fake signal DENSE of design W9) gets the view `[0, 4294967296)` at target 257 on an empty cache
- **THEN** within that `update` call the extent has been asked once and no series request has been sent; after the extent resolves exactly one series request is sent, `{from 0, to 4294967296, target 1025}`
- **Evidence:** `apps/web/test/loader.test.ts` › "asks the extent before the first series request"

#### Scenario: Cached view does not wait
- **WHEN** a loader with the window options gets a view whose tiles are all in the cache, for a signal whose extent it has never asked
- **THEN** the state is `complete` within that `update` call and no series request is sent for the view
- **Evidence:** `apps/web/test/loader.test.ts` › "draws a cached step at once, before the extent"

#### Scenario: Extent fails
- **WHEN** a loader with the window options gets the view `[0, 4294967296)` at target 257 and the extent request rejects
- **THEN** the view's own request `{from 0, to 4294967296, target 257}` is sent and, once answered, the state is `complete`; after that complete view the extent is asked again
- **Evidence:** `apps/web/test/loader.test.ts` › "loads the view first when the extent fails"

### Requirement: Runs computed from a cover
A run of missing tiles at or above the level of a cover the window holds (design W3) SHALL be computed from the cover, not requested, exactly when it equals the server's answer to that run's request (design W1); else it is requested. A run ending within the last hour (C6) SHALL be requested, except the view runs an open computes from its overview (design W5). Computed runs are stored like fetched ones. Origin: concept §2; D-038; series-cache "Same drawn data as without cache".

#### Scenario: Computed run equals the server's
- **WHEN** `deriveRun` computes runs from (a) raw source tiles whose run holds at most its target points, (b) raw source tiles whose run holds more, (c) bucket source tiles two and five levels finer than the run, each with SNA points, and the fake server answers the same run requests
- **THEN** `splitRun` of each computed result equals `splitRun` of the fake server's answer (raw points, text and edge neighbours exactly; buckets with `count`, `sna`, `min`, `max` exactly and `mean` within 1e-12 relative)
- **Evidence:** `apps/web/test/tiles.test.ts` › "derives a run like the server from raw tiles" and "derives a run like the server from finer bucket tiles"

#### Scenario: Buckets cannot give raw
- **WHEN** `deriveRun` is asked for a run that holds at most its target points from bucket source tiles
- **THEN** it returns undefined
- **Evidence:** `apps/web/test/tiles.test.ts` › "derives nothing where the server would answer raw from buckets"

#### Scenario: Requested where the overview cannot answer
- **WHEN** after the open of DENSE on `[0, 4294967296)` at target 257 (bucket overview at level 22) the view changes to `[4294967296, 8589934592)` at target 257, which holds no points
- **THEN** exactly one series request `{from 4294967296, to 8589934592, target 257}` is sent and the view completes with its answer
- **Evidence:** `apps/web/test/loader.test.ts` › "requests the run the overview cannot answer"

#### Scenario: Zoom out above the overview without a request
- **WHEN** after the open of DENSE on `[0, 4294967296)` at target 257 the view zooms out to `[−4294967296, 8589934592)` at target 257 (level 25, three levels above the overview)
- **THEN** within that `update` call the state is `complete`, no series request is sent, and the result equals that of a loader without options on its own cache for the same view
- **Evidence:** `apps/web/test/loader.test.ts` › "zooms out above the overview without a request"

#### Scenario: Computed run stored like a fetched one
- **WHEN** `SeriesCache.put` stores a computed run of three tiles under a scope whose edges cut its first and last tile, then `find` asks for the three tiles, and the same run is fetched through `load` on a second cache
- **THEN** both caches hold the same tiles under the same IDs (the outer two as edge tiles under the scope's key), `put` sends no request and calls no recovery listener, and a tile ending within the last hour is returned by `put` but not stored
- **Evidence:** `apps/web/test/cache.test.ts` › "stores a computed run like a fetched one"

### Requirement: One series request per signal on open
Opening a workspace, or stepping to a session the preload has not stored, SHALL send per window signal whose view spans its extent one extent and one series request, draw what a loader without overview draws, and send no further series request without `case=` for it within 2 s of rest, unless no cover answers a run exactly. Origin: the report's P4 („Opening a session issues one series fetch per signal"), agreed by Jan on 2026-10-22 without P3.

#### Scenario: Open on the extent, every window width
- **WHEN** loaders with the window options and prefetch open DENSE and, separately, SPARSE (design W9) on `[0, 4294967296)` at targets 257, 1025 and 4001, each on an empty cache, and rest 2 s with every request answered
- **THEN** each open sends exactly one extent request and one series request (target 257 and 1025: the overview `{0, 4294967296, 1025}` for DENSE, `{0, 4294967296, 2049}` for SPARSE; target 4001: the view `{0, 4294967296, 4097}`), and each complete result equals that of a loader without options on its own cache for the same view
- **Evidence:** `apps/web/test/loader.test.ts` › "opens on the extent with one series request per signal" and "draws on open what a loader without overview draws"

#### Scenario: Step to a session the view spans
- **WHEN** a loader with the window options has completed STEP (design W9) on `[0, 4294967296)` at target 257, then `rescope()` runs with the new extent `8589934592` … `12884901887` (the same points shifted by 2^33 ns) and the request changes to `[8589934592, 12884901888)` at target 257
- **THEN** the extent is asked once more and exactly one series request `{from 8589934592, to 12884901888, target 1025}` is sent; the view completes with the result a loader without options draws for it
- **Evidence:** `apps/web/test/loader.test.ts` › "steps to a session the view spans with one series request"

#### Scenario: Step to a narrower view
- **WHEN** the same, but the request changes to `[8589934592, 8858370048)` at target 257 (level 20, below the overview's level 22, not spanning the extent)
- **THEN** after the extent the view's request `{from 8589934592, to 8858370048, target 257}` is sent first, and the overview request `{from 8589934592, to 12884901888, target 1025}` only after the view has answered
- **Evidence:** `apps/web/test/loader.test.ts` › "steps to a narrower view: view first, overview after it"

#### Scenario: Open on carserver
- **WHEN** on smart451 (ClickHouse, real data) with the tab in front, a workspace with two timeseries windows of two signals each (`COMBI_412h.V_ANZ`, `BS_200h.DVL`, `BS_208h.DHL`, `BS_208h.DHR`), each window double-clicked to its signals' extents and resting, is reloaded
- **THEN** the network log shows for each of the four signals one `/api/extent?signal=<id>` and exactly one `/api/series?signal=<id>` without `case=`, started after that extent request ended, whose `from` is at most the extent's `first` and whose `to` is above its `last`; within 2 s after the last curve is drawn no further `/api/series` without `case=` for these signals appears; all four curves are drawn without a loading or failed mark
- **Evidence:** UI check on carserver (network log filtered to `/api/`, one screenshot of the drawn windows)

#### Scenario: Step without preload on carserver
- **WHEN** on smart451 with a catalog from `kipscope case drives smart451` open at drive 2, both windows of the previous scenario double-clicked to their signals' extents and resting, the user presses `]` twice within 300 ms (drive 4 is not preloaded)
- **THEN** for drive 4's scope the network log shows per signal one `/api/extent` and, until its curve is drawn, at most two `/api/series` without `case=` (view and overview; exactly one for every signal whose window's new header range spans that extent answer); after that only the window's ordinary prefetch at rest (Z7) may add `/api/series` for tiles no cover answers exactly, such as the neighbour tile one view width before the view (seen in round 2: a 550 s tile at target 257 after `COMBI_412h.V_ANZ`'s overview); all curves of drive 4 are drawn
- **Evidence:** UI check on carserver (network log filtered to `/api/`, one screenshot after drive 4 is drawn)
