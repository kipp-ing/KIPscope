# Design

## Context

See proposal.md (Why, base and order). Current state that shapes the approach (after `add-cursors` and `add-cli`, both built):

- **Wheel** (`chart/TimeseriesWindow.tsx`, `onWheel` on `u.over`): always `preventDefault`; Shift or a dominant horizontal delta pans, else `wheelZoomFactor(deltaY, deltaMode)` zooms at the pointer (`chart/zoom.ts`, 2^(1/5) per 100 px tick, ≤ 5 ticks per event). Range changes run through the window's `RangePreview` and one `window.setRange` after a commit delay; `onZoomed(windowId, previous)` pushes App's history.
- **Zoom controls** today: window header "Back" (`canGoBack`, `onBack`) and "Zoom out" (span ×2), bar "Back" and "Reset zoom" (`bar/OptionBar.tsx`, target `barTarget`), Backspace (App, window under the pointer else `lastZoomed`), double-click reset (`onReset(windowId)`).
- **History** (App): `histories: Map<historyKey, ZoomHistory>`, key `"*"` while linked; `setRange(windowId, r)` clamps and sends `window.setRange`; `onReset(windowId, signalIds?)` fetches extents and pushes history.
- **Time parsing** exists in `packages/shared/src/localtime.ts`: `parseTime` (ns, ISO with zone, local `YYYY-MM-DD[T ]HH:MM[:SS[.f]]`, refuses DST-ambiguous and nonexistent times) and `parseDuration` (`ns`…`h`). The shared test script runs with `TZ=Europe/Berlin`.
- **Numbers** today: `formatCursorNumber` (9 significant digits) in values cells and tooltips; y-axis ticks are uPlot's defaults; hover card uses `String(n)`.
- **Series data** in a window: `SeriesResult` per signal, raw (`t`, `v`, `before`, `after`) or buckets (`t` = bucket starts, `width`, `count`, `sna`, `mean`; empty buckets omitted). `evaluateAt(t, mode, at, next)` in `packages/shared/src/cursor.ts` holds the raw evaluation rules.
- **Keys**: `/` focuses the search (explorer), Backspace = Back (App), arrows/Enter/Esc only inside the search field. `improve-layout` takes `s` (sidebar) and removes the top bar; this change uses neither.

## Goals / Non-Goals

**Goals:**
- Server, CLI and four web tasks build in parallel against S1–S5.
- Every navigation is one `window.setRange` (D-021 linking applies unchanged) plus one history entry, so "Back" undoes it; no new command for navigation.
- One pure function per rule (format, axis, time input, anchor, wheel, keys, readout value), each unit-tested with pinned outputs.

**Non-Goals:**
- No window or header layout (`improve-layout`). This change only removes header controls and adds legend cells and a readout row.
- No server change: `workspace.setOptions` is validated and applied by the shared `Command`/`applyCommand` the server already uses.
- No navigation commands for the CLI (`window range` exists); no change to `GET /api/value`.

## Decisions

### N1: Wheel classification (D-025)

`wheelAction(e)` in `chart/zoom.ts` decides per event:

| Event | Action | `preventDefault` |
|---|---|---|
| Ctrl or Shift held (pinch = Ctrl) | zoom at the pointer, delta = `deltaY`, or `deltaX` if `|deltaX| > |deltaY|` (macOS Shift+wheel) | yes (stops page zoom) |
| no modifier, `|deltaX| > 2·|deltaY|` | pan by `deltaX` px | yes |
| otherwise | nothing; the page scrolls | no |

The step size stays `wheelZoomFactor`. Meta is not a zoom modifier (Cmd+wheel has no browser meaning to replace, and Jan named Ctrl and Shift). During a signal drag App's wheel handling is unchanged.

