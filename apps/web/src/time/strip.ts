import {
  type Density,
  parseSignalId,
  type TimeRange,
  type Workspace,
  type WorkspaceScope,
  workWindow,
} from "@kipscope/shared";
import { barTarget } from "../bar/bar.ts";

/** Height of the strip's tallest bar in px (design T8). */
export const BAR_PX = 24;
/** Delay before a failed density fetch is retried (time-strip "Time strip states"). */
export const RETRY_MS = 30_000;

/** The scope's data ref while the workspace has a scope (add-scope Z12); else the data ref of the
 *  first signal of barTarget(ws), else of the first signal of any window in order. */
export function stripDataRef(ws: Workspace): string | undefined {
  if (ws.scope) return ws.scope.dataRef;
  const first =
    barTarget(ws)?.signals[0] ?? ws.windows.find((w) => w.signals.length > 0)?.signals[0];
  return first && parseSignalId(first.signalId)?.dataRef;
}

/** Per bucket: height (0 rows → 1, else max(3, round(BAR_PX * count / max))) and whether [start_i, start_i + width) meets [from, to). */
export function stripBars(
  d: Density,
  range?: { from: bigint; to: bigint },
): { height: number; shown: boolean }[] {
  const start = BigInt(d.start);
  const width = BigInt(d.width);
  const max = Math.max(0, ...d.counts);
  return d.counts.map((count, i) => {
    const from = start + BigInt(i) * width;
    return {
      height: count === 0 ? 1 : Math.max(3, Math.round((BAR_PX * count) / max)),
      shown: range !== undefined && from < range.to && from + width > range.from,
    };
  });
}

/**
 * "<shown> of <recorded> recorded · 1 bar = <width>"; without range "<recorded> recorded · 1 bar = <width>".
 * recorded = last − first. A density of a scope reads "<shown> of <span> in scope · …" (add-scope Z12),
 * a coarse one of an object scope "<shown> of <span> recorded · …" (add-case-open K14).
 */
export function stripLabel(d: Density, range?: { from: bigint; to: bigint }): string {
  const span = d.scope
    ? BigInt(d.scope.to) - BigInt(d.scope.from)
    : BigInt(d.last) - BigInt(d.first);
  const recorded = `${formatSpan(span)} ${d.scope && !d.coarse ? "in scope" : "recorded"}`;
  const shown = range ? `${formatSpan(range.to - range.from)} of ` : "";
  return `${shown}${recorded} · 1 bar = ${formatSpan(BigInt(d.width))}`;
}

/**
 * The work window the strip holds for `view` in an object scope (add-case-open K11): `held` while
 * `view` lies inside it, else `workWindow(view, scope)`. So a pan inside the window asks nothing
 * new, and a jump out of it asks once.
 */
export function nextWorkWindow(
  held: TimeRange | undefined,
  view: { from: bigint; to: bigint },
  scope: WorkspaceScope,
): TimeRange {
  if (held && BigInt(held.from) <= view.from && view.to <= BigInt(held.to)) return held;
  return workWindow({ from: view.from.toString(), to: view.to.toString() }, scope);
}

/** Tooltip of the events nearby, strip count and events switch (add-case-open K14). */
export const nearbyHint = (w: TimeRange): string =>
  `Events within ${formatSpan(BigInt(w.to) - BigInt(w.from))} around the view`;

const MS = 1_000_000n;
const SPAN_UNITS: { unit: string; ns: bigint }[] = [
  { unit: "y", ns: 365n * 86_400_000n * MS },
  { unit: "d", ns: 86_400_000n * MS },
  { unit: "h", ns: 3_600_000n * MS },
  { unit: "min", ns: 60_000n * MS },
  { unit: "s", ns: 1_000n * MS },
  { unit: "ms", ns: MS },
];

/** Largest of y (365 d), d, h, min, s, ms that ns reaches (else ms); Math.round(x * 10) / 10, no ".0". 0 → "0 ms". */
export function formatSpan(ns: bigint): string {
  const { unit, ns: size } = SPAN_UNITS.find((u) => ns >= u.ns) ?? { unit: "ms", ns: MS };
  return `${Math.round((Number(ns) / Number(size)) * 10) / 10} ${unit}`;
}
