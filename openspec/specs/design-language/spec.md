# design-language Specification

## Purpose
KIPscope's visual language, taken from the existing design language of the search tool (D-055): colour, type and size tokens, the looks of controls, pills, explorer, windows, legend and footer, and the series palette (Okabe-Ito first), with the numbers that keep the workspace dense.

## Requirements

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
- **WHEN** the six-window setup is shown on smart451 at 1440×900 (the sidebar's Events tab opened once to read its heading, then Signals again)
- **THEN** `getComputedStyle` gives: `:root` `font-size` 12 px and `font-variant-numeric` `tabular-nums`; the "Go to" field and the Back button 12 px; the Events tab's "Events" heading (a section label) 11 px, `font-weight` 600, `text-transform` `uppercase`; a window title 12 px, 600; an explorer row name and a legend name 11.5 px with a `font-family` starting `ui-monospace`
- **Evidence:** UI check on smart451 (the computed values)

### Requirement: Controls
Top-row buttons, selects and text fields SHALL be 26 px tall with a 1 px slate-300 border, 4 px radius and white fill; disabled ones a slate-200 border and slate-400 text. The range button SHALL be 26 px tall and 212 px wide. Icon-only buttons (the sidebar button, Back, Reset, "Link time axes", "⋯", "?") SHALL be 26 × 26 px with a 14–16 px stroke icon in slate-700 (pressed: "Cursor toggles as pills"), an `aria-label` and a tooltip; Reset's icon is a fit glyph (two vertical bars at the edges and a double arrow between them, mock `Main.dc.html`), not a fullscreen corner glyph. In the context row the position button and the action buttons SHALL be 24 px tall. The explorer search SHALL be 30 px tall; header controls stay 22 px. With the sidebar open the top row stays one line at 1440×900 and 1000×557. The sidebar button's icon is no exception to slate-700. Origin: D-055 (mock "Controls"); sidebar icon colour: review day 2026-10-28 T-13 (it was slate-900, `--text`); 22 px and one line: `workspace-layout` "Compact window header", "Screen use"; icons: D-092 (mock `Main.dc.html`); fit glyph and 24 px: D-095 (critic 15: the Reset icon read as fullscreen); range button: D-092 (1), (2); 212 px: D-093 (mock `GoTo.dc.html`).

#### Scenario: Control boxes
- **WHEN** a timeseries window is shown, "Back" is disabled (no history) and a catalog is open
- **THEN** "Reset", "Back", "Link time axes", "⋯" and "?" measure 26 × 26 px and Views and the range button 26 px tall (`getBoundingClientRect()`, ±0.5), the range button 212 px wide; the position button measures 88 × 24 px and `Unlink` 64 × 24 px; "Reset" has `border-radius` 4 px, border colour `rgb(203, 213, 225)` and its SVG holds two vertical `line`s (and the arrow's shaft) and two `polyline`s (the fit glyph); "Back" has border colour `rgb(226, 232, 240)` and its icon in `rgb(148, 163, 184)`; the search field is 30 px tall; a window's "⋯" button is at most 22 px tall (the Digits select and the window's mode select left the row and the header in `declutter-workspace`)
- **Evidence:** UI check on smart451 at 1440×900 (the measured values, the Reset SVG's children); `apps/web/test/bar.test.ts` › "renders the top row in order" (Reset's markup holds the fit glyph)

#### Scenario: Icon colour of the sidebar button
- **WHEN** `apps/web/src/styles.css` is read, and on smart451 at 1440×900 the UI user reads `getComputedStyle(…).color` of the sidebar button and of "Reset" (enabled, not pressed) with the sidebar open and closed
- **THEN** the `.option-bar-slot .sidebar-toggle` rule sets `color: var(--label)` (slate-700), not `var(--text)`; in the page both read `rgb(51, 65, 85)` in both states
- **Evidence:** `apps/web/test/designTokens.test.ts` › "sidebar button icon is slate-700"; UI check on smart451 (the two colours per state, one screenshot of the top row's left end)

#### Scenario: One line at both viewports
- **WHEN** the six-window setup is shown with the sidebar open at 1440×900 and at 1000×557
- **THEN** every control of the top row has the same `getBoundingClientRect().top` (±1 px) in each viewport; goal, measured and reported but not pass/fail: top row ≤ 36 px tall (`workspace-layout` "Compact bars")
- **Evidence:** UI check on smart451 (tops and height per viewport, one screenshot each)

### Requirement: One primary per surface
A surface (explorer, top row, a window, the footer) SHALL show at most one primary button, drawn slate-900 with white text; pressed toggles and the selected tab of a tab switch (the sidebar's `Signals | Events`) are not primary buttons. This change adds no primary button. Origin: D-055 (mock "Controls": „one dark primary per surface"); no new button: D-055 („restyle only").

#### Scenario: At most one primary per surface
- **WHEN** the six-window setup is shown with A, B and Diff on
- **THEN** in the explorer, the top row, each window and the footer, at most one `button` that is not a pressed toggle or selected tab (`aria-pressed`, `aria-expanded`, `aria-selected` or a checked pill) has background `rgb(15, 23, 42)`
- **Evidence:** UI check on smart451 (a snippet counting such buttons per surface, its output)

### Requirement: Cursor toggles as pills
A, B and Diff SHALL be toggle buttons 26 px tall, at least 30 px wide, 4 px radius, with unchanged behaviour, tooltips and keys (accent focus ring, Space switches). Every toggle SHALL use one pressed style: fill sky-100 `#e0f2fe`, 1 px border sky-300 `#7dd3fc`, ink sky-700 `#0369a1` (text weight 600, icon stroke): A, B and Diff while on, "Link time axes" while on, the position button while its list is open and the checked item of the catalog list's `ALIGN` group. Released, a toggle looks like any top-row control (white, slate-300 border, slate-700 ink). The sidebar button SHALL show its icon in slate-700 on white in both states, its state in `aria-expanded` and its tooltip. Origin: D-055 (mock option bar); icon toggles: D-092 (mock `Main.dc.html`); one pressed style: D-095 (critic 9: three solid slate-900 pills were the heaviest marks on screen while Link used a sky tint).

#### Scenario: Pills on and off
- **WHEN** A is on, B off and Diff off; then the user presses Tab until A's toggle has focus and presses Space
- **THEN** first A's toggle has background `rgb(224, 242, 254)`, border colour `rgb(125, 211, 252)` and text `rgb(3, 105, 161)`, B's and Diff's background `rgb(255, 255, 255)` and border `rgb(203, 213, 225)`, each 26 px tall with `border-radius` 4 px; after Space, A is off (the A line is gone, revision +1) with B's look, and the focused toggle shows an accent outline
- **Evidence:** UI check on smart451 (computed values, screenshot before and after Space); `apps/web/test/bar.test.ts` stays green

#### Scenario: Signals toggle
- **WHEN** the sidebar is open and "Link time axes" is on, then the user presses `s` and clicks "Link time axes"; then a catalog is open and the user opens its list
- **THEN** the sidebar button has `aria-expanded="true"`, then `"false"`, with the same box (±0.5 px); "Link time axes" has background `rgb(224, 242, 254)` and its icon stroke `rgb(3, 105, 161)` while pressed, white and `rgb(51, 65, 85)` after the click, `aria-pressed` `"true"` then `"false"`; the open list's position button and its checked `ALIGN` item have background `rgb(224, 242, 254)` and ink `rgb(3, 105, 161)`
- **Evidence:** UI check on smart451 (computed values and boxes in each state)

### Requirement: Explorer look
The explorer SHALL open with the 26 px segmented switch `Signals | Events` (12 px, slate-300 frame, 4 px radius, the selected tab slate-900 with white text, the signal count after the label), panel headings such as "Events" being section labels; group headers slate-100 bands, 4 px radius, 3 px below the group above, darker under the pointer; rows indented under their header; the active row or header in the accent soft fill and ink; the row "+" slate-400, accent under the pointer. Behaviour unchanged; rows and headers ≤ 24 px. Origin: D-055 (mock "Pills and list", sidebar); 24 px: `signal-catalog`, `signal-groups`; the switch replaced the "Signals" heading: add-events V8, D-092 (mock `Main.dc.html`).

#### Scenario: Bands and active row
- **WHEN** the explorer of smart451 shows the empty search with `Engine` expanded and the arrow keys put the active row on its second signal
- **THEN** every `.group-head` has background `rgb(241, 245, 249)`, `border-radius` 4 px and height ≤ 24 px; the active row has background `rgb(224, 242, 254)` and its name colour `rgb(7, 89, 133)`; every row is ≤ 24 px tall and its name's left edge lies right of its header's name's left edge
- **Evidence:** UI check on smart451 at 1440×900 (computed values and rects, one screenshot)

### Requirement: Window look
Every window SHALL be a white tile with a slate-200 border and 6 px radius; its 24 px header line holds a slate-100 bottom divider, the title in 12 px weight 600 slate-800 and, right-aligned before "⋯", the mode tag as plain 11 px muted text (slate-500) without fill or border. The plot grid SHALL be slate-200, tick labels and tick marks slate-700 at 11 px. Origin: D-055 (mock window); 24 px: `workspace-layout` "Compact window header"; mode tag without a pill: `workspace-layout` "Compact window header" (D-092, declutter-workspace DW11); slate-700 ticks: D-095 (critic 11, `timeseries-window` "Axis titles").

#### Scenario: Header and mode tag
- **WHEN** a timeseries window on smart451 shows `ICL_3A2h.SPEED_DISP` aggregated
- **THEN** its `.window-header` is ≤ 24 px tall with a bottom border colour `rgb(241, 245, 249)`; the window's border colour is `rgb(226, 232, 240)` and radius 6 px; the `.mode-tag` has `font-size` 11px, colour `rgb(100, 116, 139)`, a transparent background and no border
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
The restyle SHALL keep every size other specs set for the page: sidebar 248 px (208 px below 1200 px viewport width, workspace-layout "Collapsible sidebar"), explorer rows and group headers ≤ 24 px, window headers ≤ 24 px, footer ≤ 32 px (two lines ≤ 48 px), A | B | Δ | L in a 485 px values window, default plot 280 px, plot share ≥ 30 % at 1000×557 with the sidebar open. Origin: necessary consequence of D-055 („restyle only"); the numbers and their specs: design T9; sidebar width: D-095.

#### Scenario: Numbers re-measured
- **WHEN** the six-window setup and one values window 485 px wide are shown on smart451, at 1440×900 and at 1000×557 with the sidebar open
- **THEN** sidebar 248 px at 1440×900 and 208 px at 1000×557 (±1), every explorer row and header ≤ 24 px, every `.window-header` ≤ 24 px, footer ≤ 32 px, the values window shows A, B, Δ and L uncut, a fresh window's plot 280 px (±1), and the design M1 plot share at 1000×557 ≥ 30 %
- **Evidence:** UI check on smart451 (measured values, the M1 snippet output, one screenshot per viewport)

### Requirement: Selected row look
A selected explorer row SHALL show a 3 px accent bar on its left edge (`box-shadow: inset 3px 0 0 var(--accent)`) and its name in the accent ink, with its fill unchanged, so the accent soft fill stays the mark of the active row alone; a row both active and selected shows both. Rows stay ≤ 24 px. Origin: lead default L1 (selected style per the design language, active style distinct); tokens: D-055.

#### Scenario: Selected and active rows apart
- **WHEN** on smart451 at 1440×900 the user types `speed`, clicks `WSPD_FL` and Shift-clicks `WSPD_RL`
- **THEN** `WSPD_FR` (selected, not active) has a computed `box-shadow` containing `rgb(2, 132, 199) 3px 0px 0px 0px inset`, a transparent background and name colour `rgb(7, 89, 133)`; `WSPD_RL` (selected and active) has the same bar and background `rgb(224, 242, 254)`; `WSPD_RR` (neither) has neither; every row is ≤ 24 px tall
- **Evidence:** UI check on smart451 at 1440×900 (computed values, one screenshot)

### Requirement: Gap band look
The web app SHALL define the token `--gap-fill` `#f1f5f9` (slate-100) on `:root` and paint logger gap bands with it, opaque, without border or hatching, and draw the gap text `no data` in readout and value cells in `--muted`, not in the SNA style. Origin: D-062 („a faint grey band"); token rule: design-language "Design tokens" (D-055).

#### Scenario: Computed look
- **WHEN** on smart451 at 1440×900 a window shows the band of "Band in a drive" and A is inside it
- **THEN** `getComputedStyle(document.documentElement)` gives `--gap-fill` `#f1f5f9`; the band's pixels read `rgb(241, 245, 249)` where no grid line or curve crosses; the A cell `no data` has `color` `rgb(100, 116, 139)`
- **Evidence:** UI check on smart451 (computed values, one screenshot)

### Requirement: Flash look
A flashing window (`data-flash`) SHALL start with a 3 px accent-ring outline and an accent-soft fill and fade to its normal look within 1.2 s, moving nothing; under `prefers-reduced-motion: reduce` it SHALL show the outline without animation. A marked window keeps its mark after the flash. Origin: Jan 2026-10-17 („outline highlighted or so"); tokens D-055; reduced motion: necessary consequence (accessibility).

#### Scenario: Flash on a new window
- **WHEN** a new window appears through an explorer add and its rect is read at once and 1.5 s later
- **THEN** right after the add its `animation-name` is `window-flash`; 1.5 s later it has no `data-flash`, and its `getBoundingClientRect()` is the same at both reads (±0.5 px)
- **Evidence:** UI check on smart451 (computed values, rects, one screenshot during the flash)

#### Scenario: Reduced motion
- **WHEN** Chrome emulates `prefers-reduced-motion: reduce` and a window flashes
- **THEN** its `animation-name` is `none` and its `box-shadow` contains `rgb(125, 211, 252) 0px 0px 0px 3px` while `data-flash` is set
- **Evidence:** UI check on smart451 (computed values); if the automation cannot emulate the media feature, `not_run` with the stylesheet rule quoted

### Requirement: Help panel look
The help panel SHALL be white with a slate-200 left border, the heading "Help" (13 px, weight 600, slate-800), the tabs Manual and Keys as a 26 px segmented switch (active slate-900, white text) and a × button; keys SHALL be `kbd` elements (slate-100 fill, 1 px slate-300 border, 4 px radius, 11 px monospace). It adds no primary button. Origin: D-055 (tokens, pills, section labels); design H7.

#### Scenario: Panel look
- **WHEN** the Keys tab is open on smart451
- **THEN** the panel's background is `rgb(255, 255, 255)` and its left border colour `rgb(226, 232, 240)`; the active tab's background is `rgb(15, 23, 42)`; a `kbd` has background `rgb(241, 245, 249)`, border colour `rgb(203, 213, 225)`, `border-radius` 4 px and a `font-family` starting `ui-monospace`
- **Evidence:** UI check on smart451 (computed values, screenshot)

### Requirement: Start card look
The start card SHALL be a white tile at most 640 px wide with a slate-200 frame, a 6 px radius and a 3 px accent left bar. Its heading SHALL be 13 px weight 600, its four steps a numbered list, and its "Manual" and "Keys" buttons normal 26 px controls. It SHALL add no primary button. Origin: D-055 (window tile look); design H7.

#### Scenario: Card look
- **WHEN** the start card shows on smart451 at 1440×900
- **THEN** its width is ≤ 640 px, `border-left` is 3 px `rgb(2, 132, 199)`, the other borders `rgb(226, 232, 240)`, `border-radius` 6 px, and its buttons are 26 px tall
- **Evidence:** UI check on smart451 (computed values, screenshot)

### Requirement: Layout never moves
A control or text slot SHALL keep its box while its content changes (loading, a step, a zoom, a cursor move, a live update): widths for the longest text of their format, tabular figures, loading drawn inside the loaded box, overlong text cut with `…`, whole in its tooltip. Boxes change only with viewport, sidebar, grid or a control added or removed; the layout probe (design DW1) checks it. Except a legend's first step after a cold load (D-096). Origin: D-092; Jan: „stable and clean it shall be".

#### Scenario: Probe during a step
- **WHEN** at 1440×900 with the sidebar open, the case workspace of design DW24 shows the six-window setup with A on and every legend row shows its display name and `[unit]` (known metadata, DW24), the UI user starts the layout probe of design DW1 and presses `]`, waits until the progress line is gone, and stops the probe
- **THEN** every element the probe watches (each top-row control, the sidebar, each context-row slot, the strip and its end slots, each window's mode tag, "⋯" and legend header cells, the footer's status and attribution) moved and resized by at most 1 px, also when the target session lacks a shown signal (its row then reads `missing`)
- **Evidence:** UI check on smart451 at 1440×900 (probe output, a screenshot of the legend before the step showing names with units). Not part of this scenario: the first step after a cold load at a session without data for a shown signal (raw name, no unit until then); it moves the legend columns once, accepted as rare by D-096 (backlog: signal metadata per data ref)

#### Scenario: Tabular numbers in slots
- **WHEN** the computed `font-variant-numeric` is read of the session position, the duration slot, the strip's end slots, the window's mode tag, the legend's header and value cells and the sidebar tab counts
- **THEN** each contains `tabular-nums`
- **Evidence:** UI check on smart451 (the snippet and its output)
