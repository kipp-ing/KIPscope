## MODIFIED Requirements

### Requirement: Collapsible sidebar
The signal explorer SHALL be a sidebar of fixed width when open, 248 px, or 208 px in a viewport narrower than 1200 px, that takes no width when collapsed; no content SHALL widen or narrow it (`width` and `min-width: 0`), and a text cut in it (a row's name, a group head, the "Add to" target) SHALL end in `…` with its full text as tooltip. A 26 × 26 px icon button (a panel icon, `aria-label` `Hide sidebar` while open and `Show sidebar` while collapsed, `aria-expanded`, tooltip naming `s`) at the left end of the top row, and the key `s` pressed without modifiers while focus is not in a text field or select, SHALL switch it. `/` SHALL open a collapsed sidebar and focus the search with its text selected. Origin: D-026 („Seitenleiste einklappbar"; "just optimization. later WP"); `/` from D-020; icon: D-092 (mock `Main.dc.html`, the designer's top-row inventory); fixed slot, 248/208 px, cut texts with tooltip: D-095 (critic 2: the mock's sidebar rendered 321 px instead of 248 px); 1200 px: the midpoint of the mocks' 1440 and 1000 px widths, design DW22.

#### Scenario: Toggle by button
- **WHEN** at 1440×900 the sidebar is open and the user clicks the sidebar button in the top row, then clicks it again
- **THEN** the explorer measures 248 px wide (`getBoundingClientRect().width`, ±1) before, is not shown after the first click with the window grid starting within 16 px of the viewport's left edge, and is back at 248 px after the second; the button reads `Hide sidebar` / `Show sidebar` as its `aria-label` and shows no text
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each click, measured widths, `aria-label` values)

#### Scenario: Sidebar holds its width
- **WHEN** the sidebar is open at 1440×900 and at 1000×557, the search is empty, then holds `HV_Volt`, then a window titled with 80 characters is the "Add to" target
- **THEN** the explorer measures 248 px at 1440×900 and 208 px at 1000×557 (±1) in every state; no `.explorer .row` has `scrollWidth` greater than its `clientWidth` + 1; every row name, group head and the "Add to" select whose text is cut (`scrollWidth > clientWidth`) has a non-empty `title` holding its full text
- **Evidence:** UI check on smart451 (widths per state and viewport, the snippet listing cut elements without a full `title`: empty)

#### Scenario: Key s
- **WHEN** focus is on the page body and the user presses `s`, then `s` again; then focuses the search field and types `s`; then focuses the "Add to" select and presses `s`
- **THEN** the sidebar collapses, then opens; the search field then contains `s` and the sidebar stays open; the select does not toggle the sidebar
- **Evidence:** `apps/web/test/sidebar.test.ts` › "toggles with s outside text fields and selects only"; UI check (screenshot after the first `s`)

#### Scenario: Slash opens the search
- **WHEN** the sidebar is collapsed, the last query was `temp`, focus is on the page body and the user presses `/`, types `SPEED_DISP` and presses Enter
- **THEN** the sidebar opens with the search focused and `temp` selected, the field then holds `SPEED_DISP`, and `ICL_3A2h.SPEED_DISP` is added to the "Add to" target
- **Evidence:** UI check on smart451 (screenshot after `/` and after Enter)

### Requirement: Top row and status strip
There SHALL be no separate top bar. The top row SHALL hold the sidebar button and the option bar; below it the context row (while a catalog or a scope is open) and the time strip; all three stay visible while the list scrolls. Outside a drag, the strip below the window list SHALL show the status (a 7 px dot and `connected` or `disconnected`, the revision in its tooltip), the last message and the footer (`app-footer`). During a drag the whole strip SHALL be the "+ New window" zone at the same size; only the attribution stays in place. Origin: D-025; add-cursors design C7; Jan's footer request, D-049, add-footer design F5; status tooltip: D-092 (8).

#### Scenario: Idle strip
- **WHEN** the app is connected at revision n and no drag runs
- **THEN** the bottom strip starts with the dot and `connected`, whose tooltip starts `revision n`, and ends with `KIPscope · kipp.ing · AAL`; no "KIPscope" top bar is shown; the top row starts with the sidebar button followed by the option bar
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, the status `title`)

#### Scenario: Error in the strip
- **WHEN** the marked window shows four units and the user adds `ENG_2E8h.MOT_SPD_D` from the explorer with Enter, then clicks the message
- **THEN** the strip shows the `too_many_units` message in the error colour, and the click removes it
- **Evidence:** UI check on smart451 (screenshot of the strip before and after the click)

