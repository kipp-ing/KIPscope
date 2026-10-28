## MODIFIED Requirements

### Requirement: Controls
Top-row buttons, selects and text fields SHALL be 26 px tall with a 1 px slate-300 border, 4 px radius and white fill; disabled ones a slate-200 border and slate-400 text. The range button SHALL be 26 px tall and 212 px wide. Icon-only buttons (the sidebar button, Back, Reset, "Link time axes", "⋯", "?") SHALL be 26 × 26 px with a 14–16 px stroke icon in slate-700 (pressed: "Cursor toggles as pills"), an `aria-label` and a tooltip; Reset's icon is a fit glyph (two vertical bars at the edges and a double arrow between them, mock `Main.dc.html`), not a fullscreen corner glyph. In the context row the position button and the action buttons SHALL be 24 px tall. The explorer search SHALL be 30 px tall; header controls stay 22 px. With the sidebar open the top row stays one line at 1440×900 and 1000×557. The sidebar button's icon is no exception to slate-700. Origin: D-055 (mock "Controls"); sidebar icon colour: review day 2026-10-28 T-13 (it was slate-900, `--text`); 22 px and one line: `workspace-layout` "Compact window header", "Screen use"; icons: D-092 (mock `Main.dc.html`); fit glyph and 24 px: D-095 (critic 15: the Reset icon read as fullscreen); range button: D-092 (1), (2); 212 px: D-093 (mock `GoTo.dc.html`).

#### Scenario: Control boxes
- **WHEN** a timeseries window is shown, "Back" is disabled (no history) and a catalog is open
- **THEN** "Reset", "Back", "Link time axes", "⋯" and "?" measure 26 × 26 px and Views and the range button 26 px tall (`getBoundingClientRect()`, ±0.5), the range button 212 px wide; the position button measures 88 × 24 px and `Unlink` 64 × 24 px; "Reset" has `border-radius` 4 px, border colour `rgb(203, 213, 225)` and its SVG holds two vertical `line`s (and the arrow's shaft) and two `polyline`s (the fit glyph); "Back" has border colour `rgb(226, 232, 240)` and its icon in `rgb(148, 163, 184)`; the search field is 30 px tall; a window's "⋯" button is at most 22 px tall (the Digits select and the window's mode select left the row and the header in `declutter-workspace`)
- **Evidence:** UI check on smart451 at 1440×900 (the measured values, the Reset SVG's children); `apps/web/test/bar.test.ts` › "renders the top row in order" (Reset's markup holds the fit glyph)

#### Scenario: Icon colour of the sidebar button
- **WHEN** `apps/web/src/styles.css` is read, and on smart451 at 1440×900 the UI user reads `getComputedStyle(…).color` of the sidebar button and of "Reset" (enabled, not pressed) with the sidebar open and closed
- **THEN** the `.option-bar-slot .sidebar-toggle` rule sets `color: var(--label)` (slate-700), not `var(--text)`; in the page both read `rgb(51, 65, 85)` in both states
- **Evidence:** `apps/web/test/designTokens.test.ts` › "sidebar button icon is slate-700"; UI check on smart451 (the two colours per state, one screenshot of the top row's left end)

#### Scenario: One line at both viewports
- **WHEN** the six-window setup is shown with the sidebar open at 1440×900 and at 1000×557
- **THEN** every control of the top row has the same `getBoundingClientRect().top` (±1 px) in each viewport; goal, measured and reported but not pass/fail: top row ≤ 36 px tall (`workspace-layout` "Compact bars")
- **Evidence:** UI check on smart451 (tops and height per viewport, one screenshot each)

