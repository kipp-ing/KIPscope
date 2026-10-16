import {
  type CursorValue,
  type DiagScaleRow,
  type Digits,
  type DisplayMode,
  decodeTimes,
  type EdgePoint,
  evaluateAt,
  formatQuantityBare,
  loggerGapAt,
  NO_GAPS,
  parseTimestamp,
  type RawSeries,
  type SeriesResult,
  type SignalGaps,
  type SignalInfo,
  shortLabel,
  splitBuckets,
} from "@kipscope/shared";
import {
  type Cell,
  isNamed,
  labelTitle,
  loadingCell,
  NO_VALUE,
  type NumberValue,
  noValueCell,
  numberDelta,
  stateDelta,
  type ValueReason,
} from "../values/format.ts";
import type { ValueState } from "../values/loader.ts";
import { stateLevel, stateName } from "./build.ts";

/** A value of the chart readout: the values window's kinds plus a bucket mean (design N4). */
export type ReadoutValue =
  | CursorValue
  | { kind: "aggregated"; value: number; label?: string }
  | { kind: "none"; reason: ValueReason };

// Decoded once per loaded result: the readout runs per frame while a cursor line is dragged.
const decoded = new WeakMap<SeriesResult, bigint[]>();

function timesOf(result: SeriesResult): bigint[] {
  let times = decoded.get(result);
  if (!times) {
    times = decodeTimes(result.t);
    decoded.set(result, times);
  }
  return times;
}