#### Scenario: Drag start moves nothing
- **WHEN** the user presses on an explorer row and drags past the threshold
- **THEN** the strip shows "+ New window" and the attribution at the same height as before (±0.5 px), and every window's `getBoundingClientRect()` top is the same as just before the drag (±0.5 px)
- **Evidence:** UI check (rects read before and during the drag, screenshot during the drag)

#### Scenario: Drop on the attribution
- **WHEN** the user drags the `COMBI_412h.V_ANZ` explorer row onto the attribution text in the strip and releases there
- **THEN** while dragging the whole strip is highlighted as "+ New window"; after the release a new window shows V_ANZ, no new browser tab opened, and the revision rose by two, as for a drop on "+ New window"
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while holding, revision and tab count after); `apps/web/test/drag.test.ts` › "maps drop elements to targets" stays green

#### Scenario: Compact bars
- **WHEN** the six-window setup is shown at 1440×900 and the list is scrolled to the end, once without and once with an open catalog
- **THEN** the top row is fully visible; goals, measured and reported but not pass/fail: top row ≤ 40 px, context row ≤ 32 px and bottom strip ≤ 32 px tall (mock `Main.dc.html`: 40, 32, 24); the time strip is 28 px (time-strip "Time strip", D-094), measured
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, measured heights)

### Requirement: Compact window header
Every window's header, of every kind, SHALL be one line at most 24 px tall: title and the "Add to" pill, then the cursor times (values), then, only while "Link time axes" is off, the window's own range (timeseries, content owned by `add-range-picker`), then at the right end the mode tag (timeseries) and the "⋯" menu. A linked timeseries window SHALL show no range text (the range control shows it). The display mode and Min/max SHALL NOT be header controls ("Window menu"). The mode tag reads `raw`, `agg <w>` or `part <w>`, `<w>` the widest bucket width in the largest of ns, µs, ms, s, min, h, d it reaches, with at most three significant figures (whole numbers from 10, one decimal below, no `.0`); it is 11 px muted text in tabular numbers, right-aligned in a slot as wide as the longest tag of this format (goal 64 px, the mock's measure), with the tooltips `raw`, `aggregated · <w> per point` and `partly aggregated · <w> per point`. The controls' positions SHALL depend only on the window's width and which controls it has, never on title, tag, range or load state. Origin: D-026 („kompakte Fensterköpfe"); header reflow finding (efficiency test, designer); D-092 (1) (the range button replaces the window header ranges), (9) (display mode and Min/max into the window's ⋯ menu); fixed tag slot: designer's measurement (`part · 1 s` / `agg · 536.8 ms` changed width and pushed the header); 64 px ×2 would take 64 px more title in a 480 px window, ×½ cuts `part 1.5 min`.

#### Scenario: Header height
- **WHEN** the six-window setup and one values window are shown at 1440×900
- **THEN** every `.window-header` is one line at most 24 px tall; goal, measured and reported but not pass/fail: plot top minus window top ≤ 48 px in every timeseries window
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, measured heights)

#### Scenario: No reflow on zoom
- **WHEN** window 1 shows only `ICL_3A2h.SPEED_DISP` over its full extent (aggregated), the layout probe of design DW1 runs, and the window is zoomed to 2026-10-13T13:08:00Z–13:08:03Z (raw), during loading and after
- **THEN** the probe reports at most 1 px for the mode tag's box and the "⋯" button, while the tag's text changed from `agg …` to `raw`
- **Evidence:** UI check on smart451 at 1440×900 (probe output, screenshot after)

#### Scenario: Short badge
- **WHEN** the loaded series of a window are all aggregated with a widest bucket of 2 min, of 536.8 ms and of 90 s, partly aggregated with 1 s, or all raw
- **THEN** the tag reads `agg 2 min`, `agg 537 ms`, `agg 1.5 min`, `part 1 s` or `raw`, with the tooltips `aggregated · 2 min per point`, …, `partly aggregated · 1 s per point` and `raw`
- **Evidence:** `apps/web/test/build.test.ts` › "gives a short badge and the full resolution as tooltip"; UI check (screenshot of a tag with its tooltip)

### Requirement: Header truncation
When a header lacks space, the range (shown only while link is off) SHALL truncate first, then the title down to its first 6 characters, each with an ellipsis and the full text as tooltip. The mode tag, the "Add to" pill, cursor times, the "⋯" button SHALL NOT be truncated, wrap or leave the line. Origin: D-026 (compact headers); designer finding ("truncate the badge, not the title" read as: the title outlives the range, the badge is short instead of cut); "Long title" bug (feedback 2026-10-14).

#### Scenario: Long title
- **WHEN** a window at 1440×900 (two columns) is renamed to an 80-character title
- **THEN** its header is one line with the title cut by an ellipsis, the full title as tooltip, and the mode tag and "⋯" on the same line at the same x as before the rename (±1 px)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot with the tooltip, x before and after)

