## ADDED Requirements

### Requirement: L column in the values window
The values table SHALL have a column `L` after A | B | Δ. Once L has stayed at one time for 150 ms, each row SHALL show its signal's exact value at L, evaluated and printed like the A cell. While L moves, the cells SHALL keep their last L values, dimmed; while L is not set, they SHALL be empty. Origin: D-032 („The values window also gets an L column"); exact values: D-024, D-029; rest delay: necessary consequence of a time that changes at frame rate (design L7, Q1).

#### Scenario: Live values in the values window
- **WHEN** a values window ("Between points: linear") lists `COMBI_412h.V_ANZ`, `BS_200h.DVL` and `CPC_448h.PTC_HV_Volt`, and the pointer rests on a timeseries window at 2026-10-13T13:08:00.093Z
- **THEN** within 1 s the `L` column reads `23.0 km/h`, `180 1/min lin` and `363 V lin`, the same as the A cells after a click there without moving
- **Evidence:** UI check (screenshot after the click)

#### Scenario: Requests only at rest
- **WHEN** L changes every 50 ms for 1 s for a values window with three rows, then stays
- **THEN** no value request is sent while it changes, the cells keep their previous values dimmed, and 150 ms after the last change exactly three requests are sent, keyed apart from the A and B requests
- **Evidence:** `apps/web/test/values.test.ts` › "requests L values only after the pointer rests, apart from A and B"

#### Scenario: No hover
- **WHEN** the pointer is outside every plot
- **THEN** the `L` column header is shown and every L cell is empty
- **Evidence:** UI check (screenshot)

### Requirement: L lookups outside the render acknowledgement
L lookups SHALL neither delay a values window's render acknowledgement nor report an error in it; a failed L lookup SHALL show `—` with the message in its cell. Origin: necessary consequence: L is not workspace state (D-032 „no command, no revision").

#### Scenario: Out of the acknowledgement
- **WHEN** a cursor command is accepted while the L lookup for one row fails (the server answers 502)
- **THEN** that row's L cell reads `—` with the message, its A cell its value, and the revision is reported `complete` without an error for that row
- **Evidence:** `apps/web/test/values.test.ts` › "keeps L requests out of the render acknowledgement"
