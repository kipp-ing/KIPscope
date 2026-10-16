## ADDED Requirements

### Requirement: Flash look
A flashing window (`data-flash`) SHALL start with a 3 px accent-ring outline and an accent-soft fill and fade to its normal look within 1.2 s, moving nothing; under `prefers-reduced-motion: reduce` it SHALL show the outline without animation. A marked window keeps its mark after the flash. Origin: Jan 2026-10-17 („outline highlighted or so"); tokens D-055; reduced motion: necessary consequence (accessibility).

#### Scenario: Flash on a new window
- **WHEN** a new window appears through an explorer add and its rect is read at once and 1.5 s later
- **THEN** right after the add its `animation-name` is `window-flash`; 1.5 s later it has no `data-flash`, and its `getBoundingClientRect()` is the same at both reads (±0.5 px)
- **Evidence:** UI check on smart451 (computed values, rects, one screenshot during the flash)

#### Scenario: Reduced motion
- **WHEN** Chrome emulates `prefers-reduced-motion: reduce` and a window flashes
- **THEN** its `animation-name` is `none` and its `box-shadow` contains `rgb(125, 211, 252) 0px 0px 0px 3px` while `data-flash` is set
- **Evidence:** UI check on smart451 (computed values); if the automation cannot emulate the media feature, `not_run` with the stylesheet rule quoted

### Requirement: Help panel look
The help panel SHALL be white with a slate-200 left border, a "HELP" section label, the tabs Manual and Keys as pills (active slate-900, white text) and a × button; keys SHALL be `kbd` elements (slate-100 fill, 1 px slate-300 border, 4 px radius, 11 px monospace). It adds no primary button. Origin: D-055 (tokens, pills, section labels); design H7.

#### Scenario: Panel look
- **WHEN** the Keys tab is open on smart451
- **THEN** the panel's background is `rgb(255, 255, 255)` and its left border colour `rgb(226, 232, 240)`; the Keys tab pill's background is `rgb(15, 23, 42)`; a `kbd` has background `rgb(241, 245, 249)`, border colour `rgb(203, 213, 225)`, `border-radius` 4 px and a `font-family` starting `ui-monospace`
- **Evidence:** UI check on smart451 (computed values, screenshot)

### Requirement: Start card look
The start card SHALL be a white tile at most 640 px wide with a slate-200 frame, a 6 px radius and a 3 px accent left bar. Its heading SHALL be 12 px weight 600, its four steps a numbered list, and its "Manual" and "Keys" buttons normal 26 px controls. It SHALL add no primary button. Origin: D-055 (window tile look); design H7.

#### Scenario: Card look
- **WHEN** the start card shows on smart451 at 1440×900
- **THEN** its width is ≤ 640 px, `border-left` is 3 px `rgb(2, 132, 199)`, the other borders `rgb(226, 232, 240)`, `border-radius` 6 px, and its buttons are 26 px tall
- **Evidence:** UI check on smart451 (computed values, screenshot)
