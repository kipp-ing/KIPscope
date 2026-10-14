import type { TimeseriesWindow } from "@letsview/shared";
import { describe, expect, it } from "vitest";
import {
  canAdd,
  canDrop,
  DRAG_THRESHOLD_PX,
  type DragSource,
  dropCommand,
  dropStateFor,
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
