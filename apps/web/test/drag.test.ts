import type { TimeseriesWindow, ValuesWindow, WorkspaceWindow } from "@letsview/shared";
import { describe, expect, it } from "vitest";
import {
  canAdd,
  canDrop,
  DRAG_THRESHOLD_PX,
  DROP_NEW,
  DROP_NEW_BELOW,
  type DragSource,
  type DropTarget,
  dropCommand,
  dropStateFor,
  dropTargetOf,
  isCopy,
  isLegendSource,
} from "../src/chart/drag.ts";

const UNITS: Record<string, string | undefined> = {
  "c/V_ANZ": "km/h",
  "c/DVL": "1/min",
  "c/PTC": "V",
  "c/EAC": "V",
  "c/T_MOT": "°C",
  "c/DNMOT": "rpm/10ms",
  "c/NOUNIT": undefined,
};
const unitOf = (id: string) => UNITS[id];

function win(id: string, signals: string[]): TimeseriesWindow {
  return {
    id,
    kind: "timeseries",
    range: { from: "0", to: "10" },
    display: { mode: "line", envelope: false },
    signals: signals.map((signalId, i) => ({ id: `a${id}${i}`, signalId })),
  };
}

const none = { altKey: false, ctrlKey: false };

describe("drag and drop", () => {
  // A shows V_ANZ and DVL, B shows PTC.
  const windows = [win("wA", ["c/V_ANZ", "c/DVL"]), win("wB", ["c/PTC"])];
  const source: DragSource = { windowId: "wA", assignmentId: "awA0", signalId: "c/V_ANZ" };
  const toB = { kind: "window", windowId: "wB" } as const;

  it("moves on plain drop and copies with Alt or Ctrl", () => {
    expect(dropCommand(source, toB, windows, unitOf, none)).toEqual({
      type: "window.moveSignal",
      windowId: "wA",
      assignmentId: "awA0",
      targetWindowId: "wB",
    });
    for (const mods of [
      { altKey: true, ctrlKey: false },
      { altKey: false, ctrlKey: true },
      { altKey: true, ctrlKey: true },
    ]) {
      expect(dropCommand(source, toB, windows, unitOf, mods)).toEqual({
        type: "window.moveSignal",
        windowId: "wA",
        assignmentId: "awA0",
        targetWindowId: "wB",
        copy: true,
      });
    }
    expect(canDrop(source, toB, windows, unitOf)).toBe(true);
    expect(DRAG_THRESHOLD_PX).toBe(4);
  });

  it("rejects drops on the source and on windows showing the signal", () => {
    expect(canDrop(source, { kind: "window", windowId: "wA" }, windows, unitOf)).toBe(false);
    expect(dropCommand(source, { kind: "window", windowId: "wA" }, windows, unitOf, none)).toBe(
      undefined,
    );
    // V_ANZ shown in A and B: dragging it from A over B is refused.
    const both = [win("wA", ["c/V_ANZ", "c/DVL"]), win("wB", ["c/PTC", "c/V_ANZ"])];
    expect(canDrop(source, toB, both, unitOf)).toBe(false);
    expect(dropCommand(source, toB, both, unitOf, { altKey: true, ctrlKey: false })).toBe(
      undefined,
    );
    // Unknown target window.
    expect(canDrop(source, { kind: "window", windowId: "wX" }, windows, unitOf)).toBe(false);
  });

  it("refuses a drop that would make a fifth unit", () => {
    const full = win("wA", ["c/PTC", "c/V_ANZ", "c/T_MOT", "c/DVL"]); // V, km/h, °C, 1/min
    const other = win("wB", ["c/DNMOT"]);
    const drag: DragSource = { windowId: "wB", assignmentId: "awB0", signalId: "c/DNMOT" };
    const toA = { kind: "window", windowId: "wA" } as const;
    expect(canDrop(drag, toA, [full, other], unitOf)).toBe(false);
    expect(dropCommand(drag, toA, [full, other], unitOf, none)).toBe(undefined);
    expect(dropCommand(drag, toA, [full, other], unitOf, { altKey: true, ctrlKey: false })).toBe(
      undefined,
    );
    // A fifth signal of an existing unit is fine.
    const eac: DragSource = { windowId: "wB", assignmentId: "awB1", signalId: "c/EAC" };
    expect(canDrop(eac, toA, [full, win("wB", ["c/DNMOT", "c/EAC"])], unitOf)).toBe(true);
    // Unit-less signals count as their own unit.
    const nounit: DragSource = { windowId: "wB", assignmentId: "awB2", signalId: "c/NOUNIT" };
    expect(canDrop(nounit, toA, [full, win("wB", ["c/NOUNIT"])], unitOf)).toBe(false);
    // The new-window zone accepts anything.
    expect(canDrop(drag, { kind: "new" }, [full, other], unitOf)).toBe(true);
  });

  it("drops into a new window", () => {
    expect(dropCommand(source, { kind: "new" }, windows, unitOf, none)).toEqual({
      type: "window.moveSignal",
      windowId: "wA",
      assignmentId: "awA0",
    });
    expect(
      dropCommand(source, { kind: "new" }, windows, unitOf, { altKey: true, ctrlKey: false }),
    ).toEqual({ type: "window.moveSignal", windowId: "wA", assignmentId: "awA0", copy: true });
    // Even the only signal of the source window can go to a new window.
    const solo = [win("wA", ["c/V_ANZ"])];
    expect(canDrop(source, { kind: "new" }, solo, unitOf)).toBe(true);
  });

  it("takes copy mode from the given event's modifiers only", () => {
    // A plain event after an Alt one: move again, nothing carried over.
    expect(isCopy(source, { altKey: true, ctrlKey: false })).toBe(true);
    expect(isCopy(source, none)).toBe(false);
    expect(isCopy(source, { altKey: false, ctrlKey: true })).toBe(true);
    // An explorer drag always adds.
    expect(isCopy({ signalId: "c/V_ANZ" }, { altKey: true, ctrlKey: true })).toBe(false);
  });
});

