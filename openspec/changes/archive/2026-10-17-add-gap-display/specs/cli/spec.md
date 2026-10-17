## ADDED Requirements

### Requirement: Value in a gap
`value SIGNAL TIME` SHALL return the server's gap reason unchanged when the time lies in a gap: `data.value` `{"kind":"none","reason":"logger_gap"}` or `{"kind":"none","reason":"period_gap"}`, with exit code 0. Origin: D-062 (a cursor in a gap shows „no data"; concept §7: the CLI reads what the UI shows).

#### Scenario: Stub logger gap
- **WHEN** the stub source gives `testcar/Sna_800h.SPEED` the points 10 at 2026-10-01T02:00:01Z, 11 at 02:00:01.1Z and 12 at 02:00:05Z and the logger gap 02:00:02Z–02:00:04Z, and `value testcar/Sna_800h.SPEED 2026-10-01T02:00:03Z --mode step` runs
- **THEN** it exits 0 and `data.value` is `{"kind":"none","reason":"logger_gap"}`
- **Evidence:** `apps/cli/test/cli.test.ts` › "reads a value at a time and at a cursor" (gap case added)

#### Scenario: Real dropout
- **WHEN** `kipscope value smart451/STR_0D4h.STEER_ANGLE "2026-10-13 11:34:36.6" | jq -c .data.value` runs against the dev server
- **THEN** it prints `{"kind":"none","reason":"period_gap"}`
- **Evidence:** the command
