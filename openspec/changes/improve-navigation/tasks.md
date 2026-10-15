# Tasks

Grouped by write area (docs/team.md). Groups 1–3 build in parallel against design S1–S5; group 4 (tester) writes the tests test-first in parallel. `apps/server` has no source task (design Non-Goals). The web tasks have disjoint files:

- 3.1: `values/format.ts`, `values/ValuesWindow.tsx`, `values/values.css`, `chart/readout.ts` (new), `explorer/format.ts`, `explorer/SignalCard.tsx`
- 3.2: `chart/TimeseriesWindow.tsx`, `chart/zoom.ts`, `chart/cursors.ts`, `chart/window.css`
- 3.3: `bar/OptionBar.tsx`, `bar/bar.ts`, `bar/bar.css`
- 3.4: `App.tsx`, `keys.ts`, `explorer/SignalExplorer.tsx`, `styles.css`

The tasks assume the recommended answers to design "Open questions for Jan". Q1 = R2/R3 changes 3.2 only; Q8 = browser preference drops 1.3 and 2.1; the other questions change one pure function each.

Precondition: `add-cursors` and `add-cli` are archived first (proposal "Base and order").

## 1. packages/shared

- [x] 1.1 Add `src/numfmt.ts` with `takesPrefix`, `formatQuantity` and `formatAxisTicks` exactly as design S1, N7 (round unscaled first, then shift by the prefix) and N8; export from `index.ts`. Verify `packages/shared/test/numfmt.test.ts` from 4.1 passes (number-format "Pinned values", "Four digits", "Prefixed and prefix-free units"; timeseries-window "Pinned ticks").
- [x] 1.2 Add `src/timenav.ts` with `MIN_SPAN_NS`, `navAnchor`, `resolveTimeNav`, `zoomAround`, `panBy`, `spanAround` per design S2 and N2 (forms, period of the last digit, latest occurrence in the view, `..` and ` – `, `a`/`b`, `d` = 24 h, errors via `parseTime`/`parseDuration` messages, clamping); export from `index.ts`. Verify `packages/shared/test/timenav.test.ts` from 4.1 passes (time-navigation "Range forms", "Header text pasted back", "Date of a time of day", "Bad inputs", "Zoom in around A", "Keys on a 4 s view").
- [x] 1.3 In `src/workspace.ts` and `src/apply.ts` add `Digits`, `WorkspaceOptions`, `Workspace.options` (`EMPTY_WORKSPACE.options = {digits: 3}`) and the command `workspace.setOptions` per design S3. Verify the `apply.test.ts` case "sets the digits option and rejects other values" from 4.1 passes, the existing ones stay green, and `pnpm build` type-checks (web compile errors from the new field are fixed in 3.4).

## 2. apps/cli

- [x] 2.1 In `src/args.ts` add the form `digits 3|4` → `{"type":"workspace.setOptions","digits":N}` (other values: usage error naming `3|4`) and the line in the `--help` usage. Verify `apps/cli/test/args.test.ts` › "maps every command form to its command" and `apps/cli/test/cli.test.ts` › "sets the digits option over HTTP" from 4.1 pass (cli "Digits option command").

## 3. apps/web/src

- [x] 3.1 Number display (`values/format.ts`, `values/ValuesWindow.tsx`, `values/values.css`, `chart/readout.ts`, `explorer/format.ts`, `explorer/SignalCard.tsx`), per design N4, N7, N9 and S4:
  - `formatCell`/`deltaCell` take `unit` and `digits` and print via `formatQuantity`; tag `avg`; reasons `empty_bucket`, `outside_range`; neighbour tooltips stay `formatCursorNumber`.
  - Values window: prop `digits`; cells carry the unit; the unit column goes.
  - `chart/readout.ts`: `ReadoutValue`, `chartValueAt`, `readoutCell`, `readoutDelta`.
  - Hover card: prop `digits`; DBC range and SNA values via `formatQuantity`; scaling and raw step unchanged.
  - Verify `apps/web/test/values.test.ts`, `readout.test.ts` and `explorer.test.ts` from 4.2 pass, plus the UI checks values-window "Raw point under the cursor", "Between points, linear and hold", "Speed difference", "No unit column", number-format "Rounded cell, exact tooltip", signal-catalog "Card with offset", "Prefixed SNA value".
