// Events list view state per browser (design P1 of improve-events), like the sidebar part
// (layout/sidebar.ts): not in the workspace, no command.

/** List scope: the shown events in the bar target's range, or all of them. */
export type EventsScope = "view" | "all";

export const EVENTS_SCOPE_KEY = "kipscope.eventsScope";
export const EVENTS_REFINE_KEY = "kipscope.eventsRefine";

/** Unknown, missing or throwing storage → "view". */
export function loadEventsScope(storage: Pick<Storage, "getItem"> | undefined): EventsScope {
  try {
    return storage?.getItem(EVENTS_SCOPE_KEY) === "all" ? "all" : "view";
  } catch {
    return "view";
  }
}

/** Never throws. */
export function saveEventsScope(
  storage: Pick<Storage, "setItem"> | undefined,
  scope: EventsScope,
): void {
  try {
    storage?.setItem(EVENTS_SCOPE_KEY, scope);
  } catch {
    // Storage full or blocked: the scope lasts for this page only.
  }
}

/** "open" → true; anything else, missing or throwing → false. */
export function loadRefineOpen(storage: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return storage?.getItem(EVENTS_REFINE_KEY) === "open";
  } catch {
    return false;
  }
}

/** Never throws. */
export function saveRefineOpen(storage: Pick<Storage, "setItem"> | undefined, open: boolean): void {
  try {
    storage?.setItem(EVENTS_REFINE_KEY, open ? "open" : "closed");
  } catch {
    // Storage full or blocked: the state lasts for this page only.
  }
}
