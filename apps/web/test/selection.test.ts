import { readFileSync } from "node:fs";
import type { SignalMatch } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import type { ExplorerItem } from "../src/explorer/groups.ts";
import {
  clickMode,
  extendTo,
  isMacPlatform,
  NO_SELECTION,
  preventListPress,
  pruneSelection,
  type Selection,
  selectClick,
  selectedInClickOrder,
  selectedInOrder,
} from "../src/explorer/selection.ts";

const header = (name: string): ExplorerItem => ({ kind: "group", name, count: 2, open: true });
const row = (id: string): ExplorerItem => ({
  kind: "signal",
  match: { signal: { id } } as unknown as SignalMatch,
});

// 0 G1, 1 a, 2 b, 3 G2, 4 c, 5 d
const items: ExplorerItem[] = [header("G1"), row("a"), row("b"), header("G2"), row("c"), row("d")];
const sel = (ids: string[], anchor?: string): Selection => ({
  ids: new Set(ids),
  ...(anchor !== undefined ? { anchor } : {}),
});
const idsOf = (s: Selection) => [...s.ids].sort();

describe("explorer selection", () => {
  it("selects one row on a plain click", () => {
    const first = selectClick(NO_SELECTION, items, 2, "plain");
    expect(idsOf(first)).toEqual(["b"]);
    expect(first.anchor).toBe("b");
    // A plain click replaces an existing multi-selection.
    const second = selectClick(sel(["a", "b", "c"], "a"), items, 5, "plain");
    expect(idsOf(second)).toEqual(["d"]);
    expect(second.anchor).toBe("d");
  });

  it("toggles with Ctrl, or Cmd on macOS", () => {
    const e = (o: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }>) => ({
      shiftKey: false,
      ctrlKey: false,
      metaKey: false,
      ...o,
    });
    expect(clickMode(e({ ctrlKey: true }), false)).toBe("toggle");
    expect(clickMode(e({ metaKey: true }), true)).toBe("toggle");
    expect(clickMode(e({ metaKey: true }), false)).toBe("plain");
    expect(clickMode(e({ ctrlKey: true }), true)).toBe("plain");
    expect(clickMode(e({}), false)).toBe("plain");
    expect(clickMode(e({ shiftKey: true }), true)).toBe("range");
    expect(clickMode(e({ shiftKey: true, ctrlKey: true }), false)).toBe("range");
    expect(isMacPlatform("MacIntel")).toBe(true);
    expect(isMacPlatform("Win32")).toBe(false);
    expect(isMacPlatform("Linux x86_64")).toBe(false);

    const one = selectClick(NO_SELECTION, items, 1, "plain");
    const two = selectClick(one, items, 4, "toggle");
    expect(idsOf(two)).toEqual(["a", "c"]);
    expect(two.anchor).toBe("c");
    const off = selectClick(two, items, 1, "toggle");
    expect(idsOf(off)).toEqual(["c"]);
  });

  it("selects a range of signal rows across groups with Shift", () => {
    const start = selectClick(NO_SELECTION, items, 2, "plain");
    const range = selectClick(start, items, 5, "range");
    expect(idsOf(range)).toEqual(["b", "c", "d"]); // header G2 is skipped
    expect(range.anchor).toBe("b"); // anchor kept
    // Backwards from the same anchor.
    const back = selectClick(start, items, 1, "range");
    expect(idsOf(back)).toEqual(["a", "b"]);
    // A second Shift-click re-ranges from the same anchor instead of growing.
    expect(idsOf(selectClick(range, items, 4, "range"))).toEqual(["b", "c"]);
    // An anchor that is not in the list counts as the clicked row.
    expect(idsOf(selectClick(sel(["gone"], "gone"), items, 4, "range"))).toEqual(["c"]);
  });

  it("extends the range with Shift+Arrow", () => {
    const anchored = sel(["b"], "b");
    expect(idsOf(extendTo(anchored, items, 2, 3))).toEqual(["b"]); // onto the header
    expect(idsOf(extendTo(anchored, items, 3, 4))).toEqual(["b", "c"]);
    expect(idsOf(extendTo(sel(["b", "c"], "b"), items, 4, 3))).toEqual(["b"]);
    expect(idsOf(extendTo(anchored, items, 2, 1))).toEqual(["a", "b"]); // across the anchor
    // No anchor: the signal at `from`, else the one at `to`.
    expect(idsOf(extendTo(NO_SELECTION, items, 1, 2))).toEqual(["a", "b"]);
    expect(idsOf(extendTo(NO_SELECTION, items, 0, 1))).toEqual(["a"]);
    // Nothing to anchor on: unchanged.
    expect(extendTo(NO_SELECTION, items, 0, 3)).toEqual(NO_SELECTION);
  });

  it("lists the selection in list order and drops hidden rows", () => {
    const picked = sel(["d", "a", "c", "b"], "d");
    expect(selectedInOrder(picked, items)).toEqual(["a", "b", "c", "d"]);
    // Group G2 closes: c and d are no signal items any more.
    const closed: ExplorerItem[] = [
      header("G1"),
      row("a"),
      row("b"),
      { kind: "group", name: "G2", count: 2, open: false },
    ];
    expect(selectedInOrder(picked, closed)).toEqual(["a", "b"]);
    const pruned = pruneSelection(picked, closed);
    expect(idsOf(pruned)).toEqual(["a", "b"]);
    expect(pruned.anchor).toBeUndefined(); // anchor d was dropped
    expect(pruneSelection(sel(["a", "d"], "a"), closed).anchor).toBe("a");
  });

  it("lists a starred row once in the selection", () => {
    const copy = (id: string): ExplorerItem => ({ ...row(id), inFavourites: true }) as ExplorerItem;
    const RPM = "testcar/Sna_800h.RPM";
    const SIG_A = "testcar/Fast_100h.SIG_A";
    // The Favourites copy of RPM and its row in the group `SNA codes`, both selected with SIG_A.
    const starred: ExplorerItem[] = [
      { kind: "group", name: "★ Favourites", count: 1, open: true, favourites: true },
      copy(RPM),
      header("SNA codes"),
      row(RPM),
      header("Fast"),
      row(SIG_A),
    ];
    const picked = sel([SIG_A, RPM], RPM);
    expect(selectedInOrder(picked, starred)).toEqual([RPM, SIG_A]);
    // Clicking either item of the signal selects the signal, so both items show it selected.
    expect(idsOf(selectClick(NO_SELECTION, starred, 1, "plain"))).toEqual([RPM]);
    expect(idsOf(selectClick(NO_SELECTION, starred, 3, "plain"))).toEqual([RPM]);
    // A range across both items lists the signal once.
    const range = selectClick(selectClick(NO_SELECTION, starred, 1, "plain"), starred, 5, "range");
    expect(selectedInOrder(range, starred)).toEqual([RPM, SIG_A]);
    // First occurrence wins: with SIG_A's copy first, it comes first.
    const sigFirst: ExplorerItem[] = [copy(SIG_A), copy(RPM), row(RPM), row(SIG_A)];
    expect(selectedInOrder(picked, sigFirst)).toEqual([SIG_A, RPM]);
  });

  it("keeps presses in the list from selecting text", () => {
    for (const button of [0, 1, 2]) {
      let prevented = 0;
      preventListPress({ button, preventDefault: () => prevented++ });
      expect(prevented).toBe(1);
    }
    const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
    const rule = /\.explorer \.results\s*\{([^}]*)\}/.exec(css);
    expect(rule?.[1]).toMatch(/user-select:\s*none/);
    expect(rule?.[1]).toMatch(/-webkit-user-select:\s*none/);
  });
});

