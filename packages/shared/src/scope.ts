import { parseSignalId } from "./signals.ts";
import { formatSpan, TIME_MAX, TIME_MIN } from "./time.ts";
import { MIN_SPAN_NS } from "./timenav.ts";
import { isTimeseries, type TimeRange, type Workspace, type WorkspaceScope } from "./workspace.ts";

/**
 * Cache and comparison key of a scope: "" without one, else `${dataRef}|${from}|${to}`, plus
 * "|object" for an object scope (add-case-open K11).
 */
export const scopeKey = (s: WorkspaceScope | undefined): string =>
  s === undefined ? "" : `${s.dataRef}|${s.from}|${s.to}${s.object ? "|object" : ""}`;

/**
 * The clamp rule of design Z6: keep the span and shift inside; a span at least as wide as the
 * scope becomes the scope. `clamped` is true iff the range changed.
 */
export function clampToScope(
  range: TimeRange,
  scope: WorkspaceScope,
): { range: TimeRange; clamped: boolean } {
  const f = BigInt(range.from);
  const t = BigInt(range.to);
  const F = BigInt(scope.from);
  const T = BigInt(scope.to);
  const s = t - f;
  let from = f;
  let to = t;
  if (s >= T - F) [from, to] = [F, T];
  else if (f < F) [from, to] = [F, F + s];
  else if (t > T) [from, to] = [T - s, T];
  if (from === f && to === t) return { range, clamped: false };
  return { range: { from: from.toString(), to: to.toString() }, clamped: true };
}

/** Design Z7: one span added on each side, clamped to TIME_MIN … TIME_MAX (Q-3 (a)). */
export function widenScope(scope: WorkspaceScope): WorkspaceScope {
  const from = BigInt(scope.from);
  const to = BigInt(scope.to);
  const span = to - from;
  const lo = from - span < TIME_MIN ? TIME_MIN : from - span;
  const hi = to + span > TIME_MAX ? TIME_MAX : to + span;
  return { dataRef: scope.dataRef, from: lo.toString(), to: hi.toString() };
}

/** "1234567" → "1,234,567" (en-US groups of three). */
const groupDigits = (n: string) => n.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/**
 * Message of a `too_wide` answer (scope "Too wide answers"): the row form when `rows` and `limit`
 * decided, else the span form with formatSpan.
 */
export function tooWideText(e: {
  rows?: string;
  limit?: string;
  span?: string;
  maxSpan?: string;
}): string {
  const tail = "choose a shorter range";
  if (e.rows !== undefined && e.limit !== undefined)
    return `too wide: ${groupDigits(e.rows)} rows, more than the ${groupDigits(e.limit)} a query may read; ${tail}`;
  if (e.span !== undefined && e.maxSpan !== undefined)
    return `too wide: ${formatSpan(BigInt(e.span))} is more than the ${formatSpan(BigInt(e.maxSpan))} a query may span; ${tail}`;
  return `too wide: ${tail}`;
}

/**
 * viewScope's rule over the workspace (design B8 prefill): the first timeseries window's first
 * signal's data ref; the union of the timeseries windows' ranges and the cursors (each [t, t + 1)),
 * padded by `pad` on each side within the time bounds. Undefined without a timeseries window with
 * a signal.
 */
export function windowsScope(ws: Workspace, pad: bigint): WorkspaceScope | undefined {
  const series = ws.windows.filter(isTimeseries);
  const first = series.find((w) => w.signals.length > 0)?.signals[0];
  const dataRef = first && parseSignalId(first.signalId)?.dataRef;
  if (dataRef === undefined) return undefined;
  const spans: [bigint, bigint][] = series.map((w) => [BigInt(w.range.from), BigInt(w.range.to)]);
  for (const t of [ws.cursors.a, ws.cursors.b]) {
    if (t !== undefined) spans.push([BigInt(t), BigInt(t) + 1n]);
  }
  let from = spans.reduce((m, [f]) => (f < m ? f : m), TIME_MAX) - pad;
  let to = spans.reduce((m, [, t]) => (t > m ? t : m), TIME_MIN) + pad;
  if (from < TIME_MIN) from = TIME_MIN;
  if (to > TIME_MAX) to = TIME_MAX;
  if (to - from < MIN_SPAN_NS) to = from + MIN_SPAN_NS;
  return { dataRef, from: from.toString(), to: to.toString() };
}
