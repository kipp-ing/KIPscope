# signal-catalog Specification

## Purpose
Lets users and other callers discover which signals a data source offers and read their metadata, so they can find the signals relevant to an investigation.

## Requirements

### Requirement: Catalog contents
The catalog SHALL list exactly the signals that have data in the source, per data reference (for vehicle data: the vehicle). Signals that exist only in metadata files SHALL NOT be listed.

#### Scenario: Signal defined in DBC without data
- **WHEN** a DBC file defines a signal that never occurs in the database
- **THEN** the catalog does not list it

### Requirement: Signal identity
Each signal SHALL have a stable ID built from its data reference and its name in the source, which does not change between server restarts.

#### Scenario: Same ID after restart
- **WHEN** the server restarts against the same data source
- **THEN** every signal keeps the ID it had before

### Requirement: Signal metadata
The catalog SHALL return for each signal its name and, where available, its description, alias and unit. Metadata the source lacks SHALL come from configured metadata files (DBC). Missing fields SHALL be reported as absent, not as empty strings or invented values.

#### Scenario: Unit from DBC
- **WHEN** a signal `MS_312h.DNMOT` has data and the DBC defines unit and comment for signal `DNMOT` in message `MS_312h`
- **THEN** the catalog entry shows that unit and the comment as description

#### Scenario: Signal not in any DBC
- **WHEN** a signal has data but no DBC entry
- **THEN** the catalog lists it with its name only and no unit, description or alias

### Requirement: Signal search
The catalog SHALL support a case-insensitive text search that splits the query at whitespace into terms and matches a signal when every term occurs as a substring of its name, shown name (display-names), description, alias or unit. Results SHALL be ordered as in "Search ranking". The search API SHALL return results within a bounded page size. Origin: concept §4, D-017 („bei eingabe in suchliste filtern auch auf teile"); shown name: D-035 („search matches full name, short name and message alike").

#### Scenario: Match by description
- **WHEN** a user searches for a term that only occurs in a signal's description
- **THEN** that signal is in the results

#### Scenario: Large catalog
- **WHEN** the source has 10,000 signals and the query matches most of them
- **THEN** the result is limited to one page and indicates that more matches exist

#### Scenario: Match on a part of the name
- **WHEN** the query is `anz` and the catalog holds `COMBI_412h.V_ANZ`
- **THEN** `COMBI_412h.V_ANZ` is in the results, although `anz` is neither the whole name nor its start
- **Evidence:** `packages/shared/test/search.test.ts` › "matches parts of name, description and unit case-insensitively"

#### Scenario: All terms must match
- **WHEN** the query is `temp mot` and one signal has `temp` only in its description and `mot` only in its name, while another has only `temp`
- **THEN** the first signal is a result and the second is not
- **Evidence:** `packages/shared/test/search.test.ts` › "requires every term to match"

#### Scenario: Match by shown name only
- **WHEN** `COMBI_412h.V_ANZ` has the shown name `Speed` (a rename) and the query is `spe`
- **THEN** `COMBI_412h.V_ANZ` is in the results; the query `combi` still finds it through the full name
- **Evidence:** `packages/shared/test/search.test.ts` › "ranks the shown name like the name"

