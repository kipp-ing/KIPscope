import {
  type CursorName,
  isTimeseries,
  type TimeseriesWindow,
  type Workspace,
} from "@kipscope/shared";
import { snapCursorTime } from "../chart/cursors.ts";

/** Target of the bar's Go to, span, Back and Reset (design C5): the window zoomed last, else the first timeseries window. */
export function barTarget(ws: Workspace): TimeseriesWindow | undefined {
  const windows = ws.windows.filter(isTimeseries);
  return windows.find((w) => w.id === ws.lastZoomed) ?? windows[0];
}

/** Signals whose extents Reset shows: linked, those of all timeseries windows; else the target's. */
export function resetSignals(ws: Workspace): string[] {
  const windows = ws.linkTime ? ws.windows.filter(isTimeseries) : [barTarget(ws)];
  return [...new Set(windows.flatMap((w) => w?.signals.map((s) => s.signalId) ?? []))];
}

/** Where a cursor switched on in the bar is placed: A at a third, B at two thirds, snapped. */
export function defaultCursorTime(range: { from: bigint; to: bigint }, cursor: CursorName): bigint {
  const span = range.to - range.from;
  return snapCursorTime(range.from + (span * (cursor === "a" ? 1n : 2n)) / 3n, span);
}
