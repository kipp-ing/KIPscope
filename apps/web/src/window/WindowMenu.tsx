import type { CommandInput, DisplayMode } from "@kipscope/shared";
import { useEffect, useRef, useState } from "react";
import { HINTS } from "../help/hints.ts";

/** One item of the window menu (design DW11). */
export interface MenuItem {
  label: string;
  role: "menuitem" | "menuitemradio" | "menuitemcheckbox";
  checked?: boolean;
  /** Sent on pick; undefined → nothing sent (the checked mode). */
  command?: CommandInput;
  action?: "rename" | "remove";
}

const MODES: [DisplayMode, string][] = [
  ["line", "Line"],
  ["step", "Step"],
  ["markers", "Markers"],
];

/**
 * The window menu's items (workspace-layout "Window menu"): the display modes as radio items and
 * Min/max as a checkbox (timeseries only), then Rename and Remove window.
 */
export function windowMenuItems(
  windowId: string,
  display: { mode: DisplayMode; envelope: boolean } | undefined, // undefined: values window
): MenuItem[] {
  const items: MenuItem[] = [];
  if (display) {
    for (const [mode, label] of MODES) {
      const checked = display.mode === mode;
      items.push({
        label,
        role: "menuitemradio",
        checked,
        ...(checked ? {} : { command: { type: "window.setDisplay", windowId, mode } }),
      });
    }
    items.push({
      label: "Min/max",
      role: "menuitemcheckbox",
      checked: display.envelope,
      command: { type: "window.setDisplay", windowId, envelope: !display.envelope },
    });
  }
  items.push(
    { label: "Rename", role: "menuitem", action: "rename" },
    { label: "Remove window", role: "menuitem", action: "remove" },
  );
  return items;
}

/** Events of one press that follow its pointerdown. */
const PRESS_EVENTS = ["pointerup", "pointercancel", "mousedown", "mouseup", "click"] as const;

/** Longest wait for the press's release; a press held longer reaches the page on release. */
const PRESS_MAX_MS = 1000;

/**
 * Keeps the dblclick that a fast second press makes of the press just stopped from reaching the
 * page (a plot resets its zoom on dblclick). Ends after the next press's release (its click and
 * dblclick follow in the same task) or at a keydown, so a later double-click is never swallowed.
 */
function swallowDblclick(): void {
  let next = false;
  const stop = (e: Event) => e.stopPropagation();
  const down = () => {
    next = true;
  };
  const release = () => {
    if (next) setTimeout(end, 0);
  };
  const end = () => {
    document.removeEventListener("dblclick", stop, true);
    document.removeEventListener("pointerdown", down, true);
    document.removeEventListener("pointerup", release, true);
    document.removeEventListener("pointercancel", release, true);
    document.removeEventListener("keydown", end, true);
  };
  document.addEventListener("dblclick", stop, true);
  document.addEventListener("pointerdown", down, true);
  document.addEventListener("pointerup", release, true);
  document.addEventListener("pointercancel", release, true);
  document.addEventListener("keydown", end, true);
}

/**
 * Keeps the rest of the press whose pointerdown was just stopped from reaching the page: its mouse
 * events and click (a plot places cursor A on mouseup), and the dblclick of a fast second press.
 * Ends after that press's release; if the release never arrives (released outside the browser), at
 * the next pointerdown or keydown or after `PRESS_MAX_MS`, so a click made by the keyboard is never
 * swallowed.
 */
export function swallowPress(): void {
  swallowDblclick();
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    for (const type of PRESS_EVENTS) document.removeEventListener(type, stop, true);
    document.removeEventListener("pointerdown", end, true);
    document.removeEventListener("keydown", end, true);
  };
  function stop(e: Event) {
    e.stopPropagation();
    if (e.type === "click") e.preventDefault();
    // The click, if any, follows the release in the same task.
    if (e.type === "pointerup" || e.type === "pointercancel") setTimeout(end, 0);
  }
  for (const type of PRESS_EVENTS) document.addEventListener(type, stop, true);
  document.addEventListener("pointerdown", end, true);
  document.addEventListener("keydown", end, true);
  const timer = setTimeout(end, PRESS_MAX_MS);
}

/**
 * The window's "⋯" menu (design L4, DW11): `windowMenuItems` in a popover below the button.
 * Choosing an item, Esc or a pointer down outside closes it; only Esc returns the focus to "⋯".
 * A press outside only closes it and reaches nothing else (workspace-layout "Close without a
 * command"): a click into a plot places no cursor.
 * `windowId` and `onCommand` are needed only with `display` (a values window sends no command).
 */
export function WindowMenu({
  windowId = "",
  display,
  onCommand,
  onRename,
  onRemove,
}: {
  windowId?: string;
  display?: { mode: DisplayMode; envelope: boolean };
  onCommand?: (command: CommandInput) => unknown;
  onRename: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>("[role^=menuitem]")?.focus();
    const onDown = (e: PointerEvent) => {
      if (root.current?.contains(e.target as Node)) return;
      e.stopPropagation();
      e.preventDefault();
      swallowPress();
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    // Capture phase: seen before the plot's own pointer handling, which it then never gets.
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (item: MenuItem) => {
    setOpen(false);
    if (item.command) onCommand?.(item.command);
    else if (item.action === "rename") onRename();
    else if (item.action === "remove") onRemove();
  };

  const items = windowMenuItems(windowId, display);
  return (
    <div className="window-menu" ref={root}>
      <button
        type="button"
        ref={button}
        className="window-menu-button"
        aria-label="Window menu"
        title={HINTS.windowMenu}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div className="window-menu-items" role="menu">
          {items.map((item, i) => {
            const props = {
              type: "button" as const,
              // A rule between the display items and Rename.
              className: i > 0 && item.action === "rename" ? "separated" : undefined,
              onClick: () => pick(item),
            };
            // Literal roles, so aria-checked stays with the roles that support it.
            return item.role === "menuitemradio" ? (
              <button key={item.label} {...props} role="menuitemradio" aria-checked={item.checked}>
                {item.label}
              </button>
            ) : item.role === "menuitemcheckbox" ? (
              <button
                key={item.label}
                {...props}
                role="menuitemcheckbox"
                aria-checked={item.checked}
              >
                {item.label}
              </button>
            ) : (
              <button key={item.label} {...props} role="menuitem">
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