describe("explorer selection click order", () => {
  // spec computed-signals "Selection in click order" (L2)
  it("lists the selection in click order", () => {
    // Click b, then Ctrl/Cmd-click a (a is above b in the list): b first, as clicked.
    const b = selectClick(NO_SELECTION, items, 2, "plain");
    const ba = selectClick(b, items, 1, "toggle");
    expect(selectedInClickOrder(ba, items)).toEqual(["b", "a"]);
    // selectedInOrder keeps the list order, so the two differ here.
    expect(selectedInOrder(ba, items)).toEqual(["a", "b"]);

    // Three toggles: d, a, c.
    const dac = selectClick(
      selectClick(selectClick(NO_SELECTION, items, 5, "plain"), items, 1, "toggle"),
      items,
      4,
      "toggle",
    );
    expect(selectedInClickOrder(dac, items)).toEqual(["d", "a", "c"]);

    // A range adds its rows in list order, whatever the direction of the Shift-click.
    const down = selectClick(selectClick(NO_SELECTION, items, 1, "plain"), items, 5, "range");
    expect(selectedInClickOrder(down, items)).toEqual(["a", "b", "c", "d"]);
    const up = selectClick(selectClick(NO_SELECTION, items, 5, "plain"), items, 1, "range");
    expect(selectedInClickOrder(up, items)).toEqual(["a", "b", "c", "d"]);

    // Each id once: a favourite's copy and its group row are one signal.
    const withCopy = [...items, row("b")];
    expect(selectedInClickOrder(sel(["b", "a"]), withCopy)).toEqual(["b", "a"]);

    // Ids that are no signal item of the list (a closed group, a header name) are ignored.
    expect(selectedInClickOrder(sel(["zzz", "c", "G1", "a"]), items)).toEqual(["c", "a"]);
    expect(selectedInClickOrder(NO_SELECTION, items)).toEqual([]);
    expect(selectedInClickOrder(sel(["c", "a"]), [])).toEqual([]);
  });

  // spec computed-signals "Selection in click order" (L2, task 5.5)
  it("keeps click order through pruneSelection", () => {
    // Click b, then Ctrl/Cmd-click a (a is listed above b).
    const ba = selectClick(selectClick(NO_SELECTION, items, 2, "plain"), items, 1, "toggle");
    expect(ba.anchor).toBe("a");

    // Items still contain both: the click order survives the prune, the anchor is kept.
    const both = pruneSelection(ba, items);
    expect(selectedInClickOrder(both, items)).toEqual(["b", "a"]);
    expect(both.anchor).toBe("a");

    // Items that contain both, in another list order, still give the click order.
    const reordered: ExplorerItem[] = [header("G1"), row("b"), row("a")];
    expect(selectedInClickOrder(pruneSelection(ba, reordered), reordered)).toEqual(["b", "a"]);

    // Click order d, a, c, b (anchor b). Items without a drop only a; the rest keep their order.
    const dacb = sel(["d", "a", "c", "b"], "b");
    const noA: ExplorerItem[] = [header("G1"), row("b"), header("G2"), row("c"), row("d")];
    const prunedNoA = pruneSelection(dacb, noA);
    expect(selectedInClickOrder(prunedNoA, noA)).toEqual(["d", "c", "b"]);
    expect([...prunedNoA.ids]).toEqual(["d", "c", "b"]);
    expect(prunedNoA.anchor).toBe("b"); // anchor b is kept

    // Items without the anchor: the anchor goes, the order of the others stays.
    const noB: ExplorerItem[] = [header("G1"), row("a"), header("G2"), row("c"), row("d")];
    const prunedNoB = pruneSelection(dacb, noB);
    expect([...prunedNoB.ids]).toEqual(["d", "a", "c"]);
    expect(prunedNoB.anchor).toBeUndefined();
  });
});
