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

## Goals / Non-Goals

**Goals:** every requirement of the deltas with web-only changes; every interface two engineers share pinned below so `case/`, `bar/`, `chart/`, `window/`, `time/`, `footer/`, `explorer/`, `values/`, `help/` and the root files (`App.tsx`, `ack.ts`, `styles.css`) can be built in parallel; one repeatable layout check (DW1).

**Non-Goals:** the proposal's "Out of scope"; no shared type, route or CLI code change.

## Decisions

### DW0: Split with `add-range-picker`

This change does not touch `time-navigation` or timeseries-window "Header shows the plotted range" / "Header range in milliseconds". It refers to "the range control": today the Go to field and the Span select, after `add-range-picker` its range button. The **slot contract**: `bar/OptionBar.tsx` renders the range control inside one `<span className="range-control">` placed after Views' separator and before Back; `add-range-picker` puts its button inside that span and drops Span there. With link off, the window header's range (`span.range`) keeps today's text until `add-range-picker` defines it; with link on, this change removes it, but only once the range button shows the range (task 3.4 waits for it; workspace-layout "Linked windows show the range once"), so the range is never unreadable. Until then other specs' scenarios that read "the header shows <range>" keep working.

Requirements this change MODIFIES that a sibling might also want: timeseries-window "Option bar" and "Link toggle", design-language "Controls", guidance "Explained labels" (Span left out of the list; its tooltip stays while the select exists), workspace-layout "Compact window header" and "Header truncation". Whichever change archives second rebases its delta on the synced text.

### DW1: Layout probe (pinned; the UI user runs it as is)

Run in the page (Chrome tool `javascript_tool`) after the setup and before the action; `window.__layoutProbe.stop()` after it returns the elements that moved or resized more than 1 px (empty list = pass). It re-queries by selector and index each frame, so a re-rendered element with the same box passes, and a vanished one fails. Do not scroll while it runs.

