## Purpose

How the workspace page uses the screen: the collapsible signal sidebar, the tiled window grid, the top row and the status strip, compact window headers with the window menu, the marked window that explorer adds go to, and how screen use is measured.

## ADDED Requirements

### Requirement: Collapsible sidebar
The signal explorer SHALL be a sidebar 240 px wide when open that takes no width when collapsed. A "Signals" toggle at the left end of the top row, and the key `s` pressed without modifiers while focus is not in a text field or select, SHALL switch it. `/` SHALL open a collapsed sidebar and focus the search with its text selected. Origin: D-026 („Seitenleiste einklappbar"; "just optimization. later WP"); width per design L1; `/` from D-020.

#### Scenario: Toggle by button
- **WHEN** at 1440×900 the sidebar is open and the user clicks "Signals" in the top row, then clicks it again
- **THEN** the explorer measures 240 px wide (`getBoundingClientRect().width`, ±1) before, is not shown after the first click with the window grid starting within 16 px of the viewport's left edge, and is back at 240 px after the second
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each click, measured widths)

#### Scenario: Key s
- **WHEN** focus is on the page body and the user presses `s`, then `s` again; then focuses the search field and types `s`; then focuses the "Add to" select and presses `s`
- **THEN** the sidebar collapses, then opens; the search field then contains `s` and the sidebar stays open; the select does not toggle the sidebar
- **Evidence:** `apps/web/test/sidebar.test.ts` › "toggles with s outside text fields and selects only"; UI check (screenshot after the first `s`)

#### Scenario: Slash opens the search
- **WHEN** the sidebar is collapsed, the last query was `temp`, focus is on the page body and the user presses `/`, types `V_ANZ` and presses Enter
- **THEN** the sidebar opens with the search focused and `temp` selected, the field then holds `V_ANZ`, and `COMBI_412h.V_ANZ` is added to the "Add to" target
- **Evidence:** UI check on smart451 (screenshot after `/` and after Enter)

### Requirement: Sidebar state remembered
The sidebar's open or collapsed state SHALL be kept per browser in local storage and restored on reload. Without usable storage it SHALL start open and still switch. It SHALL NOT be workspace state. Origin: necessary consequence of D-026 (a collapse undone by every reload optimizes nothing); per viewer, because two viewers of one workspace can have different screens.

#### Scenario: Reload keeps collapsed
- **WHEN** the user collapses the sidebar and reloads the page
- **THEN** the page comes back with the sidebar collapsed, and `curl -s localhost:7310/api/workspace | jq -c '.workspace | keys'` lists no sidebar field
- **Evidence:** UI check (screenshot after reload); the `curl` command

#### Scenario: Storage fails
- **WHEN** reading or writing local storage throws, or it holds an unknown value
- **THEN** the state loads as open and saving does not throw
- **Evidence:** `apps/web/test/sidebar.test.ts` › "loads and saves the sidebar state, open by default and when storage fails"

### Requirement: Tiled window grid
Windows of every kind SHALL be laid out in workspace order, row by row, in two equal columns while the window list's content width is at least 920 px, else in one column. A window alone in the last row SHALL span both columns. There SHALL be at most two columns. Origin: D-026 („Kacheln nebeneinander"); 920 px and the two-column limit per design L2.

#### Scenario: Two columns at 1440×900
- **WHEN** the six-window setup (design M1) is shown at 1440×900 with the sidebar open
- **THEN** windows 1 and 2 share the top edge with window 2 to the right of window 1, likewise 3 and 4, and 5 and 6, and every window is about half the list width (difference between the two columns ≤ 1 px)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, plus each window's `getBoundingClientRect()` left, top and width)

#### Scenario: One column on a small screen
- **WHEN** the six-window setup is shown at 1000×557, first with the sidebar open, then collapsed
- **THEN** open, every window spans the list width in one column; collapsed, they form two columns
- **Evidence:** UI check on smart451 at 1000×557 (screenshot in each state)

#### Scenario: Wide screen keeps two columns
- **WHEN** the six-window setup is shown at 1920×1080 with the sidebar collapsed
- **THEN** there are exactly two columns
- **Evidence:** UI check on smart451 at 1920×1080 (screenshot); `not_run` if the browser tool cannot set the viewport

