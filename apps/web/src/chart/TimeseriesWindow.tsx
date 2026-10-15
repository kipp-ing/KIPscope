import {
  type CommandInput,
  type CommandResult,
  type CursorName,
  DEFAULT_PLOT_HEIGHT,
  type DisplayMode,
  MAX_PLOT_HEIGHT,
  MAX_UNITS,
  MIN_PLOT_HEIGHT,
  type RenderError,
  type SignalInfo,
  type TimeseriesWindow as WindowState,
  windowTitle,
} from "@letsview/shared";
import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import "./window.css";
import { fetchSeries } from "../api.ts";
import { calendarTicks, formatRange, tickLabels, tickStepForWidth, ticks } from "../time/axis.ts";
import type { AxisSpec } from "./axes.ts";
import {
  buildModel,
  type ChartModel,
  formatSnaShare,
  isolatedPoints,
  resolutionLabel,
  type SeriesSpec,
  type SignalInput,
  SNA_ALPHA,
  snaShare,
  yRange,
} from "./build.ts";
import { ClickGate, DOUBLE_CLICK_MS, hitCursor, snapCursorTime, stackFlags } from "./cursors.ts";
import { DRAG_THRESHOLD_PX, type DragSource, type DropState } from "./drag.ts";
import type { Insets } from "./insets.ts";
import { type LoadRequest, SeriesLoader } from "./loader.ts";
import { clampRange, type Range, RangePreview, wheelZoomFactor } from "./zoom.ts";

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
  /** Called once per committed zoom/pan/zoom-out gesture with the range shown before it. */
  onZoomed: (windowId: string, previous: Range) => void;
  canGoBack: boolean;
  onBack: (windowId: string) => void;
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
  /** Local position while placing or dragging; t undefined ends the preview without a command. */
  onCursorPreview: (cursor: CursorName, t: bigint | undefined) => void;
  /** Gesture finished: App sends one cursor.set. */
  onCursorCommit: (cursor: CursorName, t: bigint) => void;
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
 */
const hideCursor = (u: uPlot) => u.root.classList.add("cursor-hidden");
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

type CursorLines = Record<CursorName, HTMLElement>;
/** Row height of a cursor flag (its line-height in window.css); a stacked B flag sits one row down. */
const CURSOR_FLAG_ROW_PX = 14;
type CursorX = { a?: number; b?: number };

/**
 * Cursor overlays inside u.over (design C3): a transparent hit strip with a 1 px line in its
 * centre and a flag at the top. B is appended after A, so it is drawn above.
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
  return { a: make("a"), b: make("b") };
}

/**
 * Puts each line at its time on the current x scale (the zoom preview included) and hides lines
 * outside the plot. Returns the shown lines' x in CSS px for the hit test.
 */
function placeCursorLines(
  u: uPlot,
  lines: CursorLines,
  cursors: { a?: bigint; b?: bigint },
  origin: bigint,
): CursorX {
  const shown: CursorX = {};
  const width = u.bbox.width / devicePixelRatio;
  for (const name of ["a", "b"] as const) {
    const strip = lines[name];
    const t = cursors[name];
    const x = t === undefined ? Number.NaN : u.valToPos(Number(t - origin), "x");
    // 1 px slack: a time snapped at the plot edge may lie up to half a pixel outside.
    if (!(x >= -1 && x <= width + 1)) {
      strip.style.display = "none";
      continue;
    }
    strip.style.display = "";
    strip.style.left = `${x}px`;
    shown[name] = x;
  }
  const flagB = lines.b.firstElementChild as HTMLElement | null;
  if (flagB) flagB.style.top = stackFlags(shown, width) ? `${CURSOR_FLAG_ROW_PX}px` : "";
  return shown;
}

