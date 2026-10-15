# series-cache Specification

## Purpose
TBD - created by archiving change add-series-cache. Update Purpose after archive.

## Requirements

### Requirement: Loaded series data stays in the tab
Loaded series data SHALL stay in the tab's memory until the tab closes or reloads and SHALL serve every later view of the same signal, bucket width and time; a fully cached view SHALL be drawn without a request or loading state. Origin: D-037 (3) („loaded once stays in the browser's memory until the tab closes … so zooming and panning back is fast"); concept §2 („Bereits für eine Ansicht geladene Daten bleiben … nutzbar").

#### Scenario: Zoom back to a previous view
- **WHEN** a window shows a signal on view A, zooms to view B, both loads complete, and the window returns to view A (history back or the same range again)
- **THEN** no further series request is sent and the signal's state for view A is complete at once, with no loading state in between
- **Evidence:** `apps/web/test/loader.test.ts` › "draws a previous view again without a request"; UI check: window with `COMBI_412h.V_ANZ` on its full extent, rectangle-zoom into one hour, wait for the curve, Backspace; the network log (filtered to `/api/series`) shows no request after the Backspace and the overview curve is drawn without a loading mark

#### Scenario: Re-add a removed signal
- **WHEN** a signal is removed from a window after its load completed and is added to the same window again on the same range
- **THEN** no series request is sent for it and it is drawn at once
- **Evidence:** `apps/web/test/loader.test.ts` › "serves a re-added signal from the cache"; UI check: remove `COMBI_412h.V_ANZ` from a window and drop it back in; the network log shows no `/api/series` request for it

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
- **Evidence:** `apps/web/test/loader.test.ts` › "requests only the tiles a pan uncovers"; UI check: pan a loaded V_ANZ window by a few horizontal swipes back and forth; the network log shows requests only while new time comes into view

### Requirement: Raw tiles serve finer zooms
A tile that was loaded as raw points SHALL serve every finer bucket width inside its time span, without a request. Origin: necessary consequence of D-037 (3) and series-query "Raw points": raw points are the unmodified data, valid at any zoom where raw points are shown.

#### Scenario: Zoom further into raw data
- **WHEN** a view's tiles came back as raw points and the window zooms in by a factor of 4 inside that view
- **THEN** no request is sent and the new view shows exactly the raw points of its range, with the nearest point before and after as edge neighbours
- **Evidence:** `apps/web/test/loader.test.ts` › "zooms into raw tiles without a request"; `apps/web/test/tiles.test.ts` › "derives a finer raw tile with its edge neighbours"; UI check: zoom V_ANZ to 2026-10-13T09:56:59Z – 09:57:01Z (raw), wait, then Ctrl+wheel-zoom in twice; no `/api/series` request in the network log

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
A window SHALL count as settled when every tile of each signal's current view is present or its request failed; a fully cached view SHALL be settled at once. Origin: necessary consequence of D-005/D-011 (`--wait` reports the rendered state) and series-cache "Loaded series data stays in the tab".

#### Scenario: Cached view settles at once
- **WHEN** a window's new view is fully cached
- **THEN** the loader is settled in the same update, with no pending request
- **Evidence:** `apps/web/test/loader.test.ts` › "is settled only when every current request has finished" (kept) and "draws a previous view again without a request" (settled right after the update); UI check with the CLI: on a window `<w>` zoomed from its overview into one hour, `letsview --wait window range <w> <the overview's from> <the overview's to>` exits 0 and reports `complete`
