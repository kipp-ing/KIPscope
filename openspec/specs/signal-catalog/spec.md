# signal-catalog Specification

## Purpose
Lets users and other callers discover which signals a data source offers and read their metadata, so they can find the signals relevant to an investigation.

## Requirements

### Requirement: Catalog contents
The catalog SHALL list exactly the signals that have data in the source, per data reference (for vehicle data: the vehicle). Signals that exist only in metadata files SHALL NOT be listed. While the workspace has a scope, the catalog in use SHALL be that scope's list: exactly the signals of the scope's data ref with at least one row in the scope (`listSignals(scope)`), with the same metadata, display names and groups as the full catalog. Origin: concept §4; scope: the ADX feedback item 2 („The list loads on demand for the active scope"), D-078 („the catalog cover[s] the scope only").

#### Scenario: Signal defined in DBC without data
- **WHEN** a DBC file defines a signal that never occurs in the database
- **THEN** the catalog does not list it

#### Scenario: Signals of a scope
- **WHEN** a stub source holds `testcar/A.X` with rows only before T1, `testcar/B.Y` with rows in [T1, T2), and `othercar/B.Y` with rows in [T1, T2), and a catalog is loaded for scope {testcar, T1, T2}
- **THEN** it lists exactly `testcar/B.Y`, with the DBC unit of `B.Y` when a test DBC defines one, and the stub's `listSignals` got that scope
- **Evidence:** `apps/server/test/catalog.test.ts` › "lists the signals of a scope"

### Requirement: Signal identity
Each signal SHALL have a stable ID built from its data reference and its name in the source, which does not change between server restarts.

#### Scenario: Same ID after restart
- **WHEN** the server restarts against the same data source
- **THEN** every signal keeps the ID it had before

### Requirement: Signal metadata
The catalog SHALL return for each signal its name and, where available, its description, alias and unit. Metadata the source lacks SHALL come from configured metadata files: DBC files and diagnostic catalogs (manifest plus names file, see "Diagnostic catalog names"). Where neither gives a unit and the source lists one for the signal's rows (ADX `KIPSCOPE_COLUMN_UNIT`), the catalog SHALL take that unit, per data reference. Missing fields SHALL be reported as absent, not as empty strings or invented values. Origin: concept §4 („Vorhandene Metadaten werden angezeigt"); diagnostic catalogs: D-061 („KIPscope reads the diagnostic catalog (manifest + names) like the DBC files"); table unit: D-100 („used when no DBC or diag unit exists, per data ref").

#### Scenario: Unit from DBC
- **WHEN** a signal `ENG_2E8h.MOT_SPD_D` has data and the DBC defines unit and comment for signal `MOT_SPD_D` in message `ENG_2E8h`
- **THEN** the catalog entry shows that unit and the comment as description

#### Scenario: Signal not in any DBC
- **WHEN** a signal has data but neither a DBC entry nor a diagnostic catalog field (`testcar/Nodbc_500h.RAW`)
- **THEN** the catalog lists it with its name only and no unit, description, alias, `dbc` or `diag`
- **Evidence:** `apps/server/test/catalog.test.ts` › "lists a signal without DBC entry with its name only" (unchanged `toEqual`, catalog built with the fixture diag catalog)

#### Scenario: Unit from the table
- **WHEN** a `Catalog` whose DBC loader defines `TBMS.current` (unit `mA`) and `Nounit_600h.P` (no unit), with the fixture diag catalog, is refreshed over a stub source listing `car/TBMS.current` (unit `A`), `car/Nounit_600h.P` (unit `bar`), `car/Nodbc_500h.RAW` (unit `V`), `a/X.Y` (unit `km/h`), `b/X.Y` (unit `mph`), a fixture diag signal that has a diag unit (listed unit `zz`), and `car/Plain.SIG` (no unit)
- **THEN** the entries have units `mA`, `bar` (with its `dbc`), `V` (no `dbc`, no `diag`), `km/h`, `mph`, the diag unit, and no `unit` key for `car/Plain.SIG`
- **Evidence:** `apps/server/test/catalog.test.ts` › "takes the table unit when no DBC or diag unit exists"

### Requirement: Signal search
The catalog SHALL support a case-insensitive text search that splits the query at whitespace into terms and matches a signal when every term occurs as a substring of its name, shown name (display-names), description, alias or unit. Results SHALL be ordered as in "Search ranking". The search API SHALL return results within a bounded page size. Origin: concept §4, D-017 („bei eingabe in suchliste filtern auch auf teile"); shown name: D-035 („search matches full name, short name and message alike").

#### Scenario: Match by description
- **WHEN** a user searches for a term that only occurs in a signal's description
- **THEN** that signal is in the results

#### Scenario: Large catalog
- **WHEN** the source has 10,000 signals and the query matches most of them
- **THEN** the result is limited to one page and indicates that more matches exist

#### Scenario: Match on a part of the name
- **WHEN** the query is `disp` and the catalog holds `ICL_3A2h.SPEED_DISP`
- **THEN** `ICL_3A2h.SPEED_DISP` is in the results, although `disp` is neither the whole name nor its start
- **Evidence:** `packages/shared/test/search.test.ts` › "matches parts of name, description and unit case-insensitively"

#### Scenario: All terms must match
- **WHEN** the query is `temp mot` and one signal has `temp` only in its description and `mot` only in its name, while another has only `temp`
- **THEN** the first signal is a result and the second is not
- **Evidence:** `packages/shared/test/search.test.ts` › "requires every term to match"

#### Scenario: Match by shown name only
- **WHEN** `ICL_3A2h.SPEED_DISP` has the shown name `Speed` (a rename) and the query is `spe`
- **THEN** `ICL_3A2h.SPEED_DISP` is in the results; the query `icl` still finds it through the full name
- **Evidence:** `packages/shared/test/search.test.ts` › "ranks the shown name like the name"

