## ADDED Requirements

### Requirement: Selected row look
A selected explorer row SHALL show a 3 px accent bar on its left edge (`box-shadow: inset 3px 0 0 var(--accent)`) and its name in the accent ink, with its fill unchanged, so the accent soft fill stays the mark of the active row alone; a row both active and selected shows both. Rows stay ≤ 24 px. Origin: lead default L1 (selected style per the design language, active style distinct); tokens: D-055.

#### Scenario: Selected and active rows apart
- **WHEN** on smart451 at 1440×900 the user types `speed`, clicks `DVL` and Shift-clicks `DHL`
- **THEN** `DVR` (selected, not active) has a computed `box-shadow` containing `rgb(2, 132, 199) 3px 0px 0px 0px inset`, a transparent background and name colour `rgb(7, 89, 133)`; `DHL` (selected and active) has the same bar and background `rgb(224, 242, 254)`; `DHR` (neither) has neither; every row is ≤ 24 px tall
- **Evidence:** UI check on smart451 at 1440×900 (computed values, one screenshot)
