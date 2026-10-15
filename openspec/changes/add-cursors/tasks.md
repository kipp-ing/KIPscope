# Tasks

Grouped by write area (docs/team.md). Groups 1–3 run in parallel against the interfaces pinned in design.md S1–S5. Group 4 (tester) writes the tests test-first, in parallel. The web tasks have disjoint files:

- 3.1: `chart/cursors.ts`, `chart/TimeseriesWindow.tsx`, `chart/window.css`
- 3.2: `values/*`, `api.ts`
- 3.3: `bar/*`
- 3.4: `App.tsx`, `chart/drag.ts`, `styles.css`, `explorer/SignalExplorer.tsx`

Test names are those the specs cite as evidence. The tasks assume the recommended answers to design "Open questions for Jan" Q1–Q4. Q1 = R2 or R3 would replace 2.1 and change 3.2. Q2–Q4 would each change one function (`drag.ts`, `cursors.ts`, `bar.ts`).

## 1. packages/shared

- [ ] 1.1 In `src/workspace.ts` add `CursorName`, `CursorState`, `ValuesMode`, `ValuesWindow`, `WorkspaceWindow`, `isTimeseries` and `Workspace.cursors` (`EMPTY_WORKSPACE.cursors = {diff: false}`). Have `windowTitle` give "Values <n>" for untitled values windows and `windowUnits` take a `WorkspaceWindow`. Add `window.create.kind` with its refine, the commands `cursor.set`/`cursor.move`/`cursor.remove`/`cursor.setDiff` and the error code `cursor_off`, all exactly as in design S1. Verify `pnpm build` type-checks all packages (web and server compile errors from the union type are fixed in 3.4 and 2.1, not here).
- [ ] 1.2 In `src/apply.ts` implement the kind rules and the cursor commands per design S1, C1 and C6: create a values window; on a values window reject `setRange`, `setHeight` and `setDisplay` with envelope or markers; linked `setRange`, re-link snap and the range of a linked `create` look only at timeseries windows; the unit check applies only to timeseries targets; `moveSignal` without a target from a values window uses the range of `lastZoomed`, else the first timeseries window, else `invalid_range`. Cursor set, move (bounds, `cursor_off`), remove and setDiff. Verify the `apply.test.ts` and `workspace.test.ts` tests of 4.1 pass and the existing ones stay green.
- [ ] 1.3 Add `src/cursor.ts` (`NoValueReason`, `CursorValue`, `CursorValueResult`, `evaluateAt` per the C4 rule table, `formatCursorNumber`) and export it from `index.ts`. Verify `packages/shared/test/cursor.test.ts` from 4.1 passes.

## 2. apps/server/src

- [ ] 2.1 In `routes/series.ts` add `GET /api/value` per design S3: the query schema (`signal`, `t` via `TimeInput`, `mode` default `line`), the 503 check first, then 404, then `before(ref, t + 1n)` and `after(ref, t + 1n)` in parallel with SNA ranges, `evaluateAt`, abort on close, and 502 on source errors. Verify `apps/server/test/value.http.test.ts` from 4.2 passes, and `curl -s 'localhost:7310/api/value?signal=smart451/COMBI_412h.V_ANZ&t=2026-10-13T13:08:00.1435Z' | jq -c .value` prints `{"kind":"interpolated","value":22.5}`.

## 3. apps/web/src

- [ ] 3.1 Cursors in timeseries windows (`chart/cursors.ts`, `chart/TimeseriesWindow.tsx`, `chart/window.css`), per design C3 and S4:
  - `CURSOR_HIT_PX`, `DOUBLE_CLICK_MS`, `snapCursorTime`, `hitCursor`, `ClickGate`.
  - Props `cursors`, `onCursorPreview`, `onCursorCommit`.
  - Overlay lines with A solid, B dashed and flags, inside `u.over` and positioned in the `draw` hook. Hit strips stop `pointerdown` and `mousedown`, and a line drag previews and commits once on release. Esc cancels.
  - Click and Shift+click place A and B through the gate, and `dblclick` drops the pending click.
  - Verify `apps/web/test/cursors.test.ts` from 4.3 passes, plus the UI checks of the `cursors` spec "Cursor lines in every timeseries window", "Placing cursors by click" and "Dragging a cursor line".
