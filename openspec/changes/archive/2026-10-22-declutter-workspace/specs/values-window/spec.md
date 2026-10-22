## ADDED Requirements

### Requirement: Missing signal in a values row
A values row whose value request answers 404 `unknown_signal` SHALL read `missing` in the muted style, tooltip `Missing: <dataRef> has no signal <shown name>`, its value cells `—` with that tooltip; the row stays. Other failures keep `failed: <message>`. Origin: necessary consequence of `timeseries-window` "Missing signals read calm" (same signal, same step); D-092.

#### Scenario: Missing row
- **WHEN** a values row's request fails with the API error built from a 404 answer `{error: {code: "unknown_signal", message: "unknown signal: othercar/X"}}`, and another with a 500 `source_error`
- **THEN** the first row's status reads `missing` with the tooltip `Missing: othercar has no signal X` and its cells `—`; the second keeps `failed: <message>`
- **Evidence:** `apps/web/test/values.test.ts` › "reads an unknown signal as missing"
