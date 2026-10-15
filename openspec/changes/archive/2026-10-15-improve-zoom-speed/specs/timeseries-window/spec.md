## MODIFIED Requirements

### Requirement: Reload on navigation
After and during a zoom or pan, the window SHALL request the data for the shown range and resolution that is not in the tab's series cache, without waiting for the range command; meanwhile it SHALL show a coarser placeholder of the shown range (series-cache "Placeholder where tiles are missing"), or the already loaded data when no placeholder is available, and replace it when the new data arrives. When the cache holds all data for the shown range and resolution, the window SHALL show it at once, in the frame that first shows the range, without a request and without a loading state. Origin: concept §5 („Beim Hineinzoomen werden feinere Daten nachgeladen"); D-037 (3) (loaded data stays in the browser, „so zooming and panning back is fast"); D-040 (1), (2) (loading on the preview range, coarse data where finer tiles are missing).

#### Scenario: Zoom into detail
- **WHEN** the user zooms from an aggregated view into a range with few raw points
- **THEN** the window loads and shows the raw points

#### Scenario: Back to a cached range
- **WHEN** the user zooms into a range, waits for its data, and goes back to the previous range with Backspace
- **THEN** the previous curve is shown at once and no `/api/series` request is sent
- **Evidence:** `apps/web/test/loader.test.ts` › "draws a previous view again without a request"; UI check (network log filtered to `/api/series`, screenshot of the restored curve)

#### Scenario: Loading starts during the gesture
- **WHEN** the user zooms with one Ctrl+wheel step into a range that is not cached
- **THEN** its `/api/series` request starts within 50 ms of the wheel event, not after the 300 ms command delay
- **Evidence:** UI timing check (design T1 of change `improve-zoom-speed`, step 2: Resource Timing `startTime` − t0); `apps/web/test/loader.test.ts` › "throttles loads during a gesture: first at once, then once per interval"

### Requirement: Linked time zoom
While the time axes are linked, wheel zoom, wheel pan, rectangle zoom, double-click reset, history back, "Reset", navigation keys, "Go to" and span presets in or for any window SHALL change the time range of all windows. During a wheel, pan or key gesture in one window, every linked window SHALL show and load the previewed range in the same frame, each at its own resolution; the range command SHALL still be sent once, by the gesture's window. While unlinked, each window SHALL keep its own range. Origin: D-017; D-027; D-041 („every linked window shows the preview range and loads during the gesture like the zoomed one").

#### Scenario: Zoom one of two linked windows
- **WHEN** "Link time axes" is on, window 1 shows `COMBI_412h.V_ANZ`, window 2 shows `CPC_448h.PTC_HV_Volt`, and the user Ctrl+wheel-zooms in window 1
- **THEN** within 1 s window 2's header shows the same range as window 1 and its curve is reloaded for it
- **Evidence:** UI check (screenshot of both headers); `packages/shared/test/apply.test.ts` › "applies a range to all windows while linked"

#### Scenario: Linked windows follow the gesture
- **WHEN** the two linked windows have rested 2 s on one hour and one Ctrl+wheel event arrives over window 1 (design T1 of change `improve-zoom-speed`)
- **THEN** window 2 draws the new range in its first stroke burst within 50 ms of the wheel event: from the cache with no further burst when its tiles are cached (zoom out, steps 3–4), as a placeholder followed by its sharp data within 200 ms when they are not (zoom in, step 2); one `window.setRange` command is sent, about 300 ms after the event
- **Evidence:** UI timing check (design T1, per-window `bursts` and per-signal `series`); `apps/web/test/linkedPreview.test.ts` › "shows the own preview, else the linked shared one, else the server range" and "publishes synchronously and clears only for the current source"

#### Scenario: Zoom one of two unlinked windows
- **WHEN** the user switches "Link time axes" off and zooms window 1
- **THEN** window 2 keeps its time range, also during the gesture
- **Evidence:** UI check (screenshot); `packages/shared/test/apply.test.ts` › "applies a range to one window while unlinked"; `apps/web/test/linkedPreview.test.ts` › "shows the own preview, else the linked shared one, else the server range"
