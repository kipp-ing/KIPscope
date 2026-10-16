import type { DiagScaleRow, Display, SeriesResult, SignalInfo, Timestamp } from "@kipscope/shared";
import { decodeTimes } from "@kipscope/shared";
import { type AxisLayout, layoutAxes } from "./axes.ts";

/** x/y arrays of one signal; x is the ns offset from the window origin. */
export interface SignalPoints {
  xs: number[];
  /** null: SNA point or all-SNA bucket, edge neighbors included. */
  ys: (number | null)[];
  /** Envelope edges, aggregated data only. */
  min?: (number | null)[];
  max?: (number | null)[];
}

const offset = (t: Timestamp, origin: Timestamp) => Number(t - origin);

/** The states a text signal is drawn by: a diag enum's rows (D-061); undefined for other signals. */
export function stateLevels(info: SignalInfo | undefined): readonly DiagScaleRow[] | undefined {
  return info?.states === "text" ? info.diag?.states : undefined;
}

/**
 * Drawn y of a text signal's point: the decoder stores 0 for every diag enum state, so a state is
 * drawn at its code (`low` of the row whose text is the row text); else at its stored value.
 */
export function stateLevel(
  states: readonly DiagScaleRow[] | undefined,
  v: number,
  text: string | undefined,
): number {
  const row = text === undefined ? undefined : states?.find((s) => s.text === text);
  return row ? row.low : v;
}

/**
 * Span of a code-valued state signal's states (D-059, N3): a diag enum's or text state's codes;
 * undefined for other signals. A numeric signal with VAL_ labels keeps its normal axis.
 */
export function stateDomain(info: SignalInfo | undefined): [number, number] | undefined {
  if (info?.states !== "text") return undefined;
  const levels = (info.diag?.states ?? []).map((s) => s.low);
  return levels.length > 0 ? [Math.min(...levels), Math.max(...levels)] : undefined;
}

/**
 * Draws a state signal as steps (N3): each valid point's level holds until 1 ns before the next
 * point, envelope edges likewise, so no segment slopes through intermediate states. A range
 * without points thus holds the edge point's level across the view.
 */
function holdStates(points: SignalPoints): SignalPoints {
  // Source indices of the drawn points: each point, plus a hold point before the next one.
  const at: number[] = [];
  const xs: number[] = [];
  points.xs.forEach((x, i) => {
    at.push(i);
    xs.push(x);
    const next = points.xs[i + 1];
    if (next === undefined || next <= x + 1 || points.ys[i] === null) return;
    at.push(i);
    xs.push(next - 1);
  });
  const pick = (column: (number | null)[]) => at.map((i) => column[i] ?? null);
  const { min, max } = points;
  return { xs, ys: pick(points.ys), ...(min && max ? { min: pick(min), max: pick(max) } : {}) };
}

const levelOf = (
  states: readonly DiagScaleRow[] | undefined,
  v: number | null,
  text: string | undefined,
) => (v === null ? null : stateLevel(states, v, text));

/**
 * Turns a query result into drawable points. Raw: the edge neighbors outside the range are
 * included so lines and steps cross the window edges, but nothing is drawn beyond the first or
 * last measured point; a text signal's points at their state level (`states`, stateLevel).
 * Buckets: one point at each bucket's center. SNA stays null.
 */
export function toPoints(
  result: SeriesResult,
  origin: Timestamp,
  states?: readonly DiagScaleRow[],
): SignalPoints {
  const times = decodeTimes(result.t);
  if (result.kind === "raw") {
    const xs = times.map((t) => offset(t, origin));
    const text = states && result.text;
    const ys = text ? result.v.map((v, i) => levelOf(states, v, text[i])) : [...result.v];
    if (result.before) {
      xs.unshift(offset(BigInt(result.before.t), origin));
      ys.unshift(levelOf(states, result.before.v, result.before.label));
    }
    if (result.after) {
      xs.push(offset(BigInt(result.after.t), origin));
      ys.push(levelOf(states, result.after.v, result.after.label));
    }
    return { xs, ys };
  }
  const half = BigInt(result.width) / 2n;
  return {
    xs: times.map((t) => offset(t + half, origin)),
    ys: [...result.mean],
    min: [...result.min],
    max: [...result.max],
  };
}

