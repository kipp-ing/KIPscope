import {
  type CommandInput,
  type CommandResult,
  type CursorName,
  type Digits,
  type Me,
  type TimeseriesWindow,
  type Workspace,
  type WorkspaceSummary,
  windowTitle,
} from "@kipscope/shared";
import { type ReactNode, type Ref, useEffect, useRef } from "react";
import { useLinkedPreview } from "../chart/linkedPreview.ts";
import { HINTS } from "../help/hints.ts";
import type { ScopeKind } from "../time/calendar.ts";
import { DurationTag } from "../time/Duration.tsx";
import { rangeButtonEmpty, startDuration } from "../time/rangeLine.ts";
import { stripDataRef } from "../time/strip.ts";
import { type TrackOpen, ViewsMenu } from "../views/ViewsMenu.tsx";
import { ReadOnlyPill } from "../workspaces/ReadOnlyPill.tsx";
import { ShareMenu } from "../workspaces/ShareMenu.tsx";
import "./bar.css";
import { defaultCursorTime } from "./bar.ts";
import { OverflowMenu } from "./OverflowMenu.tsx";
import { RangePicker } from "./RangePicker.tsx";

type Range = { from: bigint; to: bigint };

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
  /** The "Go to" error is void (text edited, picker closed): App clears the message. */
  onGoToClear?: () => void;
  /** The bar target's server range; undefined without a timeseries window. */
  range: Range | undefined;
  /** The workspace state arrived (else the button shows "…"). */
  rangeLoaded: boolean;
  /** The range picker is open (App, so the navigation keys can wait, design R11). */
  pickerOpen: boolean;
  onPickerOpen: (open: boolean) => void;
  /** The picker's typed "Go to" text, kept by App across opens. */
  typed: string;
  onTyped: (text: string) => void;
  /** One range command for the bar target, one history entry (design R11). */
  onApply: (range: Range) => void;
  /** App: the open notice after the push, or the error of a refused open (add-saved-views V7). */
  onOpened: (result: CommandResult, warnings?: readonly string[]) => void;
  /** App: sends an open as this tab's own (add-saved-views V7 round 3). */
  trackOpen: TrackOpen;
  /** Info notice in the strip ("Link copied", "Saved"). */
  onNotice: (text: string, title?: string) => void;
  /** Error in the strip. */
  onMessage: (text: string) => void;
  /** The page's workspace (add-multiuser M12). */
  workspaceId: string;
  /** The page's workspace from the live channel, with this user's rights, its owner and grant. */
  summary: WorkspaceSummary | undefined;
  /** The signed-in user, read once at start. */
  me: Me | undefined;
}

/** What the picker's whole-span preset names (design R8): the scope, session or vehicle. */
export function scopeKind(ws: Workspace): ScopeKind {
  if (!ws.scope) return "none";
  if (ws.scope.object) return "object";
  return ws.case?.linked ? "session" : "scope";
}

/** The range button's calendar icon (mock GoTo.dc.html). */
const CALENDAR_ICON = (
  <svg
    className="range-icon"
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <line x1="3" y1="10" x2="21" y2="10" />
    <line x1="8" y1="3" x2="8" y2="7" />
    <line x1="16" y1="3" x2="16" y2="7" />
  </svg>
);

/** Inline icon of the top row (mock Main.dc.html, design DW8): stroke in the text colour. */
const icon = (size: number, children: ReactNode) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);

const BACK_ICON = icon(
  15,
  <>
    <polyline points="9 14 4 9 9 4" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </>,
);

/** The fit glyph (D-095): two edges and a double arrow between them, not a fullscreen corner. */
const RESET_ICON = icon(
  15,
  <>
    <line x1="3" y1="5" x2="3" y2="19" />
    <line x1="21" y1="5" x2="21" y2="19" />
    <line x1="7" y1="12" x2="17" y2="12" />
    <polyline points="10 9 7 12 10 15" />
    <polyline points="14 9 17 12 14 15" />
  </>,
);

const LINK_ICON = icon(
  15,
  <>
    <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
    <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
  </>,
);

/**
 * Before the first workspace state the button stands alone in App's row: invisible stand-ins for
 * the Views button (same classes, so the top row's give-way step applies) and the separator keep it
 * at the enabled button's left x ("No reflow"). A view title or the Read-only pill is not known yet.
 */
