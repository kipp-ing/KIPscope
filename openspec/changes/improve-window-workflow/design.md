# Design: improve-window-workflow

## Context

See proposal.md for the why. Current state that shapes the approach:

- All workspace changes are commands applied by the pure `applyCommand` in `packages/shared/src/apply.ts` (D-011 D8); the server only validates and stores (`apps/server/src/workspace.ts`). The workspace lives in server memory only, so new fields need no migration.
- Each window owns its range; `TimeseriesWindow.tsx` previews zoom/pan locally and commits `window.setRange` 300 ms after the last gesture.
- `build.ts` already keys y scales by unit (`u:<unit>`), but draws up to four axes alternating sides with rotated canvas labels; colours come from the signal's index within the window, so the first signal is blue everywhere.
- Window titles: `w.title ?? w.id`; the explorer's "Add to" lists the same, so untitled windows show `w6`.

### Bug analysis (evidence from the running dev server and carserver, 2026-10-14)

- **"1036-01-11 … 3937-05-09" (`CPC_448h.PTC_HV_Volt`):** the signal's extent is fine (`/api/extent` → `1791722064884000000` … `1791897453175000000`, 57,280 rows, no timestamp before 2020 or after 2027). The live workspace holds window `w23` with `range.from = "-29473328485867940608"` and `range.to = "62083631947910636800"` — both outside int64 and exactly the displayed years. Cause: zoom-out (button ×2 span, wheel zoom) has no bound, and neither `TimeInput` nor `applyCommand` bounds a timestamp. Fix: D7.
- **`AC_A1.T_SOLL` at −40 °C:** h-can.dbc `SG_ T_SOLL : 40|8@1+ (0.5,-40) [-40|63] "°C"`, `VAL_ 1106 T_SOLL 255 "NO_TEMP_SENSOR" 254 "SENSOR_DEF" 253 "KURZSCHLUSS"`, `GenSigSNA` raw 255 → physical 87.5. All 57,282 stored values are −40 = raw 0. Raw 0 has no SNA code and no label, so by D-010/D-014/D-015 it is a valid value. Correct behaviour; stated in the timeseries-window delta.
- **`MS_312h.DNMOT` near −120:** all 572,798 values are −127 = raw 0, valid by D-012 (SNA is raw 255 → 128). The y axis of a flat line is padded by 10 % (−139.7 … −114.3), so a tick reads −120. Correct behaviour; already in the main spec ("Valid constant, no SNA").
- **Garbled "°C":** the API delivers the unit correctly (`/api/signals?q=T_SOLL` → code points `0xB0 0x43`, `charset=utf-8`; the DBC is decoded as latin1). The fault is in drawing the rotated canvas label into a fixed 60 px axis. Fix: D3 draws axis titles as HTML text, never rotated.

## Goals / Non-Goals

**Goals:** every new user action is a command first (CLI-ready, concept §7); the web builds on pure, unit-tested helpers so server-free logic is covered by vitest; server and two web engineers can work in parallel against the interfaces below.

**Non-Goals:** see proposal "Out of scope". No change to the series payloads or the loader.

## Decisions

### D1 Shared types (`packages/shared/src/workspace.ts`, `time.ts`) — pinned

