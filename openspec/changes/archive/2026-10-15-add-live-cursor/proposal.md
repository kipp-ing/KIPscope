# Proposal

## Why

Values can only be read at the committed cursors A and B, so reading a value somewhere else means placing a cursor, and comparing windows means placing it once for all of them. Jan decided (D-032):

> „now additional to abdiff courser we need a life value. where the mous is. with values for each window so a 4th value. and when mouse ist near one signal this signal shall be highlited and the x aligned value shown."

D-032 in full: „besides A and B a live cursor "L" follows the mouse. It is local to the browser (no command, no revision, not in the CLI). Every chart legend gets a 4th column L with each signal's value at the pointer time; while one window is hovered, the other timeseries windows show a thin L line at the same time and fill their L column; without a hover L is empty. The L value comes from the drawn data (raw points zoomed in, bucket value zoomed out, kind as tooltip), like a dragged line under D-031. A signal whose curve is within about 8 px vertically of the pointer (nearest wins) is highlighted: thicker line, others faded, its legend row marked, and a label at the curve shows its value at the pointer's x. The values window also gets an L column (lead's pick for the open "values window?" point, from "values for each window"). Supersedes D-023's "no value readout on hover"."

## What Changes

- **Live cursor L (D-032):** while the pointer is over a timeseries plot, the time under it (snapped like a click that places A) is the live time L. It lives in the browser tab only: no command, no revision, no render acknowledgement, no CLI form.
- **L column in chart legends:** every timeseries window's legend rows get a 4th value column L after A | B | Δ, filled from the window's drawn data at L (raw value zoomed in, bucket mean zoomed out, kind as tooltip), empty while nothing is hovered. No server request per pointer move.
- **L line in the other windows:** while one window is hovered, every other timeseries window whose shown range contains L draws a thin L line there; the hovered window shows its crosshair.
- **Near-signal highlight:** in the hovered window, the signal whose curve at the pointer's x lies within 8 px vertically of the pointer (nearest wins) is drawn thicker, the others faded, its legend row is marked, and a label at the curve point shows its value with SI prefix and unit.
- **L column in the values window:** the values window gets an `L` column with each signal's exact value at L in its "Between points" mode, looked up once the pointer rests (design L7).
- **REMOVED:** timeseries-window "No value readout on hover" (D-032 supersedes D-023's rule).

Out of scope (not in D-032): L in the CLI or workspace state; Δ or Δt between L and A/B; an L time readout (design Q2); placing A/B from L by key; highlight driven by the legend (hovering a legend row); highlight in windows other than the hovered one; snapping L to raw points; a tooltip box listing all signals at the pointer; touch input; persisting L across reloads.

## Capabilities

### New Capabilities
- `live-cursor`: the browser-local live time under the pointer, its line in the other windows, the L column in chart legends, the near-signal highlight with its label, when L is shown or hidden, and its performance bounds.

### Modified Capabilities
- `cursors`: "Readout cells in the legend" gains the L column after A | B | Δ, also while A and B are off.
- `timeseries-window`: "No value readout on hover" is removed (D-032).
- `values-window`: the table gets an `L` column with the exact value at L; L lookups stay out of the render acknowledgement.
- `number-format`: "One format in every human-readable place" adds the L cells and the highlight label.

## Impact

- `apps/web/src`: new `chart/live.ts` (store, nearest signal, label placement); `chart/TimeseriesWindow.tsx`, `chart/window.css` (pointer, L line, highlight, label, legend column); `values/ValuesWindow.tsx`, `values/loader.ts`, `values/values.css` (L column, rested lookup); `App.tsx` (suspend L during a signal drag).
- Tests: new `apps/web/test/live.test.ts`; additions to `apps/web/test/values.test.ts`.
- No change in `packages/shared`, `apps/server` or `apps/cli`; no API change, no new dependency.
