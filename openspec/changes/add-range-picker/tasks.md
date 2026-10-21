# Tasks

Every interface two tasks share is pinned in design R2 (DTO), R4 (route), R5–R9 (web helpers), R10 (`RangePicker` props, `fetchCalendar`) and R11 (OptionBar props), so all build tasks can run in parallel; an engineer stubs a pinned import until its task lands. The tester writes group 4 test-first from the specs. Web tasks of this change and of `declutter-workspace` never run in the same round (design R12).

Write areas (disjoint):

- 1.1: `packages/shared/src/calendar.ts` (new), `index.ts`
- 2.1: `apps/server/src/calendar.ts` (new)
- 2.2: `apps/server/src/routes/series.ts`
- 3.1: `apps/web/src/time/rangeLine.ts` (new), `apps/web/src/time/calendar.ts` (new)
- 3.2: `apps/web/src/bar/RangePicker.tsx` (new), `apps/web/src/bar/rangePicker.css` (new), `apps/web/src/api.ts`
- 3.3: `apps/web/src/bar/OptionBar.tsx`, `bar/bar.css`, `keys.ts`, `help/hints.ts`, `help/shortcuts.ts`, `App.tsx`
- 3.4: `apps/web/src/chart/TimeseriesWindow.tsx` (and its header CSS)
- 3.5: `apps/web/src/time/Duration.tsx` (new)
- 4.x: tests as listed per task
- 5.1: `docs/http-api.md`; 5.2, 5.3: `docs/manual.md`, `README.md`

D-093 (start and duration) arrived after round 2: 3.1, 4.3 and 4.4 are unticked because their scenarios changed ("Range lines" became "Start and duration texts"; "Draft to range", "Presets of a day" and the new "Day tooltip" and "Field text" changed); 3.5 and 5.3 are new. `declutter-workspace` imports `startDuration` and `DurationTag` from 3.1 and 3.5 (design R6, R12), so 3.1 and 3.5 go first.

## 1. packages/shared

- [x] 1.1 `calendar.ts` with `CALENDAR_GRID_NS`, `CALENDAR_HOUR_NS`, `CALENDAR_SPAN_MAX_NS`, `MAX_CALENDAR_WINDOWS` and `CalendarDensity` exactly as design R2, exported from `index.ts`. Verify: `pnpm --filter @kipscope/shared build`.

## 2. apps/server/src

- [x] 2.1 `calendar.ts`: `CalendarCache` (R3): window cut to the scope, empty cut without a source call, one `refBuckets` at 60 s with the window as scope, `hours` from `from`, `findDrives` with edges cut, shared promise, failures dropped, LRU 12, `loadedAt` per scope, the starting request's class raised by joiners. Verify: scenarios "Cache", "Interactive class".
- [x] 2.2 Route `GET /api/calendar` in `routes/series.ts` (R4): query schema and refinements, `routeScope`, `out_of_scope`, `unknown_data_ref`, `source_error`, access `DENSITY_ACCESS`, one `CalendarCache` per app sharing `loadedAt` with the density cache. Verify: scenarios "One month of drivecar", "Errors", "Scope on testcar", "Unlinked case", "Scoped mode".

## 3. apps/web/src

- [ ] 3.1 Pure helpers (R5–R9), reworked for D-093: `time/rangeLine.ts` (`startDuration` and `StartDuration` replace `rangeLine` and `RangeLine`; `formatDuration`, `ownRangeText` returning `StartDuration`, `rangeButtonEmpty`) and `time/calendar.ts` (`dayTip` with `YY-MM-DD`, `draftRange` error `Time as hh:mm`, `dayDrives` labels `03:00  0:30`, new `fieldText`; the rest as built). Verify: scenarios "Start and duration texts", "Draft from a range", "October 2026", "Paging bounds", "Bars of a day", "Bar heights", "Day tooltip", "Two clicks", "Field text", "Draft to range", "Presets of a day", "Own range text".
- [ ] 3.2 `bar/RangePicker.tsx` and `bar/rangePicker.css` (R10 props and layout): typed field, month titles with ‹ ›, two 6-row grids with day cells, bars, tooltips, disabled days, legend and hint, chip line (chips with `DurationTag`), From/To with `YY-MM-DD` dates (60 px) and 56 px fields showing `fieldText` until edited (R7 `edited`), result line from `startDuration` with `DurationTag`, Cancel and Go; Esc, outside pointer-down, Enter in a time field; loading and failure states in the same box; `fetchCalendar` in `api.ts`; the module cache of answers. Verify: scenarios "Open on smart451", "Fits and keeps its size", "Calendar on smart451", "Slow and failing source".
- [ ] 3.3 Top row and keys (R11): the range button (R6 box, 212 px, calendar icon, `startDuration` date and time, `DurationTag`, `detail` tooltip, disabled and `…` states) in the Go to slot; `HINTS.duration`; Span select removed from the row and the ⋯ menu; `t` opens the picker with "Go to" focused and selected; no navigation key while open; `onApply` as one `window.setRange` with one history entry; typed Enter via `onGoTo` closes on success and shows the reason in the result line on failure; hints and shortcuts texts. Verify: scenarios "Button text", "No reflow", "No timeseries window", "Go and Back", "Cancel, Esc and keys", "Minute from the extent view", "Bad inputs", "Focus the field", "Unlinked go to", "Scrolled down", "Control boxes".
- [ ] 3.4 Own range of an unlinked window (R13) in the header's range slot: `ownRangeText(…).text`, `detail` as tooltip. Verify: scenarios "Own range text", "Two unlinked windows".
- [ ] 3.5 `time/Duration.tsx` (R6): `DurationTag` with the stopwatch icon and `title={HINTS.duration}` (stub the entry until 3.3 lands). Verify: `apps/web/test/rangeLine.test.ts` › "renders the duration with its icon and tooltip" (static markup holds `svg.duration-icon`, the text and `title="Duration (h:mm)"`).

