import {
  type Density,
  formatSpan,
  parseSignalId,
  type TimeRange,
  type Workspace,
  type WorkspaceScope,
  workWindow,
} from "@kipscope/shared";
import { isTooWide, scanSpanNs } from "../api.ts";
import { barTarget } from "../bar/bar.ts";

export { formatSpan };

/** Delay before a failed density fetch is retried (time-strip "Time strip states"). */
export const RETRY_MS = 30_000;

/** The track's note after a `too_wide` answer (time-strip "Time strip states"). */
export const TOO_WIDE_NOTE = "Range too wide for the strip";

/** When a failed density fetch is retried: never after `too_wide` (until scope or range change), else RETRY_MS. */
export const densityRetryMs = (error: unknown): number | undefined =>
  isTooWide(error) ? undefined : RETRY_MS;

/** The scope's data ref while the workspace has a scope (add-scope Z12); else the data ref of the
 *  first signal of barTarget(ws), else of the first signal of any window in order. */
export function stripDataRef(ws: Workspace): string | undefined {
  if (ws.scope) return ws.scope.dataRef;
  const first =
    barTarget(ws)?.signals[0] ?? ws.windows.find((w) => w.signals.length > 0)?.signals[0];
  return first && parseSignalId(first.signalId)?.dataRef;
}

/**
 * "<shown> of <recorded> recorded"; without range "<recorded> recorded" (no bars, D-094).
 * recorded = last − first. A density of a scope reads "<shown> of <span> in scope" (add-scope Z12).
 * Given the scope itself: "<shown> of <span> in scope", an object scope "<shown> of <span> in
 * catalog" (object-view "Label of an object scope": the span of the catalog's sessions).
 */
export function stripLabel(
  d: Density | WorkspaceScope,
  range?: { from: bigint; to: bigint },
): string {
  const shown = range ? `${formatSpan(range.to - range.from)} of ` : "";
  if (!("counts" in d)) {
    const span = formatSpan(BigInt(d.to) - BigInt(d.from));
    return `${shown}${span} ${d.object ? "in catalog" : "in scope"}`;
  }
  const span = d.scope
    ? BigInt(d.scope.to) - BigInt(d.scope.from)
    : BigInt(d.last) - BigInt(d.first);
  return `${shown}${formatSpan(span)} ${d.scope ? "in scope" : "recorded"}`;
}

/** Bars of the track over an object scope, as the server's density has at most (time-strip T8). */
const SCOPE_BARS = 120;

/**
 * The track of an object scope without a request (object-view B5): a density shape over the
 * scope with no counts, so geometry, the whole-span step and the labels work; the presence line
 * comes from the work window's detail density only.
 */
export function scopeDensity(scope: WorkspaceScope): Density {
  const from = BigInt(scope.from);
  const to = BigInt(scope.to);
  const n = BigInt(SCOPE_BARS);
  const width = to - from > n ? (to - from + n - 1n) / n : 1n;
  return {
    dataRef: scope.dataRef,
    first: scope.from,
    last: (to - 1n).toString(),
    width: width.toString(),
    start: scope.from,
    counts: new Array<number>(SCOPE_BARS).fill(0),
    grid: width.toString(),
    drives: [],
    scope: { from: scope.from, to: scope.to },
  };
}

/**
 * The work window the strip holds for `view` in an object scope (add-case-open K11): `held` while
 * `view` lies inside it, else `workWindow(view, scope, maxSpanNs)` (speed-up-whole-scans B3, the
 * server's `KIPSCOPE_SCAN_SPAN` by default). So a pan inside the window asks nothing new, and a
 * jump out of it asks once.
 */
export function nextWorkWindow(
  held: TimeRange | undefined,
  view: { from: bigint; to: bigint },
  scope: WorkspaceScope,
  maxSpanNs: bigint = scanSpanNs(),
): TimeRange {
  if (held && BigInt(held.from) <= view.from && view.to <= BigInt(held.to)) return held;
  return workWindow({ from: view.from.toString(), to: view.to.toString() }, scope, maxSpanNs);
}

/** Tooltip of the events nearby: Events tab count and events switch (add-case-open K14). */
export const nearbyHint = (w: TimeRange): string =>
  `Events within ${formatSpan(BigInt(w.to) - BigInt(w.from))} around the view`;
