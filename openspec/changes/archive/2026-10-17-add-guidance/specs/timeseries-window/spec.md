## MODIFIED Requirements

### Requirement: New windows scroll into view
A window this browser tab creates SHALL be scrolled fully into view: below the top row and above the status strip, or with its header right below the top row when it is taller than that area. The windows that SHALL be revealed this way are those created by "+ Values window", by an explorer add (`+`, Enter, a selection), by a drop on "+ New window" or on the free area below the windows (workspace-layout "Drop below the windows"), and by a values row moved into a new window. Of several created windows the first SHALL be scrolled to. Each created window SHALL flash once for `FLASH_MS` (1,200 ms; design-language "Flash look"). An explorer add into an existing window (the marked one) SHALL reveal and flash that window the same way. Drops onto an existing window and windows created by the CLI SHALL neither scroll nor flash. Origin: power-user bug (feedback 2026-10-15, item 4: the new window was appended out of sight); D-037 item (2) for the free area; persona test 2026-10-17 finding 3 (novice and boss could not find the new window); Jan 2026-10-17 („highlighted"); defaults S2 (design.md).

#### Scenario: Values window below the fold
- **WHEN** six windows fill more than the viewport, the list is scrolled to the top, and the user clicks "+ Values window", later drops a legend row on "+ New window"
- **THEN** each new window is fully visible right after it appears, without manual scrolling, and flashes
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each creation)

#### Scenario: Drop below a short list
- **WHEN** at 1440×900 two windows share the first row and the user drops the `BRK_1A0h.WSPD_FL` explorer row on the free area below them
- **THEN** the new window is fully visible right after it appears, without manual scrolling
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the drop)

#### Scenario: Explorer add among seventeen windows
- **WHEN** seventeen windows exist (created with `kipscope window create` and `kipscope signal add`), the list is scrolled to the top, no window is marked, and the user types `SPEED_DISP` and presses Enter
- **THEN** within one second the new window is fully visible between the top row and the status strip and carries `data-flash`; 1.5 s later it no longer carries it
- **Evidence:** UI check on smart451 at 1440×900 (screenshot within 1 s, the attribute read twice)

#### Scenario: Add into a marked window out of sight
- **WHEN** of seventeen windows window 1 is marked, the list is scrolled to the end, and the user adds `ENG_5E0h.T_ENG` with the row's add button
- **THEN** window 1 is scrolled fully into view (its header right below the top row if taller), shows T_ENG and flashes; no new window is created
- **Evidence:** UI check on smart451 at 1440×900 (screenshot within 1 s)

#### Scenario: Selection creates two windows
- **WHEN** the user selects six signals of six units and presses Enter with "New window" as target
- **THEN** the first of the two new windows is scrolled into view and both carry `data-flash` right after the add
- **Evidence:** UI check on smart451 (the attribute on both, screenshot)

#### Scenario: Scroll delta
- **WHEN** `revealDelta` gets a window fully inside the view, one below it, one above it, and one taller than the view, each with view `{top: 100, bottom: 700}`
- **THEN** it returns 0, `bottom − 700`, `top − 100`, and `top − 100`
- **Evidence:** `apps/web/test/reveal.test.ts` › "scrolls a window fully into view below the top row"

#### Scenario: Drop on an existing window
- **WHEN** the user drops an explorer row onto a visible, unmarked window
- **THEN** the list does not scroll and the window carries no `data-flash`
- **Evidence:** UI check on smart451 (scroll position before and after, the attribute)
