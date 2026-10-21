# Proposal

## Why

Jan (D-092): „the time frame go to should be date pickers with underlayed data density. the result shall be date and to times and a +1 if days span which is rare. […] stable and clean it shall be." He accepted the UI designer's mocks v1 (`docs/design/declutter/GoTo.dc.html`, placement in `Main.dc.html` and `Compact.dc.html`) and its recommendations: (1) one range button replaces the Go to field, the strip's range text and the window header ranges, a window with link off shows its own range; (2) the Span select goes; (3) presets: that day's drives, Whole day, Whole recording; (4) a range over two or more days shows the full end date, one day a small ⁺¹; (11) calendar weeks start on Monday, English day names.

Jan (D-093), on the result line built for D-092 (4): „passt nicht gut. sekunden braucht niemand. Jahr reicht YY"; „datum viel weniger daten. ehr start YY-MM-DD HH:MM Dauer: HH:MM". Every range reads as its start and its duration (`26-10-13 15:06  0:10`); this supersedes (4)'s ⁺¹ and full end date.

## What Changes

- **Start and duration** (D-093): one formatter for every range, session time and date people read: `26-10-13 15:06  0:10` (YY-MM-DD HH:MM, duration H:MM cut, hours unbounded; under 1 min `26-10-13 15:06:03  41 s`), the duration with a stopwatch icon (`Duration (h:mm)`); no weekday, no end time, no ⁺¹. `declutter-workspace` uses the same formatter.
- **Range button** in the top row, in the slot of the "Go to" field: a fixed-width button (212 px, tabular numbers) that shows the bar target's start and duration. It never reflows when the range changes. A click or `t` opens the picker.
- **Range picker** (popover under the button): a typed field at the top ("Go to", the grammar of today: times, ranges, durations; Enter applies); two calendar months side by side with ‹ › paging, Monday-first weeks, English day names; each day cell underlaid with that day's data density as 12 two-hour bars, drive bars in the accent; a click on a start day and one on an end day; From/To dates (`YY-MM-DD`) and time fields (`HH:MM`); presets (that day's drives as start and duration, Whole day 00:00 – 24:00, Whole recording); a result line with start and duration; Go applies as one range command, Cancel, Esc or a click outside closes without a command.
- **BREAKING (UI):** the Span select (1 s … 1 day) is removed from the top row and its ⋯ menu; typing `10min` and the zoom keys cover it (D-092 (2)).
- **Calendar density route** `GET /api/calendar?dataRef&from&to`: rows per hour and the drives of one window of at most 32 days (one calendar month), always bounded by the window and cut to the scope (D-082), in the request's query class (D-081), cached per scope and window. In a linked session the calendar shows the session's scope only; unlinked it shows the vehicle's months.
- **Own range of an unlinked window:** while "Link time axes" is off, each timeseries window shows its own range as a small text in its header's range slot, as start and duration.
- Docs: `docs/http-api.md` row, `docs/manual.md`, README key table.

## Capabilities

### New Capabilities

- `range-picker`: the range button, the picker popover (typed field, calendar with day density, day selection, time fields, presets, result line, apply and cancel), its behaviour in a scope and a case, and the `/api/calendar` route behind it.

### Modified Capabilities

- `time-navigation`: "Go to" becomes the picker's typed field; `t` opens the picker; span presets removed; targets, history, invalid input and the scope edge name the picker.
- `timeseries-window`: own range of an unlinked window (new); "Option bar", "Linked time zoom" and "Zoom history" name the range button instead of "Go to" and span presets.
- `design-language`: "Controls" measures the range button instead of the Span select and the "Go to" field.

## Out of scope

Owned by the sibling change `declutter-workspace` (D-092): the strip head line (and removing its range text), the window header layout, mode tag and ⋯ menu, removing the header range of linked windows, the session bar, top-row icons and order, the top-row ⋯ overflow, the footer, the legend readout.

Not in this change: arrow-key navigation inside the calendar grid; a live preview of the picked range in the windows before Go; parsing the button's own text (`YY-MM-DD` dates, `H:MM` durations) in the typed field; D-093 texts outside the range button, picker, unlinked header and `declutter-workspace`'s rows (events list, values window, CLI keep their formats); a web or server prefetch of calendar months (fallback F1 if the measurement misses its goal); events or gaps in the calendar; a year or decade view; a time zone other than the browser's; CLI changes (the CLI's time arguments stay as they are).

## Impact

- `packages/shared`: new `calendar.ts` (DTO `CalendarDensity`, constants), exported from `index.ts`.
- `apps/server`: new `calendar.ts` (cache and computation), route `GET /api/calendar` (in `routes/series.ts` next to `/api/density`).
- `apps/web`: new `time/rangeLine.ts` (the one start-and-duration formatter), `time/Duration.tsx`, `time/calendar.ts`, `bar/RangePicker.tsx`, `bar/rangePicker.css`; `bar/OptionBar.tsx`, `bar/bar.css`, `api.ts`, `keys.ts`, `help/hints.ts`, `help/shortcuts.ts`, `App.tsx`, `chart/TimeseriesWindow.tsx` (header own range).
- Docs: `docs/http-api.md`, `docs/manual.md`, `README.md`.
- HTTP: one new route; no existing payload changes.
- Shared files with `declutter-workspace`: `bar/OptionBar.tsx`, `bar/bar.css`, `App.tsx`, `chart/TimeseriesWindow.tsx`; see design R12.
