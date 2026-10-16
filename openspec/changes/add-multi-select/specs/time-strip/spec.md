## ADDED Requirements

### Requirement: Selection drop on the strip
While an explorer selection of two or more signals is dragged over the strip and some of them have named states and are not on the events line, the strip SHALL show the accent outline and `Drop to mark state changes of <name>` (the shown name of the only such signal, else `<k> signals`); a drop SHALL send `events.addSignal` for each such signal in list order, skip the others, and stop at the first refusal. Origin: D-059 with D-066; skipping: lead default L5.

#### Scenario: Selection with one state signal
- **WHEN** on smart451 at 1440×900 `BS_200h.BLS` is not on the events line, the user types `BLS`, clicks `BLS` and Shift-clicks `VOLLBRE` (BLS, BLS_PA, BLS_RAW, VOLLBRE; only BLS has states) and drags the selection onto the strip
- **THEN** while dragging the strip shows `Drop to mark state changes of BLS`; after the drop the revision rose by one and the Events tab lists BLS among the events-line signals
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while dragging, revision after)

### Requirement: Selection without new state signals
When no signal of a dragged selection has named states and is off the events line, the strip SHALL show the refused look with `None of <N> signals has new named states`, and a drop SHALL send nothing. Origin: D-059 with D-066; lead default L5.

#### Scenario: Strip helpers
- **WHEN** `eventsDropMany` gets IDs of a signal with states, one without, one already in `eventSignals` and a second with states; and `stripDropText` gets `{name: "4 signals", ok: false, reason: "none_new"}`
- **THEN** the two signals with states that are not listed, in input order; `None of 4 signals has new named states`
- **Evidence:** `apps/web/test/drag.test.ts` › "adds the selection's new state signals on the strip"; `apps/web/test/strip.test.ts` › "names a selection that has no new state signals"