/** Window title; a click turns it into a text field (Enter or blur saves, Esc cancels). */
function WindowTitle({
  window: w,
  onCommand,
}: {
  window: WindowState;
  onCommand: Props["onCommand"];
}) {
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const title = windowTitle(w);
  if (!editing) {
    return (
      <button
        type="button"
        className="window-title"
        title={title}
        onClick={() => {
          cancelled.current = false;
          setEditing(true);
        }}
      >
        {title}
      </button>
    );
  }
  const save = (value: string) => {
    setEditing(false);
    if (cancelled.current) return;
    const next = value.trim();
    if (next !== (w.title ?? "")) onCommand({ type: "window.rename", windowId: w.id, title: next });
  };
  return (
    <input
      className="window-title-input"
      // biome-ignore lint/a11y/noAutofocus: the field appears on an explicit click on the title
      autoFocus
      defaultValue={w.title ?? ""}
      placeholder={title}
      maxLength={200}
      aria-label="Window title"
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => save(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function TimeseriesWindow({
  window: w,
  revision,
  info,
  colorOf,
  onCommand,
  onReady,
  onZoomed,
  canGoBack,
  onBack,
  onReset,
  onDragStart,
  dropState,
  dropAction,
  insets,
  onInsets,
  cursors,
  onCursorPreview,
  onCursorCommit,
}: Props) {
  const plotRef = useRef<HTMLDivElement>(null);
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
  const onCursorPreviewRef = useRef(onCursorPreview);
  onCursorPreviewRef.current = onCursorPreview;
  const onCursorCommitRef = useRef(onCursorCommit);
  onCursorCommitRef.current = onCursorCommit;
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

  const inputs = w.signals.map((s) => {
    const meta = info(s.signalId);
    const input: SignalInput = {
      key: s.id,
      label: meta?.name ?? s.signalId,
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
    hideCursor(u);
    commit(r);
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
    // One grid is enough; more would draw unrelated lines over each other. It follows the first
    // axis with data, so no grid is drawn for a placeholder range.
    const gridAxis = drawnAxes.findIndex((a) => model.scales.has(a.scale));
    drawnAxes.forEach((axis, j) => {
      const loaded = model.scales.has(axis.scale);
      axes.push({
        scale: axis.scale,
        side: axis.side === "L" || axis.side === "L2" ? LEFT : RIGHT,
        font: AXIS_FONT,
        // An axis still loading keeps its place and title but shows no ticks or values.
        ticks: { show: loaded, size: AXIS_TICK },
        ...(loaded ? {} : { values: (_u: uPlot, splits: number[]) => splits.map(() => "") }),
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
          const title = Math.min(MAX_TITLE_WIDTH, textWidth(axis.title) + 4);
          sizes[j] = Math.ceil(Math.max(widest + AXIS_PAD, title));
          return sizes[j];
        },
      });
    });

    // Cursor overlays; created right after uPlot, read by the draw hook.
    let lines: CursorLines | undefined;
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
          null,
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
              hideCursor(self);
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
                cursorX.current = placeCursorLines(self, lines, cursorsRef.current, origin.current);
              }
              placeTitles(self, titleRow.current, drawnAxes, sizes);
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
    const strips = Object.values(lines);

    /** Time at x CSS px in the plot, snapped to the shown span (design C3). */
    const timeAt = (x: number) => {
      const min = u.scales.x?.min ?? 0;
      const max = u.scales.x?.max ?? 1;
      const t = origin.current + BigInt(Math.round(u.posToVal(x, "x")));
      return snapCursorTime(t, BigInt(Math.round(max - min)));
    };
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
      let t: bigint | undefined;
      const move = (ev: PointerEvent) => {
        t = timeAt(plotX(ev.clientX));
        onCursorPreviewRef.current(name, t);
      };
      const end = (commit: boolean) => {
        cancelLineDrag = undefined;
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
    };
    const onUp = (e: MouseEvent) => {
      const start = down;
      down = undefined;
      passThrough(false);
      if (!start || Math.hypot(e.clientX - start.x, e.clientY - start.y) >= DRAG_THRESHOLD_PX) {
        return;
      }
      placeClickRef.current(e.shiftKey ? "b" : "a", timeAt(plotX(e.clientX)));
    };
    u.over.addEventListener("mousedown", onDown);
    window.addEventListener("mouseup", onUp);

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const min = u.scales.x?.min ?? 0;
      const max = u.scales.x?.max ?? 1;
      const span = max - min;
      const horizontal = e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (horizontal) {
        const delta = ((e.shiftKey ? e.deltaY : e.deltaX) / u.over.clientWidth) * span;
        applyRangeRef.current(u, min + delta, max + delta);
      } else {
        // Not offsetX: over a cursor line the event's target is the line's hit strip.
        const at = u.posToVal(e.clientX - u.over.getBoundingClientRect().left, "x");
        const factor = wheelZoomFactor(e.deltaY, e.deltaMode);
        applyRangeRef.current(u, at - (at - min) * factor, at + (max - at) * factor);
      }
    };
    // Leaving the plot hides the crosshair through uPlot's own mouseleave handler.
    const onMove = () => showCursor(u);
    u.over.addEventListener("wheel", onWheel, { passive: false });
    u.over.addEventListener("mousemove", onMove);
    return () => {
      u.over.removeEventListener("wheel", onWheel);
      u.over.removeEventListener("mousemove", onMove);
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

  if (!preview.inFlight && !commitTimer.current && preview.range) {
    // A different range arrived from the server (e.g. another client); it wins.
    preview.range = undefined;
  }
  const view = viewRange();

  // Data and view: only when the model, the shown range (or a dropped preview) or the uPlot
  // instance changed, so a cursor preview (which rerenders every window per move) costs no join,
  // setData or redraw.
  // biome-ignore lint/correctness/useExhaustiveDependencies: view is tracked via its bounds, a dropped preview via viewEpoch; structure and width === 0 mark a new uPlot instance
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
  }, [model, view.from, view.to, viewEpoch, structure, width === 0]);

  // Cursor lines only: moving a line needs no redraw (the draw hook places them after a redraw).
  // biome-ignore lint/correctness/useExhaustiveDependencies: cursors are read via cursorsRef
  useLayoutEffect(() => {
    const u = uplot.current;
    const lines = cursorLines.current;
    if (u && lines)
      cursorX.current = placeCursorLines(u, lines, cursorsRef.current, origin.current);
  }, [cursors.a, cursors.b]);

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

  const settled = loader.settled(requests) && width > 0;
  const errors: RenderError[] = w.signals.flatMap((s) => {
    const state = loader.get(s.id);
    return state?.status === "error"
      ? [{ windowId: w.id, signalId: s.signalId, message: state.error ?? "error" }]
      : [];
  });
  const errorKey = JSON.stringify(errors);
  // biome-ignore lint/correctness/useExhaustiveDependencies: errors are tracked via errorKey
  useEffect(() => {
    if (settled) onReady(w.id, revision, errors);
  }, [settled, revision, errorKey, w.id, onReady]);

  // --- view -----------------------------------------------------------------------------------

  const zoomOut = () => {
    const u = uplot.current;
    if (!u) return;
    const min = u.scales.x?.min ?? 0;
    const max = u.scales.x?.max ?? 1;
    const half = max - min;
    applyRange(u, min - half / 2, max + half / 2);
  };

  /** Height handle: resizes locally while dragged, sends window.setHeight on release. */
  const startHeightDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startHeight = plotHeight;
    const base = w.height;
    let height = startHeight;
    const move = (ev: PointerEvent) => {
      height = clampHeight(startHeight + ev.clientY - startY);
      setHeightDrag({ ...(base !== undefined ? { base } : {}), height });
    };
    const end = async () => {
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
  const resolution = resolutionLabel(w.signals.map((s) => loader.get(s.id)?.result));
  const hint =
    dropState === "target"
      ? dropAction === "add"
        ? HINT_ADD
        : HINT_TARGET
      : dropState === "refused"
        ? HINT_REFUSED
        : undefined;

  return (
    <section className={`window${dropState ? ` drop-${dropState}` : ""}`} data-window-id={w.id}>
      <header className="window-header">
        <WindowTitle key={w.title ?? ""} window={w} onCommand={onCommand} />
        {resolution && (
          <span className={`badge ${resolution === "raw" ? "raw" : "agg"}`}>{resolution}</span>
        )}
        <span className="range" title={range}>
          {range}
        </span>
        <span className="spacer" />
        <label>
          Mode{" "}
          <select
            value={w.display.mode}
            onChange={(e) =>
              onCommand({
                type: "window.setDisplay",
                windowId: w.id,
                mode: e.target.value as DisplayMode,
              })
            }
          >
            <option value="line">Line</option>
            <option value="step">Step</option>
            <option value="markers">Markers</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={w.display.envelope}
            onChange={(e) =>
              onCommand({ type: "window.setDisplay", windowId: w.id, envelope: e.target.checked })
            }
          />{" "}
          Min/max
        </label>
        <button
          type="button"
          disabled={!canGoBack}
          title="Previous range (Backspace)"
          onClick={() => onBack(w.id)}
        >
          Back
        </button>
        <button type="button" onClick={zoomOut}>
          Zoom out
        </button>
        <button type="button" onClick={() => onCommand({ type: "window.remove", windowId: w.id })}>
          Remove
        </button>
      </header>
      <div className="axis-titles" ref={titleRow}>
        {drawnAxes.map((a) => (
          <span
            key={a.scale}
            data-side={a.side}
            title={a.title}
            style={a.color ? { color: a.color } : undefined}
          >
            {a.title}
          </span>
        ))}
      </div>
      <div className="plot" ref={plotRef} style={{ height: plotHeight }} />
      <div className="height-handle" title="Drag to resize" onPointerDown={startHeightDrag} />
      <ul className="signals">
        {w.signals.map((s) => {
          const meta = info(s.signalId);
          const state = loader.get(s.id);
          const sna = state?.result && formatSnaShare(snaShare(state.result));
          const name = meta?.name ?? s.signalId;
          return (
            <li key={s.id} title={meta?.description}>
              <span
                className="grip"
                title="Drag onto another window"
                onPointerDown={(e) =>
                  onDragStart({ windowId: w.id, assignmentId: s.id, signalId: s.signalId }, e)
                }
              >
                <span className="swatch" style={{ background: colorOf(s.signalId) }} />
                <span className="sig">{name}</span>
              </span>
              {meta?.unit && <span className="unit">[{meta.unit}]</span>}
              <span className="side" title="y axis">
                {model.layout.sideOf.get(s.id) ?? "–"}
              </span>
              <span className={`status ${state?.status ?? "loading"}`}>
                {state?.status === "error"
                  ? `failed: ${state.error}`
                  : (state?.status ?? "loading")}
              </span>
              {sna && <span className="sna">{sna}</span>}
              <button
                type="button"
                className="link"
                onClick={() =>
                  onCommand({ type: "window.removeSignal", windowId: w.id, assignmentId: s.id })
                }
              >
                remove
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
