# Design

## Context

See proposal.md (Why). Facts this design rests on:

| Fact | Where today |
|---|---|
| One `]` step moved the session text width 372 → 728 → 646 → 407 px and `k / n` by up to 355 px (designer, 2026-10-21) | `case/SessionBar.tsx`: one `session-text` span holds title, kind, times and meta; `k / n` follows it |
| The bar's text comes from `workspace.case.entry`, so it changes when the step's revision arrives, about 1 s before the windows have drawn | `case/SessionBar.tsx`, `App.tsx` (`caseCommand`) |
| The session bar lives in the strip head (`time/TimeStrip.tsx` prop `sessionBar`), next to `TIME`, the range, the events count and the info | `time/TimeStrip.tsx:662-740` |
| The badge `agg · 536.8 ms` / `part · 1 s` sits before the range and the controls | `chart/build.ts` `resolutionBadge`, `chart/TimeseriesWindow.tsx:1722-1777` |
| Display select and Min/max are header controls | `chart/TimeseriesWindow.tsx:1743-1770`; `window/WindowMenu.tsx` has Rename, Remove |
| The readout row sits between plot and legend | `chart/TimeseriesWindow.tsx:1792-1810`; legend is `ul.signals` (CSS grid) |
| Top row: `Signals` text button, Views, A/B/Diff, Link checkbox, Go to, Span, Back, Reset, Digits, + Values, Share, ⋯ (container queries at 990/910/890 px) | `App.tsx:1588-1620`, `bar/OptionBar.tsx`, `bar/bar.css:89-140` |
| Footer items: source, catalog, zone, build, user; status `connected · revision n` | `footer/items.ts`, `footer/StatusBar.tsx:148` |
| A 404 `unknown_signal` reads `not in this session` only inside a case with `errorCode` set; else `failed: …` red; the axis title falls back to the label | `chart/loader.ts:72-84`, `chart/axes.ts` |
| The explorer's count line `<n> signals · drag a row onto a window, or press +` | `explorer/SignalExplorer.tsx:431` |
| A CLI open already prints the open report as `data.case` (`CreateWorkspaceAnswer.case`) | `apps/cli/src/case.ts:38-45`, `packages/shared/src/workspaces.ts:104-112` |
| D-093 (after round 1): ranges and sessions read as start and duration (`26-10-13 15:06  0:10`); `add-range-picker` implements the one formatter `startDuration` and `DurationTag` (its design R6) | `docs/decisions.md` D-093; `apps/web/src/time/rangeLine.ts` |
| D-094: the strip is one 28 px row: presence line, drives, events lane, shown range, A/B flags that jump back; no density bars | `docs/decisions.md` D-094; mock `Strip.dc.html` row "Recommended" |
| D-095 (after round 2): the critic's points 1–3 and 5–15, accepted; this change takes the sidebar, strip, toggles, session bar, axes, flags and keys, slots, Reset glyph and Share (`add-range-picker` the formatter and the calendar); final numbers in the mocks `Main`, `Compact`, `SessionBar`, `Strip` (row "Recommended") | `docs/decisions.md` D-095; `docs/design/declutter/CRITIC.md`; `docs/design/declutter/*.dc.html` |
| `/api/density` answers `first`, `last`, ≤ 120 `counts` and `drives`; `/api/gaps` the logger gaps (≥ 2 s) per data ref, scope or work window, cached; the web already fetches gap info for the windows' data refs | `apps/server/src/routes/series.ts`, `apps/web/src/chart/gaps.ts`, `apps/web/src/api.ts:196` |

## Goals / Non-Goals

**Goals:** every requirement of the deltas with web-only changes; every interface two engineers share pinned below so `case/`, `bar/`, `chart/`, `window/`, `time/`, `footer/`, `explorer/`, `values/`, `help/` and the root files (`App.tsx`, `ack.ts`, `styles.css`) can be built in parallel; one repeatable layout check (DW1).

**Non-Goals:** the proposal's "Out of scope"; no shared type, route or CLI code change.

## Decisions

### DW0: Split with `add-range-picker`

This change does not touch `time-navigation` or timeseries-window "Header shows the plotted range" / "Header range in milliseconds". It refers to "the range control": today the Go to field and the Span select, after `add-range-picker` its range button. The **slot contract**: `bar/OptionBar.tsx` renders the range control inside one `<span className="range-control">` placed after Views' separator and before Back; `add-range-picker` puts its button inside that span and drops Span there. With link off, the window header's range (`span.range`) keeps today's text until `add-range-picker` defines it; with link on, this change removes it, but only once the range button shows the range (task 3.4 waits for it; workspace-layout "Linked windows show the range once"), so the range is never unreadable. Until then other specs' scenarios that read "the header shows <range>" keep working.

Start and duration (D-093, D-095): this change implements no formatter of its own. The session bar, scope row, catalog list, strip tooltips and end labels import `startDuration` (with `full`, `durationTip`, `tip`), `fullTime`, `formatDuration` and `DurationTag({text, title})` from `add-range-picker` (its design R6, tasks 3.1 and 3.5) and stub them until those land.

Requirements this change MODIFIES that a sibling might also want: timeseries-window "Option bar" and "Link toggle", design-language "Controls", guidance "Explained labels" (Span left out of the list; its tooltip stays while the select exists), workspace-layout "Compact window header" and "Header truncation". Whichever change archives second rebases its delta on the synced text.

### DW1: Layout probe (pinned; the UI user runs it as is)

Run in the page (Chrome tool `javascript_tool`) after the setup and before the action; `window.__layoutProbe.stop()` after it returns the elements that moved or resized more than 1 px (empty list = pass). It re-queries by selector and index each frame, so a re-rendered element with the same box passes, and a vanished one fails. Do not scroll while it runs.

