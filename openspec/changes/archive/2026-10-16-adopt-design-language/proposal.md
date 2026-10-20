# Proposal

## Why

Jan (2026-10-16): „[Suchtool] has a ui too. i want to take over the design language" (D-055). He accepted the mock as shown („accepted right away"): artboards "Workspace" and "Tokens and parts", source `docs/design/Main.dc.html` (its `renderVals()` holds the palettes, accent and density values) and `docs/design/Tokens.dc.html`, with the defaults accent sky `#0284c7`, Okabe-Ito series palette, compact density (12 px) and the time strip on. D-055: restyle only, no behaviour change, except the time strip, which is new.

Today the app uses `--accent #2563eb`, a 14 px base, plain checkboxes for A/B/Diff, a borderless group header and a ten-colour Tailwind-600 series palette (`SIGNAL_COLORS`).

## What Changes

- **Tokens** (`apps/web/src/styles.css` `:root`): slate neutrals, accent sky-600 `#0284c7` with soft `#e0f2fe`, ink `#075985` and ring `#7dd3fc`; status colours emerald / amber / rose, each with a fill; 12 px base, 11 px caps section labels, monospace for signal names, tabular numbers, 4 px radius (pills 999 px), 26 px controls with 1 px slate-300 borders, one dark slate-900 primary per surface.
- **Parts restyled after the mock:** top row (sidebar toggle, option bar; A, B and Diff as pills), explorer (caps label, 30 px search, group headers as slate-100 bands, accent-soft active row), window frame and header (divider, neutral badge, "Add to" pill on the marked window instead of the top accent bar), legend (line swatch, status and SNA share as pills, live label), cursor lines in slate-900, the L line in slate-500, plot grid and ticks, footer as a white band.
- **Series palette:** Okabe-Ito `#0072B2 #E69F00 #009E73 #D55E00 #CC79A7 #56B4E9`, then `#332288 #882255 #999933 #8C564B` (ten as today; yellow `#F0E442` and black left out). The workspace keeps palette indices, so nothing migrates.
- **Time strip (new):** under the option bar, the row count of the shown signal's data ref over its whole recording as up to 120 bars (grey where data exists, accent where the bar overlaps the shown range), with the label `TIME`, the shown range and `<shown> of <recorded> recorded · 1 bar = <width>`. New endpoint `GET /api/density?dataRef=…`, cached on the server per data ref and catalog load.
- Every existing spec number stays met (sidebar 240 px, explorer row ≤ 24 px, group header ≤ 24 px, window header ≤ 24 px, footer one line ≤ 32 px with the 11 px attribution of D-050, plot share ≥ 30 % at 1000×557).

**Out of scope:** mock parts with no app feature behind them (D-055): the "Values" half of the Signals switch, the `ready` legend pill, the mock's signal rows and numbers; the dark "Add <signal> to <window>" button at the explorer foot (no such button exists; D-055 Q1); the brand line and project pill in the sidebar head; L/A/B column headers above the legend; the mock's sidebar width (260–300 px) and plot height (118 px); a dark mode; clicking or dragging in the time strip (jump to a bar is a possible follow-up, not a goal here); bar tooltips; the strip in the CLI; density of single signals; a choice between palettes or accents in the UI; restyling the hover card beyond tokens.

## Capabilities

### New Capabilities

- `design-language`: tokens, type, controls, pills, explorer, window, legend and footer look after the D-055 mock; the series palette; the spec numbers kept.
- `time-strip`: the density endpoint, its bucket widths and cache, and the strip under the option bar (bars, highlight, label, states, screen use).

### Modified Capabilities

- `workspace-layout`: "Marked window" (accent ring frame and "Add to" pill instead of top bar and accent title); "Compact window header" (badge goal: neutral slate-100 fill instead of no fill).

## Impact

- `packages/shared/src`: `workspace.ts` (`SIGNAL_COLORS`), `series.ts` (`Density`), `time.ts` (`DENSITY_WIDTHS`, `MAX_DENSITY_BARS`, `densityWidth()`).
- `apps/server/src`: `datasource.ts`, `clickhouse.ts`, `queue.ts` (two data-ref queries), new `density.ts` (cache), `routes/series.ts` (`/api/density`).
- `apps/web/src`: `styles.css`, `chart/window.css`, `values/values.css`, `bar/bar.css`, `bar/OptionBar.tsx` (pill class), `chart/TimeseriesWindow.tsx` (axis font and colours, pill classes, "Add to" pill), `values/ValuesWindow.tsx` ("Add to" pill), `footer/StatusBar.tsx` (dot), new `time/strip.ts`, `time/TimeStrip.tsx`, `App.tsx` (strip under the option bar), `api.ts`.
- Payloads: one new endpoint; existing ones unchanged. No dependency, no stored data, no migration.
