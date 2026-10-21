import type { CaseCatalog, CommandInput, WorkspaceCase, WorkspaceScope } from "@kipscope/shared";
import { type CSSProperties, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useCaseCatalog } from "./catalog.ts";
import {
  alignItems,
  arrowHint,
  CASE_HINTS,
  catalogRows,
  goFirstMatch,
  moreText,
  sessionSlots,
  stepCommand,
} from "./sessionBar.ts";
import "./case.css";

interface SessionBarProps {
  /** undefined while a /open#cases= page waits for its workspace: every slot a skeleton. */
  caseState: WorkspaceCase | undefined;
  /** The workspace's scope: while unlinked the vehicle's extent the bar shows. */
  scope: WorkspaceScope | undefined;
  /** Target index of a step or go on its way (DW4). */
  pending?: number | undefined;
  /** Progress line shown (DW4). */
  progress?: boolean;
  /** Sends one case command; App shows its result in the message line (caseResultEvents). */
  onCommand: (command: CommandInput) => void;
  /** No commands (read-only workspace, a command on its way): every control is disabled. */
  disabled?: boolean;
  /** The open's report text (design X4a, openNoteText), shown in the title slot until dismissed. */
  openNote?: string | undefined;
  /** ✕ on the open note. */
  onDismissNote?: () => void;
}

/** A grey block standing in for a slot's text not known yet (DW3). */
const Skeleton = () => <span className="skeleton" />;

/** Chevron of `‹` (left) or `›` (mock SessionBar.dc.html). */
const chevron = (left: boolean) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <polyline points={left ? "15 6 9 12 15 18" : "9 6 15 12 9 18"} />
  </svg>
);

/**
 * The session bar (case-navigation "Session bar", design DW3): the context row's fixed slots
 * `SESSION ‹ <k> / <n> ▾ › <title> <times> <duration> Unlink`, unlinked `VEHICLE … Link` with the
 * arrows greyed. Every slot's box depends on the row's width only: the title takes the rest and
 * truncates, the label leaves below the compact width (case.css). A step on its way shows its
 * target at once (DW4) with the progress line; texts not known yet are skeletons in their slots.
 * The open note (X4a, DW7) sits in the title slot after the title.
 */
export function SessionBar({
  caseState: c,
  scope,
  pending,
  progress = false,
  onCommand,
  disabled = false,
  openNote,
  onDismissNote,
}: SessionBarProps) {
  const catalog = useCaseCatalog(c?.catalogId);
  const s = sessionSlots(c, scope, catalog, pending);
  // The arrows act from the position shown, the pending target while a step is on its way.
  const shown = c && pending !== undefined ? { ...c, current: pending } : c;
  const arrow = (by: -1 | 1) => {
    const command = stepCommand(shown, by);
    return (
      <button
        type="button"
        className={`session-arrow${shown && !shown.linked ? " unlinked" : ""}`}
        title={shown ? arrowHint(shown, by, catalog) : undefined}
        aria-label={by < 0 ? "Previous session" : "Next session"}
        disabled={disabled || command === undefined}
        onClick={() => command && onCommand(command)}
      >
        {chevron(by < 0)}
      </button>
    );
  };
  const note = openNote !== undefined && (
    <span className="session-open-note" role="status" title={openNote}>
      <span className="session-open-note-text">⚠ {openNote}</span>
      <button
        type="button"
        className="session-open-note-dismiss"
        aria-label="Dismiss"
        title={CASE_HINTS.dismissNote}
        onClick={onDismissNote}
      >
        ✕
      </button>
    </span>
  );
  return (
    <div className="context-row" aria-busy={progress || undefined}>
      <span className="slot-label">{s.label}</span>
      {arrow(-1)}
      <CatalogList
        caseState={shown}
        catalog={catalog}
        position={s.position}
        positionCh={s.positionCh}
        disabled={disabled || !c}
        onCommand={onCommand}
      />
      {arrow(1)}
      <span className="slot-title">
        {s.title === undefined ? (
          <Skeleton />
        ) : (
          <span className="slot-title-text" title={s.titleTooltip}>
            {s.title}
          </span>
        )}
        {note}
      </span>
      <span className="slot-times" title={s.timesTooltip}>
        {s.times === undefined ? (
          <Skeleton />
        ) : (
          <>
            <span className="slot-weekday">{s.weekday}</span> {s.times}
            {s.plusOne && <sup className="slot-plus">+1</sup>}
          </>
        )}
      </span>
      <span className="slot-duration">{s.duration === undefined ? <Skeleton /> : s.duration}</span>
      {c ? (
        <button
          type="button"
          className="slot-action"
          title={s.action === "Unlink" ? CASE_HINTS.unlink : CASE_HINTS.link}
          disabled={disabled}
          onClick={() =>
            onCommand(
              s.action === "Unlink"
                ? { type: "case.unlink" }
                : { type: "case.go", index: c.current },
            )
          }
        >
          {s.action}
        </button>
      ) : (
        <span className="slot-action">
          <Skeleton />
        </span>
      )}
      {progress && <span className="session-progress" aria-hidden="true" />}
    </div>
  );
}

