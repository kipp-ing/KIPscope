/** How long a revealed window carries `data-flash` (add-guidance H3, S2), in ms. */
export const FLASH_MS = 1200;

/** The part of an element `markTarget` reads; a fake in tests. */
interface ClickTarget {
  closest(selector: string): { getAttribute(name: string): string | null } | null;
}

/**
 * The window a click ended in (add-guidance H1): the `data-window-id` of the nearest
 * `[data-window-id]` ancestor, or undefined outside any window.
 */
export function markTarget(target: ClickTarget | null): string | undefined {
  return target?.closest("[data-window-id]")?.getAttribute("data-window-id") ?? undefined;
}

/** A vertical extent in viewport pixels. */
interface Span {
  top: number;
  bottom: number;
}

/**
 * Scroll delta for `<main>` that shows a window fully between the top row and the list's bottom
 * (add-guidance H3): 0 when it is inside the view; its top right below the top row when it is
 * taller than the view or lies above it; else its bottom at the view's bottom.
 */
export function revealDelta(win: Span, view: Span): number {
  if (view.top <= win.top && win.bottom <= view.bottom) return 0;
  if (win.bottom - win.top > view.bottom - view.top || win.top < view.top) {
    return win.top - view.top;
  }
  return win.bottom - view.bottom;
}
