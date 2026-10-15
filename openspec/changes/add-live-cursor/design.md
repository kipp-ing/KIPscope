# Design

## Context

See proposal.md (Why, D-032 in full). Current state that shapes the approach:

- **Drawn-value evaluation exists:** `chartValueAt(result, t, mode)` in `chart/readout.ts` evaluates a window's loaded `SeriesResult` at a time: raw by `evaluateAt` with edge neighbours (markers as line), buckets by the mean of the bucket containing t, `outside_range` outside `[from, to)` of the loaded range; times are decoded once per result (WeakMap) and found by binary search. `readoutCell(v, unit, digits)` turns it into a legend cell (bare number with SI prefix, kind as tooltip, `SNA`, `—` with reason, loading). D-031 uses both for a dragged line; L reuses them unchanged.
- **Cursor overlays** (`TimeseriesWindow.tsx`, `createCursorLines`/`placeCursorLines`): A and B are DOM elements inside `u.over`, placed in the uPlot `draw` hook from `cursorsRef` and the shown range (zoom preview included), hidden outside the half-open shown range.
- **Pointer handling** in the chart effect: `mousedown` on `u.over` sets `down`, `mouseup` on window places A/B through the click gate; line drags capture the pointer on the strip and call `holdNoSelect()`; `onMove` shows the crosshair, `hideCursor(u)` hides it after every range change; uPlot's own `mouseleave` hides it on leaving.
- **Re-renders:** App passes effective cursors as props; a cursor preview re-renders every window per move, so the model is memoized and data is set only when it changes. L would add a re-render per frame whenever the pointer is over any plot, so L does not go through App props.
- **Values window:** `ValueLoader` (abort on change, stale responses dropped, previous result kept while loading), `valueRequests(rows, cursors, mode)` with keys `${rowId}|a|b`, `cellState`, render acknowledgement from `loader.settled(requests)` and `valueErrors`.
- **Series:** `buildModel` (`chart/build.ts`) produces `model.series` (uPlot index − 1) including two envelope-edge series per aggregated signal and `bands`; `SeriesSpec` has no assignment key today.

## Goals / Non-Goals

**Goals:**
- One browser-local store for L; the hovered window writes it, every window and the values window read it. No App prop, no command.
- Chart L values reuse `chartValueAt` + `readoutCell`; values-window L values reuse `ValueLoader` + `formatCell`.
- Every rule with a number is a pure function in `chart/live.ts` or `values/loader.ts`, unit-tested with pinned inputs.
- Per pointer move: no request, at most one store publish per animation frame, one plot redraw only when the highlighted signal changes.

**Non-Goals:**
- No change in `packages/shared`, `apps/server`, `apps/cli`; no new command, DTO or endpoint. Server and web do not need to be coordinated.
- No new readout row entry, no L time text (Q2), no Δ against L.

## Decisions

### L1: Where L lives (pinned interface, `apps/web/src/chart/live.ts`, new)

A module singleton store per browser tab, read with `useSyncExternalStore`:

```ts
export const NEAR_PX = 8;          // D-032 "about 8 px"
export const HIGHLIGHT_WIDTH = 3;  // px; normal series width is 1.5
export const FADE_ALPHA = 0.3;
export const LABEL_GAP_PX = 6;
export const LIVE_REST_MS = 150;   // values window lookup delay (L7)

export interface LiveCursor {
  windowId: string;  // the hovered window (owner)
  t: bigint;         // L, ns
  near?: string;     // assignment id of the highlighted signal in the owner window
}

export class LiveStore {
  constructor(
    raf?: (fn: () => void) => number,      // default requestAnimationFrame
    caf?: (id: number) => void,            // default cancelAnimationFrame
  );
  /** Snapshot; the same object until windowId, t or near changes. */
  get(): LiveCursor | undefined;
  subscribe(listener: () => void): () => void;
  /** Queues next; published in the next animation frame, the last call of a frame wins. Ignored while suspended. */
  set(next: LiveCursor): void;
  /** Clears now and drops a queued set; with windowId only if the current or queued owner is that window. */
  clear(windowId?: string): void;
  /** Clears and keeps L unset until every returned release has run (counted; release is idempotent). */
  suspend(): () => void;
}
export const liveCursor: LiveStore;

/** The current L (re-renders each published frame). */
export function useLiveCursor(store?: LiveStore): LiveCursor | undefined;
/** near of windowId's L, else undefined (re-renders only when it changes). */
export function useLiveNear(windowId: string, store?: LiveStore): string | undefined;
```