/** Merges sorted periods that touch or overlap. */
function mergePeriods(periods: [number, number][]): [number, number][] {
  const merged: [number, number][] = [];
  for (const [start, end] of periods) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * SNA periods as [start, end] x offsets, sorted and merged; end may equal start. Raw: from each
 * SNA point (edge neighbors included) to the next point. Buckets: every bucket with SNA points.
 */
export function snaPeriods(result: SeriesResult, origin: Timestamp): [number, number][] {
  const periods: [number, number][] = [];
  if (result.kind === "raw") {
    const { xs, ys } = toPoints(result, origin);
    ys.forEach((y, i) => {
      const x = xs[i] as number;
      if (y === null) periods.push([x, xs[i + 1] ?? x]);
    });
  } else {
    const width = BigInt(result.width);
    decodeTimes(result.t).forEach((t, i) => {
      if ((result.sna[i] ?? 0) > 0) periods.push([offset(t, origin), offset(t + width, origin)]);
    });
  }
  return mergePeriods(periods);
}

/** SNA points / all points inside [from, to) (edge neighbors excluded); undefined if no points. */
export function snaShare(result: SeriesResult): number | undefined {
  let sna = 0;
  let total = 0;
  if (result.kind === "raw") {
    for (const v of result.v) if (v === null) sna++;
    total = result.v.length;
  } else {
    result.sna.forEach((n, i) => {
      sna += n;
      total += n + (result.count[i] ?? 0);
    });
  }
  return total === 0 ? undefined : sna / total;
}

/** SNA share for display; a non-zero share never reads 0 %, a partial one never 100 %. */
export function formatSnaShare(share: number | undefined): string | undefined {
  if (share === undefined || share === 0) return undefined;
  if (share < 0.001) return "SNA < 0.1 %";
  if (share === 1) return "SNA 100 %";
  if (share > 0.999) return "SNA > 99.9 %";
  return `SNA ${(share * 100).toFixed(1)} %`;
}

/**
 * Indices in a joined column whose value is a number while the nearest non-undefined entry on
 * each side is null or missing, at least one of them null: points a broken line would hide.
 */
export function isolatedPoints(ys: readonly (number | null | undefined)[]): number[] {
  const isolated: number[] = [];
  // Nearest non-undefined entry before the current index; undefined means none.
  let prev: number | null | undefined;
  for (let i = 0; i < ys.length; i++) {
    const y = ys[i];
    if (y === undefined) continue;
    if (y !== null && typeof prev !== "number") {
      let next: number | null | undefined;
      for (let j = i + 1; j < ys.length && next === undefined; j++) next = ys[j];
      if (typeof next !== "number" && (prev === null || next === null)) isolated.push(i);
    }
    prev = y;
  }
  return isolated;
}

/**
 * Step mode: holds each valid value up to the timestamp of a following SNA point by inserting a
 * hold point there and moving the SNA null 1 ns later (skipped when that time is taken).
 */
function holdBeforeSna(pts: SignalPoints): SignalPoints {
  const xs: number[] = [];
  const ys: (number | null)[] = [];
  pts.ys.forEach((y, i) => {
    const x = pts.xs[i] as number;
    const prev = ys.at(-1);
    const next = pts.xs[i + 1];
    if (y === null && typeof prev === "number" && next !== x + 1) {
      xs.push(x, x + 1);
      ys.push(prev, null);
    } else {
      xs.push(x);
      ys.push(y);
    }
  });
  return { xs, ys };
}

export type PathKind = "line" | "step" | "markers";

export interface SignalInput {
  key: string;
  label: string;
  unit?: string;
  color: string;
  result?: SeriesResult;
  /** A text signal's diag states (stateLevels): its points are drawn at their state level. */
  states?: readonly DiagScaleRow[];
  /** A state signal's catalog entry (`states` set): its line is drawn as steps (holdStates);
      a code-valued one spans its flat axis over its states (stateDomain). */
  info?: SignalInfo;
}

/** One uPlot series, without uPlot runtime objects (paths are resolved by the component). */
export interface SeriesSpec {
  /** Assignment id of the signal; its line and envelope edges share it. */
  key: string;
  label: string;
  scale: string;
  color: string;
  path: PathKind;
  /** Envelope edge: thin translucent line bounding the min/max band. */
  envelopeEdge?: boolean;
}

/** Fill opacity of SNA lanes; the explorer's SNA dot uses it too (improve-signal-explorer E5). */
export const SNA_ALPHA = 0.6;

/** SNA periods of one signal, drawn as a strip in its color. */
export interface SnaLane {
  color: string;
  periods: [number, number][];
}

export interface ChartModel {
  /** Columns before joining: one table [xs, ...ys] per signal; null is SNA. */
  tables: (number | null)[][][];
  /** y scale of each table. */
  tableScales: string[];
  /** State level span of each table's signal (stateDomain), undefined for other signals. */
  tableDomains: ([number, number] | undefined)[];
  series: SeriesSpec[];
  /** Band bounds as uPlot series indices (1-based; 0 is x). */
  bands: [number, number][];
  /** Scale key → axis title (unit or signal name), for every loaded signal's scale. */
  scales: Map<string, string>;
  /** One lane per loaded signal, in input order. */
  sna: SnaLane[];
  /** Scales, drawn axes and sides of all signals, loaded or not. */
  layout: AxisLayout;
}

/**
 * Assembles series, tables and envelope bands for all loaded signals of a window. The y scale
 * per unit comes from the axis layout of all signals, so signals with different units don't
 * squash each other and sides don't jump when data arrives.
 */
export function buildModel(inputs: SignalInput[], origin: Timestamp, display: Display): ChartModel {
  const layout = layoutAxes(inputs);
  const titles = new Map(layout.axes.map((a) => [a.scale, a.title]));
  const model: ChartModel = {
    tables: [],
    tableScales: [],
    tableDomains: [],
    series: [],
    bands: [],
    scales: new Map(),
    sna: [],
    layout,
  };
  for (const input of inputs) {
    if (!input.result) continue;
    const raw = input.result.kind === "raw";
    const path: PathKind = raw ? display.mode : "line";
    const points = toPoints(input.result, origin, input.states);
    const pts =
      path === "step"
        ? holdBeforeSna(points)
        : path === "line" && input.info?.states
          ? holdStates(points)
          : points;
    const scale = layout.scaleOf.get(input.key) as string;
    if (!model.scales.has(scale)) {
      model.scales.set(scale, titles.get(scale) ?? (input.unit?.trim() || input.label));
    }
    const key = input.key;
    model.series.push({ key, label: input.label, scale, color: input.color, path });
    model.sna.push({ color: input.color, periods: snaPeriods(input.result, origin) });
    const table: (number | null)[][] = [pts.xs, pts.ys];
    if (!raw && display.envelope && pts.min && pts.max) {
      const maxIndex = model.series.length + 1;
      model.series.push(
        {
          key,
          label: `${input.label} max`,
          scale,
          color: input.color,
          path: "line",
          envelopeEdge: true,
        },
        {
          key,
          label: `${input.label} min`,
          scale,
          color: input.color,
          path: "line",
          envelopeEdge: true,
        },
      );
      model.bands.push([maxIndex, maxIndex + 1]);
      table.push(pts.max, pts.min);
    }
    model.tables.push(table);
    model.tableScales.push(scale);
    model.tableDomains.push(stateDomain(input.info));
  }
  return model;
}

/** Index of the first x >= value in ascending xs. */
function lowerBound(xs: number[], value: number): number {
  let lo = 0;
  let hi = xs.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((xs[mid] as number) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * y range of a scale for the visible x range: all points inside plus the nearest point outside
 * each edge, i.e. exactly the points that define the drawn segments. SNA (null) never counts.
 * A flat range of a code-valued state signal spans its states (stateDomain), so its line sits
 * at its level.
 * Undefined if none.
 */
export function yRange(
  model: ChartModel,
  scale: string,
  xMin: number,
  xMax: number,
): [number, number] | undefined {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const domains: [number, number][] = [];
  model.tables.forEach((table, i) => {
    if (model.tableScales[i] !== scale) return;
    let seen = false;
    const xs = table[0] as number[];
    const start = Math.max(0, lowerBound(xs, xMin) - 1);
    const end = Math.min(xs.length, lowerBound(xs, xMax) + 1);
    for (const column of table.slice(1)) {
      for (let j = start; j < end; j++) {
        const v = column[j];
        if (v === null || v === undefined) continue;
        if (v < min) min = v;
        if (v > max) max = v;
        seen = true;
      }
    }
    const domain = model.tableDomains[i];
    if (seen && domain) domains.push(domain);
  });
  if (min > max) return undefined;
  if (min === max) {
    for (const [low, high] of domains) {
      min = Math.min(min, low);
      max = Math.max(max, high);
    }
  }
  const pad = min === max ? Math.max(Math.abs(min) * 0.1, 1) : (max - min) * 0.05;
  return [min - pad, max + pad];
}

/** Aggregation summary: short badge text for the window header and the full text as tooltip;
    undefined while nothing is loaded. */
export function resolutionBadge(
  results: (SeriesResult | undefined)[],
): { short: string; full: string } | undefined {
  const loaded = results.filter((r): r is SeriesResult => r !== undefined);
  if (loaded.length === 0) return undefined;
  const widths = loaded.flatMap((r) => (r.kind === "buckets" ? [BigInt(r.width)] : []));
  if (widths.length === 0) return { short: "raw", full: "raw" };
  const widest = formatDuration(widths.reduce((a, b) => (a > b ? a : b)));
  return widths.length === loaded.length
    ? { short: `agg · ${widest}`, full: `aggregated · ${widest} per point` }
    : { short: `part · ${widest}`, full: `partly aggregated · ${widest} per point` };
}

export function formatDuration(ns: bigint): string {
  const units: [bigint, string][] = [
    [3_600_000_000_000n, "h"],
    [60_000_000_000n, "min"],
    [1_000_000_000n, "s"],
    [1_000_000n, "ms"],
    [1_000n, "µs"],
  ];
  for (const [size, name] of units) {
    if (ns >= size) {
      const value = Number((ns * 10n) / size) / 10;
      return `${value} ${name}`;
    }
  }
  return `${ns} ns`;
}
