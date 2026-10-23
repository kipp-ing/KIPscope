## ADDED Requirements

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

## MODIFIED Requirements

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
