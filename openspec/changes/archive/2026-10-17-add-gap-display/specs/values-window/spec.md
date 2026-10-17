## MODIFIED Requirements

### Requirement: SNA and missing values at a cursor
A value that is SNA at the cursor SHALL be shown as `SNA` in the SNA style, never as a number. A value inside a gap SHALL be shown as `no data` in the muted style with the gap as tooltip: the logger recorded nothing (`logger_gap`), or more than 3 periods without a point (`period_gap`). Where no other value can be evaluated without inventing one, `—` SHALL be shown with the reason as tooltip: before the first point, after the last point, or (in "linear") the next point is SNA. Origin: D-010 (SNA never shown as valid), D-016 (null = SNA); concept §5 („Ohne verfügbare Messgrundlage darf kein Wert erfunden werden"); `no data`: D-062.

#### Scenario: SNA run
- **WHEN** the window lists SPEED_DISP and A is set to `2026-10-13T09:57:00Z` (between the SNA points at 09:56:59.937 and 09:57:00.037 UTC)
- **THEN** the row reads `SNA` in both modes, and no number appears
- **Evidence:** UI check (screenshot); `curl -s 'localhost:7310/api/value?signal=smart451/ICL_3A2h.SPEED_DISP&t=2026-10-13T09:57:00Z' | jq -c .value` prints `{"kind":"sna"}`

#### Scenario: Next point is SNA
- **WHEN** A is set to `2026-10-13T09:56:59.787Z` (between the valid 0 at 09:56:59.737 and the SNA point at 09:56:59.837)
- **THEN** the row reads `—` with tooltip "next point is SNA" in "linear", and `0 km/h hold` in "hold"
- **Evidence:** UI check (two screenshots); `curl -s 'localhost:7310/api/value?signal=smart451/ICL_3A2h.SPEED_DISP&t=2026-10-13T09:56:59.787Z' | jq -c .value` prints `{"kind":"none","reason":"next_sna"}`

#### Scenario: Before the first point
- **WHEN** A is set to `2026-10-11T12:00:00Z`, before SPEED_DISP's first point (12:34:24.824Z)
- **THEN** the row reads `—` with tooltip "before the first point"
- **Evidence:** UI check (screenshot); `apps/web/test/values.test.ts` › "formats SNA and missing values without a number"

#### Scenario: Inside gaps
- **WHEN** the window lists `DCU_2B8h.HTR_HV_Volt` and `STR_0D4h.STEER_ANGLE`, A is set to `2026-10-13T09:27:55Z` (logger gap 09:27:53.936–09:27:56.982), in "linear" and in "hold"; then to `2026-10-13T09:34:36.6Z` (STEER_ANGLE dropout)
- **THEN** both rows read `no data` in both modes with tooltip "no data: the logger recorded nothing"; then both rows read `no data` with tooltip "no data: more than 3 periods without a point" in both modes (HTR_HV_Volt, 100 ms, has nothing from 09:34:36.162 to 09:34:37.051)
- **Evidence:** UI check (screenshots); `apps/web/test/values.test.ts` › "formats gaps as no data"