#### Scenario: Lone last window spans
- **WHEN** three timeseries windows exist at 1440×900, and then the user adds `BS_200h.DVL` to "New window"
- **THEN** before, window 3 spans the full list width below windows 1 and 2; after, windows 3 and 4 share the second row at half width each
- **Evidence:** UI check on smart451 at 1440×900 (screenshot before and after)

#### Scenario: Values window takes a cell
- **WHEN** at 1440×900 one timeseries window exists and the user clicks "+ Values window"
- **THEN** the values window sits to the right of the timeseries window in the first row, at the same width
- **Evidence:** UI check on smart451 at 1440×900 (screenshot)

### Requirement: Window heights in the grid
Each timeseries window SHALL keep its own stored plot height in the grid. A grid row SHALL be as tall as its tallest window, with its windows aligned at the top. The height handle SHALL change only its own window. Origin: necessary consequence of D-018 ("resizable window heights") with tiled windows (D-026).

#### Scenario: Taller left window
- **WHEN** at 1440×900 windows 1 and 2 share a row at default height and the user drags window 1's height handle about 200 px down
- **THEN** window 1's plot is about 480 px tall, window 2's stays 280 px, both windows keep the same top edge, and window 3 starts below window 1's bottom edge
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, plot heights from `getBoundingClientRect()`)

### Requirement: Drops in the grid
During a drag the drop target SHALL be the window under the pointer in any column. The gap between windows SHALL be no target: a release there changes nothing. Highlights, refused targets, auto-scroll and "+ New window" SHALL behave as in one column. Origin: necessary consequence of D-023 („every drop target stays reachable while dragging") with tiled windows (D-026).

#### Scenario: Drop into the right column
- **WHEN** at 1440×900 window 2 (right column) does not show `BS_200h.DVL` and the user drags the DVL explorer row onto window 2
- **THEN** window 2 is highlighted with "Drop to add" while dragging and lists DVL after the drop
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while dragging and after the drop)

#### Scenario: Release in the gap
- **WHEN** the user drags a legend row of window 1 and releases it in the gap between windows 1 and 2
- **THEN** no window is highlighted at the release point and the revision is unchanged
- **Evidence:** UI check (revision in the status strip before and after); `apps/web/test/drag.test.ts` existing drop-target tests stay green

#### Scenario: Reach the last row
- **WHEN** the six-window setup at 1440×900 is scrolled to the top and the user drags the V_ANZ legend row of window 1 into the band just above the status strip
- **THEN** the list scrolls until windows 5 and 6 are visible, and dropping on window 6 moves V_ANZ there and removes window 1
- **Evidence:** UI check on smart451 at 1440×900 (screenshots while scrolling and after the drop)

### Requirement: Top row and status strip
There SHALL be no separate top bar. The top row SHALL hold the "Signals" toggle and the option bar and stay visible while the list scrolls. The strip kept reserved below the window list SHALL show the connection state, the revision and the last error message outside a drag, and the "+ New window" zone during a drag, at the same size. Origin: D-025 („more of the screen shows data"); necessary consequence of add-cursors design C7 (the zone's space stays reserved).

#### Scenario: Idle strip
- **WHEN** the app is connected at revision n and no drag runs
- **THEN** the bottom strip reads `connected · revision n`, no "letsview" top bar is shown, and the top row holds "Signals" followed by the option bar
- **Evidence:** UI check on smart451 at 1440×900 (screenshot)

#### Scenario: Error in the strip
- **WHEN** the marked window shows four units and the user adds `MS_312h.DNMOT` from the explorer with Enter, then clicks the message
- **THEN** the strip shows the `too_many_units` message in the error colour, and the click removes it
- **Evidence:** UI check on smart451 (screenshot of the strip before and after the click)

#### Scenario: Drag start moves nothing
- **WHEN** the user presses on an explorer row and drags past the threshold
- **THEN** the strip shows "+ New window" at the same height as before, and every window's `getBoundingClientRect()` top is the same as just before the drag (±0.5 px)
- **Evidence:** UI check (rects read before and during the drag, screenshot during the drag)

#### Scenario: Compact bars
- **WHEN** the six-window setup is shown at 1440×900 and the list is scrolled to the end
- **THEN** the top row is fully visible; goals, measured and reported but not pass/fail: top row ≤ 36 px and strip ≤ 32 px tall (today: top bar about 42 px plus option bar about 40 px, zone about 56 px)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, measured heights)

