import {
  EMPTY_WORKSPACE,
  type SignalInfo,
  type TimeseriesWindow,
  type ValuesWindow,
  type WorkspaceWindow,
} from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import {
  canAdd,
  canAddAny,
  canDrop,
  DRAG_THRESHOLD_PX,
  DROP_EVENTS,
  DROP_NEW,
  DROP_NEW_BELOW,
  type DragSource,
  type DropTarget,
  dropCommand,
  dropStateFor,
  dropTargetOf,
  type ExplorerDragSource,
  eventsDrop,
  eventsDropMany,
  isCopy,
  isLegendSource,
} from "../src/chart/drag.ts";

const UNITS: Record<string, string | undefined> = {
  "c/SPEED_DISP": "km/h",
  "c/WSPD_FL": "1/min",
  "c/PTC": "V",
  "c/EAC": "V",
  "c/T_ENG": "°C",
  "c/MOT_SPD_D": "rpm/10ms",
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
  // A shows SPEED_DISP and WSPD_FL, B shows PTC.
  const windows = [win("wA", ["c/SPEED_DISP", "c/WSPD_FL"]), win("wB", ["c/PTC"])];
  const source: DragSource = { windowId: "wA", assignmentId: "awA0", signalId: "c/SPEED_DISP" };
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
    // SPEED_DISP shown in A and B: dragging it from A over B is refused.
    const both = [win("wA", ["c/SPEED_DISP", "c/WSPD_FL"]), win("wB", ["c/PTC", "c/SPEED_DISP"])];
    expect(canDrop(source, toB, both, unitOf)).toBe(false);
    expect(dropCommand(source, toB, both, unitOf, { altKey: true, ctrlKey: false })).toBe(
      undefined,
    );
    // Unknown target window.
    expect(canDrop(source, { kind: "window", windowId: "wX" }, windows, unitOf)).toBe(false);
  });

  it("refuses a drop that would make a fifth unit", () => {
    const full = win("wA", ["c/PTC", "c/SPEED_DISP", "c/T_ENG", "c/WSPD_FL"]); // V, km/h, °C, 1/min
    const other = win("wB", ["c/MOT_SPD_D"]);
    const drag: DragSource = { windowId: "wB", assignmentId: "awB0", signalId: "c/MOT_SPD_D" };
    const toA = { kind: "window", windowId: "wA" } as const;
    expect(canDrop(drag, toA, [full, other], unitOf)).toBe(false);
    expect(dropCommand(drag, toA, [full, other], unitOf, none)).toBe(undefined);
    expect(dropCommand(drag, toA, [full, other], unitOf, { altKey: true, ctrlKey: false })).toBe(
      undefined,
    );
    // A fifth signal of an existing unit is fine.
    const eac: DragSource = { windowId: "wB", assignmentId: "awB1", signalId: "c/EAC" };
    expect(canDrop(eac, toA, [full, win("wB", ["c/MOT_SPD_D", "c/EAC"])], unitOf)).toBe(true);
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
    const solo = [win("wA", ["c/SPEED_DISP"])];
    expect(canDrop(source, { kind: "new" }, solo, unitOf)).toBe(true);
  });

  it("takes copy mode from the given event's modifiers only", () => {
    // A plain event after an Alt one: move again, nothing carried over.
    expect(isCopy(source, { altKey: true, ctrlKey: false })).toBe(true);
    expect(isCopy(source, none)).toBe(false);
    expect(isCopy(source, { altKey: false, ctrlKey: true })).toBe(true);
    // An explorer drag always adds.
    expect(isCopy({ signalId: "c/SPEED_DISP" }, { altKey: true, ctrlKey: true })).toBe(false);
  });
});

