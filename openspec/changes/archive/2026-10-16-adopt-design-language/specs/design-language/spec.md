## ADDED Requirements

### Requirement: Design tokens
The web app SHALL define its colours, sizes and fonts once as custom properties on `:root` with the values of design T1 (slate neutrals, the accent sky with soft, ink and ring tints, the status colours ok, SNA and error, each with a fill) and use them instead of literal colours. The page background SHALL be slate-50, panels white. Origin: D-055 (accent sky `#0284c7`; mock "Tokens and parts", Neutrals and Accent and status).

#### Scenario: Token values
- **WHEN** the app is open on smart451 at 1440×900
- **THEN** `getComputedStyle(document.documentElement)` gives `--accent` `#0284c7`, `--accent-soft` `#e0f2fe`, `--accent-ink` `#075985`, `--accent-ring` `#7dd3fc`, `--ok` `#047857`, `--error` `#be123c`, `--sna` `#f59e0b`, `--sna-ink` `#92400e`, `--muted` `#64748b`, `--text` `#0f172a`; `body` background is `rgb(248, 250, 252)` and the explorer's `rgb(255, 255, 255)`
- **Evidence:** UI check on smart451 (the computed values, one screenshot of the whole page)

#### Scenario: No old accent left
- **WHEN** `grep -rnE "2563eb|37 99 235|dc2626|16a34a" apps/web/src` runs
- **THEN** it prints nothing
- **Evidence:** the command

### Requirement: Type scale
The base font size SHALL be 12 px in the system sans font, controls inheriting it; section labels 11 px, weight 600, upper case, muted; window titles 12 px weight 600; signal names in the explorer and legend monospace at 11.5 px; numbers in tabular figures everywhere. Origin: D-055 (compact density, 12 px; mock "Type": 12/600 titles, 12/400 body and controls, 11/600 caps section label, mono for signal names, tabular numbers everywhere).

#### Scenario: Computed type
- **WHEN** the six-window setup is shown on smart451 at 1440×900
- **THEN** `getComputedStyle` gives: `:root` `font-size` 12 px and `font-variant-numeric` `tabular-nums`; the "Go to" field and the Back button 12 px; the explorer's "Signals" heading 11 px, `font-weight` 600, `text-transform` `uppercase`; a window title 12 px, 600; an explorer row name and a legend name 11.5 px with a `font-family` starting `ui-monospace`
- **Evidence:** UI check on smart451 (the computed values)

### Requirement: Controls
Top-row buttons, selects and text fields SHALL be 26 px tall with a 1 px slate-300 border, 4 px radius and white fill; disabled ones a slate-200 border and slate-400 text. The explorer search SHALL be 30 px tall; header controls stay 22 px. With the sidebar open the top row stays one line at 1440×900 and 1000×557. Origin: D-055 (mock "Controls"); 22 px and one line: `workspace-layout` "Compact window header", "Screen use".

#### Scenario: Control boxes
- **WHEN** a timeseries window is shown and "Back" is disabled (no history)
- **THEN** "Reset", "Back", the Span and Digits selects and "Go to" measure 26 px tall (`getBoundingClientRect().height`, ±0.5); "Reset" has `border-radius` 4 px and border colour `rgb(203, 213, 225)`; "Back" has border colour `rgb(226, 232, 240)` and text colour `rgb(148, 163, 184)`; the search field is 30 px tall; a window's mode select is 22 px tall
- **Evidence:** UI check on smart451 at 1440×900 (the measured values)

#### Scenario: One line at both viewports
- **WHEN** the six-window setup is shown with the sidebar open at 1440×900 and at 1000×557
- **THEN** every control of the top row has the same `getBoundingClientRect().top` (±1 px) in each viewport; goal, measured and reported but not pass/fail: top row ≤ 36 px tall (`workspace-layout` "Compact bars")
- **Evidence:** UI check on smart451 (tops and height per viewport, one screenshot each)

### Requirement: One primary per surface
A surface (explorer, top row, a window, the footer) SHALL show at most one primary button, drawn slate-900 with white text; pressed toggles are not primary buttons. This change adds no primary button. Origin: D-055 (mock "Controls": „one dark primary per surface"); no new button: D-055 („restyle only").

#### Scenario: At most one primary per surface
- **WHEN** the six-window setup is shown with A, B and Diff on
- **THEN** in the explorer, the top row, each window and the footer, at most one `button` that is not a pressed toggle (`aria-pressed`, `aria-expanded` or a checked pill) has background `rgb(15, 23, 42)`
- **Evidence:** UI check on smart451 (a snippet counting such buttons per surface, its output)