- *Alternative: only Ctrl zooms, Shift pans.* Contradicts D-025 („Ctrl+wheel or Shift+wheel zooms").
- *Alternative: no wheel pan at all.* Safer against diagonal trackpad drift, but leaves mouse users without any wheel pan; `←`/`→` cover it (Q5).

### N2: "Go to" grammar (D-027)

`resolveTimeNav(text, ctx)` in `packages/shared/src/timenav.ts`, pure, throws `RangeError(message)`:

```
INPUT   := INSTANT | INSTANT ' '? ('+'|'-'|'±'|'+-') DUR | INSTANT ' '? ('..'|' – ') ' '? INSTANT | DUR | ('+'|'-') DUR
INSTANT := YYYY-MM-DD | HH:MM[:SS[.f{1,9}]] | parseTime forms (local date-time, ISO with Z/offset, decimal ns) | 'a' | 'b'
DUR     := parseDuration forms | <decimal>'d'   (d = 24 h)
```

- An instant alone shows the period its last given digit names: date → local day (`[00:00, next 00:00)`, 23 h or 25 h across DST), `HH:MM` → 1 min, `:SS` → 1 s, `.f` with k digits → 10^−k s. Decimal ns or a cursor → centred on it, current span kept. Reason: what the user typed is the period they see; centring `15:08` with the current 3-day span would not help (testers' T1).
- Time of day without date (Q2): the latest occurrence inside the current view, else the occurrence nearest the view's centre. In the smart451 extent view `15:08` lands on 2026-10-13, the day the testers meant. A range's end time of day is the first occurrence after its start (`23:00 .. 01:00` crosses midnight).
- Local times go through `parseTime` after the date is filled in, so DST refusal and messages are the CLI's.
- `INSTANT .. INSTANT` uses both instants' starts; the header text `2026-10-13 15:08:00 – 2026-10-13 15:08:03` round-trips.
- Result: clamped into `TIME_MIN … TIME_MAX`; span < `MIN_SPAN_NS` (100 ns), reversed or empty → error.

Alternatives: *a calendar picker* (slow for keyboard users, no ranges); *Grafana-style `now-1h`* (meaningless on historical data; relative forms here pan or set a span instead); *centre-and-keep-span for `15:08`* (see above).

### N3: Readout placement (D-027, Q1 direction)

Recommended **R1**: the values at A, B and Δ are columns in each signal's legend row; a readout row above the legend rows carries the cursor times and Δt; in the plot only the Δt label sits between the flags. It covers no data, scales to the 50 signals a window can hold (one row per signal exists already), and aligns each value with its signal's name, swatch and axis side, like CANape's signal list with cursor columns.

- *R2: value labels at each cursor line, at each curve's height (CANape graphic labels).* Literally "next to the cursors", but labels cover curves and collide when curves are close; readable up to about 4–6 signals.
- *R3: a floating box beside each line listing all signals.* Next to the cursor, but covers a block of data and grows with the signal count; needs a hide toggle.

D-027 says „on the chart next to the cursors". R1 reads "on the chart" as "in the chart window" and puts only Δt literally next to the flags. If Jan means at the lines, R2 replaces 3.2's legend columns with labels in the plot; `chart/readout.ts` stays.

### N4: Readout values from the drawn data (D-024)

`chartValueAt(result, t, mode)` in `chart/readout.ts`:
- `t` outside `[result.from, result.to)` → `none / outside_range`.
- Raw: `at` = last point with time ≤ t among `before` and the points, `next` = first point > t among the points and `after` (binary search); `evaluateAt(t, mode === "step" ? "step" : "line", at, next)`. Markers mode evaluates as line: concept §6 names only lines and steps; linear is the values window's default.
- Buckets: the bucket with `start ≤ t < start + width`; `mean` null (SNA only) → `sna`; none → `none / empty_bucket`; else `aggregated(mean)`, tag `avg`.

The effective cursor (App's preview included) drives it, so the readout follows a dragged line at frame rate without requests (50 signals × binary search per frame is negligible). The values window keeps its server values (D-024).

### N5: Horizontal pan threshold

Pan only when `|deltaX| > 2·|deltaY|`. Half (×1): any diagonal trackpad scroll with drift pans, the effect testers saw. Double (×4): deliberate swipes with some vertical wobble stop panning.

### N6: Keys, anchor and history (D-027)

- `navKey(e, focused)` in `keys.ts` maps `+`/`=` → in, `-` → out, `ArrowLeft`/`ArrowRight` → left/right, with Shift → pageLeft/pageRight, `Home` → home, `t` → goTo; nothing in text fields or selects (`isTextField`), with Ctrl/Meta/Alt, or during a drag. `s` and `/` stay free for `improve-layout` and the explorer.
- Target: the timeseries window under the pointer, else `barTarget` (as Backspace). "Go to" and presets: `barTarget` (D-024's bar rule).
- Steps (`timenav.ts`): in/out = `zoomAround(view, 0.5 | 2, anchor)` keeping the anchor's position; left/right = `panBy(view, ∓0.5)`; page = `panBy(view, ∓1)`; home = App's `onReset` with `resetSignals` for that target. Anchor = A if inside the view, else centre (`navAnchor`).
- Compounding: App keeps `pendingNav: Map<windowId, Range>`, set when a step is sent and dropped once the workspace shows that range or a different one arrives; the next step starts from it. Without it, three quick presses would all start from the old server range.
- History: a press pushes the previous range (`onZoomed` semantics); auto-repeat events (`e.repeat`) join that entry and step at most every 100 ms (`NavRepeat` in `keys.ts`: `push` | `join` | `skip`).

### N7: Number format algorithm (D-026)

`formatQuantity(value, unit, digits)` in `packages/shared/src/numfmt.ts`:
1. `SNA`/`—` are never passed in; `0` and `-0` → `0` + unit.
2. Round first on the unscaled value: `r = Number(value.toPrecision(digits))`. Scaling first is wrong: `8191.5/1000` is `8.1914999…` and prints `8.191` instead of `8.192`.
3. Prefixable unit (or no unit): exponent `e3 = 3·floor(log10|r| / 3)`, clamped to −12 … 12 (p … T); the mantissa string is `r` with the decimal point moved by `e3`, padded to `digits` significant digits (trailing zeros kept). Rounding can carry (999.96 → 1000 → `1.00 k`), which step 2 handles since `r` is already 1000. Prefixes `p n µ m "" k M G T` (µ = U+00B5).
4. Not prefixable: plain decimal with `digits` significant digits (`1230`, `45.0`, `0.00100`); `toExponential(digits − 1)` below 0.001 or from 1e6.
5. Output `<number> <prefix><unit>`; no unit and no prefix → number only.

Not prefixable (`takesPrefix` false): units in `%`, `‰`, `°`, `°C`, `°F`, `dB`, `h`, `min`, `d`; units matching `^(p|n|µ|u|m|c|k|M|G|T)(m|g|s|A|V|W|Wh|Hz|Pa|bar|N|Nm|J|l|L|Ω|F)(?![A-Za-z])` (`km/h`, `kW`, `mA`, `ms`, `mbar`, `MΩ`). Everything else takes a prefix, including compound units (`1/min` → `k1/min`, D-026's own example) and `rpm/10ms`.

Trailing zeros are kept (`45.0 km/h`): Jan's example is `14.0`, and fixed digits keep columns even. Zero is `0`: `0.00` would claim a precision the value 0 does not have (Q6).

The values window loses its unit column (each cell carries the prefixed unit; values-window "Values window").

### N8: Axis ticks

`formatAxisTicks(ticks, unit, digits)`: prefix from `max |tick|` (as N7 step 3) unless the unit takes none or is absent; scaled ticks get `d` decimals, `d = max(0, −floor(log10(step)))` where `step` is the smallest positive difference of consecutive scaled ticks, raised by one while two labels are equal; all labels use `d`. The title is `<prefix><unit>`. This may exceed `digits` (362.0, 362.5, 363.0 V) because equal labels would be wrong (Q6). The axis size hook already measures the labels, so wider labels widen the axis.

### N9: Exceptions to "everywhere" (Q7)

Kept exact: times and Δt (concept §8 „Originalzeitpräzision bleibt … erhalten"), the SNA share (`SNA 15.0 %`, its own rule with < 0.1 %), DBC scaling and raw step (a rounded factor decodes wrong), and the neighbour tooltip in the values window (the exact drill-down behind a rounded reading, `formatCursorNumber`). The DBC range and SNA physical values in the hover card are readings of the signal and follow the format.

### N10: Digits option in the workspace (Q8)

`Workspace.options = {digits: 3 | 4}`, set by `workspace.setOptions`, so the CLI and every open UI see the same format and a later save/load (concept §8) stores it. CLI form `digits 3|4`. The option bar shows a select "3 digits / 4 digits".

- *Alternative: browser-local preference (`localStorage`).* No command, no CLI form, but two tabs could disagree and concept §8 counts user options as workspace state.

### N11: One Back, one Reset (D-025)

Window headers lose "Back" and "Zoom out" (TimeseriesWindow drops the `canGoBack`/`onBack` props). The bar's "Reset zoom" becomes "Reset" with the same behaviour (D-024 target, tooltip names it while unlinked). Zoom out is `-` or Ctrl/Shift+wheel. Double-click still resets the clicked window.

### N12: Default view and initial cursors (Q4 direction)

Recommended: unchanged. A new window still opens on the signal's extent (overview first, concept §5) and A/B still start at ⅓ and ⅔ of the bar target's range (add-cursors). The testers' slow path from the 3-day view to 15:08 becomes one "Go to" entry, and `a`, `a..b` bring the cursors into view.
- *Alternative: open on the last hour (or day) of the data.* Faster for "the latest drive", hides the overview, and a different signal's extent gives a different hour.
- *Alternative: cursors at the data end.* What testers saw as odd: a cursor at the extent end sits on the plot edge.

### Numbers at a factor of two

| Number | Value | Half | Double |
|---|---|---|---|
| Significant digits | 3 (Jan, option 4) | 1–2: 45 and 48 km/h read alike | 6: float noise and seven decimals return (the testers' finding) |
| Key zoom | ×2 per press | ×√2: 3 days → 1 min takes 24 presses | ×4: overshoots; a press loses most of the context |
| Key pan | ½ span | ¼: four presses per view | 1 span: no overlap for orientation (that is Shift+arrow) |
| Repeat rate | ≤ 1 step / 100 ms | 50 ms: 20 `setRange`/s, reloads pile up behind the 4 query slots | 200 ms: a held arrow moves 2.5 views/s, sluggish |
| Pan threshold | Δx > 2·Δy | see N5 | see N5 |
| Instant spans | the digit named (1 min for `15:08`) | — (the input decides) | — |
| Presets | 1 s, 10 s, 1 min, 10 min, 1 h, 1 day | — | — (every step is ×6–×24; "Go to" fills the gaps) |
| Min span | 100 ns (existing) | unchanged | unchanged |

## Shared interfaces (pinned)

### S1: `packages/shared/src/numfmt.ts` (exported from `index.ts`)

```ts
import type { Digits } from "./workspace.ts";
/** True when values of this unit may get an SI prefix (N7). undefined (no unit) → true. */
export function takesPrefix(unit: string | undefined): boolean;
/** "14.0 k1/min", "45.0 km/h", "1.23 mV", "-5.00 km/h", "0 km/h", "14.0 k" (N7). */
export function formatQuantity(value: number, unit: string | undefined, digits: Digits): string;
export interface AxisLabels { title: string; labels: string[] } // title "" without unit
export function formatAxisTicks(ticks: number[], unit: string | undefined, digits: Digits): AxisLabels;
```

### S2: `packages/shared/src/timenav.ts` (exported from `index.ts`)

```ts
export interface NavRange { from: bigint; to: bigint }
export interface NavContext { view: NavRange; cursors: { a?: bigint; b?: bigint } }
export const MIN_SPAN_NS = 100n;
/** A if inside [view.from, view.to), else the view's centre. */
export function navAnchor(view: NavRange, a?: bigint): bigint;
/** N2; result clamped to TIME_MIN … TIME_MAX; throws RangeError with a readable message. */
export function resolveTimeNav(text: string, ctx: NavContext): NavRange;
/** factor 0.5 halves, 2 doubles; the anchor keeps its relative position; clamped. */
export function zoomAround(view: NavRange, factor: number, anchor: bigint): NavRange;
/** fraction of the span, negative = earlier; clamped. */
export function panBy(view: NavRange, fraction: number): NavRange;
/** Span centred on the anchor (presets, bare durations); clamped. */
export function spanAround(span: bigint, anchor: bigint): NavRange;
```

### S3: `packages/shared/src/workspace.ts`

```ts
export const Digits = z.union([z.literal(3), z.literal(4)]);
export type Digits = z.infer<typeof Digits>;
export interface WorkspaceOptions { digits: Digits }
// Workspace gains: options: WorkspaceOptions;   EMPTY_WORKSPACE.options = { digits: 3 }
// Command union gains:
z.object({ type: z.literal("workspace.setOptions"), digits: Digits.optional() }),
```

`applyCommand` merges the given fields into `options` (one revision, also when unchanged). A schema failure (e.g. `digits: 5`) is the existing `invalid_command`. Wire: `"options": {"digits": 3}` in `GET /api/workspace`. Web code reads `workspace.options?.digits ?? 3` so a stale state never breaks rendering.

### S4: Web props and helpers (3.1–3.4 in parallel)

`chart/zoom.ts`:
```ts
export type WheelAction = { kind: "zoom"; factor: number } | { kind: "pan"; px: number } | { kind: "none" };
export function wheelAction(e: { deltaX: number; deltaY: number; deltaMode: number; ctrlKey: boolean; shiftKey: boolean }): WheelAction;
```

`chart/cursors.ts`:
```ts
/** x of the Δt label's left edge: centred between the lines, else right of the right-hand flag. */
export function deltaLabelX(xa: number, xb: number, labelWidth: number, flagWidth: number): number;
```

`chart/readout.ts` (written by 3.1, used by 3.2):
```ts
export type ReadoutValue =
  | CursorValue
  | { kind: "aggregated"; value: number }
  | { kind: "none"; reason: NoValueReason | "empty_bucket" | "outside_range" };
/** undefined: nothing loaded yet (loading state). */
export function chartValueAt(result: SeriesResult | undefined, t: bigint, mode: DisplayMode): ReadoutValue | undefined;
export function readoutCell(v: ReadoutValue | undefined, unit: string | undefined, digits: Digits): Cell;
export function readoutDelta(a: ReadoutValue | undefined, b: ReadoutValue | undefined, unit: string | undefined, digits: Digits): Cell;
```

`values/format.ts` (3.1): `Cell.tag` becomes `"lin" | "hold" | "avg"`; `formatCell(v, at, next, unit, digits)` and `deltaCell(a, b, unit, digits)` gain `unit` and `digits`; tooltips keep `formatCursorNumber`. Reason texts gain `empty_bucket` "no points in this bucket" and `outside_range` "outside this window's range".

`chart/TimeseriesWindow.tsx` Props: remove `canGoBack`, `onBack`; add
```ts
digits: Digits;
/** Diff mode: show B and Δ columns, the Δt label. `cursors` stays the effective times. */
diff: boolean;
```

`values/ValuesWindow.tsx` props add `digits: Digits`. `explorer/SignalExplorer.tsx` props add `digits: Digits` and pass it to `SignalCard` (prop `digits`).

`bar/OptionBar.tsx` props add:
```ts
/** Resolves and applies "Go to" text; returns the error message, or undefined when applied. */
onGoTo: (text: string) => string | undefined;
/** A span preset in ns, centred on the navigation anchor. */
onSpan: (span: bigint) => void;
```
The field is `<input id="go-to">` (App's `t` focuses it). The digits select sends `workspace.setOptions` through `onCommand`. `bar/bar.ts` exports `SPAN_PRESETS: { label: string; ns: bigint }[]`. "Reset zoom" is labelled "Reset".

`keys.ts`:
```ts
export type NavKey = "in" | "out" | "left" | "right" | "pageLeft" | "pageRight" | "home" | "goTo";
export function navKey(e: KeyLike & { shiftKey: boolean }, focused: Element | null): NavKey | undefined;
/** push: first press (new history entry); join: repeat step; skip: repeat within 100 ms. */
export class NavRepeat { step(repeat: boolean, now: number): "push" | "join" | "skip" }
```

### S5: App wiring (`App.tsx`)

- `navigate(windowId, range, push: boolean)`: clamps, pushes the current (or pending) range to the history when `push`, records `pendingNav`, sends `setRange`.
- `onGoTo(text)`: target `barTarget`; `resolveTimeNav(text, {view: pending ?? target range, cursors})`; on success `navigate(target, r, true)` and returns undefined, else sets the message and returns it.
- `onSpan(ns)`: `navigate(target, spanAround(ns, navAnchor(view, A)), true)`.
- One keydown listener handles `navKey` (Backspace stays as is): target = hovered timeseries window, else `barTarget`; `NavRepeat` decides push/join/skip; `home` calls `onReset(target, resetSignals(...))` (linked: all timeseries signals; unlinked: the target's); `goTo` focuses and selects `#go-to`.
- Passes `digits` (`workspace.options?.digits ?? 3`) to timeseries windows, values windows and the explorer, and `diff` to timeseries windows; stops passing `canGoBack`/`onBack` to windows.

## Risks / Trade-offs

- [R1 may not be what Jan means by "next to the cursors".] → Q1 before the round; `chart/readout.ts` serves R2 and R3 too.
- [Chart readout and values window disagree in aggregated views (`avg` vs raw).] → Intended by D-024; the `avg` tag says why.
- [`15:08` picks a date the user did not mean.] → The header shows the full date at once and Backspace undoes it; full date-times always work.
- [Prefixes on unusual units (`krpm/10ms`).] → Pinned list and tests; the list grows by decision.
- [Axis labels with more than 3 digits look like a breach of D-026.] → N8 and Q6; distinct ticks are the alternative to wrong ones.
- [macOS pinch deltas are small, so a pinch may zoom slowly.] → Same factor as the wheel; Jan judges the feel. No test device can pinch, so the UI scenario is `not_run` there.
- [Key repeat with many windows loads data at 10 steps/s.] → Loaders abort stale requests; the 100 ms cap is the guard.

## Migration Plan

The workspace is in memory; the server restart for the new code starts with `options.digits = 3`. No data migration. Rollback: revert and restart.

## Open questions for Jan

Resolved by Jan (2026-10-15, D-028): every recommendation below is accepted; the tasks already follow them.

Tasks assume the recommendations.

1. **Readout placement (direction).** R1: values in the legend rows, readout row with times and Δt, Δt label between the flags (recommended, N3). R2: value labels at the lines on each curve. R3: a box beside each line. R2/R3 change task 3.2 only.
2. **Typed times (detail).** `15:08` shows that minute (`15:08:30` that second, a date that day), on the date of its latest occurrence in the view (recommended, N2). Alternative: keep the current span and centre on the time.
3. **Presets (detail).** Centred spans 1 s, 10 s, 1 min, 10 min, 1 h, 1 day (recommended). Alternative: calendar-aligned "this minute / hour / day" around the view centre.
4. **Default view and first cursors (direction).** Keep the extent view and A/B at ⅓/⅔ (recommended, N12). Alternatives: open on the last hour or day of data; cursors at the data end.
5. **Horizontal swipe (detail).** Keeps panning when Δx > 2·Δy (recommended, N5). Alternative: no wheel pan; keys only.
6. **Format details (detail).** Trailing zeros kept (`45.0 km/h`, as Jan's `14.0`); zero as `0`; no prefix for already-prefixed units (`km/h`, `kW`) and `%`, `°C`, `dB`, `h`, `min`; axis labels get the decimals their step needs, even beyond 3 digits (362.5 V) (all recommended, N7, N8).
7. **Exceptions to "everywhere" (detail).** Times and Δt exact, SNA share as today, DBC scaling and raw step exact, the values window's neighbour tooltip exact (recommended, N9). Alternative: format these too.
8. **Where the 3/4 option lives (detail).** Workspace option with command and CLI form `digits 3|4` (recommended, N10). Alternative: a per-browser preference.
9. **Keys (detail).** `+`/`=` in, `-` out, `←`/`→` half a view, Shift+`←`/`→` a whole view, `Home` = Reset, `t` = "Go to" (recommended, N6; `s` and `/` stay free).
