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

/**
 * The window's "⋯" menu (design L4, DW11): `windowMenuItems` in a popover below the button.
 * Choosing an item, Esc or a pointer down outside closes it; only Esc returns the focus to "⋯".
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
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
    };
    // Capture phase: the plot's own pointer handling must not hide the click from us.
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