/** A popover's open state, closed by a pointer down outside `root` or Escape (focus back on the button). */
function usePopover(initial = false) {
  const [open, setOpen] = useState(initial);
  const root = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const onOutside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    // Capture phase: the plot's own pointer handling must not hide the click from us.
    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return { open, setOpen, root, button };
}

function Popover({ className, children }: { className: string; children: ReactNode }) {
  return <div className={`session-popover ${className}`}>{children}</div>;
}

/**
 * `<k> / <n> ▾` and its catalog list (K14): a focused filter, one row per matching session up to
 * CASE_LIST_ROWS, the current row marked; Enter goes to the first match, a click to its row. At
 * its foot the `Align` radio group (DW6). The button is as wide as `<n> / <n> ▾` (positionCh).
 * Exported with `defaultOpen` for the markup tests of the open list.
 */
export function CatalogList({
  caseState: c,
  catalog,
  position,
  positionCh,
  disabled = false,
  onCommand,
  defaultOpen = false,
}: {
  caseState: WorkspaceCase | undefined;
  catalog: CaseCatalog | undefined;
  /** `<k> / <n>`; "" → skeleton (sessionSlots). */
  position: string;
  positionCh: number;
  disabled?: boolean;
  onCommand: (command: CommandInput) => void;
  defaultOpen?: boolean;
}) {
  const { open, setOpen, root, button } = usePopover(defaultOpen);
  const [filter, setFilter] = useState("");
  const field = useRef<HTMLInputElement>(null);
  // The list opens to type a filter (K14).
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  const current = c?.current ?? 0;
  const { rows, more } = useMemo(
    () => catalogRows(catalog?.entries ?? [], filter, current),
    [catalog, filter, current],
  );
  const go = (command: CommandInput | undefined) => {
    if (!command) return;
    setOpen(false);
    onCommand(command);
  };
  const origin = catalog?.origin;
  const width = { "--position-ch": positionCh } as CSSProperties;
  return (
    <span className="session-menu" ref={root}>
      <button
        type="button"
        ref={button}
        className="session-position"
        style={width}
        title={CASE_HINTS.list}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {position === "" ? <Skeleton /> : `${position} ▾`}
      </button>
      {open && c && (
        <Popover className="session-list">
          <input
            className="session-filter"
            type="search"
            placeholder="Filter sessions"
            ref={field}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                go(goFirstMatch(rows));
              }
            }}
          />
          {origin?.url && (
            <a className="session-back" href={origin.url} target="_blank" rel="noopener noreferrer">
              Back to {origin.tool ?? "the finder"}
            </a>
          )}
          <div className="session-rows">
            {catalog === undefined && <div className="session-note">Loading the catalog…</div>}
            {rows.map((row) => (
              <button
                key={row.index}
                type="button"
                className={row.current ? "current" : undefined}
                aria-current={row.current || undefined}
                onClick={() => go({ type: "case.go", index: row.index })}
              >
                {row.text}
              </button>
            ))}
            {moreText(more) && <div className="session-note">{moreText(more)}</div>}
          </div>
          <div
            className="session-align"
            role="radiogroup"
            aria-label="Align"
            title={CASE_HINTS.align}
          >
            <span className="session-align-label" aria-hidden="true">
              ALIGN
            </span>
            {alignItems(c.align, catalog?.entries).map((item) => (
              // biome-ignore lint/a11y/useSemanticElements: a segmented control of buttons (DW6), one click sends case.align
              <button
                key={item.label}
                type="button"
                role="radio"
                aria-checked={item.checked}
                title={item.title}
                disabled={item.disabled}
                onClick={() => {
                  if (item.checked) return;
                  go({ type: "case.align", align: item.align });
                }}
              >
                {item.label}
              </button>
            ))}
          </div>
        </Popover>
      )}
    </span>
  );
}
