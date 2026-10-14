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
