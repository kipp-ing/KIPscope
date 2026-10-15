import {
  type CommandInput,
  type CommandResult,
  type CursorName,
  type Digits,
  type TimeseriesWindow,
  type Workspace,
  windowTitle,
} from "@letsview/shared";
import { useState } from "react";
import "./bar.css";
import { defaultCursorTime, SPAN_PRESETS } from "./bar.ts";

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
  /** Resolves and applies "Go to" text; returns the error message, or undefined when applied. */
  onGoTo: (text: string) => string | undefined;
  /** A span preset in ns, centred on the navigation anchor. */
  onSpan: (span: bigint) => void;
}

/**
 * Sticky bar above the windows (D-023): cursors, link, Go to, span presets, Back, Reset, digits,
 * new values window.
 */
export function OptionBar({
  workspace,
  target,
  canGoBack,
  onCommand,
  onBack,
  onReset,
  onGoTo,
  onSpan,
}: OptionBarProps) {
  const { cursors, linkTime } = workspace;
  const digits = workspace.options?.digits ?? 3;
  // The last Enter in "Go to" failed: field marked invalid until the text changes (App shows the message).
  const [goToError, setGoToError] = useState<string | undefined>();
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
  // While unlinked, the bar's navigation acts on one window; the tooltip names it (design C5).
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
      <input
        id="go-to"
        className={`go-to${goToError ? " invalid" : ""}`}
        type="text"
        placeholder="Go to"
        aria-label="Go to"
        aria-invalid={goToError !== undefined}
        disabled={!target}
        title={[
          goToError,
          named(
            "Go to",
            "Go to a time or range in all windows: 15:08, 15:07 .. 15:09, 1h, +10min · t",
          ),
        ]
          .filter(Boolean)
          .join("\n")}
        onChange={() => setGoToError(undefined)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const field = e.currentTarget;
          const error = onGoTo(field.value);
          setGoToError(error);
          if (error === undefined) field.select();
        }}
      />
      <select
        aria-label="Span"
        value=""
        disabled={!target}
        title={named("Span", "Span around cursor A or the centre, all windows")}
        onChange={(e) => {
          const preset = SPAN_PRESETS.find((p) => p.label === e.target.value);
          if (preset) onSpan(preset.ns);
        }}
      >
        <option value="" disabled>
          Span
        </option>
        {SPAN_PRESETS.map((p) => (
          <option key={p.label} value={p.label}>
            {p.label}
          </option>
        ))}
      </select>
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
        title={named("Reset", "Show all signals of all windows")}
        onClick={onReset}
      >
        Reset
      </button>
      <span className="separator" />
      <select
        aria-label="Digits"
        title="Significant digits of all values"
        value={digits}
        onChange={(e) =>
          void onCommand({
            type: "workspace.setOptions",
            digits: Number(e.target.value) as Digits,
          })
        }
      >
        <option value={3}>3 digits</option>
        <option value={4}>4 digits</option>
      </select>
      <button
        type="button"
        onClick={() => void onCommand({ type: "window.create", kind: "values" })}
      >
        + Values window
      </button>
    </div>
  );
}
