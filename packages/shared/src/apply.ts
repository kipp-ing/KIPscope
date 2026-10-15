import { TIME_MAX, TIME_MIN, toIso } from "./time.ts";
import {
  type Command,
  type CommandErrorCode,
  DEFAULT_DISPLAY,
  isTimeseries,
  MAX_SIGNALS,
  MAX_UNITS,
  SIGNAL_COLORS,
  type TimeRange,
  type TimeseriesWindow,
  unitKey,
  type ValuesWindow,
  type Workspace,
  type WorkspaceWindow,
  windowUnits,
} from "./workspace.ts";

export interface ApplyContext {
  /** Whether a signal ID exists in the catalog. */
  signalExists(signalId: string): boolean;
  /** Unit of a signal; when absent, the unit limit per window is not checked. */
  unitOf?(signalId: string): string | undefined;
}

export type ApplyResult =
  | {
      ok: true;
      workspace: Workspace;
      created?: string;
      createdWindow?: string;
      removedWindow?: string;
    }
  | { ok: false; code: CommandErrorCode; message: string };

const fail = (code: CommandErrorCode, message: string): ApplyResult => ({
  ok: false,
  code,
  message,
});

function checkRange(from: string, to: string): ApplyResult | undefined {
  return BigInt(to) > BigInt(from) ? undefined : fail("invalid_range", "to must be after from");
}

/** Distinct signal IDs across all windows. */
export function distinctSignals(workspace: Workspace): Set<string> {
  return new Set(workspace.windows.flatMap((w) => w.signals.map((s) => s.signalId)));
}

/** Palette index used by the fewest signals in `colors`; lowest index on ties. */
function leastUsedColor(colors: Record<string, number>): number {
  const counts = SIGNAL_COLORS.map(() => 0);
  for (const index of Object.values(colors)) counts[index] = (counts[index] ?? 0) + 1;
  return counts.indexOf(Math.min(...counts));
}

/** Drops colour entries of signals that are in no window. */
function pruneColors(workspace: Workspace): Workspace {
  const signals = distinctSignals(workspace);
  const colors = Object.fromEntries(
    Object.entries(workspace.colors).filter(([signalId]) => signals.has(signalId)),
  );
  return { ...workspace, colors };
}

/** Range of `lastZoomed`, else of the first timeseries window. */
function referenceRange(state: Workspace): TimeRange | undefined {
  const timeseries = state.windows.filter(isTimeseries);
  return (timeseries.find((w) => w.id === state.lastZoomed) ?? timeseries[0])?.range;
}

/** Gives every timeseries window `range`; values windows have none. */
function linkRange(windows: WorkspaceWindow[], range: TimeRange): WorkspaceWindow[] {
  return windows.map((w) => (isTimeseries(w) ? { ...w, range } : w));
}

/**
 * `too_many_units` if adding `signalId` to timeseries window `w` would exceed MAX_UNITS;
 * unchecked without `unitOf` and for values windows.
 */
function checkUnits(
  w: WorkspaceWindow,
  signalId: string,
  ctx: ApplyContext,
): ApplyResult | undefined {
  const unitOf = ctx.unitOf?.bind(ctx);
  if (!unitOf || !isTimeseries(w) || windowUnits(w, unitOf, signalId).length <= MAX_UNITS)
    return undefined;
  const names = new Map<string, string>();
  for (const s of w.signals) {
    const unit = unitOf(s.signalId)?.trim();
    const key = unitKey(s.signalId, unit);
    if (!names.has(key)) names.set(key, unit || `${s.signalId} (no unit)`);
  }
  return fail(
    "too_many_units",
    `a window shows at most ${MAX_UNITS} units (has: ${[...names.values()].join(", ")})`,
  );
}

/**
 * Applies one validated command. Pure: returns a new workspace and never mutates the input, so a
 * rejected command leaves the state unchanged and undo can keep previous states.
 */