- [ ] 3.2 Values window (`values/ValuesWindow.tsx`, `values/format.ts`, `values/loader.ts`, `values/values.css`, and `fetchCursorValue` in `api.ts`), per design C4, C8 and S4:
  - The header has the title (rename in place), the cursor times or "Cursor A off", `Δt` in diff mode, the "Between points" select (linear/hold → `window.setDisplay {mode}`) and Remove.
  - Rows have a grip (`onDragStart` with a `DragSource`), swatch, name, unit, the A cell and, in diff mode, B and Δ cells with tags `lin`/`hold`, the SNA style, `—` with a reason tooltip, neighbour tooltips, per-row errors and remove.
  - Cells are dimmed while `dragging`. Stale responses are dropped, and `onReady` is called per revision.
  - Verify `apps/web/test/values.test.ts` from 4.3 passes, plus the UI checks of the `values-window` spec.
- [ ] 3.3 Option bar (`bar/OptionBar.tsx`, `bar/bar.ts`, `bar/bar.css`), per design C5 and S4:
  - Toggles A, B and Diff; A on sends `cursor.set` at `defaultCursorTime`, off sends `cursor.remove`. A and B are disabled without a timeseries window.
  - "Link time axes", "Back" (disabled without history) and "Reset zoom", whose tooltips name the target while unlinked, and "+ Values window" (`window.create {kind: "values"}`).
  - `barTarget`, `resetSignals`, `defaultCursorTime`.
  - Verify `apps/web/test/bar.test.ts` from 4.3 passes, plus the UI checks "Cursor controls in the option bar", "Option bar" and "Bar zoom back and reset".
- [ ] 3.4 App integration and drag (`App.tsx`, `chart/drag.ts`, `styles.css`, `explorer/SignalExplorer.tsx`), per design C2, C6, C7 and S5:
  - Render the sticky `OptionBar` and remove the top bar's link toggle. Render `ValuesWindow` or `TimeseriesWindow` by kind.
  - `cursorPreview` state with the effective and committed cursors passed down. `onCursorCommit` sends `cursor.set`.
  - Sticky "+ New window" during every drag, and auto-scroll bands below the bar and above the zone.
  - Values rows as drag sources. `canDrop`, `canAdd` and `dropStateFor` take `WorkspaceWindow[]` and skip units for values targets. A values row dropped on "new" without a timeseries window sends create plus move.
  - `onReset(windowId, signalIds?)` for the bar. Kind guards for insets, ranges, Backspace and the linked new-window add.
  - The explorer takes `WorkspaceWindow[]` and lists values windows in "Add to".
  - Verify the `drag.test.ts` tests from 4.3 and all existing drag tests pass, plus the UI checks of the `timeseries-window` delta ("Refused drop targets", "New-window drop zone stays visible", "Auto-scroll while dragging", "Link toggle", "No value readout on hover") and the `values-window` drag scenarios.

## 4. Tests (packages/shared/test, apps/*/test)

- [ ] 4.1 Shared tests:
  - `packages/shared/test/apply.test.ts`: "starts with both cursors off and diff off", "sets, moves and removes cursors" (A at 1791896880093000000, then 1791896880995000000, then off; diff true; one revision each), "rejects moving an off cursor or past the time bounds", "creates a values window without range", "rejects range, height and envelope commands on a values window" (mode `step` accepted), "adds any number of units to a values window", "keeps values windows out of linked ranges", "moves a signal from a values window into a new timeseries window" (range of `lastZoomed` `w3`, line mode, default height; `invalid_range` without a timeseries window).
  - Extend `packages/shared/test/workspace.test.ts` › "titles untitled windows by ID" with `Values 7`.
  - Write `packages/shared/test/cursor.test.ts`: "evaluates raw, interpolated and held values", "returns SNA and no value without inventing one" (all branches of the C4 table, including step holding up to an SNA next point and `next_sna` in line mode), "formats cursor numbers with at most 9 significant digits" (`362.40000000000003` → `362.4`, `0.5000000000000568` → `0.5`, `-5` → `-5`).
