# Design

## Context

D-092: Jan accepted the UI designer's mocks v1 (`docs/design/declutter/`), among them the range picker (`GoTo.dc.html`, interactive) and its placement in the top row (`Main.dc.html`, `Compact.dc.html`: a 318 px button right after Views, before Back, Reset, Link). Facts this design rests on:

| # | Fact | Where |
|---|---|---|
| 1 | "Go to" is a text field in `OptionBar.tsx`; Enter calls `onGoTo(text)`, which resolves with `resolveTimeNav` against the bar target and answers an error text or `undefined` | `apps/web/src/bar/OptionBar.tsx:33-37, 245-270`; `App.tsx:874-900` |
| 2 | The Span select sits in the row and in the ⋯ menu (`spanSelect(inMenu)`) | `OptionBar.tsx:132-150, 271, 297` |
| 3 | `t` maps to `goTo` (focus the field) | `apps/web/src/keys.ts:84`; `App.tsx:958` |
| 4 | `/api/density` answers ≤ 120 bars over the recording or scope; with `from`/`to` a window cut to the scope; in an object scope a window of ≤ 32 d is required (`workWindowOf`) and without one the answer is coarse with no drives | `apps/server/routes/series.ts:305-344`; `apps/server/src/objectScope.ts:104-122`; `apps/server/src/density.ts` |
| 5 | Its bar width for 31 days is 12 h (62 bars), its grid 108 s: useless for 2-hour day bars | `densityWidth`, `driveGrid` in `packages/shared` |
| 6 | Drives: runs of grid buckets ≥ 1/10 of the peak, gaps ≤ 60 s merged, kept if > 2 min | `packages/shared/src/drives.ts` |
| 7 | The strip's first density on carserver took 9.2 s (whole smart451 recording) | D-055 Q4 |
| 8 | Tests run with `TZ=Europe/Berlin`; local time helpers use the runtime zone | `packages/*/package.json`; `packages/shared/src/localtime.ts` |
| 9 | `wholeRange(density)` gives the strip double-click's range (first to just after last, up to the next ms) | `apps/web/src/time/stripGeometry.ts:372` |
| 10 | `formatSpan(ns)` gives the short span (`12.5 min`) | `apps/web/src/time/strip.ts:85` |

## Goals / Non-Goals

**Goals:** the picker and button of the mock, a calendar density that respects scope (D-082), query classes (D-081) and the 32-day bound (D-089), no reflow anywhere (D-092), and every shared interface pinned so server, web and tests build in parallel.

**Non-Goals:** the proposal's "Out of scope"; everything `declutter-workspace` owns (R12).

## Decisions

### R1: What this change owns

The range button (in the slot of "Go to"), the picker, removing the Span select, `GET /api/calendar`, and the own range of an unlinked window. The strip head's range text and the header range of linked windows are removed by `declutter-workspace`; until it lands they stay as they are. This change defines only what an unlinked window shows (R13).

### R2: Shared DTO (pinned, new `packages/shared/src/calendar.ts`, exported from `index.ts`)

```ts
import type { Drive } from "./series.ts";

/** Grid of the calendar's bucket query and drive search (R3). */
export const CALENDAR_GRID_NS = 60_000_000_000n;
/** Resolution of `hours`. */
export const CALENDAR_HOUR_NS = 3_600_000_000_000n;
/** Widest window of one request: WORK_SPAN_MAX_NS (32 d, D-089). */
export const CALENDAR_SPAN_MAX_NS = 32n * 86_400_000_000_000n;
/** Windows the server keeps per cache (LRU). */
export const MAX_CALENDAR_WINDOWS = 12;

/** GET /api/calendar answer (spec range-picker "Calendar density"). Decimal ns strings. */
export interface CalendarDensity {
  dataRef: string;
  /** The asked `from` and `to`, unchanged (not cut to the scope). */
  from: string;
  to: string;
  /** hours[i] = rows in [from + i h, min(from + (i+1) h, to)); length ceil((to − from) / 1 h). */
  hours: number[];
  /** Drives in [from, to) ∩ scope on the 60 s grid (time-strip rule), edges cut to the scope; [] when none. */
  drives: Drive[];
  /** Present while the workspace has a scope (object scopes too): where rows may lie. */
  scope?: { from: string; to: string };
}
```

