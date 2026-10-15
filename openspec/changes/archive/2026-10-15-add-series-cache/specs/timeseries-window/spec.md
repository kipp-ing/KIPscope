## MODIFIED Requirements

### Requirement: Reload on navigation
After a zoom or pan, the window SHALL request the data for the new range and resolution that is not in the tab's series cache, keep showing the already loaded data meanwhile, and replace it when the new data arrives. When the cache holds all data for the new range and resolution, the window SHALL show it at once, without a request and without a loading state. Origin: concept §5 („Beim Hineinzoomen werden feinere Daten nachgeladen"); D-037 (3) (loaded data stays in the browser, „so zooming and panning back is fast").

#### Scenario: Zoom into detail
- **WHEN** the user zooms from an aggregated view into a range with few raw points
- **THEN** the window loads and shows the raw points

#### Scenario: Back to a cached range
- **WHEN** the user zooms into a range, waits for its data, and goes back to the previous range with Backspace
- **THEN** the previous curve is shown at once and no `/api/series` request is sent
- **Evidence:** `apps/web/test/loader.test.ts` › "draws a previous view again without a request"; UI check (network log filtered to `/api/series`, screenshot of the restored curve)
