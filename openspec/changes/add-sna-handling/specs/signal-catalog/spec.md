# Spec Delta: signal-catalog

## ADDED Requirements

### Requirement: SNA values per signal
The catalog SHALL return for each signal the values its DBC marks as "signal not available" (SNA): each as raw code and as the physical value the source stores. A signal without SNA definition (no DBC entry, or none defined) SHALL report no SNA values, not an empty list. Origin: D-010, D-012.

#### Scenario: Speed with SNA code 1FFh
- **WHEN** the catalog lists `smart451/COMBI_412h.V_ANZ` (9 bit, factor 1, offset 0, `GenSigSNA "1FFh"`, `VAL_ 511 "SNV"`)
- **THEN** its entry reports exactly one SNA value: raw 511, physical 511
- **Evidence:** `apps/server/test/dbc.test.ts` › "derives SNA values from the real h-can.dbc" (runs if the real DBC exists); command `curl -s 'localhost:7310/api/signals?q=COMBI_412h.V_ANZ'` shows `"sna":[{"raw":511,"value":511,...}]`

#### Scenario: Signal without DBC entry
- **WHEN** a signal has data but no DBC entry (`testcar/Nodbc_500h.RAW`)
- **THEN** its catalog entry has no `sna` field
- **Evidence:** `apps/server/test/catalog.test.ts` › "lists a signal without DBC entry with its name only" (unchanged `toEqual`)

### Requirement: SNA sources are united
SNA values SHALL be the union of the `GenSigSNA` attribute (raw hex, e.g. `"1FFh"`) and the raw values whose `VAL_` label is `SNA` or `SNV`. When both name different codes, both codes SHALL count as SNA. Origin: D-010.

#### Scenario: Attribute and label disagree
- **WHEN** a signal has `GenSigSNA "3h"` and `VAL_ ... 0 "SNV"` (real: `SRS_1E1h.OC_P_Fast_SRS`; test DBC: `Sna_800h.MODE` with `"7h"` and `6 "SNV"`)
- **THEN** both codes are SNA values of the signal
- **Evidence:** `apps/server/test/dbc.test.ts` › "unites GenSigSNA and VAL_ SNA/SNV labels"

#### Scenario: Attribute and label agree
- **WHEN** `GenSigSNA` and a `VAL_` `SNV` label name the same code (`BS_200h.DVL`: `"3FFFh"` and `16383 "SNV"`)
- **THEN** the code is reported once
- **Evidence:** `apps/server/test/dbc.test.ts` › "derives SNA values from the real h-can.dbc"

### Requirement: GenSigSNA "0h" defines no SNA
A `GenSigSNA` value of `"0h"` SHALL NOT define an SNA value. Raw 0 SHALL be SNA only if a `VAL_` label marks 0 as `SNA` or `SNV`. Origin: D-010 (260 h-can signals carry `"0h"` on counters and states where 0 is valid).

#### Scenario: Counter with "0h"
- **WHEN** a signal has `GenSigSNA "0h"` and no `VAL_` table (real: `YRG_156h.MSG_CNT_7`; test DBC and DB: `Sna_800h.COUNTER`, values 0…15)
- **THEN** the signal has no SNA values and its value 0 is returned as a valid value by series queries
- **Evidence:** `apps/server/test/dbc.test.ts` › "treats GenSigSNA 0h as no SNA"; `apps/server/test/series.test.ts` › "returns 0 of a 0h counter as a valid value"

#### Scenario: "0h" with an SNA label on 0
- **WHEN** a signal has `GenSigSNA "0h"` and `VAL_ ... 0 "SNA"` (test DBC: `Sna_800h.STATE`)
- **THEN** raw 0 is its SNA value
- **Evidence:** `apps/server/test/dbc.test.ts` › "treats GenSigSNA 0h as no SNA"

### Requirement: SNA compared as physical value
Each SNA code SHALL be converted to the physical value the source stores: raw (two's complement for signed signals) × factor + offset. Origin: D-012.

#### Scenario: Scaled SNA
- **WHEN** `BS_200h.DVL` (14 bit, factor 0.5) has SNA code `3FFFh`
- **THEN** its SNA physical value is 8191.5
- **Evidence:** `apps/server/test/dbc.test.ts` › "derives SNA values from the real h-can.dbc"

#### Scenario: Offset SNA
- **WHEN** `MS_312h.DNMOT` (8 bit, factor 1, offset −127) has SNA code `FFh`
- **THEN** its SNA physical value is 128, and −127 (raw 0) is not SNA
- **Evidence:** `apps/server/test/dbc.test.ts` › "derives SNA values from the real h-can.dbc"

#### Scenario: Signed SNA
- **WHEN** a signed 8-bit signal with factor 1 and offset 0 has `GenSigSNA "80h"` (test DBC: `Sna_800h.TEMP`)
- **THEN** its SNA physical value is −128, not 128
- **Evidence:** `apps/server/test/dbc.test.ts` › "converts signed SNA codes with two's complement"

## MODIFIED Requirements

### Requirement: Signal explorer in the UI
The UI SHALL offer a signal explorer that searches the catalog, shows the metadata of each result, and lets the user add a signal to a window.

#### Scenario: Add signal from explorer
- **WHEN** the user searches, selects a result and adds it to a window
- **THEN** the signal appears in that window

#### Scenario: SNA values shown in explorer
- **WHEN** the user searches for `V_ANZ` on real data
- **THEN** the result `COMBI_412h.V_ANZ` shows its SNA value as `SNA 511 km/h`, and a result without SNA values shows no SNA line
- **Evidence:** UI check (screenshot of the explorer result)
