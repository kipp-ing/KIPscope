## MODIFIED Requirements

### Requirement: Controls
Top-row buttons, selects and text fields SHALL be 26 px tall with a 1 px slate-300 border, 4 px radius and white fill; disabled ones a slate-200 border and slate-400 text. The explorer search SHALL be 30 px tall; header controls stay 22 px. With the sidebar open the top row stays one line at 1440×900 and 1000×557. Origin: D-055 (mock "Controls"); 22 px and one line: `workspace-layout` "Compact window header", "Screen use"; range button: D-092 (1), (2).

#### Scenario: Control boxes
- **WHEN** a timeseries window is shown and "Back" is disabled (no history)
- **THEN** "Reset", "Back", the Digits select and the range button measure 26 px tall (`getBoundingClientRect().height`, ±0.5) and the range button 318 px wide; "Reset" has `border-radius` 4 px and border colour `rgb(203, 213, 225)`; "Back" has border colour `rgb(226, 232, 240)` and text colour `rgb(148, 163, 184)`; the search field is 30 px tall; a window's mode select is 22 px tall
- **Evidence:** UI check on smart451 at 1440×900 (the measured values)

#### Scenario: One line at both viewports
- **WHEN** the six-window setup is shown with the sidebar open at 1440×900 and at 1000×557
- **THEN** every control of the top row has the same `getBoundingClientRect().top` (±1 px) in each viewport; goal, measured and reported but not pass/fail: top row ≤ 36 px tall (`workspace-layout` "Compact bars")
- **Evidence:** UI check on smart451 (tops and height per viewport, one screenshot each)