### Requirement: Compact window header
Every window's header, of every kind, SHALL be one line at most 24 px tall: title, then the resolution badge (timeseries) or the cursor times (values), then the range (timeseries), then the window's controls and the "⋯" menu at the right end. The controls' positions SHALL depend only on the window's width and which controls it has, never on title, badge, range or load state. Origin: D-026 („kompakte Fensterköpfe"); header reflow finding (efficiency test, designer).

#### Scenario: Header height
- **WHEN** the six-window setup and one values window are shown at 1440×900
- **THEN** every `.window-header` is one line at most 24 px tall; goal, measured and reported but not pass/fail: plot top minus window top ≤ 48 px in every timeseries window (today about 60 px)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, measured heights)

#### Scenario: No reflow on zoom
- **WHEN** window 1 shows only `COMBI_412h.V_ANZ` over its full extent (aggregated), the left x of every control in its header is read, and the window is zoomed to 2026-10-13T13:08:00Z–13:08:03Z (raw), during loading and after
- **THEN** every control's left x is unchanged (±0.5 px) during loading and after, while badge and range text changed
- **Evidence:** UI check on smart451 at 1440×900 (x values before, during and after, screenshot after)

#### Scenario: Short badge
- **WHEN** the loaded series of a window are all aggregated with a widest bucket of 2 min, partly aggregated, or all raw
- **THEN** the badge reads `agg · 2 min`, `part · 2 min` or `raw`, with tooltips `aggregated · 2 min per point`, `partly aggregated · 2 min per point` and `raw`; goal: the badge has no fill colour (designer finding: status colours compete with signal colours)
- **Evidence:** `apps/web/test/build.test.ts` › "gives a short badge and the full resolution as tooltip"; UI check (screenshot of a badge with its tooltip)

### Requirement: Header truncation
When a header lacks space, the range SHALL truncate first, then the title down to its first 6 characters, each with an ellipsis and the full text as tooltip. Badge, cursor times, controls and the "⋯" button SHALL NOT be truncated, wrap or leave the line. Origin: D-026 (compact headers); designer finding ("truncate the badge, not the title" read as: the title outlives the range, the badge is short instead of cut); "Long title" bug (feedback 2026-10-14)

#### Scenario: Long title
- **WHEN** a window at 1440×900 (two columns) is renamed to an 80-character title
- **THEN** its header is one line with the range gone or cut first, the title cut by an ellipsis, the full title as tooltip, and "⋯" on the same line
- **Evidence:** UI check on smart451 at 1440×900 (screenshot with the tooltip)

#### Scenario: Narrow window
- **WHEN** the six-window setup is shown at 1000×557 with the sidebar collapsed (two columns of about 480 px)
- **THEN** every header is one line, every control and "⋯" is fully visible, and every title shows at least 6 characters
- **Evidence:** UI check on smart451 at 1000×557 (screenshot)

### Requirement: Cursor times drop their date
If the cursor times in a values window header still do not fit once the title is down to 6 characters, they SHALL drop their date part, with the full times as tooltip, instead of being cut; Δt SHALL stay visible. The same-day decision SHALL use the timestamps, not formatted text. Origin: necessary consequence of "Header truncation" (lead, round 3 review: with Diff on, the times need about 356 px in a 480 px values cell).

#### Scenario: Narrow values window in diff mode
- **WHEN** a values window cell is about 480 px wide, its title is 40 characters long and A, B and Diff are on
- **THEN** the header is one line with the title cut to 6 characters, A and B shown without their date, Δt visible, and the full times as tooltip
- **Evidence:** `apps/web/test/values.test.ts` › "drops the cursor dates before truncating the times"; UI check at 1000×557 (screenshot)

### Requirement: Window menu
Each window's header SHALL end with a "⋯" button that opens a menu with "Rename" and "Remove window". "Remove window" SHALL send `window.remove`. Choosing an item, Esc or a click outside SHALL close the menu. The header SHALL have no separate Remove button. Origin: D-026 (compact headers); designer finding ("Remove into a title menu", efficiency test).

