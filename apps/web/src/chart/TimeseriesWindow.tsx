import {
  type CommandInput,
  type CommandResult,
  type CursorName,
  DEFAULT_PLOT_HEIGHT,
  type DiagEvent,
  type Digits,
  type DisplayMode,
  EVENT_CATEGORIES,
  type EventCategory,
  formatAxisTicks,
  type LoggerGap,
  MAX_UNITS,
  parseSignalId,
  type RenderError,
  type SeriesResult,
  type SignalGaps,
  type SignalInfo,
  shortLabel,
  shownName,
  signalGaps,
  type ValuesMode,
  type TimeseriesWindow as WindowState,
} from "@kipscope/shared";
import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { flushSync } from "react-dom";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import "./window.css";
import { fetchCursorValue } from "../api.ts";
import { groupMarks, type Mark, markColor, markStyle, markTitle, PIN_H } from "../events/marks.ts";
import { HINTS } from "../help/hints.ts";
import { holdNoSelect } from "../noselect.ts";
import { calendarTicks, tickLabels, tickStepForWidth, ticks } from "../time/axis.ts";
import { ownRangeText } from "../time/rangeLine.ts";
import { type Cell, formatDeltaT, NO_VALUE } from "../values/format.ts";
import {
  cellState,
  type FetchValue,
  ValueLoader,
  valueErrors,
  valueRequests,
} from "../values/loader.ts";
import { WindowMenu } from "../window/WindowMenu.tsx";
import { markFromHeader, WindowTitle } from "../window/WindowTitle.tsx";
import type { AxisSpec } from "./axes.ts";
import {
  buildModel,
  type ChartModel,
  formatSnaShare,
  isolatedPoints,
  resolutionBadge,
  type SeriesSpec,
  type SignalInput,
  SNA_ALPHA,
  snaShare,
  stateLevels,
  yRange,
} from "./build.ts";
import { tabSeriesCache } from "./cache.ts";
import {
  ClickGate,
  CURSOR_FLAG_PX,
  DOUBLE_CLICK_MS,
  deltaLabelX,
  hitCursor,
  stackFlags,
} from "./cursors.ts";
import { DRAG_THRESHOLD_PX, type DragSource, type DropState } from "./drag.ts";
import { bandsIn, heldWorkWindow, useGapInfo } from "./gaps.ts";
import { draggedHeight, heightCommand, startsHeightDrag, trackHeightDrag } from "./height.ts";
import type { Insets } from "./insets.ts";
import { linkedPreview, shownRange, useLinkedPreview } from "./linkedPreview.ts";
import {
  FADE_ALPHA,
  HIGHLIGHT_WIDTH,
  labelPosition,
  liveCandidates,
  liveCell,
  liveCursor,
  liveLabelText,
  liveTime,
  nearestSignal,
  shouldRepublishLive,
  useLiveCursor,
  useLiveNear,
} from "./live.ts";
import {
  isMissing,
  type LoadRequest,
  loadKey,
  loadStatusText,
  SeriesLoader,
  windowTargets,
} from "./loader.ts";
import { WINDOW_LOADER_OPTIONS } from "./overview.ts";
import {
  atLevel,
  chartValueAt,
  type HeaderCell,
  legendHeaders,
  type ReadoutSource,
  readoutSource,
  sourceCell,
  sourceDelta,
} from "./readout.ts";
import { scopeOfKey, useScopeChange } from "./rescope.ts";
import { clampRange, type Range, RangePreview, WheelFrame, wheelAction } from "./zoom.ts";

const COMMIT_DELAY_MS = 300;
const MIN_SPAN_NS = 100n;
/** Re-anchor the origin before offsets lose float precision (2^53 ns ≈ 104 days). */
const MAX_ORIGIN_DISTANCE = 2n ** 50n;

/** Axis tick font (design T2, the --font-sans stack); measured to size each y axis to its widest tick label. */
const AXIS_FONT = '11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
/** Grid lines, the --border value (design T4); uPlot draws on canvas, so no CSS variable. */
const GRID_STROKE = "#e2e8f0";
/** Logger-gap bands, the --gap-fill value (add-gap-display G7); canvas, so no CSS variable. */
const GAP_FILL = "#f1f5f9";
/** A logger-gap band is at least this many CSS px wide. */
const GAP_MIN_WIDTH = 1;
/** Ticks and labels of every axis, slate-700 (design DW21, D-095: series colours failed contrast). */
const AXIS_STROKE = "#334155";
/** The axis title's swatch, 8 px and a 3 px gap (window.css `.axis-swatch`). */
const AXIS_SWATCH_W = 11;
/** y axis size beyond the widest tick label: tick (4) + gap (5) + spare (3). */
const AXIS_PAD = 12;
/** An axis is at least as wide as its title (+ 4 px), up to this many CSS px. */
const MAX_TITLE_WIDTH = 96;
/** Stand-in tick label sizing an axis whose data is still loading (about five characters). */
const LOADING_TICK_TEXT = "00000";
const AXIS_TICK = 4;
/** uPlot side codes. */
const LEFT = 3;
const RIGHT = 1;
/** The widest x tick label line an edge tick may carry: the date line, a clock with ms. */
const EDGE_LABEL_SAMPLE = "00:00:00.000";
let noAxisInsetPx: number | undefined;
/**
 * Inset of a side without y axis: half the widest edge x tick label and 2 px, so a label centred
 * on the plot's edge (the date line under the first tick of a window without signals) is not cut.
 */
function noAxisInset(): number {
  noAxisInsetPx ??= Math.ceil(textWidth(EDGE_LABEL_SAMPLE) / 2) + 2;
  return noAxisInsetPx;
}
/** Room above the plot area for half of the top y tick label (uPlot's default is 16; design L4). */
const PLOT_HEADROOM = 6;
const HINT_TARGET = "Drop to move · Alt/Ctrl+drop to copy";
const HINT_ADD = "Drop to add";
const HINT_REFUSED = `At most ${MAX_UNITS} units per window`;

interface Props {
  window: WindowState;
  revision: number;
  /** The tab's count of `window.setRange` pushes (live.rangeSets): a rise hands the requests to the loader again (H7). */
  rangeSets: number;
  /** `scopeKey` of the workspace's scope: a change loads the window's failed signals again (add-scope Z12). */
  scopeKey: string;
  info: (signalId: string) => SignalInfo | undefined;
  /** From signalColor(workspace, id). */
  colorOf: (signalId: string) => string;
  onCommand: (command: CommandInput) => Promise<CommandResult>;
  onReady: (windowId: string, revision: number, errors: RenderError[]) => void;
  /** Called once per committed zoom/pan gesture with the range shown before it. */
  onZoomed: (windowId: string, previous: Range) => void;
  /** Double-click on the plot: App fetches the extents, pushes history, sends window.setRange. */
  onReset: (windowId: string) => void;
  /** Pointer down on a legend row's grip. */
  onDragStart: (source: DragSource, event: React.PointerEvent) => void;
  /** Highlight while a drag runs: "source", "target" (canDrop/canAdd), "refused" (unit limit), or undefined. */
  dropState?: DropState;
  /** What a drop does; only read while dropState is "target". Absent → "move". */
  dropAction?: "move" | "add";
  /** Plot left/right inset in CSS px to use (max over all windows), so linked windows line up. */
  insets?: Insets;
  /** Reports this window's own total y axis width per side, when it changes. */
  onInsets?: (windowId: string, natural: Insets) => void;
  /** Effective cursor times: App's preview overrides the workspace. */
  cursors: { a?: bigint; b?: bigint };
  /** Committed cursor times (workspace), decimal ns: the readout's exact values are fetched for these. */
  committed: { a?: string; b?: string };
  /** Significant digits of readout values and y-axis ticks (workspace option). */
  digits: Digits;
  /** Diff mode: show B and Δ columns, the Δt label. `cursors` stays the effective times. */
  diff: boolean;
  /** Local position while placing or dragging; t undefined ends the preview without a command. */
  onCursorPreview: (cursor: CursorName, t: bigint | undefined) => void;
  /** Gesture finished: App sends one cursor.set. */
  onCursorCommit: (cursor: CursorName, t: bigint) => void;
  /** This window is the explorer's add target (L5). */
  marked: boolean;
  /** A click on the header outside the controls; App marks the window. */
  onMark: (windowId: string) => void;
  /** Next-step hints not yet learned in this browser (add-guidance H7, S1). */
  nextHints?: { b: boolean; diff: boolean };
  /** "Link time axes" is on: the window shows another linked window's gesture preview (Z9). */
  linked: boolean;
  /** The shown events of the window's data refs (design V6), from App. */
  events?: readonly DiagEvent[];
  /** The workspace has an open catalog: a signal the session lacks reads `not in this session` (K14). */
  inCase?: boolean;
}

const isLeft = (side: AxisSpec["side"]) => side === "L" || side === "L2";

/** Total y axis width per side; a side without axis counts as noAxisInset(). */
function axisWidths(drawn: AxisSpec[], sizes: number[]) {
  let left = 0;
  let right = 0;
  drawn.forEach((axis, j) => {
    if (isLeft(axis.side)) left += sizes[j] ?? 0;
    else right += sizes[j] ?? 0;
  });
  return {
    left,
    right,
    natural: { left: left || noAxisInset(), right: right || noAxisInset() },
  };
}

/** null mode NULL_EXPAND of uPlot.join: alignment artifacts next to an SNA null become null. */
const NULL_EXPAND = 2;
/** SNA lanes: strip height and minimum period width in CSS px; fill opacity is SNA_ALPHA. */
const SNA_LANE_HEIGHT = 6;
const SNA_MIN_WIDTH = 2;
/** A signal whose data is narrower than this many CSS px is drawn as a column this wide. */
const MIN_SIGNAL_WIDTH = 2;