### Requirement: Signal explorer in the UI
The UI SHALL offer a signal explorer that searches the catalog and lists each result on one line with its shown name (display-names), unit and an SNA marker, and lets the user add a signal to a window. Further metadata, including the full source name, SHALL be shown in a hover card (see "Signal hover card"), not inline. Origin: concept §4, D-017 („signalexplorer als liste mit hover infos"); shown name: D-035.

#### Scenario: Add signal from explorer
- **WHEN** the user searches, selects a result and adds it to a window
- **THEN** the signal appears in that window

#### Scenario: SNA values shown in explorer
- **WHEN** the user searches for `SPEED_DISP` on real data with the local `kipscope.yaml`
- **THEN** the row `SPEED_DISP` (`ICL_3A2h.SPEED_DISP`) shows an SNA dot whose tooltip reads `SNA 511 km/h`, its hover card shows `511 km/h (raw 1FFh)` under SNA, and the row `BRK_SW` (`BRK_21Ch.BRK_SW`, no SNA codes, D-014) shows no dot
- **Evidence:** UI check (screenshot of the explorer with the SPEED_DISP card open)

#### Scenario: One line per signal
- **WHEN** the user searches for `temp` on real data
- **THEN** every result row is a single line and no description, SNA text or data reference appears in the list itself; goals, measured and reported but not pass/fail: row height ≤ 24 px (`getBoundingClientRect`) and at least 25 rows visible without scrolling at a 900 px tall browser window (today about 10)
- **Evidence:** UI check (screenshot plus the measured row height and visible row count)

### Requirement: SNA values per signal
The catalog SHALL return for each signal the values its DBC marks as "signal not available" (SNA): each as raw code and as the physical value the source stores. A signal without SNA definition (no DBC entry, or none defined) SHALL report no SNA values, not an empty list. Origin: D-010, D-012.

#### Scenario: Speed with SNA code 1FFh
- **WHEN** the catalog lists `smart451/ICL_3A2h.SPEED_DISP` (9 bit, factor 1, offset 0, `GenSigSNA "1FFh"`, `VAL_ 511 "SNV"`)
- **THEN** its entry reports exactly one SNA value: raw 511, physical 511
- **Evidence:** `apps/server/test/dbc.real.local.test.ts` (gitignored, D-077) › "derives SNA values from the real h-can.dbc" (runs if the real DBC exists); command `curl -s 'localhost:7310/api/signals?q=ICL_3A2h.SPEED_DISP'` shows `"sna":[{"raw":511,"value":511,...}]`

#### Scenario: Signal without DBC entry
- **WHEN** a signal has data but no DBC entry (`testcar/Nodbc_500h.RAW`)
- **THEN** its catalog entry has no `sna` field
- **Evidence:** `apps/server/test/catalog.test.ts` › "lists a signal without DBC entry with its name only" (unchanged `toEqual`)

### Requirement: SNA sources are united
SNA values SHALL be the union of the `GenSigSNA` attribute (raw hex, e.g. `"1FFh"`) and the raw values whose `VAL_` label is `SNA` or `SNV`. When both name different codes, both codes SHALL count as SNA, unless a rule below drops the `GenSigSNA` code. Origin: D-010, D-014.

#### Scenario: Attribute and label disagree
- **WHEN** a signal has `GenSigSNA "1Fh"` and `VAL_ ... 30 "SNA"`, with no `VAL_` label on 31 (real: `BRK_33Ch.STAB_DISP`; test DBC: `Sna_800h.MODE` with `"7h"` and `6 "SNV" 1 "ON"`)
- **THEN** both codes are SNA values of the signal (STAB_DISP raws {30, 31}; MODE raws {6, 7})
- **Evidence:** `apps/server/test/dbc.test.ts` › "unites GenSigSNA and VAL_ SNA/SNV labels"; `apps/server/test/dbc.real.local.test.ts` (gitignored, D-077) › "derives SNA values from the real h-can.dbc"

#### Scenario: Attribute and label agree
- **WHEN** `GenSigSNA` and a `VAL_` `SNV` label name the same code (`BRK_1A0h.WSPD_FL`: `"3FFFh"` and `16383 "SNV"`)
- **THEN** the code is reported once
- **Evidence:** `apps/server/test/dbc.real.local.test.ts` (gitignored, D-077) › "derives SNA values from the real h-can.dbc"

### Requirement: A valid VAL_ label beats GenSigSNA
When the `VAL_` table labels the `GenSigSNA` code with anything other than `SNA` or `SNV`, that code SHALL NOT be an SNA value; the raw value is valid. `VAL_` codes labelled `SNA`/`SNV` stay SNA. Exception: the labels `--`, `NO_TEMP_SENSOR` and `RES` mean "no value" and do NOT beat `GenSigSNA`; the code stays SNA. The list is fixed and grows only by decision. Origin: D-014 (supersedes D-010's "on conflict both count as SNA"), D-015.

#### Scenario: State labelled OK
- **WHEN** a signal has `GenSigSNA "1h"` and `VAL_ ... 1 "OK"` (real: `BRK_21Ch.BRK_SW`, 100 % of its data is raw 1)
- **THEN** the signal has no SNA values
- **Evidence:** `apps/server/test/dbc.real.local.test.ts` (gitignored, D-077) › "derives SNA values from the real h-can.dbc"

#### Scenario: Valid label on the attribute code, SNV label on another code
- **WHEN** a signal has `GenSigSNA "1h"`, `VAL_ ... 1 "MM37"` and `15 "SNV"` (real: `IMU_15Ch.CLUSTER_TYPE`; test DBC: `Sna_800h.LEVEL` with `"1h"` and `1 "OK" 7 "SNV"`)
- **THEN** only the labelled code is SNA (CLUSTER_TYPE raws {15}; LEVEL raws {7})
- **Evidence:** `apps/server/test/dbc.test.ts` › "lets a valid VAL_ label beat GenSigSNA"; `apps/server/test/dbc.real.local.test.ts` (gitignored, D-077) › "derives SNA values from the real h-can.dbc"

#### Scenario: No-value label does not beat GenSigSNA
- **WHEN** a signal has `GenSigSNA "FFh"` and a `VAL_` label `--` or `NO_TEMP_SENSOR` on 255 (real: `TPS_A1.TirePress_*`, `ICL_3A0h.T_OUTSIDE`; `ENG_5E0h.FCODE_ENG` with `RES` on 63)
- **THEN** that code stays SNA (raw `FFh` / 63 is not shown as a measurement)
- **Evidence:** `apps/server/test/dbc.test.ts` › "keeps GenSigSNA when the VAL_ label means no value"; `apps/server/test/dbc.real.local.test.ts` (gitignored, D-077) › "derives SNA values from the real h-can.dbc"

### Requirement: GenSigSNA ignored on 1-bit and checksum signals
`GenSigSNA` SHALL NOT define an SNA value for a signal of bit length 1, nor for a checksum/CRC signal. A signal is a checksum/CRC signal exactly when its `SG_` name (without message name) matches `/^CRC_|(^|_)CHKSUM(_|$)/i`. `VAL_` labels `SNA`/`SNV` still apply to such signals. Origin: D-014.

#### Scenario: 1-bit brake switch
- **WHEN** a 1-bit signal has `GenSigSNA "1h"` (real: `BRK_33Ch.BRK_STATE` "Brake switch"; test DBC: `Sna_800h.FLAG` `40|1@1+`)
- **THEN** the signal has no SNA values
- **Evidence:** `apps/server/test/dbc.test.ts` › "ignores GenSigSNA on 1-bit and checksum signals"; `apps/server/test/dbc.real.local.test.ts` (gitignored, D-077) › "derives SNA values from the real h-can.dbc"

#### Scenario: Checksum and CRC signals
- **WHEN** a checksum/CRC signal has a `GenSigSNA` code (real: `STR_0D4h.STEER_CHKSUM` `"1h"`, `BRK_12Ah.CRC_0` `"FFh"`; test DBC: `Sna_800h.CRC_800h` `"FFh"`)
- **THEN** the signal has no SNA values
- **Evidence:** `apps/server/test/dbc.test.ts` › "ignores GenSigSNA on 1-bit and checksum signals"; `apps/server/test/dbc.real.local.test.ts` (gitignored, D-077) › "derives SNA values from the real h-can.dbc"

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
- **Evidence:** `apps/server/test/dbc.real.local.test.ts` (gitignored, D-077) › "derives SNA values from the real h-can.dbc"

#### Scenario: Offset SNA
- **WHEN** `ENG_2E8h.MOT_SPD_D` (8 bit, factor 1, offset −127) has SNA code `FFh`
- **THEN** its SNA physical value is 128, and −127 (raw 0) is not SNA
- **Evidence:** `apps/server/test/dbc.real.local.test.ts` (gitignored, D-077) › "derives SNA values from the real h-can.dbc"

#### Scenario: Signed SNA
- **WHEN** a signed 8-bit signal with factor 1 and offset 0 has `GenSigSNA "80h"` (test DBC: `Sna_800h.TEMP`)
- **THEN** its SNA physical value is −128, not 128
- **Evidence:** `apps/server/test/dbc.test.ts` › "converts signed SNA codes with two's complement"

### Requirement: Search ranking
Results SHALL be ordered by tier, best first: (0) a term equals the name, its part after the first `.`, or the shown name; (1) one of them starts with the term; (2) the name or the shown name contains it; (3) only description, alias or unit do. A signal's tier is its worst term's tier; within a tier catalog order holds. API and explorer SHALL rank alike. Origin: D-018 ("explorer ranking"); tiers from the power-user report point 5; shown name like the name: D-035.

#### Scenario: Exact before prefix before substring before description
- **WHEN** the catalog holds `A_100h.DIFF_SPEED_DISP`, `B_200h.SPEED` (description `copy of SPEED_DISP`), `C_300h.SPEED_DISP_RAW` and `ICL_3A2h.SPEED_DISP`, and the query is `speed_disp`
- **THEN** the order is `ICL_3A2h.SPEED_DISP`, `C_300h.SPEED_DISP_RAW`, `A_100h.DIFF_SPEED_DISP`, `B_200h.SPEED`
- **Evidence:** `packages/shared/test/search.test.ts` › "ranks exact before prefix before name substring before other fields"

#### Scenario: Message prefix and full name
- **WHEN** the query is `icl_3a2h.speed_disp` or `icl`
- **THEN** `ICL_3A2h.SPEED_DISP` is tier 0 for the first and tier 1 for the second
- **Evidence:** `packages/shared/test/search.test.ts` › "treats the part after the first dot as the signal name"

#### Scenario: Shown name tiers
- **WHEN** `ICL_3A2h.SPEED_DISP` has shown name `Speed`, `B_200h.SPEED_RAW` has none, and `C_300h.X` has shown name `SPEED_DISP (C)`, and the queries are `speed`, `spe` and `(c)`
- **THEN** for `speed` `ICL_3A2h.SPEED_DISP` is tier 0 and `B_200h.SPEED_RAW` tier 1; for `spe` both are tier 1; for `(c)` `C_300h.X` is tier 2
- **Evidence:** `packages/shared/test/search.test.ts` › "ranks the shown name like the name"

#### Scenario: Ties keep catalog order
- **WHEN** two signals share a tier (e.g. `othercar/Fast_100h.SIG_A` and `testcar/Fast_100h.SIG_A` for `sig_a`), and the query is empty
- **THEN** ties are ordered by name, then data reference, and the empty query returns every signal in catalog order
- **Evidence:** `packages/shared/test/search.test.ts` › "keeps catalog order within a tier and for an empty query"

#### Scenario: API ranks like the explorer
- **WHEN** the test catalog is searched for `rpm`
- **THEN** `testcar/Sna_800h.RPM` (exact) comes before the `Fast_100h.SIG_A` entries (unit `rpm`); on real data `curl -s 'localhost:7310/api/signals?q=volt' | jq -r '.items[0].id'` prints `smart451/DCU_1F4h.COMP_HV_Volt` (first name match; before ranking it was the description match `smart451/CLIM_44Ch.HVM_Evap_Vlv_Rq`)
- **Evidence:** `apps/server/test/catalog.test.ts` › "ranks search results like the explorer"; the curl command

#### Scenario: API ranks shown names
- **WHEN** the test DB catalog is built with the test project file (display-names design N10) and searched for `spee` through `/api/signals`
- **THEN** the first two items are `testcar/Irr_200h.JITTER` (shown `SPEED`, a rename; tier 1 by its shown name) and `testcar/Sna_800h.SPEED` (shown `SPEED (Sna)`; tier 1), in this catalog order, before any description-only match
- **Evidence:** `apps/server/test/signals.http.test.ts` › "returns displayName in search and full catalog and keeps IDs"

### Requirement: Full catalog listing
The API SHALL return the whole catalog in one response, unpaged, with every field of each entry, for clients that search locally. Before the catalog has loaded once it SHALL answer 503 `catalog_unavailable`, like the search. Origin: necessary consequence of filtering in the browser without a hard cap (D-018) and without visible lag (power-user report point 5).

#### Scenario: All signals in one response
- **WHEN** a client requests the full catalog from the test DB catalog
- **THEN** it receives every signal (as many as `/api/signals` reports as `total` for an empty query, including `testcar/Many_700h.S0999`) and the load time
- **Evidence:** `apps/server/test/signals.http.test.ts` › "returns the full catalog without a page limit"; on real data `curl -s localhost:7310/api/catalog | jq '.items | length'` equals `curl -s 'localhost:7310/api/signals?q=' | jq .total`

#### Scenario: Catalog not loaded yet
- **WHEN** the full catalog is requested before the first successful load
- **THEN** the response is 503 with code `catalog_unavailable`
- **Evidence:** `apps/server/test/signals.http.test.ts` › "answers 503 before the catalog was ever loaded, and 502 on refresh" (extended to `/api/catalog`)

### Requirement: DBC details per signal
For a signal with a DBC entry the catalog SHALL return the DBC file it came from, the message name and CAN ID, the message's sender where the `BO_` line names one other than `Vector__XXX` (capability `signal-groups`), and where the `SG_` line parses: factor, offset, min and max as written; plus the `VAL_` table sorted by raw value. A signal without DBC entry SHALL have no DBC details; absent fields stay absent. Origin: concept §4 („Vorhandene Metadaten werden angezeigt"), D-017 (hover infos); sender: D-053.

#### Scenario: Speed signal from the real DBC
- **WHEN** the catalog lists `smart451/ICL_3A2h.SPEED_DISP` (`BO_ 930 ICL_3A2h: 8 CGW`, `SG_ SPEED_DISP : 8|9@1+ (1,0) [0|510] "km/h"`, `VAL_ 930 SPEED_DISP 511 "SNV"`)
- **THEN** its DBC details are file `h-can.dbc`, message `ICL_3A2h`, ID 930, sender `CGW`, factor 1, offset 0, min 0, max 510, values `[{raw 511, label SNV}]`
- **Evidence:** `apps/server/test/dbc.real.local.test.ts` (gitignored, D-077) › "derives DBC details from the real h-can.dbc" (runs if the file exists; also `ENG_5E0h.T_ENG` 1504, sender `Engine`, factor 1, offset −40, min −40, max 214; `BRK_1A0h.WSPD_FL` 416, sender `ESP`, factor 0.5, max 8191); `curl -s 'localhost:7310/api/signals?q=ICL_3A2h.SPEED_DISP' | jq -cS '.items[0].dbc'` prints `{"factor":1,"file":"h-can.dbc","max":510,"message":"ICL_3A2h","messageId":930,"min":0,"offset":0,"sender":"CGW","values":[{"label":"SNV","raw":511}]}`

#### Scenario: Details from the fixture DBCs
- **WHEN** the test DBCs are loaded (`test-a.dbc` before `test-b.dbc`)
- **THEN** `Fast_100h.SIG_C` has message `Fast_100h`, ID 256, sender `TEST`, factor 1, offset 0, min −100, max 100, file `test-a.dbc`; `Sparse_300h.MODE` has values `[{0, off}, {1, on}]`; `Irr_200h.JITTER` has min 0 and max 0 as written; `Many_700h.S0001` has file `test-b.dbc`
- **Evidence:** `apps/server/test/dbc.test.ts` › "reads message, scaling, range, value table and file"

#### Scenario: Signal without DBC entry
- **WHEN** a signal has data but no DBC entry (`testcar/Nodbc_500h.RAW`)
- **THEN** its catalog entry has no `dbc` field
- **Evidence:** `apps/server/test/catalog.test.ts` › "lists a signal without DBC entry with its name only" (unchanged `toEqual`)

### Requirement: Match highlighting
The explorer SHALL highlight every matched part of the query terms in the shown name and unit of each row, and in the full name and description inside the hover card. Overlapping matches SHALL be shown as one highlight. Origin: D-018 ("match highlighting"); shown name in the row, full name in the card: D-035.

#### Scenario: Highlight in the name
- **WHEN** the user searches for `volt` on real data with the local `kipscope.yaml`
- **THEN** the row `HTR_HV_Volt` (`DCU_2B8h.HTR_HV_Volt`) shows `Volt` highlighted (one `<mark>` element) and the rest of the name plain
- **Evidence:** UI check (screenshot; `document.querySelectorAll('.explorer mark')` text); `packages/shared/test/search.test.ts` › "returns merged highlight ranges for name, unit and description" (`volt` on `DCU_2B8h.HTR_HV_Volt` → name `[[16, 20]]`; `v_a disp` on `ICL_3A2h.SPEED_DISP` → `[[11, 16]]`) and › "returns highlight ranges in the shown name" (`volt` on `DCU_2B8h.HTR_HV_Volt` shown `HTR_HV_Volt` → shown `[[7, 11]]`; without `displayName` shown ranges equal name ranges; empty query → `[]`)

#### Scenario: Description match shown in the card
- **WHEN** the user searches for `temp` on real data and hovers `T_ENG` (`ENG_5E0h.T_ENG`, description `Motortemperatur`)
- **THEN** the row has no highlight in the name, rows whose name contains `TEMP` are listed above it, and the card shows `temp` highlighted in `Motortemperatur`
- **Evidence:** UI check (screenshot of the card)

### Requirement: No hard cap on results
The explorer SHALL make every match reachable: it shows the total match count (on the Signals tab, guidance "Explorer names the drag") and, when not all list items (rows and, with groups, group headers) are rendered, a control that renders more. No fixed limit SHALL hide matches; with groups, every match SHALL be reachable by opening its group. Origin: D-018 ("without a hard cap"); headers as items: design G6.

#### Scenario: Whole catalog reachable
- **WHEN** the search field is empty on real data
- **THEN** the Signals tab count reads the catalog size (e.g. `428`), there is no `showing 100`; without groups, scrolling to the end of the list reaches the alphabetically last signal; with the local `kipscope.yaml`, the header counts add up to 428 (the `ƒ Computed` section and a Favourites group aside) and opening the last header `Other` and scrolling to the end reaches its alphabetically last signal
- **Evidence:** UI check (screenshot of the list end and the count)

#### Scenario: Show more beyond one chunk
- **WHEN** a search matches more signals than one render chunk (test catalog, empty query, 1,013 signals)
- **THEN** a "Show N more" control appears, and using it until it disappears renders all items
- **Evidence:** `apps/web/test/explorer.test.ts` › "renders matches in chunks until all are visible" (pure chunking helper, applied to the item count). On real data (at most 442 items < 500) the control never appears, so the helper test is the only evidence; the UI user does not check it.

### Requirement: Filtering without visible lag
The explorer SHALL update its list on every keystroke without a request to the server. Goal: ranking 10,000 signals takes under 50 ms. Origin: power-user report point 5 ("results lag typing", expectation "no visible lag"); the number is a goal.

#### Scenario: No request while typing
- **WHEN** the user types `temperatur` quickly into the search on real data
- **THEN** the list narrows after each character and the network log shows no `/api/signals` or `/api/catalog` request during typing
- **Evidence:** UI check (network log excerpt, screenshot)

#### Scenario: Ranking speed
- **WHEN** 10,000 synthetic signals with descriptions are ranked for `temp`
- **THEN** the median of 5 runs is under 50 ms
- **Evidence:** `packages/shared/test/search.test.ts` › "ranks 10,000 signals in under 50 ms"

### Requirement: Signal hover card
Resting the pointer on a row, or making it active by keyboard, for 350 ms SHALL open a card with name, description, message and CAN ID, unit, scaling, raw step, DBC range, SNA codes, value table, source (data reference, DBC file) and the windows showing the signal. Absent fields SHALL be omitted, never shown empty or invented. A signal without DBC entry and diagnostic catalog field whose unit came from the source's table SHALL show its source as `<dataRef> · unit from the table`, not as `<dataRef> · no DBC entry`. Origin: D-017 („mit hover infos"); fields: power-user report point 4; keyboard: D-020; 350 ms is a goal; table unit: necessary consequence of D-100 (a unit next to "no DBC entry" reads as if the unit were invented), wording is open question Q-3.

#### Scenario: Card for SPEED_DISP
- **WHEN** the user hovers `ICL_3A2h.SPEED_DISP` on real data and the signal is shown in one window
- **THEN** after about a third of a second a card shows `ICL_3A2h.SPEED_DISP`, `Indicated speed`, `ICL_3A2h · 0x3A2`, unit `km/h`, scaling `× 1 + 0`, raw step `1 km/h`, range `0 … 510 km/h`, SNA `511 km/h (raw 1FFh)`, values `511 SNV`, source `smart451 · h-can.dbc`, and under "Shown in" that window's name as its header shows it (its title, or `Window <n>` when untitled)
- **Evidence:** UI check (screenshot of the card)

#### Scenario: Card with offset
- **WHEN** the user hovers `ENG_5E0h.T_ENG` on real data
- **THEN** the card shows scaling `× 1 - 40`, raw step `1 °C`, range `-40.0 … 214 °C`, and "Shown in" reads `no window` when no window shows it
- **Evidence:** UI check (screenshot of the card); `apps/web/test/explorer.test.ts` › "formats scaling, raw step and DBC range"

#### Scenario: Card formatting rules
- **WHEN** a signal has DBC range `[0|0]`, an extended CAN ID, no DBC entry, or no DBC entry and no diag field but a unit
- **THEN** the range reads `not set`, the ID reads in hex with bit 31 cleared and `(ext)`, a signal without DBC entry shows its source as `<dataRef> · no DBC entry` with no message, scaling, range, SNA or value lines, and one with only a unit shows `<dataRef> · unit from the table`; a unit next to a DBC entry or a diag field leaves those lines as they are (`<dataRef> · <file>`, `<dataRef> · DBC`, the diag line)
- **Evidence:** `apps/web/test/explorer.test.ts` › "formats scaling, raw step and DBC range", "formats message IDs as hex", "formats the source line" (extended), "lists the windows showing a signal"

#### Scenario: Card for a table unit
- **WHEN** the UI user opens the server of adx-source "Server on the emulator" (the lead's second server on port 7311, started after `pnpm build` with `KIPSCOPE_WEB_DIR=apps/web/dist` so it serves the UI) and hovers `Spd.V` of `meta-a` in the explorer
- **THEN** the card shows unit `km/h`, source `meta-a · unit from the table`, and no message, scaling, range, SNA or value lines
- **Evidence:** UI check (screenshot of the card)

#### Scenario: Card on keyboard focus
- **WHEN** the user types `WSPD_FL`, presses ArrowDown once and waits
- **THEN** the card for the second row opens without any pointer movement, and moving the active row moves the card
- **Evidence:** UI check (screenshot)

#### Scenario: No flicker while sweeping
- **WHEN** the user moves the pointer quickly down across ten rows without resting
- **THEN** no card opens; once a card is open, moving to a neighbouring row switches the card at once
- **Evidence:** UI check (description of the observed behaviour)

### Requirement: Hover card number formats
The hover card's DBC range and SNA physical values SHALL be printed by number-format with the workspace's digits option; scaling and raw step SHALL stay exact. Origin: D-026 („everywhere (… hover card …)"); exact scaling: design N9 (Jan's call Q7).

#### Scenario: Prefixed SNA value
- **WHEN** the user hovers `BRK_1A0h.WSPD_FL` on real data with the digits option at 3, then at 4
- **THEN** the SNA line reads `8.19 k1/min (raw 3FFFh)`, then `8.192 k1/min (raw 3FFFh)`, and the raw step reads `0.5 1/min` both times
- **Evidence:** UI check (two screenshots of the card); `apps/web/test/explorer.test.ts` › "formats scaling, raw step and DBC range"

### Requirement: Explorer keys
The explorer SHALL support: `/` focuses the search field when focus is not in a text field (the `/` is not typed); Esc in the search field clears the query and closes the card; ArrowDown/ArrowUp move the active item (clamped at the ends) and keep it in view; Enter adds the active row exactly as its add button does; `Ctrl+D` (`Cmd+D` on macOS) stars or unstars the active row or the selection (capability `favourites`, "Star a selection or by key"). With groups (capability `signal-groups`) the items include the group headers: Enter on a header opens or closes its group and keeps it active. After each query change the active item SHALL be, while searching, the first row of the best-ranked match (its copy in the Favourites group when it is a favourite); with an empty query the first signal row shown; the first item when no row is shown. Origin: D-020 ("The explorer list is keyboard-driven: `/` focuses the search, arrow keys move, Enter adds, Esc clears."); headers: D-053 with design G6; best hit with favourites first: necessary consequence (Enter keeps adding the top hit, D-020) of D-102's Favourites group; star key: favourites design Q-4.

#### Scenario: Search, Enter adds the top hit
- **WHEN** focus is on the page body, the user presses `/`, types `SPEED_DISP` and presses Enter
- **THEN** the search field contains exactly `SPEED_DISP` and `ICL_3A2h.SPEED_DISP` is added to the selected "Add to" target (also with the header `CGW 1` above the row)
- **Evidence:** UI check (screenshot of the new window)

#### Scenario: Arrows choose another hit
- **WHEN** with the local `kipscope.yaml` and no favourites the user types `temp`, presses ArrowDown twice and Enter; then ArrowDown twice more, Enter, ArrowDown once
- **THEN** `ENG_5E0h.T_AIR` (third row under `Engine 4`) is added, the active item was visibly marked while moving; then the header `DCU 5` is active and Enter hides its five rows, and the next ArrowDown makes the header `HVM 1` active
- **Evidence:** UI check (screenshot); `apps/web/test/explorer.test.ts` › "groups matches by best hit, Other last, collapsed on an empty query" (item order)

#### Scenario: Esc clears
- **WHEN** the search field holds `temp` and the user presses Esc
- **THEN** the field is empty, the full list is shown (with the local `kipscope.yaml`: every group header, all collapsed, and the Favourites group open above them when the user has favourites in the list) and the active item is the first signal row shown, else the first item
- **Evidence:** UI check (screenshot)

#### Scenario: Best hit stays active with favourites
- **WHEN** `firstSignal` gets the searching items of favourites "Group order and copies" (the Favourites header, then the copies of ranks 2 and 5) with `best` the signal ID of rank 1, then with `best` the ID of rank 2, then the empty-query items without `best`
- **THEN** it returns 11 (rank 1's row under `Other`), 1 (rank 2's copy in the Favourites group), and 1 (the first copy, rank 5)
- **Evidence:** `apps/web/test/explorer.test.ts` › "keeps the best hit active when favourites come first"

#### Scenario: Enter adds the top hit with a favourite above it
- **WHEN** on smart451 with `WSPD_FL` starred, the user types `speed` and presses Enter
- **THEN** the signal added is the one that is added for `speed` without favourites (the row of the best hit), not `WSPD_FL`
- **Evidence:** UI check on smart451 at 1440×900 (the added signal with and without the favourite)

### Requirement: Explorer rows are a drag source
Pressing on an explorer row's name and moving the pointer SHALL start the app's pointer drag (design S3). When the row is selected and the selection holds two or more rows, the drag SHALL carry the whole selection in list order and follow timeseries-window "Selection overflows into new windows"; otherwise it SHALL carry that one signal, the selection unchanged, as follows. The ghost SHALL show the signal's shown name. Windows that do not show it and stay within four units SHALL be highlighted with "Drop to add"; one that would reach a fifth unit SHALL be marked not droppable ("At most 4 units per window") and ignore a drop. A drop adds, never moves; Alt/Ctrl change nothing. The add button SHALL NOT start a drag. Origin: D-020 (explorer drag; fifth unit refused as for legend drags); shown name in the ghost: D-035; selection drag: D-066 with lead default L2.

#### Scenario: Drag a row onto a window
- **WHEN** a window exists that does not show `ICL_3A2h.SPEED_DISP`, and the user drags the `SPEED_DISP` row onto it with the mouse (local `kipscope.yaml`)
- **THEN** windows not showing SPEED_DISP are highlighted with "Drop to add" while dragging, a window showing it is not highlighted, the ghost reads `SPEED_DISP · add` over a valid target, the hover card is closed, and after the drop the signal appears in that window while the explorer row stays
- **Evidence:** UI check (screenshot during the drag and after the drop); `apps/web/test/drag.test.ts` › "adds an explorer signal to windows not showing it and to a new window"

#### Scenario: Fifth unit refused for an explorer drag
- **WHEN** window A shows `DCU_1F4h.COMP_HV_Volt` (V), `ICL_3A2h.SPEED_DISP` (km/h), `ENG_5E0h.T_ENG` (°C) and `BRK_1A0h.WSPD_FL` (1/min), and the user drags the `ENG_2E8h.MOT_SPD_D` (`rpm/10ms`) row over A and releases
- **THEN** A is marked not droppable with the hint "At most 4 units per window" while dragging, and the release changes nothing (revision unchanged); dragging `DCU_2B8h.HTR_HV_Volt` (V) over A highlights it with "Drop to add"
- **Evidence:** `apps/web/test/drag.test.ts` › "refuses an explorer drop that would make a fifth unit"; UI check (screenshot while dragging, revision before and after)

#### Scenario: Legend drags unchanged
- **WHEN** a legend row is dragged after this change
- **THEN** source, target and refused states, the hint "Drop to move · Alt/Ctrl+drop to copy" and move/copy behave as before
- **Evidence:** `apps/web/test/drag.test.ts` › "keeps the legend-drag states" and the existing drag tests

#### Scenario: Drag a row onto "+ New window"
- **WHEN** the user drags the `WSPD_FL` row (`BRK_1A0h.WSPD_FL`) onto the "+ New window" zone
- **THEN** a new window `Window <n>` with WSPD_FL is created, exactly as with the add button and "New window" selected
- **Evidence:** UI check (screenshot); `apps/web/test/drag.test.ts` › "adds an explorer signal to windows not showing it and to a new window"

#### Scenario: Click is not a drag
- **WHEN** the user clicks a row's name or its add button without moving the pointer
- **THEN** no drag starts (no ghost, no highlighted targets)
- **Evidence:** UI check

#### Scenario: Unselected row drags alone
- **WHEN** under the query `speed` the rows `WSPD_FL` and `WSPD_FR` are selected and the user drags the unselected `SPEED_DISP` row onto "+ New window"
- **THEN** the ghost reads `SPEED_DISP`, the new window shows only SPEED_DISP, and `WSPD_FL` and `WSPD_FR` stay selected
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after the drop)

#### Scenario: Selected row drags the selection
- **WHEN** under the query `speed` the rows `WSPD_FL`, `WSPD_FR` and `WSPD_RL` are selected and the user presses the name `WSPD_FR` and moves the pointer over a window
- **THEN** the ghost reads `3 signals`, with ` · add` over a valid target
- **Evidence:** UI check on smart451 at 1440×900 (screenshot while dragging)

### Requirement: Stable "Add to" target
The explorer's "Add to" target SHALL be the marked window (workspace-layout "Marked window"), held by window ID, or "New window" while none is marked. It SHALL change only by the user's own act: a click that ends inside a window, or a choice in the "Add to" select, which shows and sets the same mark. It SHALL fall back to "New window" when its window is removed. The select's tooltip SHALL say that a click on a window chooses it. Origin: D-020 (target stays); D-022 (fallback); D-027 (marking sets the target); Jan 2026-10-17 („the window clicked last"), D-072 (G-1).

#### Scenario: Removed target falls back
- **WHEN** the marked window is removed, by its menu or because a move emptied it
- **THEN** the target becomes "New window", the select shows it and no window is marked
- **Evidence:** `apps/web/test/explorer.test.ts` › "keeps the Add to target by window ID while windows change"; UI check (screenshot after dragging the marked window's only signal into another window)

#### Scenario: Select and header mark the same window
- **WHEN** the user marks `Window 1` by a click into its plot (or its header), then chooses `Window 2` in the "Add to" select, then chooses "New window"
- **THEN** after the click the select shows `Window 1` and Window 1 shows the mark; after the choice the mark is on Window 2 only; after "New window" no window shows the mark
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each step)

### Requirement: "Add to" target ignores other changes
Creating, renaming or reordering windows, drops, drags, new revisions and query changes SHALL NOT change the "Add to" target. A window created by an explorer add or a drop SHALL NOT become the target. Origin: D-020 („The "Add to" target stays where the user put it; creating, renaming or reordering windows does not move it"); D-027 (marking, not „follow the new window"); D-072 (G-2) (design.md). Cursor clicks inside a window now mark it (workspace-layout "Marked window", D-072 (G-1)).

#### Scenario: Target survives window changes
- **WHEN** windows `w1` and `w2` exist, the user marks `w2`, then a third window is created (via "New window" add or the CLI) and `w1` is renamed
- **THEN** the target is still `w2`, and the next add (button or Enter) lands in `w2`
- **Evidence:** `apps/web/test/explorer.test.ts` › "keeps the Add to target by window ID while windows change"; UI check (add T_SET after creating another window; screenshot shows it in the marked window)

#### Scenario: New window is not the target
- **WHEN** no window is marked and the user adds `BRK_1A0h.WSPD_FL` with Enter
- **THEN** a new window shows WSPD_FL, is scrolled into view and flashes, the "Add to" select still shows "New window" and no window is marked
- **Evidence:** UI check on smart451 (screenshot within 1 s of Enter, the select's value)

### Requirement: Add button names its target
The add button SHALL name its "Add to" target; Enter adds to the same target. Origin: D-020; D-027.

#### Scenario: Add button names its target
- **WHEN** the user points at a row's add button with target `w2` titled `Speeds`
- **THEN** its tooltip and accessible name read `Add to Speeds` (`Add to new window` for "New window")
- **Evidence:** UI check (screenshot of the tooltip)

### Requirement: Catalog loads until it succeeds
While a catalog in use has never loaded, the server SHALL load it again by itself 1, 2, 4, 8 and 16 s after the first five failures in a row and 30 s after each later one, and SHALL stop once a load succeeds. A later failed refresh SHALL keep the loaded catalog and start no background retry. In full mode this holds for the full catalog from the start. In both modes it holds for the signal list of the scope of every workspace with a live client, from the moment the first client connects or the scope changes; no scope list SHALL load at start. Origin: D-042 (carserver's 23:00 reboot) and necessary consequence: without it, a start while the tunnel is down answers 503 to every series request until someone posts a refresh. Numbers: design H5. Scoped mode: the ADX feedback item 2 (no list at start). Open workspaces instead of one restored scope: necessary consequence of many workspaces (thousands of stored workspaces must not load their lists at start).

#### Scenario: Source down at start
- **WHEN** the catalog's source fails its first four loads at once and answers the fifth (fake timers)
- **THEN** the loads start at 0, 1, 3, 7 and 15 s, the catalog has loaded after the fifth, and no further load starts within the next 120 s
- **Evidence:** `apps/server/test/catalog.test.ts` › "keeps loading the catalog with backoff until it succeeds"

#### Scenario: Restart with the tunnel down
- **WHEN** the lead stops the carserver tunnel, restarts the KIPscope server, and starts the tunnel again 20 s later
- **THEN** within 35 s of the tunnel coming back, `curl -s localhost:7310/api/catalog | jq '.items | length'` prints the signal count, without a manual refresh
- **Evidence:** lead's manual check (command output)

#### Scenario: Restored scope in scoped mode
- **WHEN** a test server in scoped mode starts from two workspace files with scopes {testcar, T1, T2} and {othercar, T1, T2}, waits 5 s, then a live client connects to the first workspace while its recording source fails `listSignals` twice and then answers (fake timers)
- **THEN** no `listSignals` runs during the first 5 s; after the connect the source gets `listSignals` with {testcar, T1, T2} at 0, 1 and 3 s and never without a scope or with othercar's scope, and `GET /api/w/<first>/catalog` then answers 200 with `scope` {testcar, T1, T2}
- **Evidence:** `apps/server/test/scope.http.test.ts` › "keeps an open workspace's scope list loaded"

### Requirement: One catalog load at a time
A refresh that starts while a catalog load runs SHALL wait for that load and report its outcome instead of starting a second one. Origin: necessary consequence of the background load (two parallel loads would race to replace the catalog). Design H5.

#### Scenario: Refresh during a load
- **WHEN** a catalog refresh is called twice before the first finishes
- **THEN** the source's signal list is queried once and both calls resolve after it
- **Evidence:** `apps/server/test/catalog.test.ts` › "shares one load between concurrent refreshes"

### Requirement: DBC warnings per load
Each catalog load SHALL log every DBC file it skipped, once per load, for start-up, background and manual (`POST /api/catalog/refresh`) loads alike; warnings of earlier loads SHALL NOT repeat or accumulate. Origin: necessary consequence: today refresh warnings are never logged and the list only grows. Design H5.

#### Scenario: Two loads with one bad file
- **WHEN** a catalog whose metadata loader reports one skipped file per load is refreshed twice
- **THEN** the warning is logged exactly twice, once per load
- **Evidence:** `apps/server/test/catalog.test.ts` › "logs DBC warnings once per load"

### Requirement: Diagnostic catalog names
The server SHALL read the diagnostic catalogs of `KIPSCOPE_DIAG_CATALOGS` (default smart451's `bms-live.manifest.json`), each with the names file next to it, on every catalog load, and SHALL name each field's signals as the decoder does: `<ECU>.<name>` if named, else `<ECU>.<group>.<field>`; arrays `.<n>`, 1-based, zero-padded (design M3). Origin: D-061; ESPCars `docs/sdlog-decode-spec.md` §7.2; data fact: all 125 `BMS.*` signals match a field.

#### Scenario: Fixture names
- **WHEN** `parseDiagCatalog` reads `test-diag.manifest.json` with `test-diag.names.toml` (design M6)
- **THEN** it yields exactly 18 names: `TBMS.cell_voltage.01` … `TBMS.cell_voltage.12`, `TBMS.current`, `TBMS.contactor`, `TBMS.vin`, `TBMS.DT_Pack.PRES_Temp_2Byte`, `TBMS.DT_Pack.PRES_Flag` and `TBMS.DT_Ident_B.PRES_VIN_17Byte`; the inline names `"DT_Pack/PRES_Temp_2Byte" = "temp"` and `"DT_Cell_Voltage_Cell/PRES_Cell_2Byte" = "cell"` give `TBMS.temp` and `TBMS.cell.01` … `.12`
- **Evidence:** `apps/server/test/diag.test.ts` › "names fields like the decoder"

#### Scenario: Real catalog names
- **WHEN** the real `bms-live.manifest.json` and `bms-live.names.toml` are read (test runs if the files exist)
- **THEN** there are 498 names, among them `BMS.cell_voltage.001` and `BMS.cell_voltage.200`, `BMS.contactor`, `BMS.soc` and `BMS.vin`, and no warning
- **Evidence:** `apps/server/test/diag.test.ts` › "reads the real bms-live catalog"

#### Scenario: Config
- **WHEN** `loadConfig` runs without `KIPSCOPE_DIAG_CATALOGS`, and with `KIPSCOPE_DIAG_CATALOGS=a.manifest.json, /abs/b.manifest.json`
- **THEN** `diagCatalogs` is `[<root>/../CarController/vehicles/smart451/uds/bms-live.manifest.json]`, then `[<root>/a.manifest.json, /abs/b.manifest.json]`
- **Evidence:** `apps/server/test/config.test.ts` › "defaults to the carserver sdlog mapping", "applies overrides" (both extended)

### Requirement: Diagnostic catalog details per signal
For a signal with a diagnostic catalog field the catalog SHALL return the field's unit when not blank, and `diag` (design M1) with the enum's state rows and the invalid rows. Invalid rows SHALL NOT become SNA codes. Origin: D-061 („unit, enum state names and invalid sentinels per `BMS.*` signal"); no SNA: data fact (the decoder stores no invalid value, 0 of 494,084 `BMS.*` rows; as SNA, a sentinel's physical 0 would hide 48 valid 0 A rows of `BMS.current`).

#### Scenario: Fixture details
- **WHEN** `parseDiagCatalog` reads the fixture pair
- **THEN** `TBMS.cell_voltage.03` has unit `V` and `diag` `{file: "test-diag.manifest.json", ecu: "TBMS", group: "DT_Cell", did: 520, field: "PRES_Cell_2Byte", element: 3, kind: "number", invalid: [{low: 65535, high: 65535, text: "Signal not available"}]}`; `TBMS.contactor` has no unit, kind `enum`, states `open` 0, `precharge` 1, `closed` 2 and invalid 3 and 255; `TBMS.vin` kind `text`, no unit, no states, no invalid; `TBMS.DT_Pack.PRES_Temp_2Byte` unit `°C` (manifest `" °C "`), no invalid; `TBMS.DT_Pack.PRES_Flag` no unit
- **Evidence:** `apps/server/test/diag.test.ts` › "carries unit, kind, states and invalid rows"

#### Scenario: Diag metadata over HTTP
- **WHEN** a catalog over a stub source listing `testcar/TBMS.cell_voltage.01`, `testcar/TBMS.contactor`, `testcar/TBMS.unknown` and `testcar/Nodbc_500h.RAW` loads the test DBCs and the fixture diag catalog, and `GET /api/signals?q=TBMS` is read
- **THEN** `TBMS.cell_voltage.01` has `unit` `V` and `diag.element` 1, `TBMS.contactor` has `diag.kind` `enum` and three states, neither has `sna` or `dbc`; `TBMS.unknown` has name only
- **Evidence:** `apps/server/test/signals.http.test.ts` › "diag catalog over HTTP" › "returns diag metadata"

#### Scenario: Merged into the catalog
- **WHEN** a `Catalog` is built with the fixture diag loader over a stub source listing `car/TBMS.current` and `car/TBMS.contactor`
- **THEN** `get("car/TBMS.current")` equals `{id, dataRef: "car", name: "TBMS.current", unit: "A", diag: {…, kind: "number", invalid: [{low: -32768, high: -32768, text: "SNA"}]}}` and `snaRanges("car/TBMS.current")` is `[]`
- **Evidence:** `apps/server/test/catalog.test.ts` › "merges diag catalog metadata"

### Requirement: Units from the diagnostic catalog on real data
On smart451 every `BMS.*` signal with a unit in the manifest SHALL carry it, so that cell voltages share one `V` axis and count as one unit in a window. Origin: D-061 („Cell voltages then share one `V` axis"); Jan: „each cell voltage has its axle"; axes and unit limit: existing "One y-axis per unit" (timeseries-window, D-018) and MAX_UNITS, unchanged.

#### Scenario: Unit counts on carserver
- **WHEN** after a server restart `curl -s 'localhost:7310/api/signals?q=BMS.&limit=200' | jq -c '[.items[] | select(.name|startswith("BMS.")) | .unit // "none"] | group_by(.) | map({(.[0]): length}) | add'` runs
- **THEN** it prints `{"%":4,"A":1,"V":103,"kOhm":1,"none":9,"°C":7}`; `curl -s 'localhost:7310/api/signals?q=BMS.contactor' | jq -cS '.items[0].diag'` prints `{"did":53248,"ecu":"BMS","field":"PRES_Contactor_State","file":"bms-live.manifest.json","group":"DT_Contactor_Contactor_State","invalid":[{"high":3,"low":3,"text":"signal not available"},{"high":255,"low":255,"text":"Signal not available"}],"kind":"enum","states":[{"high":0,"low":0,"text":"open"},{"high":1,"low":1,"text":"precharge"},{"high":2,"low":2,"text":"closed"}]}`
- **Evidence:** the two commands

#### Scenario: Cell voltages share one axis
- **WHEN** on smart451 the user adds `BMS.cell_voltage.001` … `BMS.cell_voltage.005` to one empty timeseries window over a range with diag data (e.g. 2026-10-13 11:00–11:20 local) and searches the explorer for `cell_voltage.00`
- **THEN** all five are accepted (today the fifth is refused with "a window shows at most 4 units"), the window draws one y axis titled `V` and the five curves lie on it; the explorer rows show unit `V`
- **Evidence:** UI check on smart451 at 1440×900 (one screenshot of the window and the explorer)

### Requirement: Metadata source precedence
DBC files SHALL be read first, then the diagnostic catalogs in list order; for a signal name defined by more than one source the first one SHALL win whole (no merging of fields), and each catalog load SHALL warn once, naming at most 10 such signals with data. The unit listed by the source for a data reference's rows SHALL come last: it fills only the unit, only of an entry whose winning metadata has none, and never produces a warning. Origin: necessary consequence (two sources can name one signal; D-011 D6 "first file wins" for DBC); DBC first because SNA rules (D-010, D-014, D-015) exist only for DBC entries; table unit last: D-100 („used when no DBC or diag unit exists").

#### Scenario: DBC wins
- **WHEN** a `Catalog` whose DBC loader defines `TBMS.current` (unit `mA`) and whose diag loader is the fixture is refreshed twice over a stub source listing `car/TBMS.current`
- **THEN** the entry has unit `mA`, a `dbc` and no `diag`, and the warning `diag catalog: 1 signals also in a DBC, the DBC wins: TBMS.current` is logged exactly twice, once per load
- **Evidence:** `apps/server/test/catalog.test.ts` › "DBC wins over a diag catalog and warns once per load"

#### Scenario: Earlier catalog wins
- **WHEN** `loadDiagCatalogs` reads the fixture manifest twice (two list entries, same path)
- **THEN** the result has the 18 fixture names once, from the first entry, and one warning `…test-diag.manifest.json: 18 signals already named by an earlier catalog, the earlier wins: …`
- **Evidence:** `apps/server/test/diag.test.ts` › "keeps the earlier catalog's signals"

#### Scenario: Table unit never overrides
- **WHEN** the catalog of "Unit from the table" is refreshed twice
- **THEN** `car/TBMS.current` keeps `mA` and the diag signal its diag unit on both loads, and the only warning logged per load is the existing `diag catalog: … the DBC wins: TBMS.current` line (none about units)
- **Evidence:** `apps/server/test/catalog.test.ts` › "takes the table unit when no DBC or diag unit exists"

### Requirement: Diagnostic catalog problems per load
A diagnostic catalog problem SHALL never stop the server or a catalog load: an unusable manifest SHALL be skipped, a missing or unparsable names file SHALL leave that manifest's fields with their catalog names, and a names entry that cannot apply SHALL be ignored (cases: design M3). Each problem SHALL be logged once per catalog load with the path and, for entries, the key. Origin: necessary consequence: missing metadata never blocks data display (as "DBC warnings per load", design H5).

#### Scenario: Bad names entries
- **WHEN** `parseDiagCatalog` reads the fixture manifest with the inline names `PRES_VIN_17Byte = "a"`, `Nope = "b"`, `"0x0999/PRES_Flag" = "c"`, `DT_Pack_Current = "current"`, `"0x0204/PRES_Temp_2Byte" = "9x"`, `"DT_Pack/PRES_Flag" = "current"` and `"0x0204/DT_Pack_Current" = "amps"` (in this order)
- **THEN** only `DT_Pack_Current = "current"` applies (`TBMS.current`); six warnings name the keys `PRES_VIN_17Byte` (ambiguous), `Nope` (no such field), `0x0999/PRES_Flag` (no group), `0x0204/PRES_Temp_2Byte` (not a name), `DT_Pack/PRES_Flag` (name already given) and `0x0204/DT_Pack_Current` (field already named), each ending `entry ignored`
- **Evidence:** `apps/server/test/diag.test.ts` › "ignores bad names entries with a warning"

#### Scenario: Missing names file, broken manifest
- **WHEN** `loadDiagCatalogs` reads, in this order: the fixture pair, a copy of the fixture manifest without names file next to it (temp dir), a missing path, a JSON file with `format` `uds-catalog-manifest/2`
- **THEN** the pair yields its 18 names; the copy adds `TBMS.DT_Cell.PRES_Cell_2Byte.01` … `.12`, `TBMS.DT_Pack.DT_Pack_Current`, `TBMS.DT_Contactor.PRES_Contactor_State` and `TBMS.DT_Ident_A.PRES_VIN_17Byte` (catalog names; 33 names in all); exactly four warnings: the copy's names file missing (`fields keep their catalog names`), the copy's 3 names already named by the pair (`TBMS.DT_Pack.PRES_Temp_2Byte`, `TBMS.DT_Pack.PRES_Flag`, `TBMS.DT_Ident_B.PRES_VIN_17Byte`), the missing manifest skipped, the foreign format skipped
- **Evidence:** `apps/server/test/diag.test.ts` › "skips missing and foreign manifests, falls back without names file"

#### Scenario: Server starts without the catalog
- **WHEN** the server starts with `KIPSCOPE_DIAG_CATALOGS=/nonexistent.manifest.json`
- **THEN** it serves the catalog as before this change (`BMS.*` without unit) and logs `diag catalog: /nonexistent.manifest.json skipped: …` once per catalog load
- **Evidence:** `apps/server/test/catalog.test.ts` › "logs diag catalog warnings once per load" (stub loader reporting one problem per load, two refreshes, two warnings)

### Requirement: No text selection in the explorer list
A click, double-click, Shift-click or Ctrl/Cmd-click anywhere in the explorer's result list (rows, group headers, "Show more") SHALL NOT select page text, and a press in the list SHALL NOT take the focus; a click on a row or group header SHALL move the focus into the search without selecting its text, so arrows, Shift+Arrow and Enter work after a click. The search field SHALL stay a normal text field. Origin: D-065 (quoted in design.md); focus: Jan's check 2026-10-17 (Shift+Arrow after a click).

#### Scenario: Presses in the list select nothing
- **WHEN** on smart451 at 1440×900 the user types `speed`, then clicks the padding right of `WSPD_FL`'s unit, double-clicks the name `WSPD_FR`, Shift-clicks the unit of `WSPD_RL`, Ctrl-clicks (Cmd on macOS) the SNA-dot column of `SPEED_DISP`, and double-clicks the group header `ESP`
- **THEN** after each step `window.getSelection().toString()` is empty and no text is highlighted, and the search field still has focus
- **Evidence:** UI check on smart451 at 1440×900 (one screenshot after the Shift-click, the selection string after each step)

#### Scenario: Search text still selectable
- **WHEN** the search field holds `speed` and the user double-clicks into it
- **THEN** the word `speed` in the field is selected
- **Evidence:** UI check on smart451 at 1440×900 (screenshot)

#### Scenario: Press handler and list rule
- **WHEN** `preventListPress` gets a fake mouse event with button 0, 1 or 2, and the rule for `.explorer .results` is read from `apps/web/src/styles.css`
- **THEN** `preventDefault` was called for each, and the rule contains `user-select: none`
- **Evidence:** `apps/web/test/selection.test.ts` › "keeps presses in the list from selecting text"

### Requirement: Selecting signals by click
The explorer SHALL keep a selection of signal rows. A plain click on a row SHALL select only that row; Ctrl-click (Windows, Linux) or Cmd-click (macOS) SHALL toggle a row; Shift-click SHALL select the signal rows from the anchor (the last plain- or toggle-clicked row) to the clicked row, in list order across groups, headers excluded. Any click on a row SHALL make it the active row. Origin: D-066 (Jan: „selct multple entries with shift ctrl or so (win )"); keys: lead default L1.

#### Scenario: Ctrl/Cmd and Shift on smart451
- **WHEN** on smart451 at 1440×900 the user types `speed`, clicks `STEER_SPEED`, Shift-clicks `WSPD_FR`, then Ctrl-clicks (Cmd on macOS) `CompSpd_Target` and `SPEED_DISP`
- **THEN** after the Shift-click `STEER_SPEED`, `CompSpd_Target`, `WSPD_FL`, `WSPD_FR` are marked selected and the headers `AC` and `ESP` are not; after the Ctrl/Cmd-clicks `STEER_SPEED`, `WSPD_FL`, `WSPD_FR`, `SPEED_DISP` are selected; the active row is always the last clicked one (`SPEED_DISP` at the end)
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each of the two steps)

#### Scenario: Click rules
- **WHEN** the pure helpers get: a plain click on a row; a toggle on a selected and on an unselected row; Ctrl with `mac` false, Meta with `mac` true, and the opposite pairs; a range from an anchor in group `A` to a row in group `C` with a header between; an anchor no longer in the items
- **THEN** one row with it as anchor; the row removed or added, with it as anchor; "toggle" for the platform's key and "plain" for the other; the signal rows between, headers excluded, anchor kept; a range of one row
- **Evidence:** `apps/web/test/selection.test.ts` › "selects one row on a plain click", "toggles with Ctrl, or Cmd on macOS", "selects a range of signal rows across groups with Shift"

### Requirement: Selecting signals by keyboard
Shift+ArrowDown/ArrowUp in the search SHALL move the active item as the plain arrow does and select the signal rows from the anchor to it; without an anchor the previously active row becomes the anchor. Plain arrows SHALL NOT change the selection. Origin: D-066; keys: lead default L1.

#### Scenario: Shift+Arrow on smart451
- **WHEN** the user types `speed`, clicks `WSPD_FL` and presses Shift+ArrowDown four times
- **THEN** `WSPD_FL`, `WSPD_FR`, `TRQ_DL`, `WSPD_RL`, `WSPD_RR` are selected and `WSPD_RR` is active
- **Evidence:** UI check on smart451 at 1440×900 (screenshot); `apps/web/test/selection.test.ts` › "extends the range with Shift+Arrow"

### Requirement: Selection lifetime
A query change (including Esc) SHALL clear the selection; closing a group SHALL drop its rows from it; a click on a group header (with any modifier; it opens or closes the group as before) and a click that ends a drag SHALL NOT change it otherwise. The listbox SHALL be `aria-multiselectable="true"` and a row's `aria-selected` SHALL tell whether it is selected. Origin: D-066; lifetime: lead default L1; ARIA: necessary consequence (a multi-select listbox).

#### Scenario: Query change and closed group
- **WHEN** under `speed` the rows `WSPD_FL` and `STEER_SPEED` are selected and the user Shift-clicks the group header `ESP`, then types a space and deletes it
- **THEN** the Shift-click closes `ESP` and only `STEER_SPEED` stays selected (a drag of it carries one signal); after the query change nothing is selected
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each step); `apps/web/test/selection.test.ts` › "lists the selection in list order and drops hidden rows"

### Requirement: Adding a selection
The `+` button of a selected row, and Enter in the search while the active row is selected, SHALL add the whole selection (two or more rows) to the "Add to" target, placed as timeseries-window "Selection overflows into new windows" describes; on an unselected row they SHALL add only that row exactly as before. The selection SHALL stay after an add. Origin: D-066 („draw them to one or a new window"); `+` and Enter for a selection: lead default L3, open to Jan's veto.

#### Scenario: `+` on a selection into a new window
- **WHEN** on smart451 at 1440×900 "Add to" is "New window", the user types `speed`, clicks `WSPD_FL`, Shift-clicks `WSPD_RR` and clicks the `+` of `WSPD_RL`
- **THEN** one new window `Window <n>` shows `WSPD_FL`, `WSPD_FR`, `TRQ_DL`, `WSPD_RL`, `WSPD_RR` (one axis, `1/min`), the revision rose by six (`window.create` plus five `window.addSignal`), and the five rows stay selected
- **Evidence:** UI check on smart451 at 1440×900 (screenshot and revision after the click)

#### Scenario: `+` on an unselected row
- **WHEN** after that, the user clicks the `+` of `SPEED_DISP`, which is not selected
- **THEN** only `SPEED_DISP` is added, to a new window, and the revision rose by two, as before this change
- **Evidence:** UI check on smart451 at 1440×900 (revision before and after)

#### Scenario: Enter adds the selection
- **WHEN** "Add to" is a window `W` showing `DCU_1F4h.COMP_HV_Volt`, the user types `speed`, clicks `WSPD_FL` and presses Shift+ArrowDown once, then Enter
- **THEN** `WSPD_FL` and `WSPD_FR` are added to `W` and the revision rose by two
- **Evidence:** UI check on smart451 at 1440×900 (screenshot of W)

### Requirement: Message period from the DBC
A DBC signal's details SHALL carry its message's cycle time in ms from `BA_ "GenMsgCycleTime" BO_ <id> <ms>;` of the same file, or the file's `BA_DEF_DEF_` default for that attribute when the message has none; a cycle time of 0 or none SHALL leave it absent. Origin: D-062 („period from the DBC"); data fact: smart451's DBCs set it for 138 of 327 messages (h-can 47, hybrid-can 91), default 0.

#### Scenario: Test DBC
- **WHEN** `test-a.dbc` (ISO-8859-1, CRLF) declares `BA_ "GenMsgCycleTime" BO_ 2832 20;` and `BA_ "GenMsgCycleTime" BO_ 2833 0;` with default 0, and is parsed
- **THEN** `Cyc_B10h.CYC` has `cycleMs` 20, `Evt_B11h.EVT` and `Fast_100h.SIG_A` have none; a DBC text whose default is 100 gives a message without its own value `cycleMs` 100
- **Evidence:** `apps/server/test/dbc.test.ts` › "reads GenMsgCycleTime per message"

#### Scenario: Real DBCs
- **WHEN** `curl -s localhost:7310/api/catalog | jq -c '[.items[] | select(.dataRef == "smart451" and .dbc.cycleMs != null)] | length, (map(select(.name == "ICL_3A2h.SPEED_DISP"))[0].dbc.cycleMs)'` runs
- **THEN** it prints `408` and `100`
- **Evidence:** the `curl` command against the dev server

### Requirement: Group interval from the diagnostic catalog
A diagnostic catalog signal's details SHALL carry its group's `interval` in ms when it is a positive number with unit `ms`, `s`, `min` or `h` (e.g. `30s`); `never` or no interval SHALL leave it absent, and any other text SHALL leave it absent with a warning in that catalog load. Origin: D-062 („period from … the diagnostic catalog"); data fact: `bms-live.manifest.json` has 28 groups, 7 with an interval (`10s` 2, `30s` 4, `60s` 1), 21 `never`.

#### Scenario: Test catalog
- **WHEN** `test-diag.manifest.json` gives group `DT_Pack` the interval `10s` and `DT_Cell` `never` and is parsed; then a copy of it whose `DT_Contactor` has the interval `2 sec`
- **THEN** `TBMS.current` has `intervalMs` 10000, the `DT_Cell` signals and `TBMS.contactor` none, and the fixture gives no warning about an interval; the copy gives one warning naming `DT_Contactor` and `2 sec`
- **Evidence:** `apps/server/test/diag.test.ts` › "reads group intervals"

#### Scenario: Real catalog
- **WHEN** `curl -s localhost:7310/api/catalog | jq -c '[.items[] | select(.dataRef == "smart451" and .diag.intervalMs != null)] | length, (map(select(.name == "BMS.soc"))[0].diag.intervalMs)'` runs
- **THEN** it prints `29` and `30000`
- **Evidence:** the `curl` command against the dev server

### Requirement: Explorer follows the scope
The explorer SHALL load the catalog again whenever the workspace's scope changes (`scopeKey`), and SHALL drop an answer whose `scope` is not the current one. In scoped mode without a scope it SHALL show `No scope set. Open a view link or run kipscope scope set REF FROM TO.` instead of the list and SHALL not retry until the scope changes. While an answer has `partial`, it SHALL show `Signals of session <k>; the vehicle's full list is loading` above the list and load the catalog again every 10 s until an answer has no `partial`. Origin: necessary consequence of "Catalog contents" (the browser holds the list, signal-catalog design E3); the ADX feedback item 2; partial: object-view "Signal list loads lazily" (D-086).

#### Scenario: Reload on scope change
- **WHEN** the explorer's loader is fed the scopes "", then {testcar, T1, T2}, then the same again, then {testcar, T1 − 1 h, T2 + 1 h}, and the answer for the second scope arrives after the third scope was set
- **THEN** it fetches the catalog three times (no fetch for the repeated scope) and shows only the third answer
- **Evidence:** `apps/web/test/explorer.test.ts` › "reloads the catalog when the scope changes"

#### Scenario: No scope in the UI
- **WHEN** the dev server runs a second instance with `KIPSCOPE_CATALOG=scoped` and no state file, the UI is opened against it, and then `kipscope scope set smart451 "2026-10-13 14:00" "2026-10-13 16:00"` runs
- **THEN** the explorer first shows the "No scope set" text, then, without a reload, the scope's signals; searching `volt` finds signals of the scope (`DCU_1F4h.COMP_HV_Volt` is not in the smart451 catalog any more; corrected by the lead 2026-10-20)
- **Evidence:** UI check (two screenshots of the explorer)

#### Scenario: Partial list
- **WHEN** the loader (fake timers) gets an answer with `partial` for an object scope, then after 10 s one without
- **THEN** it shows the note with the session's position, fetches again after 10 s, then shows the full list without the note and fetches no more
- **Evidence:** `apps/web/test/explorer.test.ts` › "reloads while the list is partial"

### Requirement: Footer count follows the scope
The footer's catalog count SHALL show the size of the catalog in use and SHALL be fetched again (`/api/meta`) whenever the workspace's scope key changes (Widen, Clear, open, `scope set`), not on a re-render with the same key. Origin: necessary consequence of "Catalog contents" (the catalog in use is the scope's list, D-078) and of the footer showing that catalog's size; finding of round 2 (stale footer count).

#### Scenario: Footer count follows the scope
- **WHEN** the meta loader runs on mount (answer size 2,300), the scope key is fed again unchanged, then changed to a wider scope (answer 9,100), then cleared (answer mode `full`, size 120,000)
- **THEN** the unchanged key fetches nothing, each change fetches once, and the footer state holds 2,300, then 9,100, then `full` with 120,000; in the UI on smart451 the footer count changes with each scope change without a page reload (follow-up round 1 saw 415, 551, 553, 415)
- **Evidence:** `apps/web/test/rescope.test.ts` › "footer count follows the scope"; UI check on smart451 (footer count after each step)
