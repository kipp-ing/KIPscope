import {
  type CommandInput,
  type CommandResult,
  type CursorName,
  type Digits,
  type TimeseriesWindow,
  type Workspace,
  windowTitle,
} from "@kipscope/shared";
import { useEffect, useRef, useState } from "react";
import { formatRange } from "../time/axis.ts";
import { type TrackOpen, ViewsMenu } from "../views/ViewsMenu.tsx";
import "./bar.css";
import { defaultCursorTime, SPAN_PRESETS } from "./bar.ts";
import { OverflowMenu } from "./OverflowMenu.tsx";

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
  /** The "Go to" error is void (text edited, target or its range changed): App clears the message. */
  onGoToClear?: () => void;
  /** App: the open notice after the push, or the error of a refused open (add-saved-views V7). */
  onOpened: (result: CommandResult, warnings?: readonly string[]) => void;
  /** App: sends an open as this tab's own (add-saved-views V7 round 3). */
  trackOpen: TrackOpen;
  /** Info notice in the strip ("Link copied", "Saved"). */
  onNotice: (text: string, title?: string) => void;
  /** Error in the strip. */
  onMessage: (text: string) => void;
}

/**
 * Sticky bar above the windows (D-023): Views menu and the open view's title, cursors, link, Go to, span presets, Back, Reset, digits,
 * new values window; on a short row digits, new values window and span move into the "⋯" menu (V7).
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
  onGoToClear,
  onOpened,
  trackOpen,
  onNotice,
  onMessage,
}: OptionBarProps) {
  const { cursors, linkTime } = workspace;
  const digits = workspace.options?.digits ?? 3;
  // The last Enter in "Go to" failed: field marked invalid until the text, the target or its range
  // changes (App shows the message).
  const [goToError, setGoToError] = useState<string | undefined>();
  const [goToText, setGoToText] = useState("");
  const goToRef = useRef<HTMLInputElement>(null);
  // Focus by click selects the text too; the click's mouseup would otherwise drop the selection.
  const selectOnMouseUp = useRef(false);
  const clearGoToError = () => {
    if (goToError === undefined) return;
    setGoToError(undefined);
    onGoToClear?.();
  };
  const clearRef = useRef(clearGoToError);
  clearRef.current = clearGoToError;
  // The target's view changed by other means: an error about the old view is void, and text the
  // user is not editing would be stale, so it shows the new range as the header does.
  const targetId = target?.id;
  const from = target?.range.from;
  const to = target?.range.to;
  useEffect(() => {
    clearRef.current();
    if (targetId === undefined || from === undefined || to === undefined) return;
    if (goToRef.current === document.activeElement) return;
    setGoToText((text) => (text === "" ? text : formatRange(BigInt(from), BigInt(to))));
  }, [targetId, from, to]);
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
      className="toggle pill"
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

  // The overflow items (V7 "Top-row overflow rule"; Span joined, bar.css): in the row, or the same
  // controls in the "⋯" menu below the threshold.
  const spanSelect = (inMenu: boolean, after?: () => void) => (
    <select
      className={inMenu ? undefined : "overflow-item"}
      aria-label="Span"
      value=""
      disabled={!target}
      title={named("Span", "Span around cursor A or the centre, all windows")}
      onChange={(e) => {
        const preset = SPAN_PRESETS.find((p) => p.label === e.target.value);
        // Navigation keys go to the page again, not to the select.
        e.currentTarget.blur();
        after?.();
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
  );
  const digitsSelect = (inMenu: boolean) => (
    <select
      className={inMenu ? undefined : "overflow-item"}
      aria-label="Digits"
      title="Significant digits of all values"
      value={digits}
      onChange={(e) => {
        // Navigation keys go to the page again, not to the select; in the menu, focus stays for
        // Tab to the next control.
        if (!inMenu) e.currentTarget.blur();
        void onCommand({
          type: "workspace.setOptions",
          digits: Number(e.target.value) as Digits,
        });
      }}
    >
      <option value={3}>3 digits</option>
      <option value={4}>4 digits</option>
    </select>
  );
  const newValuesButton = (after?: () => void) => (
    <button
      type="button"
      className={after ? "new-values" : "new-values overflow-item"}
      aria-label="New values window"
      title="New values window"
      onClick={() => {
        void onCommand({ type: "window.create", kind: "values" });
        after?.();
      }}
    >
      + Values<span className="long"> window</span>
    </button>
  );

  return (
    <div className="option-bar">
      <ViewsMenu
        workspace={workspace}
        trackOpen={trackOpen}
        onOpened={onOpened}
        onNotice={onNotice}
        onMessage={onMessage}
      />
      <span className="separator" />
      {cursorToggle("a")}
      {cursorToggle("b")}
      <label className="toggle pill" title="Show the differences B − A (Δ and Δt)">
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
          aria-label="Link time axes"
          checked={linkTime}
          onChange={(e) =>
            void onCommand({ type: "workspace.setLinkTime", linked: e.target.checked })
          }
        />
        Link<span className="long"> time</span> axes
      </label>
      <input
        id="go-to"
        ref={goToRef}
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
        value={goToText}
        onChange={(e) => {
          setGoToText(e.target.value);
          clearGoToError();
        }}
        onFocus={(e) => e.currentTarget.select()}
        onMouseDown={(e) => {
          selectOnMouseUp.current = document.activeElement !== e.currentTarget;
        }}
        onMouseUp={(e) => {
          if (selectOnMouseUp.current) e.preventDefault();
          selectOnMouseUp.current = false;
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const field = e.currentTarget;
          const error = onGoTo(field.value);
          setGoToError(error);
          if (error === undefined) field.select();
        }}
      />
      {spanSelect(false)}
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
      {digitsSelect(false)}
      {newValuesButton()}
      <OverflowMenu>
        {(close) => (
          <>
            {digitsSelect(true)}
            {newValuesButton(() => close(true))}
            {spanSelect(true, close)}
          </>
        )}
      </OverflowMenu>
    </div>
  );
}
