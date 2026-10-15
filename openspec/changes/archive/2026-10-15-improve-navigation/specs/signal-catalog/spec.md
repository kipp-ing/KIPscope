## MODIFIED Requirements

### Requirement: Signal hover card
Resting the pointer on a row, or making it active by keyboard, for 350 ms SHALL open a card with name, description, message and CAN ID, unit, scaling, raw step, DBC range, SNA codes, value table, source (data reference, DBC file) and the windows showing the signal. Absent fields SHALL be omitted, never shown empty or invented. The DBC range and the SNA physical values SHALL be printed by number-format with the workspace's digits option; scaling and raw step SHALL stay exact. Origin: D-017 („mit hover infos"); fields: power-user report point 4; keyboard: D-020; 350 ms is a goal; number format: D-026 („everywhere (… hover card …)"), exact scaling in design N9 (Jan's call Q7).

#### Scenario: Card for V_ANZ
- **WHEN** the user hovers `COMBI_412h.V_ANZ` on real data and the signal is shown in one window
- **THEN** after about a third of a second a card shows `COMBI_412h.V_ANZ`, `Indicated speed`, `COMBI_412h · 0x412`, unit `km/h`, scaling `× 1 + 0`, raw step `1 km/h`, range `0 … 510 km/h`, SNA `511 km/h (raw 1FFh)`, values `511 SNV`, source `smart451 · h-can.dbc`, and under "Shown in" that window's name as its header shows it (its title, or `Window <n>` when untitled)
- **Evidence:** UI check (screenshot of the card)

#### Scenario: Card with offset
- **WHEN** the user hovers `MS_608h.T_MOT` on real data
- **THEN** the card shows scaling `× 1 - 40`, raw step `1 °C`, range `-40.0 … 214 °C`, and "Shown in" reads `no window` when no window shows it
- **Evidence:** UI check (screenshot of the card); `apps/web/test/explorer.test.ts` › "formats scaling, raw step and DBC range"

#### Scenario: Prefixed SNA value
- **WHEN** the user hovers `BS_200h.DVL` on real data with the digits option at 3, then at 4
- **THEN** the SNA line reads `8.19 k1/min (raw 3FFFh)`, then `8.192 k1/min (raw 3FFFh)`, and the raw step reads `0.5 1/min` both times
- **Evidence:** UI check (two screenshots of the card); `apps/web/test/explorer.test.ts` › "formats scaling, raw step and DBC range"

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
