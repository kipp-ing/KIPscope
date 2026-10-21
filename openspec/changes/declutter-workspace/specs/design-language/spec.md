## MODIFIED Requirements

### Requirement: Controls
Top-row buttons, selects and text fields SHALL be 26 px tall with a 1 px slate-300 border, 4 px radius and white fill; disabled ones a slate-200 border and slate-400 text. Icon-only buttons (the sidebar button, Back, Reset, "Link time axes", "⋯", "?") SHALL be 26 × 26 px with a 14–16 px stroke icon in slate-700 (pressed: "Cursor toggles as pills"), an `aria-label` and a tooltip; Reset's icon is a fit glyph (two vertical bars at the edges and a double arrow between them, mock `Main.dc.html`), not a fullscreen corner glyph. In the context row the position button and the action buttons SHALL be 24 px tall. The explorer search SHALL be 30 px tall; header controls stay 22 px. With the sidebar open the top row stays one line at 1440×900 and 1000×557. Origin: D-055 (mock "Controls"); 22 px and one line: `workspace-layout` "Compact window header", "Screen use"; icons: D-092 (mock `Main.dc.html`); fit glyph and 24 px: D-095 (critic 15: the Reset icon read as fullscreen).

#### Scenario: Control boxes
- **WHEN** a timeseries window is shown, "Back" is disabled (no history) and a catalog is open
- **THEN** "Reset", "Back", "Link time axes", "⋯" and "?" measure 26 × 26 px and Views and the range control 26 px tall (`getBoundingClientRect()`, ±0.5); the position button measures 88 × 24 px and `Unlink` 64 × 24 px; "Reset" has `border-radius` 4 px and its SVG holds two vertical `line`s and two `polyline`s (the fit glyph); "Back" has its icon in `rgb(148, 163, 184)`; the search field is 30 px tall; a window's "⋯" button is at most 22 px tall
- **Evidence:** UI check on smart451 at 1440×900 (the measured values, the Reset SVG's children); `apps/web/test/bar.test.ts` › "renders the top row in order" (Reset's markup holds the fit glyph)

#### Scenario: One line at both viewports
- **WHEN** the six-window setup is shown with the sidebar open at 1440×900 and at 1000×557
- **THEN** every control of the top row has the same `getBoundingClientRect().top` (±1 px) in each viewport; goal, measured and reported but not pass/fail: top row ≤ 40 px tall (`workspace-layout` "Compact bars")
- **Evidence:** UI check on smart451 (tops and height per viewport, one screenshot each)

### Requirement: Cursor toggles as pills
A, B and Diff SHALL be toggle buttons 26 px tall, at least 30 px wide, 4 px radius, with unchanged behaviour, tooltips and keys (accent focus ring, Space switches). Every toggle SHALL use one pressed style: fill sky-100 `#e0f2fe`, 1 px border sky-300 `#7dd3fc`, ink sky-700 `#0369a1` (text weight 600, icon stroke): A, B and Diff while on, "Link time axes" while on, the position button while its list is open and the checked item of the catalog list's `ALIGN` group. Released, a toggle looks like any top-row control (white, slate-300 border, slate-700 ink). The sidebar button SHALL show its icon in slate-700 on white in both states, its state in `aria-expanded` and its tooltip. Origin: D-055 (mock option bar); icon toggles: D-092 (mock `Main.dc.html`); one pressed style: D-095 (critic 9: three solid slate-900 pills were the heaviest marks on screen while Link used a sky tint).

#### Scenario: Pills on and off
- **WHEN** A is on, B off and Diff off; then the user presses Tab until A's toggle has focus and presses Space
- **THEN** first A's toggle has background `rgb(224, 242, 254)`, border colour `rgb(125, 211, 252)` and text `rgb(3, 105, 161)`, B's and Diff's background `rgb(255, 255, 255)` and border `rgb(203, 213, 225)`, each 26 px tall with `border-radius` 4 px; after Space, A is off (the A line is gone, revision +1) with B's look, and the focused toggle shows an accent outline
- **Evidence:** UI check on smart451 (computed values, screenshot before and after Space); `apps/web/test/bar.test.ts` stays green

#### Scenario: Signals toggle
- **WHEN** the sidebar is open and "Link time axes" is on, then the user presses `s` and clicks "Link time axes"; then a catalog is open and the user opens its list
- **THEN** the sidebar button has `aria-expanded="true"`, then `"false"`, with the same box (±0.5 px); "Link time axes" has background `rgb(224, 242, 254)` and its icon stroke `rgb(3, 105, 161)` while pressed, white and `rgb(51, 65, 85)` after the click, `aria-pressed` `"true"` then `"false"`; the open list's position button and its checked `ALIGN` item have background `rgb(224, 242, 254)` and ink `rgb(3, 105, 161)`
- **Evidence:** UI check on smart451 (computed values and boxes in each state)

### Requirement: Spec numbers kept
The restyle SHALL keep every size other specs set for the page: sidebar 248 px (208 px below 1200 px viewport width, workspace-layout "Collapsible sidebar"), explorer rows and group headers ≤ 24 px, window headers ≤ 24 px, footer ≤ 32 px (two lines ≤ 48 px), A | B | Δ | L in a 485 px values window, default plot 280 px, plot share ≥ 30 % at 1000×557 with the sidebar open. Origin: necessary consequence of D-055 („restyle only"); the numbers and their specs: design T9; sidebar width: D-095.

#### Scenario: Numbers re-measured
- **WHEN** the six-window setup and one values window 485 px wide are shown on smart451, at 1440×900 and at 1000×557 with the sidebar open
- **THEN** sidebar 248 px at 1440×900 and 208 px at 1000×557 (±1), every explorer row and header ≤ 24 px, every `.window-header` ≤ 24 px, footer ≤ 32 px, the values window shows A, B, Δ and L uncut, a fresh window's plot 280 px (±1), and the design M1 plot share at 1000×557 ≥ 30 %
- **Evidence:** UI check on smart451 (measured values, the M1 snippet output, one screenshot per viewport)

## ADDED Requirements

### Requirement: Layout never moves
A control or text slot SHALL keep its box while its content changes by loading, stepping, zooming, a cursor move or a live update: fixed widths sized for the longest text of their format, tabular figures, loading drawn inside the loaded box, overlong text cut with `…` and shown whole as tooltip. Boxes change only with the viewport, the sidebar, the grid, or a control the user adds or removes. The layout probe (design DW1) is the check. Origin: D-092; Jan: „stable and clean it shall be".

#### Scenario: Probe during a step
- **WHEN** at 1440×900 with the sidebar open, an open catalog from `kipscope case drives smart451`, the six-window setup with A on, the UI user starts the layout probe of design DW1 and presses `]`, waits until the progress line is gone, and stops the probe
- **THEN** every element the probe watches (each top-row control, the sidebar, each context-row slot, the strip and its end slots, each window's mode tag, "⋯" and legend header cells, the footer's status and attribution) moved and resized by at most 1 px
- **Evidence:** UI check on smart451 at 1440×900 (probe output)

#### Scenario: Tabular numbers in slots
- **WHEN** the computed `font-variant-numeric` is read of the session position, the duration slot, the strip's end slots, the window's mode tag, the legend's header and value cells and the sidebar tab counts
- **THEN** each contains `tabular-nums`
- **Evidence:** UI check on smart451 (the snippet and its output)
