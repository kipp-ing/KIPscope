/**
 * Every tooltip of the app (add-guidance design H5). Wording rule W1: `<Name>: <what it does>`,
 * optionally ` · <key or gesture>`; sentence case, no closing period, at most 140 characters;
 * names as on screen, keys as in `shortcuts.ts`. Components take every `title` from here.
 */

type Linked = boolean;

/** Unlinked, the top row acts on one window and names it (design C5). */
const one = (linked: Linked, title: string | undefined): title is string =>
  !linked && title !== undefined;

/** Longest filter sentence in the events count, so the tooltip stays within W1's 140 characters. */
const SENTENCE_MAX = 50;

function cutSentence(sentence: string): string {
  return sentence.length <= SENTENCE_MAX ? sentence : `${sentence.slice(0, SENTENCE_MAX - 1)}…`;
}

export const HINTS = {
  sidebarToggle: (open: boolean) =>
    open ? "Signals: hide the signal list · s" : "Signals: show the signal list · s",
  /** The Signals tab's count tooltip (guidance "Explorer names the drag"); `matches` while searching. */
  tabSignals: (n: number, matches?: number) => {
    const all = n.toLocaleString("en-US");
    const head =
      matches === undefined
        ? `${all} signals`
        : `${matches.toLocaleString("en-US")} of ${all} match`;
    return `Signals: ${head}; drag a row onto a window, or press + · /`;
  },
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
  link: (on: boolean) =>
    on
      ? "Link time axes: on, all windows show one range"
      : "Link time axes: off, each window keeps its own range",
  goTo: (linked: Linked, title?: string) =>
    one(linked, title)
      ? `Go to: pick a range or type one in ${title} · t`
      : "Go to: pick a range or type one · t",
  /** The range picker's legend (add-range-picker R5, D-095); no key part, so W1's key check skips it. */
  calendarKeys:
    "Calendar keys: arrows move a day or a week, PageUp or PageDown a month, Enter picks",
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
        ? `agg ${width}: aggregated, each point stands for ${width} of data (min, mean, max). Zoom in for raw samples`
        : `part ${width}: some signals aggregated (${width} per point), others raw`,
  chartMode: "Display mode: Line joins points, Step holds each value, Markers draws points only",
  valuesMode: "Between points: linear interpolates, hold keeps the last value",
  windowMenu: "Window menu: line, step, markers, min/max, rename, remove",
  grip: "Drag to resize the height",
  legendDrag: "Drag onto another window to move it; Alt/Ctrl+drop copies",
  legendUnit: (unit: string | undefined, side: string) =>
    unit ? `[${unit}] · y axis ${side}` : `y axis ${side}`,
  sna: (share: string) =>
    `${share}: of the points in view are SNA (signal not available, marked invalid by the sender); strip in the signal's colour at the plot's foot`,
  legendRemove: "Remove from this window",
  /** A signal the shown data ref does not have (design DW13): legend, readout and values cells. */
  missing: (dataRef: string, name: string) => `Missing: ${dataRef} has no signal ${name}`,
  envelope: "Min/max: shade the range between the lowest and highest value of each bucket",
  /** DW18's ", a break a gap" left out: with it a recording of "3 d 4 h" reads 141 characters (W1). */
  stripInfo: (recorded: string) =>
    `Time strip: the whole recording (${recorded}); the line shows where data exists. Click to jump, drag to zoom, double-click for all`,
  /** A cursor flag on the strip (D-094, D-095); `clock` carries the date for `before`/`after`. */
  stripFlag: (name: "A" | "B", clock: string, where: "view" | "outside" | "before" | "after") => {
    const at =
      where === "view"
        ? ""
        : where === "outside"
          ? ", outside the view"
          : where === "before"
            ? ", before the strip's start"
            : ", after the strip's end";
    return `${name} ${clock}${at}: click centres the view on ${name}, span kept · Shift+${name}`;
  },
  /** The merged `A·B` flag (D-095). */
  stripFlagAB: (clockA: string, clockB: string) =>
    `A ${clockA} and B ${clockB}: click centres the view on both; Shift+A or Shift+B for one`,
  /** With no filter sentence and nothing filtered out, the count names no filter (W1). */
  eventsCount: (shown: number, total: number, sentence?: string) => {
    const n = shown.toLocaleString("en-US");
    const all = total.toLocaleString("en-US");
    const head =
      !sentence && shown === total
        ? `${n} of ${all} events in the recording`
        : `${n} events match the filter${sentence ? ` (${cutSentence(sentence)})` : ""}, ${all} in the recording`;
    return `${head} · click to open the list · e`;
  },

  // Top row, add-saved-views (V7): Views menu, overflow menu, open view.
  views: "Views: save, open and import named views; back to a recent workspace",
  viewModified: "Changed since saved or opened",
  more: "More: digits, + values window",

  // Share… and Recent workspaces, add-multiuser (M12).
  share: "Share: a link to an own copy of this layout, or an invite to this workspace",
  copyOwnLink:
    "Copy link (own copy): a link holding this layout; works where a KIPscope server with the same data runs",
  copyWorkspaceLink:
    "Copy workspace link: the address of this workspace, for whoever it is shared with",
  sharingOff: "Sharing is turned off on this server",
  openElsewhere: "Open in another tab",

  // Case catalog list (D-095).
  backToSearch: "Back to search: the tool that opened these sessions",
  filterSessions:
    "Filter sessions: by title, object, kind, id, start or a meta value; Enter opens the first match",
  catalogRow: "Step to this session, aligned as set under Align",
} as const;
