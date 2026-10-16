import {
  type CursorValue,
  type Digits,
  type DisplayMode,
  decodeTimes,
  type EdgePoint,
  evaluateAt,
  formatQuantityBare,
  parseTimestamp,
  type SeriesResult,
} from "@kipscope/shared";
import {
  type Cell,
  loadingCell,
  NO_VALUE,
  type NumberValue,
  noValueCell,
  numberDelta,
  type ValueReason,
} from "../values/format.ts";
import type { ValueState } from "../values/loader.ts";

/** A value of the chart readout: the values window's kinds plus a bucket mean (design N4). */
export type ReadoutValue =
  | CursorValue
  | { kind: "aggregated"; value: number }
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

const edge = (p: EdgePoint | undefined) => p && { t: parseTimestamp(p.t), v: p.v };

/**
 * Value of one signal at `t` from a window's loaded data (design N4): outside [from, to) none;
 * raw by evaluateAt with the edge neighbours (markers evaluate as line); buckets by the mean of
 * the bucket containing t, SNA if it holds SNA points only. undefined: nothing loaded yet.
 */
export function chartValueAt(
  result: SeriesResult | undefined,
  t: bigint,
  mode: DisplayMode,
): ReadoutValue | undefined {
  if (!result) return undefined;
  if (t < parseTimestamp(result.from) || t >= parseTimestamp(result.to))
    return { kind: "none", reason: "outside_range" };
  const times = timesOf(result);
  const i = lastAtOrBefore(times, t);
  if (result.kind === "raw") {
    const point = (k: number) => ({ t: times[k] as bigint, v: result.v[k] ?? null });
    const at = i >= 0 ? point(i) : edge(result.before);
    const next = i + 1 < times.length ? point(i + 1) : edge(result.after);
    return evaluateAt(t, mode === "step" ? "step" : "line", at, next);
  }
  if (i < 0 || t >= (times[i] as bigint) + BigInt(result.width))
    return { kind: "none", reason: "empty_bucket" };
  const mean = result.mean[i];
  return mean === null || mean === undefined
    ? { kind: "sna" }
    : { kind: "aggregated", value: mean };
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

/** A readout cell: SNA, "—" with the reason, or the bare number; undefined is the loading state. */
export function readoutCell(
  v: ReadoutValue | undefined,
  unit: string | undefined,
  digits: Digits,
): Cell {
  if (!v) return LOADING_CELL;
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

/** Δ = B − A, only from two numbers (else "—"), kind avg > lin > hold; loading as readoutCell while a value is not loaded. */
export function readoutDelta(
  a: ReadoutValue | undefined,
  b: ReadoutValue | undefined,
  unit: string | undefined,
  digits: Digits,
): Cell {
  if (!a || !b) return LOADING_CELL;
  if (!isNumber(a) || !isNumber(b)) return { text: NO_VALUE };
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
export function sourceCell(source: ReadoutSource, unit: string | undefined, digits: Digits): Cell {
  if (source.error !== undefined) return { text: NO_VALUE, title: `failed: ${source.error}` };
  const cell = readoutCell(source.value, unit, digits);
  return source.loading ? loadingCell(cell) : cell;
}

/** The Δ cell of two readout sources: loading if either is, "—" if either failed. */
export function sourceDelta(
  a: ReadoutSource,
  b: ReadoutSource,
  unit: string | undefined,
  digits: Digits,
): Cell {
  if (a.error !== undefined || b.error !== undefined) return { text: NO_VALUE };
  const cell = readoutDelta(a.value, b.value, unit, digits);
  return a.loading || b.loading ? loadingCell(cell) : cell;
}