- *Alternative: App state passed as props.* Every window and the whole App would re-render per frame while the pointer is over any plot; rejected.
- *Alternative: workspace state.* D-032: „no command, no revision".

### L2: Live time (pure)

`liveTime(offset: number, origin: bigint, shown: Range): bigint` = `snapCursorTime(origin + BigInt(Math.round(offset)), shown.to − shown.from, shown)`, with `offset = u.posToVal(x, "x")` — the same computation as `timeAt` for a click, so a click without moving places A exactly at L (spec "Snapped like a click"). The hovered window computes it on each `mousemove` of `u.over`.

### L3: Pointer flow in the hovered window

On `mousemove` over `u.over`, unless a button is held there (`down`) or the store is suspended:
1. `t = liveTime(...)`; for each loaded signal `v = chartValueAt(result, t, mode)`.
2. Candidates: signals with a number (`raw`, `interpolated`, `held`, `aggregated`) whose `y = u.valToPos(v.value, scaleOf(signal))` (CSS px) lies inside the plot height.
3. `near = nearestSignal(candidates, pointerY)`; `liveCursor.set({windowId, t, near})`.

Cost per event: one binary search per signal (≤ 50 signals, ≤ 17 steps for 100 k points), no allocation of the decoded times (cached per result).

Every window subscribes in its chart effect (imperative, no React render):
- **Owner:** hides its L line; when `near` changed since the last publish, sets the highlight (L5) and redraws; places the label (L6).
- **Others:** place the L line at `t` with the same rule as A/B (`placeCursorLines`: inside the half-open shown range, zoom preview included); no highlight, no label. The `draw` hook places it too, so a zoom of that window moves it.

React parts: an `LiveCell` per legend row calls `useLiveCursor()` and renders `liveCell(...)` (L4); the `<li>` gets class `live-near` from `useLiveNear(w.id) === s.id`. So per frame only the L cells re-render, and the window itself only when the highlighted signal changes.

### L4: L cells from the drawn data

`liveCell(v: ReadoutValue | undefined, set: boolean, unit: string | undefined, digits: Digits): Cell`:
- `set` false (no L) → `{ text: "" }` (empty, column kept).
- else `readoutCell(v, unit, digits)`: raw plain, `lin`/`hold`/`avg` as tooltip, `SNA`, `—` with reason (`outside_range` in a window whose loaded range lacks L), loading cell while the signal's data is not loaded.