## 4. Tests

- [x] 4.1 `packages/shared`: none new (the DTO is types and constants); `pnpm --filter @kipscope/shared build` passes.
- [x] 4.2 Server: `apps/server/test/calendar.http.test.ts` › "counts drivecar rows per hour and finds its drives on the minute grid", "answers 400, 404, empty windows and 502", "cuts the window to the scope and skips an empty cut"; `apps/server/test/calendar.test.ts` › "computes once per window and catalog load, shares, drops failures and the least recent", "runs in the request's class"; `objectScope.http.test.ts` › "answers the calendar of a month while unlinked"; `scope.http.test.ts` › "bounds the calendar by the scope in scoped mode"; `docs.test.ts` › "documents every HTTP route" stays green with the new row.
- [ ] 4.3 Web (reworked for D-093): `apps/web/test/rangeLine.test.ts` › "gives start and duration", "cuts to the second and below a minute" (replace "formats a range on one day", "marks the next day, midnight and later days", "shows milliseconds cut"), "renders the duration with its icon and tooltip" (new), "names the button state without a range" (unchanged), "shows a window's own range only while unlinked" (new text); "cuts parts and drops a zero lower part" stays.
- [ ] 4.4 Web (reworked for D-093: new "shows filled times to the minute"; new expectations in "words the day tooltip with rows, drives and the reason for no rows", "turns the draft into a range or a reason", "lists the day's drives and names the whole span"; the others unchanged): `apps/web/test/rangePicker.test.ts` › "drafts the shown range", "shows filled times to the minute", "lays out a month Monday first", "pages only towards data", "sums local two-hour bars and marks drives", "scales bar heights by decades", "words the day tooltip with rows, drives and the reason for no rows", "picks a start and an end day", "turns the draft into a range or a reason", "lists the day's drives and names the whole span", "keeps the picker usable while the calendar loads or fails" (the fetch state helper or a rendered picker with held and failing `fetchCalendar`).
- [x] 4.5 Web: `apps/web/test/keys.test.ts` › "ignores navigation keys while the range picker is open"; existing "maps navigation keys outside text fields" and "joins auto-repeat steps to one history entry" stay green; `bar.test.ts` and `hints.test.ts` updated for the removed Span hint.

## 5. Docs

- [x] 5.1 `docs/http-api.md`: row `GET /api/calendar` (workspace, `dataRef`, `from`, `to`; rows per hour and drives of one window ≤ 32 d for the range picker; range-picker spec). Verify: `docs.test.ts` › "documents every HTTP route".
- [ ] 5.3 `docs/manual.md` (D-093): the range button reads start and duration (`26-10-13 15:06` and `0:12`, the stopwatch is the duration in h:mm, under a minute seconds), no +1 and no `24:00:00`; From/To take `hh:mm`. Verify: `grep -n "+1\|24:00:00\|Tue 2026" docs/manual.md` prints no line about the range button.
- [x] 5.2 `docs/manual.md` (top row: range button instead of Go to and Span; the picker: calendar, density bars, presets, From/To, Go/Cancel; `t`; unlinked windows show their own range) and `README.md` key table (`t` opens the range picker; the Span presets row removed). Verify: `grep -n "Span" docs/manual.md README.md` prints no line about a Span select.

## 6. Checks outside the suite

- [ ] 6.1 UI user on smart451 at 1440×900 and 1000×557: the manual checks of design "Manual checks" (one screenshot per scenario, rects where the scenario names them).
- [ ] 6.2 Lead: "Cost on carserver" (four `curl` times against their goals; a result over twice its goal goes to Jan with F1/F2) and "Slow and failing source".
