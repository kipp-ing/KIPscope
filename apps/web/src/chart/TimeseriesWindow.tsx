import {
  type CommandInput,
  type CommandResult,
  type CursorName,
  DEFAULT_PLOT_HEIGHT,
  type Digits,
  type DisplayMode,
  formatAxisTicks,
  MAX_PLOT_HEIGHT,
  MAX_UNITS,
  MIN_PLOT_HEIGHT,
  type RenderError,
  type SeriesResult,
  type SignalInfo,
  shownName,
  type ValuesMode,
  type TimeseriesWindow as WindowState,
} from "@letsview/shared";
import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import "./window.css";
import { fetchCursorValue, fetchSeries } from "../api.ts";
import { holdNoSelect } from "../noselect.ts";
import { calendarTicks, formatRange, tickLabels, tickStepForWidth, ticks } from "../time/axis.ts";
import {
  type Cell,
  formatClock,
  formatCursorTime,
  formatDeltaT,
  NO_VALUE,
} from "../values/format.ts";
import {
  cellState,
  type FetchValue,
  ValueLoader,
  valueErrors,
  valueRequests,
} from "../values/loader.ts";
import { WindowMenu } from "../window/WindowMenu.tsx";
import { MARKED_HINT, markFromHeader, WindowTitle } from "../window/WindowTitle.tsx";
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
  yRange,
} from "./build.ts";
import {
  ClickGate,
  CURSOR_FLAG_PX,
  DOUBLE_CLICK_MS,
  deltaLabelX,
  hitCursor,
  stackFlags,
} from "./cursors.ts";
import { DRAG_THRESHOLD_PX, type DragSource, type DropState } from "./drag.ts";
import type { Insets } from "./insets.ts";
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
import { type LoadRequest, SeriesLoader } from "./loader.ts";
import {
  chartValueAt,
  type ReadoutSource,
  readoutSource,
  sourceCell,
  sourceDelta,
} from "./readout.ts";
import { clampRange, type Range, RangePreview, WheelFrame, wheelAction } from "./zoom.ts";

const COMMIT_DELAY_MS = 300;
const MIN_SPAN_NS = 100n;
/** Re-anchor the origin before offsets lose float precision (2^53 ns ≈ 104 days). */
const MAX_ORIGIN_DISTANCE = 2n ** 50n;

/** Axis tick font; measured to size each y axis to its widest tick label. */
const AXIS_FONT = '12px system-ui, -apple-system, "Segoe UI", sans-serif';
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
/** Inset of a side without y axis (uPlot's own default), room for the edge x tick label. */
const NO_AXIS_INSET = 25;
/** Room above the plot area for half of the top y tick label (uPlot's default is 16; design L4). */
const PLOT_HEADROOM = 6;
const HINT_TARGET = "Drop to move · Alt/Ctrl+drop to copy";
const HINT_ADD = "Drop to add";
const HINT_REFUSED = `At most ${MAX_UNITS} units per window`;

interface Props {
  window: WindowState;
  revision: number;
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
}

const isLeft = (side: AxisSpec["side"]) => side === "L" || side === "L2";

/** Total y axis width per side; a side without axis counts as NO_AXIS_INSET. */
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
    natural: { left: left || NO_AXIS_INSET, right: right || NO_AXIS_INSET },
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

const clampHeight = (h: number) =>
  Math.min(MAX_PLOT_HEIGHT, Math.max(MIN_PLOT_HEIGHT, Math.round(h)));

const sameRange = (a: Range, b: Range) => a.from === b.from && a.to === b.to;

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
      x.result === y.result
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

/** One readout value in a legend row: number with unit, tag, SNA style, reason as tooltip. */
function ReadoutCell({ cell, className }: { cell: Cell; className?: string }) {
  return (
    <span
      className={`value${className ? ` ${className}` : ""}${cell.sna ? " sna-value" : ""}${cell.loading ? " loading" : ""}`}
      title={cell.title}
    >
      {cell.text}
      {cell.tag && <span className="tag">{cell.tag}</span>}
    </span>
  );
}

/**
 * The L cell of one legend row (design L4): the drawn value at L in this window. Only these cells
 * re-render per published frame.
 */