`v = chartValueAt(loader.get(s.id)?.result, live.t, w.display.mode)` in every window (owner and others). Zoomed in this is the raw evaluation, zoomed out the bucket mean (D-032 „raw points zoomed in, bucket value zoomed out, kind as tooltip"). In band mode (min/max envelope) the value is the bucket mean, as for a dragged line; min and max are not shown.

The L cell has `min-width: 8ch`, right-aligned: the widest 4-digit text with prefix and sign is `-1.234 k` (8 chars), so a filling or emptying column never resizes the grid (spec "Cursors off, no hover"). Column order: name, `[unit]`, A, B, Δ (each only as today), L (always), status, SNA share, `×`. The legend is always this grid, also with A and B off, so L lines up under itself in every row (D-033: "The chart legend is always a grid ... replaces the wrapping list with cursors off"); `.signals` in `styles.css` loses its `flex-wrap` list form.

### L5: Nearness and highlight

`nearestSignal(candidates: { key: string; y: number }[], pointerY: number, maxPx = NEAR_PX): string | undefined` — the candidate with the smallest `|y − pointerY|` ≤ maxPx; on equal distance the later candidate (legend order). Each `y` comes from `valToPos` on that signal's own scale, so several y axes compare in the same screen pixels; a signal on the right axis 5 px away beats one on the left axis 7 px away.

Round 2 (reviewer finding, pure and testable): the candidates come from

```ts
liveCandidates(
  signals: readonly { key: string; scale: string | undefined; value: ReadoutValue | undefined }[],
  toY: (value: number, scale: string) => number, // u.valToPos
  plotHeight: number,
): { key: string; y: number }[]
```

in `chart/live.ts`: a signal is skipped without a scale (envelope edges, Q3), without a number (`SNA`, `—` of any reason, loading) or with `y` outside `[0, plotHeight]`; order kept (legend order, for the tie rule). `TimeseriesWindow` builds `signals` from `model.layout.scaleOf` (no own `scaleOf` map) and `chartValueAt`, then calls `nearestSignal(liveCandidates(...), pointerY)`. `timeAt` calls `liveTime`, so a click and L snap through one function.

The distance is measured to the L value's y, which is the drawn curve: line → linear interpolation, step → held value, markers → interpolated line between the markers, buckets → the mean of the bucket under the pointer (the drawn line joins bucket centres; with about one bucket per plot pixel the two differ by at most the rise over half a bucket, see Risks).

Highlight, applied only when `near` changes: `SeriesSpec` gains `key: string` (assignment id, set in `buildModel`) so the uPlot series of a signal (its line and envelope edges) are known; the near signal's line gets width `HIGHLIGHT_WIDTH`, every series of other signals alpha `FADE_ALPHA` (their bands fade with them); then one `u.redraw(false)`. No near → all series back to their options. SNA lanes are unchanged.

### L6: Label

`liveLabelText(v, unit, digits)` = `formatQuantity(v.value, unit, digits)` for a number (e.g. `23.0 km/h`), undefined otherwise; no kind tag (Q4). A DOM element in `u.over` like the flags. `labelPosition(point, size, plot, gap = LABEL_GAP_PX): { left; top }`: right of and above the curve point by `gap`; left of it if it would cross the right edge; below it if it would cross the top; then clamped inside the plot. The point is `x = valToPos(t)`, `y` of the near signal's value.

### L7: Values window L column

- `liveRequests(rows, t: string | undefined, mode): ValueRequest[]` in `values/loader.ts`: one request per row with key `${rowId}|l` at the rested L time; none while unset.
- `class Rest<T>` in `values/loader.ts`: `constructor(ms, onRest: (v: T) => void, schedule?, cancel?)`, `push(v)`: calls `onRest(v)` once no push came for `ms`; `push(undefined)` calls at once (clearing is not delayed); `dispose()`.
- `ValuesWindow` reads `useLiveCursor()`, pushes `String(t)` into a `Rest` with `LIVE_REST_MS`, and feeds `liveRequests(w.signals, rested, w.mode)` into a **separate** `ValueLoader`. The render acknowledgement keeps using the A/B `requests` only, so L lookups neither delay nor fail it.
- Cell: unset L → empty; L moved since the rested time → `loadingCell` of the last cell (dimmed); else `formatCell` of the state, error → `—` with `failed: <message>`.

Why exact and not drawn: the values window has no drawn data and lists signals no chart may plot; it evaluates raw neighbours from the server (D-024, D-029). See Q1.

### L8: When L is hidden

| Situation | Effect |
|---|---|
| Pointer leaves the plot (`mouseleave` of `u.over`) | `liveCursor.clear(w.id)` |
| Button down on the plot (click, rectangle zoom) | `clear(w.id)`; no `set` while the button is held or the pointer drags |
| `mouseup` without movement (a click) | `publishLive(e)` at the same pointer position, so A and L read the same right after the click (D-033: "on mouse up without movement L comes back at the same spot"; amends round 1, which cleared L until the next move) |
| `mouseup` after a drag (rectangle zoom) | nothing; the range change clears L (next row), the next move sets it |
| Cursor line drag, height drag (`TimeseriesWindow`), legend/explorer row drag (`App.tsx`) | `liveCursor.suspend()` next to each `holdNoSelect()`, released with it |
| Range change of the owner window (every place that calls `hideCursor(u)`) | `clear(w.id)`; the next move sets L again |
| Range change of another window | its L line is re-placed in its `draw` hook |

During a line drag the dragged A/B cell already follows the drawn curve live (D-031); an L beside it would be a second moving value per row.

### L9: Numbers and a factor of two

| Number | Value | ×2 | ÷2 |
|---|---|---|---|
| `NEAR_PX` | 8 px (D-032 „about 8 px") | 16 px: in a 200 px plot with 3–4 curves the pointer is near one almost always; the highlight jumps between close curves | 4 px: a 1.5 px line is hard to keep within ±4 px while moving; the highlight rarely shows |
| `HIGHLIGHT_WIDTH` | 3 px (normal 1.5) | 6 px covers steps and neighbouring curves | 1.5 px: no visible difference |
| `FADE_ALPHA` | 0.3 | 0.6: fade barely visible | 0.15: the other curves almost vanish, context lost |
| `LABEL_GAP_PX` | 6 px | 12 px: the label detaches from its point | 3 px: touches the thick line |
| `LIVE_REST_MS` | 150 ms | 300 ms: the values window lags visibly | 75 ms: short pauses in a slow move trigger lookups; more requests (stale ones aborted), values still right |
| L cell `min-width` | 8ch | wastes width; narrow tiles wrap the legend sooner | `-5.00 k` overflows; the grid shifts on hover |
| Publish rate | 1 per animation frame | — | — |
| Values window width that shows L (round 2) | 485 px | fits trivially | 242 px: L may be cut; the table scrolls sideways, accepted (goal is the normal width only) |

## Risks / Trade-offs

- [Aggregated view, steep edge: the drawn line between bucket centres passes pixels the bucket mean does not] → nearness misses the vertical part of a jump; the pointer on either level still highlights. Accepted; measuring to the drawn segment would make label value and point disagree.
- [Page scroll under a still pointer fires no `mousemove`] → L keeps its time until the next move. Accepted (the crosshair has the same behaviour).
- [Changing uPlot series `width`/`alpha` at runtime may need a path rebuild in some uPlot versions] → the engineer verifies with `u.redraw(false)` first, else `u.redraw(true)`; still only on a highlight change.
- [Values window re-renders per frame while hovering] → ≤ 50 rows of cheap cells; if measurably slow, move the subscription into an `LiveValueCell` per row.
- [Two moving values when the pointer is over another window while a line is dragged] → suspended (L8).

## Migration Plan

Web only; no data or API migration. Rollback is reverting the web commit.

## Open Questions

Built as recommended unless Jan decides otherwise; each answer changes one pure function or one task.

- **Q1 Values window L source.** (a) **Recommended:** exact server value at the rested L time (L7), consistent with its A/B cells and D-029; ~150 ms delay, one request per row per rest. (b) Drawn data from a timeseries window that plots the same signal (instant; `—` for unplotted signals; `avg` when zoomed out). (c) Hybrid: (b) dimmed at once, (a) at rest. Answer changes task 2.3 only.
- **Q2 L time shown anywhere?** **Recommended: no** — D-032 names no L time; the crosshair and the L lines show where L is. Alternative: `L hh:mm:ss.fff` in the readout row (only while A or B is on) and in the values window header.
- **Q3 Does a min/max band count as "curve" for nearness?** **Recommended: no**, only the mean line: in an overview the bands of several signals overlap over most of the plot and would make every pointer position "near".
- **Q4 Label with kind tag?** **Recommended: no** (`23.0 km/h`); the L cell's tooltip names the kind. Alternative: `22.5 km/h lin`.
