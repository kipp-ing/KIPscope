import type { CommandInput, WorkspaceCase } from "@kipscope/shared";
import { stepCommand } from "./case/sessionBar.ts";

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

/**
 * `?` opens or closes the help panel (add-guidance H7) without Ctrl, Meta or Alt, outside text
 * fields and selects; Shift is part of `?` on most layouts, so it does not matter.
 */
export function isHelpKey(e: KeyLike, focused: Element | null): boolean {
  if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey) return false;
  return !isTextField(focused);
}

/**
 * `Ctrl+D`, on macOS `Cmd+D`, stars the active row or the selection (add-favourites F8): `d` or
 * `D` with the platform modifier, without Alt or Shift. The explorer search handles it in place.
 */
export function isStarKey(e: KeyLike & { shiftKey: boolean }, mac: boolean): boolean {
  if (e.key !== "d" && e.key !== "D") return false;
  if (e.altKey || e.shiftKey) return false;
  return mac ? e.metaKey : e.ctrlKey;
}

/**
 * `F2` without any modifier opens the editor of the active computed row (add-computed-signals
 * C12). The explorer search handles it in place.
 */
export function isEditKey(e: KeyLike & { shiftKey: boolean }): boolean {
  return e.key === "F2" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
}

/**
 * Navigation keys (design N6): zoom, pan, page, reset, the range picker (`goTo` opens it,
 * add-range-picker R11), the strip's drives (S9), its events (improve-events P7) and a cursor
 * brought into view (declutter-workspace DW23).
 */
export type NavKey =
  | "in"
  | "out"
  | "left"
  | "right"
  | "pageLeft"
  | "pageRight"
  | "home"
  | "goTo"
  | "prevDrive"
  | "nextDrive"
  | "prevEvent"
  | "nextEvent"
  | "cursorA"
  | "cursorB";

/**
 * Maps a key to its navigation step, or undefined: nothing in text fields or selects, nothing with
 * Ctrl, Meta or Alt, nothing while the range picker is open (its day cells are buttons, so focus
 * alone does not tell). `+` needs Shift on some layouts, so Shift only matters for the arrows and
 * A/B (lower-case `a` and `b` stay unbound). `s`, `e` and `/` stay free (sidebar toggle, events
 * panel, explorer search).
 */
export function navKey(
  e: KeyLike & { shiftKey: boolean },
  focused: Element | null,
  pickerOpen = false,
): NavKey | undefined {
  if (pickerOpen || e.ctrlKey || e.metaKey || e.altKey || isTextField(focused)) return undefined;
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
    case ",":
      return "prevDrive";
    case ".":
      return "nextDrive";
    case "p":
      return "prevEvent";
    case "n":
      return "nextEvent";
    case "A":
      return e.shiftKey ? "cursorA" : undefined;
    case "B":
      return e.shiftKey ? "cursorB" : undefined;
    default:
      return undefined;
  }
}

/**
 * `[` (-1) and `]` (1), the catalog keys (add-case-open K14), outside text fields and selects,
 * without Ctrl, Meta or Alt; else undefined.
 */
export function caseKey(e: KeyLike, focused: Element | null): -1 | 1 | undefined {
  if (e.ctrlKey || e.metaKey || e.altKey || isTextField(focused)) return undefined;
  return e.key === "[" ? -1 : e.key === "]" ? 1 : undefined;
}

/**
 * The step a catalog key sends (K14): only while linked and not at that end; undefined sends
 * nothing.
 */
export function caseStepKey(
  e: KeyLike,
  focused: Element | null,
  c: WorkspaceCase | undefined,
): CommandInput | undefined {
  const by = caseKey(e, focused);
  return by === undefined ? undefined : stepCommand(c, by);
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
