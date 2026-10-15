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
