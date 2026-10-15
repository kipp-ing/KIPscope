# Proposal

## Why

In the efficiency test (docs/feedback/2026-10-15-efficiency-testers.md) all three testers lost most of their time in navigation: getting from the 3-day view to 15:08 took 3–4 zoom rounds (item 1, 3/3, top-ranked by two), Δt/Δv could only be read in a values window (item 2, 3/3), the wheel zoomed instead of scrolling the page (item 4) and numbers came in uneven formats (2, 45, 16.425, 371.075 in one column; item 7, 3/3). Jan decided:

- D-025: „The mouse wheel scrolls the page; Ctrl+wheel or Shift+wheel zooms the chart under the pointer." „Zoom controls: one "Back" and one "Reset" (no duplicate controls in the bar and in each window, no separate "Zoom out")."
- D-026: „Numbers are shown with 3 significant digits everywhere (values window, readouts on charts, axes, hover card, human-readable CLI output); the unit may carry an SI prefix (k, M, m, µ, …), e.g. 13 970 1/min → `14.0 k1/min`. 4 significant digits are an option. Machine output (JSON, API) stays exact."
- D-027: „Time navigation: type a time or range, zoom/pan keys, jump to the data extent, presets." „A/B values and Δt/Δ readout on the chart next to the cursors (the values window stays for many signals)."

## Base and order

- Base: the main specs plus the unarchived changes `add-cursors` and `add-cli`, both built. **Both are archived before this change**; this change's deltas modify requirements those two add (option bar, bar Back/Reset, values window, cursors, CLI).
- **`improve-navigation` is archived before `improve-layout`.** `improve-layout` (collapsible sidebar, tiles side by side, compact window headers, marked window as "Add to" target, auto-remove of emptied windows) is written in parallel. Where both touch a window, this change defines only content: which zoom controls exist and where (bar, not window header), and what the readout row shows. Layout (size, position, collapsing of headers and rows) is `improve-layout`'s. If `improve-layout` modifies a requirement this change also modifies (e.g. values-window "Values window"), its delta must start from this change's text. Agreed with `improve-layout`: the key `s` stays free (sidebar), and this change puts no control in the top bar (which `improve-layout` removes) and no action on a header click (which marks a window there).

## What Changes

- **Wheel (D-025):** a plain vertical wheel over a chart scrolls the page. Ctrl+wheel or Shift+wheel zooms at the pointer; a macOS trackpad pinch arrives as Ctrl+wheel and zooms too. Shift+wheel no longer pans; a horizontal swipe still pans (design N5).
- **One Back, one Reset (D-025):** window headers lose "Back" and "Zoom out". The option bar keeps "Back" and "Reset" (renamed from "Reset zoom"). Backspace and double-click keep working.
- **Time navigation (D-027):** a "Go to" field in the option bar takes a time or range (`15:08`, `2026-10-13`, `15:07:15 +60s`, `15:08 ±30s`, `15:07 .. 15:09`, `a..b`, `1h`, `+10min`); a span select (1 s … 1 day); keys `+`/`-` zoom ×2, `←`/`→` pan half a view, Shift+`←`/`→` a whole view, `Home` jumps to the data extent, `t` focuses the field. All go through `window.setRange` and the zoom history, so "Back" undoes them.
- **Chart readout (D-027):** while a cursor is on, each timeseries window shows per signal the value at A and, in diff mode, at B and Δ = B−A, plus a readout row with the cursor times and Δt; Δt also sits between the cursor flags in the plot. Values come from the drawn data, so they depend on the zoom (D-024: „Concept §6's zoom-dependent cursor value stays for the charts"); aggregated values are tagged `avg`.
- **Number format (D-026):** one shared function prints values with 3 (option: 4) significant digits and an SI prefix on the unit; values window, chart readout, y-axis ticks and the hover card's physical values use it. The 3/4 option is a workspace user option (concept §8) with a command and a CLI form. JSON from the API and the CLI stays exact.

Out of scope (each goes to a later change or is dropped): window layout, header compaction, sidebar, tiles, marked window and auto-removal (`improve-layout`); keyboard paths for "Add to", new window, values window, remove (`W`, `V`); cursor keys (move A/B by key, place at pointer); snapping cursors to raw points; statistics between A and B; CLI navigation forms (zoom by factor, pan, go-to; `window range` covers it); a human text output mode for the CLI (the CLI prints JSON only, so D-026 has no CLI text to format yet); per-signal digit settings; time zone selection; saving the digits option across server restarts (concept §8 persistence); changing the default view of a new window or the initial cursor placement unless Jan picks it (design Q4); the bug "view moved on its own" (engineer tester), the drop-at-the-bottom bug (fixed in `add-cursors`), and `/` focus (fixed).

## Capabilities

### New Capabilities
- `time-navigation`: going to a typed time or range, span presets, navigation keys, their target windows and their place in the zoom history.
- `number-format`: how measured values are printed for people: significant digits, SI prefixes on units, the 3/4-digit option, and exact machine output.

### Modified Capabilities
- `timeseries-window`: wheel scrolls, Ctrl/Shift+wheel zooms, horizontal swipe pans; no zoom controls in window headers; bar "Back"/"Reset" are the only ones; zoom history, linked zoom, bounds and crosshair rules cover keys and typed ranges; option bar gains "Go to", span and digits; y-axis ticks and titles use the number format; the hover rule allows the cursor readout.
- `cursors`: chart readout (values at A/B, Δ, Δt) in timeseries windows, from the drawn data.
- `values-window`: cells use the number format and carry the unit; the separate unit column goes.
- `workspace-state`: the workspace holds user options (digits) and a command sets them.
- `signal-catalog`: the hover card prints physical values (DBC range, SNA values) in the number format.
- `cli`: a `digits 3|4` form.

## Impact

- `packages/shared`: new `src/numfmt.ts` and `src/timenav.ts`; `src/workspace.ts` and `src/apply.ts` (options, `workspace.setOptions`); tests.
- `apps/server`: no source change (commands are validated with the shared schema).
- `apps/cli`: `src/args.ts` (form `digits`), usage text; `test/args.test.ts`.
- `apps/web`: `chart/TimeseriesWindow.tsx`, `chart/zoom.ts`, `chart/cursors.ts`, `chart/window.css`, new `chart/readout.ts`; `bar/*`; `values/format.ts`, `values/ValuesWindow.tsx`, `values/values.css`; `explorer/format.ts`, `explorer/SignalCard.tsx`, `explorer/SignalExplorer.tsx`; `App.tsx`, `keys.ts`; tests.
- No new dependency, no API change.
