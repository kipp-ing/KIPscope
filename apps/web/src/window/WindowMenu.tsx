import { useEffect, useRef, useState } from "react";

/**
 * The window's "⋯" menu (design L4): "Rename" and "Remove window" in a popover below the button.
 * Choosing an item, Esc or a pointer down outside closes it; only Esc returns the focus to "⋯".
 */
export function WindowMenu({ onRename, onRemove }: { onRename: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
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

  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <div className="window-menu" ref={root}>
      <button
        type="button"
        ref={button}
        className="window-menu-button"
        aria-label="Window menu"
        title="Window menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div className="window-menu-items" role="menu">
          <button type="button" role="menuitem" onClick={() => pick(onRename)}>
            Rename
          </button>
          <button type="button" role="menuitem" onClick={() => pick(onRemove)}>
            Remove window
          </button>
        </div>
      )}
    </div>
  );
}