### Requirement: Signal explorer in the UI
The UI SHALL offer a signal explorer that searches the catalog and lists each result on one line with its shown name (display-names), unit and an SNA marker, and lets the user add a signal to a window. Further metadata, including the full source name, SHALL be shown in a hover card (see "Signal hover card"), not inline. Origin: concept §4, D-017 („signalexplorer als liste mit hover infos"); shown name: D-035.

#### Scenario: Add signal from explorer
- **WHEN** the user searches, selects a result and adds it to a window
- **THEN** the signal appears in that window

#### Scenario: SNA values shown in explorer
- **WHEN** the user searches for `V_ANZ` on real data with the shipped `kipscope.yaml`
- **THEN** the row `V_ANZ` (`COMBI_412h.V_ANZ`) shows an SNA dot whose tooltip reads `SNA 511 km/h`, its hover card shows `511 km/h (raw 1FFh)` under SNA, and the row `SZS` (`BS_208h.SZS`, no SNA codes, D-014) shows no dot
- **Evidence:** UI check (screenshot of the explorer with the V_ANZ card open)

#### Scenario: One line per signal
- **WHEN** the user searches for `temp` on real data
- **THEN** every result row is a single line and no description, SNA text or data reference appears in the list itself; goals, measured and reported but not pass/fail: row height ≤ 24 px (`getBoundingClientRect`) and at least 25 rows visible without scrolling at a 900 px tall browser window (today about 10)
- **Evidence:** UI check (screenshot plus the measured row height and visible row count)

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
SNA values SHALL be the union of the `GenSigSNA` attribute (raw hex, e.g. `"1FFh"`) and the raw values whose `VAL_` label is `SNA` or `SNV`. When both name different codes, both codes SHALL count as SNA, unless a rule below drops the `GenSigSNA` code. Origin: D-010, D-014.

#### Scenario: Attribute and label disagree
- **WHEN** a signal has `GenSigSNA "1Fh"` and `VAL_ ... 30 "SNA"`, with no `VAL_` label on 31 (real: `BS_328h.ESP_DSPL`; test DBC: `Sna_800h.MODE` with `"7h"` and `6 "SNV" 1 "ON"`)
- **THEN** both codes are SNA values of the signal (ESP_DSPL raws {30, 31}; MODE raws {6, 7})
- **Evidence:** `apps/server/test/dbc.test.ts` › "unites GenSigSNA and VAL_ SNA/SNV labels"; "derives SNA values from the real h-can.dbc"

#### Scenario: Attribute and label agree
- **WHEN** `GenSigSNA` and a `VAL_` `SNV` label name the same code (`BS_200h.DVL`: `"3FFFh"` and `16383 "SNV"`)
- **THEN** the code is reported once
- **Evidence:** `apps/server/test/dbc.test.ts` › "derives SNA values from the real h-can.dbc"

### Requirement: A valid VAL_ label beats GenSigSNA
When the `VAL_` table labels the `GenSigSNA` code with anything other than `SNA` or `SNV`, that code SHALL NOT be an SNA value; the raw value is valid. `VAL_` codes labelled `SNA`/`SNV` stay SNA. Exception: the labels `--`, `NO_TEMP_SENSOR` and `RES` mean "no value" and do NOT beat `GenSigSNA`; the code stays SNA. The list is fixed and grows only by decision. Origin: D-014 (supersedes D-010's "on conflict both count as SNA"), D-015.

#### Scenario: State labelled OK
- **WHEN** a signal has `GenSigSNA "1h"` and `VAL_ ... 1 "OK"` (real: `BS_208h.SZS`, 100 % of its data is raw 1)
- **THEN** the signal has no SNA values
- **Evidence:** `apps/server/test/dbc.test.ts` › "derives SNA values from the real h-can.dbc"

#### Scenario: Valid label on the attribute code, SNV label on another code
- **WHEN** a signal has `GenSigSNA "1h"`, `VAL_ ... 1 "MM37"` and `15 "SNV"` (real: `YRG_156h.CLU_TYPE`; test DBC: `Sna_800h.LEVEL` with `"1h"` and `1 "OK" 7 "SNV"`)
- **THEN** only the labelled code is SNA (CLU_TYPE raws {15}; LEVEL raws {7})
- **Evidence:** `apps/server/test/dbc.test.ts` › "lets a valid VAL_ label beat GenSigSNA"; "derives SNA values from the real h-can.dbc"

#### Scenario: No-value label does not beat GenSigSNA
- **WHEN** a signal has `GenSigSNA "FFh"` and a `VAL_` label `--` or `NO_TEMP_SENSOR` on 255 (real: `TPM_A1.TirePress_*`, `COMBI_408h.T_AUSSEN`; `MS_608h.FCOD_MOT` with `RES` on 63)
- **THEN** that code stays SNA (raw `FFh` / 63 is not shown as a measurement)
- **Evidence:** `apps/server/test/dbc.test.ts` › "keeps GenSigSNA when the VAL_ label means no value"; "derives SNA values from the real h-can.dbc"

### Requirement: GenSigSNA ignored on 1-bit and checksum signals
`GenSigSNA` SHALL NOT define an SNA value for a signal of bit length 1, nor for a checksum/CRC signal. A signal is a checksum/CRC signal exactly when its `SG_` name (without message name) matches `/^CRC_|(^|_)CHKSUM(_|$)/i`. `VAL_` labels `SNA`/`SNV` still apply to such signals. Origin: D-014.

#### Scenario: 1-bit brake switch
- **WHEN** a 1-bit signal has `GenSigSNA "1h"` (real: `BS_328h.BS` "Brake switch"; test DBC: `Sna_800h.FLAG` `40|1@1+`)
- **THEN** the signal has no SNA values
- **Evidence:** `apps/server/test/dbc.test.ts` › "ignores GenSigSNA on 1-bit and checksum signals"; "derives SNA values from the real h-can.dbc"

#### Scenario: Checksum and CRC signals
- **WHEN** a checksum/CRC signal has a `GenSigSNA` code (real: `SAS_0C2h.LWS_CHKSUM` `"1h"`, `BS_119h.CRC_0` `"FFh"`; test DBC: `Sna_800h.CRC_800h` `"FFh"`)
- **THEN** the signal has no SNA values
- **Evidence:** `apps/server/test/dbc.test.ts` › "ignores GenSigSNA on 1-bit and checksum signals"; "derives SNA values from the real h-can.dbc"

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

### Requirement: Search ranking
Results SHALL be ordered by tier, best first: (0) a term equals the name, its part after the first `.`, or the shown name; (1) one of them starts with the term; (2) the name or the shown name contains it; (3) only description, alias or unit do. A signal's tier is its worst term's tier; within a tier catalog order holds. API and explorer SHALL rank alike. Origin: D-018 ("explorer ranking"); tiers from the power-user report point 5; shown name like the name: D-035.

#### Scenario: Exact before prefix before substring before description
- **WHEN** the catalog holds `A_100h.DIFF_V_ANZ`, `B_200h.SPEED` (description `copy of V_ANZ`), `C_300h.V_ANZ_RAW` and `COMBI_412h.V_ANZ`, and the query is `v_anz`
- **THEN** the order is `COMBI_412h.V_ANZ`, `C_300h.V_ANZ_RAW`, `A_100h.DIFF_V_ANZ`, `B_200h.SPEED`
- **Evidence:** `packages/shared/test/search.test.ts` › "ranks exact before prefix before name substring before other fields"

#### Scenario: Message prefix and full name
- **WHEN** the query is `combi_412h.v_anz` or `combi`
- **THEN** `COMBI_412h.V_ANZ` is tier 0 for the first and tier 1 for the second
- **Evidence:** `packages/shared/test/search.test.ts` › "treats the part after the first dot as the signal name"

#### Scenario: Shown name tiers
- **WHEN** `COMBI_412h.V_ANZ` has shown name `Speed`, `B_200h.SPEED_RAW` has none, and `C_300h.X` has shown name `V_ANZ (C)`, and the queries are `speed`, `spe` and `(c)`
- **THEN** for `speed` `COMBI_412h.V_ANZ` is tier 0 and `B_200h.SPEED_RAW` tier 1; for `spe` both are tier 1; for `(c)` `C_300h.X` is tier 2
- **Evidence:** `packages/shared/test/search.test.ts` › "ranks the shown name like the name"

#### Scenario: Ties keep catalog order
- **WHEN** two signals share a tier (e.g. `othercar/Fast_100h.SIG_A` and `testcar/Fast_100h.SIG_A` for `sig_a`), and the query is empty
- **THEN** ties are ordered by name, then data reference, and the empty query returns every signal in catalog order
- **Evidence:** `packages/shared/test/search.test.ts` › "keeps catalog order within a tier and for an empty query"

#### Scenario: API ranks like the explorer
- **WHEN** the test catalog is searched for `rpm`
- **THEN** `testcar/Sna_800h.RPM` (exact) comes before the `Fast_100h.SIG_A` entries (unit `rpm`); on real data `curl -s 'localhost:7310/api/signals?q=volt' | jq -r '.items[0].id'` prints `smart451/CPC_168h.EAC_HV_Volt` (first name match; before ranking it was the description match `smart451/AC_443h.PNHV_Evap_CoolVlv_Rq_HVAC`)
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
- **WHEN** the catalog lists `smart451/COMBI_412h.V_ANZ` (`BO_ 1042 COMBI_412h: 8 CGW`, `SG_ V_ANZ : 0|9@0+ (1,0) [0|510] "km/h"`, `VAL_ 1042 V_ANZ 511 "SNV"`)
- **THEN** its DBC details are file `h-can.dbc`, message `COMBI_412h`, ID 1042, sender `CGW`, factor 1, offset 0, min 0, max 510, values `[{raw 511, label SNV}]`
- **Evidence:** `apps/server/test/dbc.test.ts` › "derives DBC details from the real h-can.dbc" (runs if the file exists; also `MS_608h.T_MOT` 1544, sender `Engine`, factor 1, offset −40, min −40, max 214; `BS_200h.DVL` 512, sender `ESP`, factor 0.5, max 8191); `curl -s 'localhost:7310/api/signals?q=COMBI_412h.V_ANZ' | jq -cS '.items[0].dbc'` prints `{"factor":1,"file":"h-can.dbc","max":510,"message":"COMBI_412h","messageId":1042,"min":0,"offset":0,"sender":"CGW","values":[{"label":"SNV","raw":511}]}`

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
- **WHEN** the user searches for `volt` on real data with the shipped `kipscope.yaml`
- **THEN** the row `PTC_HV_Volt` (`CPC_448h.PTC_HV_Volt`) shows `Volt` highlighted (one `<mark>` element) and the rest of the name plain
- **Evidence:** UI check (screenshot; `document.querySelectorAll('.explorer mark')` text); `packages/shared/test/search.test.ts` › "returns merged highlight ranges for name, unit and description" (`volt` on `CPC_448h.PTC_HV_Volt` → name `[[16, 20]]`; `v_a anz` on `COMBI_412h.V_ANZ` → `[[11, 16]]`) and › "returns highlight ranges in the shown name" (`volt` on `CPC_448h.PTC_HV_Volt` shown `PTC_HV_Volt` → shown `[[7, 11]]`; without `displayName` shown ranges equal name ranges; empty query → `[]`)

#### Scenario: Description match shown in the card
- **WHEN** the user searches for `temp` on real data and hovers `T_MOT` (`MS_608h.T_MOT`, description `Motortemperatur`)
- **THEN** the row has no highlight in the name, rows whose name contains `TEMP` are listed above it, and the card shows `temp` highlighted in `Motortemperatur`
- **Evidence:** UI check (screenshot of the card)

### Requirement: No hard cap on results
The explorer SHALL make every match reachable: it shows the total match count and, when not all list items (rows and, with groups, group headers) are rendered, a control that renders more. No fixed limit SHALL hide matches; with groups, every match SHALL be reachable by opening its group. Origin: D-018 ("without a hard cap"); headers as items: design G6.

#### Scenario: Whole catalog reachable
- **WHEN** the search field is empty on real data
- **THEN** the count reads the catalog size (e.g. `428 matches`), there is no `showing 100`; without groups, scrolling to the end of the list reaches the alphabetically last signal; with the shipped `kipscope.yaml`, the header counts add up to 428 and opening the last header `Other` and scrolling to the end reaches its alphabetically last signal
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
Resting the pointer on a row, or making it active by keyboard, for 350 ms SHALL open a card with name, description, message and CAN ID, unit, scaling, raw step, DBC range, SNA codes, value table, source (data reference, DBC file) and the windows showing the signal. Absent fields SHALL be omitted, never shown empty or invented. Origin: D-017 („mit hover infos"); fields: power-user report point 4; keyboard: D-020; 350 ms is a goal.

#### Scenario: Card for V_ANZ
- **WHEN** the user hovers `COMBI_412h.V_ANZ` on real data and the signal is shown in one window
- **THEN** after about a third of a second a card shows `COMBI_412h.V_ANZ`, `Indicated speed`, `COMBI_412h · 0x412`, unit `km/h`, scaling `× 1 + 0`, raw step `1 km/h`, range `0 … 510 km/h`, SNA `511 km/h (raw 1FFh)`, values `511 SNV`, source `smart451 · h-can.dbc`, and under "Shown in" that window's name as its header shows it (its title, or `Window <n>` when untitled)
- **Evidence:** UI check (screenshot of the card)

#### Scenario: Card with offset
- **WHEN** the user hovers `MS_608h.T_MOT` on real data
- **THEN** the card shows scaling `× 1 - 40`, raw step `1 °C`, range `-40.0 … 214 °C`, and "Shown in" reads `no window` when no window shows it
- **Evidence:** UI check (screenshot of the card); `apps/web/test/explorer.test.ts` › "formats scaling, raw step and DBC range"

#### Scenario: Card formatting rules
- **WHEN** a signal has DBC range `[0|0]`, an extended CAN ID, or no DBC entry
- **THEN** the range reads `not set`, the ID reads in hex with bit 31 cleared and `(ext)`, and a signal without DBC entry shows its source as `<dataRef> · no DBC entry` with no message, scaling, range, SNA or value lines
- **Evidence:** `apps/web/test/explorer.test.ts` › "formats scaling, raw step and DBC range", "formats message IDs as hex", "formats the source line", "lists the windows showing a signal"

#### Scenario: Card on keyboard focus
- **WHEN** the user types `DVL`, presses ArrowDown once and waits
- **THEN** the card for the second row opens without any pointer movement, and moving the active row moves the card
- **Evidence:** UI check (screenshot)

#### Scenario: No flicker while sweeping
- **WHEN** the user moves the pointer quickly down across ten rows without resting
- **THEN** no card opens; once a card is open, moving to a neighbouring row switches the card at once
- **Evidence:** UI check (description of the observed behaviour)

### Requirement: Hover card number formats
The hover card's DBC range and SNA physical values SHALL be printed by number-format with the workspace's digits option; scaling and raw step SHALL stay exact. Origin: D-026 („everywhere (… hover card …)"); exact scaling: design N9 (Jan's call Q7).

#### Scenario: Prefixed SNA value
- **WHEN** the user hovers `BS_200h.DVL` on real data with the digits option at 3, then at 4
- **THEN** the SNA line reads `8.19 k1/min (raw 3FFFh)`, then `8.192 k1/min (raw 3FFFh)`, and the raw step reads `0.5 1/min` both times
- **Evidence:** UI check (two screenshots of the card); `apps/web/test/explorer.test.ts` › "formats scaling, raw step and DBC range"

### Requirement: Explorer keys
The explorer SHALL support: `/` focuses the search field when focus is not in a text field (the `/` is not typed); Esc in the search field clears the query and closes the card; ArrowDown/ArrowUp move the active item (clamped at the ends) and keep it in view; Enter adds the active row exactly as its add button does. With groups (capability `signal-groups`) the items include the group headers: Enter on a header opens or closes its group and keeps it active. After each query change the active item SHALL be the first signal row shown, or the first item when no row is shown. Origin: D-020 ("The explorer list is keyboard-driven: `/` focuses the search, arrow keys move, Enter adds, Esc clears."); headers: D-053 with design G6.

#### Scenario: Search, Enter adds the top hit
- **WHEN** focus is on the page body, the user presses `/`, types `V_ANZ` and presses Enter
- **THEN** the search field contains exactly `V_ANZ` and `COMBI_412h.V_ANZ` is added to the selected "Add to" target (also with the header `CGW 1` above the row)
- **Evidence:** UI check (screenshot of the new window)

#### Scenario: Arrows choose another hit
- **WHEN** with the shipped `kipscope.yaml` the user types `temp`, presses ArrowDown twice and Enter; then ArrowDown twice more, Enter, ArrowDown once
- **THEN** `MS_608h.T_LUFT` (third row under `Engine 4`) is added, the active item was visibly marked while moving; then the header `CPC 5` is active and Enter hides its five rows, and the next ArrowDown makes the header `PNHV 1` active
- **Evidence:** UI check (screenshot); `apps/web/test/explorer.test.ts` › "groups matches by best hit, Other last, collapsed on an empty query" (item order)

#### Scenario: Esc clears
- **WHEN** the search field holds `temp` and the user presses Esc
- **THEN** the field is empty, the full list is shown (with the shipped `kipscope.yaml`: every group header, all collapsed) and the active item is the first one
- **Evidence:** UI check (screenshot)

### Requirement: Explorer rows are a drag source
Pressing on an explorer row's name and moving the pointer SHALL start the app's pointer drag (design S3) with that signal; the ghost SHALL show the signal's shown name. Windows that do not show it and stay within four units SHALL be highlighted with "Drop to add"; one that would reach a fifth unit SHALL be marked not droppable ("At most 4 units per window") and ignore a drop. A drop adds, never moves; Alt/Ctrl change nothing. The add button SHALL NOT start a drag. Origin: D-020 (explorer drag; fifth unit refused as for legend drags); shown name in the ghost: D-035.

#### Scenario: Drag a row onto a window
- **WHEN** a window exists that does not show `COMBI_412h.V_ANZ`, and the user drags the `V_ANZ` row onto it with the mouse (shipped `kipscope.yaml`)
- **THEN** windows not showing V_ANZ are highlighted with "Drop to add" while dragging, a window showing it is not highlighted, the ghost reads `V_ANZ · add` over a valid target, the hover card is closed, and after the drop the signal appears in that window while the explorer row stays
- **Evidence:** UI check (screenshot during the drag and after the drop); `apps/web/test/drag.test.ts` › "adds an explorer signal to windows not showing it and to a new window"

#### Scenario: Fifth unit refused for an explorer drag
- **WHEN** window A shows `CPC_168h.EAC_HV_Volt` (V), `COMBI_412h.V_ANZ` (km/h), `MS_608h.T_MOT` (°C) and `BS_200h.DVL` (1/min), and the user drags the `MS_312h.DNMOT` (`rpm/10ms`) row over A and releases
- **THEN** A is marked not droppable with the hint "At most 4 units per window" while dragging, and the release changes nothing (revision unchanged); dragging `CPC_448h.PTC_HV_Volt` (V) over A highlights it with "Drop to add"
- **Evidence:** `apps/web/test/drag.test.ts` › "refuses an explorer drop that would make a fifth unit"; UI check (screenshot while dragging, revision before and after)

#### Scenario: Legend drags unchanged
- **WHEN** a legend row is dragged after this change
- **THEN** source, target and refused states, the hint "Drop to move · Alt/Ctrl+drop to copy" and move/copy behave as before
- **Evidence:** `apps/web/test/drag.test.ts` › "keeps the legend-drag states" and the existing drag tests

#### Scenario: Drag a row onto "+ New window"
- **WHEN** the user drags the `DVL` row (`BS_200h.DVL`) onto the "+ New window" zone
- **THEN** a new window `Window <n>` with DVL is created, exactly as with the add button and "New window" selected
- **Evidence:** UI check (screenshot); `apps/web/test/drag.test.ts` › "adds an explorer signal to windows not showing it and to a new window"

#### Scenario: Click is not a drag
- **WHEN** the user clicks a row's name or its add button without moving the pointer
- **THEN** no drag starts (no ghost, no highlighted targets)
- **Evidence:** UI check

### Requirement: Stable "Add to" target
The explorer's "Add to" target SHALL be the marked window (workspace-layout "Marked window"), held by window ID, or "New window" while none is marked. It SHALL change only by the user's own act (a click on a window header, or a choice in the "Add to" select, which shows and sets the same mark), or fall back to "New window" when its window is removed. Origin: D-020 (target stays); D-022 (fallback); D-027 (marking sets the target).

#### Scenario: Removed target falls back
- **WHEN** the marked window is removed, by its menu or because a move emptied it
- **THEN** the target becomes "New window", the select shows it and no window is marked
- **Evidence:** `apps/web/test/explorer.test.ts` › "keeps the Add to target by window ID while windows change"; UI check (screenshot after dragging the marked window's only signal into another window)

#### Scenario: Select and header mark the same window
- **WHEN** the user marks `Window 1` by a click on its header, then chooses `Window 2` in the "Add to" select, then chooses "New window"
- **THEN** after the click the select shows `Window 1` and Window 1 shows the mark; after the choice the mark is on Window 2 only; after "New window" no window shows the mark
- **Evidence:** UI check on smart451 at 1440×900 (screenshot after each step)

### Requirement: "Add to" target ignores other changes
Creating, renaming or reordering windows, drops, cursor clicks, new revisions and query changes SHALL NOT change the "Add to" target. Origin: D-020 („The "Add to" target stays where the user put it"); D-027.

#### Scenario: Target survives window changes
- **WHEN** windows `w1` and `w2` exist, the user marks `w2`, then a third window is created (via "New window" add or the CLI) and `w1` is renamed
- **THEN** the target is still `w2`, and the next add (button or Enter) lands in `w2`
- **Evidence:** `apps/web/test/explorer.test.ts` › "keeps the Add to target by window ID while windows change"; UI check (add T_SOLL after creating another window; screenshot shows it in the marked window)

### Requirement: Add button names its target
The add button SHALL name its "Add to" target; Enter adds to the same target. Origin: D-020; D-027.

#### Scenario: Add button names its target
- **WHEN** the user points at a row's add button with target `w2` titled `Speeds`
- **THEN** its tooltip and accessible name read `Add to Speeds` (`Add to new window` for "New window")
- **Evidence:** UI check (screenshot of the tooltip)

### Requirement: Catalog loads until it succeeds
While the catalog has never loaded, the server SHALL load it again by itself 1, 2, 4, 8 and 16 s after the first five failures in a row and 30 s after each later one, and SHALL stop once a load succeeds. A later failed refresh SHALL keep the loaded catalog and start no background retry. Origin: D-042 (carserver's 23:00 reboot) and necessary consequence: without it, a start while the tunnel is down answers 503 to every series request until someone posts a refresh. Numbers: design H5.

#### Scenario: Source down at start
- **WHEN** the catalog's source fails its first four loads at once and answers the fifth (fake timers)
- **THEN** the loads start at 0, 1, 3, 7 and 15 s, the catalog has loaded after the fifth, and no further load starts within the next 120 s
- **Evidence:** `apps/server/test/catalog.test.ts` › "keeps loading the catalog with backoff until it succeeds"

#### Scenario: Restart with the tunnel down
- **WHEN** the lead stops the carserver tunnel, restarts the KIPscope server, and starts the tunnel again 20 s later
- **THEN** within 35 s of the tunnel coming back, `curl -s localhost:7310/api/catalog | jq '.items | length'` prints the signal count, without a manual refresh
- **Evidence:** lead's manual check (command output)

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