```js
(() => {
  const SEL = [
    ".option-bar-slot button", ".option-bar-slot select", ".option-bar-slot .range-control",
    ".explorer", ".context-row", ".context-row .slot-label", ".context-row .session-arrow",
    ".context-row .session-position", ".context-row .slot-title",
    ".context-row .slot-duration", ".context-row .slot-action", ".time-strip", ".time-strip .strip-end",
    ".window-header .mode-tag", ".window-header .window-menu-button",
    ".signals .legend-head > *", ".plot", ".status-strip .conn", ".status-strip .attribution",
  ];
  const keys = SEL.flatMap((s) => [...document.querySelectorAll(s)].map((_, i) => [s, i]));
  const box = (s, i) => {
    const e = document.querySelectorAll(s)[i];
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return [r.x, r.y, r.width, r.height];
  };
  const base = keys.map(([s, i]) => box(s, i));
  const worst = keys.map(() => 0);
  let on = true;
  const tick = () => {
    keys.forEach(([s, i], k) => {
      const b = box(s, i);
      const d = b ? Math.max(...b.map((v, j) => Math.abs(v - base[k][j]))) : Infinity;
      worst[k] = Math.max(worst[k], d);
    });
    if (on) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  window.__layoutProbe = {
    stop() {
      on = false;
      return keys.map(([s, i], k) => [`${s}[${i}]`, worst[k]]).filter(([, d]) => d > 1);
    },
  };
  return `watching ${keys.length} boxes`;
})();
```

The class names in `SEL` are pinned (DW3, DW8, DW10, DW11, DW12; `.status-strip`, `.conn`, `.attribution`, `.plot`, `.window-menu-button`, `.option-bar-slot`, `.explorer` exist today). The strip's hover readout (DW19) is absolute and outside `SEL`; it must move nothing that `SEL` holds. Wait for the end of an action by `!document.querySelector(".session-progress")` plus 500 ms.

### DW2: Numbers and what ×2 would do

| Number | Origin | ×½ | ×2 |
|---|---|---|---|
| catalog list start column 116 px (12 px font) | mock after D-093 | cuts `26-10-13 15:06` to the date | 116 px less name in a 560 px list; `26-10-13 15:06:03` fits |
| duration slot and list column 64 px | D-095 (worst case `9 d 11 h` with its icon) | cuts `9 d 11 h` | 64 px less title |
| action slot 64 × 24 px | mock, D-095 | cuts `Unlink` | 64 px less title |
| position button 88 × 24 px | D-095 (worst case `123 / 456` + glyph + `▾`) | cuts `12 / 17` | 88 px less title; still fits 1000 px |
| sidebar 248 px, 208 px below 1200 px viewport | D-095 (mocks `Main`, `Compact`) | 124 px: signal names unreadable | 496 px: half of a 1000 px viewport, plot share < 30 % |
| viewport threshold 1200 px for the 208 px sidebar | spec owner's default: midpoint of the mocks' 1440 and 1000 px | 600 px: a 1100 px viewport keeps 248 px and the top row (≈ 765 px) may not fit beside it | 2400 px: 1440 px gets 208 px, names cut although there is room |
| axis title 8 px clear of the top tick | D-095 (critic 11) | 4 px: the unit still touches the tick label at 11 px font | 16 px: 8 px of plot height lost per window |
| title ≥ 160 px before the label drops | judgment | 11 characters left at compact width, still a hint with tooltip | label drops at 1440×900 never (1200 px row leaves 568 px) — harmless |
| row ≤ 32 px | mock, D-056 | below 26 px controls: impossible | costs plot share (Screen use ≥ 30 %) |
| strip 28 px (27 track + 1 border) | D-094, D-095, mock `Strip.dc.html` | 14 px: pins (y 2–9) or flags (y 15–27), not both | 56 px: the old ceiling, 28 px of plot lost per page |
| end-label slots 48 px each | D-095 (fits `15:06:03`-wide text at 10 px) | 24 px: `15:06` cut | 96 px: 96 px less track |
| day labels ≥ 32 px apart, ≥ 24 px from the end | spec owner's default (`10-12` at 10 px ≈ 26 px) | 16 px: labels overlap | 64 px: on a 30-day scope every other day drops even where two would fit |
| shown range ≥ 3 px, caret 8 × 5 px | D-095 (critic 7) | 1.5 px: vanishes beside a 3 px presence line | 6 px: a 2 min range looks like 20 min on a vehicle strip |
| presence break ≥ 3 px | mock | 1.5 px vanishes on the 3 px line | 6 px hides data around every gap |
| flag face 14 × 12 px, hit 24 × 24 px | D-095 (critic 13) | 7 × 6 px face: letter unreadable; 12 × 12 hit: below the 24 px target size | 28 × 24 face overflows the 28 px strip; 48 px hit covers the window header below |
| `A·B` merge under 18 px, face 26 × 12, hit 32 × 24 | D-095 (critic 7) | 9 px: two 14 px faces overlap | 36 px: cursors 20–35 px apart merge although both flags would fit |
| pin hit 10 × 11 px | D-095 (critic 5: ≥ 9 px) | 5 px: as hard to hover as the old 3 px pin | 20 px: neighbouring pins' areas overlap on most strips; nearest centre still decides |
| flag hit from track y 11, 7 px below the strip | spec owner: the designer's y 10 overlapped the pin lane (y 0–11) by 1 px | y 5: covers pins | y 22: 18 px below the strip, over the first window header |
| progress line 2 px | mock | 1 px hard to see | 4 px still no layout effect (absolute) |
| note ≤ 470 px, title ≥ 8 ch | mock | note ~30 chars + tooltip | no title left at 1000 px |
| mode tag slot 64 px | mock | cuts `part 1.5 min` | 64 px less title in a 480 px window |
| cursor column = width of `A 00:00:00.000` (≈ 84 px) | stable rule | cuts every header | 3 columns > 480 px window |
| probe tolerance 1 px | fractional layout ≤ 0.5 px | flags sub-pixel rounding | still catches the measured 355 px moves |
| flat y range: span ≤ 1e-9 of the magnitude, padding ± max(10 %, 1) (timeseries-window "Flat y range") | data fact LWS_SPEED; `yRange` flat line | 5 %: line still mid-plot, axis tighter; 5e-10: float noise of a constant mean (≈ 1e-15 of the value) is still flat | 20 %: line still mid-plot, axis wider; 2e-9: a span just above it still gives axis steps far above the float resolution (≈ 1e-16) |
| "Step on smart451" screenshot within 200 ms | a step on smart451 takes ~1 s | hard for the browser tool | may miss the progress line on a cached step: the unit test then carries it, UI part `not_run` |

