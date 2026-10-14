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
