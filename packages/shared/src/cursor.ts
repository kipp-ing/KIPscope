import { type SignalGaps, splitPoints } from "./gaps.ts";
import type { EdgePoint } from "./series.ts";
import type { ValuesMode } from "./workspace.ts";

export type NoValueReason =
  | "no_data"
  | "before_first"
  | "after_last"
  | "next_sna"
  | "logger_gap"
  | "period_gap";

export type CursorValue =
  /** A point lies exactly at t; `label`: its state name, whole (design N3). */
  | { kind: "raw"; value: number; label?: string }
  /** Line mode, between two valid points. */
  | { kind: "interpolated"; value: number }
  /** Step mode, or line mode next to a named point: the earlier valid point's value. */
  | { kind: "held"; value: number; label?: string }
  /** SNA at t (D-010: never a number). */
  | { kind: "sna" }
  | { kind: "none"; reason: NoValueReason };

/** Body of GET /api/value. */
export interface CursorValueResult {
  signalId: string;
  /** Decimal ns, as evaluated. */
  t: string;
  mode: ValuesMode;
  /** Last point with time ≤ t (v null = SNA). */
  at?: EdgePoint;
  /** First point with time > t. */
  next?: EdgePoint;
  value: CursorValue;
}

/** A neighbour of evaluateAt: time (ns) and value (null = SNA). */
export interface Point {
  t: bigint;
  v: number | null;
}

/**
 * Value of a signal at `t` from its neighbours `at` (time ≤ t) and `next` (time > t), by the
 * curve rules of timeseries-window (design C4): no invented values, SNA never a number, step
 * holds up to an SNA point, line mode draws no segment into SNA. With `named` (has a state
 * name), line mode holds when `at` or `next` is named: no interpolation into a state (D-059,
 * design N3). With `gaps`, nothing is read across a split pair (D-062, design G4): the earlier
 * value holds only up to the split's hold end, after it there is no value. Pure.
 */
export function evaluateAt(
  t: bigint,
  mode: ValuesMode,
  at: Point | undefined,
  next: Point | undefined,
  named?: (p: Point) => boolean,
  gaps?: SignalGaps,
): CursorValue {
  if (!at) return { kind: "none", reason: next ? "before_first" : "no_data" };
  if (at.t === t) return at.v === null ? { kind: "sna" } : { kind: "raw", value: at.v };
  if (!next) return { kind: "none", reason: "after_last" };
  const split = gaps && splitPoints(at.t, next.t, gaps);
  if (split) {
    if (t <= split.holdEnd) {
      if (at.v === null) return { kind: "sna" };
      if (mode === "step" || named?.(at) || (next.v !== null && named?.(next)))
        return { kind: "held", value: at.v };
    }
    return { kind: "none", reason: split.kind === "logger" ? "logger_gap" : "period_gap" };
  }
  if (at.v === null) return { kind: "sna" };
  if (mode === "step" || named?.(at) || (next.v !== null && named?.(next)))
    return { kind: "held", value: at.v };
  if (next.v === null) return { kind: "none", reason: "next_sna" };
  // Bigint differences, Number only for the ratio: exact below 2^53 ns (104 days).
  const ratio = Number(t - at.t) / Number(next.t - at.t);
  return { kind: "interpolated", value: at.v + (next.v - at.v) * ratio };
}

/** At most 9 significant digits, trailing zeros dropped (362.40000000000003 → "362.4"). */
export function formatCursorNumber(v: number): string {
  return String(Number(v.toPrecision(9)));
}
