import { isTextField } from "../keys.ts";

/** Explorer sidebar (design L1): open at SIDEBAR_WIDTH_PX or collapsed, remembered per browser. */
export type SidebarState = "open" | "collapsed";

export const SIDEBAR_STORAGE_KEY = "kipscope.sidebar";
export const SIDEBAR_WIDTH_PX = 240;

/** Unknown value, missing or throwing storage → "open". */
export function loadSidebar(storage: Pick<Storage, "getItem"> | undefined): SidebarState {
  try {
    return storage?.getItem(SIDEBAR_STORAGE_KEY) === "collapsed" ? "collapsed" : "open";
  } catch {
    return "open";
  }
}

/** Never throws. */
export function saveSidebar(
  storage: Pick<Storage, "setItem"> | undefined,
  state: SidebarState,
): void {
  try {
    storage?.setItem(SIDEBAR_STORAGE_KEY, state);
  } catch {
    // Storage full or blocked: the state lasts for this page only.
  }
}

/**
 * `s` without Ctrl/Meta/Alt while focus is not in a text field or select (isTextField counts
 * SELECT, where letter keys pick options).
 */
export function isSidebarKey(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  focused: Element | null,
): boolean {
  if (e.key !== "s" || e.ctrlKey || e.metaKey || e.altKey) return false;
  return !isTextField(focused);
}

/** What the sidebar shows under its switch (design V11, D-058): the explorer or the events panel. */
export type SidebarPart = "signals" | "events";

export const SIDEBAR_PART_KEY = "kipscope.sidebarPart";

/** Unknown value, missing or throwing storage → "signals". */
export function loadSidebarPart(storage: Pick<Storage, "getItem"> | undefined): SidebarPart {
  try {
    return storage?.getItem(SIDEBAR_PART_KEY) === "events" ? "events" : "signals";
  } catch {
    return "signals";
  }
}

/** Never throws. */
export function saveSidebarPart(
  storage: Pick<Storage, "setItem"> | undefined,
  part: SidebarPart,
): void {
  try {
    storage?.setItem(SIDEBAR_PART_KEY, part);
  } catch {
    // Storage full or blocked: the part lasts for this page only.
  }
}

/** `e` without Ctrl/Meta/Alt while focus is not in a text field or select (like `s` and `/`). */
export function isEventsKey(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean },
  focused: Element | null,
): boolean {
  if (e.key !== "e" || e.ctrlKey || e.metaKey || e.altKey) return false;
  return !isTextField(focused);
}
