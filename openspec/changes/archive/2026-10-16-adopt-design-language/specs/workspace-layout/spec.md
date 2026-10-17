## MODIFIED Requirements

### Requirement: Compact window header
Every window's header, of every kind, SHALL be one line at most 24 px tall: title, then the resolution badge (timeseries) or the cursor times (values), then the range (timeseries), then the window's controls and the "⋯" menu at the right end. The controls' positions SHALL depend only on the window's width and which controls it has, never on title, badge, range or load state. Origin: D-026 („kompakte Fensterköpfe"); header reflow finding (efficiency test, designer); badge look: D-055 (mock: slate-100 badge).

#### Scenario: Header height
- **WHEN** the six-window setup and one values window are shown at 1440×900
- **THEN** every `.window-header` is one line at most 24 px tall; goal, measured and reported but not pass/fail: plot top minus window top ≤ 48 px in every timeseries window (today about 60 px)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, measured heights)

#### Scenario: No reflow on zoom
- **WHEN** window 1 shows only `ICL_3A2h.SPEED_DISP` over its full extent (aggregated), the left x of every control in its header is read, and the window is zoomed to 2026-10-13T13:08:00Z–13:08:03Z (raw), during loading and after
- **THEN** every control's left x is unchanged (±0.5 px) during loading and after, while badge and range text changed
- **Evidence:** UI check on smart451 at 1440×900 (x values before, during and after, screenshot after)

#### Scenario: Short badge
- **WHEN** the loaded series of a window are all aggregated with a widest bucket of 2 min, partly aggregated, or all raw
- **THEN** the badge reads `agg · 2 min`, `part · 2 min` or `raw`, with tooltips `aggregated · 2 min per point`, `partly aggregated · 2 min per point` and `raw`; goal: the badge has the neutral band fill `#f1f5f9` and no status colour (D-055 mock; designer finding: status colours compete with signal colours)
- **Evidence:** `apps/web/test/build.test.ts` › "gives a short badge and the full resolution as tooltip"; UI check (screenshot of a badge with its tooltip)

### Requirement: Marked window
The user SHALL mark a window by a click on its header outside its controls, title included, or by choosing it in the explorer's "Add to" select; at most one window is marked. The marked window SHALL show its frame in the accent ring colour and an "Add to" pill (accent soft fill, accent ink) after its title; the pill SHALL NOT be truncated, SHALL NOT move the header's controls, and the header's truncation order stays (range first, then the title). Explorer adds by Enter or a row's add button SHALL go to it, or to a new window while none is marked. Origin: D-027 („the user marks a window, and adds go there"); look: D-055 (mock: target window framed `#7dd3fc` with an "Add to" pill in `#e0f2fe` / `#075985`), which replaces the accent bar and accent title.

#### Scenario: Mark and add
- **WHEN** the six-window setup is shown, the user clicks the empty part of window 4's header, then presses `/`, types `T_SET` and presses Enter
- **THEN** window 4's border colour is `rgb(125, 211, 252)` and its header shows the "Add to" pill with background `rgb(224, 242, 254)` after the title, no other window shows either, `CLIM_A1.T_SET` appears in window 4, and the number of windows is still six
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the click and after Enter, computed values)

#### Scenario: Values window marked
- **WHEN** the user clicks the title of a values window once and adds `ICL_3A2h.SPEED_DISP` with the row's add button
- **THEN** the values window is marked (ring frame and "Add to" pill) and lists SPEED_DISP; with A, B and Diff on in a 480 px values window with a 40-character title, the cursor times still follow "Cursor times drop their date" and Δt stays visible
- **Evidence:** UI check on smart451 (screenshot of both states)

#### Scenario: No mark, new windows
- **WHEN** no window is marked and the user adds `BRK_1A0h.WSPD_FL` and then `ENG_5E0h.T_ENG` with Enter
- **THEN** each lands in its own new window, and neither new window is marked
- **Evidence:** UI check on smart451 (screenshot after the second Enter)

#### Scenario: Other gestures do not mark
- **WHEN** window 2 is marked and the user clicks into window 3's plot (cursor A), drags an explorer row onto window 3, changes window 3's mode select and opens and closes its "⋯" menu
- **THEN** window 2 is still the only marked window and the "Add to" select still shows it
- **Evidence:** UI check on smart451 (screenshot after the last step)

#### Scenario: Refused add keeps the target
- **WHEN** the marked window shows four units and the user adds `ENG_2E8h.MOT_SPD_D` with Enter
- **THEN** the add is rejected with `too_many_units` in the status strip, no new window is created and the mark stays
- **Evidence:** UI check on smart451 (screenshot, window count before and after)