```ts
// time.ts
/** Inclusive bounds for every timestamp in commands and series requests (int64 ns and ClickHouse DateTime64 safe). */
export const TIME_MIN: Timestamp = -2_208_988_800_000_000_000n; // 1900-01-01T00:00:00Z
export const TIME_MAX: Timestamp = 9_223_286_400_000_000_000n;  // 2262-04-11T00:00:00Z

// workspace.ts
export const DEFAULT_PLOT_HEIGHT = 280;
export const MIN_PLOT_HEIGHT = 120;
export const MAX_PLOT_HEIGHT = 1200;

/** Signal palette; Workspace.colors holds indices into it. */
export const SIGNAL_COLORS = [
  "#2563eb", "#dc2626", "#16a34a", "#9333ea", "#ea580c",
  "#0891b2", "#be185d", "#4d7c0f", "#ca8a04", "#475569",
] as const;

export interface TimeseriesWindow {
  id: string;
  kind: "timeseries";
  title?: string;
  range: TimeRange;
  display: Display;
  signals: SignalAssignment[];
  /** Plot height in CSS px; absent means DEFAULT_PLOT_HEIGHT. */
  height?: number;
}

export interface Workspace {
  windows: TimeseriesWindow[];
  nextId: number;
  /** Linked time axes (D-017): while true, all windows have the same range. */
  linkTime: boolean;
  /** Window whose range was set last by window.create (with a range) or window.setRange. */
  lastZoomed?: string;
  /** Palette index per signal ID that is in at least one window. */
  colors: Record<string, number>;
}

export const EMPTY_WORKSPACE: Workspace = { windows: [], nextId: 1, linkTime: true, colors: {} };

/** Display title: the title, else "Window <n>" from the stable ID (w6 → "Window 6"). */
export function windowTitle(w: TimeseriesWindow): string;

/** Colour of a signal: SIGNAL_COLORS[colors[signalId]], or SIGNAL_COLORS[0] if unknown. */
export function signalColor(workspace: Workspace, signalId: string): string;

/** At most four units per window (D-019). */
export const MAX_UNITS = 4;
/** Unit key of a signal: its trimmed unit, or "s:<signalId>" when it has none (own scale). */
export function unitKey(signalId: string, unit: string | undefined): string;
/** Distinct unit keys of a window's signals (plus an optional extra signal), in signal order. */
export function windowUnits(w: TimeseriesWindow, unitOf: (signalId: string) => string | undefined, extra?: string): string[];
```

`ApplyContext` (apply.ts) gains an optional `unitOf?(signalId: string): string | undefined`. The server passes `(id) => catalog.get(id)?.unit`; when `unitOf` is absent the unit limit is not checked (keeps existing tests and contexts valid).

