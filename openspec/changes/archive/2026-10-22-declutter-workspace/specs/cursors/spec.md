## MODIFIED Requirements

### Requirement: Readout cells in the legend
While A is on, each signal's legend row in a timeseries window SHALL show its value at A, while B is on also at B, and in diff mode Δ = B−A, in columns aligned across rows and headed by the cursor times ("Readout row"); after them the live column L (live-cursor "L column in every chart legend") SHALL always follow, also while A and B are off. The legend SHALL always be a grid (name, `[unit]`, A | B | Δ while on, L), never a wrapping list. Cells use number-format without the unit but with its SI prefix (the row names `[unit]` once) and no tag; the kind (`lin`, `hold`, `avg`) is the tooltip. SNA reads `SNA`, a missing value `—` with the reason, a loading value the values window's loading state. Origin: D-027; concept §6; design N3 of `improve-navigation`; D-030; D-031; L column: D-032 („Every chart legend gets a 4th column L"); always a grid: D-033 („The chart legend is always a grid ... (replaces the wrapping list with cursors off)"); column headers: D-092 (10).

#### Scenario: Speed difference on the chart
- **WHEN** a window on smart451 shows `COMBI_412h.V_ANZ`, `BS_200h.DVL` and `CPC_168h.EAC_HV_Volt` from 2026-10-13T13:08:00Z to 13:08:03Z in line mode, diff mode is on, A is at 13:08:00.093Z and B at 13:08:00.995Z
- **THEN** the V_ANZ row reads `[km/h]`, A `23.0`, B `18.0`, Δ `-5.00`, then the L cell; the DVL row reads A `180` with tooltip "linear between points (lin)"; the EAC_HV_Volt row reads A `360`, B `361` and Δ `687 m` (values from `kipscope value … line` on 2026-10-21: V_ANZ 23 and 18 raw, DVL 179.75 interpolated, EAC_HV_Volt 360 and 360.687 interpolated; design DW24)
- **Evidence:** UI check (screenshot of the window); `apps/web/test/readout.test.ts` › "evaluates raw results like evaluateAt, with edge neighbours", "computes Δ only from numbers and marks it avg > lin > hold"

#### Scenario: A only
- **WHEN** diff mode is off, A is on and B is off in the window above; then B is set to 13:08:00.995Z
- **THEN** each row shows the A column and the L column, headed `A 15:08:00.093`; then the A, B and L columns without Δ, headed `A …` and `B …` and no `Δt`
- **Evidence:** UI check (screenshot)

#### Scenario: Cursors off
- **WHEN** A and B are off and the pointer is outside every plot
- **THEN** the legend is a grid, one row per signal, with name and `[unit]` and no A, B or Δ column, no header row, only the empty L column at the same x in every row
- **Evidence:** UI check (screenshot)

### Requirement: Readout row
While a cursor is on, a timeseries window's legend SHALL have one header row above its signal rows, whose cells head the cursor columns: over A `A <clock>` (local `HH:MM:SS.mmm`, cut, never rounded up; the full time in the values-window format as tooltip), over B `B <clock>` while B is on (`B off` in diff mode), and over Δ `Δt <signed Δt>` (values-window "Time formats") in diff mode. Its name cell holds the next-step hints (`guidance` "Next-step hints at the cursors") and is otherwise empty. Each cursor column SHALL have one fixed width, that of `A 00:00:00.000` in the legend's font with tabular numbers (goal ≈ 84 px; the mock's 72 px ×½ cuts every header, ×2 is 500 px for three columns, more than a 480 px window), so moving a cursor changes no column; a longer cell text truncates with `…` and keeps its full text as tooltip. There SHALL be no separate readout row; the header covers no part of the plot except the Δt label ("Δt between the cursor flags"). Origin: D-027 (the values window stays for many signals); concept §6 (Δt); clock only: D-030; header row: D-092 (10) („A/B/Δ readout becomes the legend's column headers"); fixed width: D-092 („Layout never moves").

#### Scenario: Times and Δt
- **WHEN** the window of "Speed difference on the chart" is shown, then diff mode is switched off, then B is switched off, then A
- **THEN** the header row reads `A 15:08:00.093` (tooltip `2026-10-13 15:08:00.093`), `B 15:08:00.995`, `Δt +902 ms` over the A, B and Δ columns; then `A 15:08:00.093`, `B 15:08:00.995`; then only `A 15:08:00.093`; then the header row is gone
- **Evidence:** UI check (three screenshots); `apps/web/test/readout.test.ts` › "heads the legend columns with the cursor times"

#### Scenario: Header helper
- **WHEN** `legendHeaders` gets A at 1791896880093456789 ns and B at A + 902 ms in Europe/Berlin with diff on; A alone; B off with diff on; and no cursor
- **THEN** it gives `A 15:08:00.093` with the tooltip `2026-10-13 15:08:00.093456789`, `B 15:08:00.995` and `Δt +902 ms`; `A 15:08:00.093` only; `A 15:08:00.093`, `B off` and no Δt; undefined
- **Evidence:** `apps/web/test/readout.test.ts` › "heads the legend columns with the cursor times"

#### Scenario: Columns hold still
- **WHEN** on smart451 a window shows three signals with A, B and Diff on, the layout probe of design DW1 runs, and the user drags A's line across the plot and releases it
- **THEN** the probe reports at most 1 px for the window's header cells, the plot and the legend's first row; the column headers changed their times
- **Evidence:** UI check on smart451 at 1440×900 (probe output, screenshot after)

#### Scenario: Nothing over the curves
- **WHEN** a window shows six signals in at most four units (the unit limit, D-019) with A and B on in diff mode
- **THEN** the plot shows the curves, the cursor lines with their flags and the Δt label only; all values are in the legend rows
- **Evidence:** UI check (screenshot)

## ADDED Requirements

### Requirement: Keys bring a cursor into view
Outside text fields and selects, without Ctrl, Meta or Alt, while no drag runs and the range picker is closed, Shift+A and Shift+B SHALL centre the bar target's span on cursor A or B (span kept) with one `window.setRange` and one history entry, as its strip flag does (time-strip "Cursor markers on the strip"); with that cursor off they SHALL do nothing. The Keys tab SHALL list them. Origin: D-095 (critic 13: Shift+A / Shift+B bring A or B into view).

#### Scenario: Key mapping
- **WHEN** the key handler gets `A` with Shift, `B` with Shift, `a` without Shift, `A` with Shift and Ctrl, `A` with Shift in the explorer search, and `A` with Shift while the range picker is open
- **THEN** `cursorA`, `cursorB`, nothing for the last four (lower-case `a` stays unbound)
- **Evidence:** `apps/web/test/keys.test.ts` › "maps Shift+A and Shift+B to bring a cursor into view"; `apps/web/test/hints.test.ts` › "keeps every hint within the wording rule" (`Shift+A` and `Shift+B` in `SHORTCUTS`)

#### Scenario: Keys on smart451
- **WHEN** at 1440×900 A is at 2026-10-13 15:09 local and B is off, window 1 shows a 20 min range on 2026-10-17, and the user presses Shift+A, then Shift+B, then Backspace
- **THEN** after Shift+A the range button shows a 20 min range centred on A (`26-10-13 14:59` and `0:20 h`), revision +1; Shift+B changes nothing (revision unchanged); Backspace returns to the range on 2026-10-17
- **Evidence:** UI check on smart451 (range button and revision after each key)