```js
(() => {
  const SEL = [
    ".option-bar-slot button", ".option-bar-slot select", ".option-bar-slot .range-control",
    ".context-row", ".context-row .slot-label", ".context-row .session-arrow",
    ".context-row .session-position", ".context-row .slot-title", ".context-row .slot-times",
    ".context-row .slot-duration", ".context-row .slot-action", ".time-strip",
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

The class names in `SEL` are pinned (DW3, DW8, DW10, DW11, DW12; `.status-strip`, `.conn`, `.attribution`, `.plot`, `.window-menu-button`, `.option-bar-slot` exist today). Wait for the end of an action by `!document.querySelector(".session-progress")` plus 500 ms.

### DW2: Numbers and what ×2 would do

| Number | Origin | ×½ | ×2 |
|---|---|---|---|
| times slot 268 px (12 px font) | mock | cuts every time text | at a 760 px row (1000×557, sidebar open) leaves the title < 0 |
| duration and action slots 64 px | mock | cut `10.8 min`, `Unlink` | 64 px less title each |
| `k / n ▾` width from `<n> / <n> ▾` | stable rule | n/a (derived) | n/a |
| title ≥ 160 px before the label drops | judgment | 11 characters left at compact width, still a hint with tooltip | label drops at 1440×900 never (1200 px row leaves 568 px) — harmless |
| row ≤ 32 px, strip goal 44 px, ≤ 56 px | mock, D-056 | below 26 px controls / 24 px bars: impossible | costs plot share (Screen use ≥ 30 %) |
| progress line 2 px | mock | 1 px hard to see | 4 px still no layout effect (absolute) |
| note ≤ 470 px, title ≥ 8 ch | mock | note ~30 chars + tooltip | no title left at 1000 px |
| mode tag slot 64 px | mock | cuts `part 1.5 min` | 64 px less title in a 480 px window |
| cursor column = width of `A 00:00:00.000` (≈ 84 px) | stable rule | cuts every header | 3 columns > 480 px window |
| probe tolerance 1 px | fractional layout ≤ 0.5 px | flags sub-pixel rounding | still catches the measured 355 px moves |
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

Pinned classes (CSS in `case/case.css`, imported by both): `.context-row` (grid, one line, ≤ 32 px, `position: relative`, `container-type: inline-size`), children in order `.slot-label`, `button.session-arrow[aria-label="Previous session"]`, `.session-menu > button.session-position`, `button.session-arrow[aria-label="Next session"]`, `.slot-title` (holds `.slot-title-text` and, when present, `.session-open-note`), `.slot-times` (holds `.slot-weekday`, the text, and `sup.slot-plus` for `⁺¹`), `.slot-duration`, `.slot-action` (second `.slot-action` for Clear in the scope row), `.session-progress` (absolute, 2 px, bottom edge, only while `progress`), `.skeleton` (grey block inside a slot). The scope row puts empty `.session-arrow` and `.session-position` placeholders of the same width with `visibility: hidden`, so its slots line up with the session bar's. Widths: label 64 px, arrows 26 px, position `calc(<n> / <n> ▾ in ch)`, times 268 px, duration 64 px, action 64 px; the title takes the rest (`minmax(0, 1fr)`). Below a measured row width (≈ 860 px: the width at which the title keeps 160 px with the label; written as a comment in `case.css`) a container query hides `.slot-label` (`display: none`; it is a mode, not a step). All slots `font-variant-numeric: tabular-nums`.

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

`App.tsx` keeps `pending: number | undefined` and `progress: boolean`. In `caseCommand` it sets `pending = pendingTarget(…)` and `progress = true` before sending; on a refused result both clear at once; on an accepted one it keeps both until the result's revision is rendered. `ack.ts` gains `onRendered?: (revision: number) => void`, called when `trySend` sends a revision (every window reported it; with no window at once). `TimeStrip` gets `stepping?: boolean` (`= progress`): while true, and afterwards until the density for the current `(dataRef, scope)` key is loaded, bars draw in the skeleton colour (slate-200), no accent bars, no window, no pins.

### DW5: Session slots (`case/sessionBar.ts`, pure)

```ts
export interface SessionSlots {
  label: "SESSION" | "VEHICLE";
  /** `<k> / <n>`; `positionCh` = length of `<n> / <n>` (constant per catalog). */
  position: string;
  positionCh: number;
  /** undefined → skeleton. */
  title: string | undefined;
  titleTooltip: string | undefined;
  weekday: string | undefined;          // "Tue"
  times: string | undefined;            // "2026-10-13  15:06:54 – 15:17:42" or "2026-10-11 – Wed 2026-10-21"
  timesTooltip: string | undefined;     // full local from – to
  plusOne: boolean;
  duration: string | undefined;         // formatSpan
  action: "Unlink" | "Link";
  pending: boolean;
}
export function sessionSlots(
  c: WorkspaceCase | undefined,
  scope?: WorkspaceScope,
  catalog?: CaseCatalog,
  pending?: number,
): SessionSlots;
/** The times slot of any range (also the scope row's): same day, ⁺¹, or dates only from 2 days. */
export function timesSlot(from: bigint, to: bigint): Pick<SessionSlots, "weekday" | "times" | "timesTooltip" | "plusOne">;
```

Day boundaries are local calendar days of `from` and `to` (`to` exclusive is still its own calendar day: 23:00 – 00:00 next day is `⁺¹`). `sessionBarText` goes; its test "describes the session" is replaced by "fills the session slots".

### DW6: Catalog list with Align (`case/SessionBar.tsx`)

`CatalogList` gains, at its foot, `<div role="radiogroup" aria-label="Align">` with one `button role="radio"` per `alignItems(c.align, catalog?.entries)` item (labels unchanged); `AlignMenu` and its button are removed. Choosing an unchecked item: close the list, send `case.align`. The list's rows, filter and back link are unchanged (the mock's column layout and `Event…` are illustration).

### DW7: Open note (`case/`, root)

The note renders inside `.slot-title` after `.slot-title-text`: `span.session-open-note[role=status]` (max-width 470 px, `flex: 0 1 auto`, text truncating) with its ✕ inside; `.slot-title-text` has `min-width: 8ch`. `App.tsx` sets `openNote` from `openNoteText` and no longer calls `showResult(caseOpenEvents(…))` for an open; `caseOpenEvents` may stay exported for tests. The CLI path needs no code (DW0 table: `data.case` already printed).

### DW8: Top row (`bar/`, root)

Order (timeseries-window "Option bar"): `[sidebar]` (root, `App.tsx`) `Views [title] [Read-only] | .range-control | Back Reset Link | A B Diff · flex · Share… ⋯ ?`. Icons are inline SVG with the mock's paths (`docs/design/declutter/Main.dc.html`: sidebar `rect+line`, Back `polyline 9 14 4 9 9 4 + path`, Reset `two polylines + two lines`, Link `two paths`, More three circles), stroke `currentColor`, 14–16 px, `aria-hidden`. "Link time axes" is `button[aria-pressed]` sending `workspace.setLinkTime`. `OverflowMenu` content: Digits, + Values window always; Share… only below the Share threshold (`.option-bar .overflow-item` on Share alone; re-measure, comment in `bar.css`). "?" is rendered by `App.tsx`'s `helpTail.row` without `overflow-item`; `helpTail.menu` is dropped. Hints: `HINTS.link(on: boolean)` (W1 wording, ≤ 140 characters), `HINTS.sidebarToggle(open)` unchanged words with `s`.

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

`TimeStrip` loses the head (`time-strip-head`, `time-strip-range`, `time-strip-events`, `time-strip-info`) and the props `sessionBar` and `onOpenEvents`; it gains `stepping`. The track (`.time-strip-track`) gets `title` = `[info, hint].join("\n")` where `info = stripLabel(density, labelRange)` and `hint` = `HINTS.stripInfo(…)` (reworded to start `Time strip: the whole recording (`) or `SCOPE_HINTS.info(…)`; while loading `Loading recording…`; failure: its message. State texts (`No signal shown`, `No scope set`, `Recording unavailable`) and the drop text render in one `.time-strip-note` absolutely centred in the track. `barTitle(d, i, info?: string)` appends `\n<info>` when given. Strip height goal 44 px: bars 24 + drive row 7 + pins, paddings.

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

The scope head moves into the same row and slots (`SCOPE`, ref, times, span, Widen, Clear), so a scope and a catalog look alike and nothing jumps between them. Alternative: keep a one-line scope head inside the strip (the strip would again have a head line). Default: the row.

### DW18: Hints table entries (`help/hints.ts`, pinned; one task owns the file)

Other areas call these and stub them until the help task lands:

- `HINTS.link(on: boolean)`: `Link time axes: on, all windows show one range` / `Link time axes: off, each window keeps its own range`
- `HINTS.stripInfo(recorded, width)`: starts `Time strip: the whole recording (<recorded>).`, rest as today
- `HINTS.badge(kind, width?)`: `raw: …`, `agg <w>: …`, `part <w>: …` (no ` · ` after the kind)
- `HINTS.missing(dataRef, name)`: `Missing: <dataRef> has no signal <name>`
- `HINTS.tabSignals(n: number, matches?: number)`: `Signals: <n> signals; drag a row onto a window, or press + · /`, searching `Signals: <k> of <n> match; drag a row onto a window, or press + · /` (replaces the string)
- `HINTS.windowMenu`: `Window menu: line, step, markers, min/max, rename, remove`
- `HINTS.more(share: boolean)`: `More: digits, + values window` and `…, share` when Share is inside
- `HINTS.sidebarToggle(open)`, `HINTS.back`, `HINTS.reset`, `HINTS.eventsCount`, `HINTS.help` unchanged

`CASE_HINTS` (`case/sessionBar.ts`) keeps `align` (now the radio group's tooltip) and the rest; `SCOPE_HINTS` (`time/scope.ts`) unchanged.

## Risks / Trade-offs

- [Two changes edit the top row and window header at once] → DW0's `range-control` slot and the list of shared requirements; the pacer orders the archives.
- [Optimistic slots disagree with the server, e.g. a step clamped or refused] → a refusal restores the current slots at once; an accepted result's revision replaces the pending slots with `workspace.case.entry`, which is the same entry.
- [The render acknowledgement never comes (a window fails to draw)] → `WindowBoundary` already reports a failed window as drawn with an error (H6); the progress line therefore ends.
- [`ch`-based widths differ between fonts] → slots use the measured width of their longest text, checked by the probe at 1440×900 and 1000×557, not a fixed pixel count in code reviews.
- [Hiding revision and build from view hurts debugging] → both stay one hover away and in `kipscope state`/`/api/meta`.
- [`?` always in the row plus Share at 1440 might wrap with a long view title] → the title shrinks to `10ch` first (saved-views), Share moves below its measured threshold; "Top row stays one line" checks it.

## Migration Plan

Web-only; no state, route or storage format changes. `kipscope.sidebar`, `kipscope.learned`, `kipscope.eventsScope` keep their meaning. Rollback = revert the web commit.
