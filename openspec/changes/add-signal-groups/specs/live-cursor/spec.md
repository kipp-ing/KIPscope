## MODIFIED Requirements

### Requirement: Near signal
In the hovered window, the near signal SHALL be the one whose curve at the pointer's x lies within 16 px vertically of the pointer; with several, the nearest, on a tie the one later in the legend. The distance SHALL be measured in screen pixels on each signal's own y axis. Only a signal with a number at L is a candidate. Origin: D-032 („within about 8 px vertically of the pointer (nearest wins)"), distance superseded by D-052 („should be double"; 16 px); per-axis pixels: necessary consequence of several y axes in one plot.

#### Scenario: Nearest of three
- **WHEN** the candidates lie 17 px, 3 px and 5 px from the pointer; then 3 px and 3 px; then 16 px (above or below); then 16.5 px
- **THEN** the second is near; then the later of the two; then that one; then none
- **Evidence:** `apps/web/test/live.test.ts` › "picks the nearest curve within 16 px, on a tie the later one" (`NEAR_PX` is 16)

#### Scenario: Only numbers inside the plot are candidates
- **WHEN** the signals of a 200 px high plot are, in legend order: `SNA`; `—` (gap); `—` (outside this window's range); loading; an envelope edge (no scale) with a number; a number at y −2; a number at y 40; a number at y 40
- **THEN** the candidates are exactly the last two, in that order, so the pointer at y 40 picks the last one
- **Evidence:** `apps/web/test/live.test.ts` › "builds near candidates only from numbers inside the plot"

