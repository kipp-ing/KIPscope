## ADDED Requirements

### Requirement: Gap band look
The web app SHALL define the token `--gap-fill` `#f1f5f9` (slate-100) on `:root` and paint logger gap bands with it, opaque, without border or hatching, and draw the gap text `no data` in readout and value cells in `--muted`, not in the SNA style. Origin: D-062 („a faint grey band"); token rule: design-language "Design tokens" (D-055).

#### Scenario: Computed look
- **WHEN** on smart451 at 1440×900 a window shows the band of "Band in a drive" and A is inside it
- **THEN** `getComputedStyle(document.documentElement)` gives `--gap-fill` `#f1f5f9`; the band's pixels read `rgb(241, 245, 249)` where no grid line or curve crosses; the A cell `no data` has `color` `rgb(100, 116, 139)`
- **Evidence:** UI check on smart451 (computed values, one screenshot)
