import {
  type CursorValue,
  type Digits,
  type EdgePoint,
  formatCursorNumber,
  formatQuantity,
  type NoValueReason,
  parseTimestamp,
} from "@letsview/shared";
import { formatDate, formatFull } from "../time/axis.ts";

/** One value cell of the values window and the chart readout (design S4). */
export interface Cell {
  text: string;
  tag?: "lin" | "hold" | "avg";
  sna?: boolean;
  title?: string;
  /** The value for the current cursor time is loading: shown dimmed. */
  loading?: boolean;
}

export const NO_VALUE = "—";
/** Shown while a value loads and no previous one is there; "—" means only "no value". */
export const LOADING = "…";

/** A cell whose value is loading: the previous value dimmed, or "…" instead of "—"; tooltip "loading". */
export function loadingCell(previous: Cell): Cell {
  return {
    ...(previous.text === NO_VALUE ? { text: LOADING } : previous),
    loading: true,
    title: "loading",
  };
}

/** Why a cell has no value: the values window's reasons plus the chart readout's (design N4). */
export type ValueReason = NoValueReason | "empty_bucket" | "outside_range";

const REASONS: Record<ValueReason, string> = {
  no_data: "no data",
  before_first: "before the first point",
  after_last: "after the last point",
  next_sna: "next point is SNA",
  empty_bucket: "no points in this bucket",
  outside_range: "outside this window's range",
};

/** "—" with the reason as tooltip. */
export const noValueCell = (reason: ValueReason): Cell => ({
  text: NO_VALUE,
  title: REASONS[reason],
});

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

/**
 * A value at a cursor: "—" for none or no value yet, "SNA" in the SNA style, else the number with
 * its unit (number-format). The tooltip names the neighbours exactly (design N9).
 */
export function formatCell(
  v: CursorValue | undefined,
  at: EdgePoint | undefined,
  next: EdgePoint | undefined,
  unit: string | undefined,
  digits: Digits,
): Cell {
  if (!v) return { text: NO_VALUE };
  const title = neighbours(at, next);
  switch (v.kind) {
    case "none":
      return noValueCell(v.reason);
    case "sna":
      return withTitle({ text: "SNA", sna: true }, title);
    case "raw":
      return withTitle({ text: formatQuantity(v.value, unit, digits) }, title);
    case "interpolated":
      return withTitle({ text: formatQuantity(v.value, unit, digits), tag: "lin" }, title);
    case "held":
      return withTitle({ text: formatQuantity(v.value, unit, digits), tag: "hold" }, title);
  }
}

/** A value that is a number, from the server (raw, interpolated, held) or a chart (aggregated). */
export interface NumberValue {
  kind: "raw" | "interpolated" | "held" | "aggregated";
  value: number;
}

/** Δ = B − A of two numbers, tagged "avg" if either is aggregated, else "lin", else "hold". */
export function numberDelta(
  a: NumberValue,
  b: NumberValue,
  unit: string | undefined,
  digits: Digits,
): Cell {
  const text = formatQuantity(b.value - a.value, unit, digits);
  const kinds = [a.kind, b.kind];
  if (kinds.includes("aggregated")) return { text, tag: "avg" };
  if (kinds.includes("interpolated")) return { text, tag: "lin" };
  if (kinds.includes("held")) return { text, tag: "hold" };
  return { text };
}

const isNumber = (v: CursorValue | undefined): v is Extract<CursorValue, { value: number }> =>
  v?.kind === "raw" || v?.kind === "interpolated" || v?.kind === "held";

/** Δ = B − A, only from two numbers; tagged "lin" if either is interpolated, else "hold" if either is held. */
export function deltaCell(
  a: CursorValue | undefined,
  b: CursorValue | undefined,
  unit: string | undefined,
  digits: Digits,
): Cell {
  if (!isNumber(a) || !isNumber(b)) return { text: NO_VALUE };
  return numberDelta(a, b, unit, digits);
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

/** One cursor time of the values window's header, with its full text as tooltip. */
export interface HeaderTime {
  text: string;
  title?: string;
}

/** "HH:MM:SS…" of a formatted cursor time. */
const clock = (time: string) => time.slice(time.indexOf(" ") + 1);

/** Local "HH:MM:SS[.fff…]" of a cursor time, without the date (the chart's readout row). */
export const formatClock = (t: bigint): string => clock(formatCursorTime(t));

/**
 * The values window's header times (design L4): A, and with Diff B and Δt. B leaves out its date
 * when it lies on A's local day. If the times do not `fit`, A and B drop their dates (the
 * tooltips keep them), so the times are never cut; Δt stays.
 */
export function headerTimes(
  a: bigint | undefined,
  b: bigint | undefined,
  diff: boolean,
  fits: (texts: string[]) => boolean,
): HeaderTime[] {
  const timeA = a === undefined ? undefined : formatCursorTime(a);
  const timeB = b === undefined ? undefined : formatCursorTime(b);
  const sameDay = a !== undefined && b !== undefined && formatDate(a) === formatDate(b);
  const times = (dates: boolean): HeaderTime[] => {
    const out: HeaderTime[] = [
      timeA === undefined
        ? { text: "Cursor A off" }
        : { text: `A ${dates ? timeA : clock(timeA)}`, title: `A ${timeA}` },
    ];
    if (!diff) return out;
    out.push(
      timeB === undefined
        ? { text: "B off" }
        : { text: `B ${dates && !sameDay ? timeB : clock(timeB)}`, title: `B ${timeB}` },
    );
    if (a !== undefined && b !== undefined) {
      const dt = `Δt ${formatDeltaT(b - a)}`;
      out.push({ text: dt, title: dt });
    }
    return out;
  };
  const full = times(true);
  return fits(full.map((t) => t.text)) ? full : times(false);
}
