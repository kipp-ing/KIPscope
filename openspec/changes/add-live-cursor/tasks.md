# Tasks

Web only (design Non-Goals): no task in `packages/shared`, `apps/server` or `apps/cli`. Group 1's tasks have disjoint files and build in parallel against the interfaces pinned in design L1, L4–L7; group 2 (tester) writes the tests test-first in parallel.

- 1.1: `chart/live.ts` (new), `App.tsx`
- 1.2: `chart/TimeseriesWindow.tsx`, `chart/build.ts`, `chart/window.css`
- 1.3: `values/ValuesWindow.tsx`, `values/loader.ts`, `values/values.css`

The tasks assume the recommended answers to design "Open Questions" (Q1 exact lookup at rest, Q2 no L time, Q3 mean line only, Q4 no tag in the label).

## 1. apps/web/src

- [ ] 1.1 Live store and pure rules (`chart/live.ts` new, `App.tsx`), per design L1, L2, L4, L5, L6:
  - Constants, `LiveCursor`, `LiveStore` (`get`, `subscribe`, `set` coalesced per animation frame, `clear(windowId?)`, counted `suspend()`), singleton `liveCursor`, `useLiveCursor`, `useLiveNear`.
  - `liveTime`, `liveCell`, `nearestSignal`, `liveLabelText`, `labelPosition`.
  - `App.tsx`: `liveCursor.suspend()` beside the row drag's `holdNoSelect()`, released with it.
  - Verify `apps/web/test/live.test.ts` from 2.1 passes (live-cursor "Snapped like a click", "Live value zoomed in", "Live value zoomed out", "Nearest of three", "Label on the speed curve", "Hover over an SNA run", "One update per frame").
- [ ] 1.2 Chart window (`chart/TimeseriesWindow.tsx`, `chart/build.ts`, `chart/window.css`), per design L3, L4, L5, L6, L8:
  - `SeriesSpec.key` (assignment id) in `buildModel`.
  - Pointer flow: `mousemove` → `liveTime`, `chartValueAt` per signal, candidates on each signal's scale, `nearestSignal`, `liveCursor.set`; `mouseleave`, button down and every `hideCursor` call → `clear(w.id)`; `suspend()` beside the line drag's and height drag's `holdNoSelect()`.
  - Store subscription in the chart effect: owner → highlight on `near` change (width 3, others alpha 0.3, one redraw) and the label; other windows → thin L line overlay (no flag, no hit strip, `pointer-events: none`), also placed in the `draw` hook.
  - Legend: L column after A | B | Δ, always present, `LiveCell` per row via `useLiveCursor`, `min-width: 8ch`; row class `live-near` via `useLiveNear`.
  - Verify the existing `apps/web/test/build.test.ts` stays green with `key`, plus the UI checks live-cursor "Hover changes no state", "Live value zoomed in", "Live value zoomed out", "Cursors off, no hover", "Two linked windows", "Outside the other window's range", "Pointer on a curve", "Label on the speed curve", "Hover over an SNA run", "Leave and drag", "Wheel zoom without moving", "No requests while hovering"; cursors "Speed difference on the chart", "A only", "Cursors off".
- [ ] 1.3 Values window (`values/ValuesWindow.tsx`, `values/loader.ts`, `values/values.css`), per design L7:
  - `liveRequests` (keys `${rowId}|l`) and `Rest<T>` in `loader.ts`.
  - `L` header and column after A | B | Δ; a separate `ValueLoader` fed by the rested L time (`LIVE_REST_MS`); cell empty without L, dimmed previous while L moves, `formatCell` else, `—` with `failed: …` on error; the acknowledgement keeps the A/B requests only.
  - Verify `apps/web/test/values.test.ts` › "requests L values only after the pointer rests, apart from A and B" and "keeps L requests out of the render acknowledgement" from 2.2 pass (values-window "Requests only at rest", "Out of the acknowledgement"), plus the UI checks values-window "Live values in the values window", "No hover"; number-format "Label and L cell in four digits".

## 2. Tests (tester)

- [ ] 2.1 `apps/web/test/live.test.ts` (new) with the pinned values of the live-cursor spec: "snaps the live time like a click, inside the shown range"; "evaluates L from the drawn data: raw zoomed in, bucket mean zoomed out" (V_ANZ `23.0`, DVL `180` with "linear between points (lin)", PTC_HV_Volt `363`; aggregated `avg` tooltip; empty cell without L); "reads SNA and gaps without a number and never highlights them" (`SNA`, `—` "outside this window's range", not a candidate); "picks the nearest curve within 8 px, on a tie the later one" (9/3/5 → 2nd; 3/3 → later; 8 → hit; 8.5 → none); "places the label beside the curve point, inside the plot" (right/above, flipped at the right and top edges, text `23.0 km/h`, with 4 digits `362.8 V`); "publishes at most one live time per animation frame" (fake rAF; also `clear(windowId)` drops a queued set of that owner only, `suspend()` ignores sets until released). Verify each fails before 1.1 and passes after.
- [ ] 2.2 `apps/web/test/values.test.ts`: "requests L values only after the pointer rests, apart from A and B" (`Rest` with fake timers: pushes every 50 ms for 1 s → no call; 150 ms after the last → one call; `push(undefined)` at once; `liveRequests` keys `|l`, none without L) and "keeps L requests out of the render acknowledgement" (a failing L request leaves `settled`/`valueErrors` over the A/B requests complete and empty). Verify both pass after 1.3 and `pnpm build && pnpm test && pnpm lint` is green after group 1.

## Workflow follow-up

- The lead shows Jan the design's Open Questions Q1–Q4 (built as recommended); answers become a D-nnn.
- On archive: copy design L1 (browser-local store), L7 (values window L exact at rest) and L8 (when L is hidden) into docs/decisions.md.