### Requirement: Cursor toggles as pills
A, B and Diff SHALL be pills (26 px, fully rounded): on slate-900 with white text, off white with a slate-300 border, disabled as in "Controls", with unchanged behaviour, tooltips and keys (accent focus ring, Space switches). "Link time axes" stays a checkbox ticked in the accent. "Signals" SHALL be slate-900 with white text while the sidebar is open. Origin: D-055 (mock option bar).

#### Scenario: Pills on and off
- **WHEN** A is on, B off and Diff off; then the user presses Tab until A's toggle has focus and presses Space
- **THEN** first A's pill has background `rgb(15, 23, 42)` and text `rgb(255, 255, 255)`, B's and Diff's background `rgb(255, 255, 255)` and border `rgb(203, 213, 225)`, each 26 px tall with `border-radius` ≥ 13 px; after Space, A is off (the A line is gone, revision +1) and the focused pill shows an accent outline
- **Evidence:** UI check on smart451 (computed values, screenshot before and after Space); `apps/web/test/bar.test.ts` stays green

#### Scenario: Signals toggle
- **WHEN** the sidebar is open, then the user presses `s`
- **THEN** "Signals" has background `rgb(15, 23, 42)` while open and `rgb(255, 255, 255)` after `s`; the "Link time axes" checkbox has `accent-color` `rgb(2, 132, 199)`
- **Evidence:** UI check on smart451 (computed values in both states)

### Requirement: Explorer look
The explorer heading SHALL be a section label; group headers slate-100 bands, 4 px radius, 3 px below the group above, darker under the pointer; rows indented under their header; the active row or header in the accent soft fill and ink; the row "+" slate-400, accent under the pointer. Behaviour unchanged; rows and headers ≤ 24 px. Origin: D-055 (mock "Pills and list", sidebar); 24 px: `signal-catalog`, `signal-groups`.

#### Scenario: Bands and active row
- **WHEN** the explorer of smart451 shows the empty search with `Engine` expanded and the arrow keys put the active row on its second signal
- **THEN** every `.group-head` has background `rgb(241, 245, 249)`, `border-radius` 4 px and height ≤ 24 px; the active row has background `rgb(224, 242, 254)` and its name colour `rgb(7, 89, 133)`; every row is ≤ 24 px tall and its name's left edge lies right of its header's name's left edge
- **Evidence:** UI check on smart451 at 1440×900 (computed values and rects, one screenshot)

### Requirement: Window look
Every window SHALL be a white tile with a slate-200 border and 6 px radius; its 24 px header line holds a slate-100 bottom divider, the title in 12 px weight 600 slate-800 and the badge as a pill with slate-100 fill, slate-600 text and no border. The plot grid SHALL be slate-200, neutral tick labels slate-500 at 11 px. Origin: D-055 (mock window); 24 px: `workspace-layout` "Compact window header".

#### Scenario: Header and badge
- **WHEN** a timeseries window on smart451 shows `ICL_3A2h.SPEED_DISP` aggregated
- **THEN** its `.window-header` is ≤ 24 px tall with a bottom border colour `rgb(241, 245, 249)`; the window's border colour is `rgb(226, 232, 240)` and radius 6 px; the badge has background `rgb(241, 245, 249)`, colour `rgb(71, 85, 105)` and no border
- **Evidence:** UI check on smart451 at 1440×900 (computed values, one screenshot)

### Requirement: Cursor and L line look
Cursor lines and flags SHALL be slate-900: A solid with a filled flag, B dashed with a white flag, slate-900 border and text. The L line in the other windows SHALL be a 1 px solid line in slate-500. Origin: D-055 (mock: A solid / B dashed slate-900, L line); slate-500 L line: D-055 (Jan, Q3: too close to series blue in the accent); neutral cursor colour outside the palette: `cursors` "Cursor lines in every timeseries window".

#### Scenario: Cursors and L line
- **WHEN** two linked windows show the same time, A and B are on, and the pointer hovers window 1
- **THEN** A's flag has background `rgb(15, 23, 42)`, B's flag background `rgb(255, 255, 255)` with border `rgb(15, 23, 42)`; window 2's L line has colour `rgb(100, 116, 139)`
- **Evidence:** UI check on smart451 at 1440×900 (computed values, one screenshot with A, B and the L line)

### Requirement: Legend look
Legend rows SHALL show a 12 × 3 px line swatch, the name monospace in slate-800, values sans in tabular figures, the load status as a pill (loading slate-100 / slate-600, failed in the error fill and colour) and the SNA share as a pill in the SNA fill and ink; complete shows no pill. The live label SHALL be white with a 1 px signal-colour border, 4 px radius, weight 600. Columns stay. Origin: D-055 (mock legend, "Pills and list"; `ready` is illustration).

