## MODIFIED Requirements

### Requirement: Resizable window height
The user SHALL be able to change a timeseries window's plot height by dragging either its corner grip ("Corner grip") or the strip below the plot, between 120 and 1200 px; the height SHALL be kept in the workspace. While dragging, only the dragging browser's plot SHALL follow the pointer; on release exactly one `window.setHeight` command SHALL be sent, and none when the released height equals the stored one. Origin: D-018 ("resizable window heights"); D-037 item (1) for the grip; the strip stays per design G1 (Q1).

#### Scenario: Taller window
- **WHEN** the user drags the strip below a window's plot about 200 px down and reloads the browser
- **THEN** the plot is about 480 px tall before and after the reload
- **Evidence:** UI check on smart451 at 1440×900 (screenshots before and after reload); `packages/shared/test/apply.test.ts` › "sets window height within bounds"

#### Scenario: Bounds
- **WHEN** a dragged height would be 50 px or 5000 px
- **THEN** the plot height is 120 px or 1200 px, and the command sent on release carries that clamped height
- **Evidence:** `apps/web/test/height.test.ts` › "clamps a dragged height to 120–1200 px"

#### Scenario: Smallest height on screen
- **WHEN** a window's plot is 280 px tall and the user drags its grip 300 px up and releases
- **THEN** the plot element (`.plot`) measures 120 px tall (±1) and the window's bottom edge moved up by about 160 px; no empty band remains below the drawn plot
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, `.plot` and window rects before and after)

#### Scenario: One command per drag
- **WHEN** the user drags the grip 200 px down, back up 200 px and releases; then drags it 100 px down and releases
- **THEN** the first release sends no command and leaves the revision unchanged; the second sends exactly one `window.setHeight` and the revision rises by exactly one
- **Evidence:** `apps/web/test/height.test.ts` › "sends one setHeight only when the height changed"; UI check on smart451 (revision in the status strip before and after each release)

### Requirement: New windows scroll into view
A window created by "+ Values window", by a drop on "+ New window" or by a drop on the free area below the windows (workspace-layout "Drop below the windows") SHALL be scrolled into view. Origin: power-user bug (feedback 2026-10-15, item 4: the new window was appended out of sight); D-037 item (2) for the free area.

#### Scenario: Values window below the fold
- **WHEN** six windows fill more than the viewport, the list is scrolled to the top, and the user clicks "+ Values window", later drops a legend row on "+ New window"
- **THEN** each new window is fully visible right after it appears, without manual scrolling
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each creation)

#### Scenario: Drop below a short list
- **WHEN** at 1440×900 two windows share the first row and the user drops the `BRK_1A0h.WSPD_FL` explorer row on the free area below them
- **THEN** the new window is fully visible right after it appears, without manual scrolling
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the drop)

## ADDED Requirements

### Requirement: Corner grip
Every timeseries window SHALL show a grip in its lower right corner, visible without hovering. Dragging it SHALL change only that window's plot height, as "Resizable window height" describes; the window's width SHALL stay as the grid gives it. Values windows SHALL have no grip. Origin: D-037 item (1) („the apple like curved handle lower right to grab"; "height only"); values windows have no height (D-023: "no range, display or height").

#### Scenario: Grip visible on every timeseries window
- **WHEN** at 1440×900 the workspace shows two timeseries windows and one values window, and the pointer rests on the option bar
- **THEN** each timeseries window shows the curved grip in its lower right corner, its hit box within 20 px of the window's right and bottom border (`getBoundingClientRect()`), and the values window shows none
- **Evidence:** UI check on smart451 at 1440×900 (screenshot, rects of each grip and window)

#### Scenario: Drag the grip
- **WHEN** a window's plot is 280 px tall at revision n and the user presses on its grip, moves 200 px down, holds, then releases
- **THEN** while holding, the plot is about 480 px tall and the revision is still n; after the release the plot stays about 480 px tall, the revision is n + 1, the window's width is unchanged (±1 px), and after a reload the plot is still about 480 px tall
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while holding and after release, plot height and window width from `getBoundingClientRect()`, revision in the status strip)

#### Scenario: Grip press is not a click elsewhere
- **WHEN** the user presses and releases the grip without moving, in a window that is not marked
- **THEN** no cursor is placed, the window is not marked, no row drag starts, and the revision is unchanged
- **Evidence:** UI check on smart451 (screenshot, revision before and after)

### Requirement: Grip appearance
The grip SHALL be a curved mark following the window's rounded corner, in a muted colour that turns to the accent colour while hovered or dragged, with the tooltip "Drag to resize height" and a vertical resize pointer. It SHALL NOT cover legend text, a value or a control. Origin: D-037 item (1) („apple like curved handle"); vertical pointer because only the height changes (design G2, Q2); no overlap as a necessary consequence of a readable legend.

#### Scenario: Look and pointer
- **WHEN** at 1440×900 the pointer rests on the option bar, then moves onto a window's grip
- **THEN** the grip is a curved mark in the muted colour at rest and in the accent colour under the pointer, the tooltip reads "Drag to resize height", and the pointer is a vertical resize pointer (`getComputedStyle(grip).cursor` is `ns-resize`)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot of the corner at rest and hovered, computed cursor)

#### Scenario: Grip covers nothing
- **WHEN** at 1440×900 a timeseries window in the right grid column shows four signals with cursors A and B on and Diff on, so its legend rows are full
- **THEN** no legend text or value overlaps the grip's hit box (rects of the grip and the last legend row's cells do not intersect)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot of the corner, rects)
