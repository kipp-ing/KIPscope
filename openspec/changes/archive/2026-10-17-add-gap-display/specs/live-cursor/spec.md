## MODIFIED Requirements

### Requirement: L without a value
At an SNA value the L cell SHALL read `SNA`; inside a gap of the drawn data (data-gaps: between split points beyond the hold end, between split buckets, or inside a logger gap) `no data` with the gap as tooltip; where the loaded data gives no other value (before the first or after the last point, next point SNA in line mode, an empty bucket, outside the window's range) `—` with the reason as tooltip. Such a signal SHALL NOT be near and gets no label. Origin: D-010 (SNA never a number); concept §5 („Ohne verfügbare Messgrundlage darf kein Wert erfunden werden"); gaps: D-062.

#### Scenario: Hover over an SNA run
- **WHEN** a window shows V_ANZ from 2026-10-13T09:56:59Z to 09:57:01Z and the pointer hovers 09:57:00Z at the height where a valid curve would be
- **THEN** the L cell reads `SNA`, nothing is highlighted and no label shows
- **Evidence:** UI check (screenshot); `apps/web/test/live.test.ts` › "reads SNA and gaps without a number and never highlights them"

#### Scenario: Hover over a logger gap band
- **WHEN** on smart451 a window shows `CPC_448h.PTC_HV_Volt` from 2026-10-13 11:27:45 to 11:28:05 local and the pointer hovers the grey band at 11:27:55 at the height of the curve
- **THEN** the L cell reads `no data`, nothing is highlighted and no label shows
- **Evidence:** UI check (screenshot); `apps/web/test/live.test.ts` › "reads SNA and gaps without a number and never highlights them"

#### Scenario: Drawn data in a gap
- **WHEN** the drawn value is read from a raw result with period 20 ms (points at 0, 20, 40, 500 ms) at 50 ms in step and at 30 ms and 100 ms in line mode; from a bucket result whose buckets around a logger gap are split, inside the logger gap and in an empty bucket beside it; and from a bucket result of a 20 ms signal in an empty stretch of 100 ms
- **THEN** step at 50 ms is held; line at 30 ms interpolated, at 100 ms none `period_gap`; inside the logger gap none `logger_gap`, beside it none `logger_gap`; in the stretch none `period_gap`
- **Evidence:** `apps/web/test/readout.test.ts` › "reads gaps from the drawn data"