const PENDING_SLOTS = (
  <>
    <div className="views-menu bar-placeholder" aria-hidden="true">
      <button type="button" className="views-button" tabIndex={-1} disabled>
        <svg className="views-icon" width="12" height="14" aria-hidden="true" />
        <span className="views-label">Views</span>
      </button>
    </div>
    <span className="separator bar-placeholder" />
  </>
);

/**
 * The range button (range-picker "Range button", design R6, D-093, D-095): one fixed 212 px box
 * whatever it shows, start date and time with the duration, or, without a range, "No time window"
 * or "…" (disabled, after PENDING_SLOTS). The start cuts at its end; the duration is never cut.
 * Date and time name the full start, the duration its words, the button only what it does.
 */
export function RangeButton({
  range,
  loaded,
  open = false,
  hint,
  onClick,
  buttonRef,
}: {
  range: Range | undefined;
  /** The workspace state arrived. */
  loaded: boolean;
  open?: boolean;
  /** The button's tooltip, `HINTS.goTo(...)`. */
  hint: string;
  onClick?: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const start = range && startDuration(range.from, range.to);
  return (
    <>
      {!loaded && PENDING_SLOTS}
      <button
        ref={buttonRef}
        type="button"
        className="range-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Go to"
        disabled={!start}
        title={hint}
        onClick={onClick}
      >
        {CALENDAR_ICON}
        <span className="range-text">
          {start ? (
            <>
              <span className="range-date" title={start.full}>
                {start.date}
              </span>{" "}
              <span title={start.full}>{start.time}</span>
            </>
          ) : (
            rangeButtonEmpty(loaded)
          )}
        </span>
        {start && <DurationTag text={start.duration} title={start.durationTip} />}
      </button>
    </>
  );
}

/**
 * The range button and, while open, the range picker under it (design R10, R11). Shows the bar
 * target's range with a linked gesture's preview; subscribes to the preview here so a wheel
 * gesture re-renders only this control, not the bar or App.
 */
function RangeControl({
  workspace,
  range,
  loaded,
  hint,
  open,
  onOpen,
  typed,
  onTyped,
  onGoTo,
  onGoToClear,
  onApply,
}: {
  workspace: Workspace;
  range: Range | undefined;
  loaded: boolean;
  hint: string;
  open: boolean;
  onOpen: (open: boolean) => void;
  typed: string;
  onTyped: (text: string) => void;
  onGoTo: (text: string) => string | undefined;
  onGoToClear: (() => void) | undefined;
  onApply: (range: Range) => void;
}) {
  const shared = useLinkedPreview();
  const shown = workspace.linkTime && shared && range ? shared.range : range;
  const buttonRef = useRef<HTMLButtonElement>(null);
  // Without a timeseries window there is nothing to pick for.
  useEffect(() => {
    if (open && !range) onOpen(false);
  }, [open, range, onOpen]);
  const close = () => {
    onOpen(false);
    onGoToClear?.();
    buttonRef.current?.focus();
  };
  return (
    <span className="range-control">
      <RangeButton
        range={shown}
        loaded={loaded}
        open={open}
        hint={hint}
        buttonRef={buttonRef}
        onClick={() => (open ? close() : onOpen(true))}
      />
      {open && shown && (
        <RangePicker
          range={shown}
          dataRef={stripDataRef(workspace)}
          scope={workspace.scope}
          kind={scopeKind(workspace)}
          typed={typed}
          onTyped={(text) => {
            onTyped(text);
            onGoToClear?.();
          }}
          onGoTo={onGoTo}
          onApply={onApply}
          onClose={close}
        />
      )}
    </span>
  );
}

/**
 * Sticky bar above the windows (D-023, design DW8): Views with the open view's title and the
 * Read-only pill (add-multiuser M12) | the range control (add-range-picker) | Back, Reset and the
 * "Link time axes" toggle as icon buttons | A, B, Diff as toggles, then at the row's end Share… (at
 * every width, D-095) and "⋯" (Digits, "+ Values window"); App's "?" follows "⋯".
 */
export function OptionBar({
  workspace,
  target,
  canGoBack,
  onCommand,
  onBack,
  onReset,
  onGoTo,
  onGoToClear,
  range,
  rangeLoaded,
  pickerOpen,
  onPickerOpen,
  typed,
  onTyped,
  onApply,
  onOpened,
  trackOpen,
  onNotice,
  onMessage,
  workspaceId,
  summary,
  me,
}: OptionBarProps) {
  const { cursors, linkTime } = workspace;
  const digits = workspace.options?.digits ?? 3;
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
  // A, B and Diff as toggle buttons in the one pressed style (design DW8, D-095); Space switches.
  const cursorToggle = (cursor: CursorName) => {
    const on = cursors[cursor] !== undefined;
    return (
      <button
        type="button"
        className="toggle"
        aria-pressed={on}
        disabled={!target}
        title={target ? HINTS.cursor(cursor) : HINTS.cursorDisabled}
        onClick={() => toggleCursor(cursor, !on)}
      >
        {cursor.toUpperCase()}
      </button>
    );
  };
  // While unlinked, the bar's navigation acts on one window; the tooltip names it (design C5).
  const targetTitle = target ? windowTitle(target) : undefined;

  // Digits and "+ Values window" live in the "⋯" menu only (D-092 (7)); Share… stays in the row at
  // every width (D-095).
  const digitsSelect = (
    <select
      aria-label="Digits"
      title={HINTS.digits}
      value={digits}
      onChange={(e) =>
        // Focus stays for Tab to the next control of the menu.
        void onCommand({
          type: "workspace.setOptions",
          digits: Number(e.target.value) as Digits,
        })
      }
    >
      <option value={3}>3 digits</option>
      <option value={4}>4 digits</option>
    </select>
  );
  const newValuesButton = (after: () => void) => (
    <button
      type="button"
      className="new-values"
      aria-label="New values window"
      title={HINTS.valuesWindow}
      onClick={() => {
        void onCommand({ type: "window.create", kind: "values" });
        after();
      }}
    >
      + Values window
    </button>
  );

  return (
    <div className="option-bar">
      <ViewsMenu
        workspace={workspace}
        workspaceId={workspaceId}
        trackOpen={trackOpen}
        onOpened={onOpened}
        onNotice={onNotice}
        onMessage={onMessage}
      />
      <ReadOnlyPill summary={summary} />
      <span className="separator" />
      <RangeControl
        workspace={workspace}
        range={range}
        loaded={rangeLoaded}
        hint={HINTS.goTo(linkTime, targetTitle)}
        open={pickerOpen}
        onOpen={onPickerOpen}
        typed={typed}
        onTyped={onTyped}
        onGoTo={onGoTo}
        onGoToClear={onGoToClear}
        onApply={onApply}
      />
      <button
        type="button"
        className="icon-button"
        aria-label="Back"
        disabled={!target || !canGoBack}
        title={HINTS.back(linkTime, targetTitle, canGoBack)}
        onClick={() => target && onBack(target.id)}
      >
        {BACK_ICON}
      </button>
      <button
        type="button"
        className="icon-button"
        aria-label="Reset"
        disabled={!target}
        title={HINTS.reset(linkTime, targetTitle)}
        onClick={onReset}
      >
        {RESET_ICON}
      </button>
      <button
        type="button"
        className="icon-button toggle"
        aria-label="Link time axes"
        aria-pressed={linkTime}
        title={HINTS.link(linkTime)}
        onClick={() => void onCommand({ type: "workspace.setLinkTime", linked: !linkTime })}
      >
        {LINK_ICON}
      </button>
      <span className="separator" />
      {cursorToggle("a")}
      {cursorToggle("b")}
      <button
        type="button"
        className="toggle"
        aria-pressed={cursors.diff}
        title={HINTS.diff}
        onClick={() => void onCommand({ type: "cursor.setDiff", diff: !cursors.diff })}
      >
        Diff
      </button>
      <span className="bar-spacer" />
      <ShareMenu
        workspace={workspace}
        workspaceId={workspaceId}
        summary={summary}
        me={me}
        onNotice={onNotice}
        onMessage={onMessage}
      />
      <OverflowMenu>
        {(close) => (
          <>
            {digitsSelect}
            {newValuesButton(() => close(true))}
          </>
        )}
      </OverflowMenu>
    </div>
  );
}
