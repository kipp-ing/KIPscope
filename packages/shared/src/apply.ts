import {
  type Command,
  type CommandErrorCode,
  DEFAULT_DISPLAY,
  MAX_SIGNALS,
  type TimeseriesWindow,
  type Workspace,
} from "./workspace.ts";

export interface ApplyContext {
  /** Whether a signal ID exists in the catalog. */
  signalExists(signalId: string): boolean;
}

export type ApplyResult =
  | { ok: true; workspace: Workspace; created?: string }
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

/**
 * Applies one validated command. Pure: returns a new workspace and never mutates the input, so a
 * rejected command leaves the state unchanged and undo can keep previous states.
 */
export function applyCommand(state: Workspace, command: Command, ctx: ApplyContext): ApplyResult {
  const updateWindow = (
    windowId: string,
    update: (w: TimeseriesWindow) => TimeseriesWindow | ApplyResult,
  ): ApplyResult => {
    const index = state.windows.findIndex((w) => w.id === windowId);
    const current = state.windows[index];
    if (!current) return fail("unknown_window", `unknown window: ${windowId}`);
    const next = update(current);
    if ("ok" in next) return next;
    const windows = state.windows.with(index, next);
    return { ok: true, workspace: { ...state, windows } };
  };

  switch (command.type) {
    case "window.create": {
      const invalid = checkRange(command.from, command.to);
      if (invalid) return invalid;
      const id = `w${state.nextId}`;
      const window: TimeseriesWindow = {
        id,
        kind: "timeseries",
        range: { from: command.from, to: command.to },
        display: {
          mode: command.mode ?? DEFAULT_DISPLAY.mode,
          envelope: command.envelope ?? DEFAULT_DISPLAY.envelope,
        },
        signals: [],
      };
      if (command.title !== undefined) window.title = command.title;
      return {
        ok: true,
        workspace: { windows: [...state.windows, window], nextId: state.nextId + 1 },
        created: id,
      };
    }

    case "window.remove": {
      if (!state.windows.some((w) => w.id === command.windowId)) {
        return fail("unknown_window", `unknown window: ${command.windowId}`);
      }
      return {
        ok: true,
        workspace: { ...state, windows: state.windows.filter((w) => w.id !== command.windowId) },
      };
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
      const result = updateWindow(command.windowId, (w) => ({
        ...w,
        signals: [...w.signals, { id, signalId: command.signalId }],
      }));
      if (!result.ok) return result;
      return {
        ok: true,
        workspace: { ...result.workspace, nextId: state.nextId + 1 },
        created: id,
      };
    }

    case "window.removeSignal":
      return updateWindow(command.windowId, (w) => {
        if (!w.signals.some((s) => s.id === command.assignmentId)) {
          return fail("unknown_assignment", `unknown signal assignment: ${command.assignmentId}`);
        }
        return { ...w, signals: w.signals.filter((s) => s.id !== command.assignmentId) };
      });

    case "window.setRange":
      return updateWindow(command.windowId, (w) => {
        return (
          checkRange(command.from, command.to) ?? {
            ...w,
            range: { from: command.from, to: command.to },
          }
        );
      });

    case "window.setDisplay":
      return updateWindow(command.windowId, (w) => ({
        ...w,
        display: {
          mode: command.mode ?? w.display.mode,
          envelope: command.envelope ?? w.display.envelope,
        },
      }));
  }
}
