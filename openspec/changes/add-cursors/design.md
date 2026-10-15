# Design

## Context

See proposal.md (Why) and D-023. Current state that shapes the approach:

- **Workspace.** `Workspace.windows` is `TimeseriesWindow[]` with `kind: "timeseries"`, and `applyCommand` assumes every window has a range, a display and a height. Linked ranges (D-021) map over all windows. `lastZoomed` names the window set last.
- **Drag.** One pointer drag owned by `App` (D-022). Sources are legend rows (`DragSource {windowId, assignmentId, signalId}`) and explorer rows (`ExplorerDragSource {signalId}`). Drop targets are found by `[data-window-id]` / `[data-drop="new"]`. Auto-scroll already runs in a 48 px band at the edges of `<main>`, at up to 24 px per frame. "+ New window" is rendered after the last window, so it can be off screen.
- **Plot gestures (uPlot).** A drag of more than 5 px is rectangle zoom (`setSelect`). A double-click resets to the signals' extents through App. The wheel zooms, and Shift or horizontal wheel pans. The crosshair hides after zooms. `legend: {show: false}`, so there is no hover readout today.
- **Series data.** `DataSource.before(t)` gives the last point `< t` and `after(t)` the first point `≥ t`, each `LIMIT 1`. Every raw `/api/series` request already runs them. Stored values carry float noise (`CPC_448h.PTC_HV_Volt` stores `362.40000000000003`).
- **Real data for checks.** smart451 on 2026-10-13 around 13:08:00Z (driving). V_ANZ steps every ~100 ms (23, 22, 21 …). DVL changes every 20 ms (179.5 at .083, 180 at .103). The SNA run of V_ANZ is at 09:56:59.837–09:57:00.037.

## Goals / Non-Goals

**Goals:**
- Server and web build in parallel against the types, payloads and props pinned in S1–S5.
- A cursor gesture costs one command. The values window costs one HTTP request per row and cursor, and two indexed `LIMIT 1` queries per request.
- All existing gestures keep their meaning (C3 table).

**Non-Goals:**
- No cursor values inside timeseries windows. The values window is the only readout (D-023 "values only at the cursor").
- No live value updates while a line is dragged. Values follow on release (C2). Live scrubbing is a later goal.
- No new DataSource method. `/api/value` reuses `before`/`after`.

## Decisions

### C1: Cursors are workspace state, changed by four commands

`Workspace.cursors = {a?, b?, diff}` with decimal-ns strings. The commands are `cursor.set`, `cursor.move` (signed ns, rejected with `cursor_off` while off), `cursor.remove` and `cursor.setDiff`. All go through `applyCommand`, so the CLI sets, moves and reads cursors exactly like the UI (concept §7). The render acknowledgement then also covers "the open view shows the cursor".

