import {
  type CommandInput,
  isTimeseries,
  MAX_UNITS,
  type SignalInfo,
  type Workspace,
  type WorkspaceWindow,
  windowUnits,
} from "@kipscope/shared";

/** A legend row or a values row (design C7): both name their window and assignment. */
export interface DragSource {
  windowId: string;
  assignmentId: string;
  signalId: string;
}

/** Which "+ New window" target a drop hit: the status strip or the free area below the windows. */
export type NewWindowPlace = "strip" | "below";

export type DropTarget =
  | { kind: "window"; windowId: string }
  | { kind: "new"; place?: NewWindowPlace } // absent counts as "strip"
  | { kind: "events" }; // the time strip: the events line (design V10)

/** data-drop values. */
export const DROP_NEW = "new";
export const DROP_NEW_BELOW = "new-below";
export const DROP_EVENTS = "events";

/** Target named by an element (the closest [data-window-id],[data-drop] under the pointer):
 * data-window-id → window; data-drop "new" → { kind: "new", place: "strip" };
 * "new-below" → { kind: "new", place: "below" }; "events" → { kind: "events" }; anything else or
 * no element → undefined. */
export function dropTargetOf(
  el: { getAttribute(name: string): string | null } | null | undefined,
): DropTarget | undefined {
  const windowId = el?.getAttribute("data-window-id");
  if (windowId) return { kind: "window", windowId };
  const drop = el?.getAttribute("data-drop");
  if (drop === DROP_NEW) return { kind: "new", place: "strip" };
  if (drop === DROP_NEW_BELOW) return { kind: "new", place: "below" };
  if (drop === DROP_EVENTS) return { kind: "events" };
  return undefined;
}

/** A signal dropped on the strip goes on the events line (design V10): only a signal with states
 * that is not listed yet. */
export function eventsDrop(
  info: SignalInfo | undefined,
  ws: Workspace,
): { ok: true } | { ok: false; reason: "no_states" | "already_listed" } {
  if (info?.states === undefined) return { ok: false, reason: "no_states" };
  if (ws.eventSignals?.includes(info.id)) return { ok: false, reason: "already_listed" };
  return { ok: true };
}

/** A selection dropped on the strip (L5): the IDs whose info has states and that are not listed yet,
 * in order; the others are skipped. */
export function eventsDropMany(
  signalIds: readonly string[],
  infoOf: (id: string) => SignalInfo | undefined,
  ws: Workspace,
): string[] {
  return signalIds.filter((id) => eventsDrop(infoOf(id), ws).ok);
}

/** Pointer movement before a press on a legend grip becomes a drag. */
export const DRAG_THRESHOLD_PX = 4;

/** True when the signal would push a timeseries window past MAX_UNITS; a values window takes any unit (C7). */
function tooManyUnits(
  w: WorkspaceWindow,
  signalId: string,
  unitOf: (signalId: string) => string | undefined,
): boolean {
  return isTimeseries(w) && windowUnits(w, unitOf, signalId).length > MAX_UNITS;
}

/** A window accepts a drop when it is not the source, does not show the signal yet and, if it is a
 * timeseries window, keeps ≤ MAX_UNITS units; "new" always accepts; "events" is eventsDrop's. */
export function canDrop(
  source: DragSource,
  target: DropTarget,
  windows: WorkspaceWindow[],
  unitOf: (signalId: string) => string | undefined,
): boolean {
  if (target.kind === "new") return true;
  if (target.kind === "events") return false;
  if (target.windowId === source.windowId) return false;
  const w = windows.find((x) => x.id === target.windowId);
  if (!w || w.signals.some((s) => s.signalId === source.signalId)) return false;
  return !tooManyUnits(w, source.signalId, unitOf);
}