describe("explorer drag", () => {
  // wA shows V_ANZ and DVL, wB shows PTC, wC is full: V (EAC), km/h, °C, 1/min.
  const wA = win("wA", ["c/V_ANZ", "c/DVL"]);
  const wB = win("wB", ["c/PTC"]);
  const wC = win("wC", ["c/EAC", "c/V_ANZ", "c/T_MOT", "c/DVL"]);
  const windows = [wA, wB, wC];
  const explorer = { signalId: "c/V_ANZ" };

  it("adds an explorer signal to windows not showing it and to a new window", () => {
    expect(canAdd("c/V_ANZ", { kind: "window", windowId: "wA" }, windows, unitOf)).toBe(false);
    expect(canAdd("c/V_ANZ", { kind: "window", windowId: "wB" }, windows, unitOf)).toBe(true);
    expect(canAdd("c/V_ANZ", { kind: "new" }, windows, unitOf)).toBe(true);
    expect(dropStateFor(explorer, "wA", windows, unitOf)).toBe(undefined);
    expect(dropStateFor(explorer, "wB", windows, unitOf)).toBe("target");
    for (const w of windows)
      expect(dropStateFor(explorer, w.id, windows, unitOf)).not.toBe("source");
    expect(isLegendSource(explorer)).toBe(false);
  });

  it("refuses an explorer drop that would make a fifth unit", () => {
    expect(canAdd("c/DNMOT", { kind: "window", windowId: "wC" }, windows, unitOf)).toBe(false);
    expect(dropStateFor({ signalId: "c/DNMOT" }, "wC", windows, unitOf)).toBe("refused");
    // PTC is a V signal and V is already there.
    expect(canAdd("c/PTC", { kind: "window", windowId: "wC" }, windows, unitOf)).toBe(true);
    expect(dropStateFor({ signalId: "c/PTC" }, "wC", windows, unitOf)).toBe("target");
  });

  it("keeps the legend-drag states", () => {
    const legend: DragSource = { windowId: "wA", assignmentId: "awA0", signalId: "c/V_ANZ" };
    expect(isLegendSource(legend)).toBe(true);
    expect(dropStateFor(legend, "wA", windows, unitOf)).toBe("source");
    expect(dropStateFor(legend, "wB", windows, unitOf)).toBe("target");
    // wC already shows V_ANZ: neither target nor refused.
    expect(dropStateFor(legend, "wC", windows, unitOf)).toBe(undefined);
    // DNMOT from wB onto the full window wC: refused.
    const dn: DragSource = { windowId: "wB", assignmentId: "awB0", signalId: "c/DNMOT" };
    const withDn = [wA, win("wB", ["c/DNMOT"]), wC];
    expect(dropStateFor(dn, "wB", withDn, unitOf)).toBe("source");
    expect(dropStateFor(dn, "wC", withDn, unitOf)).toBe("refused");
    expect(dropStateFor(dn, "wA", withDn, unitOf)).toBe("target");
  });
});