- [ ] 4.2 Server tests:
  - Write `apps/server/test/value.http.test.ts` on `testcar/Sna_800h.SPEED`: "evaluates SPEED at points, between points and in SNA runs" (the times and results of the `series-query` delta scenarios, with `at`/`next`), and "answers errors like the series route" (400 for out-of-bounds `t` and `mode=markers`, 404 for an unknown signal, 503 before the first catalog load).
  - Add `apps/server/test/workspace.http.test.ts` › "applies cursor commands over HTTP" (values window create, `cursor.set`, `cursor.move`, `cursor.setDiff`, `cursor.remove`, read back via `GET /api/workspace`).
- [ ] 4.3 Web tests:
  - `apps/web/test/cursors.test.ts`: "snaps cursor times to a power of ten below a thousandth of the span" (1791896881512345678 at a 3 s span → 1791896881512000000), "hits the nearer cursor line within 6 px, B on a tie" (A 100, B 104; 102 → b, 107 → b, 111 → none), "commits a click only after the double-click interval" (fake timers: click then doubleClick within 500 ms → no commit; a lone click → commit after 500 ms).
  - `apps/web/test/bar.test.ts`: "targets the window zoomed last, else the first timeseries window", "resets to the union of all timeseries extents while linked", "places new cursors at a third and two thirds of the reference range" (13:08:00Z–13:08:03Z → 13:08:01Z and 13:08:02Z).
  - `apps/web/test/values.test.ts`: "formats raw, interpolated and held values with their tags", "formats SNA and missing values without a number", "computes Δ only from numeric values and tags it by the weaker kind", "formats Δt exactly with sign" (902000000 → `+902 ms`, −1500 → `-1.5 µs`, 3723500000000 → `+1:02:03.5`, 0 → `0 ns`), "formats cursor times in local time down to nanoseconds" (TZ Europe/Berlin: 1791896880093000000 → `2026-10-13 15:08:00.093`), "discards stale value responses", "reports failed value requests per row".
  - `apps/web/test/drag.test.ts`: "accepts any unit on a values window", "drags a values row like a legend row" (move, Alt copy, fifth unit refused on a timeseries target), "moves and copies legend rows into a values window".

## 5. Integration check (real carserver data)

- [ ] 5.1 The UI user walks through every UI check in `specs/cursors/spec.md`, `specs/values-window/spec.md` and `specs/timeseries-window/spec.md` on `smart451`, 2026-10-13 around 13:08:00Z (V_ANZ, DVL, PTC_HV_Volt) and 09:56:59Z–09:57:01Z (V_ANZ SNA). The setup uses linked and unlinked windows, a values window, six windows for the sticky zone and auto-scroll, and `curl` for exact cursor times. One screenshot per scenario. The revision is read in the top bar where a scenario counts commands.
- [ ] 5.2 Run the `curl` commands named in the specs against the dev server: `/api/value` for V_ANZ at 13:08:00.093Z (`raw` 23), 13:08:00.1435Z (`interpolated` 22.5 and `held` 23 with `mode=step`), 09:57:00Z (`sna`) and 09:56:59.787Z (`next_sna`); the 400 for an out-of-bounds `t`; `GET /api/workspace` cursors after a restart (`{"diff":false}`); the values-window create; and `/api/render-status` after a CLI `cursor.set`.

## Workflow follow-up

- Before the build: the lead asks Jan design Q1–Q4 and updates this change if an answer differs from the recommendation.
- On archive: copy C1 (cursors as workspace state), C4 (value evaluation rule and the resolution answer) and C5 (bar target) into `docs/decisions.md`.