Query: `GET /api/calendar?dataRef=<ref>&from=<time>&to=<time>`, `<time>` as `/api/density` takes it (ISO-8601 or decimal ns; the web sends decimal ns).

### R3: Server computation (pinned, new `apps/server/src/calendar.ts`)

- Window W = `[from, to)` ∩ scope (no scope: `[from, to)`). Empty W: answer zeros, `drives: []`, no source call.
- One call `source.refBuckets(dataRef, CALENDAR_GRID_NS, false, {dataRef, from: W.from, to: W.to})`; never without the scope argument, so full mode stays bounded by the window. No `refExtent`.
- `from` is a multiple of 60 s, so every grid bucket lies in one hour slot: `hours[floorDiv(b.start − from, 1 h)] += b.count`; buckets outside `[from, to)` are dropped.
- `drives = findDrives(buckets, CALENDAR_GRID_NS)`, edges cut to W (as `computeScoped` does).
- Cache `CalendarCache`, modelled on `DensityCache`: key `scopeCacheKey(scope)` or the data ref, plus `from to`; `loadedAt(scope)` as the density's; shared promise, failures dropped, LRU `MAX_CALENDAR_WINDOWS`; the query runs in the starting request's class, raised by joiners (`Priority`, as the density).
- Why one hour, not two: local 2-hour bars start at local even hours, which are odd UTC hours in CET; the web sums hours into local bars (R5). Why not `/api/density` with a width parameter: its bars, grid and drives are tied to the ≤ 120-bar rule (a month gives 12 h bars and a 108 s grid, fact 5); a separate small DTO keeps both contracts simple.
- Fallbacks if "Calendar cost" is more than twice its goal (for Jan): **F1** after the strip's density prefetch, the server computes the calendar months of the scope (or of the recording's last month) in the `background` class; **F2** grid 120 s (22,320 buckets per month, drive edges ±2 min).

### R4: Route (pinned, `apps/server/src/routes/series.ts`)

Registered next to `/api/density` with `{ config: { access: DENSITY_ACCESS } }`. Zod query `{dataRef: string.min(1), from: Time, to: Time}`, refined: `to > from`, `to − from ≤ CALENDAR_SPAN_MAX_NS`, both `% 60 s == 0` → else 400 `invalid_request`. `routeScope` as `/api/density` (gives 409 `scope_required` in scoped mode without a scope); a data ref other than the scope's 409 `out_of_scope`; without a scope and a loaded catalog that lacks the ref 404 `unknown_data_ref`; source failure 502 `source_error`. No `no_data`: an empty window answers zeros. In an object scope no separate work-window check is needed: the span rule is the same 32 d.

### R5: Day bars (pinned, new `apps/web/src/time/calendar.ts`)

```ts
export interface CalendarDay {
  date: string;      // "2026-10-13", local
  weekday: string;   // "Tue"
  day: number;       // 13
  from: bigint;      // local midnight
  to: bigint;        // next local midnight
}
export const DAY_BARS = 12;
export const DAY_BAR_MAX_PX = 12;
export const DAY_BAR_MIN_PX = 2;
export const DAY_BAR_DECADES = 4;

/** Local month (1–12): its first local midnight and the next month's. */
export function localMonth(year: number, month: number): { from: bigint; to: bigint };
/** 42 cells, Monday first; null outside the month. */
export function monthCells(year: number, month: number): (CalendarDay | null)[];
/** Bar k covers [day.from + 2k h, day.from + (2k+2) h), the last one up to day.to (1 h or 3 h on DST days).
 *  count = sum of answer.hours whose slot start lies in the bar; drive = a drive overlaps the bar (half-open). */
export function dayBars(answer: CalendarDensity, day: CalendarDay): { count: number; drive: boolean }[];
/** 0 → 0; else clamp(round(12 × (1 + log10(count / max) / 4)), 2, 12). */
export function dayBarHeight(count: number, max: number): number;
/** Rows of the day (sum of its bars) and the drives overlapping it, for the tooltip. */
export function dayTip(answer: CalendarDensity | undefined, day: CalendarDay, scope: ScopeKind): string;
export type ScopeKind = "none" | "scope" | "session" | "object";
```

