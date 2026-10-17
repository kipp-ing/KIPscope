## MODIFIED Requirements

### Requirement: Value at a time
The server SHALL evaluate one signal at one time `t` in mode `line` (default) or `step`. It SHALL return the last point at or before `t`, the first point after `t`, and the value: raw if a point lies at `t`; else linear between valid neighbours (`line`) or the earlier valid value held (`step`), unless the neighbours are split (data-gaps "Split between two points"). SNA, missing values and splits follow "No invented value at a time" and "No value across a gap". Origin: concept §6; D-023; design C4; split: D-062.

#### Scenario: Point, linear and hold
- **WHEN** `testcar/Sna_800h.SPEED` (point n at 2026-10-01T02:00:00Z + n × 100 ms, value n mod 100) is evaluated at 02:00:01Z, at 02:00:01.05Z in `line` and at 02:00:01.05Z in `step`
- **THEN** the values are `{kind: "raw", value: 10}`, `{kind: "interpolated", value: 10.5}` and `{kind: "held", value: 10}`, each with n = 10 as `at` and n = 11 as `next`
- **Evidence:** `apps/server/test/value.http.test.ts` › "evaluates SPEED at points, between points and in SNA runs"

#### Scenario: Real speed between two points
- **WHEN** a client requests `/api/value?signal=smart451/ICL_3A2h.SPEED_DISP&t=2026-10-13T13:08:00.1435Z`
- **THEN** `jq -c .value` prints `{"kind":"interpolated","value":22.5}` (neighbours 23 at 13:08:00.093Z and 22 at 13:08:00.194Z)
- **Evidence:** the `curl` command against the dev server

#### Scenario: Three periods are not a gap
- **WHEN** `gapcar/Cyc_B10h.CYC` (period 20 ms; points 5 at 2026-10-03T00:03:00.100Z and 8 at 00:03:00.160Z, 3 periods apart) is evaluated at 00:03:00.130Z in `line`
- **THEN** the value is `{"kind":"interpolated","value":6.5}`
- **Evidence:** `apps/server/test/value.http.test.ts` › "evaluates across gaps"

## ADDED Requirements

### Requirement: No value across a gap
When the neighbours of `t` are split, the value SHALL be `{kind: "none", reason}` with reason `logger_gap` if a logger gap lies between them, else `period_gap`; except up to the earlier point's hold end, where it SHALL be SNA if that point is SNA and held in `step` mode or next to a state name. Origin: D-062 („A cursor (A, B, L) inside a gap shows „no data", never a value interpolated across it"); hold end: data-gaps.

#### Scenario: Cyclic signal with a dropout and a logger pause
- **WHEN** `gapcar/Cyc_B10h.CYC` (20 ms; 5 at 2026-10-03T00:02:00.100Z, next point at 00:02:00.600Z; last point before the logger gap at 00:04:59.980Z) is evaluated at 00:02:00.110Z in `line` and in `step`, at 00:02:00.130Z in `step`, at 00:04:59.990Z in `step` and at 00:05:30Z in `line`
- **THEN** the values are `{"kind":"none","reason":"period_gap"}`, `{"kind":"held","value":5}`, `{"kind":"none","reason":"period_gap"}`, `{"kind":"none","reason":"logger_gap"}` and `{"kind":"none","reason":"logger_gap"}`
- **Evidence:** `apps/server/test/value.http.test.ts` › "evaluates across gaps"

#### Scenario: Event, measured and diag signals
- **WHEN** `gapcar/Evt_B11h.EVT` (no period; 1 at 00:00:30Z, 2 at 00:04:00Z, 3 at 00:07:00Z) is evaluated at 00:01:40Z in `line`, at 00:04:30Z in `step` and in `line`, and at 00:06:30Z in `step`; `gapcar/Msr_B12h.MSR` (measured 100 ms, nothing in (00:08:00Z, 00:08:01Z)) at 00:08:00.5Z; `gapcar/TBMS.current` (10 s; 12.5 at 00:01:00Z, next at 00:01:40Z) at 00:01:05Z in `step` and at 00:01:20Z in `line`
- **THEN** the values are `{"kind":"interpolated","value":1.3333333333333333}`, `{"kind":"held","value":2}`, `{"kind":"none","reason":"logger_gap"}`, `{"kind":"none","reason":"logger_gap"}`; `{"kind":"none","reason":"period_gap"}`; `{"kind":"held","value":12.5}` and `{"kind":"none","reason":"period_gap"}`
- **Evidence:** `apps/server/test/value.http.test.ts` › "evaluates across gaps"

#### Scenario: Pure evaluation
- **WHEN** `evaluateAt` gets neighbours 4 at 0 ns and 7 at 100 ms with period 20 ms, at 10 ms and 30 ms in both modes; the same with the first neighbour SNA at 10 ms and 30 ms; and neighbours 4 at 0 ns and 7 at 2.1 s without a period but with a logger gap 50 ms–2.05 s, at 30 ms and 60 ms in `step`
- **THEN** line: none `period_gap` twice; step: held 4, then none `period_gap`; SNA: `sna`, then none `period_gap`; logger: held 4, then none `logger_gap`
- **Evidence:** `packages/shared/test/cursor.test.ts` › "returns no value across a gap"

#### Scenario: Real signal in a logger gap and in a dropout
- **WHEN** a client requests `/api/value?signal=smart451/DCU_2B8h.HTR_HV_Volt&t=2026-10-13T09:27:55Z` and `/api/value?signal=smart451/STR_0D4h.STEER_ANGLE&t=2026-10-13T09:34:36.6Z&mode=step`
- **THEN** `jq -c .value` prints `{"kind":"none","reason":"logger_gap"}` and `{"kind":"none","reason":"period_gap"}` (STEER_ANGLE, 10 ms: nothing from 09:34:36.204 to 09:34:37.004 UTC)
- **Evidence:** the `curl` commands against the dev server

#### Scenario: Gap info unavailable
- **WHEN** a value is requested while the gap info of its data ref cannot be computed (stub source fails the logger-gap query)
- **THEN** the answer is 502 `source_error` naming the signal, and no value
- **Evidence:** `apps/server/test/gaps.test.ts` › "answers 502 for a value without gap info"