/** Index of the last time ≤ t, -1 if there is none (binary search on sorted times). */
function lastAtOrBefore(times: readonly bigint[], t: bigint): number {
  let lo = 0;
  let hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((times[mid] as bigint) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** A raw point with its state name (N2). */
interface NamedPoint {
  t: bigint;
  v: number | null;
  label?: string;
}

function named(t: bigint, v: number | null, label: string | undefined): NamedPoint {
  return label === undefined ? { t, v } : { t, v, label };
}

const edge = (p: EdgePoint | undefined, info: SignalInfo | undefined) =>
  p && named(parseTimestamp(p.t), p.v, stateName(info, p.v, p.label));

/**
 * Raw value at t (line mode holds next to a named point, N3), named after the point it came from;
 * nothing across a split pair beyond its hold end (G4).
 */
function rawValueAt(
  result: RawSeries,
  times: readonly bigint[],
  i: number,
  t: bigint,
  mode: DisplayMode,
  info: SignalInfo | undefined,
  gaps: SignalGaps,
): ReadoutValue {
  const point = (k: number) => {
    const v = result.v[k] ?? null;
    return named(times[k] as bigint, v, stateName(info, v, result.text?.[k]));
  };
  const at = i >= 0 ? point(i) : edge(result.before, info);
  const next = i + 1 < times.length ? point(i + 1) : edge(result.after, info);
  const v = evaluateAt(
    t,
    mode === "step" ? "step" : "line",
    at,
    next,
    info?.states ? (p) => (p as NamedPoint).label !== undefined : undefined,
    gaps,
  );
  return (v.kind === "raw" || v.kind === "held") && at?.label !== undefined
    ? { ...v, label: at.label }
    : v;
}

/**
 * Value of one signal at `t` from a window's loaded data (design N4): outside [from, to) none;
 * raw by evaluateAt with the edge neighbours (markers evaluate as line), named by `info` (N3);
 * buckets by the mean of the bucket containing t, SNA if it holds SNA points only, named when
 * its minimum and maximum share a state name. With `gaps` (G7 "Drawn value"): raw reads no
 * value across a split pair; buckets read none inside a logger gap and in the empty stretch
 * between two split buckets. undefined: nothing loaded yet.
 */
export function chartValueAt(
  result: SeriesResult | undefined,
  t: bigint,
  mode: DisplayMode,
  info?: SignalInfo,
  gaps: SignalGaps = NO_GAPS,
): ReadoutValue | undefined {
  if (!result) return undefined;
  if (t < parseTimestamp(result.from) || t >= parseTimestamp(result.to))
    return { kind: "none", reason: "outside_range" };
  const times = timesOf(result);
  const i = lastAtOrBefore(times, t);
  if (result.kind === "raw") return rawValueAt(result, times, i, t, mode, info, gaps);
  if (loggerGapAt(t, gaps.logger)) return { kind: "none", reason: "logger_gap" };
  const width = BigInt(result.width);
  if (i < 0) return { kind: "none", reason: "empty_bucket" };
  if (t >= (times[i] as bigint) + width) {
    const next = times[i + 1];
    const split =
      next === undefined ? undefined : splitBuckets(times[i] as bigint, next, width, gaps);
    if (split) return { kind: "none", reason: split === "logger" ? "logger_gap" : "period_gap" };
    return { kind: "none", reason: "empty_bucket" };
  }
  const mean = result.mean[i];
  if (mean === null || mean === undefined) return { kind: "sna" };
  // Buckets carry no text: only VAL_ labels name a bucket.
  const low =
    info?.states === "labels" ? stateName(info, result.min[i] ?? null, undefined) : undefined;
  const high = low && stateName(info, result.max[i] ?? null, undefined);
  return low !== undefined && low === high
    ? { kind: "aggregated", value: mean, label: low }
    : { kind: "aggregated", value: mean };
}

/** A readout value at its drawn y (near candidates, L5): a named text signal state at its level. */
export function atLevel(
  v: ReadoutValue | undefined,
  states: readonly DiagScaleRow[] | undefined,
): ReadoutValue | undefined {
  return states && v && "label" in v && v.label !== undefined
    ? { ...v, value: stateLevel(states, v.value, v.label) }
    : v;
}

const isNumber = (v: ReadoutValue | undefined): v is NumberValue =>
  v?.kind === "raw" || v?.kind === "interpolated" || v?.kind === "held" || v?.kind === "aggregated";

const LOADING_CELL = loadingCell({ text: NO_VALUE });

/** Tooltip of a readout number by its tag; the legend row names the unit once. */
const KIND_TITLES: Record<NonNullable<Cell["tag"]>, string> = {
  lin: "linear between points (lin)",
  hold: "held from the last point (hold)",
  avg: "bucket mean (avg)",
};

/** A legend cell (design N3): the number with its SI prefix only, the kind as tooltip. */
function bare(tag: Cell["tag"], value: number, unit: string | undefined, digits: Digits): Cell {
  const text = formatQuantityBare(value, unit, digits);
  return tag ? { text, title: KIND_TITLES[tag] } : { text };
}

/**
 * A readout cell: SNA, "—" with the reason, a state name as its short label (N3, tooltip by
 * labelTitle with `info`), or the bare number; undefined is the loading state.
 */
export function readoutCell(
  v: ReadoutValue | undefined,
  unit: string | undefined,
  digits: Digits,
  info?: SignalInfo,
): Cell {
  if (!v) return LOADING_CELL;
  if ("label" in v && v.label !== undefined)
    return { text: shortLabel(v.label), title: labelTitle(v.label, v.value, unit, info) };
  switch (v.kind) {
    case "none":
      return noValueCell(v.reason);
    case "sna":
      return { text: "SNA", sna: true };
    case "raw":
      return bare(undefined, v.value, unit, digits);
    case "interpolated":
      return bare("lin", v.value, unit, digits);
    case "held":
      return bare("hold", v.value, unit, digits);
    case "aggregated":
      return bare("avg", v.value, unit, digits);
  }
}

/**
 * Δ = B − A, only from two numbers (else "—"), kind avg > lin > hold; "=" / "≠" when either has a
 * state name (stateDelta); loading as readoutCell while a value is not loaded.
 */
export function readoutDelta(
  a: ReadoutValue | undefined,
  b: ReadoutValue | undefined,
  unit: string | undefined,
  digits: Digits,
  info?: SignalInfo,
): Cell {
  if (!a || !b) return LOADING_CELL;
  if (!isNumber(a) || !isNumber(b)) return { text: NO_VALUE };
  if (isNamed(a) || isNamed(b)) return stateDelta(a, b, info);
  return bare(numberDelta(a, b, unit, digits).tag, b.value - a.value, unit, digits);
}

/** A readout value with its state (D-031): loading shows dimmed, an error as "—" with the message. */
export interface ReadoutSource {
  value: ReadoutValue | undefined;
  loading: boolean;
  error?: string;
}

const isOutside = (v: ReadoutValue | undefined) =>
  v?.kind === "none" && v.reason === "outside_range";

/**
 * Where a chart readout value comes from (D-031): the server's exact value at the committed
 * cursor time, like the values window, inside or outside the zoom. While a line is dragged
 * (`previewing`) the drawn curve gives the live value; while the exact value loads, the drawn one
 * (or the previous exact one, outside the zoom) shows dimmed, so crossing the zoom edge is
 * invisible.
 */
export function readoutSource(
  exact: ValueState | undefined,
  drawn: ReadoutValue | undefined,
  previewing: boolean,
): ReadoutSource {
  const fallback = isOutside(drawn) ? exact?.result?.value : drawn;
  if (previewing) return { value: fallback, loading: false };
  if (exact?.status === "error") {
    return { value: undefined, loading: false, error: exact.error ?? "error" };
  }
  if (exact?.status === "complete") return { value: exact.result?.value, loading: false };
  return { value: fallback, loading: true };
}

/** The cell of one readout source. */
export function sourceCell(
  source: ReadoutSource,
  unit: string | undefined,
  digits: Digits,
  info?: SignalInfo,
): Cell {
  if (source.error !== undefined) return { text: NO_VALUE, title: `failed: ${source.error}` };
  const cell = readoutCell(source.value, unit, digits, info);
  return source.loading ? loadingCell(cell) : cell;
}

/** The Δ cell of two readout sources: loading if either is, "—" if either failed. */
export function sourceDelta(
  a: ReadoutSource,
  b: ReadoutSource,
  unit: string | undefined,
  digits: Digits,
  info?: SignalInfo,
): Cell {
  if (a.error !== undefined || b.error !== undefined) return { text: NO_VALUE };
  const cell = readoutDelta(a.value, b.value, unit, digits, info);
  return a.loading || b.loading ? loadingCell(cell) : cell;
}