export function applyCommand(state: Workspace, command: Command, ctx: ApplyContext): ApplyResult {
  const updateWindow = (
    windowId: string,
    update: (w: WorkspaceWindow) => WorkspaceWindow | ApplyResult,
  ): ApplyResult => {
    const index = state.windows.findIndex((w) => w.id === windowId);
    const current = state.windows[index];
    if (!current) return fail("unknown_window", `unknown window: ${windowId}`);
    const next = update(current);
    if ("ok" in next) return next;
    const windows = state.windows.with(index, next);
    return { ok: true, workspace: { ...state, windows } };
  };

  const notOnValues = (w: ValuesWindow): ApplyResult =>
    fail("invalid_command", `${command.type} does not apply to values window ${w.id}`);

  switch (command.type) {
    case "window.create": {
      const id = `w${state.nextId}`;
      if (command.kind === "values") {
        const window: ValuesWindow = {
          id,
          kind: "values",
          mode: command.mode === "step" ? "step" : "line",
          signals: [],
        };
        if (command.title !== undefined) window.title = command.title;
        const workspace = {
          ...state,
          windows: [...state.windows, window],
          nextId: state.nextId + 1,
        };
        return { ok: true, workspace, created: id };
      }
      let range: TimeRange;
      const hasRange = command.from !== undefined && command.to !== undefined;
      if (command.from !== undefined && command.to !== undefined) {
        const invalid = checkRange(command.from, command.to);
        if (invalid) return invalid;
        range = { from: command.from, to: command.to };
      } else {
        const shared = state.linkTime ? state.windows.find(isTimeseries)?.range : undefined;
        if (!shared) return fail("invalid_range", "from and to are required");
        range = shared;
      }
      const window: TimeseriesWindow = {
        id,
        kind: "timeseries",
        range,
        display: {
          mode: command.mode ?? DEFAULT_DISPLAY.mode,
          envelope: command.envelope ?? DEFAULT_DISPLAY.envelope,
        },
        signals: [],
      };
      if (command.title !== undefined) window.title = command.title;
      const existing = hasRange && state.linkTime ? linkRange(state.windows, range) : state.windows;
      const workspace: Workspace = {
        ...state,
        windows: [...existing, window],
        nextId: state.nextId + 1,
      };
      if (hasRange) workspace.lastZoomed = id;
      return { ok: true, workspace, created: id };
    }

    case "window.remove": {
      if (!state.windows.some((w) => w.id === command.windowId)) {
        return fail("unknown_window", `unknown window: ${command.windowId}`);
      }
      const workspace = pruneColors({
        ...state,
        windows: state.windows.filter((w) => w.id !== command.windowId),
      });
      if (workspace.lastZoomed === command.windowId) delete workspace.lastZoomed;
      return { ok: true, workspace };
    }

    case "window.addSignal": {
      if (!ctx.signalExists(command.signalId)) {
        return fail("unknown_signal", `unknown signal: ${command.signalId}`);
      }
      const signals = distinctSignals(state);
      if (!signals.has(command.signalId) && signals.size >= MAX_SIGNALS) {
        return fail("signal_limit", `at most ${MAX_SIGNALS} distinct signals per workspace`);
      }
      const id = `a${state.nextId}`;
      const result = updateWindow(command.windowId, (w) => {
        if (w.signals.some((s) => s.signalId === command.signalId)) {
          return fail(
            "already_in_window",
            `window ${w.id} already shows signal ${command.signalId}`,
          );
        }
        return (
          checkUnits(w, command.signalId, ctx) ?? {
            ...w,
            signals: [...w.signals, { id, signalId: command.signalId }],
          }
        );
      });
      if (!result.ok) return result;
      const colors =
        command.signalId in state.colors
          ? state.colors
          : { ...state.colors, [command.signalId]: leastUsedColor(state.colors) };
      return {
        ok: true,
        workspace: { ...result.workspace, nextId: state.nextId + 1, colors },
        created: id,
      };
    }

    case "window.removeSignal": {
      const result = updateWindow(command.windowId, (w) => {
        if (!w.signals.some((s) => s.id === command.assignmentId)) {
          return fail("unknown_assignment", `unknown signal assignment: ${command.assignmentId}`);
        }
        return { ...w, signals: w.signals.filter((s) => s.id !== command.assignmentId) };
      });
      return result.ok ? { ok: true, workspace: pruneColors(result.workspace) } : result;
    }

    case "window.moveSignal": {
      const source = state.windows.find((w) => w.id === command.windowId);
      if (!source) return fail("unknown_window", `unknown window: ${command.windowId}`);
      const assignment = source.signals.find((s) => s.id === command.assignmentId);
      if (!assignment) {
        return fail("unknown_assignment", `unknown signal assignment: ${command.assignmentId}`);
      }
      let nextId = state.nextId;
      let windows = state.windows;
      let targetId: string;
      let createdWindow: string | undefined;
      if (command.targetWindowId === undefined) {
        let window: TimeseriesWindow;
        if (isTimeseries(source)) {
          window = {
            id: `w${nextId}`,
            kind: "timeseries",
            range: source.range,
            display: { ...source.display },
            signals: [],
          };
          if (source.height !== undefined) window.height = source.height;
        } else {
          const range = referenceRange(state);
          if (!range) {
            return fail(
              "invalid_range",
              "no timeseries window to take the new window's range from",
            );
          }
          window = {
            id: `w${nextId}`,
            kind: "timeseries",
            range,
            display: { ...DEFAULT_DISPLAY },
            signals: [],
          };
        }
        targetId = window.id;
        createdWindow = targetId;
        nextId++;
        windows = [...windows, window];
      } else {
        const target = state.windows.find((w) => w.id === command.targetWindowId);
        if (!target) return fail("unknown_window", `unknown window: ${command.targetWindowId}`);
        if (target.signals.some((s) => s.signalId === assignment.signalId)) {
          return fail(
            "already_in_window",
            `window ${target.id} already shows signal ${assignment.signalId}`,
          );
        }
        const tooMany = checkUnits(target, assignment.signalId, ctx);
        if (tooMany) return tooMany;
        targetId = target.id;
      }
      const created = command.copy ? `a${nextId++}` : undefined;
      const placed = created ? { id: created, signalId: assignment.signalId } : assignment;
      windows = windows.map((w) => {
        if (w.id === targetId) return { ...w, signals: [...w.signals, placed] };
        if (w.id === source.id && !command.copy) {
          return { ...w, signals: w.signals.filter((s) => s.id !== assignment.id) };
        }
        return w;
      });
      let workspace: Workspace = { ...state, windows, nextId };
      // A move that empties its source removes it like window.remove (L7); a copy never does.
      const emptied =
        !command.copy && windows.find((w) => w.id === source.id)?.signals.length === 0;
      if (emptied) {
        workspace = pruneColors({
          ...workspace,
          windows: windows.filter((w) => w.id !== source.id),
        });
        if (workspace.lastZoomed === source.id) delete workspace.lastZoomed;
      }
      return {
        ok: true,
        workspace,
        ...(created && { created }),
        ...(createdWindow && { createdWindow }),
        ...(emptied && { removedWindow: source.id }),
      };
    }

    case "window.setRange": {
      const target = state.windows.find((w) => w.id === command.windowId);
      if (!target) return fail("unknown_window", `unknown window: ${command.windowId}`);
      if (!isTimeseries(target)) return notOnValues(target);
      const invalid = checkRange(command.from, command.to);
      if (invalid) return invalid;
      const range = { from: command.from, to: command.to };
      const windows = state.linkTime
        ? linkRange(state.windows, range)
        : state.windows.with(state.windows.indexOf(target), { ...target, range });
      return { ok: true, workspace: { ...state, windows, lastZoomed: target.id } };
    }

    case "workspace.setLinkTime": {
      if (!command.linked) return { ok: true, workspace: { ...state, linkTime: false } };
      const reference = referenceRange(state);
      const windows = reference ? linkRange(state.windows, reference) : state.windows;
      return { ok: true, workspace: { ...state, windows, linkTime: true } };
    }

    case "window.rename":
      return updateWindow(command.windowId, (w) => {
        const title = command.title.trim();
        if (title) return { ...w, title };
        const { title: _removed, ...rest } = w;
        return rest;
      });

    case "window.setHeight":
      return updateWindow(command.windowId, (w) =>
        isTimeseries(w) ? { ...w, height: command.height } : notOnValues(w),
      );

    case "window.setDisplay":
      return updateWindow(command.windowId, (w) => {
        if (!isTimeseries(w)) {
          if (command.envelope !== undefined || command.mode === "markers") {
            return fail("invalid_command", `values window ${w.id} takes mode line or step only`);
          }
          return command.mode ? { ...w, mode: command.mode } : w;
        }
        return {
          ...w,
          display: {
            mode: command.mode ?? w.display.mode,
            envelope: command.envelope ?? w.display.envelope,
          },
        };
      });

    case "cursor.set":
      return {
        ok: true,
        workspace: { ...state, cursors: { ...state.cursors, [command.cursor]: command.t } },
      };

    case "cursor.move": {
      const current = state.cursors[command.cursor];
      if (current === undefined) {
        return fail("cursor_off", `cursor ${command.cursor.toUpperCase()} is off`);
      }
      const t = BigInt(current) + BigInt(command.by);
      if (t < TIME_MIN || t > TIME_MAX) {
        return fail("invalid_command", `time outside ${toIso(TIME_MIN)} … ${toIso(TIME_MAX)}`);
      }
      return {
        ok: true,
        workspace: { ...state, cursors: { ...state.cursors, [command.cursor]: t.toString() } },
      };
    }

    case "cursor.remove": {
      const { [command.cursor]: _removed, ...cursors } = state.cursors;
      return { ok: true, workspace: { ...state, cursors } };
    }

    case "cursor.setDiff":
      return {
        ok: true,
        workspace: { ...state, cursors: { ...state.cursors, diff: command.diff } },
      };

    case "workspace.setOptions": {
      const options = { ...state.options };
      if (command.digits !== undefined) options.digits = command.digits;
      return { ok: true, workspace: { ...state, options } };
    }
  }
}
