import type { CaseCatalog, CommandInput, WorkspaceCase, WorkspaceScope } from "@kipscope/shared";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useCaseCatalog } from "./catalog.ts";
import {
  alignItems,
  alignModeText,
  arrowHint,
  CASE_HINTS,
  catalogRows,
  goFirstMatch,
  moreText,
  sessionBarText,
  stepCommand,
} from "./sessionBar.ts";
import "./case.css";

interface Props {
  /** `workspace.case`. */
  caseState: WorkspaceCase;
  /** The workspace's scope: while unlinked the vehicle's extent the bar shows. */
  scope: WorkspaceScope | undefined;
  /** Sends one case command; App shows its result in the message line (caseResultEvents). */
  onCommand: (command: CommandInput) => void;
  /** No commands (read-only workspace, a command on its way): every control is disabled. */
  disabled?: boolean;
}

/**
 * The session bar (add-case-open K14), in the strip head instead of the scope head while a
 * catalog is open. Linked: `SESSION ‹ <session> › <k> / <n> ▾ Unlink Align: <mode> ▾`; unlinked:
 * `VEHICLE ‹ › <vehicle> Link` with the arrows greyed. One line; the text truncates first.
 */
export function SessionBar({ caseState: c, scope, onCommand, disabled = false }: Props) {
  const catalog = useCaseCatalog(c.catalogId);
  const bar = sessionBarText(c, scope, catalog?.origin);
  const arrow = (by: -1 | 1) => {
    const command = stepCommand(c, by);
    return (
      <button
        type="button"
        className={`session-arrow${c.linked ? "" : " unlinked"}`}
        title={arrowHint(c, by, catalog)}
        aria-label={by < 0 ? "Previous session" : "Next session"}
        disabled={disabled || command === undefined}
        onClick={() => command && onCommand(command)}
      >
        {by < 0 ? "‹" : "›"}
      </button>
    );
  };
  return (
    <span className="session-bar">
      <span className="section-label">{bar.label}</span>
      {arrow(-1)}
      {c.linked ? (
        <>
          <span className="session-text" title={bar.tooltip}>
            {bar.text}
          </span>
          {arrow(1)}
          <CatalogList
            caseState={c}
            catalog={catalog}
            position={bar.position}
            disabled={disabled}
            onCommand={onCommand}
          />
          <button
            type="button"
            className="time-strip-button"
            title={CASE_HINTS.unlink}
            disabled={disabled}
            onClick={() => onCommand({ type: "case.unlink" })}
          >
            Unlink
          </button>
          <AlignMenu caseState={c} catalog={catalog} disabled={disabled} onCommand={onCommand} />
        </>
      ) : (
        <>
          {arrow(1)}
          <span className="session-text" title={bar.tooltip}>
            {bar.text}
          </span>
          <button
            type="button"
            className="time-strip-button"
            title={CASE_HINTS.link}
            disabled={disabled}
            onClick={() => onCommand({ type: "case.go", index: c.current })}
          >
            Link
          </button>
        </>
      )}
    </span>
  );
}

/** A popover's open state, closed by a pointer down outside `root` or Escape (focus back on the button). */
function usePopover() {
  const [open, setOpen] = useState(false);
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
 * CASE_LIST_ROWS, the current row marked; Enter goes to the first match, a click to its row.
 */
function CatalogList({
  caseState: c,
  catalog,
  position,
  disabled,
  onCommand,
}: {
  caseState: WorkspaceCase;
  catalog: CaseCatalog | undefined;
  position: string;
  disabled: boolean;
  onCommand: (command: CommandInput) => void;
}) {
  const { open, setOpen, root, button } = usePopover();
  const [filter, setFilter] = useState("");
  const field = useRef<HTMLInputElement>(null);
  // The list opens to type a filter (K14).
  useEffect(() => {
    if (open) field.current?.focus();
  }, [open]);
  const { rows, more } = useMemo(
    () => catalogRows(catalog?.entries ?? [], filter, c.current),
    [catalog, filter, c.current],
  );
  const go = (command: CommandInput | undefined) => {
    if (!command) return;
    setOpen(false);
    onCommand(command);
  };
  const origin = catalog?.origin;
  return (
    <span className="session-menu" ref={root}>
      <button
        type="button"
        ref={button}
        className="time-strip-button session-position"
        title={CASE_HINTS.list}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        {position} ▾
      </button>
      {open && (
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
        </Popover>
      )}
    </span>
  );
}

/** `Align: <mode> ▾` and its menu (K14): start, end, anchor, and the event in event mode. */
function AlignMenu({
  caseState: c,
  catalog,
  disabled,
  onCommand,
}: {
  caseState: WorkspaceCase;
  catalog: CaseCatalog | undefined;
  disabled: boolean;
  onCommand: (command: CommandInput) => void;
}) {
  const { open, setOpen, root, button } = usePopover();
  return (
    <span className="session-menu" ref={root}>
      <button
        type="button"
        ref={button}
        className="time-strip-button"
        title={CASE_HINTS.align}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        Align: {alignModeText(c.align)} ▾
      </button>
      {open && (
        <Popover className="session-align">
          {alignItems(c.align, catalog?.entries).map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitemradio"
              aria-checked={item.checked}
              title={item.title}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                if (!item.checked) onCommand({ type: "case.align", align: item.align });
              }}
            >
              {item.checked ? "✓ " : ""}
              {item.label}
            </button>
          ))}
        </Popover>
      )}
    </span>
  );
}
