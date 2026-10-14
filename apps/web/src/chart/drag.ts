import { type CommandInput, MAX_UNITS, type TimeseriesWindow, windowUnits } from "@letsview/shared";

export interface DragSource {
  windowId: string;
  assignmentId: string;
  signalId: string;
}

export type DropTarget = { kind: "window"; windowId: string } | { kind: "new" };

/** Pointer movement before a press on a legend grip becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;

/** A window accepts a drop when it is not the source, does not show the signal yet and keeps ≤ MAX_UNITS units; "new" always accepts. */
export function canDrop(
  source: DragSource,
  target: DropTarget,
  windows: TimeseriesWindow[],
  unitOf: (signalId: string) => string | undefined,
): boolean {
  if (target.kind === "new") return true;
  if (target.windowId === source.windowId) return false;
  const w = windows.find((x) => x.id === target.windowId);
  if (!w || w.signals.some((s) => s.signalId === source.signalId)) return false;
  return windowUnits(w, unitOf, source.signalId).length <= MAX_UNITS;
}

/** The window.moveSignal command for a drop, copy when altKey or ctrlKey; undefined when !canDrop. */
export function dropCommand(
  source: DragSource,
  target: DropTarget,
  windows: TimeseriesWindow[],
  unitOf: (signalId: string) => string | undefined,
  mods: { altKey: boolean; ctrlKey: boolean },
): CommandInput | undefined {
  if (!canDrop(source, target, windows, unitOf)) return undefined;
  const copy = mods.altKey || mods.ctrlKey;
  return {
    type: "window.moveSignal",
    windowId: source.windowId,
    assignmentId: source.assignmentId,
    ...(target.kind === "window" ? { targetWindowId: target.windowId } : {}),
    ...(copy ? { copy: true } : {}),
  };
}

/** A signal dragged out of the explorer (D-020): no source window, a drop always adds. */
export interface ExplorerDragSource {
  signalId: string;
}

/** Anything App drags: a legend row (D5) or an explorer row. */
export type AnyDragSource = DragSource | ExplorerDragSource;

/** True for a legend row (it has a source window). */
export function isLegendSource(source: AnyDragSource): source is DragSource {
  return "windowId" in source;
}

/** An explorer drop is accepted by a window that does not show the signal yet and keeps ≤ MAX_UNITS
 * units (windowUnits with the signal as extra); "new" always accepts. */
export function canAdd(
  signalId: string,
  target: DropTarget,
  windows: TimeseriesWindow[],
  unitOf: (signalId: string) => string | undefined,
): boolean {
  if (target.kind === "new") return true;
  const w = windows.find((x) => x.id === target.windowId);
  if (!w || w.signals.some((s) => s.signalId === signalId)) return false;
  return windowUnits(w, unitOf, signalId).length <= MAX_UNITS;
}

/** Highlight of one window during a drag. */
export type DropState = "source" | "target" | "refused";

/** "source": the legend source window (never for an explorer source); "target": canDrop (legend) or
 * canAdd (explorer); "refused": the window does not show the signal but would exceed MAX_UNITS with it;
 * else undefined. */
export function dropStateFor(
  source: AnyDragSource,
  windowId: string,
  windows: TimeseriesWindow[],
  unitOf: (signalId: string) => string | undefined,
): DropState | undefined {
  const target: DropTarget = { kind: "window", windowId };
  if (isLegendSource(source)) {
    if (windowId === source.windowId) return "source";
    if (canDrop(source, target, windows, unitOf)) return "target";
  } else if (canAdd(source.signalId, target, windows, unitOf)) {
    return "target";
  }
  const w = windows.find((x) => x.id === windowId);
  const refusedByUnits =
    w &&
    !w.signals.some((s) => s.signalId === source.signalId) &&
    windowUnits(w, unitOf, source.signalId).length > MAX_UNITS;
  return refusedByUnits ? "refused" : undefined;
}