function vwin(id: string, signals: string[]): ValuesWindow {
  return {
    id,
    kind: "values",
    mode: "line",
    signals: signals.map((signalId, i) => ({ id: `a${id}${i}`, signalId })),
  };
}

describe("values windows as drop targets and sources", () => {
  // wA: four units (V, km/h, °C, 1/min). wB: DNMOT (rpm/10ms). wV: values window with four units.
  const wA = win("wA", ["c/PTC", "c/V_ANZ", "c/T_MOT", "c/DVL"]);
  const wB = win("wB", ["c/DNMOT"]);
  const wV = vwin("wV", ["c/PTC", "c/V_ANZ", "c/T_MOT", "c/DVL"]);
  const windows: WorkspaceWindow[] = [wA, wB, wV];
  const toV = { kind: "window", windowId: "wV" } as const;
  const toA = { kind: "window", windowId: "wA" } as const;

  it("accepts any unit on a values window", () => {
    // DNMOT legend row from wB into the four-unit values window: a fifth unit is fine.
    const dn: DragSource = { windowId: "wB", assignmentId: "awB0", signalId: "c/DNMOT" };
    expect(canDrop(dn, toV, windows, unitOf)).toBe(true);
    expect(dropStateFor(dn, "wV", windows, unitOf)).toBe("target");
    expect(dropCommand(dn, toV, windows, unitOf, none)).toEqual({
      type: "window.moveSignal",
      windowId: "wB",
      assignmentId: "awB0",
      targetWindowId: "wV",
    });
    // The same signal into the four-unit timeseries window stays refused.
    expect(canDrop(dn, toA, windows, unitOf)).toBe(false);
    expect(dropStateFor(dn, "wA", windows, unitOf)).toBe("refused");
    // Explorer drag: add to the values window, unit-less signals too.
    expect(canAdd("c/DNMOT", toV, windows, unitOf)).toBe(true);
    expect(dropStateFor({ signalId: "c/DNMOT" }, "wV", windows, unitOf)).toBe("target");
    expect(canAdd("c/NOUNIT", toV, windows, unitOf)).toBe(true);
    // Five and more units in the values window do not block a sixth.
    const five = [wA, wB, vwin("wV", ["c/PTC", "c/V_ANZ", "c/T_MOT", "c/DVL", "c/DNMOT"])];
    expect(canAdd("c/NOUNIT", toV, five, unitOf)).toBe(true);
    // "Already shows the signal" still refuses.
    expect(canAdd("c/V_ANZ", toV, windows, unitOf)).toBe(false);
    expect(dropStateFor({ signalId: "c/V_ANZ" }, "wV", windows, unitOf)).toBe(undefined);
    expect(
      canDrop({ windowId: "wB", assignmentId: "x", signalId: "c/DVL" }, toV, windows, unitOf),
    ).toBe(false);
  });

  it("drags a values row like a legend row", () => {
    // Values window wV lists DVL and DNMOT; wB shows PTC only.
    const full = win("wA", ["c/PTC", "c/V_ANZ", "c/T_MOT", "c/EAC"]); // V, km/h, °C
    const four = win("wA", ["c/PTC", "c/V_ANZ", "c/T_MOT", "c/DVL"]);
    const vals = vwin("wV", ["c/DVL", "c/DNMOT"]);
    const other = win("wB", ["c/PTC"]);
    const dvl: DragSource = { windowId: "wV", assignmentId: "awV0", signalId: "c/DVL" };
    const dnmot: DragSource = { windowId: "wV", assignmentId: "awV1", signalId: "c/DNMOT" };
    const ws: WorkspaceWindow[] = [full, other, vals];
    const toB = { kind: "window", windowId: "wB" } as const;

    // Move on plain drop, copy with Alt or Ctrl, like a legend row.
    expect(isLegendSource(dvl)).toBe(true);
    expect(dropStateFor(dvl, "wV", ws, unitOf)).toBe("source");
    expect(dropStateFor(dvl, "wB", ws, unitOf)).toBe("target");
    expect(dropCommand(dvl, toB, ws, unitOf, none)).toEqual({
      type: "window.moveSignal",
      windowId: "wV",
      assignmentId: "awV0",
      targetWindowId: "wB",
    });
    expect(dropCommand(dvl, toB, ws, unitOf, { altKey: true, ctrlKey: false })).toEqual({
      type: "window.moveSignal",
      windowId: "wV",
      assignmentId: "awV0",
      targetWindowId: "wB",
      copy: true,
    });
    expect(dropCommand(dvl, toB, ws, unitOf, { altKey: false, ctrlKey: true })).toMatchObject({
      copy: true,
    });
    // Onto the values window itself and onto a window already showing the signal: refused.
    expect(canDrop(dvl, { kind: "window", windowId: "wV" }, ws, unitOf)).toBe(false);
    expect(canDrop(dvl, toA, [four, other, vals], unitOf)).toBe(false);
    // The new-window zone accepts: the plain move command without a target.
    expect(dropCommand(dvl, { kind: "new" }, ws, unitOf, none)).toEqual({
      type: "window.moveSignal",
      windowId: "wV",
      assignmentId: "awV0",
    });
    // A fifth unit in a timeseries target is refused, with and without Alt.
    const fiveUnits = [win("wA", ["c/PTC", "c/V_ANZ", "c/T_MOT", "c/DVL"]), other, vals];
    expect(canDrop(dnmot, toA, fiveUnits, unitOf)).toBe(false);
    expect(dropStateFor(dnmot, "wA", fiveUnits, unitOf)).toBe("refused");
    expect(dropCommand(dnmot, toA, fiveUnits, unitOf, none)).toBe(undefined);
    expect(dropCommand(dnmot, toA, fiveUnits, unitOf, { altKey: true, ctrlKey: false })).toBe(
      undefined,
    );
  });

  it("moves and copies legend rows into a values window", () => {
    // wA shows V_ANZ and DVL; the values window wV is empty.
    const a = win("wA", ["c/V_ANZ", "c/DVL"]);
    const v = vwin("wV", []);
    const ws: WorkspaceWindow[] = [a, v];
    const dvl: DragSource = { windowId: "wA", assignmentId: "awA1", signalId: "c/DVL" };
    const vanz: DragSource = { windowId: "wA", assignmentId: "awA0", signalId: "c/V_ANZ" };

    expect(dropStateFor(dvl, "wV", ws, unitOf)).toBe("target");
    // Alt: DVL is copied (stays in wA).
    expect(dropCommand(dvl, toV, ws, unitOf, { altKey: true, ctrlKey: false })).toEqual({
      type: "window.moveSignal",
      windowId: "wA",
      assignmentId: "awA1",
      targetWindowId: "wV",
      copy: true,
    });
    // No modifier: V_ANZ is moved, so the next drop of the other row sees it gone.
    expect(dropCommand(vanz, toV, ws, unitOf, none)).toEqual({
      type: "window.moveSignal",
      windowId: "wA",
      assignmentId: "awA0",
      targetWindowId: "wV",
    });
    // Once DVL is in the values window it cannot be dropped there again.
    const after: WorkspaceWindow[] = [a, vwin("wV", ["c/DVL"])];
    expect(canDrop(dvl, toV, after, unitOf)).toBe(false);
    expect(dropCommand(dvl, toV, after, unitOf, none)).toBe(undefined);
    expect(dropStateFor(dvl, "wV", after, unitOf)).toBe(undefined);
  });
});

