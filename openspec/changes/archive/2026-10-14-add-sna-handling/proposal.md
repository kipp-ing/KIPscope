# Proposal

## Why

Values the DBC marks as "signal not available" (SNA) are currently drawn, aggregated and returned like valid measurements. The user's fixed rule (D-010): SNA must never be shown as a valid value. Real data contains SNA: `ICL_3A2h.SPEED_DISP` jumps to 511 km/h (raw `1FFh`), `BRK_1A0h.WSPD_FL` reaches 8191.5 1/min (raw `3FFFh` × 0.5).

## What Changes

- Derive each signal's SNA values from the DBC (D-010, D-012):
  - union of `GenSigSNA` (raw hex, e.g. `"1FFh"`) and `VAL_` labels `SNA`/`SNV`; a `VAL_` label with a valid meaning beats `GenSigSNA`, and `GenSigSNA` does not apply to 1-bit and checksum/CRC signals (D-014);
  - `GenSigSNA "0h"` means "no SNA defined" unless a `VAL_` label marks 0 as SNA/SNV (260 h-can signals use `"0h"` on counters/states where 0 is valid);
  - raw → physical with factor/offset (two's complement for signed signals) because the DB stores physical values; match with a tolerance of half a raw step.
- Catalog reports the SNA values per signal.
- Series query marks SNA instead of returning it as a value: raw points and edge neighbors carry an SNA flag and no value; buckets aggregate only valid points and report the SNA count; an all-SNA bucket has no mean/min/max.
- Window never draws SNA as a value: the curve breaks at SNA (no line, step hold or interpolation through it), the envelope and y range exclude it, SNA periods are marked as a band, and the signal list shows the SNA share in view.

Out of scope: state/enum display of other value-table labels (later change).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `signal-catalog`: adds the SNA definition per signal.
- `series-query`: SNA points flagged without value; aggregates exclude SNA and report its count.
- `timeseries-window`: SNA never drawn as a value; SNA periods marked.

## Impact

- Server: DBC parser (`GenSigSNA`, factor/offset, signedness), catalog, ClickHouse queries (per-signal SNA ranges as query parameter), series DTOs (`v` becomes `number | null`, SNA counts).
- Web: chart model (null gaps instead of spanning, SNA band, legend share), y range.
- Test data: seed signals with SNA periods plus matching test DBC entries.
