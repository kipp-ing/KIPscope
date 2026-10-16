import type { ExplorerItem } from "./groups.ts";

/** Selected signal IDs and the anchor of Shift ranges (a signal ID), design M5. */
export interface Selection {
  ids: ReadonlySet<string>;
  anchor?: string;
}

export const NO_SELECTION: Selection = { ids: new Set() };

export type ClickMode = "plain" | "toggle" | "range";

/** True on macOS (navigator.platform starts with "Mac", or userAgentData.platform "macOS"). */
export function isMacPlatform(platform: string): boolean {
  return platform.startsWith("Mac") || platform === "macOS";
}

/** Shift → "range"; else Cmd (mac) or Ctrl (others) → "toggle"; else "plain" (lead default L1). */
export function clickMode(
  e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  mac: boolean,
): ClickMode {
  if (e.shiftKey) return "range";
  return (mac ? e.metaKey : e.ctrlKey) ? "toggle" : "plain";
}

/** Signal ID of item i, undefined for a header or outside the items. */
function signalAt(items: readonly ExplorerItem[], i: number): string | undefined {
  const item = items[i];
  return item?.kind === "signal" ? item.match.signal.id : undefined;
}

/** Item index of signal `id`, -1 when it is no signal item. */
function indexOfSignal(items: readonly ExplorerItem[], id: string | undefined): number {
  if (id === undefined) return -1;
  return items.findIndex((it) => it.kind === "signal" && it.match.signal.id === id);
}

/** The signal IDs of items a…b (either order, inclusive), headers skipped. */
function rangeIds(items: readonly ExplorerItem[], a: number, b: number): Set<string> {
  const ids = new Set<string>();
  for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
    const id = signalAt(items, i);
    if (id !== undefined) ids.add(id);
  }
  return ids;
}

/**
 * L1 for a click on signal item `index`: plain → {that row}, anchor it; toggle → flip it, anchor
 * it; range → the signal rows between anchor and it (inclusive, headers skipped), anchor kept; an
 * anchor not in `items` counts as the clicked row.
 */
export function selectClick(
  sel: Selection,
  items: readonly ExplorerItem[],
  index: number,
  mode: ClickMode,
): Selection {
  const id = signalAt(items, index);
  if (id === undefined) return sel;
  switch (mode) {
    case "plain":
      return { ids: new Set([id]), anchor: id };
    case "toggle": {
      const ids = new Set(sel.ids);
      if (!ids.delete(id)) ids.add(id);
      return { ids, anchor: id };
    }
    case "range": {
      const anchor = sel.anchor;
      const from = indexOfSignal(items, anchor);
      if (anchor === undefined || from < 0) return { ids: new Set([id]), anchor: id };
      return { ids: rangeIds(items, from, index), anchor };
    }
  }
}

/**
 * Shift+Arrow from item `from` to item `to`: anchor = sel.anchor if in items, else the signal at
 * `from`, else the signal at `to`; selection = signal rows between anchor and `to`. Unchanged when
 * no anchor can be found (both are headers and none is set).
 */
export function extendTo(
  sel: Selection,
  items: readonly ExplorerItem[],
  from: number,
  to: number,
): Selection {
  let anchor = indexOfSignal(items, sel.anchor);
  if (anchor < 0) anchor = signalAt(items, from) !== undefined ? from : to;
  const anchorId = signalAt(items, anchor);
  if (anchorId === undefined) return sel;
  return { ids: rangeIds(items, anchor, to), anchor: anchorId };
}

/** Selected IDs that are signal items of `items`, in item order. */
export function selectedInOrder(sel: Selection, items: readonly ExplorerItem[]): string[] {
  const out: string[] = [];
  for (const it of items) {
    if (it.kind === "signal" && sel.ids.has(it.match.signal.id)) out.push(it.match.signal.id);
  }
  return out;
}

/** Drops IDs that are no signal item of `items` (after a group closes); keeps the anchor only if kept. */
export function pruneSelection(sel: Selection, items: readonly ExplorerItem[]): Selection {
  const ids = new Set(selectedInOrder(sel, items));
  const anchor = sel.anchor !== undefined && ids.has(sel.anchor) ? sel.anchor : undefined;
  return anchor !== undefined ? { ids, anchor } : { ids };
}

/**
 * `onMouseDown` of the explorer list (D-065, design M1): no press, double-click or Shift-click there
 * starts or extends a text selection, and focus stays where it was (the search).
 */
export function preventListPress(e: { button: number; preventDefault(): void }): void {
  e.preventDefault();
}
