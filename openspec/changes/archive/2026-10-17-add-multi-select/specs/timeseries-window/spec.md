## ADDED Requirements

### Requirement: Selection overflows into new windows
A selection of two or more explorer signals, dropped or added, SHALL be placed in list order: a signal the target shows is skipped; each other goes into the first window where it fits, the target first, then the windows this add created, else into a new window. A timeseries window fits while it keeps at most four units, counting those it already shows; a values window fits every signal. Origin: D-066 („Only by unit limit", „Fill it up"); skip, first fit: lead default L4.

#### Scenario: Six units onto "+ New window"
- **WHEN** on smart451 at 1440×900 the user types `speed`, Ctrl-clicks (Cmd on macOS) `LWS_SPEED` (°/s), `CompSpd_Target_V2` (%), `DVL` (1/min), `V_ANZ` (km/h), `V_MAX_TM` (km/h(mph)) and `NMOTS` (~/min), and drags `DVL` onto "+ New window"
- **THEN** while dragging the ghost reads `6 signals · add` over the zone; after the drop two new windows appear: the first shows LWS_SPEED, CompSpd_Target_V2, DVL, V_ANZ on four axes, the second V_MAX_TM and NMOTS; the first is scrolled into view and the revision rose by eight
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while dragging, screenshot and revision after the drop)

#### Scenario: Drop onto a window with three units
- **WHEN** window `W` shows `CPC_168h.EAC_HV_Volt` (V), `COMBI_412h.V_ANZ` (km/h) and `MS_608h.T_MOT` (°C), and the user types `speed`, Ctrl/Cmd-clicks `LWS_SPEED`, `CompSpd_Target_V2`, `DVL`, `DVR` and `V_ANZ`, and drags the selection onto `W`
- **THEN** `W` is highlighted with "Drop to add" (not "At most 4 units per window"); after the drop `W` shows its three signals plus LWS_SPEED (four units), one new window shows CompSpd_Target_V2, DVL and DVR, V_ANZ is not added twice, and the revision rose by five
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while dragging, screenshot and revision after the drop)

#### Scenario: Placement rules
- **WHEN** `placeSignals` gets six signals of six units for an empty timeseries window; five signals `d, e, a, f, b` for a window showing units `a, b, c`; nine signals of nine units for "+ New window"; a values window showing `x` with `x` and six other units; three signals without unit and two of unit `V` for an empty window; a list with a repeated ID
- **THEN** four into the target and two into created window 0 (`windows` 1); `d`, `a`, `b` into the target and `e`, `f` into window 0; windows 0, 0, 0, 0, 1, 1, 1, 1, 2 (`windows` 3); `x` skipped and all six into the values window; the three unitless and the first `V` into the target, the second `V` too (`V` is one unit); the repeat placed once
- **Evidence:** `packages/shared/test/placement.test.ts` › "fills the target up to four units and overflows into new windows", "counts the units the target already shows", "puts each signal into the first window it fits", "creates windows for a new-window target", "takes any unit into a values window", "counts a signal without unit as its own unit", "places a repeated signal once"

### Requirement: Running a selection add
A selection add SHALL have no signal-count limit beyond the workspace's 50 signals. It SHALL send its commands in list order, creating each new window right before its first signal, and on the first refused command (e.g. `signal_limit`) stop, keep what was added and show the server's message once. A new window SHALL get the range a single "New window" add would give it, over all its signals; the first new window SHALL be scrolled into view. Origin: D-066; lead default L4.

#### Scenario: Running a plan stops at the first refusal
- **WHEN** `runPlan` runs a plan with one created window and three steps against a fake `command` that refuses the second `window.addSignal` with `signal_limit`
- **THEN** it sent `window.create` (with the range from `rangeFor` of that window's signals), the first `window.addSignal`, the refused one, and nothing after; it returns the created window's ID
- **Evidence:** `apps/web/test/addSignals.test.ts` › "creates each window before its first signal and stops at the first refusal"

### Requirement: Selection drag feedback
During a selection drag, a window SHALL be highlighted with "Drop to add" when it does not show at least one selected signal, and SHALL never be refused for units; "+ New window" always accepts. The ghost SHALL read `<N> signals`, plus ` · add` over a valid target and `· Already shown` over a window that shows all N. Origin: D-066; targets and ghost: lead defaults L2 and L6.

#### Scenario: Targets of a selection drag
- **WHEN** drop states are computed for an explorer source with `signalIds` `[A, B]` over: a window showing A only; a window showing A and B; a window with four other units; "+ New window"
- **THEN** target; not highlighted; target (never "refused"); accepted
- **Evidence:** `apps/web/test/drag.test.ts` › "highlights a window for a selection while one signal is new"

## MODIFIED Requirements

### Requirement: Refused drop targets
During a drag, the legend row's own window and any window already showing the signal SHALL be refused without a highlight. A timeseries window that would reach a fifth unit SHALL be marked not droppable with the hint "At most 4 units per window", whatever the drag source, except for a drag of an explorer selection of two or more signals, which overflows instead ("Selection overflows into new windows"). A values window SHALL never be refused for units. Origin: D-019 (four units), D-020 (refusal for explorer drags), D-023 (values rows as source; no unit limit in the values window); selection exception: D-066.

#### Scenario: Values row over a four-unit window
- **WHEN** window A shows four units (V, km/h, °C, 1/min) and the user drags the `MS_312h.DNMOT` row of a values window over A and releases
- **THEN** A is marked not droppable with "At most 4 units per window", and the release changes nothing (revision unchanged)
- **Evidence:** `apps/web/test/drag.test.ts` › "drags a values row like a legend row"; UI check (screenshot while dragging, revision before and after)

#### Scenario: Values window takes a fifth unit
- **WHEN** a values window lists four units and the user drags the DNMOT legend row from a timeseries window over it
- **THEN** the values window is highlighted with "Drop to move · Alt/Ctrl+drop to copy"
- **Evidence:** `apps/web/test/drag.test.ts` › "accepts any unit on a values window"; UI check (screenshot while dragging)

#### Scenario: Selection over a four-unit window
- **WHEN** window A shows four units (V, km/h, °C, 1/min) and the user drags an explorer selection of `MS_312h.DNMOT` and `SAS_0C2h.LWS_SPEED` over A and releases
- **THEN** A is highlighted with "Drop to add" while dragging; after the release A is unchanged and one new window shows DNMOT and LWS_SPEED
- **Evidence:** `apps/web/test/drag.test.ts` › "highlights a window for a selection while one signal is new"; `packages/shared/test/placement.test.ts` › "counts the units the target already shows"
