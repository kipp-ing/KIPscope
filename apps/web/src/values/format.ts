import {
  type CursorValue,
  type Digits,
  type EdgePoint,
  formatCursorNumber,
  formatQuantity,
  labelTolerance,
  type NoValueReason,
  parseTimestamp,
  type SignalInfo,
  shortLabel,
  stateLabel,
} from "@kipscope/shared";
import { formatDate, formatFull } from "../time/axis.ts";

/** One value cell of the values window and the chart readout (design S4). */
export interface Cell {
  text: string;
  tag?: "lin" | "hold" | "avg";
  sna?: boolean;
  /** "no data" inside a gap (add-gap-display G7): shown muted, class `gap-value`. */
  gap?: boolean;
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
  logger_gap: "no data: the logger recorded nothing",
  period_gap: "no data: more than 3 periods without a point",
  empty_bucket: "no points in this bucket",
  outside_range: "outside this window's range",
};

/** "—" with the reason as tooltip; "no data" in the gap style inside a gap (G7 "Cells"). */
export const noValueCell = (reason: ValueReason): Cell =>
  reason === "logger_gap" || reason === "period_gap"
    ? { text: "no data", title: REASONS[reason], gap: true }
    : { text: NO_VALUE, title: REASONS[reason] };

/** The state name of a neighbour point: the row's text of a text signal, else the VAL_ label (N2). */
function pointLabel(p: EdgePoint, info: SignalInfo | undefined): string | undefined {
  if (p.v === null || !info?.states) return undefined;
  return info.states === "text" ? p.label || undefined : stateLabel(info, p.v);
}

function formatPoint(p: EdgePoint, info: SignalInfo | undefined): string {
  const label = pointLabel(p, info);
  const value = p.v === null ? "SNA" : formatCursorNumber(p.v);
  return `${formatFull(parseTimestamp(p.t))} → ${value}${label === undefined ? "" : ` ${label}`}`;
}

/** Tooltip naming the neighbour points a value came from (local time, value and state name). */
function neighbours(at?: EdgePoint, next?: EdgePoint, info?: SignalInfo): string | undefined {
  const lines = [
    at && `at ${formatPoint(at, info)}`,
    next && `next ${formatPoint(next, info)}`,
  ].filter((line): line is string => line !== undefined);
  return lines.length > 0 ? lines.join("\n") : undefined;
}

const withTitle = (cell: Cell, title: string | undefined): Cell =>
  title === undefined ? cell : { ...cell, title };

/**
 * Tooltip of a state name (N3): `<label> · <number with unit>`, the number exact; the label only
 * for a text state (diag enum, text signal), whose number is a code.
 */
export function labelTitle(
  label: string,
  value: number,
  unit: string | undefined,
  info?: SignalInfo,
): string {
  if (info?.states === "text") return label;
  const u = unit?.trim();
  return `${label} · ${formatCursorNumber(value)}${u ? ` ${u}` : ""}`;
}

/** A named value's cell (N3): the short label, the whole label and the number as tooltip. */
function labelCell(
  label: string,
  value: number,
  unit: string | undefined,
  more: string | undefined,
  info: SignalInfo | undefined,
): Cell {
  const title = labelTitle(label, value, unit, info);
  return { text: shortLabel(label), title: more === undefined ? title : `${title}\n${more}` };
}

/**
 * A value at a cursor: "—" for none or no value yet, "SNA" in the SNA style, a state name as its
 * short label (N3), else the number with its unit (number-format). The tooltip names the
 * neighbours exactly (design N9), with their state names when `info` is given.
 */
export function formatCell(
  v: CursorValue | undefined,
  at: EdgePoint | undefined,
  next: EdgePoint | undefined,
  unit: string | undefined,
  digits: Digits,
  info?: SignalInfo,
): Cell {
  if (!v) return { text: NO_VALUE };
  const title = neighbours(at, next, info);
  switch (v.kind) {
    case "none":
      return noValueCell(v.reason);
    case "sna":
      return withTitle({ text: "SNA", sna: true }, title);
    case "raw":
      if (v.label !== undefined) return labelCell(v.label, v.value, unit, title, info);
      return withTitle({ text: formatQuantity(v.value, unit, digits) }, title);
    case "interpolated":
      return withTitle({ text: formatQuantity(v.value, unit, digits), tag: "lin" }, title);
    case "held":
      if (v.label !== undefined)
        return { ...labelCell(v.label, v.value, unit, title, info), tag: "hold" };
      return withTitle({ text: formatQuantity(v.value, unit, digits), tag: "hold" }, title);
  }
}

/** A value that is a number, from the server (raw, interpolated, held) or a chart (aggregated). */
export interface NumberValue {
  kind: "raw" | "interpolated" | "held" | "aggregated";
  value: number;
  /** Its state name (N2), whole. */
  label?: string;
}

/**
 * Δ of two values of which at least one has a state name (N3): "=" when both name the same state
 * (text signals: the same text; else also numbers within half a factor step, 0.5 without
 * factor), else "≠".
 */
export function stateDelta(a: NumberValue, b: NumberValue, info: SignalInfo | undefined): Cell {
  const same =
    a.label === b.label &&
    (info?.states === "text" || Math.abs(b.value - a.value) <= labelTolerance(info ?? {}));
  return { text: same ? "=" : "≠" };
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

/** The value has a state name (N3). */
export const isNamed = (v: NumberValue): boolean => v.label !== undefined;

const isNumber = (v: CursorValue | undefined): v is Extract<CursorValue, { value: number }> =>
  v?.kind === "raw" || v?.kind === "interpolated" || v?.kind === "held";

/**
 * Δ = B − A, only from two numbers; tagged "lin" if either is interpolated, else "hold" if either
 * is held. "=" / "≠" when either has a state name (stateDelta).
 */
export function deltaCell(
  a: CursorValue | undefined,
  b: CursorValue | undefined,
  unit: string | undefined,
  digits: Digits,
  info?: SignalInfo,
): Cell {
  if (!isNumber(a) || !isNumber(b)) return { text: NO_VALUE };
  if (isNamed(a) || isNamed(b)) return stateDelta(a, b, info);
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
 * The values window's header times (design L4): A, B while B is on or in diff mode, and Δt in
 * diff mode (D-031). B leaves out its date
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
    if (timeB !== undefined || diff) {
      out.push(
        timeB === undefined
          ? { text: "B off" }
          : { text: `B ${dates && !sameDay ? timeB : clock(timeB)}`, title: `B ${timeB}` },
      );
    }
    if (diff && a !== undefined && b !== undefined) {
      const dt = `Δt ${formatDeltaT(b - a)}`;
      out.push({ text: dt, title: dt });
    }
    return out;
  };
  const full = times(true);
  return fits(full.map((t) => t.text)) ? full : times(false);
}
