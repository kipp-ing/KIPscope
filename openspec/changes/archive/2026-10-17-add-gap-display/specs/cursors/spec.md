## MODIFIED Requirements

### Requirement: Readout without a value
A cursor at an SNA value SHALL read `SNA`, a cursor inside a gap (reason `logger_gap` or `period_gap`) `no data` with the gap as tooltip, a cursor without another value `—` with the values window's reason, a failed request `—` with the message. Δ SHALL be computed only from two numbers and marked `lin` if either value is interpolated, else `hold` if either is held (`avg` only during a drag in an aggregated view). Origin: D-010 (SNA never a number); concept §5 (no invented values) and §6 (value kinds stay recognisable); `no data`: D-062.

#### Scenario: SNA in and outside the range
- **WHEN** a window shows V_ANZ from 2026-10-13T09:56:59Z to 09:57:01Z and A is set to 09:57:00Z; then a second, unlinked window shows 13:09:00Z–13:09:10Z
- **THEN** both windows' V_ANZ cells read `SNA`, the server's value at 09:57:00Z
- **Evidence:** UI check (screenshots); `apps/web/test/readout.test.ts` › "reads SNA, empty buckets and cursors outside the range without a number", "shows a failed request as — with the message, and Δ as —"

#### Scenario: Cursors in a gap
- **WHEN** on smart451 a window shows `SAS_0C2h.LWS_ANGLE` and `COMBI_412h.V_ANZ` from 2026-10-13 11:34:34 to 11:34:39 local, diff mode on, A at 11:34:36.6 (inside their dropout) and B at 11:34:38
- **THEN** both A cells read `no data` with a tooltip naming more than 3 periods without a point, both B cells a number, both Δ cells `—`; with A moved to 11:27:55 in a window over 11:27:45–11:28:05 the A cells read `no data` with a tooltip naming the logger
- **Evidence:** UI check (screenshots with tooltip); `apps/web/test/readout.test.ts` › "reads gaps as no data, and Δ as —"