#### Scenario: Pills in the legend
- **WHEN** a window on smart451 shows a signal with a non-zero SNA share (its legend shows `SNA … %` today) and `BRK_1A0h.WSPD_FL` while WSPD_FL still loads, then after both loaded
- **THEN** while loading WSPD_FL's status pill has background `rgb(241, 245, 249)`; the SNA share has background `rgb(255, 251, 235)` and colour `rgb(146, 64, 14)`; after loading no status pill is shown; each swatch measures 12 × 3 px (±0.5)
- **Evidence:** UI check on smart451 (computed values, screenshot while loading and after)

#### Scenario: Live cells keep their column
- **WHEN** the scenario "Cursors off, no hover" of `live-cursor` runs on the restyled legend
- **THEN** its THEN holds (L cells in one column within 1 px, no row, name or SNA share moves)
- **Evidence:** UI check (two screenshots, as in `live-cursor`)

### Requirement: Footer look
The footer SHALL be a white band across the window list's column with a slate-200 top border, items in 12 px, the attribution in 11 px muted at its right end; "connected" in the ok colour, weight 500, after a 7 px emerald dot. During a drag the band shows the "+ New window" zone in the same box. Origin: D-055 (mock footer); 12/11 px and colour: `app-footer` "Attribution small and subtle" (D-050); same box: `workspace-layout` "Top row and status strip".

#### Scenario: Footer band
- **WHEN** the six-window setup is shown on smart451 at 1440×900, idle and during a legend-row drag
- **THEN** the footer has background `rgb(255, 255, 255)` and a top divider `rgb(226, 232, 240)` while idle, is one line ≤ 32 px tall in both states, "connected" has colour `rgb(4, 120, 87)`; the attribution gives `font-size` 11 px, `opacity` 1 and colour `rgb(100, 116, 139)`; every window's top is the same before and during the drag (±0.5 px)
- **Evidence:** UI check on smart451 (computed values and rects in both states)

### Requirement: Series palette
The series palette SHALL be, in order, Okabe-Ito `#0072B2`, `#E69F00`, `#009E73`, `#D55E00`, `#CC79A7`, `#56B4E9`, then `#332288`, `#882255`, `#999933`, `#8C564B`; the last four at least 3:1 on white, every pair at least ΔE 25 apart. The workspace keeps indices, so a signal shows the new colour at its index. Origin: D-055 (Okabe-Ito); ten and indices: `workspace-state` "Stable signal colours" (D-018); the four: design T5.

#### Scenario: Palette content
- **WHEN** the shared tests run
- **THEN** `SIGNAL_COLORS` equals the ten colours above in order, the last four reach ≥ 3:1 against `#ffffff`, and the smallest pairwise ΔE (CIE76) is ≥ 25 (it is about 26 between `#0072B2` and `#56B4E9`)
- **Evidence:** `packages/shared/test/workspace.test.ts` › "uses Okabe-Ito first, ten distinguishable colours"; `packages/shared/test/apply.test.ts` › "assigns stable colours across windows" stays green

#### Scenario: Colours on screen
- **WHEN** a fresh workspace gets `ICL_3A2h.SPEED_DISP` and then `BRK_1A0h.WSPD_FL` in one window
- **THEN** SPEED_DISP is drawn, listed and SNA-marked in `#0072B2` and WSPD_FL in `#E69F00`
- **Evidence:** UI check on smart451 (screenshot, swatch background `rgb(0, 114, 178)` and `rgb(230, 159, 0)`)

### Requirement: Spec numbers kept
The restyle SHALL keep every size other specs set for the page: sidebar 240 px, explorer rows and group headers ≤ 24 px, window headers ≤ 24 px, footer ≤ 32 px (two lines ≤ 48 px), A | B | Δ | L in a 485 px values window, default plot 280 px, plot share ≥ 30 % at 1000×557 with the sidebar open. Origin: necessary consequence of D-055 („restyle only"); the numbers and their specs: design T9.

#### Scenario: Numbers re-measured
- **WHEN** the six-window setup and one values window 485 px wide are shown on smart451, at 1440×900 and at 1000×557 with the sidebar open
- **THEN** sidebar 240 px (±1), every explorer row and header ≤ 24 px, every `.window-header` ≤ 24 px, footer ≤ 32 px, the values window shows A, B, Δ and L uncut, a fresh window's plot 280 px (±1), and the design M1 plot share at 1000×557 ≥ 30 %
- **Evidence:** UI check on smart451 (measured values, the M1 snippet output, one screenshot per viewport)
