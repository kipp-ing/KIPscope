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