/** The window.moveSignal command for a drop, copy when altKey or ctrlKey; undefined when !canDrop. */
export function dropCommand(
  source: DragSource,
  target: DropTarget,
  windows: WorkspaceWindow[],
  unitOf: (signalId: string) => string | undefined,
  mods: { altKey: boolean; ctrlKey: boolean },
): CommandInput | undefined {
  if (!canDrop(source, target, windows, unitOf)) return undefined;
  const copy = isCopy(source, mods);
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
  signalId: string; // the pressed row (ghost swatch; single-signal paths)
  /** Set only for a selection of two or more: the selection in list order, including signalId. */
  signalIds?: readonly string[];
}

/** Anything App drags: a legend or values row (D5, C7) or an explorer row. */
export type AnyDragSource = DragSource | ExplorerDragSource;

/** True for a legend or values row (it has a source window). */
export function isLegendSource(source: AnyDragSource): source is DragSource {
  return "windowId" in source;
}

/** Copy mode of a drag from the modifiers of one event of it: Alt or Ctrl on a legend or values
 * row; an explorer drag always adds. */
export function isCopy(
  source: AnyDragSource,
  mods: { altKey: boolean; ctrlKey: boolean },
): boolean {
  return isLegendSource(source) && (mods.altKey || mods.ctrlKey);
}

/** An explorer drop is accepted by a window that does not show the signal yet and, if it is a
 * timeseries window, keeps ≤ MAX_UNITS units (windowUnits with the signal as extra); "new" always
 * accepts; "events" is eventsDrop's. */
export function canAdd(
  signalId: string,
  target: DropTarget,
  windows: WorkspaceWindow[],
  unitOf: (signalId: string) => string | undefined,
): boolean {
  if (target.kind === "new") return true;
  if (target.kind === "events") return false;
  const w = windows.find((x) => x.id === target.windowId);
  if (!w || w.signals.some((s) => s.signalId === signalId)) return false;
  return !tooManyUnits(w, signalId, unitOf);
}

/** A selection drop (L6): "new" always accepts; "events" is eventsDropMany's; a window accepts when
 * it exists and does not show at least one of the signals (units overflow into new windows, D-066). */
export function canAddAny(
  signalIds: readonly string[],
  target: DropTarget,
  windows: WorkspaceWindow[],
): boolean {
  if (target.kind === "new") return true;
  if (target.kind === "events") return false;
  const w = windows.find((x) => x.id === target.windowId);
  return !!w && signalIds.some((id) => !w.signals.some((s) => s.signalId === id));
}

/** Highlight of one window during a drag. */
export type DropState = "source" | "target" | "refused";

/** "source": the row's own window (never for an explorer source); "target": canDrop (row),
 * canAddAny (explorer selection) or canAdd (explorer row); "refused": a timeseries window that does
 * not show the signal but would exceed MAX_UNITS with it, never for a selection; else undefined. */
export function dropStateFor(
  source: AnyDragSource,
  windowId: string,
  windows: WorkspaceWindow[],
  unitOf: (signalId: string) => string | undefined,
): DropState | undefined {
  const target: DropTarget = { kind: "window", windowId };
  if (!isLegendSource(source) && source.signalIds) {
    return canAddAny(source.signalIds, target, windows) ? "target" : undefined;
  }
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
    tooManyUnits(w, source.signalId, unitOf);
  return refusedByUnits ? "refused" : undefined;
}

const GHOST_OFFSET = 12;

/** The drag ghost's viewport position: 12 px right of and below the pointer; where it would cross the
 *  bottom edge it flips above the pointer, and it is clamped to the right and top edges, so its text
 *  stays readable where the user releases (e.g. over "+ New window" at the viewport bottom). */
export function ghostPosition(
  pointer: { x: number; y: number },
  width: number,
  height: number,
  viewWidth: number,
  viewHeight: number,
): { left: number; top: number } {
  const below = pointer.y + GHOST_OFFSET;
  const top = below + height > viewHeight ? pointer.y - GHOST_OFFSET - height : below;
  const left = Math.min(pointer.x + GHOST_OFFSET, viewWidth - width);
  return { left: Math.max(0, left), top: Math.max(0, top) };
}