#### Scenario: Remove by menu
- **WHEN** the user clicks "⋯" in window 3's header and then "Remove window"
- **THEN** window 3 is gone, the revision rose by exactly one, and the windows after it move up in the grid
- **Evidence:** UI check on smart451 at 1440×900 (screenshot with the open menu, screenshot after)

#### Scenario: Close without a command
- **WHEN** the user opens a values window's "⋯" menu and presses Esc, then opens it again and clicks into a plot
- **THEN** the menu closes each time and the revision is unchanged
- **Evidence:** UI check (revision before and after)

### Requirement: Marked window
The user SHALL mark a window by a click on its header outside its controls, title included, or by choosing it in the explorer's "Add to" select; at most one window is marked. The marked window SHALL show an accent bar on its top edge and its title in the accent colour. Explorer adds by Enter or a row's add button SHALL go to it, or to a new window while none is marked. Origin: D-027 („the user marks a window, and adds go there").

#### Scenario: Mark and add
- **WHEN** the six-window setup is shown, the user clicks the empty part of window 4's header, then presses `/`, types `T_SOLL` and presses Enter
- **THEN** window 4 shows the accent bar and accent title, `AC_A1.T_SOLL` appears in window 4, and the number of windows is still six
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the click and after Enter)

#### Scenario: Values window marked
- **WHEN** the user clicks the title of a values window once and adds `COMBI_412h.V_ANZ` with the row's add button
- **THEN** the values window is marked and lists V_ANZ
- **Evidence:** UI check on smart451 (screenshot)

#### Scenario: No mark, new windows
- **WHEN** no window is marked and the user adds `BS_200h.DVL` and then `MS_608h.T_MOT` with Enter
- **THEN** each lands in its own new window, and neither new window is marked
- **Evidence:** UI check on smart451 (screenshot after the second Enter)

#### Scenario: Other gestures do not mark
- **WHEN** window 2 is marked and the user clicks into window 3's plot (cursor A), drags an explorer row onto window 3, changes window 3's mode select and opens and closes its "⋯" menu
- **THEN** window 2 is still the only marked window and the "Add to" select still shows it
- **Evidence:** UI check on smart451 (screenshot after the last step)

#### Scenario: Refused add keeps the target
- **WHEN** the marked window shows four units and the user adds `MS_312h.DNMOT` with Enter
- **THEN** the add is rejected with `too_many_units` in the status strip, no new window is created and the mark stays
- **Evidence:** UI check on smart451 (screenshot, window count before and after)

### Requirement: Mark is view state
The mark SHALL live in the browser tab only: marking SHALL send no command and not change the revision, a reload SHALL start without a mark, and the workspace read by the CLI SHALL hold no mark. Origin: D-022 (the "Add to" target is held by window ID in the explorer, per tab); design L6, pending Jan's call Q1.

#### Scenario: Mark, reload
- **WHEN** the user marks window 2 and then reloads the page
- **THEN** the revision in the status strip is the same before and after the click, after the reload no window is marked and the select shows "New window", and `curl -s localhost:7310/api/workspace | jq -c '.workspace | keys'` lists no mark field
- **Evidence:** UI check (screenshots before and after the click and after reload); the `curl` command

### Requirement: Screen use
With the six-window setup (design M1), the sidebar open and the list scrolled to the top, the plot areas SHALL cover at least 30 % of a 1000 × 557 px viewport (the efficiency test measured about 25 %). Origin: D-025 („Screen use must be optimized: more of the screen shows data"); 30 % per design M1. Goals, measured and reported but not pass/fail: the shares and window counts of design M1 at 1000×557, 1440×900 and 1920×1080.

#### Scenario: Testers' viewport
- **WHEN** the six-window setup is shown at 1000×557 with the sidebar open, and then collapsed
- **THEN** the plot share from design M1's snippet is at least 30 % open; the collapsed share is reported against the goal
- **Evidence:** UI check on smart451 at 1000×557 (snippet output and screenshot per state)

#### Scenario: Larger viewports
- **WHEN** the six-window setup is shown at 1440×900 and at 1920×1080, each with the sidebar open and collapsed
- **THEN** the plot shares and the number of fully visible windows are reported next to the goals of design M1
- **Evidence:** UI check on smart451 (snippet output and screenshot per viewport and state); `not_run` for a viewport the browser tool cannot set
