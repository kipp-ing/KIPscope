# Spec Delta: signal-catalog

## ADDED Requirements

### Requirement: SNA values per signal
The catalog SHALL return for each signal the values its DBC marks as "signal not available" (SNA): each as raw code and as the physical value the source stores. A signal without SNA definition (no DBC entry, or none defined) SHALL report no SNA values, not an empty list. Origin: D-010, D-012.

#### Scenario: Speed with SNA code 1FFh
- **WHEN** the catalog lists `smart451/ICL_3A2h.SPEED_DISP` (9 bit, factor 1, offset 0, `GenSigSNA "1FFh"`, `VAL_ 511 "SNV"`)
- **THEN** its entry reports exactly one SNA value: raw 511, physical 511
- **Evidence:** `apps/server/test/dbc.test.ts` › "derives SNA values from the real h-can.dbc" (runs if the real DBC exists); command `curl -s 'localhost:7310/api/signals?q=ICL_3A2h.SPEED_DISP'` shows `"sna":[{"raw":511,"value":511,...}]`

#### Scenario: Signal without DBC entry
- **WHEN** a signal has data but no DBC entry (`testcar/Nodbc_500h.RAW`)
- **THEN** its catalog entry has no `sna` field
- **Evidence:** `apps/server/test/catalog.test.ts` › "lists a signal without DBC entry with its name only" (unchanged `toEqual`)

### Requirement: SNA sources are united
SNA values SHALL be the union of the `GenSigSNA` attribute (raw hex, e.g. `"1FFh"`) and the raw values whose `VAL_` label is `SNA` or `SNV`. When both name different codes, both codes SHALL count as SNA, unless a rule below drops the `GenSigSNA` code. Origin: D-010, D-014.

#### Scenario: Attribute and label disagree
- **WHEN** a signal has `GenSigSNA "1Fh"` and `VAL_ ... 30 "SNA"`, with no `VAL_` label on 31 (real: `BRK_33Ch.STAB_DISP`; test DBC: `Sna_800h.MODE` with `"7h"` and `6 "SNV" 1 "ON"`)
- **THEN** both codes are SNA values of the signal (STAB_DISP raws {30, 31}; MODE raws {6, 7})
- **Evidence:** `apps/server/test/dbc.test.ts` › "unites GenSigSNA and VAL_ SNA/SNV labels"; "derives SNA values from the real h-can.dbc"

#### Scenario: Attribute and label agree
- **WHEN** `GenSigSNA` and a `VAL_` `SNV` label name the same code (`BRK_1A0h.WSPD_FL`: `"3FFFh"` and `16383 "SNV"`)
- **THEN** the code is reported once
- **Evidence:** `apps/server/test/dbc.test.ts` › "derives SNA values from the real h-can.dbc"

