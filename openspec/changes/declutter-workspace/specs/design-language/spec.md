## MODIFIED Requirements

### Requirement: Controls
Top-row buttons, selects and text fields SHALL be 26 px tall with a 1 px slate-300 border, 4 px radius and white fill; disabled ones a slate-200 border and slate-400 text. Icon-only buttons (the sidebar button, Back, Reset, "Link time axes", "⋯", "?") SHALL be 26 × 26 px with a 14–16 px stroke icon in slate-700 (the pressed link toggle in the accent ink), an `aria-label` and a tooltip. The explorer search SHALL be 30 px tall; header controls stay 22 px. With the sidebar open the top row stays one line at 1440×900 and 1000×557. Origin: D-055 (mock "Controls"); 22 px and one line: `workspace-layout` "Compact window header", "Screen use"; icons: D-092 (mock `Main.dc.html`).

#### Scenario: Control boxes
- **WHEN** a timeseries window is shown and "Back" is disabled (no history)
- **THEN** "Reset", "Back", "Link time axes", "⋯" and "?" measure 26 × 26 px and Views and the range control 26 px tall (`getBoundingClientRect()`, ±0.5); "Reset" has `border-radius` 4 px; "Back" has its icon in `rgb(148, 163, 184)`; the search field is 30 px tall; a window's "⋯" button is at most 22 px tall
- **Evidence:** UI check on smart451 at 1440×900 (the measured values)

#### Scenario: One line at both viewports
- **WHEN** the six-window setup is shown with the sidebar open at 1440×900 and at 1000×557
- **THEN** every control of the top row has the same `getBoundingClientRect().top` (±1 px) in each viewport; goal, measured and reported but not pass/fail: top row ≤ 40 px tall (`workspace-layout` "Compact bars")
- **Evidence:** UI check on smart451 (tops and height per viewport, one screenshot each)

### Requirement: Cursor toggles as pills
A, B and Diff SHALL be pills (26 px, fully rounded): on slate-900 with white text, off white with a slate-300 border, disabled as in "Controls", with unchanged behaviour, tooltips and keys (accent focus ring, Space switches). "Link time axes" SHALL be an icon toggle ("Controls") whose pressed state shows the icon in the accent ink on a white fill, its released state in slate-500. The sidebar button SHALL show its icon in slate-700 on white in both states, its state in `aria-expanded` and its tooltip. Origin: D-055 (mock option bar); icon toggles: D-092 (mock `Main.dc.html`).

#### Scenario: Pills on and off
- **WHEN** A is on, B off and Diff off; then the user presses Tab until A's toggle has focus and presses Space
- **THEN** first A's pill has background `rgb(15, 23, 42)` and text `rgb(255, 255, 255)`, B's and Diff's background `rgb(255, 255, 255)` and border `rgb(203, 213, 225)`, each 26 px tall with `border-radius` ≥ 13 px; after Space, A is off (the A line is gone, revision +1) and the focused pill shows an accent outline
- **Evidence:** UI check on smart451 (computed values, screenshot before and after Space); `apps/web/test/bar.test.ts` stays green

#### Scenario: Signals toggle
- **WHEN** the sidebar is open and "Link time axes" is on, then the user presses `s` and clicks "Link time axes"
- **THEN** the sidebar button has `aria-expanded="true"`, then `"false"`, with the same box (±0.5 px); the link icon's stroke is `rgb(3, 105, 161)` or `rgb(2, 132, 199)` while pressed and `rgb(100, 116, 139)` after the click, `aria-pressed` `"true"` then `"false"`
- **Evidence:** UI check on smart451 (computed values and boxes in both states)

## ADDED Requirements

### Requirement: Layout never moves
A control or text slot SHALL keep its box while its content changes by loading, stepping, zooming, a cursor move or a live update: fixed widths sized for the longest text of their format, tabular figures, loading drawn inside the loaded box, overlong text cut with `…` and shown whole as tooltip. Boxes change only with the viewport, the sidebar, the grid, or a control the user adds or removes. The layout probe (design DW1) is the check. Origin: D-092; Jan: „stable and clean it shall be".

#### Scenario: Probe during a step
- **WHEN** at 1440×900 with the sidebar open, an open catalog from `kipscope case drives smart451`, the six-window setup with A on, the UI user starts the layout probe of design DW1 and presses `]`, waits until the progress line is gone, and stops the probe
- **THEN** every element the probe watches (each top-row control, each context-row slot, the strip, each window's mode tag, "⋯" and legend header cells, the footer's status and attribution) moved and resized by at most 1 px
- **Evidence:** UI check on smart451 at 1440×900 (probe output)

#### Scenario: Tabular numbers in slots
- **WHEN** the computed `font-variant-numeric` is read of the session position, the times and duration slots, the window's mode tag, the legend's header and value cells and the sidebar tab counts
- **THEN** each contains `tabular-nums`
- **Evidence:** UI check on smart451 (the snippet and its output)
