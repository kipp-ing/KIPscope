import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { HINTS } from "../help/hints.ts";

/** Three dots (mock Main.dc.html). */
const MORE_ICON = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);

/** Closes the "⋯" menu; `true` also focuses "⋯" (after an action). */
type Close = (refocus?: boolean) => void;

/**
 * What App adds after "⋯" (add-guidance "?", design DW8): `row`, always in the row, never in the
 * menu. `menu` is no longer rendered ("?" is never in "⋯"); it stays optional until App drops it
 * (declutter-workspace task 8.2).
 */
export interface OverflowTail {
  row: ReactNode;
  menu?: (close: Close) => ReactNode;
}

export const OverflowTailContext = createContext<OverflowTail | undefined>(undefined);

/**
 * "⋯" (`More`) near the end of the top row, always shown (design DW8): its menu holds Digits and
 * "+ Values window", nothing else (Share… stays in the row, D-095).
 * Enter, Space or ArrowDown opens it and focuses the first control not `tabindex="-1"` (the
 * checked Digits button); Esc closes it and returns
 * focus to "⋯"; Tab past the last control or a pointer down outside closes it. App's "?"
 * (OverflowTailContext) follows "⋯" in the row.
 */
export function OverflowMenu({
  children,
}: {
  /** The menu's controls; `close(true)` closes it and focuses "⋯" (after an action). */
  children: (close: Close) => ReactNode;
}) {
  const tail = useContext(OverflowTailContext);
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
    panel.current
      ?.querySelector<HTMLElement>("select, button:not([tabindex='-1']), input")
      ?.focus();
    const onOutside = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close(true);
    };
    // Capture phase: the plot's own pointer handling must not hide the click from us.
    document.addEventListener("pointerdown", onOutside, true);
    // Focus moved outside (Tab past the last control).
    document.addEventListener("focusin", onOutside);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("focusin", onOutside);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <>
      <div ref={root} className="overflow-menu">
        <button
          ref={button}
          type="button"
          className="overflow-button"
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={open}
          title={HINTS.more}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" || open) return;
            e.preventDefault();
            setOpen(true);
          }}
        >
          {MORE_ICON}
        </button>
        {open && (
          <div ref={panel} className="overflow-popover">
            {children(close)}
          </div>
        )}
      </div>
      {tail?.row}
    </>
  );
}