#### Scenario: Narrow window
- **WHEN** the six-window setup is shown at 1000×557 with the sidebar collapsed (two columns of about 480 px)
- **THEN** every header is one line, every mode tag and "⋯" is fully visible, and every title shows at least 6 characters
- **Evidence:** UI check on smart451 at 1000×557 (screenshot)

### Requirement: Window menu
Each window's header SHALL end with a "⋯" button that opens a menu. A timeseries window's menu SHALL hold the display modes `Line`, `Step` and `Markers` as radio items (the window's mode checked), `Min/max` as a checkbox item (the envelope state), then "Rename" and "Remove window"; a values window's menu "Rename" and "Remove window". A display item SHALL send one `window.setDisplay` (`mode` or `envelope`) and close the menu; choosing the checked mode sends nothing. "Remove window" SHALL send `window.remove`. Choosing an item, Esc or a click outside SHALL close the menu. The header SHALL have no separate Remove button, display select or Min/max checkbox. Origin: D-026 (compact headers); designer finding ("Remove into a title menu", efficiency test); display mode and Min/max in the menu: D-092 (9).

#### Scenario: Remove by menu
- **WHEN** the user clicks "⋯" in window 3's header and then "Remove window"
- **THEN** window 3 is gone, the revision rose by exactly one, and the windows after it move up in the grid
- **Evidence:** UI check on smart451 at 1440×900 (screenshot with the open menu, screenshot after)

#### Scenario: Close without a command
- **WHEN** the user opens a values window's "⋯" menu and presses Esc, then opens it again and clicks into a plot
- **THEN** the menu closes each time and the revision is unchanged
- **Evidence:** UI check (revision before and after)

#### Scenario: Display from the menu
- **WHEN** `windowMenuItems` gets window `w1` in line mode with the envelope off, then `w1` in step mode, and a values window (no display)
- **THEN** the first lists `Line` (radio, checked, no command), `Step` (radio, command `window.setDisplay {windowId: "w1", mode: "step"}`), `Markers`, `Min/max` (checkbox, unchecked, command `window.setDisplay {windowId: "w1", envelope: true}`), `Rename`, `Remove window` in that order; the second has `Step` checked without a command and `Line` with `mode: "line"`; the third lists `Rename` and `Remove window` only
- **Evidence:** `apps/web/test/windowMenu.test.ts` › "offers display mode and min/max in the menu"

### Requirement: Signals and Events in the sidebar
The sidebar SHALL hold a switch `Signals | Events` above its content (explorer or events panel), kept per browser in local storage (Signals without usable storage), not in the workspace. `/` SHALL switch to Signals before focusing the search; `e` without Ctrl, Meta or Alt outside text fields and selects SHALL open a collapsed sidebar on Events, open the panel's `Refine` section and focus the filter field, its text selected. Origin: D-058; place: D-058 (Jan's answers); `e` like `/` (D-020); Refine: proposal E-4; width: D-095.

#### Scenario: Switch and key e
- **WHEN** at 1440×900 the sidebar is collapsed, `Refine` is closed, focus is on the page body and the user presses `e`; then clicks `Signals`; then reloads; then presses `/`
- **THEN** the sidebar opens 248 px wide on Events with `Refine` open and the filter field focused, its text selected; then the explorer shows; after the reload the explorer still shows; `/` focuses the search
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after `e` and after the reload)

#### Scenario: Stored part and key
- **WHEN** the stored part is read from storage holding `events`, holding `nonsense`, and from storage that throws; and the key `e` is tested with Ctrl, in a text field, in a select and on the body
- **THEN** `events`, `signals`, `signals`; only the body press opens the events
- **Evidence:** `apps/web/test/sidebar.test.ts` › "loads and saves the sidebar part", "opens the events with e outside text fields and selects"

## ADDED Requirements

### Requirement: Linked windows show the range once
While "Link time axes" is on, no timeseries window header SHALL show a range; the one shared range SHALL be read from the range control, which is the evidence wherever another spec's scenario reads "the header shows <range>" for a linked window. Headers SHALL lose the range only together with a range control that shows it (`add-range-picker`). Origin: D-092 (1) (the range appeared three times; the range button replaces the header ranges).

#### Scenario: Range read once
- **WHEN** at 1440×900 two linked windows show smart451 and the user wheel-zooms window 1, then switches "Link time axes" off and zooms window 2
- **THEN** while linked no `.window-header` holds a `span.range`, and the range control's text names the first and last time of window 1's axis (±1 tick step); after unlinking window 2's header shows its own range (as `add-range-picker` defines it)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each zoom, the range control's text)
