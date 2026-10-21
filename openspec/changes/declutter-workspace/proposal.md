# Proposal

## Why

Jan's hand checks: the workspace is crowded, and controls jump while a session loads (D-092: „its so crowded … the ui placements move on text size and ziggag while reloading. stable and clean it shall be"). The UI designer measured one `]` step moving the session text width 372 → 728 → 646 → 407 px and the `k / n` button by up to 355 px; the title changes about 1 s before the range; at 1000 px the strip's range label collapses to 0 px; the window's mode badge (`part · 1 s` / `agg · 536.8 ms`) changes width and pushes the header. Jan accepted all eleven recommendations of the designer's mocks v1 (`docs/design/declutter/Main.dc.html`, `Compact.dc.html`, `SessionBar.dc.html`): „i follow your recommendatins. they look good."

After round 1 Jan decided two more things this change takes over before it is archived. D-093: „datum viel weniger daten. ehr start YY-MM-DD HH:MM Dauer: HH:MM": every session time reads as start and duration (`26-10-13 15:06  0:10`), no weekday, end time or ⁺¹. D-094: „die timeline ist sehr wichtig für events. weniger wichtig, wenn wir session basiert arbeiten […] die balken wirken aktuell komisch"; „density would be just strip or no strip? thats probably good enough. and a/b labels should be on the strip to jump back to it": the strip becomes one row with a presence line, drives, events, the shown range and A/B flags (mock `Strip.dc.html`, row "Recommended").

## What Changes

- **Layout never moves** (D-092): fixed slots, tabular numbers, a loading state in the loaded state's box, truncation with a tooltip. One measurable check, the layout probe (design DW1), pins it for a `]` step, a window zoom and the strip loading.
- **Session bar** becomes its own row above the strip (the "context row"), slots at fixed positions: `‹ k / n ▾ ›` grouped on the left, title (truncates, tooltip), start (116 px, `26-10-13 15:06`), duration with a stopwatch (60 px, `0:10`; D-093), Unlink or Link in one 64 px slot. Kind and meta go into the title's tooltip (the list keeps them). Align moves into the `k / n ▾` list (D-092 (5), supersedes D-089/K14's bar layout). A step shows the target's text from the catalog at once with a 2 px progress line and the strip as a skeleton. First open shows skeletons in the same slots; a session over midnight or days is just more hours (D-093, no `⁺¹`); a compact row drops the `SESSION` label. The catalog list shows position, name, start and duration in fixed columns (D-093). The scope head (`SCOPE … Widen Clear`) uses the same row and slots.
- **Open-report note** sits inside the title slot and shows only in the session bar (D-092 (6), supersedes D-091's bottom-bar notice for it); its lifetime stays (until ✕ or the next accepted step, go or unlink). A CLI open reports in the CLI's output only.
- **Top row**: sidebar toggle as an icon, Views, the range control, Back and Reset as icons, "Link time axes" as an icon toggle next to the range control, A / B / Diff, then Share, "⋯" and "?". Digits and "+ Values window" always in "⋯" (D-092 (7), supersedes D-071's width rule for them); Share moves into "⋯" at compact width.
- **Strip as one row** (D-094): 28 px in every state; data presence as a 3 px line with breaks at empty buckets and logger gaps (no density bars or area), drives in slate (none in a linked session), the events lane, the shown range in the accent, and A/B flags (buttons) whose click centres the view on that cursor. Server unchanged: `/api/density` and `/api/gaps` feed it.
- **Strip head line dropped**: its info (`6.2 min of 12.8 min in scope · 1 bar = 10 s`, `Loading recording…`) becomes the strip's tooltip; the events count moves onto the Events tab; the strip's range text goes (the range control shows it).
- **Window header**: no range text while linked; the mode tag in a fixed slot with a stable format (`agg 1 s`, `part 1 s`, `raw`); the display mode and Min/max move into the window's "⋯" menu (D-092 (9)).
- **Readout row merged** into the legend's column headers (`A 15:09:12.000`, `B …`, `Δt …`; D-092 (10)); the next-step hints of D-072 move into the same header row (default, Jan can veto).
- **Sidebar**: the explorer's hint sentence goes; the count moves onto the Signals tab, the sentence into its tooltip.
- **Footer**: revision, source, signal count and commit go into the status dot's tooltip (D-092 (8), supersedes D-050's items); connected, measurement (name, object, meta), zone, the signed-in user and the attribution stay; an unreachable source or a failed catalog stays visible.
- **Missing signals**: a signal the shown vehicle lacks reads `missing` (muted, tooltip names the vehicle) in the legend and values rows, and adds no y axis, instead of the red `failed: unknown_signal: …`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `case-navigation`: session bar slots and row (start and duration, D-093), stepping shows the target at once, skeletons, catalog list columns with Align, align from an event.
- `case-handoff`: open report only in the session bar's title slot; the CLI open reports in its output.
- `time-strip`: one 28 px row, data presence line instead of bars (bars removed), drives, pins and cursor flags in fixed lanes, flags jump to their cursor, no head line, info as tooltip, states inside the track, scope row, events count removed from the strip.
- `events`: events count on the Events tab.
- `workspace-layout`: top row and status strip, icon sidebar toggle, compact window header, header truncation, window menu.
- `timeseries-window`: option bar order, link toggle as an icon, missing signals.
- `values-window`: missing signal in a values row.
- `cursors`: readout in the legend's column headers.
- `guidance`: next-step hints in the legend header, tooltip coverage and texts, explorer count on the tab, help in the row.
- `saved-views`: overflow menu content.
- `app-footer`: status tooltip, items and drop order.
- `design-language`: layout never moves, controls, icon toggles.

## Out of scope

- Owned by `add-range-picker` (specced in parallel): the range button that replaces the Go to field (its slot in the top row), the picker and its presets, dropping the Span select, the per-day density API, and what a window with link off shows as its own range. This change refers to "the range control" and leaves those requirements (`time-navigation`, timeseries-window "Header shows the plotted range", "Header range in milliseconds") to it.
- The mock's `Event…` align item in the catalog list (illustration; the list keeps the Align items of today).
- The start-and-duration formatter itself (`add-range-picker` implements it, D-093); D-093 texts outside this change's rows (events list, values window, CLI).
- A new help text or manual chapter beyond updating the words that name moved controls.
- Any change in `packages/shared`, `apps/server` or `apps/cli` code: no type, route or payload changes.
- The private search tool's side (D-090).

## Impact

- `apps/web/src`: `case/` (session bar slots, pending step, list Align, note), `bar/` (top row order, icons, overflow), `chart/` (header, mode tag, window menu, legend headers, missing state), `time/` (strip without head as one 28 px row: presence line, drives, pins, cursor flags; scope row, tooltips, loading state), `footer/` (status tooltip, items), `explorer/` (tab counts), `events/` (count source), `window/` (menu items), `values/` (missing row), `help/` (hints, manual words), `App.tsx` (rows, pending step, wiring).
- `docs/manual.md`: names of moved controls.
- HTTP, CLI, shared types: unchanged.
