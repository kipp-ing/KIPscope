## MODIFIED Requirements

### Requirement: Top row and status strip
There SHALL be no separate top bar. The top row SHALL hold the "Signals" toggle and the option bar and stay visible while the list scrolls. The strip kept reserved below the window list SHALL show the connection state, the revision, the last error message and the footer (capability `app-footer`: meta items and attribution) outside a drag. During a drag the whole strip SHALL be the "+ New window" zone at the same size: "+ New window" takes the place of connection, revision, message and meta items, and the attribution stays visible at its place. Origin: D-025 („more of the screen shows data"); necessary consequence of add-cursors design C7 (the zone's space stays reserved); Jan's request for a permanently visible footer and D-049 (attribution), add-footer design F5.

#### Scenario: Idle strip
- **WHEN** the app is connected at revision n and no drag runs
- **THEN** the bottom strip starts with `connected · revision n` and ends with `KIPscope · kipp.ing · AAL`, no "KIPscope" top bar is shown, and the top row holds "Signals" followed by the option bar
- **Evidence:** UI check on smart451 at 1440×900 (screenshot)

#### Scenario: Error in the strip
- **WHEN** the marked window shows four units and the user adds `MS_312h.DNMOT` from the explorer with Enter, then clicks the message
- **THEN** the strip shows the `too_many_units` message in the error colour, and the click removes it
- **Evidence:** UI check on smart451 (screenshot of the strip before and after the click)

#### Scenario: Drag start moves nothing
- **WHEN** the user presses on an explorer row and drags past the threshold
- **THEN** the strip shows "+ New window" and the attribution at the same height as before (±0.5 px), and every window's `getBoundingClientRect()` top is the same as just before the drag (±0.5 px)
- **Evidence:** UI check (rects read before and during the drag, screenshot during the drag)

#### Scenario: Drop on the attribution
- **WHEN** the user drags the `BS_200h.DVL` explorer row onto the attribution text in the strip and releases there
- **THEN** while dragging the whole strip is highlighted as "+ New window"; after the release a new window shows DVL, no new browser tab opened, and the revision rose by two, as for a drop on "+ New window"
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while holding, revision and tab count after); `apps/web/test/drag.test.ts` › "maps drop elements to targets" stays green

#### Scenario: Compact bars
- **WHEN** the six-window setup is shown at 1440×900 and the list is scrolled to the end
- **THEN** the top row is fully visible; goals, measured and reported but not pass/fail: top row ≤ 36 px and strip ≤ 32 px tall (today: top bar about 42 px plus option bar about 40 px, zone about 56 px)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, measured heights)
