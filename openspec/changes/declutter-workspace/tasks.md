# Tasks

Web only. Every interface two tasks share is pinned in design.md (DW3 context row and classes, DW4 pending step, DW5 slots, DW9 footer, DW11 header and menu, DW12 legend headers, DW13 missing, DW14 tabs, DW18 hints), so all build tasks of groups 1–8 can run in parallel; an engineer stubs a pinned import until its task lands. The tester writes group 9 test-first from the specs. `App.tsx` is one write area: 8.1 and 8.2 run one after the other.

Write areas (disjoint per task):

- 1.1: `apps/web/src/case/sessionBar.ts`
- 1.2: `apps/web/src/case/SessionBar.tsx`, `apps/web/src/case/case.css`
- 2.1: `apps/web/src/bar/` (`OptionBar.tsx`, `OverflowMenu.tsx`, `bar.css`)
- 3.1: `apps/web/src/chart/build.ts`, `apps/web/src/window/` (`WindowMenu.tsx`), header part of `chart/TimeseriesWindow.tsx`, `chart/window.css`
- 3.2: `apps/web/src/chart/readout.ts`, legend part of `chart/TimeseriesWindow.tsx` (after 3.1, same file)
- 3.4: header part of `chart/TimeseriesWindow.tsx` (after 3.1)
- 3.3: `apps/web/src/chart/loader.ts`, `apps/web/src/chart/axes.ts`, `apps/web/src/api.ts` if the error code is lost there
- 4.1: `apps/web/src/time/TimeStrip.tsx`, `time/strip.css`, `time/stripGeometry.ts`, `time/strip.ts`
- 4.2: `apps/web/src/time/ScopeRow.tsx` (new), `time/scope.ts`
- 5.1: `apps/web/src/footer/`
- 6.1: `apps/web/src/explorer/` (`tabs.ts` new, `SignalExplorer.tsx`)
- 6.2: `apps/web/src/values/`
- 7.1, 7.2: `apps/web/src/help/hints.ts`, `docs/manual.md`
- 8.1, 8.2: `apps/web/src/App.tsx`, `apps/web/src/ack.ts`, `apps/web/src/styles.css`
- 9.x: tests as listed; 10.x: UI user and lead

D-093 and D-094 arrived after round 1. The session bar, scope row, catalog list and strip tooltips use `add-range-picker`'s `startDuration` and `DurationTag` (its tasks 3.1, 3.5; stub until they land). 9.4 is unticked because "Tooltip text" and "Label with a scope" changed; 7.2 and 9.7 are new; 1.1, 1.2, 4.1, 4.2 and 9.1 (open) are reworded. 6.1 stays ticked: "Count line" changed only in its UI part (`V_ANZ` instead of `WSPD_FL`, which smart451 lacks).

## 1. apps/web/src/case

- [ ] 1.1 Pure slot model (DW4, DW5, DW6): `sessionSlots` with `start`, `duration`, `timesTooltip` (no `weekday`, `times`, `plusOne`), `timesSlot` from `startDuration`, `pendingTarget`, `positionCh`; `CatalogRow` with `position`, `name`, `start`, `duration` (`catalogRowText` and `sessionBarText` removed). Verify: scenarios "Bar text", "Pending step slots", "Across midnight and days", "Row columns" (`sessionBar.test.ts`).
- [ ] 1.2 Session bar row (DW3, DW6, DW7): `SessionBar` renders `.context-row` with the pinned slot classes, skeletons when `caseState` is undefined or a pending target is not in the catalog, `.session-progress` while `progress`, the open note inside `.slot-title`, `Unlink`/`Link` in `.slot-action`; `.slot-times` 116 px with the start, `.slot-duration` 60 px with `DurationTag`; `CatalogList` rows in the grid `28px 1fr 116px 60px` (duration in `DurationTag`) and the `Align` radio group, `AlignMenu` removed; `case.css` grid with fixed widths, tabular numbers, the compact container query (threshold measured and written as a comment). Verify: scenarios "Skeleton before the workspace", "Align in the list", "Note in the bar", "Head with a catalog" (`sessionBar.test.ts`).

