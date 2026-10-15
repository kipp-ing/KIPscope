import type { EdgePoint } from "./series.ts";
import type { ValuesMode } from "./workspace.ts";

export type NoValueReason = "no_data" | "before_first" | "after_last" | "next_sna";

export type CursorValue =
  /** A point lies exactly at t. */
  | { kind: "raw"; value: number }
  /** Line mode, between two valid points. */
  | { kind: "interpolated"; value: number }
  /** Step mode, the earlier valid point's value. */
  | { kind: "held"; value: number }
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

interface Point {
  t: bigint;
  v: number | null;
}

/**
 * Value of a signal at `t` from its neighbours `at` (time ≤ t) and `next` (time > t), by the
 * curve rules of timeseries-window (design C4): no invented values, SNA never a number, step
 * holds up to an SNA point, line mode draws no segment into SNA. Pure.
 */
export function evaluateAt(
  t: bigint,
  mode: ValuesMode,
  at: Point | undefined,
  next: Point | undefined,
): CursorValue {
  if (!at) return { kind: "none", reason: next ? "before_first" : "no_data" };
  if (at.t === t) return at.v === null ? { kind: "sna" } : { kind: "raw", value: at.v };
  if (!next) return { kind: "none", reason: "after_last" };
  if (at.v === null) return { kind: "sna" };
  if (mode === "step") return { kind: "held", value: at.v };
  if (next.v === null) return { kind: "none", reason: "next_sna" };
  // Bigint differences, Number only for the ratio: exact below 2^53 ns (104 days).
  const ratio = Number(t - at.t) / Number(next.t - at.t);
  return { kind: "interpolated", value: at.v + (next.v - at.v) * ratio };
}

/** At most 9 significant digits, trailing zeros dropped (362.40000000000003 → "362.4"). */
export function formatCursorNumber(v: number): string {
  return String(Number(v.toPrecision(9)));
}