### Requirement: A valid VAL_ label beats GenSigSNA
When the `VAL_` table labels the `GenSigSNA` code with anything other than `SNA` or `SNV`, that code SHALL NOT be an SNA value; the raw value is valid. `VAL_` codes labelled `SNA`/`SNV` stay SNA. Exception: the labels `--`, `NO_TEMP_SENSOR` and `RES` mean "no value" and do NOT beat `GenSigSNA`; the code stays SNA. The list is fixed and grows only by decision. Origin: D-014 (supersedes D-010's "on conflict both count as SNA"), D-015.

#### Scenario: State labelled OK
- **WHEN** a signal has `GenSigSNA "1h"` and `VAL_ ... 1 "OK"` (real: `BRK_21Ch.BRK_SW`, 100 % of its data is raw 1)
- **THEN** the signal has no SNA values
- **Evidence:** `apps/server/test/dbc.test.ts` › "derives SNA values from the real h-can.dbc"

#### Scenario: Valid label on the attribute code, SNV label on another code
- **WHEN** a signal has `GenSigSNA "1h"`, `VAL_ ... 1 "MM37"` and `15 "SNV"` (real: `IMU_15Ch.CLUSTER_TYPE`; test DBC: `Sna_800h.LEVEL` with `"1h"` and `1 "OK" 7 "SNV"`)
- **THEN** only the labelled code is SNA (CLUSTER_TYPE raws {15}; LEVEL raws {7})
- **Evidence:** `apps/server/test/dbc.test.ts` › "lets a valid VAL_ label beat GenSigSNA"; "derives SNA values from the real h-can.dbc"

#### Scenario: No-value label does not beat GenSigSNA
- **WHEN** a signal has `GenSigSNA "FFh"` and a `VAL_` label `--` or `NO_TEMP_SENSOR` on 255 (real: `TPS_A1.TirePress_*`, `ICL_3A0h.T_OUTSIDE`; `ENG_5E0h.FCODE_ENG` with `RES` on 63)
- **THEN** that code stays SNA (raw `FFh` / 63 is not shown as a measurement)
- **Evidence:** `apps/server/test/dbc.test.ts` › "keeps GenSigSNA when the VAL_ label means no value"; "derives SNA values from the real h-can.dbc"

### Requirement: GenSigSNA ignored on 1-bit and checksum signals
`GenSigSNA` SHALL NOT define an SNA value for a signal of bit length 1, nor for a checksum/CRC signal. A signal is a checksum/CRC signal exactly when its `SG_` name (without message name) matches `/^CRC_|(^|_)CHKSUM(_|$)/i`. `VAL_` labels `SNA`/`SNV` still apply to such signals. Origin: D-014.

#### Scenario: 1-bit brake switch
- **WHEN** a 1-bit signal has `GenSigSNA "1h"` (real: `BRK_33Ch.BRK_STATE` "Brake switch"; test DBC: `Sna_800h.FLAG` `40|1@1+`)
- **THEN** the signal has no SNA values
- **Evidence:** `apps/server/test/dbc.test.ts` › "ignores GenSigSNA on 1-bit and checksum signals"; "derives SNA values from the real h-can.dbc"

#### Scenario: Checksum and CRC signals
- **WHEN** a checksum/CRC signal has a `GenSigSNA` code (real: `STR_0D4h.STEER_CHKSUM` `"1h"`, `BRK_12Ah.CRC_0` `"FFh"`; test DBC: `Sna_800h.CRC_800h` `"FFh"`)
- **THEN** the signal has no SNA values
- **Evidence:** `apps/server/test/dbc.test.ts` › "ignores GenSigSNA on 1-bit and checksum signals"; "derives SNA values from the real h-can.dbc"

### Requirement: GenSigSNA "0h" defines no SNA
A `GenSigSNA` value of `"0h"` SHALL NOT define an SNA value. Raw 0 SHALL be SNA only if a `VAL_` label marks 0 as `SNA` or `SNV`. Origin: D-010 (260 h-can signals carry `"0h"` on counters and states where 0 is valid).

#### Scenario: Counter with "0h"
- **WHEN** a signal has `GenSigSNA "0h"` and no `VAL_` table (real: `IMU_15Ch.MSG_CNT_7`; test DBC and DB: `Sna_800h.COUNTER`, values 0…15)
- **THEN** the signal has no SNA values and its value 0 is returned as a valid value by series queries
- **Evidence:** `apps/server/test/dbc.test.ts` › "treats GenSigSNA 0h as no SNA"; `apps/server/test/series.test.ts` › "returns 0 of a 0h counter as a valid value"

#### Scenario: "0h" with an SNA label on 0
- **WHEN** a signal has `GenSigSNA "0h"` and `VAL_ ... 0 "SNA"` (test DBC: `Sna_800h.STATE`)
- **THEN** raw 0 is its SNA value
- **Evidence:** `apps/server/test/dbc.test.ts` › "treats GenSigSNA 0h as no SNA"

### Requirement: SNA compared as physical value
Each SNA code SHALL be converted to the physical value the source stores: raw (two's complement for signed signals) × factor + offset. Origin: D-012.

#### Scenario: Scaled SNA
- **WHEN** `BRK_1A0h.WSPD_FL` (14 bit, factor 0.5) has SNA code `3FFFh`
- **THEN** its SNA physical value is 8191.5
- **Evidence:** `apps/server/test/dbc.test.ts` › "derives SNA values from the real h-can.dbc"

#### Scenario: Offset SNA
- **WHEN** `ENG_2E8h.MOT_SPD_D` (8 bit, factor 1, offset −127) has SNA code `FFh`
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
- **WHEN** the user searches for `SPEED_DISP` on real data
- **THEN** the result `ICL_3A2h.SPEED_DISP` shows its SNA value as `SNA 511 km/h`, and a result without SNA values shows no SNA line
- **Evidence:** UI check (screenshot of the explorer result)
