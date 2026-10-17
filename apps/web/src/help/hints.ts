/**
 * Every tooltip of the app (add-guidance design H5). Wording rule W1: `<Name>: <what it does>`,
 * optionally ` · <key or gesture>`; sentence case, no closing period, at most 140 characters;
 * names as on screen, keys as in `shortcuts.ts`. Components take every `title` from here.
 */

type Linked = boolean;

/** Unlinked, the top row acts on one window and names it (design C5). */
const one = (linked: Linked, title: string | undefined): title is string =>
  !linked && title !== undefined;

export const HINTS = {
  sidebarToggle: (open: boolean) =>
    open ? "Signals: hide the signal list · s" : "Signals: show the signal list · s",
  tabSignals: "Signals: search and add signals · /",
  tabEvents: "Events: faults and state changes, with a filter · e",
  search: "Search: name, description or unit; parts of words match · /",
  target:
    "Add to: where + and Enter put signals. Click a window to choose it; New window makes one",
  addButton: (target: string | undefined) =>
    target === undefined ? "Add to new window" : `Add to ${target}`,
  cursor: (c: "a" | "b") =>
    c === "a"
      ? "Cursor A: click in a plot to place it, drag its line to move it"
      : "Cursor B: Shift+click in a plot to place it, drag its line to move it",
  cursorDisabled: "Cursors need a timeseries window",
  diff: "Diff: show B − A (Δ) and the time between them (Δt)",
  link: "Link time axes: on, zooming or panning one window moves all windows; off, each keeps its own range",
  goTo: (linked: Linked, title?: string) =>
    one(linked, title)
      ? `Go to: a time or range in ${title} · t`
      : "Go to: a time or range in all windows, e.g. 15:08, 15:07 .. 15:09, 1h, +10min · t",
  span: (linked: Linked, title?: string) =>
    `Span: show this much time around cursor A, or the centre, in ${one(linked, title) ? title : "all windows"}`,
  back: (linked: Linked, title: string | undefined, can: boolean) =>
    can
      ? `Back: the previous time range of ${one(linked, title) ? title : "all windows"} · Backspace`
      : "Back: no earlier time range yet",
  reset: (linked: Linked, title?: string) =>
    `Reset: show all data of every signal in ${one(linked, title) ? title : "all windows"} · Home`,
  digits: "Digits: significant digits of all values (3 or 4)",
  valuesWindow:
    "+ Values window: a table of values at cursors A and B; add signals as to any window",
  help: "Help: manual and keyboard shortcuts · ?",
  windowHeader: (marked: boolean) =>
    marked
      ? "Add to target: + and Enter in the signal list add here"
      : "Click anywhere in this window to make it the Add to target",
  windowTitle: (title: string) => `${title} · Double-click to rename`,
  badge: (kind: "raw" | "agg" | "part", width?: string) =>
    kind === "raw"
      ? "raw: every recorded sample is drawn"
      : kind === "agg"
        ? `agg · ${width}: aggregated, each point stands for ${width} of data (min, mean, max). Zoom in for raw samples`
        : `part · ${width}: some signals aggregated (${width} per point), others raw`,
  range: (full: string) => `Time range shown: ${full}`,
  chartMode: "Display mode: Line joins points, Step holds each value, Markers draws points only",
  valuesMode: "Between points: linear interpolates, hold keeps the last value",
  windowMenu: "Window menu: rename, remove",
  grip: "Drag to resize the height",
  legendDrag: "Drag onto another window to move it; Alt/Ctrl+drop copies",
  legendUnit: (unit: string | undefined, side: string) =>
    unit ? `[${unit}] · y axis ${side}` : `y axis ${side}`,
  sna: (share: string) =>
    `${share}: of the points in view are SNA (signal not available, marked invalid by the sender); amber strip at the plot's foot`,
  legendRemove: "Remove from this window",
  stripInfo: (recorded: string, width: string) =>
    `TIME: the whole recording (${recorded}). Each bar is ${width}; taller bars hold more data. Click a bar to jump, drag to zoom, double-click for all`,
  eventsCount: (shown: number, total: number, sentence?: string) =>
    `${shown.toLocaleString("en-US")} events match the filter${sentence ? ` (${sentence})` : ""}, ${total.toLocaleString("en-US")} in the recording · click to open the list · e`,

  // Top row, add-saved-views (V7): Views menu, overflow menu, open view.
  views: "Views: save, open, import and share named views",
  copyLink:
    "Copy link: a link holding this view; works where a KIPscope server with the same data runs",
  viewModified: "Changed since saved or opened",
  moreControls: "More controls: the top row items that do not fit",
} as const;
