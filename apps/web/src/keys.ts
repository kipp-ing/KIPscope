/** Input types that take no typed text; Backspace there is free for the app. */
const NON_TEXT_INPUTS = ["checkbox", "radio", "button", "range"];

/**
 * Backspace stays a text-editing key while a text field has focus. Checks the tag name rather
 * than element classes so it also runs outside a browser.
 */
export function isTextField(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toUpperCase();
  if (tag === "INPUT") return !NON_TEXT_INPUTS.includes((el as HTMLInputElement).type);
  return tag === "TEXTAREA" || tag === "SELECT" || (el as HTMLElement).isContentEditable === true;
}

/** Modifier and key fields of a keyboard event. */
interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
}

/**
 * `/` focuses the search (design E8) unless the focus is in a field that takes typed text. A
 * select takes no text, so it does not keep `/` from the search.
 */
export function isSearchKey(e: KeyLike, focused: Element | null): boolean {
  if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return false;
  return !isTextField(focused) || focused?.tagName.toUpperCase() === "SELECT";
}

/** Navigation keys (design N6): zoom, pan, page, reset and "Go to". */
export type NavKey = "in" | "out" | "left" | "right" | "pageLeft" | "pageRight" | "home" | "goTo";

/**
 * Maps a key to its navigation step, or undefined: nothing in text fields or selects, nothing with
 * Ctrl, Meta or Alt. `+` needs Shift on some layouts, so Shift only matters for the arrows. `s` and
 * `/` stay free (improve-layout, explorer search).
 */
export function navKey(
  e: KeyLike & { shiftKey: boolean },
  focused: Element | null,
): NavKey | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey || isTextField(focused)) return undefined;
  switch (e.key) {
    case "+":
    case "=":
      return "in";
    case "-":
      return "out";
    case "ArrowLeft":
      return e.shiftKey ? "pageLeft" : "left";
    case "ArrowRight":
      return e.shiftKey ? "pageRight" : "right";
    case "Home":
      return "home";
    case "t":
      return "goTo";
    default:
      return undefined;
  }
}

/** Least time between two steps of a held key, in ms (design N6). */
export const NAV_REPEAT_MS = 100;

/**
 * Auto-repeat of a held navigation key (design N6): the first press opens a history entry, repeat
 * events join it and step at most every NAV_REPEAT_MS.
 */
export class NavRepeat {
  private last: number | undefined;

  /** push: first press (new history entry); join: repeat step; skip: repeat within 100 ms. */
  step(repeat: boolean, now: number): "push" | "join" | "skip" {
    // A repeat without a press seen first (key held before the page had focus) opens the entry.
    if (!repeat || this.last === undefined) {
      this.last = now;
      return "push";
    }
    if (now - this.last < NAV_REPEAT_MS) return "skip";
    this.last = now;
    return "join";
  }
}
