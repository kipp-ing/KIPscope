## ADDED Requirements

### Requirement: Value at a time
The server SHALL evaluate one signal at one time `t` in mode `line` (default) or `step`. It SHALL return the last point at or before `t`, the first point after `t`, and the value: raw if a point lies at `t`; else linear between valid neighbours (`line`) or the earlier valid value held (`step`). SNA and missing values follow "No invented value at a time". Origin: concept §6; D-023; design C4.

#### Scenario: Point, linear and hold
- **WHEN** `testcar/Sna_800h.SPEED` (point n at 2026-10-01T02:00:00Z + n × 100 ms, value n mod 100) is evaluated at 02:00:01Z, at 02:00:01.05Z in `line` and at 02:00:01.05Z in `step`
- **THEN** the values are `{kind: "raw", value: 10}`, `{kind: "interpolated", value: 10.5}` and `{kind: "held", value: 10}`, each with n = 10 as `at` and n = 11 as `next`
- **Evidence:** `apps/server/test/value.http.test.ts` › "evaluates SPEED at points, between points and in SNA runs"

#### Scenario: Real speed between two points
- **WHEN** a client requests `/api/value?signal=smart451/ICL_3A2h.SPEED_DISP&t=2026-10-13T13:08:00.1435Z`
- **THEN** `jq -c .value` prints `{"kind":"interpolated","value":22.5}` (neighbours 23 at 13:08:00.093Z and 22 at 13:08:00.194Z)
- **Evidence:** the `curl` command against the dev server

### Requirement: No invented value at a time
The value at a time SHALL be SNA when the point at or before `t` is SNA. It SHALL be no value, with a reason, when there is no point at or before `t` (`before_first`), no point after `t` and none exactly at `t` (`after_last`), or in `line` mode the next point is SNA (`next_sna`). A signal without points SHALL give `no_data`. Origin: D-010, D-016 (null = SNA); concept §5 (no invented values); timeseries-window "No invented values" (the same rules as the drawn curve).

#### Scenario: SNA run and isolated valid point
- **WHEN** `testcar/Sna_800h.SPEED` is evaluated at 02:00:35Z (n = 350, SNA), at 02:00:35.05Z, at 02:01:00.1Z (n = 601, value 42 between the SNA points 600 and 602) and at 02:01:00.15Z
- **THEN** the values are `sna`, `sna`, `{kind: "raw", value: 42}` and, in `line`, `{kind: "none", reason: "next_sna"}`, in `step` `{kind: "held", value: 42}`
- **Evidence:** `apps/server/test/value.http.test.ts` › "evaluates SPEED at points, between points and in SNA runs"; `packages/shared/test/cursor.test.ts` › "returns SNA and no value without inventing one"

#### Scenario: Outside the data
- **WHEN** `testcar/Sna_800h.SPEED` is evaluated at 01:59:59Z and at 02:01:40Z (after the last point n = 999)
- **THEN** the values are `{kind: "none", reason: "before_first"}` and `{kind: "none", reason: "after_last"}`
- **Evidence:** `apps/server/test/value.http.test.ts` › "evaluates SPEED at points, between points and in SNA runs"

### Requirement: Value request errors
A value request SHALL answer like a series request: 400 `invalid_request` for a missing or out-of-bounds `t` or an unknown `mode`, 404 `unknown_signal`, 503 `catalog_unavailable` before the catalog was ever loaded, and 502 `source_error` when the source fails. It SHALL NOT query the database for a 400 or 404. Origin: necessary consequence of series-query "SNA needs the catalog" and "Time bounds in requests" (the same data, the same rules).

#### Scenario: Bad requests
- **WHEN** a client requests `/api/value?signal=smart451/ICL_3A2h.SPEED_DISP&t=-29473328485867940608`, then the same with `t=2026-10-13T13:08:00Z&mode=markers`, then `signal=smart451/NOPE.X`
- **THEN** the answers are 400, 400 and 404
- **Evidence:** `apps/server/test/value.http.test.ts` › "answers errors like the series route"; `curl -s -o /dev/null -w '%{http_code}' 'localhost:7310/api/value?signal=smart451/ICL_3A2h.SPEED_DISP&t=-29473328485867940608'` prints `400`