- *Alternative: per-tab cursor state in the browser.* Rejected: the CLI could neither set nor read it (concept §7: „Cursor absolut setzen oder relativ verschieben"; the open view including cursors must be controllable).
- *Alternative: a separate `/api/cursors` resource.* Rejected: two state channels, two revision counters. One workspace and one revision is the D-011 pattern.

### C2: Local while dragging, one command on release

While a cursor line is dragged, App holds `cursorPreview {cursor, t}`. Every timeseries window draws the effective cursors (the preview overrides the committed time), so all lines follow the pointer at frame rate without any command. Release sends one `cursor.set`. Esc drops the preview. The preview ends when the workspace shows the committed time, or on Esc. The values window shows the committed values dimmed during the drag and loads the new ones after release.

A click places a cursor the same way. The preview shows at once, and the `cursor.set` follows after the double-click interval (C3), unless a double-click came.

- *Alternative: throttled commands (for example 5 per s) during the drag.* Rejected: a 2 s drag makes 10 revisions, 10 render acknowledgements and 10 value reloads per row, and CLI observers see intermediate states nobody chose. It would allow live values while dragging. That is a later goal ("Out of scope").
- *Alternative: commit on every pointer move.* Rejected: about 60 commands per second.

### C3: Gestures in a timeseries plot

| Gesture | Before | After |
|---|---|---|
| Press + move > 5 px | rectangle zoom | rectangle zoom, unless the press is within 6 px of a cursor line: then it drags that cursor |
| Click (< 4 px movement) | nothing | places A after 500 ms, the line shows at once |
| Shift+click | nothing | places B, same way |
| Double-click | reset zoom | reset zoom; the pending click is dropped, no cursor moves |
| Wheel / Shift+wheel | zoom / pan | unchanged, also over a cursor line |
| Legend grip drag | signal drag | unchanged (the grip is outside the plot) |
| Backspace / Esc | back / cancel drag | unchanged; Esc also cancels a cursor drag |

Mechanics:
- Each visible cursor is a DOM overlay inside `u.over`: a 12 px-wide transparent hit strip (±6 px), `cursor: ew-resize`, with a 1 px line in its centre and a flag "A"/"B" at the top. The strip stops propagation of `pointerdown` **and** `mousedown`, so uPlot never starts a selection. Wheel events bubble on to `u.over`, so zoom still works over a line. Positions come from `u.valToPos` in the `draw` hook, which also runs during zoom previews, so lines stay at their time.
- Click detection uses `mousedown`/`mouseup` on `u.over` with less than `DRAG_THRESHOLD_PX` (4 px) of movement. A `ClickGate` commits the last click after `DOUBLE_CLICK_MS = 500`. uPlot's `dblclick` binding calls `gate.doubleClick()`, which drops the pending click and its preview.
- Placed times are snapped: `snapCursorTime(t, span)` rounds to the largest power of ten in ns that is at most `span / 1000`. At 1000 px that is about one pixel, and the times read short (`…:01.512` instead of `…:01.512345678`).
- Hit test: the nearer line within 6 px; on a tie B, which is drawn above A.

Alternatives considered:
- *Keys `a`/`b` set the cursor at the pointer.* Fast for power users, but invisible to new users, and the pointer must rest over a plot. Can be added later without conflict.
- *Alt+click for A and B.* Alt+drag already means "copy" in signal drags. On macOS, Ctrl+click opens the context menu (App suppresses it during drags only).
- *A "cursor mode" toggle in the bar that turns click and drag into cursor placement.* A modal: the user has to know which mode is active, and rectangle zoom would need a mode switch.
- *Commit the click at once.* The first click of every double-click would move A, so a zoom reset would lose the cursor position.

### C4: The values window evaluates raw neighbours (R1)

Each row asks `GET /api/value?signal&t&mode` for A, and also for B in diff mode. The server returns the last point at or before `t` (`at`), the first point after `t` (`next`), and `evaluateAt`'s result. `evaluateAt` lives in `packages/shared`, so server, web and a later CLI share one rule:

```
no at and no next      → none (no_data)
no at                  → none (before_first)
at.t == t              → at.v null ? sna : raw(at.v)
no next                → none (after_last)
at.v null              → sna
mode step              → held(at.v)
next.v null            → none (next_sna)        // line mode, as the curve: no segment into SNA
else                   → interpolated(at.v + (next.v − at.v) · (t − at.t) / (next.t − at.t))
```

These are the curve rules of timeseries-window ("No invented values", "SNA never drawn as a value", step holds up to the SNA point), so a value is shown exactly where a curve is drawn. Lines connect across recording pauses (D-009), and so does interpolation. Time differences are bigint, converted to Number for the ratio, which is exact below 2^53 ns (104 days).

The values window has its own "Between points" mode (`line` → linear, `step` → hold, default `line`), set with the existing `window.setDisplay {mode}`. It does not borrow the mode of a timeseries window, which would be ambiguous when the signal is shown in two windows.

Options (Jan's call, Q1):
- **R1 (recommended): raw neighbours from the server, zoom-independent.** It works for signals shown in no timeseries window and is unambiguous when windows have different zooms. It is exact and checkable with `curl`. It needs only two `LIMIT 1` queries per request, and both already run for every raw series request. In this window the values are raw, interpolated or held, never aggregated. Concept §6 does not require zoom-independent raw access ("nicht gefordert"), but it does not exclude it, and §6 leaves the reference resolution of single-value windows open.
- **R2: the representative value of a timeseries window that shows the signal, at that window's zoom.** It matches §6's accepted semantics for aggregated views: what you see is what you read. But it has no value for a signal shown in no timeseries window, and it is ambiguous for a signal in two unlinked windows. It has no value when the cursor lies outside that window's loaded range. It needs an `aggregated` kind and marker, and the value of a row would change when someone zooms.
- **R3: evaluate at the resolution of the shared (linked) range**, as if the values window were a plot of that range at its own width. Consistent while linked, undefined while unlinked, and it costs an extra series load per row.

With R2 or R3, the `values-window` "Value at cursor A" requirement and the `series-query` "Value at a time" requirements change, and task 2.1 shrinks or disappears.

### C5: Bar target for Back and Reset zoom

The bar acts on its target: the window zoomed last (`lastZoomed`, if it still exists and is a timeseries window), else the first timeseries window. While linked, every range change applies to all windows, and the history is shared ("*"), so the target only names whose history and range are used. "Reset zoom" while linked uses the extents of the signals of **all** timeseries windows, so everything becomes visible. While unlinked, it uses the target's signals, and the tooltips read "Back · <window name>" and "Reset zoom · <window name>". The windows keep their own "Back" and "Zoom out" buttons.

Alternatives (Q4): act on every window (each one step back in its own history, which is confusing when the histories differ); disable both while unlinked (safe, but the bar is useless then); a "selected window" concept (does not exist; new state).

### C6: Values window kind and creation

`ValuesWindow {id, kind: "values", title?, mode, signals}`. It has no range, display, height or insets. `window.create {kind: "values"}` creates one, so there is no new create command. An untitled one is named "Values <n>", which tells it apart from "Window <n>" in "Add to". Commands that need a plot or range are rejected with `invalid_command` on a values window (workspace-state "Commands by window kind"). Linked ranges, the re-link snap and the range of a linked `window.create` look only at timeseries windows.

`window.moveSignal` without a target from a values window creates a timeseries window. It takes the range of `lastZoomed` (timeseries), else of the first timeseries window, with default display and height, and returns `invalid_range` when neither exists. In that last case the web sends `window.create` with the signal's extent and then `window.moveSignal` with the new `targetWindowId`: two commands, only when no timeseries window exists.

### C7: Drag sources and targets

- A values row's grip is a `DragSource` (the same shape as a legend row), so move, Alt/Ctrl copy, ghost text and hint are those of legend drags. The spec follows D-023 literally: "like any window", so a plain drop of a legend row into a values window moves it (Q2).
- `canDrop`, `canAdd` and `dropStateFor` skip the unit check when the target is a values window. "Already shows the signal" still refuses.
- "+ New window" is rendered during every drag as the last child of `<main>` with `position: sticky; bottom: 0`, so it sits at the viewport bottom wherever `<main>` is scrolled.
- The auto-scroll bands become the 48 px below the sticky option bar and the 48 px above the drop zone, both measured from their bounding boxes. Pointing at the zone itself does not scroll, so resting on it to drop does not run the list away.

Numbers, each checked at a factor of two:

| Number | Value | Half | Double |
|---|---|---|---|
| Edge band | 48 px | 24 px is hard to hit while aiming | 96 px scrolls while aiming at a window's top or bottom |
| Scroll speed | ≤ 24 px/frame (≈ 1440 px/s) | 6 windows (~2000 px) take ~2.8 s | overshoots the target window |
| Cursor hit strip | ±6 px | ±3 px is hard to grab | ±12 px takes rectangle-zoom starts near a line |
| Click movement | < 4 px (`DRAG_THRESHOLD_PX`) | jittery clicks become no-ops | small rectangle drags become clicks (uPlot ignores ≤ 5 px anyway) |
| Click commit delay | 500 ms | slow double-clicks (macOS allows ~0.5 s) move A first | values lag 1 s after a click; the line itself shows at once |
| Snap step | ≤ span/1000 | span/500: ~2 px steps, still sub-pixel at narrow plots | span/2000: more digits, no gain |
| Significant digits | 9 | 4–5 cuts real resolution (65535.25 needs 7) | 18 shows float noise (`362.40000000000003`) |
| New cursor at | 1/3 and 2/3 of the range | — | — (any visible, separated spot works) |

### C8: Values requests

One request per row and cursor: `fetchCursorValue(signalId, t, mode, abort)`. The values loader keys each row by `signalId|t|mode`. A changed key aborts the old request, and a response for an old key is dropped, as in `SeriesLoader`. A values window with n rows sends n requests (2n in diff mode). Each request makes 2 DB queries through the server's queue of 4. At an assumed 20–50 ms per `LIMIT 1` query through the tunnel, 3 rows load in about 0.1 s and 10 rows in diff mode in about 0.5 s. Twice as slow is still within the 1 s of the UI scenarios for up to 10 rows. 50 rows in diff mode (200 queries) take about 2.5 s. That is rare, and the rows fill in one by one.

## Shared interfaces (pinned)

### S1: Workspace types and commands (`packages/shared/src/workspace.ts`)

```ts
export const CursorName = z.enum(["a", "b"]);
export type CursorName = z.infer<typeof CursorName>;

/** Cursor A/B (decimal-ns strings; absent = off) and diff mode. */
export interface CursorState {
  a?: string;
  b?: string;
  diff: boolean;
}

/** "Between points" mode of a values window: line → linear, step → hold (concept §6). */
export const ValuesMode = z.enum(["line", "step"]);
export type ValuesMode = z.infer<typeof ValuesMode>;

export interface ValuesWindow {
  id: string;
  kind: "values";
  title?: string;
  mode: ValuesMode; // default "line"
  signals: SignalAssignment[];
}

export type WorkspaceWindow = TimeseriesWindow | ValuesWindow;
export const isTimeseries = (w: WorkspaceWindow): w is TimeseriesWindow => w.kind === "timeseries";

export interface Workspace {
  windows: WorkspaceWindow[];      // was TimeseriesWindow[]
  nextId: number;
  linkTime: boolean;
  lastZoomed?: string;             // always a timeseries window
  colors: Record<string, number>;
  cursors: CursorState;            // new
}
export const EMPTY_WORKSPACE: Workspace = {
  windows: [], nextId: 1, linkTime: true, colors: {}, cursors: { diff: false },
};

/** Title, else "Window <n>" (timeseries) or "Values <n>" (values) from the ID. */
export function windowTitle(w: WorkspaceWindow): string;

/** windowUnits keeps its signature but takes a WorkspaceWindow. */
```

Command changes (zod, in the existing `Command` union):

```ts
// window.create gains `kind`; refine: kind "values" ⇒ no from/to/envelope, mode ∈ {line, step}
z.object({
  type: z.literal("window.create"),
  kind: z.enum(["timeseries", "values"]).optional(), // default "timeseries"
  title: z.string().max(200).optional(),
  from: TimeInput.optional(),
  to: TimeInput.optional(),
  mode: DisplayMode.optional(),
  envelope: z.boolean().optional(),
}),
z.object({ type: z.literal("cursor.set"), cursor: CursorName, t: TimeInput }),
z.object({ type: z.literal("cursor.move"), cursor: CursorName, by: z.string().regex(/^-?\d{1,20}$/) }),
z.object({ type: z.literal("cursor.remove"), cursor: CursorName }),
z.object({ type: z.literal("cursor.setDiff"), diff: z.boolean() }),
```

`CommandErrorCode` gains `"cursor_off"`. In `applyCommand`, `cursor.move` checks the result against `TIME_MIN … TIME_MAX` and fails with `invalid_command` naming the bounds. `cursor.remove` on an off cursor is accepted and changes nothing but the revision. On a values window, `window.setDisplay` accepts `mode` `line`/`step` and fails with `invalid_command` on `markers` or `envelope`. `window.setRange` and `window.setHeight` fail with `invalid_command`.

Wire example (`GET /api/workspace`):

```json
{"revision": 12, "workspace": {"windows": [
  {"id": "w1", "kind": "timeseries", "range": {"from": "1791896880000000000", "to": "1791896883000000000"},
   "display": {"mode": "line", "envelope": false}, "signals": [{"id": "a2", "signalId": "smart451/COMBI_412h.V_ANZ"}]},
  {"id": "w3", "kind": "values", "mode": "line", "signals": [{"id": "a4", "signalId": "smart451/BS_200h.DVL"}]}],
 "nextId": 5, "linkTime": true, "lastZoomed": "w1", "colors": {"…": 0},
 "cursors": {"a": "1791896880093000000", "diff": false}}}
```

### S2: Cursor values (`packages/shared/src/cursor.ts`, exported from `index.ts`)

```ts
import type { EdgePoint } from "./series.ts";
import type { ValuesMode } from "./workspace.ts";

export type NoValueReason = "no_data" | "before_first" | "after_last" | "next_sna";

export type CursorValue =
  | { kind: "raw"; value: number }          // a point lies exactly at t
  | { kind: "interpolated"; value: number } // line mode, between two valid points
  | { kind: "held"; value: number }         // step mode, the earlier valid point's value
  | { kind: "sna" }                         // SNA at t (D-010: never a number)
  | { kind: "none"; reason: NoValueReason };

/** Body of GET /api/value. */
export interface CursorValueResult {
  signalId: string;
  t: string;          // decimal ns, as evaluated
  mode: ValuesMode;
  at?: EdgePoint;     // last point with time ≤ t (v null = SNA)
  next?: EdgePoint;   // first point with time > t
  value: CursorValue;
}

/** C4 rules; pure. */
export function evaluateAt(
  t: bigint,
  mode: ValuesMode,
  at: { t: bigint; v: number | null } | undefined,
  next: { t: bigint; v: number | null } | undefined,
): CursorValue;

/** At most 9 significant digits, trailing zeros dropped: String(Number(v.toPrecision(9))). */
export function formatCursorNumber(v: number): string;
```

### S3: HTTP `GET /api/value` (`apps/server/src/routes/series.ts`)

- Query: `signal` (signal ID), `t` (decimal ns or ISO, within the time bounds), `mode` (`line` | `step`, default `line`).
- 200: `CursorValueResult`. `at = source.before(ref, t + 1n)`, `next = source.after(ref, t + 1n)`, both with the catalog's SNA ranges (null = SNA), in parallel through the queue. `value = evaluateAt(t, mode, at, next)`.
- Errors (`ApiError` body, as `/api/series`): 400 `invalid_request` (bad or out-of-bounds `t`, unknown `mode`), 404 `unknown_signal`, 503 `catalog_unavailable` (checked first, as for series), 502 `source_error`. A client that closes the request aborts its queries.

Example: `curl -s 'localhost:7310/api/value?signal=smart451/BS_200h.DVL&t=2026-10-13T13:08:00.093Z'` →

```json
{"signalId": "smart451/BS_200h.DVL", "t": "1791896880093000000", "mode": "line",
 "at": {"t": "1791896880083000000", "v": 179.5}, "next": {"t": "1791896880103000000", "v": 180},
 "value": {"kind": "interpolated", "value": 179.75}}
```

### S4: Web props and helpers (so 3.1–3.4 build in parallel)

`chart/TimeseriesWindow.tsx`, new props (App passes them):

```ts
/** Effective cursor times: App's preview overrides the workspace. */
cursors: { a?: bigint; b?: bigint };
/** Local position while placing or dragging; t undefined ends the preview without a command. */
onCursorPreview: (cursor: CursorName, t: bigint | undefined) => void;
/** Gesture finished: App sends one cursor.set. */
onCursorCommit: (cursor: CursorName, t: bigint) => void;
```

`chart/cursors.ts` (pure, unit-tested):

```ts
export const CURSOR_HIT_PX = 6;
export const DOUBLE_CLICK_MS = 500;
export function snapCursorTime(t: bigint, span: bigint): bigint;
export function hitCursor(x: number, lines: { a?: number; b?: number }): CursorName | undefined;
/** Commits the last click after delayMs unless doubleClick() came first. */
export class ClickGate {
  constructor(delayMs: number, schedule?: (fn: () => void, ms: number) => unknown, cancel?: (id: unknown) => void);
  click(commit: () => void): void;
  doubleClick(): void; // drops the pending click
  dispose(): void;
}
```

`values/ValuesWindow.tsx`:

```ts
interface ValuesWindowProps {
  window: ValuesWindow;
  revision: number;
  cursors: CursorState;              // committed state, not the preview
  dragging: boolean;                 // a cursor line is being dragged: dim the cells
  info: (signalId: string) => SignalInfo | undefined;
  colorOf: (signalId: string) => string;
  onCommand: (command: CommandInput) => Promise<CommandResult>;
  onReady: (windowId: string, revision: number, errors: RenderError[]) => void;
  onDragStart: (source: DragSource, event: React.PointerEvent) => void;
  dropState?: DropState;
  dropAction?: "add";
}
```

The root element carries `data-window-id`. Rows show `Drop a signal here` when empty, and the same drop-hint markup as timeseries windows.

`values/format.ts` (pure, unit-tested):

```ts
export interface Cell { text: string; tag?: "lin" | "hold"; sna?: boolean; title?: string }
export function formatCell(v: CursorValue | undefined, at?: EdgePoint, next?: EdgePoint): Cell; // "—" for none/undefined, title = reason or neighbours
export function deltaCell(a: CursorValue | undefined, b: CursorValue | undefined): Cell;         // B−A; tag lin > hold > none
export function formatDeltaT(ns: bigint): string;    // "+902 ms", "-1.5 µs", "+1:02:03.5", "0 ns"
export function formatCursorTime(t: bigint): string; // local "YYYY-MM-DD HH:MM:SS[.fff[fff[fff]]]"
```

`values/loader.ts`: `ValueLoader` (keyed `signalId|t|mode`, abort and drop stale, per-row status `loading | complete | error` with message), the counterpart of `SeriesLoader`.

`api.ts`: `fetchCursorValue(signalId: string, t: string, mode: ValuesMode, abort: AbortSignal): Promise<CursorValueResult>`. A non-2xx answer throws with the `ApiError` message.

`bar/OptionBar.tsx`:

```ts
interface OptionBarProps {
  workspace: Workspace;
  target: TimeseriesWindow | undefined;   // barTarget(workspace)
  canGoBack: boolean;                     // history of the target (shared "*" while linked)
  onCommand: (command: CommandInput) => Promise<CommandResult>;
  onBack: (windowId: string) => void;     // App's existing onBack
  onReset: () => void;                    // App: resetSignals(workspace) → extents → setRange on target
}
```

`bar/bar.ts` (pure, unit-tested):

```ts
export function barTarget(ws: Workspace): TimeseriesWindow | undefined;          // C5
export function resetSignals(ws: Workspace): string[];                           // linked: all timeseries signals; else the target's
export function defaultCursorTime(range: { from: bigint; to: bigint }, cursor: CursorName): bigint; // 1/3 or 2/3, snapped
```

### S5: App wiring (`App.tsx`, `chart/drag.ts`)

- App renders `OptionBar` sticky at the top of `<main>`, removes the top bar's link toggle, renders `ValuesWindow` for `kind === "values"` and `TimeseriesWindow` otherwise, and renders the sticky "+ New window" during every drag.
- App owns `cursorPreview`. It passes `cursors` (effective) to timeseries windows, and `cursors` (committed) plus `dragging` to values windows. `onCursorCommit` sends `{type: "cursor.set", cursor, t: t.toString()}`.
- `drag.ts`: `canDrop`, `canAdd` and `dropStateFor` take `WorkspaceWindow[]` and skip the unit check for values targets. A values row is a `DragSource`. A drop of a values row on "new" while no timeseries window exists sends `window.create` (with the extent) and then `window.moveSignal` (C6).
- Kind guards: insets merge only timeseries IDs. `toRange` and `onReset` run only on timeseries windows. Backspace over a values window falls back to `lastZoomed`. A linked "New window" add needs a timeseries window to take the shared range from, else it uses the extent.
- `explorer/SignalExplorer.tsx`: `windows: WorkspaceWindow[]`; "Add to" lists values windows by `windowTitle`.

## Risks / Trade-offs

- [A plain drop of a legend row into the values window removes the signal from its chart (D-023 "like any window").] → Alt/Ctrl copies, and the hint says so. Q2 asks Jan whether drops into a values window should copy by default.
- [Exact raw hits are rare with clicks: values mostly read `lin` or `hold`.] → The CLI sets exact times. Snapping to raw points is out of scope and can be added later.
- [Interpolation across recording pauses gives values inside a pause (PTC_HV_Volt at 2026-10-13T12:40Z holds 4.1 over about 1.4 h in "hold").] → Consistent with the drawn curve (D-009). The tooltip names both neighbours with their times.
- [`before()` has no lower time bound.] → It already runs for every raw series request without complaint. If a source shows slow `LIMIT 1` scans, that is a DataSource fix, not a spec change.
- [The sticky drop zone covers the bottom of the last window during a drag.] → The band above it auto-scrolls, so every window can be scrolled clear of the zone.
- [The 500 ms click gate delays the command.] → The line shows at once; only the values follow later.

## Migration Plan

The workspace is in memory only, so a server restart (needed for the new code anyway) starts with `EMPTY_WORKSPACE`, including `cursors`. There is no data migration. Rollback means reverting the commit and restarting.

## Open questions for Jan

1. **Values window resolution (C4).** Recommendation: **R1**, raw neighbours from the server, independent of any window's zoom. It is exact, works for every signal, and the spec is written for it. Alternatives: R2, the representative value of a timeseries window showing the signal (concept §6's "what you see" semantics, but ambiguous across windows and absent for signals not plotted), or R3, the resolution of the linked range. R2 or R3 changes the "Value at cursor A" and "Value at a time" requirements and drops or shrinks task 2.1.
2. **Default of a legend drop into a values window.** D-023 says "like any window", so the spec moves on a plain drop and copies with Alt/Ctrl. Recommendation: keep it for consistency, and look again after Jan has tried it. The alternative is copy by default into values windows only. The values window usually mirrors chart signals, so that may be what Jan wants, but it would be a second rule.
3. **Placement gesture (C3).** Recommendation: click = A and Shift+click = B, plus dragging the lines. Alternatives: keys `a`/`b` at the pointer, or a cursor mode in the bar. Keys can be added later without conflict.
4. **Bar "Back"/"Reset zoom" while unlinked (C5).** Recommendation: act on the window zoomed last and name it in the tooltip. Alternatives: act on every window, or disable both while unlinked.
