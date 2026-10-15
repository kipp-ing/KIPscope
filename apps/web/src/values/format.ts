import {
  type CursorValue,
  type EdgePoint,
  formatCursorNumber,
  type NoValueReason,
  parseTimestamp,
} from "@letsview/shared";
import { formatFull } from "../time/axis.ts";

/** One value cell of the values window (design S4). */
export interface Cell {
  text: string;
  tag?: "lin" | "hold";
  sna?: boolean;
  title?: string;
}

export const NO_VALUE = "—";

const REASONS: Record<NoValueReason, string> = {
  no_data: "no data",
  before_first: "before the first point",
  after_last: "after the last point",
  next_sna: "next point is SNA",
};

const formatPoint = (p: EdgePoint) =>
  `${formatFull(parseTimestamp(p.t))} → ${p.v === null ? "SNA" : formatCursorNumber(p.v)}`;

/** Tooltip naming the neighbour points a value came from (local time and value). */
function neighbours(at?: EdgePoint, next?: EdgePoint): string | undefined {
  const lines = [at && `at ${formatPoint(at)}`, next && `next ${formatPoint(next)}`].filter(
    (line): line is string => line !== undefined,
  );
  return lines.length > 0 ? lines.join("\n") : undefined;
}

const withTitle = (cell: Cell, title: string | undefined): Cell =>
  title === undefined ? cell : { ...cell, title };

/** A value at a cursor: "—" for none or no value yet, "SNA" in the SNA style, else the number. */
export function formatCell(v: CursorValue | undefined, at?: EdgePoint, next?: EdgePoint): Cell {
  if (!v) return { text: NO_VALUE };
  switch (v.kind) {
    case "none":
      return { text: NO_VALUE, title: REASONS[v.reason] };
    case "sna":
      return withTitle({ text: "SNA", sna: true }, neighbours(at, next));
    case "raw":
      return withTitle({ text: formatCursorNumber(v.value) }, neighbours(at, next));
    case "interpolated":
      return withTitle({ text: formatCursorNumber(v.value), tag: "lin" }, neighbours(at, next));
    case "held":
      return withTitle({ text: formatCursorNumber(v.value), tag: "hold" }, neighbours(at, next));
  }
}

const isNumber = (v: CursorValue | undefined): v is Extract<CursorValue, { value: number }> =>
  v?.kind === "raw" || v?.kind === "interpolated" || v?.kind === "held";

/** Δ = B − A, only from two numbers; tagged "lin" if either is interpolated, else "hold" if either is held. */
export function deltaCell(a: CursorValue | undefined, b: CursorValue | undefined): Cell {
  if (!isNumber(a) || !isNumber(b)) return { text: NO_VALUE };
  const text = formatCursorNumber(b.value - a.value);
  const kinds = [a.kind, b.kind];
  if (kinds.includes("interpolated")) return { text, tag: "lin" };
  if (kinds.includes("held")) return { text, tag: "hold" };
  return { text };
}

const NS_PER_US = 1_000n;
const NS_PER_MS = 1_000_000n;
const NS_PER_S = 1_000_000_000n;
const NS_PER_MIN = 60n * NS_PER_S;
const NS_PER_H = 60n * NS_PER_MIN;

/** `value / unit` as an exact decimal, trailing zeros dropped. */
function decimal(value: bigint, unit: bigint): string {
  const whole = value / unit;
  const rest = value % unit;
  if (rest === 0n) return whole.toString();
  const digits = unit.toString().length - 1;
  return `${whole}.${rest.toString().padStart(digits, "0").replace(/0+$/, "")}`;
}

const pad2 = (n: bigint) => n.toString().padStart(2, "0");

/** Δt exactly, with sign: ns, µs, ms or s below one minute, else h:mm:ss with fraction. */
export function formatDeltaT(ns: bigint): string {
  if (ns === 0n) return "0 ns";
  const sign = ns < 0n ? "-" : "+";
  const abs = ns < 0n ? -ns : ns;
  if (abs < NS_PER_US) return `${sign}${abs} ns`;
  if (abs < NS_PER_MS) return `${sign}${decimal(abs, NS_PER_US)} µs`;
  if (abs < NS_PER_S) return `${sign}${decimal(abs, NS_PER_MS)} ms`;
  if (abs < NS_PER_MIN) return `${sign}${decimal(abs, NS_PER_S)} s`;
  const hours = abs / NS_PER_H;
  const minutes = (abs % NS_PER_H) / NS_PER_MIN;
  const seconds = decimal(abs % NS_PER_MIN, NS_PER_S);
  const [whole = "0", fraction] = seconds.split(".");
  return `${sign}${hours}:${pad2(minutes)}:${whole.padStart(2, "0")}${fraction ? `.${fraction}` : ""}`;
}

/** Local "YYYY-MM-DD HH:MM:SS[.fff[fff[fff]]]", trailing zero groups of three dropped. */
export function formatCursorTime(t: bigint): string {
  return formatFull(t);
}