`max` is the largest bar of all days of both shown months. Bar colour: `drive` → accent `#0284c7`, else slate-400 `#94a3b8`; on the start and end day white (drive) or `rgba(255,255,255,0.65)` (mock). Tooltip: `Tue 2026-10-13 · 74.5 M rows · 2 drives` (rows with the strip tooltip's number format; `1 drive`), `· no data`, `· outside the session` (linked catalog), `· outside the scope` (plain scope). Disabled: a day with 0 rows once its month answered; while a month loads or failed, the days inside the scope are enabled.

### R6: Range line and button (pinned, new `apps/web/src/time/rangeLine.ts`)

```ts
export interface RangeLine {
  date: string;      // "Tue 2026-10-13"
  from: string;      // "15:06:03" or "15:08:00.093"
  to: string;        // "15:18:33", "24:00:00", "01:52:43"
  plusOne: boolean;  // end on the next local date (not at its midnight)
  endDate?: string;  // "Thu 2026-10-15" when the end lies ≥ 2 dates later
  text: string;      // "Tue 2026-10-13 15:06:03 – 15:18:33" ("⁺¹" appended when plusOne; endDate before `to`)
  duration: string;  // long: "12 min 30 s"
  short: string;     // formatSpan: "12.5 min"
}
export function rangeLine(from: bigint, to: bigint): RangeLine;
/** < 1 s: formatSpan; < 1 min: seconds cut to ms, zeros dropped ("1.5 s"); < 1 h: "M min S s"; < 1 d: "H h M min"; else "D d H h"; a zero lower part dropped; parts cut, never rounded up. */
export function formatDuration(ns: bigint): string;
/** linkTime ? undefined : rangeLine(range.from, range.to).text */
export function ownRangeText(range: { from: bigint; to: bigint }, linkTime: boolean): string | undefined;
/** The button's text without a range: "No time window" (no timeseries window) or "…" (state not loaded yet). */
export function rangeButtonEmpty(loaded: boolean): string;
```

Rules: an end exactly at a local midnight is shown as `24:00:00` of the date before, and the date difference is taken from that date (whole day = `00:00:00 – 24:00:00`, no ⁺¹). Milliseconds on both ends when either end has a nonzero ms part after cutting to ms; nanoseconds are cut, never rounded (timeseries-window "Header range in milliseconds").

Button box (pinned, `bar/bar.css` class `.range-button`): `width: 318px; height: 26px; flex: 0 0 318px`; inside: 14 px icon, the text slot `flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`, the duration slot `flex: 0 0 56px; text-align: right`; `font-variant-numeric: tabular-nums`. The date part in slate-600 weekday plus weight-600 date, a 6 px gap before the times (the mock's double space; the `text` uses one). ⁺¹ as `<sup>` 9 px in `#0369a1`. Tooltip: the full `text` and duration on line 1, then `Go to: pick a range or type one · t`, unlinked with the target's title (`HINTS.goTo(linked, title)`).

### R7: Draft and selection (pinned, `apps/web/src/time/calendar.ts`)

```ts
export interface PickerDraft {
  start: string;  // local date "2026-10-13"
  end: string;
  from: string;   // time text as typed or filled ("15:06:03")
  to: string;     // may be "24:00:00"
  phase: "start" | "end";
}
export function draftOf(range: { from: bigint; to: bigint }): PickerDraft;   // via rangeLine's rules, phase "start"
export function pickDay(d: PickerDraft, date: string): PickerDraft;
export function draftRange(d: PickerDraft): { from: bigint; to: bigint } | { error: string };
```

`pickDay`: phase `start`, or a date before `start` → `{start: date, end: date, phase: "end"}`; else `{end: date, phase: "start"}`; times kept (the mock; Q-1). `draftRange`: times match `^\d{1,2}:\d{2}(:\d{2}(\.\d{1,3})?)?$`, hours ≤ 23 (To also `24:00` / `24:00:00` = next local midnight of `end`) else `Time as hh:mm:ss`; local instant via `parseTime("<date> <time>")` (its DST messages pass through); `to ≤ from` → `To lies before From`.

### R8: Presets (pinned, `apps/web/src/time/calendar.ts`)

```ts
/** Drives overlapping the day, in time order, with chip labels "03:00–03:30 · 30 min" (minutes rounded; "⁺¹" after the end time when it lies on the next date). */
export function dayDrives(answer: CalendarDensity | undefined, day: CalendarDay): { drive: Drive; label: string }[];
export function wholeLabel(kind: ScopeKind): "Whole recording" | "Whole scope" | "Whole session";
```

`ScopeKind`: `none` (no scope), `scope` (scope, no open catalog), `session` (open catalog, linked), `object` (unlinked) → labels Recording, Scope, Session, Recording (Q-3). The whole span is `wholeRange(density)` of the strip's density for the same data ref (the double-click's range; in a scope or object scope the density covers the scope). A drive chip fills the draft with `draftOf(drive)`; **Whole day** sets `{end: start, from: "00:00:00", to: "24:00:00"}`. The chip line is one line, `overflow-x: auto`, no wrap (fixed height).

### R9: Months and paging (pinned, `apps/web/src/time/calendar.ts`)

```ts
/** Left and right month shown when the picker opens: right = local month of `range.from`, left = the one before. */
export function openMonths(range: { from: bigint; to: bigint }): { year: number; month: number }[];
/** ‹: data before the left month (first < localMonth(left).from); ›: data after the right month (last ≥ localMonth(right).to). Without a density both true. */
export function canPage(density: Density | undefined, left: { year: number; month: number }): { prev: boolean; next: boolean };
```

Month title `October 2026`; weekday heads `Mo Tu We Th Fr Sa Su`; 6 rows always (stable height); today's day number underlined.

### R10: Picker component (pinned props, new `apps/web/src/bar/RangePicker.tsx`, `bar/rangePicker.css`)

```ts
export interface RangePickerProps {
  /** The bar target's shown range (preview included). */
  range: { from: bigint; to: bigint };
  /** stripDataRef(workspace); undefined → no bars. */
  dataRef: string | undefined;
  scope: WorkspaceScope | undefined;
  kind: ScopeKind;
  /** The typed text, kept by App across opens. */
  typed: string;
  onTyped: (text: string) => void;
  /** Resolves and applies "Go to" text (today's onGoTo): error text, or undefined when applied (then the picker closes). */
  onGoTo: (text: string) => string | undefined;
  /** One range command for the bar target, one history entry (as the strip's range commands). */
  onApply: (range: { from: bigint; to: bigint }) => void;
  /** Close without a command; focus returns to the button. */
  onClose: () => void;
}
```

On mount it fetches `fetchDensity(dataRef)` (whole recording, scope or coarse object scope; served from the server cache) and `fetchCalendar(dataRef, localMonth(...))` for both shown months, each with its own `AbortController` aborted on unmount; paging fetches only the new month. The web keeps answers in a module `Map` keyed `dataRef|scopeKey|from` for the page's life, cleared when the scope key changes; failures are not kept.

New in `apps/web/src/api.ts` (pinned): `fetchCalendar(dataRef: string, window: { from: bigint; to: bigint }, signal?: AbortSignal): Promise<CalendarDensity>`.

Layout (mock): popover `position: absolute` under the button, left edge at the button's, shifted left to stay inside the viewport, width 640 px, padding 12 px, gap 10 px, 6 px radius, shadow; rows: typed field 28 px; month titles with ‹ › 26 px; two grids (7 columns, gap 2 px) of 6 × 40 px day cells, 30 px when `innerHeight < 640` (fits 1000×557); legend line (`data per 2 h`, `drive`, the hint `Click a day; a second click ends the range` / `Click the last day, or set the times` / `Loading…` / `Density unavailable`); the chip line 24 px (`DRIVES TUE 13`, chips, Whole day, whole span); From and To, each with its date (108 px) and a 84 px mono field; the result line 34 px (13 px weight 600 text, muted duration, or the error in `#be123c`), Cancel and Go (dark primary, disabled on an error). `role="dialog"`, `aria-label="Go to"`. Esc anywhere in it and a pointer-down outside it and the button call `onClose`.

### R11: Top row, keys, App (pinned, `apps/web`)

- `OptionBar.tsx`: the "Go to" `<input>` and both `spanSelect` uses go; in their place `<button class="range-button" aria-haspopup="dialog" aria-expanded aria-label="Go to">` (R6) and, while open, `<RangePicker>`. Props: `onSpan` removed; `range`, `rangeLoaded`, `pickerOpen`, `onPickerOpen(open: boolean)` added; `onGoTo`, `onGoToClear` stay. No other control of the row moves in this change.
- `keys.ts`: `goTo` now means "open the picker"; the key mapping gets the picker's open state and answers no navigation action while it is open (test "ignores navigation keys while the range picker is open").
- `App.tsx`: holds `pickerOpen` and the typed text; `goTo` → open (focus "Go to", select its text); `onApply` sends the bar target's `window.setRange` through the same path as the strip's range commands (history entry, linked/unlinked); the button is disabled without a timeseries window.
- `help/hints.ts`: `goTo` reads `Go to: pick a range or type one · t` (unlinked: with the target); `span` removed. `help/shortcuts.ts`: `t` → `Open the range picker (Go to)`.

### R12: Coordination with `declutter-workspace`

- Shared files: `bar/OptionBar.tsx`, `bar/bar.css`, `App.tsx`, `chart/TimeseriesWindow.tsx`. This change touches only the Go to slot, the Span select (row and ⋯ menu), the picker state and the header's range slot while unlinked. Whichever change builds second rebases on the other's diff; the pacer must not run both changes' web tasks in the same round.
- Requirements this change modifies that `declutter-workspace` may also touch: timeseries-window "Option bar" and design-language "Controls". The lead archives `add-range-picker` first, or the second change's MODIFIED text is rebased on the first's before archiving.
- Header: `declutter-workspace` removes the range text of linked windows and lays out the header; it keeps a range slot (the mock's 64 px mode tag area is not it) where R13's text goes while unlinked.

### R13: Own range of an unlinked window (`chart/TimeseriesWindow.tsx`)

While `linkTime` is false the header's range slot shows `ownRangeText(shownRange, false)` in 11 px slate-500 tabular figures, the plotted (preview) range as today's header range, truncating first (workspace-layout "Header truncation"), full text as tooltip. While linked the slot is left as `declutter-workspace` defines it (until then: today's header range).

## Numbers: what if off by a factor of two

| Number | Source | ×½ | ×2 |
|---|---|---|---|
| Grid 60 s | R3 | 30 s: 89,280 buckets per month, over the 48,000 cap of the strip's grid (carserver RAM, D-007) | 120 s: drive edges ±2 min, pauses up to 3 min merge; fallback F2 |
| Hours as resolution | R3 | 30 min: 1,490 numbers, fits half-hour zones; harmless, not needed (browser zone Europe/Berlin) | 2 h: local even hours are odd UTC hours in CET, bars would be off by 1 h half the year |
| 32 d per request | D-089 | 16 d: two requests per month | 64 d: breaks D-089's work window in an object scope |
| 12 bars per day | mock, Jan | 6 bars of 4 h: drive time of day lost | 24 bars: about 1 px per bar in a 41 px cell (640 px / 2 months / 7 days − insets) |
| Bar 12 px, floor 2 px, 4 decades | R5 | 2 decades: smart451's trickle (160 k rows/h vs 50 M rows/h, D-057) sits at the floor | 8 decades: trickle and drives look alike; one ×2 in rows changes a bar by 0.9 px at 4 decades |
| Button 318 px | mock | 159 px: not even the date and times fit | 636 px: the row at 1000×557 no longer fits on one line |
| Picker 640 px wide, cells 40 px (30 px under 640 px height) | mock | cells 20 px: number and bars do not fit | 1,280 px / 80 px cells: outside a 1000×557 viewport |
| LRU 12 windows | R3 | 6: paging a few months back and forth recomputes | 24: memory still trivial (≤ 745 numbers each) |
| Goal full-mode month ≤ 10 s | fact 7 | 5 s: likely missed on carserver (the strip's 9.2 s) | 20 s: the picker shows `Loading…` for 20 s; typed input and Whole day still work; above that F1 |
| Session month ≤ 1 s | a session is minutes of rows | 0.5 s: fine either way | 2 s: noticeable, still usable |

## Test fixtures (pinned for the tester)

- `drivecar` (test DB, design S4 of `add-strip-navigation`): over M10 (`from` 2026-09-30T22:00:00Z = `1790805600000000000`, `to` 2026-10-31T23:00:00Z = `1793487600000000000`) the hours are 26: 360, 27: 177,360, 28: 3,360, 29: 51,360, 30: 360, 31: 360, 32: 1 (trickle 360 per hour, FAST 177,000 in 01:00Z–02:00Z, WAKE 3,000 in 02:00Z–03:00Z, FAST 51,000 in 03:00Z–04:00Z, the trickle's last row at 06:00:00Z); on the 60 s grid the peak is 6,006, the 03:05–03:06 minute holds 6 rows (inactive) and the runs [03:00, 03:05) and [03:06, 03:10) are 60 s apart and merge: drives [01:00Z, 01:30Z) 177,180 rows and [03:00Z, 03:10Z) 51,060 rows; the 60 s WAKE minute is no drive.
- Day bars of 2026-10-02 (CEST, local = UTC+2): bar 1 (local 02–04) = 360 + 177,360; bar 2 = 3,360 + 51,360; bar 3 = 720; bar 4 = 1.
- `testcar` scope {T1 = 2026-10-01T01:00:00Z, T2 = 02:00:00Z}: index 3 of M10.
- Server tests use the existing `scopeApp.ts`, `caseKit.ts`, recording adapters and stub sources; no new seed data.

## Manual checks

UI user on smart451 at 1440×900 and 1000×557: "Button text", "No reflow", "No timeseries window", "Open on smart451", "Fits and keeps its size", "Calendar on smart451", "Drive preset on smart451", "Go and Back", "Cancel, Esc and keys", "Linked and unlinked on smart451", "Two unlinked windows", the time-navigation scenarios with UI checks. Lead: "Cost on carserver" (four `curl` times), "Slow and failing source" (stops the tunnel or source and restarts it).

## Questions for Jan (defaults taken unless he vetoes)

- **Q-1** Picking a day keeps the From/To times (the mock); the alternative is that a day click sets 00:00 – 24:00. Default: keep the times, Whole day gives the whole day.
- **Q-2** A range that ends at a local midnight reads `24:00:00` (`Tue 2026-10-13 00:00:00 – 24:00:00`), not `00:00:00⁺¹`, so a whole day carries no ⁺¹. Default: `24:00:00`.
- **Q-3** The whole-span preset reads `Whole session` with a linked catalog and `Whole scope` in a plain scope, `Whole recording` otherwise. Default: these labels.
- **Q-4** A multi-day range does not fit the 318 px button in full; it is cut at the end with the full text as tooltip. Default: cut (D-092's truncation rule).

## Ledger entry on archive (proposed; the lead writes it)

Range picker conventions: `GET /api/calendar` (hours from `from`, 60 s grid drives, ≤ 32 d, cut to the scope, cached per window, request class); the range line (`24:00:00`, ⁺¹, full end date, ms when needed); a linked catalog's calendar shows the session only; Q-1 … Q-4 as answered.