### DW3: Context row (`case/`)

`App.tsx` renders inside `.top-area`, between `.option-bar-slot` and `<TimeStrip>`: `<SessionBar …/>` while `workspace.case` exists or the page is opening a `/open#cases=` link, else `<ScopeRow …/>` while `workspace.scope` exists, else nothing. Both render the same grid.

```ts
// case/SessionBar.tsx
interface SessionBarProps {
  /** undefined while a /open#cases= page waits for its workspace: every slot a skeleton. */
  caseState: WorkspaceCase | undefined;
  scope: WorkspaceScope | undefined;
  /** Target index of a step or go on its way (DW4). */
  pending?: number | undefined;
  /** Progress line shown (DW4). */
  progress?: boolean;
  onCommand: (command: CommandInput) => void;
  disabled?: boolean;
  openNote?: string | undefined;
  onDismissNote?: () => void;
}
// time/ScopeRow.tsx (new, time/ engineer)
interface ScopeRowProps {
  scope: WorkspaceScope;
  mode: "full" | "scoped" | undefined;
  onScopeCommand?: (command: CommandInput) => Promise<CommandResult>;
}
```

Pinned classes (CSS in `case/case.css`, imported by both): `.context-row` (grid, one line, ≤ 32 px, `position: relative`, `container-type: inline-size`), children in order `.slot-label`, `button.session-arrow[aria-label="Previous session"]`, `.session-menu > button.session-position`, `button.session-arrow[aria-label="Next session"]`, `.slot-title` (holds `.slot-title-text` and, when present, `.session-open-note`), `.slot-duration` (holds `DurationTag`; D-095: no `.slot-times`, the start lives in the title's tooltip and the list), `.slot-action` (second `.slot-action` for Clear in the scope row), `.session-progress` (absolute, 2 px, bottom edge, only while `progress`), `.skeleton` (grey block inside a slot). The scope row puts empty `.session-arrow` and `.session-position` placeholders of the same width with `visibility: hidden`, so its slots line up with the session bar's. Widths (D-095): label 64 px, arrows 26 px, position button 88 × 24 px (pill, `<k> / <n>`, the align glyph, `▾`), duration 64 px, action 64 × 24 px (pill); the title takes the rest (`minmax(0, 1fr)`). The note's ✕ is a 22 × 22 px button. The position button's glyph is a 10 px SVG, stroke slate-600 2.6: `start` `line 4 3 → 4 21`, `line 9 9 → 20 9`, `line 9 15 → 16 15`; `end` `line 20 3 → 20 21`, `line 4 9 → 15 9`, `line 8 15 → 15 15` (mock `SessionBar.dc.html` GLYPH); `anchor` and `event` `line 12 3 → 12 21`, `line 5 9 → 19 9`, `line 8 15 → 16 15` (spec owner's default, the mock draws only start and end). While its list is open the button takes the pressed style (DW8). Below a measured row width (≈ 860 px: the width at which the title keeps 160 px with the label; written as a comment in `case.css`) a container query hides `.slot-label` (`display: none`; it is a mode, not a step). All slots `font-variant-numeric: tabular-nums`.

### DW4: Pending step (root + `case/`)

```ts
// case/sessionBar.ts
/** The index a case command will reach: go → its index; step → (pending ?? current) + by inside
 *  [0, count); anything else, unlinked, or outside the catalog → undefined. */
export function pendingTarget(
  c: Pick<WorkspaceCase, "current" | "count" | "linked">,
  pending: number | undefined,
  input: CommandInput,
): number | undefined;
```

`App.tsx` keeps `pending: number | undefined` and `progress: boolean`. In `caseCommand` it sets `pending = pendingTarget(…)` and `progress = true` before sending; on a refused result both clear at once; on an accepted one it keeps both until the result's revision is rendered. `ack.ts` gains `onRendered?: (revision: number) => void`, called when `trySend` sends a revision (every window reported it; with no window at once). `TimeStrip` gets `stepping?: boolean` (`= progress`): while true, and afterwards until the density for the current `(dataRef, scope)` key is loaded, the strip shows its loading state (DW10: `Loading recording…`, no presence line, drives or pins).

### DW5: Session slots (`case/sessionBar.ts`, pure)

```ts
export interface SessionSlots {
  label: "SESSION" | "VEHICLE";
  /** `<k> / <n>` in the fixed 88 px button (D-095; `positionCh` goes). */
  position: string;
  /** The current alignment for the glyph and the words. */
  align: "start" | "end" | "anchor" | "event";
  /** "Sessions of the catalog, aligned at the session start". */
  positionTooltip: string;
  /** "Session 1 of 4, aligned at the session start: sessions and align". */
  positionLabel: string;
  /** undefined → skeleton. */
  title: string | undefined;
  /** Line 1 `<title or object> · <full> · <duration> · <kind>` (unlinked `<object> · whole series · <full> · <duration>`), then meta, id, tool lines. */
  titleTooltip: string | undefined;
  /** startDuration(from, to).duration: "0:10 h", "41 s", "9 d 23 h". undefined → skeleton. */
  duration: string | undefined;
  /** startDuration(from, to).durationTip: "Duration 10 min". */
  durationTooltip: string | undefined;
  action: "Unlink" | "Link";
  pending: boolean;
}
export function sessionSlots(
  c: WorkspaceCase | undefined,
  scope?: WorkspaceScope,
  catalog?: CaseCatalog,
  pending?: number,
): SessionSlots;
/** The duration slot and the start words of any range (also the scope row's and the catalog list's), from startDuration. */
export function timesSlot(from: bigint, to: bigint): { start: string; startTooltip: string; duration: string; durationTooltip: string };
/** "the session start" | "the session end" | "the anchor" | the event item's label (alignItems). */
export function alignWords(align: CaseAlign): string;
```

`timesSlot` gives `start` = `${date} ${time}` and `startTooltip` = `full` (for the catalog list and the title tooltips), `duration` and `durationTooltip` = `durationTip`. `weekday`, `times` and `plusOne` (D-092 (4)) go with D-093; `start`, `timesTooltip` and `positionCh` go with D-095; `sessionBarText` goes; its test "describes the session" is replaced by "fills the session slots".

### DW6: Catalog list with Align (`case/SessionBar.tsx`)

`CatalogList` gains, at its foot, `<div role="radiogroup" aria-label="Align">` with one `button role="radio"` per `alignItems(c.align, catalog?.entries)` item (labels unchanged; the checked one in the pressed style, DW8); `AlignMenu` and its button are removed. Choosing an unchecked item: close the list, send `case.align`. The back link reads `Back to search` with the tooltip `HINTS.backToSearch` (DW18), whatever `origin.tool` holds. Rows (D-093, D-095, mock grid `28px 1fr 116px 64px`):

```ts
export interface CatalogRow {
  index: number;      // 0-based
  position: string;   // "1"
  /** `<title or object> · <kind> · <first 2 meta>`, truncating, full text as tooltip. */
  name: string;
  start: string;          // timesSlot(...).start, "26-10-01 03:00"
  startTooltip: string;   // timesSlot(...).startTooltip, "Thu 2026-10-01 03:00"
  duration: string;       // timesSlot(...).duration, rendered in DurationTag
  durationTooltip: string;// timesSlot(...).durationTooltip, the tag's title
  current: boolean;
}
```

`catalogRowText` goes. The filter keeps its fields (a typed `26-10-01 03:00` matches the stored `2026-10-01 03:00`); filter, back link and `… more` are unchanged; the mock's `Event…` item is illustration.

### DW7: Open note (`case/`, root)

The note renders inside `.slot-title` after `.slot-title-text`: `span.session-open-note[role=status]` (max-width 470 px, `flex: 0 1 auto`, text truncating) with its ✕ inside; `.slot-title-text` has `min-width: 8ch`. `App.tsx` sets `openNote` from `openNoteText` and no longer calls `showResult(caseOpenEvents(…))` for an open; `caseOpenEvents` may stay exported for tests. The CLI path needs no code (DW0 table: `data.case` already printed).

### DW8: Top row (`bar/`, root)

Order (timeseries-window "Option bar"): `[sidebar]` (root, `App.tsx`) `Views [title] [Read-only] | .range-control | Back Reset Link | A B Diff · flex · Share… ⋯ ?`. Icons are inline SVG with the mock's paths (`docs/design/declutter/Main.dc.html`: sidebar `rect+line`, Back `polyline 9 14 4 9 9 4 + path`, Reset the fit glyph of D-095 (`line 3 5 → 3 19`, `line 21 5 → 21 19`, `line 7 12 → 17 12`, `polyline 10 9 7 12 10 15`, `polyline 14 9 17 12 14 15`), Link `two paths`, More three circles), stroke `currentColor`, 14–16 px, `aria-hidden`. "Link time axes" is `button[aria-pressed]` sending `workspace.setLinkTime`. `OverflowMenu` content: Digits and + Values window, nothing else; Share… stays in the row at every width (D-095; the Share threshold, its `overflow-item` class and the `bar.css` comment go).

Pressed style (D-095, pinned in `bar/bar.css` as `.toggle[aria-pressed="true"], .toggle[aria-expanded="true"], .toggle[aria-checked="true"]` and reused by `case/case.css`): `background: #e0f2fe; border: 1px solid #7dd3fc; color: #0369a1; font-weight: 600` (icons `stroke: currentColor`). Released toggles have the plain control look (white, `#cbd5e1` border, `#334155` ink). A, B and Diff become `button.toggle[aria-pressed]` 26 px tall, `min-width: 30px`, `padding: 0 9px`, `border-radius: 4px` (no pill radius). Users: A, B, Diff, "Link time axes", the position button while its list is open (`aria-expanded`), the checked `ALIGN` radio (`aria-checked`). "?" is rendered by `App.tsx`'s `helpTail.row` without `overflow-item`; `helpTail.menu` is dropped. Hints: `HINTS.link(on: boolean)` (W1 wording, ≤ 140 characters), `HINTS.sidebarToggle(open)` unchanged words with `s`.

### DW9: Footer (`footer/items.ts`, pure)

```ts
/** Lines of the status tooltip (app-footer "Status tooltip"), joined by "\n". */
export function statusTooltip(
  revision: number,
  meta: ServerMeta | undefined,
  stale: boolean,
  now?: Date,
): string;
```

`footerItems(meta, stale, zone, now, me)` keeps its signature and returns: `source` only while unreachable (`error`), `catalog` only for `failed` (`error`) or `no_scope` (`muted`), `zone`, `user`; no `build`. Ranks unchanged, `RANK_BUILD` removed. The detail lines reuse today's item titles (source title, `catalog loaded …`, build title joined by ` · `). `StatusBar` shows `connected`/`disconnected` (no revision) with `title={statusTooltip(…)}`; the dot is the existing `.conn` `::before`, error colour when `!connected || !meta.source.reachable`.

### DW10: Strip (`time/`)

`TimeStrip` loses the head (`time-strip-head`, `time-strip-range`, `time-strip-events`, `time-strip-info`) and the props `sessionBar` and `onOpenEvents`; it gains `stepping`. D-094 replaces the bars: the strip is one row of `STRIP_PX = 28` (track 27 px + 1 px border) in every state. D-095: `.time-strip` is a flex row of `span.strip-end` (48 px, left), `.time-strip-track` (the rest) and `span.strip-end` (48 px, right); the track's width is the strip's minus 96 px, so `trackOf` gets that width. Lanes in track coordinates: pins y 0–11 (shapes DW20), baseline y 13 (1 px slate-200), presence line y 12–15 (3 px slate-500 `#64748b`, accent inside the shown range), drives y 11–16 (5 px slate-700 `#334155`, slate-900 on hover, never the accent; none while a catalog is linked), day labels at y 17 (DW19), cursor lines full height, flags from y 11 (DW19). The accent marks only the shown range (window, caret, the presence line inside it). The track (`.time-strip-track`) gets `title` = `[info, hint].join("\n")` with `info = stripLabel(density, labelRange)` (now without ` · 1 bar = <w>`) and `hint` = `HINTS.stripInfo(recorded)` or `SCOPE_HINTS.info(span)`; while loading `Loading recording…`; failure: its message. State texts (`No signal shown`, `No scope set`, `Recording unavailable`, `Loading recording…`) and the drop text render in one `.time-strip-note` inside the track (loading: at its left over the baseline). `stripBars`, `barTitle` and `BAR_PX`/`BARS_PX` go; the track mapping `trackOf`/`xOf`/`tOf` (bucket pitch, 2 px end slack) stays, so the geometry scenarios keep their numbers. Hit zone kinds keep their names (`bars` = the track's line area). `driveTitle(d, i)` reads `Drive <k> of <n> · <startDuration text> · <rows>` (`… 26-10-02 03:00  0:30 h · …`); `caseMarkTitle` uses `startDuration` for its range. `TimeStrip` also renders the end labels (`endLabels`), the day labels (`dayTicks`, only while `!workspace.case?.linked`) and the hover hairline with its readout (`hoverText`; a `div.strip-hover` absolutely positioned below the track, `pointer-events: none`, shown on `pointermove` over the track while no gesture runs, hidden on `pointerleave` and on press).

Server: no change. `/api/density` still feeds the strip (`first`/`last` for the span and the double-click, `counts` > 0 for presence, `drives`); `/api/gaps` (data-gaps, already cached per data ref, scope and work window) gives the logger gaps; the strip reads it through the shared `gapInfoStore` (`chart/gaps.ts`, `useGapInfo`) for its data ref, scope and work window, so it shares the windows' cached answer (no second request when a window shows that data ref); until the answer is there, breaks come from empty buckets only. No new route, no payload change. The range picker's per-day calendar density (`/api/calendar`) stays (D-094).

### DW19: Presence and flags (`time/stripGeometry.ts`, pure; pinned)

```ts
export const STRIP_PX = 28;
export const BREAK_MIN_PX = 3;
export interface PresenceRun { left: number; right: number; shown: boolean }
export interface PresenceBreak { left: number; right: number; title: string }
/** Data intervals: maximal runs of buckets with count > 0, clipped to [first, last]; breaks: the empty-bucket
 *  runs between them and every logger gap inside [first, last], each widened about its centre to ≥ BREAK_MIN_PX,
 *  overlapping breaks merged; title "No data · <startDuration text>" (one) or "No data · <n> gaps · <startDuration
 *  from the first's from to the last's to>". Runs: data intervals in px minus the drawn breaks, split at the
 *  shown range's drawn edges (`shown` inside). */
export function presence(
  tr: Track,
  d: Density,
  logger: readonly LoggerGap[] | undefined,
  range: Range | undefined,
): { runs: PresenceRun[]; breaks: PresenceBreak[] };

// D-095 (supersedes flagXs and FLAG_NUDGE_PX)
export const FLAG_FACE_W = 14, FLAG_FACE_H = 12, FLAG_HIT = 24, FLAG_HIT_TOP = 11;
export const FLAG_AB_FACE_W = 26, FLAG_AB_HIT_W = 32, FLAG_EDGE_AB_HIT_W = 36, FLAG_MERGE_PX = 18;
export interface StripFlag {
  name: "A" | "B" | "AB";
  /** Face centre x in track px. Inside: the line's x (AB: the lines' midpoint). Edge: 14 / px − 14 (AB 20 / px − 20). */
  x: number;
  /** Hit rect in track px: inside centred on x, FLAG_HIT (AB FLAG_AB_HIT_W) wide; edge from the edge, 24 (AB 36) wide. */
  hit: Rect;
  /** The cursor lies before the track's start or after its end: no line, a caret beside the face. */
  edge?: "before" | "after";
}
/** Lines (markerX of the cursors inside the track) and flags: two inside cursors less than FLAG_MERGE_PX apart,
 *  or two on the same edge, give one "AB" flag. */
export function stripFlags(
  tr: Track,
  a: bigint | undefined,
  b: bigint | undefined,
): { lines: { name: "A" | "B"; x: number }[]; flags: StripFlag[] };
/** Range of an "AB" click: centred on (a + b) / 2, span max(view span, 2·|b − a|). */
export function bothRange(view: Range, a: bigint, b: bigint): Range;

export const MIN_WINDOW_PX = 3;   // was 2 (D-095)
// windowRects(tr, range) gains `caret: boolean` = the exact clamped width < MIN_WINDOW_PX.

export const END_SLOT_PX = 48;
/** Left and right end label of the strip span [from, to]: "HH:MM" when to − from < 24 h, else "MM-DD", cut, local;
 *  title fullTime(t, true). from/to: the scope's bounds, else density first/last. */
export function endLabels(from: bigint, to: bigint): { left: { text: string; title: string }; right: { text: string; title: string } };
export const DAY_LABEL_GAP_PX = 32, DAY_LABEL_END_PX = 24;
/** Local midnights m with from < m < to, x = xOf(tr, m), text "MM-DD" of the day starting at m; a label is kept when
 *  x − (previous kept x) ≥ DAY_LABEL_GAP_PX and x ≤ tr.px − DAY_LABEL_END_PX. */
export function dayTicks(tr: Track, from: bigint, to: bigint): { x: number; text: string }[];
/** Pointer time below the strip: "HH:MM:SS" (cut) when spanNs < 24 h, else "MM-DD HH:MM". */
export function hoverText(t: bigint, spanNs: bigint): string;
```

Flags render as `<button class="strip-flag" aria-label=… title={HINTS.stripFlag(...)}>` positioned over the track's lower part (hit area from track y 11, 24 px tall, so it hangs 7 px below the 28 px strip into the gap above the windows; `.time-strip` has `overflow: visible` and the flags `z-index` above the track but below the hover readout); the face 14 × 12 at y 15–27, radius 2, 9 px bold letter (A slate-900 fill, white letter; B white, 1 px slate-900 inset outline, dashed line; `A·B` like B, 26 px wide); an edge flag puts a 5 × 8 px slate-900 caret 2 px outside the face (`◂` before, `▸` after) and its `aria-label` reads `Cursor A lies before the strip: bring it into view` / `… after the strip: …`; hover: `outline: 2px solid #94a3b8; outline-offset: 1px` on the face, never the accent. `pointerdown` on a flag stops propagation (no strip gesture); its click sends `centreRange(view, t)` (AB: `bothRange`) through the same path as a pin click (one `window.setRange`, one history entry). B's button renders after A's, so it wins where they overlap. Day labels: a 1 px `#f1f5f9` hairline over the track height at x and the text 10 px `#475569` at y 17, 3 px right of it; the hover hairline 1 px `#475569`; end labels 10 px `#64748b`, tabular, the left one left-aligned and the right one right-aligned in their slot.

### DW20: Strip pin shapes (`events/marks.ts`, pure; pinned)

```ts
export type PinShape = "fault" | "change" | "hollow" | "dot";
export const STRIP_PIN_HIT_W = 10, STRIP_PIN_HIT_H = 11;
/** read (all DTC reads) → "hollow"; else by category: active, pending → "fault"; stored → "hollow"; change → "change"; else "dot". */
export function pinShape(m: Mark): PinShape;
/** Shape geometry on the strip, centred on (m.x0 + m.x1) / 2, x in track px: fault 7 (the head; the tick 2 px), change 2 (4 for
 *  several), hollow 6 (8 for several), dot 4; hit = drawn widened about the centre to ≥ STRIP_PIN_HIT_W. */
export function stripPin(m: Mark): { shape: PinShape; color: string; drawn: Rect; hit: Rect };
```

`groupMarks` and `Mark` stay (the plot glyphs use `drawn`); `PIN_LANE_PX` becomes 11 (the hit lane y 0–11). The strip draws: fault a 2 px tick y 0–27 and a 7 × 4 px head y 0–4, radius 1; change y 2–9, radius 1; hollow y 2–9 on `var(--panel)` with `box-shadow: inset 0 0 0 1.5px <colour>`; dot 4 × 4 at y 4–8, radius 2; each with an invisible hit element (`span.pin-hit`, `title={markTitle(m)}`) of the hit rect × y 0–11. `hitZone` picks, among pins whose hit rect holds the pointer, the one with the nearest centre. Colours: `markColor` (fault `#be123c`, stored `#b45309`, change `#7c3aed`, other `#64748b`).

### DW21: Axis titles and ticks (`chart/TimeseriesWindow.tsx`, `chart/window.css`)

`AXIS_STROKE` becomes `#334155` and every y axis uses it for ticks and tick labels (`stroke: AXIS_STROKE`, no longer `axis.color`). The `.axis-titles` row (14 px, own line above the plot) gets `margin-bottom: 8px` and `color: #334155`; each title span holds, when `axis.color` is set (the axis' only signal), `<span class="axis-swatch" style="background: <color>">` (8 × 2 px, 3 px gap) before the text. `PLOT_HEADROOM` (6 px) stays, so the top tick label (11 px font) ends at the plot div's top and 8 px clear of the title row. `layoutAxes` is unchanged (its `color` is the swatch's).

### DW22: Sidebar width (`layout/sidebar.ts`, `styles.css`, `explorer/`)

`SIDEBAR_WIDTH_PX = 248`, new `SIDEBAR_COMPACT_PX = 208` and `SIDEBAR_COMPACT_BELOW_PX = 1200`; `App.tsx` sets `--sidebar-width` from `window.innerWidth < 1200 ? 208 : 248` (on resize). `.explorer` gets `width: var(--sidebar-width); min-width: 0; overflow: hidden`. Row names (`.explorer .row .name`), group heads and the "Add to" select get `min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap`; a row name's `title` is its source name always (today only when a display name differs), a group head's its full text.

### DW23: Cursor keys (`keys.ts`, `help/shortcuts.ts`, `App.tsx`)

`NavKey` gains `"cursorA" | "cursorB"`: `navKey` maps `e.key === "A" && e.shiftKey` and `"B" && e.shiftKey` (same guards: no Ctrl/Meta/Alt, no text field, picker closed). `App.tsx` sends `centreRange(view, cursor)` for the bar target as a strip flag click does; nothing while that cursor is off. `SHORTCUTS` gains `{ group: "Time", keys: "Shift+A  Shift+B", action: "Bring cursor A or B into view", probe: [{ key: "A", shiftKey: true }, { key: "B", shiftKey: true }] }`; the strip group's `click a bar` becomes `click the line`.

### DW24: Test setups on smart451 (UI user, lead)

Design M1 of `improve-layout` names signals that smart451 lacks (`ICL_3A2h.SPEED_DISP`, `BRK_1A0h.WSPD_FL`, `ENG_5E0h.T_ENG`, `DCU_2B8h.HTR_HV_Volt`, `DCU_1F4h.COMP_HV_Volt`, `CLIM_A1.T_SET`; round 3 UI check). In this change, "the six-window setup" means M1 with these smart451 signals instead (same units: km/h, 1/min, two °C, two V; each in the smart451 catalog of 2026-10-21 with data from 2026-10-11 to 2026-10-20, `kipscope extent`). M1's snippet and its other rules (default heights, linked, cursors off unless the scenario says, no values window, list at the top) are unchanged.

| Window | Signal | Unit |
|---|---|---|
| 1 | `COMBI_412h.V_ANZ` | km/h |
| 2 | `BS_200h.DVL` | 1/min |
| 3 | `AC_A1.T_INNEN` | °C |
| 4 | `CPC_168h.EAC_HV_Volt` | V |
| 5 | `CPC_448h.PTC_HV_Volt` | V |
| 6 | `COMBI_408h.T_AUSSEN` | °C |

- **Plain workspace** (scenarios without a catalog): `kipscope workspace new`, open its `local.url`, then in the explorer search each signal and press Enter (each Enter makes a new window), in table order.
- **Case workspace** (scenarios with "an open catalog" or "a catalog from `kipscope case drives smart451`"): `kipscope case drives smart451 | jq '.data.origin.url = "http://localhost:5173/"' | kipscope case open -`, open its `local.url`, then add the six signals as above. `case drives` sets `origin.tool` only; the `jq` step adds an `origin.url` the server keeps in identity `none` (loopback, case-handoff "Back link only to the finder"), so the list shows `Back to search`. A scenario that changes an entry (a 90-character title) edits the document with `jq` before `case open -` the same way.
- **Known metadata** (D-096): the shown signals' name and unit come from the session's catalog. A step probe starts only after every legend row shows its display name and `[unit]` (the page was loaded, or a step landed, at an entry whose session has data for every shown signal). After a cold load at an entry without that data the legend shows the raw name without a unit until the first step into a session with data, and the columns right of the name move once; D-096 accepts this as rare (backlog: signal metadata per data ref).

Sample values in scenarios on smart451 come from `kipscope value` against the dev server (2026-10-21); a number the UI user cannot reproduce is a finding for the spec owner, not for an engineer.

### DW11: Window header and menu (`chart/`, `window/`)

Header: `WindowTitle`, mark pill, `span.range` only while `!workspace.linkTime`, flex spacer, `span.mode-tag` (fixed width, right-aligned, 11 px muted, tabular), `WindowMenu`. `resolutionBadge` keeps its name; `short` becomes `agg <w>` / `part <w>` / `raw`, `full` `aggregated · <w> per point` etc., `<w> = tagWidth(ns)`:

```ts
/** Largest of ns, µs, ms, s, min, h, d the width reaches; ≤ 3 significant figures: whole from 10, one decimal below, no ".0". 536.8 ms → "537 ms", 90 s → "1.5 min". */
export function tagWidth(ns: bigint): string;   // chart/build.ts
```

`HINTS.badge` drops ` · ` after the kind (`agg 2 min: aggregated, …`). The tag slot width is `calc(12ch)` of the tag font, checked against `part 1.5 min`.

```ts
// window/WindowMenu.tsx
export interface MenuItem {
  label: string;
  role: "menuitem" | "menuitemradio" | "menuitemcheckbox";
  checked?: boolean;
  /** Sent on pick; undefined → nothing sent (the checked mode). */
  command?: CommandInput;
  action?: "rename" | "remove";
}
export function windowMenuItems(
  windowId: string,
  display: { mode: DisplayMode; envelope: boolean } | undefined, // undefined: values window
): MenuItem[];
```

`WindowMenu` props become `{windowId, display?, onCommand, onRename, onRemove}`; it renders `windowMenuItems`. `HINTS.windowMenu` names the new items.

### DW12: Legend header row (`chart/`)

```ts
// chart/readout.ts
export interface HeaderCell { text: string; title?: string }
export interface LegendHeaders { a?: HeaderCell; b?: HeaderCell; d?: HeaderCell; hint?: string }
/** undefined when no cursor is on. Clock "HH:MM:SS.mmm" (cut), tooltip formatCursorTime. */
export function legendHeaders(
  a: bigint | undefined,
  b: bigint | undefined,
  diff: boolean,
  hints?: { b: boolean; diff: boolean },
): LegendHeaders | undefined;
```

The window renders it as the first child of `ul.signals`: `li.legend-head` whose cells occupy the same grid columns as a row (swatch, name → `hint`, unit, A, B, Δ, L empty, SNA empty). Cursor columns get `width: var(--cursor-col)`, set once on `ul.signals` to the measured width of `A 00:00:00.000`; cells `overflow: hidden; text-overflow: ellipsis` with the full text in `title`. The `.readout-row` is removed.

### DW13: Missing signals (`chart/`, `values/`, `help/`)

`loadStatusText(state, inCase)` returns `MISSING = "missing"` for `errorStatus 404 && errorCode "unknown_signal"` regardless of `inCase` (`NOT_IN_SESSION` goes). `isMissing(state)` exported from `chart/loader.ts`. The legend pill uses the loading pill's classes. `AxisInput` gains `missing?: true`; `layoutAxes` gives such inputs no scale and no side. `sourceCell` gives `{text: NO_VALUE, title: HINTS.missing(dataRef, name)}` for a source whose error is a 404 `unknown_signal` (the readout source carries `errorStatus`/`errorCode` like the loader state). `HINTS.missing(dataRef, name)` = `Missing: <dataRef> has no signal <name>`. Values: a pure `valueRowStatus(state, dataRef, name)` in `values/format.ts` returns `{text, title, tone}` (`missing`/muted or `failed: …`/error). If the API error's `code` is not reaching `errorCode` today (the designer saw `failed: unknown_signal: …`), the fix is in `api.ts`/`loader.ts`, root and chart engineers coordinate through the loader test.

### DW14: Sidebar tabs (`explorer/`)

```ts
// explorer/tabs.ts (new)
export interface TabEvents { shown: number; total: number; sentence?: string; nearby?: string }
export function sidebarTabs(input: {
  signals: number;           // catalog size
  matches?: number;          // set while searching
  events?: TabEvents;        // undefined or total 0 → no count
}): { signals: { count: string; title: string }; events: { count?: string; title: string } };
```

Counts use `toLocaleString("en-US")`. Titles come from `HINTS` (`tabSignals(n, k?)`, `eventsCount`, `nearby` passed through). `SignalExplorer` gets the prop `eventsTab?: TabEvents` (App passes what it passed to the strip as `events` today, mapped) and drops its count line. The tab buttons keep `flex: 1 1 0` so a count never changes their box.

### DW15: Next-step hints, default for Jan

The hints of D-072 go into the legend header's name cell (DW12 `hint`). Alternatives: in the plot's top-left corner (covers data), in the window header (crowds it again), drop them (the manual and the B pill's tooltip already say it). Default: name cell; Jan can veto.

### DW16: Missing-signal text, default for Jan

`missing` (7 characters, muted pill), tooltip `Missing: <dataRef> has no signal <name>`. Alternatives: `not in this session` (19 characters, wrong outside a case), `n/a` (reads like a value), an em dash only (no state word). Default: `missing`; Jan can veto.

### DW17: Context row for a scope, default

The scope head moves into the same row and slots (`SCOPE`, the ref with its start in the tooltip, the duration, Widen, Clear; D-095 drops the start slot from both), so a scope and a catalog look alike and nothing jumps between them. Alternative: keep a one-line scope head inside the strip (the strip would again have a head line). Default: the row.

### DW18: Hints table entries (`help/hints.ts`, pinned; one task owns the file)

Other areas call these and stub them until the help task lands:

- `HINTS.link(on: boolean)`: `Link time axes: on, all windows show one range` / `Link time axes: off, each window keeps its own range`
- `HINTS.stripInfo(recorded)` (D-094): `Time strip: the whole recording (<recorded>); the line shows where data exists, a break a gap. Click to jump, drag to zoom, double-click for all`; `SCOPE_HINTS.info(span)` likewise without `Each bar is …`
- `HINTS.stripFlag(name: "A" | "B", clock: string, where: "view" | "outside" | "before" | "after")` (D-094, D-095; `clock` `HH:MM:SS.mmm`, for `before`/`after` `YY-MM-DD HH:MM:SS.mmm`): `A 15:09:12.000: click centres the view on A, span kept · Shift+A`; `A 11:31:10.000, outside the view: click centres the view on A, span kept · Shift+A`; `A 26-10-13 10:02:00.000, before the strip's start: click centres the view on A, span kept · Shift+A`; `B 26-10-13 12:31:40.000, after the strip's end: click centres the view on B, span kept · Shift+B`
- `HINTS.stripFlagAB(clockA: string, clockB: string)` (D-095): `A 15:09:12.000 and B 15:09:12.950: click centres the view on both; Shift+A or Shift+B for one`
- `HINTS.duration`: removed by `add-range-picker` (D-095: the duration tag's tooltip is the value in words, `durationTip`)
- `HINTS.badge(kind, width?)`: `raw: …`, `agg <w>: …`, `part <w>: …` (no ` · ` after the kind)
- `HINTS.missing(dataRef, name)`: `Missing: <dataRef> has no signal <name>`
- `HINTS.tabSignals(n: number, matches?: number)`: `Signals: <n> signals; drag a row onto a window, or press + · /`, searching `Signals: <k> of <n> match; drag a row onto a window, or press + · /` (replaces the string)
- `HINTS.windowMenu`: `Window menu: line, step, markers, min/max, rename, remove`
- `HINTS.more`: `More: digits, + values window` (D-095: Share never in the menu; the `share` argument goes)
- `HINTS.backToSearch`: `Back to search: the tool that opened these sessions` (D-095, critic 12)
- `HINTS.sidebarToggle(open)`, `HINTS.back`, `HINTS.reset`, `HINTS.eventsCount`, `HINTS.help` unchanged

`CASE_HINTS` (`case/sessionBar.ts`) keeps `align` (now the radio group's tooltip) and the rest, and gains `position(words)` = `Sessions of the catalog, aligned at <words>` and `positionLabel(k, n, words)` = `Session <k> of <n>, aligned at <words>: sessions and align` (D-095); `SCOPE_HINTS` (`time/scope.ts`) unchanged.

## Risks / Trade-offs

- [Two changes edit the top row and window header at once] → DW0's `range-control` slot and the list of shared requirements; the pacer orders the archives.
- [Optimistic slots disagree with the server, e.g. a step clamped or refused] → a refusal restores the current slots at once; an accepted result's revision replaces the pending slots with `workspace.case.entry`, which is the same entry.
- [The render acknowledgement never comes (a window fails to draw)] → `WindowBoundary` already reports a failed window as drawn with an error (H6); the progress line therefore ends.
- [`ch`-based widths differ between fonts] → slots use the measured width of their longest text, checked by the probe at 1440×900 and 1000×557, not a fixed pixel count in code reviews.
- [Hiding revision and build from view hurts debugging] → both stay one hover away and in `kipscope state`/`/api/meta`.
- [`?` and Share always in the row might wrap at 1000×557 with a long view title or the Read-only pill (estimate: ≈ 765 px of controls in ≈ 790 px beside the 208 px sidebar)] → the title shrinks to `10ch` first (saved-views); "Top row stays one line" and "Share in the row when there is room" check it; if it still wraps, a finding for Jan (D-095 says Share stays in the row).
- [After a cold load at a session without data for a shown signal the legend lacks its display name and unit, and the first step into a session with data moves the legend columns about 35–40 px once] → accepted as rare by D-096 („a, so lassen"); "Probe during a step" starts from known metadata (DW24); backlog: signal metadata per data ref (`docs/status.md`).
- [Flags hang 7 px below the strip over the gap above the windows] → the gap is empty (no control there); a press there that misses a flag reaches the window grid as before.

## Migration Plan

Web-only; no state, route or storage format changes. `kipscope.sidebar`, `kipscope.learned`, `kipscope.eventsScope` keep their meaning. Rollback = revert the web commit.