## 2. apps/web/src/bar

- [ ] 2.1 Top row (DW0, DW8): order `Views | .range-control | Back Reset Link | A B Diff · Share… ⋯`; Back, Reset as icon buttons with `aria-label`; "Link time axes" as `button[aria-pressed]`; the range control (Go to and Span today) wrapped in `span.range-control`; Digits and "+ Values window" only in the "⋯" menu, Share… in the row above its re-measured threshold and in the menu below (comment in `bar.css`); "⋯" always shown with `aria-label` `More`. Verify: scenario "Order in the row" (`bar.test.ts`), "Share in the row when there is room" (UI, 10.2).

## 3. apps/web/src/chart and window

- [ ] 3.1 Window header (DW11): `span.mode-tag` in its fixed slot from `resolutionBadge` with `tagWidth`; display select and Min/max removed from the header; `windowMenuItems` and `WindowMenu` with display items (`window/WindowMenu.tsx`), values windows without them. Verify: scenarios "Short badge" (`build.test.ts`), "Display from the menu" (`windowMenu.test.ts`), "No reflow on zoom" (UI, 10.3).
- [x] 3.4 Linked header without range (DW0; deferred by the pacer until `add-range-picker`'s range button shows the range): `span.range` only while link is off. Verify: scenario "Range read once" (UI, 10.3).
- [ ] 3.2 Legend header row (DW12, DW15): `legendHeaders` in `readout.ts`; `li.legend-head` as the first grid row of `ul.signals` with fixed cursor column widths and truncation; next-step hint in its name cell; `.readout-row` removed. Verify: scenarios "Header helper", "Times and Δt" (`readout.test.ts`), "Columns hold still" (UI, 10.3).
- [x] 3.3 Missing signals (DW13): `loadStatusText` → `missing` for 404 `unknown_signal` in and outside a case, `isMissing`, no retry; muted pill; `AxisInput.missing` leaves the signal out of `layoutAxes`; `sourceCell` reads `—` with `HINTS.missing`; make sure the API error's code reaches the loader state. Verify: scenarios "Status and axes" (`loader.test.ts`, `axes.test.ts`, `readout.test.ts`).

## 4. apps/web/src/time

- [ ] 4.1 Strip as one row without head (DW10, DW19, DW4; D-094): head removed, props `sessionBar` and `onOpenEvents` gone, `stepping` added (loading state until the new density); `STRIP_PX` 28 in every state; bars, `stripBars`, `barTitle` removed; `presence` runs and breaks (logger gaps through `gapInfoStore`/`useGapInfo`), drives 5 px slate-600 (accent in the shown range, none while linked), pins at y 2–9, cursor lines and `flagXs` flags as buttons whose click centres the view (pin-click path); `stripLabel` without `1 bar =`; `driveTitle` and `caseMarkTitle` with `startDuration`; states and drop text in `.time-strip-note`. Verify: scenarios "Presence of a track", "Flag positions", "Flag click", "Tooltip text" (`stripGeometry.test.ts`), "Label with a scope" (`strip.test.ts`), "Data ref of the strip" stays green, "Geometry", "Zones", "Pin zones", "Drive geometry", "Marker positions", "Pin geometry" stay green; UI in 10.4.
- [ ] 4.2 Scope row (DW3, DW17): `ScopeRow` with the context-row classes (`SCOPE`, ref, `timesSlot` start, duration in `DurationTag`, Widen, Clear in full mode), `SCOPE_HINTS.info(span)` without `Each bar is` (DW18), hidden arrow and position placeholders; the Widen/Clear sending logic moves here from `TimeStrip`. Verify: scenario "Head with a catalog" (`sessionBar.test.ts`), "Scope on smart451" (UI, 10.4).

## 5. apps/web/src/footer

- [x] 5.1 Footer (DW9): `statusTooltip`; `footerItems` without build and without ok source/catalog items; `RANK_BUILD` removed; `StatusBar` shows `connected`/`disconnected` with the dot colour rule and the tooltip; fit order unchanged otherwise. Verify: scenarios "Order in the bar", "Items from meta", "ADX and other kinds", "Unhappy states", "Stale and missing meta", "Drop order", "Message beats meta", "Measurement outlives automatic items", "Hidden items in the tooltip", "User item", "Tooltip lines" (`footer.test.ts`).

## 6. apps/web/src/explorer and values

- [x] 6.1 Sidebar tabs (DW14): `explorer/tabs.ts` `sidebarTabs`; counts on the Signals and Events tabs with titles; the count line removed; `SignalExplorer` prop `eventsTab`. Verify: scenarios "Tab count" (events), "Count line" (guidance) (`sidebar.test.ts`).
- [x] 6.2 Missing values row (DW13): `valueRowStatus` in `values/format.ts`, used by `ValuesWindow` for the row status and cells. Verify: scenario "Missing row" (`values.test.ts`).

## 7. apps/web/src/help and the manual

- [x] 7.1 Hints (DW18): the entries listed in DW18; wording rule W1. `docs/manual.md`: words for the moved controls (sidebar icon, Back/Reset icons, link toggle, Digits and "+ Values window" in "⋯", session bar slots and Align in the list, events count on the tab, mode tag, display mode in the window menu, legend header row), headings unchanged. Verify: `hints.test.ts` › "keeps every hint within the wording rule", "takes every tooltip from the hints table"; `manual.test.ts` stays green.

- [ ] 7.2 Hints and manual for D-093 and D-094 (DW18): `HINTS.stripInfo(recorded)` (presence line, no bars), `HINTS.stripFlag(name, clock, outside)`; `docs/manual.md`: session bar and catalog list read start and duration (no +1, no weekday), the strip is one row with the presence line, gaps, drives, pins and A/B flags that bring a cursor into view, no bars (strip info without `1 bar =`, glossary "drive"). Verify: `hints.test.ts` › "keeps every hint within the wording rule" (the `stripFlag` samples); `grep -n "1 bar\|Each bar\|under the bars\|+1" docs/manual.md` prints nothing; `manual.test.ts` stays green.

## 8. apps/web/src root (App.tsx, ack.ts, styles.css)

- [ ] 8.1 Rows and pending step (DW3, DW4, DW7): `.top-area` renders top row, context row (`SessionBar` for a case or an opening `/open#cases=` page, else `ScopeRow` for a scope, else nothing) and `TimeStrip`; `pending`/`progress` state set in `caseCommand` via `pendingTarget`, cleared on refusal or `Acknowledger.onRendered` of the result's revision (new in `ack.ts`); `TimeStrip stepping={progress}`; the open sets `openNote` only (no `caseOpenEvents` in the message line). Verify: scenarios "Pending step slots" (unit, 1.1), "One notice for case texts and warnings", "Report carried across the page load" (`workspaces.test.ts`), "Step on smart451", "Probe over steps" (UI, 10.1).
- [ ] 8.2 Top-row and sidebar wiring (after 8.1, same file): sidebar icon button with `aria-label` `Hide sidebar`/`Show sidebar`; `helpTail` row only ("?" never in "⋯"); `SignalExplorer eventsTab` from the strip's events; `TimeStrip` without `onOpenEvents`. Verify: scenarios "Toggle by button", "Top row still one line" (UI, 10.2), "Key s" (`sidebar.test.ts` stays green).

## 9. Tests (tester, test-first)

- [ ] 9.1 `apps/web/test/sessionBar.test.ts`: "fills the session slots" (replaces "describes the session"), "shows the step target at once", "renders skeletons in the same slots", "gives start and duration across midnight and days" (replaces "marks a session crossing midnight"), "fills the catalog row columns", "puts the align modes into the catalog list", "renders the context row for a case, a scope or neither"; update "shows the open report in the session bar" (note inside `slot-title`) and "shows open warnings with the case notice" (no message-line notice); "filters the catalog list", "steps with brackets", "greys the arrows while unlinked", "messages after a step", "clears a case message on the next command" stay green.
- [x] 9.2 `apps/web/test/bar.test.ts` › "renders the top row in order"; `apps/web/test/windowMenu.test.ts` (new) › "offers display mode and min/max in the menu"; `apps/web/test/build.test.ts` › "gives a short badge and the full resolution as tooltip" (new texts, `tagWidth` cases).
- [x] 9.3 `apps/web/test/readout.test.ts` › "heads the legend columns with the cursor times", "reads an unknown signal as missing"; `apps/web/test/loader.test.ts` › "reads an unknown signal as missing" (fetch fails with the real `ApiRequestError` of a 404 body); `apps/web/test/axes.test.ts` › "leaves missing signals out of the axes"; `apps/web/test/values.test.ts` › "reads an unknown signal as missing".
- [ ] 9.4 (unticked for D-094: the strip parts changed; footer and sidebar parts stay green) `apps/web/test/stripGeometry.test.ts` › "formats drive tooltips" (replaces "formats bar and drive tooltips"), "draws data presence with breaks at empty buckets and logger gaps", "places the cursor flags, B right of a near A", "centres the view on a clicked cursor flag"; `apps/web/test/strip.test.ts` › "labels the shown and recorded spans", "labels the shown span within the scope" (no `1 bar =`; "sizes and marks the bars" removed); `apps/web/test/footer.test.ts`: the updated scenarios of app-footer and "puts revision, source, catalog and build into the status tooltip"; `apps/web/test/sidebar.test.ts` › "shows the events count on the tab", "counts the signals on the tab".
- [x] 9.5 `apps/cli/test/cli.test.ts` › "prints the open report" (no CLI code change expected); `apps/web/test/workspaces.test.ts` › "shows a dropped catalog's report after the page load" updated to the note.
- [ ] 9.7 `apps/web/test/hints.test.ts` samples for `HINTS.stripFlag` (inside and outside the view) and the reworded `HINTS.stripInfo`.
- [x] 9.6 Run `pnpm build && pnpm test && pnpm lint`; report per file.

## 10. Checks outside the suite (UI user on smart451, lead)

- [ ] 10.1 Session bar: "Bar on smart451", "Step on smart451", "Probe over steps" (DW1 probe at both sizes), "Align on smart451", "Note on smart451", "Dropped file on smart451", "CLI open reports in its output" (browser part), "Probe during a step".
- [ ] 10.2 Top row and sidebar: "Toggle by button", "Top row stays one line", "Share in the row when there is room", "Overflow menu by keyboard", "Top row still one line", "Control boxes", "One line at both viewports", "Signals toggle", "Idle strip", "Compact bars", "Count line", "Count on smart451".
- [ ] 10.3 Windows: "No reflow on zoom", "Range read once" (after 3.4), "Long title", "Narrow window", "Header height", "Remove by menu", "Close without a command", "Columns hold still", "Times and Δt", "A only", "Cursors off", "Hints retire", "Step to a vehicle without the signal on smart451", "Tabular numbers in slots", "Coverage in the app", "Tooltips on smart451".
- [ ] 10.4 Strip and footer: "Strip on real data", "Strip states", "Screen use with the strip", "Presence on smart451", "20 min on smart451", "Pointer shapes", "Jump on smart451", "Brush on smart451", "Fit a drive on smart451", "Tooltip under the window", "Markers on smart451", "Pins on smart451", "Scope on smart451", "Footer on smart451", "Narrow viewport"; lead: "Tunnel drop on real data", "Refetch on reconnect", "Default on".

## Workflow follow-up

- Lead: ask Jan on the defaults DW15 (hints in the legend header), DW16 (`missing`), DW17 (scope in the context row) before or at the demo; for D-093/D-094 the defaults: tooltips carry `detail` (start to the second and long duration), drives hidden in a linked session (mock), the flag tooltip wording of DW18 (the mock's `· click: …` breaks the hints' key rule).
- Archive after `add-range-picker` or before it; the second rebases the shared requirements of DW0.
