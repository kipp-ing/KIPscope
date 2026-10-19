import { TIME_MAX, TIME_MIN } from "./time.ts";
import type { TimeRange, WorkspaceScope } from "./workspace.ts";

/** Cache and comparison key of a scope: "" without one, else `${dataRef}|${from}|${to}`. */
export const scopeKey = (s: WorkspaceScope | undefined): string =>
  s === undefined ? "" : `${s.dataRef}|${s.from}|${s.to}`;

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