`TimeInput` rejects a parsed time `< TIME_MIN` or `> TIME_MAX` with the issue message `time outside 1900-01-01T00:00:00Z … 2262-04-11T00:00:00Z`. Commands answer `invalid_command`, series requests 400 `invalid_request` (their existing paths for `TimeInput` errors; the series route's `Time` is built on `TimeInput`, so the server needs no code change for this).

### D2 Commands and results — pinned

New and changed members of `Command` (zod, same file):

```ts
// window.create: from/to become optional, both or neither (refine → invalid_command)
{ type: "window.create", title?: string(max 200), from?: TimeInput, to?: TimeInput, mode?, envelope? }
{ type: "window.rename", windowId: Id, title: z.string().max(200) }           // trimmed; "" removes the title
{ type: "window.setHeight", windowId: Id, height: z.number().int().min(120).max(1200) }
{ type: "window.moveSignal", windowId: Id, assignmentId: Id, targetWindowId?: Id, copy?: boolean }
{ type: "workspace.setLinkTime", linked: z.boolean() }
```

`CommandErrorCode` gains `"already_in_window"` and `"too_many_units"`. `CommandResult` (and `ApplyResult`) ok variant: `{ ok: true; revision: number; created?: string; createdWindow?: string }`. `WorkspaceStore.execute` passes `created` and `createdWindow` through when present.

`applyCommand` semantics:

| Command | Effect |
|---|---|
| `window.create` with range | Linked: every existing window and the new one get the range. Unlinked: only the new one. `lastZoomed` = new ID. |
| `window.create` without range | Linked and ≥ 1 window: takes the shared range (`windows[0].range`). Otherwise `invalid_range` "from and to are required". `lastZoomed` unchanged. |
| `window.setRange` | Linked: all windows get the range. Unlinked: that window only. Both: `lastZoomed` = `windowId`. |
| `workspace.setLinkTime` | `linked: true`: all windows take the range of `lastZoomed` if it exists, else of `windows[0]`; no windows: flag only. `linked: false`: flag only. Always accepted. |
| `window.moveSignal` | Errors: unknown source window `unknown_window`, unknown assignment `unknown_assignment`, unknown target `unknown_window`, target already shows the signal (including target = source) `already_in_window`, an existing target that would exceed `MAX_UNITS` `too_many_units` (a new window never does). Move: the assignment leaves the source and is appended to the target with **the same assignment ID**. Copy: a new assignment `a<nextId>` is appended (`created`). No target: a new window `w<nextId>` is appended with the source's range, display and height and no title (`createdWindow`), then move/copy into it. A source left empty stays. `colors` unchanged. |
| `window.rename` | Sets the trimmed title; empty after trim removes `title`. |
| `window.setHeight` | Sets `height`. |
| `window.addSignal` | As before, plus: if the window would show more than `MAX_UNITS` unit keys, `too_many_units` with a message like `a window shows at most 4 units (has: V, km/h, °C, 1/min)`. If the signal was in no window, `colors[signalId]` = the palette index used by the fewest signals in `colors` (ties: lowest index). |
| `window.removeSignal`, `window.remove` | As before; then `colors` entries of signals in no window are deleted; `window.remove` of `lastZoomed` deletes `lastZoomed`. |

Why a command for move rather than remove + add in the UI: one revision, the assignment ID and colour stay, and the CLI gets the same action (concept §7).

Why the linked range is enforced in `applyCommand` rather than in the browser: the CLI's `window.setRange` must behave like a UI zoom, and the invariant "linked ⇒ all ranges equal" then holds for every caller. Alternative considered: a separate `workspace.range` field — rejected because every window would need two range sources and the series loader reads `window.range`.

Colours in the workspace rather than derived in the browser: a derived colour shifts when other signals are removed; a stored index survives moves, reloads and is readable by the CLI. Ten colours: with 5 a typical 6-signal workspace repeats colours; with 20 neighbouring colours become hard to tell apart.

### D3 Axis layout (`apps/web/src/chart/axes.ts`, used by `build.ts`) — pinned

```ts
export interface AxisInput { key: string; label: string; unit?: string; color: string }
export type Side = "L" | "R" | "L2" | "R2";
export interface AxisSpec { scale: string; side: Side; title: string; color?: string }
export interface AxisLayout {
  /** Scale key per signal key: "u:<unit>" or "s:<key>" for signals without unit. */
  scaleOf: Map<string, string>;
  /** Drawn axes, one per scale, at most four: "L", "R", "L2", "R2" in scale order. */
  axes: AxisSpec[];
  /** Per signal key: its axis side; undefined only beyond four scales (guard, see below). */
  sideOf: Map<string, Side | undefined>;
}
export const MAX_AXES = 4; // = MAX_UNITS
export function layoutAxes(inputs: AxisInput[]): AxisLayout;
```

Rules: the unit is trimmed; an empty unit counts as none (same key rule as `unitKey`). Scales are ordered by first appearance in the window's signal list (all assigned signals, loaded or not, so sides do not jump when data arrives). Title = unit, or the signal label for a unit-less scale. `color` = the signal's colour when exactly one signal uses the scale, else undefined (neutral text colour). `buildModel` takes the layout's `scaleOf` instead of `scaleKey` and exposes `ChartModel.layout: AxisLayout`; `ChartModel.scales` keeps every scale key (drawn or not) with its title.

**Stacked axes (D-019):** "More than two units in a window: stacked axes, up to two per side (at most four units), the plot area gets narrower. Every value stays readable." Scale 1 → `L` (next to the plot), 2 → `R` (next to the plot), 3 → `L2` (outer left), 4 → `R2` (outer right). The plot width is the window width minus the axis sizes. If `layoutAxes` ever gets more than four scales (prevented by the commands; possible only if units change in the DBC after a restart), scales beyond four get no axis and the legend shows `–`: a guard, not a feature. With four axes of ~60 px a 1280 px window keeps ~1000 px of plot; at twice the axis width it still keeps ~750 px.

Axis titles are HTML text in a row directly above the plot, each centred over its axis column (positions from uPlot's axis sizes), in the axis colour, cut with an ellipsis to the column width and full as tooltip; uPlot axes get no `label`. The uPlot axis `size` is computed from the widest tick label + 12 px so tick labels are never cut.

### D4 Zoom helpers (`apps/web/src/chart/zoom.ts`) — pinned

```ts
export interface Range { from: bigint; to: bigint }
/** Shifts a range into [TIME_MIN, TIME_MAX] keeping its span; a span wider than the bounds becomes the bounds. */
export function clampRange(r: Range): Range;
/** Union of signal extents: from = min first, to = (max last / 1 ms + 1) × 1 ms (half-open). Undefined for []. */
export function extentRange(extents: { first: string; last: string }[]): Range | undefined;
export const ZOOM_HISTORY_LIMIT = 50;
export class ZoomHistory {
  constructor(limit?: number);
  /** Pushes the range shown before a committed gesture; ignored if equal to the top; drops the oldest beyond the limit. */
  push(r: Range): void;
  /** Pops the most recent range, undefined when empty. */
  back(): Range | undefined;
  get size(): number;
}
/** History key: one shared history while linked ("*"), else per window ID. */
export function historyKey(linked: boolean, windowId: string): string;
```

Every zoom, pan, zoom-out, double-click reset and history step passes `clampRange` before it is previewed or sent.

**Wheel zoom (lead decision, round 5), in `TimeseriesWindow.tsx`:** one wheel tick scales the span by `WHEEL_TICK_FACTOR = 2 ** (1 / 5)` (≈ ×1.149), so five ticks halve or double the span, centred on the pointer. A tick is 100 px of `deltaY` (pixel mode) or 3 lines (line mode); one wheel event counts at most `WHEEL_MAX_TICKS = 5` ticks (≤ ×2), so a fast flick or a trackpad burst cannot jump many orders of magnitude. Off by 2: 2^(2/5) per tick halves in 2.5 ticks and feels jumpy on a mouse wheel; 2^(1/10) needs 10 ticks per halving and feels sluggish; neither breaks anything, the feel is Jan's to judge.

The tick-to-factor rule is a pure function in `zoom.ts`, tested by `apps/web/test/zoom.test.ts` › "wheel factor is 2 per 5 ticks, capped at 5 ticks per event". Page mode (`deltaMode` 2) counts one page as five ticks, i.e. the cap. A horizontal wheel delta, or a vertical one with Shift, pans instead of zooming: d px of delta moves the range by d plot pixels' worth of time, span unchanged.

Minimum span `MIN_SPAN_NS = 100` (`TimeseriesWindow.tsx`): a zoom below 100 ns is ignored. Off by 2: 50 ns or 200 ns both stay below the 1 µs ticks the axis can label distinctly; nothing breaks.

Calendar ticks (`calendarTicks` in `time/axis.ts`): when weekly date labels no longer fit, the x axis labels local month starts every n ∈ {1, 2, 3, 6, 12, 24, 60, 120, 240, 600, 1200} months at `CALENDAR_LABEL_PX = 80` per label, `YYYY-MM` or `YYYY` for n ≥ 12. Needed once zoom-out reaches the 1900 … 2262 bounds (round 1: smeared axis). Off by 2: 40 px lets labels overlap, 160 px halves the label count; both readable, neither breaks.

History limit 50: 25 would still cover a session's back-steps; 100 costs nothing either; the number is not critical.

### D5 Drag and drop (`apps/web/src/chart/drag.ts`) — pinned

```ts
export interface DragSource { windowId: string; assignmentId: string; signalId: string }
export type DropTarget = { kind: "window"; windowId: string } | { kind: "new" };
export const DRAG_THRESHOLD_PX = 4;
/** A window accepts a drop when it is not the source, does not show the signal yet and keeps ≤ MAX_UNITS units; "new" always accepts. */
export function canDrop(
  source: DragSource, target: DropTarget, windows: TimeseriesWindow[],
  unitOf: (signalId: string) => string | undefined,
): boolean;
/** The window.moveSignal command for a drop, copy when altKey or ctrlKey; undefined when !canDrop. */
export function dropCommand(
  source: DragSource, target: DropTarget, windows: TimeseriesWindow[],
  unitOf: (signalId: string) => string | undefined,
  mods: { altKey: boolean; ctrlKey: boolean },
): CommandInput | undefined;
```

Pointer events, not HTML5 drag-and-drop: Esc, the hint and the ghost are under our control, and the UI user's browser automation can drive pointer drags (native DnD from synthetic events is unreliable). The legend row's grip (the colour swatch plus name) starts a drag after `DRAG_THRESHOLD_PX` of movement; 2 px would turn clicks into drags, 8 px still feels immediate. While dragging: a ghost with the signal name follows the pointer; every window with `canDrop` gets class `drop-target` and the hint "Drop to move · Alt/Ctrl+drop to copy"; a window refused only by the unit limit gets class `drop-refused` and the hint "At most 4 units per window"; the source window is dimmed; a zone "+ New window" (`data-drop="new"`) appears below the last window. The target under the pointer is found with `document.elementFromPoint(...).closest("[data-window-id],[data-drop]")`; each window's `<section>` carries `data-window-id`. Release over a valid target sends `dropCommand`; release elsewhere or Esc cancels without a command. The context menu is suppressed while dragging (Ctrl+drag on macOS).

### D6 Web component contract (`App.tsx` ↔ `chart/TimeseriesWindow.tsx`) — pinned

```ts
interface Props {
  window: WindowState;
  revision: number;
  info: (signalId: string) => SignalInfo | undefined;
  /** From signalColor(workspace, id). */
  colorOf: (signalId: string) => string;
  onCommand: (command: CommandInput) => Promise<CommandResult>;
  onReady: (windowId: string, revision: number, errors: RenderError[]) => void;
  /** Called once per committed zoom/pan/zoom-out gesture with the range shown before it. */
  onZoomed: (windowId: string, previous: Range) => void;
  canGoBack: boolean;
  onBack: (windowId: string) => void;
  /** Double-click on the plot: App fetches the extents, pushes history, sends window.setRange. */
  onReset: (windowId: string) => void;
  /** Pointer down on a legend row's grip. */
  onDragStart: (source: DragSource, event: React.PointerEvent) => void;
  /** Highlight while a drag runs: "source", "target" (canDrop), "refused" (unit limit), or undefined. */
  dropState?: "source" | "target" | "refused";
  /** Plot left/right inset in CSS px (max natural axis width per side over all windows), so windows line up. */
  insets?: { left: number; right: number };
  /** Reports this window's natural axis widths per side (sum of its drawn axes) whenever they change. */
  onInsets?: (windowId: string, natural: { left: number; right: number }) => void;
}
```

`TimeseriesWindow` owns: header (title with inline rename, badges, range, Mode, Min/max, Back, Zoom out, Remove), axis title row, plot with height handle, legend rows (swatch, name, unit, axis side, status, SNA share, remove). `App` owns: top bar toggle "Link time axes", drag state and ghost, drop zone, the `ZoomHistory` map, Backspace, double-click reset, the hovered-window tracking. The two can be built in parallel against these props.

Zoom history wiring: `onZoomed` pushes into `historyKey(linked, windowId)`; Back (button or Backspace) pops and sends `window.setRange` without pushing. Backspace is ignored while focus is in an input, select, textarea or contenteditable element (pure helper, tested in `apps/web/test/keys.test.ts`); its target is the window under the pointer, else `workspace.lastZoomed`. Double-click overrides uPlot's default dblclick (which would reset to the loaded data only).

Linked windows: the zooming window previews locally as today; the others update when the accepted range arrives with the next revision (300 ms debounce + round trip). Live following during the gesture is a goal, not part of this change.

Aligned plot insets (lead decision, round 5): each `TimeseriesWindow` reports its natural left and right axis widths (sum of its drawn axes per side) through `onInsets`; `App` drops entries of removed windows, takes the per-side maximum with a pure helper (tested in `apps/web/test/insets.test.ts`) and passes `insets = { left: max over windows, right: max over windows }` as an optional prop (`insets?: { left: number; right: number }`), and each window pads its narrower side up to that inset. All plots then share the same x pixel range, so one timestamp sits at the same x in every window of equal width. Unequal axis counts (one window with `L2`, one without) are the case it exists for.

Crosshair (lead decision, round 5; mechanism from the close-out): the crosshair is hidden when the pointer leaves the plot (uPlot's own mouseleave) and right after every range change made in the window (wheel zoom, wheel pan, drag-select, "Zoom out", double-click reset) by adding the CSS class `cursor-hidden` to the uPlot root; the next `mousemove` over the plot removes it. CSS rather than `setCursor` off-plot, because moving uPlot's cursor off-plot left a stale drag start, so a drag flicked out of the plot zoomed to a wrong range (round 5 reviewer finding). A crosshair frozen at the pre-zoom pixel would point at a wrong time.

Zoom history is held in `App` per browser tab (a `Map` of `ZoomHistory`), not in the workspace: it is view navigation, a step back is sent as an ordinary `window.setRange`, and a reload starts empty. Putting it into the workspace would make every zoom two pieces of state and was not asked for.

Header range: `formatRange` (`time/axis.ts`) shows local time cut to milliseconds, trailing zero groups dropped; committed ranges carry nanoseconds (history, extents), which made the header unreadable (round 1).

Height: a 6 px handle under the plot (`cursor: ns-resize`) resizes locally while dragged and sends `window.setHeight` (clamped to 120–1200) on release. 120 px still shows a curve with two tick labels; 60 would not; 1200 exceeds a laptop screen, which is harmless.

Rename: clicking the title turns it into a text input; Enter or blur sends `window.rename`, Esc cancels. The header is one line (`flex-wrap: nowrap`); the title truncates with an ellipsis and shows the full title as tooltip; the range text may truncate too; the buttons never move to a second line.

Windows created from the UI are untitled (lead decision, round 5): moves into "+ New window" and the explorer's "New window" path send no `title`, and `windowTitle` shows "Window <n>" by the stable ID. A signal-name title would go stale as soon as that signal is moved out. While linked and at least one window exists, the explorer creates the new window without a range (it takes the shared range); otherwise it sends the extent as today.

### D7 Time bounds (bug fix)

`TimeInput` bounds every command and series time (D1); `clampRange` keeps the UI inside them (D4). An already stored out-of-bounds range (server memory) disappears on restart and is replaced by any zoom, reset or back step. Alternative considered: bound zoom-out to a multiple of the data extent — more useful, but needs extents for every gesture; left as a goal.

## Risks / Trade-offs

- [Linked by default changes `window.setRange` for CLI callers] → the result is still one revision; `workspace.setLinkTime {linked:false}` restores per-window ranges; stated in the spec.
- [Four stacked axes narrow the plot] → accepted by D-019; axis sizes follow tick-label width, not a fixed 60 px.
- [Unit limit needs units in `applyCommand`] → optional `unitOf` in `ApplyContext`; the catalog is in server memory, so the check is a map lookup.
- [Pointer drag on legend rows conflicts with the "remove" link] → only the grip starts a drag; the threshold keeps clicks clicks.
- [Garbled-label root cause not reproduced headless] → the fix removes the rotated canvas label altogether; the UI check verifies the visible text.

## Migration Plan

None: the workspace lives in server memory; a server restart starts from `EMPTY_WORKSPACE` with the new fields.