describe("explorer drag", () => {
  // wA shows SPEED_DISP and WSPD_FL, wB shows PTC, wC is full: V (EAC), km/h, °C, 1/min.
  const wA = win("wA", ["c/SPEED_DISP", "c/WSPD_FL"]);
  const wB = win("wB", ["c/PTC"]);
  const wC = win("wC", ["c/EAC", "c/SPEED_DISP", "c/T_ENG", "c/WSPD_FL"]);
  const windows = [wA, wB, wC];
  const explorer = { signalId: "c/SPEED_DISP" };

  it("adds an explorer signal to windows not showing it and to a new window", () => {
    expect(canAdd("c/SPEED_DISP", { kind: "window", windowId: "wA" }, windows, unitOf)).toBe(false);
    expect(canAdd("c/SPEED_DISP", { kind: "window", windowId: "wB" }, windows, unitOf)).toBe(true);
    expect(canAdd("c/SPEED_DISP", { kind: "new" }, windows, unitOf)).toBe(true);
    expect(dropStateFor(explorer, "wA", windows, unitOf)).toBe(undefined);
    expect(dropStateFor(explorer, "wB", windows, unitOf)).toBe("target");
    for (const w of windows)
      expect(dropStateFor(explorer, w.id, windows, unitOf)).not.toBe("source");
    expect(isLegendSource(explorer)).toBe(false);
  });

  it("refuses an explorer drop that would make a fifth unit", () => {
    expect(canAdd("c/MOT_SPD_D", { kind: "window", windowId: "wC" }, windows, unitOf)).toBe(false);
    expect(dropStateFor({ signalId: "c/MOT_SPD_D" }, "wC", windows, unitOf)).toBe("refused");
    // PTC is a V signal and V is already there.
    expect(canAdd("c/PTC", { kind: "window", windowId: "wC" }, windows, unitOf)).toBe(true);
    expect(dropStateFor({ signalId: "c/PTC" }, "wC", windows, unitOf)).toBe("target");
  });

  it("keeps the legend-drag states", () => {
    const legend: DragSource = { windowId: "wA", assignmentId: "awA0", signalId: "c/SPEED_DISP" };
    expect(isLegendSource(legend)).toBe(true);
    expect(dropStateFor(legend, "wA", windows, unitOf)).toBe("source");
    expect(dropStateFor(legend, "wB", windows, unitOf)).toBe("target");
    // wC already shows SPEED_DISP: neither target nor refused.
    expect(dropStateFor(legend, "wC", windows, unitOf)).toBe(undefined);
    // MOT_SPD_D from wB onto the full window wC: refused.
    const dn: DragSource = { windowId: "wB", assignmentId: "awB0", signalId: "c/MOT_SPD_D" };
    const withDn = [wA, win("wB", ["c/MOT_SPD_D"]), wC];
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
  // wA: four units (V, km/h, °C, 1/min). wB: MOT_SPD_D (rpm/10ms). wV: values window with four units.
  const wA = win("wA", ["c/PTC", "c/SPEED_DISP", "c/T_ENG", "c/WSPD_FL"]);
  const wB = win("wB", ["c/MOT_SPD_D"]);
  const wV = vwin("wV", ["c/PTC", "c/SPEED_DISP", "c/T_ENG", "c/WSPD_FL"]);
  const windows: WorkspaceWindow[] = [wA, wB, wV];
  const toV = { kind: "window", windowId: "wV" } as const;
  const toA = { kind: "window", windowId: "wA" } as const;

  it("accepts any unit on a values window", () => {
    // MOT_SPD_D legend row from wB into the four-unit values window: a fifth unit is fine.
    const dn: DragSource = { windowId: "wB", assignmentId: "awB0", signalId: "c/MOT_SPD_D" };
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
    expect(canAdd("c/MOT_SPD_D", toV, windows, unitOf)).toBe(true);
    expect(dropStateFor({ signalId: "c/MOT_SPD_D" }, "wV", windows, unitOf)).toBe("target");
    expect(canAdd("c/NOUNIT", toV, windows, unitOf)).toBe(true);
    // Five and more units in the values window do not block a sixth.
    const five = [
      wA,
      wB,
      vwin("wV", ["c/PTC", "c/SPEED_DISP", "c/T_ENG", "c/WSPD_FL", "c/MOT_SPD_D"]),
    ];
    expect(canAdd("c/NOUNIT", toV, five, unitOf)).toBe(true);
    // "Already shows the signal" still refuses.
    expect(canAdd("c/SPEED_DISP", toV, windows, unitOf)).toBe(false);
    expect(dropStateFor({ signalId: "c/SPEED_DISP" }, "wV", windows, unitOf)).toBe(undefined);
    expect(
      canDrop({ windowId: "wB", assignmentId: "x", signalId: "c/WSPD_FL" }, toV, windows, unitOf),
    ).toBe(false);
  });

  it("drags a values row like a legend row", () => {
    // Values window wV lists WSPD_FL and MOT_SPD_D; wB shows PTC only.
    const full = win("wA", ["c/PTC", "c/SPEED_DISP", "c/T_ENG", "c/EAC"]); // V, km/h, °C
    const four = win("wA", ["c/PTC", "c/SPEED_DISP", "c/T_ENG", "c/WSPD_FL"]);
    const vals = vwin("wV", ["c/WSPD_FL", "c/MOT_SPD_D"]);
    const other = win("wB", ["c/PTC"]);
    const wspdFl: DragSource = { windowId: "wV", assignmentId: "awV0", signalId: "c/WSPD_FL" };
    const motSpd: DragSource = { windowId: "wV", assignmentId: "awV1", signalId: "c/MOT_SPD_D" };
    const ws: WorkspaceWindow[] = [full, other, vals];
    const toB = { kind: "window", windowId: "wB" } as const;

    // Move on plain drop, copy with Alt or Ctrl, like a legend row.
    expect(isLegendSource(wspdFl)).toBe(true);
    expect(dropStateFor(wspdFl, "wV", ws, unitOf)).toBe("source");
    expect(dropStateFor(wspdFl, "wB", ws, unitOf)).toBe("target");
    expect(dropCommand(wspdFl, toB, ws, unitOf, none)).toEqual({
      type: "window.moveSignal",
      windowId: "wV",
      assignmentId: "awV0",
      targetWindowId: "wB",
    });
    expect(dropCommand(wspdFl, toB, ws, unitOf, { altKey: true, ctrlKey: false })).toEqual({
      type: "window.moveSignal",
      windowId: "wV",
      assignmentId: "awV0",
      targetWindowId: "wB",
      copy: true,
    });
    expect(dropCommand(wspdFl, toB, ws, unitOf, { altKey: false, ctrlKey: true })).toMatchObject({
      copy: true,
    });
    // Onto the values window itself and onto a window already showing the signal: refused.
    expect(canDrop(wspdFl, { kind: "window", windowId: "wV" }, ws, unitOf)).toBe(false);
    expect(canDrop(wspdFl, toA, [four, other, vals], unitOf)).toBe(false);
    // The new-window zone accepts: the plain move command without a target.
    expect(dropCommand(wspdFl, { kind: "new" }, ws, unitOf, none)).toEqual({
      type: "window.moveSignal",
      windowId: "wV",
      assignmentId: "awV0",
    });
    // A fifth unit in a timeseries target is refused, with and without Alt.
    const fiveUnits = [win("wA", ["c/PTC", "c/SPEED_DISP", "c/T_ENG", "c/WSPD_FL"]), other, vals];
    expect(canDrop(motSpd, toA, fiveUnits, unitOf)).toBe(false);
    expect(dropStateFor(motSpd, "wA", fiveUnits, unitOf)).toBe("refused");
    expect(dropCommand(motSpd, toA, fiveUnits, unitOf, none)).toBe(undefined);
    expect(dropCommand(motSpd, toA, fiveUnits, unitOf, { altKey: true, ctrlKey: false })).toBe(
      undefined,
    );
  });

  it("moves and copies legend rows into a values window", () => {
    // wA shows SPEED_DISP and WSPD_FL; the values window wV is empty.
    const a = win("wA", ["c/SPEED_DISP", "c/WSPD_FL"]);
    const v = vwin("wV", []);
    const ws: WorkspaceWindow[] = [a, v];
    const wspdFl: DragSource = { windowId: "wA", assignmentId: "awA1", signalId: "c/WSPD_FL" };
    const vanz: DragSource = { windowId: "wA", assignmentId: "awA0", signalId: "c/SPEED_DISP" };

    expect(dropStateFor(wspdFl, "wV", ws, unitOf)).toBe("target");
    // Alt: WSPD_FL is copied (stays in wA).
    expect(dropCommand(wspdFl, toV, ws, unitOf, { altKey: true, ctrlKey: false })).toEqual({
      type: "window.moveSignal",
      windowId: "wA",
      assignmentId: "awA1",
      targetWindowId: "wV",
      copy: true,
    });
    // No modifier: SPEED_DISP is moved, so the next drop of the other row sees it gone.
    expect(dropCommand(vanz, toV, ws, unitOf, none)).toEqual({
      type: "window.moveSignal",
      windowId: "wA",
      assignmentId: "awA0",
      targetWindowId: "wV",
    });
    // Once WSPD_FL is in the values window it cannot be dropped there again.
    const after: WorkspaceWindow[] = [a, vwin("wV", ["c/WSPD_FL"])];
    expect(canDrop(wspdFl, toV, after, unitOf)).toBe(false);
    expect(dropCommand(wspdFl, toV, after, unitOf, none)).toBe(undefined);
    expect(dropStateFor(wspdFl, "wV", after, unitOf)).toBe(undefined);
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
    // The time strip is the events line (add-events V10).
    expect(DROP_EVENTS).toBe("events");
    expect(dropTargetOf(el({ "data-drop": "events" }))).toEqual({ kind: "events" });
    const labels: SignalInfo = {
      id: "testcar/Ign_A20h.MODE",
      dataRef: "testcar",
      name: "Ign_A20h.MODE",
      states: "labels",
    };
    const plain: SignalInfo = {
      id: "testcar/Fast_100h.SIG_A",
      dataRef: "testcar",
      name: "Fast_100h.SIG_A",
    };
    expect(eventsDrop(labels, EMPTY_WORKSPACE)).toEqual({ ok: true });
    expect(eventsDrop(plain, EMPTY_WORKSPACE)).toEqual({ ok: false, reason: "no_states" });
    expect(eventsDrop(undefined, EMPTY_WORKSPACE)).toEqual({ ok: false, reason: "no_states" });
    expect(eventsDrop(labels, { ...EMPTY_WORKSPACE, eventSignals: [labels.id] })).toEqual({
      ok: false,
      reason: "already_listed",
    });
    // No window command comes of a drop on the events target.
    expect(canAdd(labels.id, { kind: "events" }, [], unitOf)).toBe(false);
    expect(dropTargetOf(el({ "data-drop": "bogus" }))).toBe(undefined);
    expect(dropTargetOf(el({}))).toBe(undefined);
    expect(dropTargetOf(null)).toBe(undefined);
    expect(dropTargetOf(undefined)).toBe(undefined);
  });

  it("treats a drop below the windows like + New window", () => {
    const strip: DropTarget = { kind: "new", place: "strip" };
    const below: DropTarget = { kind: "new", place: "below" };
    const windows = [win("wA", ["c/SPEED_DISP", "c/WSPD_FL"]), win("wB", ["c/PTC"])];
    const source: DragSource = { windowId: "wA", assignmentId: "awA0", signalId: "c/SPEED_DISP" };
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
    const solo = [win("wA", ["c/SPEED_DISP"])];
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
    expect(canAdd("c/SPEED_DISP", below, windows, unitOf)).toBe(true);
    expect(canAdd("c/SPEED_DISP", below, [], unitOf)).toBe(true);
  });

  it("highlights a window for a selection while one signal is new", () => {
    // wA shows both selected signals; wE shows one of them; wD shows both plus another.
    const wins = [
      win("wA", ["c/SPEED_DISP", "c/WSPD_FL"]),
      win("wD", ["c/SPEED_DISP", "c/WSPD_FL", "c/EAC"]),
    ];
    const showsOne = [win("wE", ["c/SPEED_DISP"])];
    const sel: ExplorerDragSource = {
      signalId: "c/SPEED_DISP",
      signalIds: ["c/SPEED_DISP", "c/WSPD_FL"],
    };
    const only = { kind: "window", windowId: "wA" } as const;
    expect(dropStateFor(sel, "wE", showsOne, unitOf)).toBe("target");
    expect(canAddAny(sel.signalIds ?? [], { kind: "window", windowId: "wE" }, showsOne)).toBe(true);
    // A window showing all of them is not highlighted.
    expect(dropStateFor(sel, "wA", wins, unitOf)).toBe(undefined);
    expect(canAddAny(sel.signalIds ?? [], only, wins)).toBe(false);
    expect(dropStateFor(sel, "wD", wins, unitOf)).toBe(undefined);
    // A window with four other units is a target, never "refused": overflow handles the units.
    const crowded = [win("wC", ["c/PTC", "c/T_ENG", "c/MOT_SPD_D", "c/NOUNIT"])];
    expect(dropStateFor(sel, "wC", crowded, unitOf)).toBe("target");
    // A single-signal explorer source still gets "refused" there.
    expect(dropStateFor({ signalId: "c/SPEED_DISP" }, "wC", crowded, unitOf)).toBe("refused");
    // "+ New window" always accepts, the strip is eventsDrop's.
    expect(canAddAny(["c/SPEED_DISP", "c/WSPD_FL"], { kind: "new" }, [])).toBe(true);
    expect(canAddAny(["c/SPEED_DISP", "c/WSPD_FL"], { kind: "new", place: "below" }, wins)).toBe(
      true,
    );
    expect(canAddAny(["c/SPEED_DISP", "c/WSPD_FL"], { kind: "events" }, wins)).toBe(false);
    expect(canAddAny(["c/SPEED_DISP"], { kind: "window", windowId: "nope" }, wins)).toBe(false);
  });

  it("adds the selection's new state signals on the strip", () => {
    const info = (name: string, states?: SignalInfo["states"]): SignalInfo => ({
      id: `car/${name}`,
      dataRef: "car",
      name,
      ...(states ? { states } : {}),
    });
    const states = "labels" as const;
    const infos: Record<string, SignalInfo> = {
      "car/S1": info("S1", states),
      "car/PLAIN": info("PLAIN"),
      "car/S2": info("S2", states),
      "car/S3": info("S3", states),
    };
    const infoOf = (id: string) => infos[id];
    const ws = { ...EMPTY_WORKSPACE, eventSignals: ["car/S3"] };
    expect(
      eventsDropMany(["car/S1", "car/PLAIN", "car/S3", "car/S2", "car/MISSING"], infoOf, ws),
    ).toEqual(["car/S1", "car/S2"]);
    expect(eventsDropMany(["car/PLAIN", "car/S3"], infoOf, ws)).toEqual([]);
    expect(eventsDropMany([], infoOf, EMPTY_WORKSPACE)).toEqual([]);
  });
});