function LiveCell({
  result,
  mode,
  unit,
  digits,
}: {
  result: SeriesResult | undefined;
  mode: DisplayMode;
  unit: string | undefined;
  digits: Digits;
}) {
  const live = useLiveCursor();
  const v = live && chartValueAt(result, live.t, mode);
  return <ReadoutCell cell={liveCell(v, live !== undefined, unit, digits)} className="live" />;
}

export function TimeseriesWindow({
  window: w,
  revision,
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
}: Props) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const titleRow = useRef<HTMLDivElement>(null);
  const uplot = useRef<uPlot | undefined>(undefined);
  const [width, setWidth] = useState(0);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const loader = useMemo(() => new SeriesLoader(fetchSeries, rerender), []);
  useEffect(() => () => loader.dispose(), [loader]);

  // Height being dragged; shown until the window's stored height changes from `base`.
  const [heightDrag, setHeightDrag] = useState<{ base?: number; height: number } | undefined>();
  // The stored height changed (our setHeight arrived, or another client's): the drag is over.
  if (heightDrag && heightDrag.base !== w.height) setHeightDrag(undefined);
  const storedHeight = w.height ?? DEFAULT_PLOT_HEIGHT;
  const plotHeight = heightDrag && heightDrag.base === w.height ? heightDrag.height : storedHeight;

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

  const target = Math.min(4000, Math.max(100, Math.round(width)));
  const requests: LoadRequest[] = useMemo(
    () =>
      width === 0
        ? []
        : w.signals.map((s) => ({
            key: s.id,
            signalId: s.signalId,
            from: w.range.from,
            to: w.range.to,
            target,
          })),
    [w.signals, w.range.from, w.range.to, target, width],
  );
  useEffect(() => loader.update(requests), [loader, requests]);

  // Readout values (D-031): the exact value at each committed cursor from the server, like the
  // values window, inside or outside the zoom (readoutSource). Markers evaluate as line.
  const values = useMemo(() => new ValueLoader(fetchValue, rerender), []);
  useEffect(() => () => values.dispose(), [values]);
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
    const result = loader.get(s.id)?.result;
    if (meta?.unit) input.unit = meta.unit;
    if (result) input.result = result;
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

  const viewRange = () => preview.view(serverRange);
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
    // The header shows the preview at once.
    rerender();
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
          yRange(modelRef.current, key, xView.current[0], xView.current[1]) ?? [
            dataMin ?? 0,
            dataMax ?? 1,
          ],
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
        // An axis still loading keeps its place and title but shows no ticks or values.
        ticks: { show: loaded, size: AXIS_TICK },
        values: loaded ? tickValues : (_u: uPlot, splits: number[]) => splits.map(() => ""),
        ...(axis.color ? { stroke: axis.color } : {}),
        grid: { show: j === gridAxis },
        size: (_u, values, _i, cycle) => {
          const last = sizes[j];
          if (cycle > 1 && last !== undefined) return last;
          // A loading axis has no values yet; reserve typical tick width so the plot does not
          // shift sideways when the data arrives.
          const widest = loaded
            ? Math.max(0, ...(values ?? []).map(textWidth))
            : textWidth(LOADING_TICK_TEXT);
          // Wide enough for the title too, so a unit like "rpm/10ms" is not cut.
          const title = Math.min(MAX_TITLE_WIDTH, textWidth(titles[j] ?? axis.title) + 4);
          sizes[j] = Math.ceil(Math.max(widest + AXIS_PAD, title));
          return sizes[j];
        },
      });
    });

    // Cursor overlays; created right after uPlot, read by the draw hook.
    let lines: CursorLines | undefined;
    // Places the L line and label (design L3, L6); set right after uPlot, called by the draw hook.
    let placeLive: (() => void) | undefined;
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
          draw: [
            (self) => {
              drawSnaLanes(self, modelRef.current.sna);
              drawNarrowSignals(self, modelRef.current);
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
        value: chartValueAt(loader.get(s.id)?.result, t, modeRef.current),
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
      const v = chartValueAt(loader.get(assignment.id)?.result, current.t, modeRef.current);
      // The near signal's curve point, by the same rule that made it a candidate (design L5).
      const [point] = liveCandidates(
        [{ key: assignment.id, scale: scaleOf.get(assignment.id), value: v }],
        toY,
        u.over.clientHeight,
      );
      const unit = infoRef.current(assignment.signalId)?.unit;
      const text = liveLabelText(v, unit, digitsRef.current);
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

  // Drops an accepted preview once its server range arrived, or another client's range wins.
  preview.settle(serverRange, commitTimer.current !== undefined);
  // The header shows this range too, so it always matches the plot.
  const view = viewRange();

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
  const shownRange = useRef(view);
  // biome-ignore lint/correctness/useExhaustiveDependencies: view is tracked via its bounds
  useLayoutEffect(() => {
    const u = uplot.current;
    const changed = !sameRange(shownRange.current, view);
    shownRange.current = view;
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

  const settled = loader.settled(requests) && values.settled(exactRequests) && width > 0;
  const errors: RenderError[] = [
    ...w.signals.flatMap((s) => {
      const state = loader.get(s.id);
      return state?.status === "error"
        ? [{ windowId: w.id, signalId: s.signalId, message: state.error ?? "error" }]
        : [];
    }),
    ...valueErrors(w.id, exactRequests, values),
  ];
  const errorKey = JSON.stringify(errors);
  // biome-ignore lint/correctness/useExhaustiveDependencies: errors are tracked via errorKey
  useEffect(() => {
    if (settled) onReady(w.id, revision, errors);
  }, [settled, revision, errorKey, w.id, onReady]);

  // --- view -----------------------------------------------------------------------------------

  /** Height handle: resizes locally while dragged, sends window.setHeight on release. */
  const startHeightDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const releaseSelect = holdNoSelect();
    const releaseLive = liveCursor.suspend();
    const startY = e.clientY;
    const startHeight = plotHeight;
    const base = w.height;
    let height = startHeight;
    const move = (ev: PointerEvent) => {
      height = clampHeight(startHeight + ev.clientY - startY);
      setHeightDrag({ ...(base !== undefined ? { base } : {}), height });
    };
    const end = async () => {
      releaseSelect();
      releaseLive();
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      if (height === storedHeight) {
        setHeightDrag(undefined);
        return;
      }
      const result = await onCommand({ type: "window.setHeight", windowId: w.id, height });
      if (!result.ok) setHeightDrag(undefined);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  };

  const shown = view;
  const range = formatRange(shown.from, shown.to);
  // Readout (design N3, N4): value columns while a cursor is on, from the drawn data.
  const { a, b } = cursors;
  const readout = a !== undefined || b !== undefined;
  // B's column while B is on; Diff adds Δ and Δt (D-031).
  const showB = b !== undefined || diff;
  // The legend is always a grid (D-033): name, unit, A | B | Δ while a cursor is on, then L
  // (D-032, always, so filling and emptying it moves nothing), status, SNA share, remove.
  const columns = 6 + (readout ? 1 + (showB ? 1 : 0) + (diff ? 1 : 0) : 0);
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
      className={`window${marked ? " marked" : ""}${dropState ? ` drop-${dropState}` : ""}`}
      data-window-id={w.id}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the keyboard path to mark is the explorer's "Add to" select (L5) */}
      <header
        className="window-header"
        title={marked ? MARKED_HINT : undefined}
        onClick={(e) => markFromHeader(e, w.id, onMark)}
      >
        <WindowTitle
          key={w.title ?? ""}
          window={w}
          editing={renaming}
          onEditing={setRenaming}
          onCommand={onCommand}
        />
        {badge && (
          <span className="badge" title={badge.full}>
            {badge.short}
          </span>
        )}
        <span className="range" title={range}>
          {range}
        </span>
        <div className="window-controls" title="">
          <select
            aria-label="Display mode"
            title="Display mode"
            value={w.display.mode}
            onChange={(e) => {
              onCommand({
                type: "window.setDisplay",
                windowId: w.id,
                mode: e.target.value as DisplayMode,
              });
              // A focused select swallows the navigation keys (keys.ts).
              e.currentTarget.blur();
            }}
          >
            <option value="line">Line</option>
            <option value="step">Step</option>
            <option value="markers">Markers</option>
          </select>
          <label>
            <input
              type="checkbox"
              checked={w.display.envelope}
              onChange={(e) =>
                onCommand({ type: "window.setDisplay", windowId: w.id, envelope: e.target.checked })
              }
            />
            Min/max
          </label>
          <WindowMenu
            onRename={() => setRenaming(true)}
            onRemove={() => onCommand({ type: "window.remove", windowId: w.id })}
          />
        </div>
      </header>
      <div className="axis-titles" ref={titleRow}>
        {drawnAxes.map((a, j) => (
          <span
            key={a.scale}
            data-side={a.side}
            title={axisTitle(j, a)}
            style={a.color ? { color: a.color } : undefined}
          >
            {axisTitle(j, a)}
          </span>
        ))}
      </div>
      <div className="plot" ref={plotRef} style={{ height: plotHeight }} />
      <div className="height-handle" title="Drag to resize" onPointerDown={startHeightDrag} />
      {readout && (
        <div className="readout-row">
          <span className="cursor-time" title={a === undefined ? undefined : formatCursorTime(a)}>
            {a === undefined ? "A off" : `A ${formatClock(a)}`}
          </span>
          {showB && (
            <span className="cursor-time" title={b === undefined ? undefined : formatCursorTime(b)}>
              {b === undefined ? "B off" : `B ${formatClock(b)}`}
            </span>
          )}
          {diff && a !== undefined && b !== undefined && (
            <span className="cursor-time">Δt {formatDeltaT(b - a)}</span>
          )}
        </div>
      )}
      <ul className="signals" style={{ gridTemplateColumns: `repeat(${columns}, auto)` }}>
        {w.signals.map((s) => {
          const meta = info(s.signalId);
          const state = loader.get(s.id);
          const sna = state?.result && formatSnaShare(snaShare(state.result));
          const name = meta ? shownName(meta) : s.signalId;
          const sourceOf = (name: CursorName) => {
            const t = cursors[name];
            const key = `${s.id}|${name}`;
            const exact = cellState(values.get(key), exactOf.get(key));
            const drawn =
              t === undefined ? undefined : chartValueAt(state?.result, t, w.display.mode);
            // A dragged line or a click waiting for its double-click: the drawn curve, live.
            const previewing = t !== undefined && String(t) !== committed[name];
            return readoutSource(exact, drawn, previewing);
          };
          const sourceA = sourceOf("a");
          const sourceB = sourceOf("b");
          const cellAt = (name: CursorName, source: ReadoutSource) =>
            cursors[name] === undefined
              ? { text: NO_VALUE, title: "cursor off" }
              : sourceCell(source, meta?.unit, digits);
          return (
            <li
              key={s.id}
              title={meta?.description}
              className={liveNear === s.id ? "live-near" : undefined}
            >
              <span
                className="grip"
                title="Drag onto another window"
                onPointerDown={(e) =>
                  onDragStart({ windowId: w.id, assignmentId: s.id, signalId: s.signalId }, e)
                }
              >
                <span className="swatch" style={{ background: colorOf(s.signalId) }} />
                <span
                  className="sig"
                  title={meta?.displayName !== undefined ? meta.name : undefined}
                >
                  {name}
                </span>
              </span>
              <span className="unit" title={`y axis ${model.layout.sideOf.get(s.id) ?? "–"}`}>
                {meta?.unit && `[${meta.unit}]`}
              </span>
              {readout && <ReadoutCell cell={cellAt("a", sourceA)} />}
              {readout && showB && <ReadoutCell cell={cellAt("b", sourceB)} />}
              {readout && diff && (
                <ReadoutCell
                  cell={
                    a === undefined || b === undefined
                      ? { text: NO_VALUE, title: "cursor off" }
                      : sourceDelta(sourceA, sourceB, meta?.unit, digits)
                  }
                />
              )}
              <LiveCell
                result={state?.result}
                mode={w.display.mode}
                unit={meta?.unit}
                digits={digits}
              />
              {/* Only loading or failed is news; complete shows nothing but keeps the column. */}
              <span className={`status ${state?.status ?? "loading"}`}>
                {state?.status === "error"
                  ? `failed: ${state.error}`
                  : state?.status === "complete"
                    ? ""
                    : "loading"}
              </span>
              <span className="sna">{sna}</span>
              <button
                type="button"
                className="remove"
                title="Remove from this window"
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
    </section>
  );
}