- [x] 3.2 Chart window (`chart/TimeseriesWindow.tsx`, `chart/zoom.ts`, `chart/cursors.ts`, `chart/window.css`), per design N1, N3, N8, N11 and S4:
  - `wheelAction` and the wheel handler: plain wheel passes to the page, Ctrl/Shift zoom (pinch included, `preventDefault` only then), horizontal swipe pans.
  - Header: remove "Back" and "Zoom out" and the props `canGoBack`/`onBack`.
  - y-axis tick labels and titles via `formatAxisTicks` with `digits`.
  - Readout: props `digits`, `diff`; A/B/Δ cells in the legend rows from `chartValueAt` with the effective cursors; the readout row above the legend rows; the Δt label via `deltaLabelX`.
  - Crosshair hidden after every change of the shown range until the pointer moves.
  - Verify `apps/web/test/zoom.test.ts` and `cursors.test.ts` from 4.2 pass, plus the UI checks timeseries-window "Scroll past a chart", "Header controls", "Narrow voltage range", "Five ticks out", "Leave and zoom", "Pan and Zoom out", cursors "Speed difference on the chart", "A only", "Cursors off", "Times and Δt", "Nothing over the curves", "Same as the values window in a raw view", "Aggregated overview", "Follows a dragged line", "SNA and outside the range", "Wide and narrow gap".
- [x] 3.3 Option bar (`bar/OptionBar.tsx`, `bar/bar.ts`, `bar/bar.css`), per design S4 and N11:
  - Order: A, B, Diff, Link time axes, "Go to" field (`id="go-to"`, Enter calls `onGoTo`, invalid state and message on error, text kept and selected on success, tooltip names the target while unlinked), span select from `SPAN_PRESETS` (`onSpan`), Back, "Reset", digits select (`workspace.setOptions`), "+ Values window".
  - Verify `apps/web/test/bar.test.ts` stays green, plus the UI checks timeseries-window "Scrolled down", "Linked reset", "Unlinked back", time-navigation "Minute from the extent view", "Bad inputs", "One day around the view", "Unlinked go to", number-format "Switch to four digits".
- [x] 3.4 App and keys (`App.tsx`, `keys.ts`, `explorer/SignalExplorer.tsx`, `styles.css`), per design N6 and S5:
  - `navKey`, `NavRepeat`; `navigate` with `pendingNav` and history push; `onGoTo`, `onSpan`; one keydown listener for the navigation keys (target under the pointer, else `barTarget`; `Home` = reset for that target; `t` focuses `#go-to`).
  - Pass `digits` to timeseries windows, values windows and the explorer, `diff` to timeseries windows; drop `canGoBack`/`onBack` on windows.
  - Verify `apps/web/test/keys.test.ts` from 4.2 passes, plus the UI checks time-navigation "Keys on a 4 s view", "Home", "Keys in a text field", "Focus the field", "Linked keys", "Back through typed and key steps", "Held key", timeseries-window "Zoom out forty times", "Two steps back", workspace-state "Browser reload", number-format "Same value, same text", "Set from the CLI".

## 4. Tests (tester)

- [x] 4.1 Shared, server and CLI tests: `packages/shared/test/numfmt.test.ts` (4 tests), `packages/shared/test/timenav.test.ts` (5 tests), `packages/shared/test/apply.test.ts` › "sets the digits option and rejects other values", `apps/server/test/workspace.http.test.ts` › "applies the options command over HTTP", `apps/cli/test/args.test.ts` (digits case) and `apps/cli/test/cli.test.ts` › "sets the digits option over HTTP", with the pinned values of the specs. Verify each fails before 1.x/2.1 and passes after; `pnpm test` green.
- [x] 4.2 Web tests: `apps/web/test/zoom.test.ts` › "classifies wheel events: plain scrolls, Ctrl or Shift zooms, horizontal swipe pans"; `keys.test.ts` › "maps navigation keys outside text fields", "joins auto-repeat steps to one history entry"; `readout.test.ts` (4 tests named in the cursors spec); `cursors.test.ts` › "places the Δt label between the flags or beside the right one"; `values.test.ts` › "formats values with the digits option and the unit" and the updated expectations of the existing tests (`23.0 km/h`, `500 mV lin`, …); `explorer.test.ts` › "formats scaling, raw step and DBC range" updated (`-40.0 … 214 °C`, `8.19 k1/min`). Verify `pnpm build && pnpm test && pnpm lint` green after group 3.

## Workflow follow-up

- Jan answers design "Open questions for Jan" before the first round; the lead records them (D-nnn).
- Archive order: `add-cursors`, `add-cli`, then this change, then `improve-layout`. On archive copy N2, N3, N7 and N10 into docs/decisions.md.