function el(attrs: Record<string, string>) {
  return { getAttribute: (name: string) => attrs[name] ?? null };
}

describe("drop below the windows", () => {
  it("maps drop elements to targets", () => {
    expect(DROP_NEW).toBe("new");
    expect(DROP_NEW_BELOW).toBe("new-below");
    expect(dropTargetOf(el({ "data-window-id": "wA" }))).toEqual({
      kind: "window",
      windowId: "wA",
    });
    expect(dropTargetOf(el({ "data-drop": "new" }))).toEqual({ kind: "new", place: "strip" });
    expect(dropTargetOf(el({ "data-drop": "new-below" }))).toEqual({
      kind: "new",
      place: "below",
    });
    expect(dropTargetOf(el({ "data-drop": "bogus" }))).toBe(undefined);
    expect(dropTargetOf(el({}))).toBe(undefined);
    expect(dropTargetOf(null)).toBe(undefined);
    expect(dropTargetOf(undefined)).toBe(undefined);
  });

  it("treats a drop below the windows like + New window", () => {
    const strip: DropTarget = { kind: "new", place: "strip" };
    const below: DropTarget = { kind: "new", place: "below" };
    const windows = [win("wA", ["c/V_ANZ", "c/DVL"]), win("wB", ["c/PTC"])];
    const source: DragSource = { windowId: "wA", assignmentId: "awA0", signalId: "c/V_ANZ" };
    const mods = [
      none,
      { altKey: true, ctrlKey: false },
      { altKey: false, ctrlKey: true },
      { altKey: true, ctrlKey: true },
    ];
    for (const m of mods) {
      expect(dropCommand(source, below, windows, unitOf, m)).toEqual(
        dropCommand(source, strip, windows, unitOf, m),
      );
    }
    expect(dropCommand(source, below, windows, unitOf, none)).toEqual({
      type: "window.moveSignal",
      windowId: "wA",
      assignmentId: "awA0",
    });
    expect(dropCommand(source, below, windows, unitOf, { altKey: true, ctrlKey: false })).toEqual({
      type: "window.moveSignal",
      windowId: "wA",
      assignmentId: "awA0",
      copy: true,
    });
    // The only signal of the only window: same as the strip.
    const solo = [win("wA", ["c/V_ANZ"])];
    for (const m of mods) {
      expect(dropCommand(source, below, solo, unitOf, m)).toEqual(
        dropCommand(source, strip, solo, unitOf, m),
      );
    }
    expect(dropCommand(source, below, solo, unitOf, none)).toEqual({
      type: "window.moveSignal",
      windowId: "wA",
      assignmentId: "awA0",
    });
    expect(canDrop(source, below, solo, unitOf)).toBe(true);
    expect(canDrop(source, below, windows, unitOf)).toBe(true);
    expect(canAdd("c/V_ANZ", below, windows, unitOf)).toBe(true);
    expect(canAdd("c/V_ANZ", below, [], unitOf)).toBe(true);
  });
});
