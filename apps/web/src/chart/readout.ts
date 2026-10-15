import {
  type CursorValue,
  type Digits,
  type DisplayMode,
  decodeTimes,
  type EdgePoint,
  evaluateAt,
  formatQuantity,
  parseTimestamp,
  type SeriesResult,
} from "@letsview/shared";
import {
  type Cell,
  loadingCell,
  NO_VALUE,
  type NumberValue,
  noValueCell,
  numberDelta,
  type ValueReason,
} from "../values/format.ts";

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

/** A readout cell: the values window's texts and tags plus `avg`; undefined is the loading state. */
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
      return { text: formatQuantity(v.value, unit, digits) };
    case "interpolated":
      return { text: formatQuantity(v.value, unit, digits), tag: "lin" };
    case "held":
      return { text: formatQuantity(v.value, unit, digits), tag: "hold" };
    case "aggregated":
      return { text: formatQuantity(v.value, unit, digits), tag: "avg" };
  }
}

/** Δ = B − A, only from two numbers (else "—"), tagged avg > lin > hold; loading as readoutCell while a value is not loaded. */
export function readoutDelta(
  a: ReadoutValue | undefined,
  b: ReadoutValue | undefined,
  unit: string | undefined,
  digits: Digits,
): Cell {
  if (!a || !b) return LOADING_CELL;
  if (!isNumber(a) || !isNumber(b)) return { text: NO_VALUE };
  return numberDelta(a, b, unit, digits);
}
