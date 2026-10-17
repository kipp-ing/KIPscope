import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

/**
 * "⋯" at the end of the top row (add-saved-views V7 "Top-row overflow rule"): shown only below the
 * measured threshold (bar.css), where the in-row overflow items hide; its menu renders the same
 * controls. Enter, Space or ArrowDown opens it and focuses the first control; Esc closes it and
 * returns focus to "⋯"; Tab past the last control, a pointer down outside, or "⋯" hiding closes it.
 */
export function OverflowMenu({
  children,
}: {
  /** The menu's controls; `close(true)` closes it and focuses "⋯" (after an action). */
  children: (close: (refocus?: boolean) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("select, button, input")?.focus();
    const onOutside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close(true);
    };
    // The row grew past the threshold: "⋯" is display: none and the menu closes with it.
    const observer = new ResizeObserver(() => {
      if (button.current && button.current.getClientRects().length === 0) close();
    });
    if (button.current) observer.observe(button.current);
    // Capture phase: the plot's own pointer handling must not hide the click from us.
    document.addEventListener("pointerdown", onOutside, true);
    // Focus moved outside (Tab past the last control).
    document.addEventListener("focusin", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("focusin", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div ref={root} className="overflow-menu">
      <button
        ref={button}
        type="button"
        className="overflow-button"
        aria-label="More controls"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More controls"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" || open) return;
          e.preventDefault();
          setOpen(true);
        }}
      >
        ⋯
      </button>
      {open && (
        <div ref={panel} className="overflow-popover">
          {children(close)}
        </div>
      )}
    </div>
  );
}
