/**
 * Every key and mouse gesture of the app (add-guidance H6), the one source of the help panel's Keys
 * tab. `keys` separates alternatives by two spaces; each part is drawn as a key cap.
 */

export type ShortcutGroup =
  | "Anywhere"
  | "Time"
  | "Signal list"
  | "In a plot"
  | "Drag and drop"
  | "Time strip";

export interface KeyProbe {
  key: string;
  shiftKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export interface Shortcut {
  group: ShortcutGroup;
  /** As shown, e.g. "Shift+←  Shift+→". */
  keys: string;
  /** W1 wording, e.g. "Pan by the whole span". */
  action: string;
  /**
   * Keyboard entries only: events the global handlers (navKey, isSearchKey, isSidebarKey,
   * isEventsKey, isHelpKey, caseStepKey) must recognise. Backspace, Esc and the signal list's keys are handled
   * in place (App, drags, explorer field) and carry none.
   */
  probe?: KeyProbe[];
}

/** Group order of the Keys tab. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  "Anywhere",
  "Time",
  "Signal list",
  "In a plot",
  "Drag and drop",
  "Time strip",
];

export const SHORTCUTS: Shortcut[] = [
  { group: "Anywhere", keys: "/", action: "Search signals", probe: [{ key: "/" }] },
  { group: "Anywhere", keys: "s", action: "Show or hide the signal list", probe: [{ key: "s" }] },
  { group: "Anywhere", keys: "e", action: "Events", probe: [{ key: "e" }] },
  { group: "Anywhere", keys: "t", action: "Open the range picker (Go to)", probe: [{ key: "t" }] },
  { group: "Anywhere", keys: "?", action: "Help", probe: [{ key: "?" }] },
  { group: "Anywhere", keys: "Backspace", action: "Back: the previous time range" },
  { group: "Anywhere", keys: "Esc", action: "Cancel a drag" },

  { group: "Time", keys: "+  =", action: "Zoom in", probe: [{ key: "+" }, { key: "=" }] },
  { group: "Time", keys: "-", action: "Zoom out", probe: [{ key: "-" }] },
  {
    group: "Time",
    keys: "←  →",
    action: "Pan by half the span",
    probe: [{ key: "ArrowLeft" }, { key: "ArrowRight" }],
  },
  {
    group: "Time",
    keys: "Shift+←  Shift+→",
    action: "Pan by the whole span",
    probe: [
      { key: "ArrowLeft", shiftKey: true },
      { key: "ArrowRight", shiftKey: true },
    ],
  },
  { group: "Time", keys: "Home", action: "Reset: show all data", probe: [{ key: "Home" }] },
  {
    group: "Time",
    keys: ",  .",
    action: "Previous or next drive",
    probe: [{ key: "," }, { key: "." }],
  },
  {
    group: "Time",
    keys: "p  n",
    action: "Previous or next event: put cursor A on it",
    probe: [{ key: "p" }, { key: "n" }],
  },
  {
    group: "Time",
    keys: "[  ]",
    action: "Previous or next session of the catalog",
    probe: [{ key: "[" }, { key: "]" }],
  },
  {
    group: "Time",
    keys: "Shift+A  Shift+B",
    action: "Bring cursor A or B into view",
    probe: [
      { key: "A", shiftKey: true },
      { key: "B", shiftKey: true },
    ],
  },

  { group: "Signal list", keys: "↑  ↓", action: "Move through the list" },
  { group: "Signal list", keys: "Enter", action: "Add to the Add to target" },
  { group: "Signal list", keys: "Shift+↑  Shift+↓", action: "Extend the selection" },
  { group: "Signal list", keys: "Esc", action: "Clear the search" },
  { group: "Signal list", keys: "Ctrl/Cmd+click", action: "Select or unselect a row" },
  { group: "Signal list", keys: "Shift+click", action: "Select a range of rows" },
  {
    group: "Signal list",
    keys: "Ctrl/Cmd+D",
    action: "Star or unstar the row or the selection",
  },
  { group: "Signal list", keys: "F2", action: "Edit the active computed signal" },
  { group: "Signal list", keys: "Tab", action: "Accept a suggestion in the formula field" },

  { group: "In a plot", keys: "click", action: "Set cursor A" },
  { group: "In a plot", keys: "Shift+click", action: "Set cursor B" },
  { group: "In a plot", keys: "drag", action: "Select a time range to zoom" },
  { group: "In a plot", keys: "double-click", action: "Reset the zoom" },
  { group: "In a plot", keys: "Ctrl+wheel  Shift+wheel", action: "Zoom" },
  { group: "In a plot", keys: "wheel", action: "Scroll the page" },
  { group: "In a plot", keys: "horizontal swipe", action: "Pan" },
  { group: "In a plot", keys: "drag a cursor line", action: "Move that cursor" },
  { group: "In a plot", keys: "drag the corner grip", action: "Resize the window" },

  {
    group: "Drag and drop",
    keys: "drag a signal row",
    action: 'Add it to the window, the TIME strip or "+ New window" it is dropped on',
  },
  {
    group: "Drag and drop",
    keys: "Alt/Ctrl+drop",
    action: "Copy a legend row instead of moving it",
  },

  { group: "Time strip", keys: "click the line", action: "Jump there" },
  { group: "Time strip", keys: "drag", action: "Zoom to the dragged range" },
  { group: "Time strip", keys: "drag the shown range", action: "Pan" },
  { group: "Time strip", keys: "double-click", action: "Show all" },
  { group: "Time strip", keys: "click a drive", action: "Fit the view to that drive" },
];
