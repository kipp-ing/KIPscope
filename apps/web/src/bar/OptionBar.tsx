import {
  type CommandInput,
  type CommandResult,
  type CursorName,
  type TimeseriesWindow,
  type Workspace,
  windowTitle,
} from "@letsview/shared";
import "./bar.css";
import { defaultCursorTime } from "./bar.ts";

interface OptionBarProps {
  workspace: Workspace;
  /** barTarget(workspace) */
  target: TimeseriesWindow | undefined;
  /** History of the target (shared "*" while linked). */
  canGoBack: boolean;
  onCommand: (command: CommandInput) => Promise<CommandResult>;
  /** App's existing onBack. */
  onBack: (windowId: string) => void;
  /** App: resetSignals(workspace) → extents → setRange on the target. */
  onReset: () => void;
}

/** Sticky bar above the windows (D-023): cursors, link, bar zoom back/reset, new values window. */
export function OptionBar({
  workspace,
  target,
  canGoBack,
  onCommand,
  onBack,
  onReset,
}: OptionBarProps) {
  const { cursors, linkTime } = workspace;
  const toggleCursor = (cursor: CursorName, on: boolean) => {
    if (!on) {
      void onCommand({ type: "cursor.remove", cursor });
      return;
    }
    if (!target) return;
    const range = { from: BigInt(target.range.from), to: BigInt(target.range.to) };
    void onCommand({
      type: "cursor.set",
      cursor,
      t: defaultCursorTime(range, cursor).toString(),
    });
  };
  const cursorToggle = (cursor: CursorName) => (
    <label
      className="toggle"
      title={
        target
          ? `Cursor ${cursor.toUpperCase()} · ${cursor === "a" ? "click" : "Shift+click"} in a plot to place it`
          : "Needs a timeseries window"
      }
    >
      <input
        type="checkbox"
        checked={cursors[cursor] !== undefined}
        disabled={!target}
        onChange={(e) => toggleCursor(cursor, e.target.checked)}
      />
      {cursor.toUpperCase()}
    </label>
  );
  // While unlinked, Back and Reset act on one window; the tooltip names it (design C5).
  const named = (action: string, linked: string) =>
    linkTime ? linked : target ? `${action} · ${windowTitle(target)}` : action;

  return (
    <div className="option-bar">
      {cursorToggle("a")}
      {cursorToggle("b")}
      <label className="toggle" title="Show cursor B and the differences B − A">
        <input
          type="checkbox"
          checked={cursors.diff}
          onChange={(e) => void onCommand({ type: "cursor.setDiff", diff: e.target.checked })}
        />
        Diff
      </label>
      <span className="separator" />
      <label className="toggle" title="While on, zooming one window zooms all windows">
        <input
          type="checkbox"
          checked={linkTime}
          onChange={(e) =>
            void onCommand({ type: "workspace.setLinkTime", linked: e.target.checked })
          }
        />
        Link time axes
      </label>
      <button
        type="button"
        disabled={!target || !canGoBack}
        title={named("Back", "Previous range of all windows")}
        onClick={() => target && onBack(target.id)}
      >
        Back
      </button>
      <button
        type="button"
        disabled={!target}
        title={named("Reset zoom", "Show all signals of all windows")}
        onClick={onReset}
      >
        Reset zoom
      </button>
      <span className="separator" />
      <button
        type="button"
        onClick={() => void onCommand({ type: "window.create", kind: "values" })}
      >
        + Values window
      </button>
    </div>
  );
}