let measureContext: CanvasRenderingContext2D | null | undefined;
/** Width of a tick label in CSS px. */
function textWidth(text: string): number {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return text.length * 7;
  measureContext.font = AXIS_FONT;
  return measureContext.measureText(text).width;
}

/**
 * A y range uPlot can split: a flat, near-flat or non-finite one would make its axis splits
 * endless (RangeError: Invalid array length). Near-flat is a constant signal whose bucket means
 * carry float noise (smart451 LWS_SPEED: min -1433.6, mean -1433.5999999999979); uPlot's step
 * then adds nothing to the value. Such a range widens around its middle like yRange's flat line.
 */
function spread([min, max]: [number, number]): [number, number] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  // A span at most 1e-9 of the value's magnitude is flat: float noise, not data.
  if (high - low > Math.max(Math.abs(low), Math.abs(high)) * 1e-9) return [low, high];
  const mid = low + (high - low) / 2;
  const pad = Math.max(Math.abs(mid) * 0.1, 1);
  return [mid - pad, mid + pad];
}

const sameRange = (a: Range, b: Range) => a.from === b.from && a.to === b.to;

/** Same items by identity. */
const sameItems = <T,>(a: readonly T[], b: readonly T[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Same chart inputs (results by identity): buildModel would build the same model. */
const sameInputs = (a: SignalInput[], b: SignalInput[]) =>
  a.length === b.length &&
  a.every((x, i) => {
    const y = b[i];
    return (
      y !== undefined &&
      x.key === y.key &&
      x.label === y.label &&
      x.unit === y.unit &&
      x.color === y.color &&
      x.result === y.result &&
      x.states === y.states &&
      x.info === y.info &&
      x.gaps === y.gaps &&
      x.missing === y.missing
    );
  });

/**
 * Hides the crosshair until the next pointer move in the plot. A CSS class, not setCursor:
 * setCursor would leave uPlot's drag start position stale for a drag that leaves the plot.
 * Clears L if this window owns it (design L8): at its old pixel it would name a wrong time.
 */
const hideCursor = (u: uPlot, windowId: string) => {
  u.root.classList.add("cursor-hidden");
  liveCursor.clear(windowId);
};
const showCursor = (u: uPlot) => u.root.classList.remove("cursor-hidden");

function seriesOptions(spec: SeriesSpec): uPlot.Series {
  const paths =
    spec.path === "step"
      ? uPlot.paths.stepped?.({ align: 1 })
      : spec.path === "markers"
        ? () => null
        : uPlot.paths.linear?.();
  const points: uPlot.Series.Points = {
    show: spec.path === "markers",
    size: 5,
    fill: spec.color,
    stroke: spec.color,
  };
  // A line broken at SNA would hide a valid point with no valid neighbor; draw it as a marker.
  if (spec.path === "line" && !spec.envelopeEdge) {
    points.filter = (u, i) => {
      const idxs = isolatedPoints((u.data[i] ?? []) as (number | null | undefined)[]);
      return idxs.length > 0 ? idxs : null;
    };
  }
  return {
    label: spec.label,
    scale: spec.scale,
    // Envelope edges stay visible as thin lines so a single-bucket spike still shows.
    stroke: spec.envelopeEdge ? `${spec.color}88` : spec.color,
    width: spec.envelopeEdge ? 1 : 1.5,
    // Gaps are SNA only: alignment artifacts (undefined) are still bridged.
    spanGaps: false,
    ...(paths ? { paths } : {}),
    points,
  };
}

/** One data ref's logger gaps (time order) and the drawn results of its signals (G9 (a)). */
interface GapGroup {
  logger: readonly LoggerGap[];
  results: readonly SeriesResult[];
}

/**
 * Paints the logger gaps that meet the shown range as bands over the plot's full height (G7), in
 * the drawClear hook: under the grid, the event lines, the curves and the SNA lanes. Bands per
 * data ref, without gaps that hold a sample of its results (G9 (a)); painted as their union.
 */
function drawGapBands(u: uPlot, groups: readonly GapGroup[], origin: bigint) {
  if (groups.length === 0) return;
  const { from, to } = shownRangeOf(u, origin);
  const bands = groups.flatMap((g) => bandsIn(g.logger, from, to, g.results));
  if (bands.length === 0) return;
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const minWidth = GAP_MIN_WIDTH * devicePixelRatio;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.fillStyle = GAP_FILL;
  for (const band of bands) {
    let x0 = u.valToPos(Number(band.from - origin), "x", true);
    let x1 = u.valToPos(Number(band.to - origin), "x", true);
    if (x1 - x0 < minWidth) {
      const center = (x0 + x1) / 2;
      x0 = center - minWidth / 2;
      x1 = center + minWidth / 2;
    }
    ctx.fillRect(x0, top, x1 - x0, height);
  }
  ctx.restore();
}

/** Paints each signal's SNA periods as a strip at the bottom of the plot area, lane 0 lowest. */
function drawSnaLanes(u: uPlot, lanes: ChartModel["sna"]) {
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const dpr = devicePixelRatio;
  const laneHeight = SNA_LANE_HEIGHT * dpr;
  const minWidth = SNA_MIN_WIDTH * dpr;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.globalAlpha = SNA_ALPHA;
  lanes.forEach((lane, i) => {
    ctx.fillStyle = lane.color;
    const y = top + height - (i + 1) * laneHeight;
    for (const [start, end] of lane.periods) {
      let x0 = u.valToPos(start, "x", true);
      let x1 = u.valToPos(end, "x", true);
      if (x1 - x0 < minWidth) {
        const center = (x0 + x1) / 2;
        x0 = center - minWidth / 2;
        x1 = center + minWidth / 2;
      }
      ctx.fillRect(x0, y, x1 - x0, laneHeight);
    }
  });
  ctx.restore();
}

/**
 * Draws every signal whose data spans less than MIN_SIGNAL_WIDTH px as a column of that width
 * from its lowest to its highest value (envelope included). At wide ranges, such as the clamped
 * 1900 … 2262, all buckets fall into one pixel and the line alone would vanish.
 */
function drawNarrowSignals(u: uPlot, model: ChartModel) {
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const dpr = devicePixelRatio;
  const minWidth = MIN_SIGNAL_WIDTH * dpr;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  model.tables.forEach((table, i) => {
    const xs = table[0] as number[];
    const first = xs[0];
    const last = xs.at(-1);
    if (first === undefined || last === undefined) return;
    const x0 = u.valToPos(first, "x", true);
    const x1 = u.valToPos(last, "x", true);
    if (x1 - x0 >= minWidth) return;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const column of table.slice(1)) {
      for (const v of column) {
        if (v === null || v === undefined) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    const scale = model.tableScales[i];
    // sna[i] belongs to the same signal as tables[i]: both hold one entry per loaded signal.
    const color = model.sna[i]?.color;
    if (lo > hi || !scale || !color) return;
    const yTop = u.valToPos(hi, scale, true);
    const yBottom = u.valToPos(lo, scale, true);
    const center = (x0 + x1) / 2;
    ctx.fillStyle = color;
    ctx.fillRect(
      center - minWidth / 2,
      yTop - dpr,
      minWidth,
      Math.max(0, yBottom - yTop) + 2 * dpr,
    );
  });
  ctx.restore();
}

/**
 * Centres each axis title over its axis column. uPlot stacks axes of one side from the plot
 * outward in array order (L before L2, R before R2); sizes[j] is the size of axes[j] in CSS px.
 */
/** Event lines (design V6): faults solid, changes dashed, others dotted, at half opacity. */
const FAULTS: ReadonlySet<EventCategory> = new Set(["active", "pending", "stored"]);
const EVENT_LINE_ALPHA = 0.5;
/** A glyph's hit reaches this far below the headroom into the plot, CSS px (design V6). */
const GLYPH_HIT_BELOW = 4;

const eventDash = (c: EventCategory): number[] =>
  FAULTS.has(c) ? [] : c === "change" ? [4, 3] : [1, 3];

/**
 * A 1 px line over the plot area at each event's x, behind the curves (the drawAxes hook,
 * design V6); where events share a device pixel, the most severe category's line only.
 */
function drawEventLines(u: uPlot, events: readonly DiagEvent[], origin: bigint) {
  if (events.length === 0) return;
  const { ctx } = u;
  const { left, top, width, height } = u.bbox;
  const severest = new Map<number, number>();
  for (const e of events) {
    const x = Math.round(u.valToPos(Number(BigInt(e.t) - origin), "x", true));
    if (x < left || x > left + width) continue;
    const rank = EVENT_CATEGORIES.indexOf(e.category);
    const known = severest.get(x);
    if (known === undefined || rank < known) severest.set(x, rank);
  }
  const dpr = devicePixelRatio;
  const lineWidth = Math.max(1, Math.round(dpr));
  const offset = lineWidth % 2 === 1 ? 0.5 : 0;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, width, height);
  ctx.clip();
  ctx.globalAlpha = EVENT_LINE_ALPHA;
  ctx.lineWidth = lineWidth;
  for (const [x, rank] of severest) {
    const category = EVENT_CATEGORIES[rank] ?? "other";
    ctx.strokeStyle = markColor(category);
    ctx.setLineDash(eventDash(category).map((d) => d * dpr));
    ctx.beginPath();
    ctx.moveTo(x + offset, top);
    ctx.lineTo(x + offset, top + height);
    ctx.stroke();
  }
  ctx.restore();
}

/** Event glyphs (design V6): a box over the headroom beside u.over, one span per mark. */
function createEventGlyphs(u: uPlot): HTMLElement {
  const box = document.createElement("div");
  box.className = "event-glyphs";
  box.style.height = `${PLOT_HEADROOM + GLYPH_HIT_BELOW}px`;
  box.style.setProperty("--glyph-height", `${PIN_H}px`);
  u.over.after(box);
  return box;
}

/**
 * Groups the events on the current x scale (zoom previews included) and puts one glyph per mark
 * in the headroom, its hit span from `hit`, the drawn pin from `drawn`. The spans are rebuilt
 * only when a mark changed, so a redraw keeps an open tooltip. Returns the marks.
 */
function placeEventGlyphs(
  u: uPlot,
  box: HTMLElement,
  events: readonly DiagEvent[],
  origin: bigint,
): Mark[] {
  const dpr = devicePixelRatio;
  const px = u.bbox.width / dpr;
  box.style.left = `${u.bbox.left / dpr}px`;
  box.style.top = `${u.bbox.top / dpr - PLOT_HEADROOM}px`;
  box.style.width = `${px}px`;
  const marks = groupMarks(events, (t) => u.valToPos(Number(t - origin), "x"), px);
  const titles = marks.map(markTitle);
  const key = marks
    .map((m, i) => `${m.hit.left},${m.hit.right},${m.drawn.left},${m.drawn.right},${titles[i]}`)
    .join("\n");
  if (box.dataset.key === key) return marks;
  box.dataset.key = key;
  box.replaceChildren(
    ...marks.map((m, i) => {
      const glyph = document.createElement("span");
      glyph.className = "event-glyph";
      glyph.dataset.index = String(i);
      glyph.title = titles[i] ?? "";
      glyph.style.left = `${m.hit.left}px`;
      glyph.style.width = `${m.hit.right - m.hit.left}px`;
      // The drawn part is the glyph's ::before (window.css); markStyle reaches it as variables.
      const style = markStyle(m);
      glyph.style.setProperty("--glyph-bg", style.background);
      glyph.style.setProperty("--glyph-shadow", style.boxShadow ?? "none");
      glyph.style.setProperty("--glyph-left", `${m.drawn.left - m.hit.left}px`);
      glyph.style.setProperty("--glyph-width", `${m.drawn.right - m.drawn.left}px`);
      return glyph;
    }),
  );
  return marks;
}

function placeTitles(u: uPlot, row: HTMLElement | null, drawn: AxisSpec[], sizes: number[]) {
  if (!row) return;
  const dpr = devicePixelRatio;
  let left = u.bbox.left / dpr;
  let right = (u.bbox.left + u.bbox.width) / dpr;
  drawn.forEach((axis, j) => {
    const size = sizes[j] ?? 0;
    let x: number;
    if (isLeft(axis.side)) {
      left -= size;
      x = left;
    } else {
      x = right;
      right += size;
    }
    const el = row.children[j] as HTMLElement | undefined;
    if (el) {
      el.style.left = `${x}px`;
      el.style.width = `${size}px`;
    }
  });
}

/** The range on the x scale (the zoom preview included); offsets stay exact below 2^53. */
function shownRangeOf(u: uPlot, origin: bigint): Range {
  return {
    from: origin + BigInt(Math.round(u.scales.x?.min ?? 0)),
    to: origin + BigInt(Math.round(u.scales.x?.max ?? 1)),
  };
}

type CursorLines = Record<CursorName, HTMLElement> & { delta: HTMLElement };
/** Row height of a cursor flag (its line-height in window.css); a stacked B flag sits one row down. */
const CURSOR_FLAG_ROW_PX = 14;
/** A flag's extent right of its line: it starts 1 px right of the line; plus 1 px gap. */
const FLAG_EXTENT_PX = CURSOR_FLAG_PX + 2;
type CursorX = { a?: number; b?: number };

/**
 * Cursor overlays inside u.over (design C3): a transparent hit strip with a 1 px line in its
 * centre and a flag at the top. B is appended after A, so it is drawn above. The Δt label sits at
 * the top between the flags (design N3).
 */
function createCursorLines(over: HTMLElement): CursorLines {
  const make = (name: CursorName) => {
    const strip = document.createElement("div");
    strip.className = `cursor-line cursor-${name}`;
    strip.dataset.cursor = name;
    strip.style.display = "none";
    const flag = document.createElement("span");
    flag.className = "cursor-flag";
    flag.textContent = name.toUpperCase();
    strip.append(flag);
    over.append(strip);
    return strip;
  };
  const delta = document.createElement("span");
  delta.className = "cursor-delta";
  delta.style.display = "none";
  over.append(delta);
  return { a: make("a"), b: make("b"), delta };
}

/**
 * Puts each line at its time on the current x scale (the zoom preview included) and hides lines
 * outside the plot; in diff mode with both lines shown, places the Δt label. Returns the shown
 * lines' x in CSS px for the hit test.
 */
function placeCursorLines(
  u: uPlot,
  lines: CursorLines,
  cursors: { a?: bigint; b?: bigint },
  origin: bigint,
  diff: boolean,
): CursorX {
  const shown: CursorX = {};
  const width = u.bbox.width / devicePixelRatio;
  const { from, to } = shownRangeOf(u, origin);
  for (const name of ["a", "b"] as const) {
    const strip = lines[name];
    const t = cursors[name];
    // Half-open like the readout (chartValueAt): a line at `to` would read "outside this range".
    if (t === undefined || t < from || t >= to) {
      strip.style.display = "none";
      continue;
    }
    const x = u.valToPos(Number(t - origin), "x");
    strip.style.display = "";
    strip.style.left = `${x}px`;
    shown[name] = x;
  }
  const flagB = lines.b.firstElementChild as HTMLElement | null;
  if (flagB) flagB.style.top = stackFlags(shown, width) ? `${CURSOR_FLAG_ROW_PX}px` : "";
  const label = lines.delta;
  const { a, b } = cursors;
  if (
    !diff ||
    a === undefined ||
    b === undefined ||
    shown.a === undefined ||
    shown.b === undefined
  ) {
    label.style.display = "none";
    return shown;
  }
  label.textContent = `Δt ${formatDeltaT(b - a)}`;
  label.style.display = "";
  const labelWidth = label.offsetWidth;
  let x = deltaLabelX(shown.a, shown.b, labelWidth, FLAG_EXTENT_PX);
  // No room right of the right-hand flag: left of the left-hand line, where no flag is.
  if (x + labelWidth > width) x = Math.min(shown.a, shown.b) - labelWidth - 1;
  label.style.left = `${x}px`;
  return shown;
}

/** Live overlays inside u.over (design L3, L6): the L line of other windows and the owner's label. */
type LiveOverlays = { line: HTMLElement; label: HTMLElement };

function createLiveOverlays(over: HTMLElement): LiveOverlays {
  const line = document.createElement("div");
  line.className = "live-line";
  line.style.display = "none";
  const label = document.createElement("span");
  label.className = "live-label";
  label.style.display = "none";
  over.append(line, label);
  return { line, label };
}

/** Puts the L line at t with the A/B rule (inside the half-open shown range), else hides it. */
function placeLiveLine(u: uPlot, line: HTMLElement, t: bigint | undefined, origin: bigint) {
  const { from, to } = shownRangeOf(u, origin);
  if (t === undefined || t < from || t >= to) {
    line.style.display = "none";
    return;
  }
  line.style.display = "";
  line.style.left = `${u.valToPos(Number(t - origin), "x")}px`;
}

const fetchValue: FetchValue = (r, abort) => fetchCursorValue(r.signalId, r.t, r.mode, abort);

/** The badge's tooltip from its short text `raw`, `agg · <w>` or `part · <w>` (H5). */
/** The mode tag's tooltip from its text: `agg <w>`, `part <w>` or `raw` (DW11). */
function badgeHint(short: string): string {
  const space = short.indexOf(" ");
  const kind = space < 0 ? short : short.slice(0, space);
  return kind === "agg" || kind === "part"
    ? HINTS.badge(kind, short.slice(space + 1))
    : HINTS.badge("raw");
}

/** One readout value in a legend row: number with unit, tag, SNA or gap style, reason as tooltip. */
function ReadoutCell({ cell, className }: { cell: Cell; className?: string }) {
  return (
    <span
      className={`value${className ? ` ${className}` : ""}${cell.sna ? " sna-value" : ""}${cell.gap ? " gap-value" : ""}${cell.loading ? " loading" : ""}`}
      title={cell.title}
    >
      {cell.text}
      {cell.tag && <span className="tag">{cell.tag}</span>}
    </span>
  );
}

/** A head of a cursor column (DW12): fixed width, cut with "…", the full text as tooltip. */
function CursorHead({ cell }: { cell: HeaderCell | undefined }) {
  return (
    <span className="cursor-head cursor-col" title={cell?.title ?? cell?.text}>
      {cell?.text}
    </span>
  );
}

/** The text a cursor column is as wide as (cursors "Readout row"), in the header's font. */
const CURSOR_COL_SAMPLE = "A 00:00:00.000";

/** A failure's pill in the 56 px status column; the full `failed: <message>` is its tooltip. */
const FAILED_PILL = "failed";

/** The name column's least width: swatch, gap and about four characters of the name. */
const NAME_COL_MIN = 48;

/**
 * The L cell of one legend row (design L4): the drawn value at L in this window. Only these cells
 * re-render per published frame.
 */
function LiveCell({
  result,
  mode,
  unit,
  digits,
  info,
  gaps,
}: {
  result: SeriesResult | undefined;
  mode: DisplayMode;
  unit: string | undefined;
  digits: Digits;
  info: SignalInfo | undefined;
  gaps: SignalGaps;
}) {
  const live = useLiveCursor();
  const v = live && chartValueAt(result, live.t, mode, info, gaps);
  return (
    <ReadoutCell cell={liveCell(v, live !== undefined, unit, digits, info)} className="live" />
  );
}

export function TimeseriesWindow({
  window: w,
  revision,
  rangeSets,
  scopeKey,
  info,
  colorOf,
  onCommand,
  onReady,
  onZoomed,
  onReset,
  onDragStart,
  dropState,
  dropAction,
  insets,
  onInsets,
  cursors,
  committed,
  digits,
  diff,
  onCursorPreview,
  onCursorCommit,
  marked,
  onMark,
  nextHints,
  linked,
  events,
  inCase = false,
}: Props) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const titleRow = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLUListElement>(null);
  // Cursor columns (cursors "Readout row"): one width, that of CURSOR_COL_SAMPLE in the header's
  // font, measured once, so moving a cursor changes no column.
  useLayoutEffect(() => {
    const ul = legendRef.current;
    if (!ul) return;
    const probe = document.createElement("span");
    probe.className = "cursor-head";
    probe.textContent = CURSOR_COL_SAMPLE;
    probe.style.cssText = "position: absolute; visibility: hidden; width: auto";
    ul.append(probe);
    ul.style.setProperty("--cursor-col", `${Math.ceil(probe.getBoundingClientRect().width)}px`);
    probe.remove();
  }, []);
  const uplot = useRef<uPlot | undefined>(undefined);
  const [width, setWidth] = useState(0);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const loader = useMemo(
    () => new SeriesLoader(tabSeriesCache(), rerender, WINDOW_LOADER_OPTIONS),
    [],
  );
  useEffect(() => () => loader.dispose(), [loader]);

  // Height being dragged; shown until the window's stored height changes from `base`.
  const [heightDrag, setHeightDrag] = useState<{ base?: number; height: number } | undefined>();
  // The stored height changed (our setHeight arrived, or another client's): the drag is over.
  if (heightDrag && heightDrag.base !== w.height) setHeightDrag(undefined);
  const storedHeight = w.height ?? DEFAULT_PLOT_HEIGHT;
  const plotHeight = heightDrag && heightDrag.base === w.height ? heightDrag.height : storedHeight;
  // The running height drag's dispose; called on unmount, which sends no command (H8).
  const disposeHeightDrag = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => disposeHeightDrag.current?.(), []);

  const serverRange: Range = useMemo(
    () => ({ from: BigInt(w.range.from), to: BigInt(w.range.to) }),
    [w.range.from, w.range.to],
  );
  const origin = useRef(serverRange.from);
  const distance = serverRange.from - origin.current;
  if (distance > MAX_ORIGIN_DISTANCE || -distance > MAX_ORIGIN_DISTANCE) {
    origin.current = serverRange.from;
  }

  // Local preview during zoom/pan; the server range changes only after the command is accepted.
  const preview = useMemo(() => new RangePreview(), []);
  // Bumped when a preview is dropped without a new server range (rejected, or reset to the same
  // range): the plot drew the preview directly, so the view effect must set the server range again.
  const [viewEpoch, reapplyView] = useReducer((n: number) => n + 1, 0);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Range shown before the gesture that is being previewed (for the zoom history).
  const gestureStart = useRef<Range | undefined>(undefined);
  const onResetRef = useRef(onReset);
  onResetRef.current = onReset;
  const insetsRef = useRef(insets);
  insetsRef.current = insets;
  const onInsetsRef = useRef(onInsets);
  onInsetsRef.current = onInsets;
  const reportedInsets = useRef<Insets | undefined>(undefined);

  // Cursors (design C2/C3): drawn from props in the draw hook, gestures report to App.
  const cursorsRef = useRef(cursors);
  cursorsRef.current = cursors;
  const diffRef = useRef(diff);
  diffRef.current = diff;
  const digitsRef = useRef(digits);
  digitsRef.current = digits;
  const onCursorPreviewRef = useRef(onCursorPreview);
  onCursorPreviewRef.current = onCursorPreview;
  const onCursorCommitRef = useRef(onCursorCommit);
  onCursorCommitRef.current = onCursorCommit;
  // Live cursor (design L3): read by the pointer and store handlers of the uPlot instance.
  const signalsRef = useRef(w.signals);
  signalsRef.current = w.signals;
  const modeRef = useRef(w.display.mode);
  modeRef.current = w.display.mode;
  const infoRef = useRef(info);
  infoRef.current = info;
  const colorOfRef = useRef(colorOf);
  colorOfRef.current = colorOf;
  // Event marks (design V6): read by the drawAxes and draw hooks.
  const eventsRef = useRef<readonly DiagEvent[]>(events ?? []);
  eventsRef.current = events ?? [];
  // Gap info of the signals' data refs (add-gap-display G7), once per browser tab, with the
  // measured periods of the window's signals (improve-query-priority P8). Keyed on content:
  // `signals` is a new array on every revision.
  const dataRefsKey = [
    ...new Set(w.signals.flatMap((s) => parseSignalId(s.signalId)?.dataRef ?? [])),
  ].join("\n");
  const dataRefs = useMemo(
    () => (dataRefsKey === "" ? [] : dataRefsKey.split("\n")),
    [dataRefsKey],
  );
  const signalIdsKey = w.signals.map((s) => s.signalId).join("\n");
  const signalIds = useMemo(
    () => (signalIdsKey === "" ? [] : signalIdsKey.split("\n")),
    [signalIdsKey],
  );
  // In an object scope gap info covers the work window around the committed range (K11), asked
  // again only when the range leaves the window held.
  const heldWindow = useRef<{ from: string; to: string } | undefined>(undefined);
  heldWindow.current = heldWorkWindow(heldWindow.current, w.range, scopeOfKey(scopeKey));
  const gapInfo = useGapInfo(signalIds, scopeKey, heldWindow.current);
  const gapsOf = (signalId: string): SignalGaps => {
    const dataRef = parseSignalId(signalId)?.dataRef;
    return signalGaps(dataRef === undefined ? undefined : gapInfo.infos.get(dataRef), signalId);
  };
  const gapsOfRef = useRef(gapsOf);
  gapsOfRef.current = gapsOf;
  // Per data ref its logger gaps and the drawn results of its signals (a sample of another data
  // ref says nothing, G9 (a)): read by the drawClear hook.
  const loggerInfos = dataRefs.map((r) => gapInfo.infos.get(r));
  const drawnResults = w.signals.map((s) => loader.get(s.id)?.result);
  const windowGaps = useRef<{
    infos: typeof loggerInfos;
    results: typeof drawnResults;
    groups: readonly GapGroup[];
  }>({ infos: [], results: [], groups: [] });
  if (
    !sameItems(loggerInfos, windowGaps.current.infos) ||
    !sameItems(drawnResults, windowGaps.current.results)
  ) {
    const groups = dataRefs.flatMap((ref, i): GapGroup[] => {
      const logger = loggerInfos[i]?.logger ?? [];
      if (logger.length === 0) return [];
      const results = w.signals.flatMap((s, j) => {
        const result = drawnResults[j];
        return result && parseSignalId(s.signalId)?.dataRef === ref ? [result] : [];
      });
      return [{ logger: logger.map((g) => ({ from: BigInt(g.from), to: BigInt(g.to) })), results }];
    });
    windowGaps.current = { infos: loggerInfos, results: drawnResults, groups };
  }
  // A window removed while it owns L gets no mouseleave.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a window keeps its id
  useEffect(() => () => liveCursor.clear(w.id), []);
  // The overlays of the current uPlot instance, and x of the shown lines in CSS px as last placed.
  const cursorLines = useRef<CursorLines | undefined>(undefined);
  const cursorX = useRef<CursorX>({});
  const gate = useMemo(() => new ClickGate(DOUBLE_CLICK_MS), []);
  useEffect(() => () => gate.dispose(), [gate]);
  // The click waiting in the gate; its line shows as App's preview.
  const pendingClick = useRef<{ name: CursorName; t: bigint } | undefined>(undefined);

  const placeClick = (name: CursorName, t: bigint) => {
    const pending = pendingClick.current;
    // A click of the other cursor ends no double-click: the waiting one is committed now.
    if (pending && pending.name !== name) {
      gate.doubleClick();
      onCursorCommitRef.current(pending.name, pending.t);
    }
    pendingClick.current = { name, t };
    onCursorPreviewRef.current(name, t);
    gate.click(() => {
      pendingClick.current = undefined;
      onCursorCommitRef.current(name, t);
    });
  };
  const placeClickRef = useRef(placeClick);
  placeClickRef.current = placeClick;

  // The shown range (Z1, Z9): the own preview, else a linked window's gesture, else the server
  // range. Drops an accepted preview once its server range arrived, or another client's range wins.
  const shared = useLinkedPreview();
  const viewRange = () => shownRange(w.id, preview.range, shared, linked, serverRange);
  preview.settle(serverRange, commitTimer.current !== undefined);
  // The header shows this range too, so it always matches the plot.
  const view = viewRange();
  const ownPreview = preview.range;
  // The source clears the shared preview once its own is dropped, or when unlinked.
  useLayoutEffect(() => {
    if (!ownPreview || !linked) linkedPreview.clear(w.id);
  }, [ownPreview, linked, w.id]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a window keeps its id
  useEffect(() => () => linkedPreview.clear(w.id), []);

  const target = Math.min(4000, Math.max(100, Math.round(width)));
  // The neighbour preload asks the tiles this window will draw at its target (K13).
  useEffect(() => {
    if (width === 0) return;
    windowTargets.set(w.id, target);
    return () => {
      windowTargets.delete(w.id);
    };
  }, [w.id, target, width]);
  const loadRequests = (from: string, to: string): LoadRequest[] =>
    width === 0
      ? []
      : w.signals.map((s) => ({ key: s.id, signalId: s.signalId, from, to, target }));
  // Loads follow the shown range during the gesture (Z1); the acknowledgement the committed one.
  // Keyed on the signals' content and the range-command count, not the `signals` array, which is
  // new on every revision: unrelated revisions do not retry a failed signal (H7).
  const viewFrom = view.from.toString();
  const viewTo = view.to.toString();
  const signalsKey = loadKey(w.signals, 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadRequests reads w.signals, target and width
  const requests = useMemo(
    () => loadRequests(viewFrom, viewTo),
    [loadKey(w.signals, rangeSets), viewFrom, viewTo, target, width],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadRequests reads w.signals, target and width
  const committedRequests = useMemo(
    () => loadRequests(w.range.from, w.range.to),
    [signalsKey, w.range.from, w.range.to, target, width],
  );
  // Readout values (D-031): the exact value at each committed cursor from the server, like the
  // values window, inside or outside the zoom (readoutSource). Markers evaluate as line.
  const values = useMemo(() => new ValueLoader(fetchValue, rerender), []);
  useEffect(() => () => values.dispose(), [values]);
  // A new scope: the tab's caches first, then failed or loading series and every value again.
  useScopeChange(scopeKey, () => {
    loader.rescope();
    values.rescope();
  });
  // Before paint, so a cached view is drawn in the frame that applied the step.
  useLayoutEffect(() => loader.update(requests), [loader, requests]);

  const valueMode: ValuesMode = w.display.mode === "step" ? "step" : "line";
  const exactRequests = useMemo(
    () =>
      valueRequests(
        w.signals,
        {
          ...(committed.a === undefined ? {} : { a: committed.a }),
          ...(committed.b === undefined ? {} : { b: committed.b }),
        },
        valueMode,
      ),
    [w.signals, committed.a, committed.b, valueMode],
  );
  useEffect(() => values.update(exactRequests), [values, exactRequests]);
  const exactOf = new Map(exactRequests.map((r) => [r.key, r]));

  const inputs = w.signals.map((s) => {
    const meta = info(s.signalId);
    const input: SignalInput = {
      key: s.id,
      label: meta ? shownName(meta) : s.signalId,
      color: colorOf(s.signalId),
    };
    const state = loader.get(s.id);
    const result = state?.result;
    const states = stateLevels(meta);
    if (isMissing(state)) input.missing = true;
    if (meta?.unit) input.unit = meta.unit;
    if (result) input.result = result;
    if (states) input.states = states;
    if (meta?.states) input.info = meta;
    input.gaps = gapsOf(s.signalId);
    return input;
  });
  // Rebuilt only when an input changes: a cursor preview rerenders every window on each move.
  const built = useRef<
    | {
        inputs: SignalInput[];
        origin: bigint;
        mode: DisplayMode;
        envelope: boolean;
        model: ChartModel;
      }
    | undefined
  >(undefined);
  const last = built.current;
  const model: ChartModel =
    last &&
    last.origin === origin.current &&
    last.mode === w.display.mode &&
    last.envelope === w.display.envelope &&
    sameInputs(last.inputs, inputs)
      ? last.model
      : buildModel(inputs, origin.current, w.display);
  if (model !== last?.model) {
    const { mode, envelope } = w.display;
    built.current = { inputs, origin: origin.current, mode, envelope, model };
  }
  const modelRef = useRef(model);
  modelRef.current = model;
  // Drawn axes: every axis of the layout, loaded or not, so sides do not jump while loading.
  const drawnAxes = model.layout.axes;
  const structure = useMemo(
    () => JSON.stringify([model.series, model.bands, [...model.scales], model.layout.axes]),
    [model],
  );

  // Axis titles as the tick formatter prefixed them, for the uPlot instance of `structure`.
  const [axisTitles, setAxisTitles] = useState<{ structure: string; titles: string[] }>();
  const axisTitle = (j: number, axis: AxisSpec) =>
    (axisTitles?.structure === structure ? axisTitles.titles[j] : undefined) ?? axis.title;

  // --- uPlot instance -------------------------------------------------------------------------

  // The x range we last set; y ranges read it because u.scales.x is stale while new data is set.
  const xView = useRef<[number, number]>([0, 1]);
  const setView = (u: uPlot, r: Range) => {
    xView.current = [Number(r.from - origin.current), Number(r.to - origin.current)];
    u.setScale("x", { min: xView.current[0], max: xView.current[1] });
  };

  const commit = (r: Range) => {
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(async () => {
      commitTimer.current = undefined;
      const previous = gestureStart.current;
      gestureStart.current = undefined;
      const { ok, reapply } = await preview.commit(r, () =>
        onCommand({
          type: "window.setRange",
          windowId: w.id,
          from: r.from.toString(),
          to: r.to.toString(),
        }),
      );
      if (ok && previous) onZoomed(w.id, previous);
      if (reapply) reapplyView();
      rerender();
    }, COMMIT_DELAY_MS);
  };

  const applyRange = (u: uPlot, min: number, max: number) => {
    const r = clampRange({
      from: origin.current + BigInt(Math.round(min)),
      to: origin.current + BigInt(Math.round(max)),
    });
    const shown = viewRange();
    if (r.to - r.from < MIN_SPAN_NS || sameRange(r, shown)) return;
    gestureStart.current ??= shown;
    preview.range = r;
    setView(u, r);
    hideCursor(u, w.id);
    commit(r);
    // The header, the loader and cached data (and the linked windows) follow in this frame.
    if (linked) {
      flushSync(() => {
        linkedPreview.publish(w.id, r);
        rerender();
      });
    } else flushSync(rerender);
  };
  const applyRangeRef = useRef(applyRange);
  applyRangeRef.current = applyRange;

  // biome-ignore lint/correctness/useExhaustiveDependencies: recreated only when the series structure changes
  useLayoutEffect(() => {
    const el = plotRef.current;
    if (!el || width === 0) return;
    let step = 1n;
    // Month or year labels of the last splits when the span is too wide for clock steps.
    let calendarLabels: string[] | undefined;
    const scales: uPlot.Scales = { x: { time: false } };
    const axes: uPlot.Axis[] = [
      {
        space: 100,
        size: 48,
        font: AXIS_FONT,
        stroke: AXIS_STROKE,
        ticks: { stroke: AXIS_STROKE },
        grid: { stroke: GRID_STROKE },
        splits: (u) => {
          const min = u.scales.x?.min ?? 0;
          const max = u.scales.x?.max ?? 1;
          const from = origin.current + BigInt(Math.floor(min));
          const to = origin.current + BigInt(Math.ceil(max));
          const widthPx = u.bbox.width / devicePixelRatio;
          const calendar = calendarTicks(from, to, widthPx);
          calendarLabels = calendar?.labels;
          if (calendar) return calendar.ticks.map((t) => Number(t - origin.current));
          step = tickStepForWidth(from, to, widthPx);
          return ticks(from, to, step).map((t) => Number(t - origin.current));
        },
        values: (_u, splits) =>
          calendarLabels ??
          tickLabels(
            splits.map((s) => origin.current + BigInt(Math.round(s))),
            step,
          ),
      },
    ];
    // Every drawn axis needs its scale, also before its data has loaded (range then [0, 1]).
    const scaleKeys = new Set([...model.scales.keys(), ...drawnAxes.map((a) => a.scale)]);
    for (const key of scaleKeys) {
      // Own y range: uPlot's auto range ignores points outside the view, so a segment drawn
      // only from edge neighbors would get no scale and disappear.
      scales[key] = {
        auto: true,
        range: (_u, dataMin, dataMax) =>
          spread(
            yRange(modelRef.current, key, xView.current[0], xView.current[1]) ?? [
              dataMin ?? 0,
              dataMax ?? 1,
            ],
          ),
      };
    }
    // y axis sizes in CSS px, index j = drawnAxes[j] (uPlot axis j + 1).
    const sizes: number[] = [];
    // Axis titles with the ticks' SI prefix (design N8), set when the tick labels are made.
    const titles: string[] = drawnAxes.map((a) => a.title);
    // One grid is enough; more would draw unrelated lines over each other. It follows the first
    // axis with data, so no grid is drawn for a placeholder range.
    const gridAxis = drawnAxes.findIndex((a) => model.scales.has(a.scale));
    drawnAxes.forEach((axis, j) => {
      const loaded = model.scales.has(axis.scale);
      // Unit axes are titled by their unit; a unit-less signal's axis by its name, without prefix.
      const unit = axis.scale.startsWith("u:") ? axis.title : undefined;
      const tickValues = (_u: uPlot, splits: number[]) => {
        const { title, labels } = formatAxisTicks(splits, unit, digitsRef.current);
        titles[j] = unit === undefined ? axis.title : title;
        return labels;
      };
      axes.push({
        scale: axis.scale,
        side: axis.side === "L" || axis.side === "L2" ? LEFT : RIGHT,
        font: AXIS_FONT,
        // An axis still loading keeps its place and title but shows no ticks or values. Tick
        // marks in the labels' slate (DW21), not uPlot's faint default.
        ticks: { show: loaded, size: AXIS_TICK, stroke: AXIS_STROKE },
        values: loaded ? tickValues : (_u: uPlot, splits: number[]) => splits.map(() => ""),
        stroke: AXIS_STROKE,
        grid: { show: j === gridAxis, stroke: GRID_STROKE },
        size: (_u, values, _i, cycle) => {
          const last = sizes[j];
          if (cycle > 1 && last !== undefined) return last;
          // A loading axis has no values yet; reserve typical tick width so the plot does not
          // shift sideways when the data arrives.
          const widest = loaded
            ? Math.max(0, ...(values ?? []).map(textWidth))
            : textWidth(LOADING_TICK_TEXT);
          // Wide enough for the title (and its swatch) too, so a unit like "rpm/10ms" is not cut.
          const swatch = axis.color ? AXIS_SWATCH_W : 0;
          const title = Math.min(MAX_TITLE_WIDTH, textWidth(titles[j] ?? axis.title) + 4 + swatch);
          sizes[j] = Math.ceil(Math.max(widest + AXIS_PAD, title));
          return sizes[j];
        },
      });
    });

    // Cursor overlays; created right after uPlot, read by the draw hook.
    let lines: CursorLines | undefined;
    // Places the L line and label (design L3, L6); set right after uPlot, called by the draw hook.
    let placeLive: (() => void) | undefined;
    // Event glyphs and the marks they show (design V6, V7); created right after uPlot.
    let glyphs: HTMLElement | undefined;
    let marks: Mark[] = [];
    const u = new uPlot(
      {
        width,
        height: plotHeight,
        scales,
        axes,
        series: [{}, ...model.series.map(seriesOptions)],
        bands: model.bands.map(([a, b]) => ({
          series: [a, b] as [number, number],
          fill: `${model.series[a - 1]?.color ?? "#000"}33`,
        })),
        legend: { show: false },
        // Pads the side whose axes are narrower than the widest window's (insets), so the same
        // timestamp sits at the same x in every window. Padding lies outside the outer axes.
        padding: [
          PLOT_HEADROOM,
          () => {
            const { right, natural } = axisWidths(drawnAxes, sizes);
            return Math.max(natural.right, insetsRef.current?.right ?? 0) - right;
          },
          null,
          () => {
            const { left, natural } = axisWidths(drawnAxes, sizes);
            return Math.max(natural.left, insetsRef.current?.left ?? 0) - left;
          },
        ],
        cursor: {
          drag: { x: true, y: false, setScale: false },
          bind: {
            // Replaces uPlot's reset to the loaded data: App resets to the signals' extents.
            dblclick: (self) => () => {
              // The double-click's clicks place no cursor.
              gate.doubleClick();
              const pending = pendingClick.current;
              pendingClick.current = undefined;
              if (pending) onCursorPreviewRef.current(pending.name, undefined);
              clearTimeout(commitTimer.current);
              commitTimer.current = undefined;
              gestureStart.current = undefined;
              // App may send no range (already at the extents): show the server range meanwhile.
              if (preview.drop()) reapplyView();
              hideCursor(self, w.id);
              onResetRef.current(w.id);
              return null;
            },
          },
        },
        hooks: {
          drawClear: [(self) => drawGapBands(self, windowGaps.current.groups, origin.current)],
          drawAxes: [(self) => drawEventLines(self, eventsRef.current, origin.current)],
          draw: [
            (self) => {
              drawSnaLanes(self, modelRef.current.sna);
              drawNarrowSignals(self, modelRef.current);
              if (glyphs) marks = placeEventGlyphs(self, glyphs, eventsRef.current, origin.current);
              if (lines) {
                cursorX.current = placeCursorLines(
                  self,
                  lines,
                  cursorsRef.current,
                  origin.current,
                  diffRef.current,
                );
              }
              placeLive?.();
              placeTitles(self, titleRow.current, drawnAxes, sizes);
              setAxisTitles((prev) =>
                prev?.structure === structure && prev.titles.join("\n") === titles.join("\n")
                  ? prev
                  : { structure, titles: [...titles] },
              );
              const { natural } = axisWidths(drawnAxes, sizes);
              const last = reportedInsets.current;
              if (!last || last.left !== natural.left || last.right !== natural.right) {
                reportedInsets.current = natural;
                onInsetsRef.current?.(w.id, natural);
              }
            },
          ],
          setSelect: [
            (self) => {
              const { left, width: selected } = self.select;
              if (selected > 5) {
                applyRangeRef.current(
                  self,
                  self.posToVal(left, "x"),
                  self.posToVal(left + selected, "x"),
                );
              }
              self.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
            },
          ],
        },
      },
      [[]],
      el,
    );
    uplot.current = u;
    lines = createCursorLines(u.over);
    cursorLines.current = lines;
    const strips = [lines.a, lines.b];
    const glyphBox = createEventGlyphs(u);
    glyphs = glyphBox;
    marks = placeEventGlyphs(u, glyphBox, eventsRef.current, origin.current);
    // Glyph click (design V7): no zoom selection or signal drag; A at the first event's time at
    // once (no double-click meaning), Shift+click B.
    const stopPress = (e: Event) => e.stopPropagation();
    const onGlyphClick = (e: MouseEvent) => {
      const glyph = (e.target as HTMLElement).closest<HTMLElement>(".event-glyph");
      const first = glyph && marks[Number(glyph.dataset.index)]?.events[0];
      if (!first) return;
      e.stopPropagation();
      onCursorCommitRef.current(e.shiftKey ? "b" : "a", BigInt(first.t));
    };
    glyphBox.addEventListener("pointerdown", stopPress);
    glyphBox.addEventListener("mousedown", stopPress);
    glyphBox.addEventListener("click", onGlyphClick);

    /** Time at x CSS px in the plot, snapped to the shown span and kept inside it (design C3, L2). */
    const timeAt = (x: number) =>
      liveTime(u.posToVal(x, "x"), origin.current, shownRangeOf(u, origin.current));
    const plotX = (clientX: number) => {
      const rect = u.over.getBoundingClientRect();
      return Math.min(rect.width, Math.max(0, clientX - rect.left));
    };

    // Line drag: the strip takes the press, so uPlot starts no selection. Each move previews in
    // every window through App; release commits once, Esc puts the line back.
    const stopMouse = (e: MouseEvent) => e.stopPropagation();
    // The running line drag's cancel; called when this uPlot instance is destroyed mid-drag.
    let cancelLineDrag: (() => void) | undefined;
    const startLineDrag = (e: PointerEvent) => {
      e.stopPropagation();
      if (e.button !== 0) return;
      e.preventDefault();
      const strip = e.currentTarget as HTMLElement;
      const name =
        hitCursor(plotX(e.clientX), cursorX.current) ?? (strip.dataset.cursor as CursorName);
      strip.setPointerCapture(e.pointerId);
      const releaseSelect = holdNoSelect();
      // The dragged cell follows the line already; no L beside it (design L8).
      const releaseLive = liveCursor.suspend();
      let t: bigint | undefined;
      const move = (ev: PointerEvent) => {
        t = timeAt(plotX(ev.clientX));
        onCursorPreviewRef.current(name, t);
      };
      const end = (commit: boolean) => {
        cancelLineDrag = undefined;
        releaseSelect();
        releaseLive();
        strip.removeEventListener("pointermove", move);
        strip.removeEventListener("pointerup", release);
        strip.removeEventListener("pointercancel", cancel);
        strip.removeEventListener("lostpointercapture", cancel);
        window.removeEventListener("keydown", onKey);
        if (strip.hasPointerCapture(e.pointerId)) strip.releasePointerCapture(e.pointerId);
        if (t === undefined) return;
        if (commit) onCursorCommitRef.current(name, t);
        else onCursorPreviewRef.current(name, undefined);
      };
      const release = () => end(true);
      const cancel = () => end(false);
      const onKey = (ev: KeyboardEvent) => {
        if (ev.key === "Escape") cancel();
      };
      strip.addEventListener("pointermove", move);
      strip.addEventListener("pointerup", release);
      strip.addEventListener("pointercancel", cancel);
      // Capture lost without pointerup (e.g. the strip was hidden): end like Esc.
      strip.addEventListener("lostpointercapture", cancel);
      window.addEventListener("keydown", onKey);
      cancelLineDrag = cancel;
    };
    for (const strip of strips) {
      strip.addEventListener("pointerdown", startLineDrag);
      strip.addEventListener("mousedown", stopMouse);
    }

    // Click (< DRAG_THRESHOLD_PX of movement) places A, Shift+click B, through the click gate.
    // While the button is down the strips let the pointer through: uPlot ignores a mousemove whose
    // target is not u.over, so a rectangle drag ending on a cursor line would select nothing.
    let down: { x: number; y: number } | undefined;
    const passThrough = (on: boolean) => {
      for (const strip of strips) strip.style.pointerEvents = on ? "none" : "";
    };
    const onDown = (e: MouseEvent) => {
      down = e.button === 0 ? { x: e.clientX, y: e.clientY } : undefined;
      passThrough(down !== undefined);
      // No L while a button is held on the plot (design L8); a click brings it back on release.
      liveCursor.clear(w.id);
    };
    const onUp = (e: MouseEvent) => {
      const start = down;
      down = undefined;
      passThrough(false);
      // A drag (rectangle zoom) keeps L cleared until the next move.
      if (!shouldRepublishLive(start, { x: e.clientX, y: e.clientY }, DRAG_THRESHOLD_PX)) return;
      placeClickRef.current(e.shiftKey ? "b" : "a", timeAt(plotX(e.clientX)));
      // A and L read the same right after a click (D-033); released outside the plot (mouseleave
      // already cleared L) it stays cleared.
      const r = u.over.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX < r.right && e.clientY >= r.top && e.clientY < r.bottom)
        publishLive(e);
    };
    u.over.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);

    // Plain vertical wheel scrolls the page (design N1): preventDefault only for zoom and pan.
    // The events of one frame are joined into one step (one preview, one applyRange).
    const wheelFrame = new WheelFrame();
    let wheelRaf: number | undefined;
    const flushWheel = () => {
      wheelRaf = undefined;
      const { factor, px, share, x } = wheelFrame.take();
      let min = u.scales.x?.min ?? 0;
      let max = u.scales.x?.max ?? 1;
      if (factor !== 1) {
        const at = u.posToVal(x, "x");
        [min, max] = [at - (at - min) * factor, at + (max - at) * factor];
      }
      if (px !== 0 || share !== 0) {
        const delta = (px / u.over.clientWidth + share) * (max - min);
        [min, max] = [min + delta, max + delta];
      }
      if (factor !== 1 || px !== 0 || share !== 0) applyRangeRef.current(u, min, max);
    };
    const onWheel = (e: WheelEvent) => {
      const action = wheelAction(e);
      if (action.kind === "none") return;
      e.preventDefault();
      // Not offsetX: over a cursor line the event's target is the line's hit strip.
      wheelFrame.add(action, e.clientX - u.over.getBoundingClientRect().left);
      wheelRaf ??= requestAnimationFrame(flushWheel);
    };
    // Scale of each signal by assignment id; envelope edges have none of their own (Q3).
    const { scaleOf } = model.layout;
    // NaN (no candidate) for a scale this uPlot instance lacks: data that arrived before the
    // effect re-ran for the new structure.
    const toY = (v: number, scale: string) => (u.scales[scale] ? u.valToPos(v, scale) : Number.NaN);
    /** L at the pointer (design L3, L5): the snapped time and the nearest curve on its own scale. */
    const publishLive = (e: MouseEvent) => {
      const rect = u.over.getBoundingClientRect();
      const t = timeAt(plotX(e.clientX));
      const signals = signalsRef.current.map((s) => ({
        key: s.id,
        scale: scaleOf.get(s.id),
        value: atLevel(
          chartValueAt(
            loader.get(s.id)?.result,
            t,
            modeRef.current,
            infoRef.current(s.signalId),
            gapsOfRef.current(s.signalId),
          ),
          stateLevels(infoRef.current(s.signalId)),
        ),
      }));
      const near = nearestSignal(liveCandidates(signals, toY, rect.height), e.clientY - rect.top);
      liveCursor.set({ windowId: w.id, t, ...(near === undefined ? {} : { near }) });
    };

    // Leaving the plot hides the crosshair through uPlot's own mouseleave handler.
    const onMove = (e: MouseEvent) => {
      showCursor(u);
      // A held button (click, rectangle zoom) sets no L until it is released (design L8).
      if (down === undefined && e.buttons === 0) publishLive(e);
    };
    const onLeave = () => liveCursor.clear(w.id);

    // Live overlays and the near-signal highlight (design L3, L5, L6).
    const live = createLiveOverlays(u.over);
    const baseStyle = u.series.map((s) => ({ width: s.width ?? 1, alpha: s.alpha ?? 1 }));
    let highlighted: string | undefined;
    /** Thicker near line, every series of other signals faded; one redraw, only on a change. */
    const setHighlight = (near: string | undefined) => {
      if (near === highlighted) return;
      highlighted = near;
      model.series.forEach((spec, i) => {
        const s = u.series[i + 1];
        const base = baseStyle[i + 1];
        if (!s || !base) return;
        s.width =
          near !== undefined && spec.key === near && !spec.envelopeEdge
            ? HIGHLIGHT_WIDTH
            : base.width;
        s.alpha = near !== undefined && spec.key !== near ? FADE_ALPHA : base.alpha;
      });
      u.redraw(false);
    };
    placeLive = () => {
      const current = liveCursor.get();
      const own = current?.windowId === w.id;
      // The owner shows its crosshair instead of an L line.
      placeLiveLine(u, live.line, own ? undefined : current?.t, origin.current);
      const label = live.label;
      const near = own ? current.near : undefined;
      const assignment = signalsRef.current.find((s) => s.id === near);
      if (!current || !assignment) {
        label.style.display = "none";
        return;
      }
      const meta = infoRef.current(assignment.signalId);
      const v = chartValueAt(
        loader.get(assignment.id)?.result,
        current.t,
        modeRef.current,
        meta,
        gapsOfRef.current(assignment.signalId),
      );
      // The near signal's curve point, by the same rule that made it a candidate (design L5).
      const [point] = liveCandidates(
        [
          {
            key: assignment.id,
            scale: scaleOf.get(assignment.id),
            value: atLevel(v, stateLevels(meta)),
          },
        ],
        toY,
        u.over.clientHeight,
      );
      // A state shows its name like the legend (N3), a number with its unit.
      const text =
        v && "label" in v && v.label !== undefined
          ? shortLabel(v.label)
          : liveLabelText(v, meta?.unit, digitsRef.current);
      if (!point || text === undefined) {
        label.style.display = "none";
        return;
      }
      label.textContent = text;
      label.style.color = colorOfRef.current(assignment.signalId);
      label.style.display = "";
      const { left, top } = labelPosition(
        { x: u.valToPos(Number(current.t - origin.current), "x"), y: point.y },
        { width: label.offsetWidth, height: label.offsetHeight },
        { width: u.over.clientWidth, height: u.over.clientHeight },
      );
      label.style.left = `${left}px`;
      label.style.top = `${top}px`;
    };
    const onLive = () => {
      const current = liveCursor.get();
      setHighlight(current?.windowId === w.id ? current.near : undefined);
      placeLive?.();
    };
    const unsubscribeLive = liveCursor.subscribe(onLive);
    onLive();

    u.over.addEventListener("wheel", onWheel, { passive: false });
    u.over.addEventListener("mousemove", onMove);
    u.over.addEventListener("mouseleave", onLeave);
    return () => {
      if (wheelRaf !== undefined) cancelAnimationFrame(wheelRaf);
      unsubscribeLive();
      u.over.removeEventListener("wheel", onWheel);
      u.over.removeEventListener("mousemove", onMove);
      u.over.removeEventListener("mouseleave", onLeave);
      u.over.removeEventListener("mousedown", onDown);
      window.removeEventListener("mouseup", onUp);
      cancelLineDrag?.();
      u.destroy();
      uplot.current = undefined;
      cursorLines.current = undefined;
    };
  }, [structure, width === 0]);

  // setSize also re-runs uPlot's size convergence, which reads the new insets.
  // biome-ignore lint/correctness/useExhaustiveDependencies: insets are read via insetsRef
  useEffect(() => {
    uplot.current?.setSize({ width, height: plotHeight });
  }, [width, plotHeight, insets?.left, insets?.right]);

  // Data: only when the model, a dropped preview or the uPlot instance changed, so a cursor
  // preview (which rerenders every window per move) costs no join, setData or redraw.
  // biome-ignore lint/correctness/useExhaustiveDependencies: view is read for the scale reset only, a dropped preview is tracked via viewEpoch; structure and width === 0 mark a new uPlot instance
  useLayoutEffect(() => {
    const u = uplot.current;
    if (!u) return;
    const data =
      model.tables.length > 0
        ? uPlot.join(
            model.tables as uPlot.AlignedData[],
            model.tables.map((t) => t.map(() => NULL_EXPAND)),
          )
        : ([[]] as uPlot.AlignedData);
    xView.current = [Number(view.from - origin.current), Number(view.to - origin.current)];
    u.setData(data, true);
    setView(u, view);
  }, [model, viewEpoch, structure, width === 0]);

  // View: a gesture already set the scale it previews, so only a range set elsewhere redraws.
  // Every change of the shown range (keys, "Go to", Back, a linked window, the CLI, …) hides the
  // crosshair until the pointer moves: at its old pixel it would point at a wrong time.
  const lastShown = useRef(view);
  // biome-ignore lint/correctness/useExhaustiveDependencies: view is tracked via its bounds
  useLayoutEffect(() => {
    const u = uplot.current;
    const changed = !sameRange(lastShown.current, view);
    lastShown.current = view;
    if (!u) return;
    if (changed) hideCursor(u, w.id);
    const x = [Number(view.from - origin.current), Number(view.to - origin.current)];
    if (x[0] !== xView.current[0] || x[1] !== xView.current[1]) setView(u, view);
  }, [view.from, view.to]);

  // Cursor lines only: moving a line needs no redraw (the draw hook places them after a redraw).
  // biome-ignore lint/correctness/useExhaustiveDependencies: cursors are read via cursorsRef, diff via diffRef
  useLayoutEffect(() => {
    const u = uplot.current;
    const lines = cursorLines.current;
    if (u && lines)
      cursorX.current = placeCursorLines(u, lines, cursorsRef.current, origin.current, diff);
  }, [cursors.a, cursors.b, diff]);

  // Tick labels and axis sizes follow the digits option (read via digitsRef).
  const drawnDigits = useRef(digits);
  useLayoutEffect(() => {
    if (drawnDigits.current === digits) return;
    drawnDigits.current = digits;
    uplot.current?.redraw(false, true);
  }, [digits]);

  // Bands follow the gap info and the drawn results (read via windowGaps); new gap info also
  // rebuilds the model.
  const drawnGaps = useRef(windowGaps.current.groups);
  useLayoutEffect(() => {
    if (drawnGaps.current === windowGaps.current.groups) return;
    drawnGaps.current = windowGaps.current.groups;
    uplot.current?.redraw(false);
  });

  // Event lines and glyphs follow the shown events (read via eventsRef); a new array with the
  // same events (App's union per render) redraws nothing.
  const drawnEvents = useRef(eventsRef.current);
  useLayoutEffect(() => {
    const next = eventsRef.current;
    const last = drawnEvents.current;
    if (next.length === last.length && next.every((e, i) => e === last[i])) return;
    drawnEvents.current = next;
    uplot.current?.redraw(false);
  });

  useEffect(() => () => clearTimeout(commitTimer.current), []);

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // --- render acknowledgement -----------------------------------------------------------------

  const settled =
    loader.settled(committedRequests) &&
    values.settled(exactRequests) &&
    gapInfo.settled &&
    width > 0;
  const errors: RenderError[] = [
    ...w.signals.flatMap((s) => {
      const state = loader.get(s.id);
      return state?.status === "error"
        ? [{ windowId: w.id, signalId: s.signalId, message: state.error ?? "error" }]
        : [];
    }),
    ...valueErrors(w.id, exactRequests, values),
    ...gapInfo.errors.map((e) => ({
      windowId: w.id,
      message: `gap info for ${e.dataRef} unavailable: ${e.message}`,
    })),
  ];
  const errorKey = JSON.stringify(errors);
  // biome-ignore lint/correctness/useExhaustiveDependencies: errors are tracked via errorKey
  useEffect(() => {
    if (settled) onReady(w.id, revision, errors);
  }, [settled, revision, errorKey, w.id, onReady]);

  // --- view -----------------------------------------------------------------------------------

  /** Height strip and corner grip (design G1): resize locally while dragged, send
   * window.setHeight on release. */
  const startHeightDrag = (e: React.PointerEvent<HTMLElement>) => {
    if (!startsHeightDrag(e)) return;
    e.preventDefault();
    const handle = e.currentTarget;
    disposeHeightDrag.current?.();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("active");
    const releaseSelect = holdNoSelect();
    const releaseLive = liveCursor.suspend();
    const startY = e.clientY;
    const startHeight = plotHeight;
    const base = w.height;
    let height = startHeight;
    // Ends on release, cancel or lost capture; unmount only releases (H8).
    disposeHeightDrag.current = trackHeightDrag(handle, {
      move: (clientY) => {
        height = draggedHeight(startHeight, clientY - startY);
        setHeightDrag({ ...(base !== undefined ? { base } : {}), height });
      },
      release: () => {
        disposeHeightDrag.current = undefined;
        releaseSelect();
        releaseLive();
        handle.classList.remove("active");
      },
      end: async () => {
        const command = heightCommand(w, height);
        if (!command) {
          setHeightDrag(undefined);
          return;
        }
        const result = await onCommand(command);
        if (!result.ok) setHeightDrag(undefined);
      },
    });
  };

  // Unlinked, the window's own start and duration with its tip as tooltip (add-range-picker R13,
  // D-093, D-095); linked, none: the range control shows it (DW0, DW11).
  const ownRange = ownRangeText(view, linked);
  // Readout (design N3, N4): value columns while a cursor is on, from the drawn data.
  const { a, b } = cursors;
  const readout = a !== undefined || b !== undefined;
  // B's column while B is on; Diff adds Δ and Δt (D-031).
  const showB = b !== undefined || diff;
  // The legend is always a grid (D-033): name, unit, A | B | Δ while a cursor is on, then L
  // (D-032, always, so filling and emptying it moves nothing), status, SNA share, remove.
  const columns = 6 + (readout ? 1 + (showB ? 1 : 0) + (diff ? 1 : 0) : 0);
  // The legend's header row (DW12): cursor times over their columns, the next-step hint (DW15).
  const headers = legendHeaders(a, b, diff, nextHints);
  const liveNear = useLiveNear(w.id);
  const badge = resolutionBadge(w.signals.map((s) => loader.get(s.id)?.result));
  const hint =
    dropState === "target"
      ? dropAction === "add"
        ? HINT_ADD
        : HINT_TARGET
      : dropState === "refused"
        ? HINT_REFUSED
        : undefined;

  return (
    <section
      className={`window timeseries-window${marked ? " marked" : ""}${dropState ? ` drop-${dropState}` : ""}`}
      data-window-id={w.id}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the keyboard path to mark is the explorer's "Add to" select (L5) */}
      <header
        className="window-header"
        title={HINTS.windowHeader(marked)}
        onClick={(e) => markFromHeader(e, w.id, onMark)}
      >
        <WindowTitle
          key={w.title ?? ""}
          window={w}
          editing={renaming}
          onEditing={setRenaming}
          onCommand={onCommand}
        />
        {marked && <span className="mark-pill">Add to</span>}
        {/* Linked, the range control shows the one range (workspace-layout "Linked windows show
            the range once"); unlinked, the window's own range, cut first. */}
        {ownRange !== undefined && (
          <span className="range own-range" title={ownRange.tip}>
            {ownRange.text}
          </span>
        )}
        {/* Fixed slot (DW11): its text changes on zoom, its box never. */}
        <span className="mode-tag" title={badge ? badgeHint(badge.short) : undefined}>
          {badge?.short}
        </span>
        <div className="window-controls" title="">
          <WindowMenu
            windowId={w.id}
            display={w.display}
            onCommand={onCommand}
            onRename={() => setRenaming(true)}
            onRemove={() => onCommand({ type: "window.remove", windowId: w.id })}
          />
        </div>
      </header>
      <div className="axis-titles" ref={titleRow}>
        {drawnAxes.map((a, j) => (
          <span key={a.scale} data-side={a.side} title={axisTitle(j, a)}>
            {/* The axis' only signal's colour as a swatch before the title (DW21). */}
            {a.color && <span className="axis-swatch" style={{ background: a.color }} />}
            {axisTitle(j, a)}
          </span>
        ))}
      </div>
      <div className="plot" ref={plotRef} style={{ height: plotHeight }} />
      <div className="height-handle" title={HINTS.grip} onPointerDown={startHeightDrag} />
      <ul
        className="signals"
        ref={legendRef}
        // The name column alone shrinks below its content (cut with "…", down to NAME_COL_MIN),
        // so the fixed columns stay inside the window (DW12); every other one fits its content.
        style={{
          gridTemplateColumns: `minmax(${NAME_COL_MIN}px, max-content) repeat(${columns - 1}, auto)`,
        }}
      >
        {headers && w.signals.length > 0 && (
          // Heads of the cursor columns (cursors "Readout row"); the name cell holds the hint.
          <li className="legend-head">
            <span className="next-hint" title={headers.hint}>
              {headers.hint}
            </span>
            <CursorHead cell={headers.a} />
            {showB && <CursorHead cell={headers.b} />}
            {diff && <CursorHead cell={headers.d} />}
            <span />
            <span />
            <span />
            <span />
          </li>
        )}
        {w.signals.map((s) => {
          const meta = info(s.signalId);
          const state = loader.get(s.id);
          const sna = state?.result && formatSnaShare(snaShare(state.result));
          const parsed = parseSignalId(s.signalId);
          // Without metadata (a signal the shown data ref lacks has none) the bare name, as a
          // loaded row shows it, so the first step to a session with the signal moves no column.
          const name = meta ? shownName(meta) : (parsed?.name ?? s.signalId);
          // The shown data ref lacks the signal (DW13): a muted pill, "—" cells with the reason.
          const missing = isMissing(state);
          const missingSignal = parsed && {
            dataRef: parsed.dataRef,
            name: meta ? shownName(meta) : parsed.name,
          };
          const missingTitle = missingSignal
            ? HINTS.missing(missingSignal.dataRef, missingSignal.name)
            : undefined;
          const gaps = gapsOf(s.signalId);
          const sourceOf = (name: CursorName) => {
            const t = cursors[name];
            const key = `${s.id}|${name}`;
            const exact = cellState(values.get(key), exactOf.get(key));
            const drawn =
              t === undefined
                ? undefined
                : chartValueAt(state?.result, t, w.display.mode, meta, gaps);
            // A dragged line or a click waiting for its double-click: the drawn curve, live.
            const previewing = t !== undefined && String(t) !== committed[name];
            return readoutSource(exact, drawn, previewing);
          };
          const sourceA = sourceOf("a");
          const sourceB = sourceOf("b");
          const cellAt = (name: CursorName, source: ReadoutSource) =>
            cursors[name] === undefined
              ? { text: NO_VALUE, title: "cursor off" }
              : sourceCell(source, meta?.unit, digits, meta, missingSignal);
          return (
            <li
              key={s.id}
              title={meta?.description}
              className={liveNear === s.id ? "live-near" : undefined}
            >
              <span
                className="grip"
                title={HINTS.legendDrag}
                onPointerDown={(e) =>
                  onDragStart({ windowId: w.id, assignmentId: s.id, signalId: s.signalId }, e)
                }
              >
                <span className="swatch" style={{ background: colorOf(s.signalId) }} />
                {/* Cut in a narrow window: the full name, or the source name, as tooltip. */}
                <span
                  className="sig"
                  title={meta ? (meta.displayName !== undefined ? meta.name : name) : s.signalId}
                >
                  {name}
                </span>
              </span>
              <span
                className="unit"
                title={HINTS.legendUnit(meta?.unit, model.layout.sideOf.get(s.id) ?? "–")}
              >
                {meta?.unit && `[${meta.unit}]`}
              </span>
              {readout && <ReadoutCell cell={cellAt("a", sourceA)} className="cursor-col" />}
              {readout && showB && (
                <ReadoutCell cell={cellAt("b", sourceB)} className="cursor-col" />
              )}
              {readout && diff && (
                <ReadoutCell
                  className="cursor-col"
                  cell={
                    a === undefined || b === undefined
                      ? { text: NO_VALUE, title: "cursor off" }
                      : sourceDelta(sourceA, sourceB, meta?.unit, digits, meta)
                  }
                />
              )}
              <LiveCell
                result={state?.result}
                mode={w.display.mode}
                unit={meta?.unit}
                digits={digits}
                info={meta}
                gaps={gaps}
              />
              {/* Only loading, missing or failed is news; complete shows nothing but keeps the column.
                  The column has one width (DW12), so a failure reads `failed`, its text as tooltip. */}
              <span
                className={`status ${missing ? "missing" : state?.error ? "error" : (state?.status ?? "loading")}`}
                title={
                  missing ? missingTitle : state?.error ? loadStatusText(state, inCase) : undefined
                }
              >
                {!missing && state?.error ? FAILED_PILL : loadStatusText(state, inCase)}
              </span>
              {/* Without a share an empty cell keeps the column; only a shown share is the share. */}
              {sna ? (
                <span className="sna sna-share" title={HINTS.sna(sna.replace(/^SNA /, ""))}>
                  {sna}
                </span>
              ) : (
                <span className="sna" />
              )}
              <button
                type="button"
                className="remove"
                title={HINTS.legendRemove}
                aria-label={`Remove ${name}`}
                onClick={() =>
                  onCommand({ type: "window.removeSignal", windowId: w.id, assignmentId: s.id })
                }
              >
                ×
              </button>
            </li>
          );
        })}
        {w.signals.length === 0 && <li className="empty">Drop a signal here</li>}
      </ul>
      {hint && (
        <div className="drop-hint">
          <span>{hint}</span>
        </div>
      )}
      {/* Corner grip (design G2): same drag as the strip; the press reaches no ancestor. */}
      {/* biome-ignore lint/a11y/useSemanticElements: a resize handle holding an SVG, not a rule */}
      <div
        className="corner-grip"
        role="separator"
        aria-orientation="horizontal"
        title={HINTS.grip}
        aria-label="Resize height"
        onPointerDown={(e) => {
          e.stopPropagation();
          startHeightDrag(e);
        }}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M 13 3 A 10 10 0 0 1 3 13"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
          />
        </svg>
      </div>
    </section>
  );
}
