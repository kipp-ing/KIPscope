import { describe, expect, it } from "vitest";
import { applyCommand } from "../src/apply.ts";
import { type CaseCatalog, type CaseEntry, caseScope, objectSpan } from "../src/case.ts";
import { openCase } from "../src/caseApply.ts";
import {
  Command,
  type CommandInput,
  EMPTY_WORKSPACE,
  MAX_EVENT_SIGNALS,
  SIGNAL_COLORS,
  type TimeseriesWindow,
  type Workspace,
  type WorkspaceScope,
  windowTitle,
} from "../src/workspace.ts";
import { at, C4, MIN as CASE_MIN, PAD } from "./caseFixtures.ts";

const ctx = { signalExists: (id: string) => id.startsWith("car/"), hasStates: () => false };

/** Units of the synthetic signals; N* have no unit (undefined, empty or blank). */
const UNITS: Record<string, string | undefined> = {
  "car/V1": "V",
  "car/V2": "V",
  "car/KMH": "km/h",
  "car/DEG": "°C",
  "car/RPM": "1/min",
  "car/DN": "rpm/10ms",
  "car/N1": undefined,
  "car/N2": "",
  "car/N3": "  ",
  "car/N4": undefined,
  "car/N5": undefined,
};
const unitCtx = { ...ctx, unitOf: (id: string) => (id in UNITS ? UNITS[id] : "generic") };

function run(
  state: Workspace,
  input: CommandInput,
  context: typeof unitCtx | typeof ctx = unitCtx,
) {
  return applyCommand(state, Command.parse(input), context);
}

function ok(state: Workspace, input: CommandInput) {
  const result = run(state, input);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

const create = { type: "window.create", from: "0", to: "1000" } as const;

describe("applyCommand", () => {
  it("creates windows with stable IDs and default display", () => {
    const r1 = ok(EMPTY_WORKSPACE, create);
    const r2 = ok(r1.workspace, { ...create, title: "Second", mode: "step" });
    expect(r1.created).toBe("w1");
    expect(r2.created).toBe("w2");
    expect(r2.workspace.windows).toEqual([
      {
        id: "w1",
        kind: "timeseries",
        range: { from: "0", to: "1000" },
        display: { mode: "line", envelope: false },
        signals: [],
      },
      {
        id: "w2",
        kind: "timeseries",
        title: "Second",
        range: { from: "0", to: "1000" },
        display: { mode: "step", envelope: false },
        signals: [],
      },
    ]);
  });

  it("adds and removes signals with assignment IDs", () => {
    const w = ok(EMPTY_WORKSPACE, create).workspace;
    const added = ok(w, { type: "window.addSignal", windowId: "w1", signalId: "car/A" });
    expect(added.created).toBe("a2");
    expect(added.workspace.windows[0]?.signals).toEqual([{ id: "a2", signalId: "car/A" }]);
    const removed = ok(added.workspace, {
      type: "window.removeSignal",
      windowId: "w1",
      assignmentId: "a2",
    });
    expect(removed.workspace.windows[0]?.signals).toEqual([]);
  });

  it("sets range and display of one window only", () => {
    let s = ok(EMPTY_WORKSPACE, { type: "workspace.setLinkTime", linked: false }).workspace;
    s = ok(s, create).workspace;
    s = ok(s, create).workspace;
    s = ok(s, { type: "window.setRange", windowId: "w1", from: "10", to: "20" }).workspace;
    s = ok(s, { type: "window.setDisplay", windowId: "w1", envelope: true }).workspace;
    expect(s.windows[0]).toMatchObject({
      range: { from: "10", to: "20" },
      display: { mode: "line", envelope: true },
    });
    expect(s.windows[1]).toMatchObject({
      range: { from: "0", to: "1000" },
      display: { mode: "line", envelope: false },
    });
  });

  it("removes windows", () => {
    const s = ok(EMPTY_WORKSPACE, create).workspace;
    expect(ok(s, { type: "window.remove", windowId: "w1" }).workspace.windows).toEqual([]);
  });

  it("rejects unknown IDs and leaves the state unchanged", () => {
    const s = ok(EMPTY_WORKSPACE, create).workspace;
    const frozen = structuredClone(s);
    const cases: [CommandInput, string][] = [
      [{ type: "window.remove", windowId: "w9" }, "unknown_window"],
      [{ type: "window.addSignal", windowId: "w9", signalId: "car/A" }, "unknown_window"],
      [{ type: "window.addSignal", windowId: "w1", signalId: "other/A" }, "unknown_signal"],
      [{ type: "window.removeSignal", windowId: "w1", assignmentId: "a9" }, "unknown_assignment"],
      [{ type: "window.setRange", windowId: "w1", from: "5", to: "5" }, "invalid_range"],
      [{ type: "window.create", from: "5", to: "1" }, "invalid_range"],
    ];
    for (const [input, code] of cases) {
      const result = run(s, input);
      expect(result).toMatchObject({ ok: false, code });
    }
    expect(s).toEqual(frozen);
  });

  it("allows at most 50 distinct signals across windows", () => {
    let s = ok(ok(EMPTY_WORKSPACE, create).workspace, create).workspace;
    for (let i = 0; i < 50; i++) {
      const windowId = i % 2 ? "w1" : "w2";
      s = ok(s, { type: "window.addSignal", windowId, signalId: `car/S${i}` }).workspace;
    }
    const over = run(s, { type: "window.addSignal", windowId: "w1", signalId: "car/S50" });
    expect(over).toMatchObject({ ok: false, code: "signal_limit" });
    // A signal already shown elsewhere does not count again.
    const again = ok(s, { type: "window.addSignal", windowId: "w1", signalId: "car/S0" });
    expect(again.workspace.windows[0]?.signals).toHaveLength(26);
  });
});

/** Workspace with `n` windows (linked, range 0..1000). */
function windows(n: number): Workspace {
  let s = EMPTY_WORKSPACE;
  for (let i = 0; i < n; i++) s = ok(s, create).workspace;
  return s;
}

function add(s: Workspace, windowId: string, signalId: string) {
  return ok(s, { type: "window.addSignal", windowId, signalId });
}

/** The window with this ID, typed as timeseries (tests of values windows assert on its shape). */
const win = (s: Workspace, id: string) =>
  s.windows.find((w) => w.id === id) as TimeseriesWindow | undefined;

describe("moving and copying signals", () => {
  // w1 shows car/V1 as assignment `a`; w3 is empty.
  function setup() {
    const added = add(windows(3), "w1", "car/V1");
    return { s: added.workspace, a: added.created as string };
  }

  it("moves a signal keeping assignment ID and colour", () => {
    const { s, a } = setup();
    const colorBefore = s.colors["car/V1"];
    const r = ok(s, {
      type: "window.moveSignal",
      windowId: "w1",
      assignmentId: a,
      targetWindowId: "w3",
    });
    // The emptied source window is removed (improve-layout L7).
    expect(win(r.workspace, "w1")).toBeUndefined();
    expect(r.removedWindow).toBe("w1");
    expect(win(r.workspace, "w3")?.signals).toEqual([{ id: a, signalId: "car/V1" }]);
    expect(r.workspace.colors["car/V1"]).toBe(colorBefore);
    expect(colorBefore).toBe(0);
  });

  it("copies a signal with a new assignment ID", () => {
    const { s, a } = setup();
    const r = ok(s, {
      type: "window.moveSignal",
      windowId: "w1",
      assignmentId: a,
      targetWindowId: "w3",
      copy: true,
    });
    expect(r.created).toBeDefined();
    expect(r.created).not.toBe(a);
    expect(win(r.workspace, "w1")?.signals).toEqual([{ id: a, signalId: "car/V1" }]);
    expect(win(r.workspace, "w3")?.signals).toEqual([{ id: r.created, signalId: "car/V1" }]);
    expect(Object.keys(r.workspace.colors)).toEqual(["car/V1"]);
  });

  it("removes a window emptied by a move", () => {
    const { s, a } = setup();
    const r = ok(s, {
      type: "window.moveSignal",
      windowId: "w1",
      assignmentId: a,
      targetWindowId: "w2",
    });
    expect(r.workspace.windows.map((w) => w.id)).toEqual(["w2", "w3"]);
    expect(r.removedWindow).toBe("w1");
    expect(r.created).toBeUndefined();
    expect(win(r.workspace, "w2")?.signals).toEqual([{ id: a, signalId: "car/V1" }]);
    // One command, one removal: the other windows and colours are untouched.
    expect(r.workspace.colors).toEqual({ "car/V1": 0 });

    // A values window emptied by a move is removed as well.
    const v = ok(s, { type: "window.create", kind: "values" });
    const vId = v.created as string;
    const va = add(v.workspace, vId, "car/KMH");
    const vm = ok(va.workspace, {
      type: "window.moveSignal",
      windowId: vId,
      assignmentId: va.created as string,
      targetWindowId: "w2",
    });
    expect(vm.removedWindow).toBe(vId);
    expect(vm.workspace.windows.map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
    expect(win(vm.workspace, "w2")?.signals).toEqual([{ id: va.created, signalId: "car/KMH" }]);
  });

  it("moves the only signal into a new window and removes the source", () => {
    const { s, a } = setup();
    const r = ok(s, { type: "window.moveSignal", windowId: "w1", assignmentId: a });
    expect(r.createdWindow).toBeDefined();
    expect(r.removedWindow).toBe("w1");
    expect(r.workspace.windows.map((w) => w.id)).toEqual(["w2", "w3", r.createdWindow]);
    expect(win(r.workspace, r.createdWindow as string)).toMatchObject({
      range: { from: "0", to: "1000" },
      signals: [{ id: a, signalId: "car/V1" }],
    });
    expect(r.workspace.colors["car/V1"]).toBe(0);
  });

  it("keeps a window emptied by removeSignal, a copy or a refused move", () => {
    const { s, a } = setup();
    const removed = ok(s, { type: "window.removeSignal", windowId: "w1", assignmentId: a });
    expect(removed.removedWindow).toBeUndefined();
    expect(removed.workspace.windows.map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
    expect(win(removed.workspace, "w1")?.signals).toEqual([]);

    // A copy leaves the source with its signal; the target gets its own.
    const copy = ok(s, {
      type: "window.moveSignal",
      windowId: "w1",
      assignmentId: a,
      targetWindowId: "w2",
      copy: true,
    });
    expect(copy.removedWindow).toBeUndefined();
    expect(copy.workspace.windows.map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
    expect(win(copy.workspace, "w1")?.signals).toHaveLength(1);

    // A refused move (the target already shows the signal) changes nothing.
    const both = add(s, "w2", "car/V1").workspace;
    const refused = run(both, {
      type: "window.moveSignal",
      windowId: "w1",
      assignmentId: a,
      targetWindowId: "w2",
    });
    expect(refused).toMatchObject({ ok: false, code: "already_in_window" });
    expect(both.windows.map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
  });

  it("clears lastZoomed when a move removes that window", () => {
    let s = ok(EMPTY_WORKSPACE, { type: "workspace.setLinkTime", linked: false }).workspace;
    s = ok(s, { type: "window.create", from: "1", to: "2" }).workspace;
    s = ok(s, { type: "window.create", from: "5", to: "6" }).workspace;
    s = ok(s, { type: "window.setRange", windowId: "w2", from: "7", to: "9" }).workspace;
    expect(s.lastZoomed).toBe("w2");
    const added = add(s, "w2", "car/V1");
    const moved = ok(added.workspace, {
      type: "window.moveSignal",
      windowId: "w2",
      assignmentId: added.created as string,
      targetWindowId: "w1",
    });
    expect(moved.removedWindow).toBe("w2");
    expect(moved.workspace.lastZoomed).toBeUndefined();
    // Another window's lastZoomed survives a removal elsewhere.
    const other = ok(added.workspace, {
      type: "window.moveSignal",
      windowId: "w2",
      assignmentId: added.created as string,
      targetWindowId: "w1",
      copy: true,
    });
    expect(other.workspace.lastZoomed).toBe("w2");
  });

  it("rejects a move into a window that already shows the signal", () => {
    const { s, a } = setup();
    const both = add(s, "w2", "car/V1").workspace;
    const frozen = structuredClone(both);
    for (const target of ["w2", "w1"]) {
      for (const copy of [false, true]) {
        const r = run(both, {
          type: "window.moveSignal",
          windowId: "w1",
          assignmentId: a,
          targetWindowId: target,
          copy,
        });
        expect(r).toMatchObject({ ok: false, code: "already_in_window" });
      }
    }
    expect(both).toEqual(frozen);
  });

  it("moves and copies into a new window with the source range and display", () => {
    let { s, a } = setup();
    s = ok(s, { type: "window.setDisplay", windowId: "w1", mode: "step" }).workspace;
    s = ok(s, { type: "window.setHeight", windowId: "w1", height: 400 }).workspace;
    s = ok(s, { type: "window.rename", windowId: "w1", title: "Source" }).workspace;
    const moved = ok(s, { type: "window.moveSignal", windowId: "w1", assignmentId: a });
    expect(moved.createdWindow).toBe("w5");
    expect(moved.removedWindow).toBe("w1"); // w1 held only this signal
    expect(moved.workspace.windows.map((w) => w.id)).toEqual(["w2", "w3", "w5"]);
    const fresh = win(moved.workspace, "w5");
    expect(fresh).toMatchObject({
      kind: "timeseries",
      range: { from: "0", to: "1000" },
      display: { mode: "step", envelope: false },
      height: 400,
      signals: [{ id: a, signalId: "car/V1" }],
    });
    expect(fresh).not.toHaveProperty("title");

    const copied = ok(s, {
      type: "window.moveSignal",
      windowId: "w1",
      assignmentId: a,
      copy: true,
    });
    expect(copied.createdWindow).toBe("w5");
    expect(copied.created).toBeDefined();
    expect(win(copied.workspace, "w1")?.signals).toHaveLength(1);
    expect(win(copied.workspace, "w5")?.signals).toEqual([
      { id: copied.created, signalId: "car/V1" },
    ]);
  });

  it("rejects unknown windows and assignments in a move", () => {
    const { s, a } = setup();
    const cases: [CommandInput, string][] = [
      [{ type: "window.moveSignal", windowId: "w9", assignmentId: a }, "unknown_window"],
      [{ type: "window.moveSignal", windowId: "w1", assignmentId: "a99" }, "unknown_assignment"],
      [
        { type: "window.moveSignal", windowId: "w1", assignmentId: a, targetWindowId: "w9" },
        "unknown_window",
      ],
    ];
    for (const [input, code] of cases) expect(run(s, input)).toMatchObject({ ok: false, code });
  });
});

describe("linked time axes", () => {
  it("applies a range to all windows while linked", () => {
    const s = windows(3);
    expect(s.linkTime).toBe(true);
    const r = ok(s, { type: "window.setRange", windowId: "w2", from: "10", to: "20" });
    for (const w of r.workspace.windows)
      expect((w as TimeseriesWindow).range).toEqual({ from: "10", to: "20" });
  });

  it("applies a range to one window while unlinked", () => {
    let s = ok(EMPTY_WORKSPACE, { type: "workspace.setLinkTime", linked: false }).workspace;
    s = ok(s, create).workspace;
    s = ok(s, { type: "window.create", from: "500", to: "2000" }).workspace;
    s = ok(s, { type: "window.setRange", windowId: "w1", from: "10", to: "20" }).workspace;
    expect(win(s, "w1")?.range).toEqual({ from: "10", to: "20" });
    expect(win(s, "w2")?.range).toEqual({ from: "500", to: "2000" });
  });

  it("creates a window with the shared range while linked", () => {
    let s = ok(windows(1), {
      type: "window.setRange",
      windowId: "w1",
      from: "10",
      to: "20",
    }).workspace;
    s = ok(s, { type: "window.create" }).workspace;
    expect(win(s, "w2")?.range).toEqual({ from: "10", to: "20" });
    expect(run(EMPTY_WORKSPACE, { type: "window.create" })).toMatchObject({
      ok: false,
      code: "invalid_range",
    });
  });

  it("snaps all windows to the last zoomed window when linking", () => {
    let s = ok(EMPTY_WORKSPACE, { type: "workspace.setLinkTime", linked: false }).workspace;
    s = ok(s, create).workspace;
    s = ok(s, { type: "window.create", from: "500", to: "2000" }).workspace;
    s = ok(s, { type: "window.setRange", windowId: "w1", from: "10", to: "20" }).workspace;
    s = ok(s, { type: "window.setRange", windowId: "w2", from: "30", to: "40" }).workspace;
    const linked = ok(s, { type: "workspace.setLinkTime", linked: true }).workspace;
    expect(linked.linkTime).toBe(true);
    for (const w of linked.windows)
      expect((w as TimeseriesWindow).range).toEqual({ from: "30", to: "40" });
    // Switching off changes no range.
    const off = ok(linked, { type: "workspace.setLinkTime", linked: false }).workspace;
    expect(off.windows.map((w) => (w as TimeseriesWindow).range)).toEqual(
      linked.windows.map((w) => (w as TimeseriesWindow).range),
    );

    // The last zoomed window is gone: the first window wins.
    let t = ok(off, { type: "window.setRange", windowId: "w2", from: "70", to: "80" }).workspace;
    t = ok(t, { type: "window.create", from: "5", to: "6" }).workspace;
    t = ok(t, { type: "window.remove", windowId: "w3" }).workspace;
    t = ok(t, { type: "workspace.setLinkTime", linked: true }).workspace;
    for (const w of t.windows)
      expect((w as TimeseriesWindow).range).toEqual({ from: "30", to: "40" });
  });
});

describe("window title and height", () => {
  it("renames and clears window titles", () => {
    const s = windows(6);
    const renamed = ok(s, {
      type: "window.rename",
      windowId: "w6",
      title: "  HV voltages ",
    }).workspace;
    expect(win(renamed, "w6")?.title).toBe("HV voltages");
    expect(windowTitle(win(renamed, "w6") as never)).toBe("HV voltages");
    const cleared = ok(renamed, { type: "window.rename", windowId: "w6", title: "" }).workspace;
    expect(win(cleared, "w6")).not.toHaveProperty("title");
    expect(windowTitle(win(cleared, "w6") as never)).toBe("Window 6");
    const blank = ok(renamed, { type: "window.rename", windowId: "w6", title: "   " }).workspace;
    expect(win(blank, "w6")).not.toHaveProperty("title");
    expect(run(s, { type: "window.rename", windowId: "w9", title: "x" })).toMatchObject({
      ok: false,
      code: "unknown_window",
    });
  });

  it("sets window height within bounds", () => {
    const s = ok(windows(1), { type: "window.setHeight", windowId: "w1", height: 400 }).workspace;
    expect(win(s, "w1")?.height).toBe(400);
    for (const height of [100, 119, 1201, 300.5]) {
      const bad = { type: "window.setHeight", windowId: "w1", height };
      expect(Command.safeParse(bad).success).toBe(false);
    }
    for (const height of [120, 1200]) {
      const edge = ok(s, { type: "window.setHeight", windowId: "w1", height }).workspace;
      expect(win(edge, "w1")?.height).toBe(height);
    }
    expect(win(s, "w1")?.height).toBe(400);
  });
});

describe("stable signal colours", () => {
  it("assigns stable colours across windows", () => {
    let s = windows(2);
    s = add(s, "w1", "car/V1").workspace;
    s = add(s, "w2", "car/KMH").workspace;
    const first = s.windows[0]?.signals[0];
    const copied = ok(s, {
      type: "window.moveSignal",
      windowId: "w1",
      assignmentId: first?.id as string,
      targetWindowId: "w2",
      copy: true,
    }).workspace;
    expect(copied.colors["car/V1"]).toBe(0);
    expect(copied.colors["car/KMH"]).toBe(1);
    expect(copied.colors["car/V1"]).not.toBe(copied.colors["car/KMH"]);
    // Adding the same signal again does not change its colour.
    const again = add(copied, "w1", "car/KMH").workspace;
    expect(again.colors).toEqual(copied.colors);
    expect(SIGNAL_COLORS).toHaveLength(10);
  });

  it("frees colours of signals that left the workspace", () => {
    let s = windows(1);
    const a = add(s, "w1", "car/V1");
    s = add(a.workspace, "w1", "car/KMH").workspace; // V1 → 0, KMH → 1
    expect(s.colors).toEqual({ "car/V1": 0, "car/KMH": 1 });
    s = ok(s, {
      type: "window.removeSignal",
      windowId: "w1",
      assignmentId: a.created as string,
    }).workspace;
    expect(s.colors).toEqual({ "car/KMH": 1 });
    s = add(s, "w1", "car/DEG").workspace;
    expect(s.colors["car/DEG"]).toBe(0);
    // Removing a whole window frees its signals too.
    s = ok(s, { type: "window.remove", windowId: "w1" }).workspace;
    expect(s.colors).toEqual({});
  });

  it("uses the least used palette colour once the palette is exhausted", () => {
    let s = windows(1);
    for (let i = 0; i < 11; i++) {
      const r = applyCommand(
        s,
        Command.parse({ type: "window.addSignal", windowId: "w1", signalId: `car/P${i}` }),
        ctx, // no unit lookup: the unit limit is not checked
      );
      if (!r.ok) throw new Error(r.message);
      s = r.workspace;
    }
    // Ten signals use indices 0..9, the eleventh takes the lowest of the least used: 0.
    expect(s.colors["car/P9"]).toBe(9);
    expect(s.colors["car/P10"]).toBe(0);
  });
});

describe("at most four units per window", () => {
  function fourUnits() {
    let s = windows(2);
    for (const id of ["car/V1", "car/KMH", "car/DEG", "car/RPM"]) s = add(s, "w1", id).workspace;
    return s;
  }

  it("rejects a fifth unit in a window", () => {
    const s = fourUnits();
    const frozen = structuredClone(s);
    const rejected = run(s, { type: "window.addSignal", windowId: "w1", signalId: "car/DN" });
    expect(rejected).toMatchObject({ ok: false, code: "too_many_units" });
    expect(rejected.ok ? "" : rejected.message).toContain("V, km/h, °C, 1/min");
    expect(s).toEqual(frozen);
    // A fifth signal of an existing unit is fine.
    expect(win(add(s, "w1", "car/V2").workspace, "w1")?.signals).toHaveLength(5);

    // Moving or copying a fifth unit into the full window is rejected, into a new window not.
    const source = add(s, "w2", "car/DN");
    const a = source.created as string;
    for (const copy of [false, true]) {
      const r = run(source.workspace, {
        type: "window.moveSignal",
        windowId: "w2",
        assignmentId: a,
        targetWindowId: "w1",
        copy,
      });
      expect(r).toMatchObject({ ok: false, code: "too_many_units" });
    }
    const fresh = ok(source.workspace, {
      type: "window.moveSignal",
      windowId: "w2",
      assignmentId: a,
    });
    expect(fresh.createdWindow).toBeDefined();
    // A same-unit signal may move in.
    const v2 = add(source.workspace, "w2", "car/V2");
    const into = ok(v2.workspace, {
      type: "window.moveSignal",
      windowId: "w2",
      assignmentId: v2.created as string,
      targetWindowId: "w1",
    });
    expect(win(into.workspace, "w1")?.signals).toHaveLength(5);
  });

  it("does not check units without a unit lookup", () => {
    const s = fourUnits();
    const r = run(s, { type: "window.addSignal", windowId: "w1", signalId: "car/DN" }, ctx);
    expect(r.ok).toBe(true);
  });

  it("counts unit-less signals as their own unit", () => {
    let s = windows(2);
    for (const id of ["car/N1", "car/N2", "car/N3", "car/N4"]) s = add(s, "w1", id).workspace;
    expect(run(s, { type: "window.addSignal", windowId: "w1", signalId: "car/N5" })).toMatchObject({
      ok: false,
      code: "too_many_units",
    });
    const moving = add(s, "w2", "car/N5");
    const r = run(moving.workspace, {
      type: "window.moveSignal",
      windowId: "w2",
      assignmentId: moving.created as string,
      targetWindowId: "w1",
    });
    expect(r).toMatchObject({ ok: false, code: "too_many_units" });
  });
});

describe("untitled windows (lead decision a)", () => {
  it("titles a window created without a title as Window <n>", () => {
    let s = ok(EMPTY_WORKSPACE, create).workspace;
    s = ok(s, create).workspace;
    expect(s.windows[0]?.title).toBeUndefined();
    expect(windowTitle(s.windows[0] as never)).toBe("Window 1");
    expect(windowTitle(s.windows[1] as never)).toBe("Window 2");
    // A signal added later does not give the window a title.
    s = ok(s, { type: "window.addSignal", windowId: "w1", signalId: "car/V1" }).workspace;
    expect(windowTitle(s.windows[0] as never)).toBe("Window 1");
  });
});

describe("cursors and values windows (add-cursors)", () => {
  const A1 = "1791896880093000000"; // 2026-10-13T13:08:00.093Z
  const A2 = "1791896880995000000"; // A1 + 902 ms

  /** Workspace with a values window `w1` (id taken from the create result). */
  function withValues(base: Workspace = EMPTY_WORKSPACE) {
    const r = ok(base, { type: "window.create", kind: "values" });
    return { s: r.workspace, id: r.created as string };
  }

  it("starts with both cursors off and diff off", () => {
    expect(EMPTY_WORKSPACE.cursors).toEqual({ diff: false });
    expect(Object.keys(EMPTY_WORKSPACE.cursors)).toEqual(["diff"]);
  });

  it("sets, moves and removes cursors", () => {
    const set = ok(EMPTY_WORKSPACE, {
      type: "cursor.set",
      cursor: "a",
      t: "2026-10-13T13:08:00.093Z",
    });
    expect(set.workspace.cursors).toEqual({ a: A1, diff: false });
    const moved = ok(set.workspace, { type: "cursor.move", cursor: "a", by: "902000000" });
    expect(moved.workspace.cursors).toEqual({ a: A2, diff: false });
    const diff = ok(moved.workspace, { type: "cursor.setDiff", diff: true });
    expect(diff.workspace.cursors).toEqual({ a: A2, diff: true });
    const backwards = ok(diff.workspace, { type: "cursor.move", cursor: "a", by: "-902000000" });
    expect(backwards.workspace.cursors.a).toBe(A1);
    const off = ok(diff.workspace, { type: "cursor.remove", cursor: "a" });
    expect(off.workspace.cursors).toEqual({ diff: true });
    expect("a" in off.workspace.cursors).toBe(false);
    // B is independent of A; removing an off cursor is accepted and changes nothing.
    const b = ok(off.workspace, { type: "cursor.set", cursor: "b", t: A2 });
    expect(b.workspace.cursors).toEqual({ b: A2, diff: true });
    const again = ok(off.workspace, { type: "cursor.remove", cursor: "a" });
    expect(again.workspace.cursors).toEqual({ diff: true });
  });

  it("rejects moving an off cursor or past the time bounds", () => {
    const set = ok(EMPTY_WORKSPACE, { type: "cursor.set", cursor: "a", t: A1 }).workspace;
    const frozen = structuredClone(set);
    expect(run(set, { type: "cursor.move", cursor: "b", by: "1000" })).toMatchObject({
      ok: false,
      code: "cursor_off",
    });
    const past = run(set, { type: "cursor.move", cursor: "a", by: "-9000000000000000000" });
    expect(past).toMatchObject({ ok: false, code: "invalid_command" });
    if (!past.ok) expect(past.message).toContain("1900-01-01T00:00:00Z");
    const beyond = run(set, { type: "cursor.move", cursor: "a", by: "9000000000000000000" });
    expect(beyond).toMatchObject({ ok: false, code: "invalid_command" });
    // cursor.set outside the bounds is invalid at parse time (TimeInput).
    expect(() =>
      Command.parse({ type: "cursor.set", cursor: "a", t: "9223286400000000001" }),
    ).toThrow();
    expect(set).toEqual(frozen);
  });

  it("creates a values window without range", () => {
    const { s, id } = withValues();
    expect(id).toBe("w1");
    expect(s.windows).toEqual([{ id: "w1", kind: "values", mode: "line", signals: [] }]);
    const w = s.windows[0] as unknown as Record<string, unknown>;
    expect(w.range).toBeUndefined();
    expect(w.display).toBeUndefined();
    expect(w.height).toBeUndefined();
    expect(windowTitle(s.windows[0] as Workspace["windows"][number])).toBe("Values 1");
    // A values window can be created before any timeseries window while linked.
    const step = ok(EMPTY_WORKSPACE, { type: "window.create", kind: "values", mode: "step" });
    expect((step.workspace.windows[0] as { mode: string }).mode).toBe("step");
    // from, to and envelope are refused with kind "values".
    for (const extra of [{ from: "0" }, { to: "10" }, { envelope: true }, { mode: "markers" }]) {
      expect(() => Command.parse({ type: "window.create", kind: "values", ...extra })).toThrow();
    }
  });

  it("rejects range, height and envelope commands on a values window", () => {
    const { s, id } = withValues();
    const frozen = structuredClone(s);
    const rejected: CommandInput[] = [
      { type: "window.setRange", windowId: id, from: "0", to: "10" },
      { type: "window.setHeight", windowId: id, height: 400 },
      { type: "window.setDisplay", windowId: id, envelope: true },
      { type: "window.setDisplay", windowId: id, mode: "markers" },
    ];
    for (const input of rejected) {
      expect(run(s, input)).toMatchObject({ ok: false, code: "invalid_command" });
    }
    expect(s).toEqual(frozen);
    const step = ok(s, { type: "window.setDisplay", windowId: id, mode: "step" });
    expect((step.workspace.windows[0] as { mode: string }).mode).toBe("step");
    // Rename works on a values window.
    const renamed = ok(s, { type: "window.rename", windowId: id, title: "Drive" });
    expect(windowTitle(renamed.workspace.windows[0] as Workspace["windows"][number])).toBe("Drive");
  });

  it("adds any number of units to a values window", () => {
    const { s, id } = withValues();
    let cur = s;
    for (const sig of ["car/V1", "car/KMH", "car/DEG", "car/RPM", "car/DN"]) {
      cur = add(cur, id, sig).workspace; // five units: V, km/h, °C, 1/min, rpm/10ms
    }
    expect(cur.windows[0]?.signals).toHaveLength(5);
    // Moving a signal in from a timeseries window is accepted as well.
    const made = ok(cur, create); // IDs share one counter with the assignments
    const tsId = made.created as string;
    const base = made.workspace;
    const src = add(base, tsId, "car/N1");
    const moved = ok(src.workspace, {
      type: "window.moveSignal",
      windowId: tsId,
      assignmentId: src.created as string,
      targetWindowId: id,
    });
    expect(win(moved.workspace, id)?.signals).toHaveLength(6);
    // A signal the values window already shows is refused on a move.
    const dup = add(base, tsId, "car/V1");
    expect(
      run(dup.workspace, {
        type: "window.moveSignal",
        windowId: tsId,
        assignmentId: dup.created as string,
        targetWindowId: id,
      }),
    ).toMatchObject({ ok: false, code: "already_in_window" });
  });

  it("rejects adding a signal the window already shows", () => {
    const { s, id } = withValues();
    const made = ok(s, create);
    const tsId = made.created as string;
    let cur = add(add(made.workspace, id, "car/KMH").workspace, tsId, "car/KMH").workspace;
    const frozen = structuredClone(cur);
    // Both window kinds refuse a second SPEED_DISP; the workspace and its ID counter stay unchanged.
    for (const windowId of [id, tsId]) {
      expect(run(cur, { type: "window.addSignal", windowId, signalId: "car/KMH" })).toMatchObject({
        ok: false,
        code: "already_in_window",
      });
    }
    expect(cur).toEqual(frozen);
    // After removing it, the window takes the signal again.
    const assignment = win(cur, tsId)?.signals[0]?.id as string;
    cur = ok(cur, {
      type: "window.removeSignal",
      windowId: tsId,
      assignmentId: assignment,
    }).workspace;
    expect(win(add(cur, tsId, "car/KMH").workspace, tsId)?.signals).toHaveLength(1);
  });

  it("keeps values windows out of linked ranges", () => {
    // Values window first (w1), timeseries window second (w2).
    let s = withValues().s;
    s = ok(s, { type: "window.create", from: "100", to: "200" }).workspace;
    expect(win(s, "w2")?.range).toEqual({ from: "100", to: "200" });
    s = ok(s, { type: "window.setRange", windowId: "w2", from: "10", to: "20" }).workspace;
    expect(win(s, "w1")).not.toHaveProperty("range");
    s = ok(s, { type: "window.create" }).workspace;
    expect(win(s, "w3")?.range).toEqual({ from: "10", to: "20" });
    expect(win(s, "w1")).not.toHaveProperty("range");
    // Unlink, zoom w3, re-link: the values window is still without range and w2 snaps to w3.
    s = ok(s, { type: "workspace.setLinkTime", linked: false }).workspace;
    s = ok(s, { type: "window.setRange", windowId: "w3", from: "30", to: "40" }).workspace;
    s = ok(s, { type: "workspace.setLinkTime", linked: true }).workspace;
    expect(win(s, "w2")?.range).toEqual({ from: "30", to: "40" });
    expect(win(s, "w1")).not.toHaveProperty("range");
    // Only a values window: a linked timeseries create has no range to take.
    expect(run(withValues().s, { type: "window.create" })).toMatchObject({
      ok: false,
      code: "invalid_range",
    });
  });

  it("moves a signal from a values window into a new timeseries window", () => {
    // w1 timeseries, w2 values (with V1), w3 timeseries; w3 was zoomed last.
    let s = ok(EMPTY_WORKSPACE, { type: "workspace.setLinkTime", linked: false }).workspace;
    s = ok(s, { type: "window.create", from: "1", to: "2" }).workspace;
    s = withValues(s).s;
    s = ok(s, {
      type: "window.create",
      from: "5",
      to: "6",
      mode: "step",
      envelope: true,
    }).workspace;
    s = ok(s, { type: "window.setHeight", windowId: "w3", height: 400 }).workspace;
    s = ok(s, { type: "window.setRange", windowId: "w3", from: "7", to: "9" }).workspace;
    const added = add(s, "w2", "car/V1");
    const moved = ok(added.workspace, {
      type: "window.moveSignal",
      windowId: "w2",
      assignmentId: added.created as string,
    });
    const newId = moved.createdWindow as string;
    expect(newId).toMatch(/^w\d+$/);
    expect(moved.removedWindow).toBe("w2");
    expect(win(moved.workspace, "w2")).toBeUndefined();
    expect(win(moved.workspace, newId)).toEqual({
      id: newId,
      kind: "timeseries",
      range: { from: "7", to: "9" },
      display: { mode: "line", envelope: false },
      signals: [{ id: added.created, signalId: "car/V1" }],
    });
    // Copy keeps the signal in the values window.
    const copy = ok(added.workspace, {
      type: "window.moveSignal",
      windowId: "w2",
      assignmentId: added.created as string,
      copy: true,
    });
    expect(win(copy.workspace, "w2")?.signals).toHaveLength(1);

    // Without a timeseries window: invalid_range, nothing changes.
    const only = withValues().s;
    const a2 = add(only, "w1", "car/V1");
    const frozen = structuredClone(a2.workspace);
    expect(
      run(a2.workspace, {
        type: "window.moveSignal",
        windowId: "w1",
        assignmentId: a2.created as string,
      }),
    ).toMatchObject({ ok: false, code: "invalid_range" });
    expect(a2.workspace).toEqual(frozen);

    // No lastZoomed: the first timeseries window supplies the range.
    let t = ok(withValues().s, { type: "workspace.setLinkTime", linked: false }).workspace;
    t = ok(t, { type: "window.create", from: "100", to: "200" }).workspace;
    t = ok(t, { type: "window.create", from: "300", to: "400" }).workspace;
    t = ok(t, { type: "window.remove", windowId: "w3" }).workspace; // lastZoomed is gone
    expect(t.lastZoomed).toBeUndefined();
    const a3 = add(t, "w1", "car/V1");
    const m3 = ok(a3.workspace, {
      type: "window.moveSignal",
      windowId: "w1",
      assignmentId: a3.created as string,
    });
    expect(win(m3.workspace, m3.createdWindow as string)).toMatchObject({
      range: { from: "100", to: "200" },
    });
  });
});

describe("user options (improve-navigation)", () => {
  it("sets the digits option and rejects other values", () => {
    expect(EMPTY_WORKSPACE.options).toEqual({ digits: 3 });
    const four = ok(EMPTY_WORKSPACE, { type: "workspace.setOptions", digits: 4 });
    expect(four.workspace.options).toEqual({ digits: 4 });
    const three = ok(four.workspace, { type: "workspace.setOptions", digits: 3 });
    expect(three.workspace.options).toEqual({ digits: 3 });
    // No fields: accepted, options unchanged.
    expect(ok(four.workspace, { type: "workspace.setOptions" }).workspace.options).toEqual({
      digits: 4,
    });
    // Other values fail the schema, as invalid_command does over HTTP.
    for (const digits of [5, 2, 0, "4", null]) {
      expect(
        Command.safeParse({ type: "workspace.setOptions", digits }).success,
        String(digits),
      ).toBe(false);
    }
  });

  it("rejects a 65th window with window_limit", () => {
    let state = EMPTY_WORKSPACE;
    for (let i = 0; i < 64; i++) {
      state = ok(state, i % 2 ? { type: "window.create", kind: "values" } : create).workspace;
    }
    expect(state.windows).toHaveLength(64);
    for (const input of [create, { type: "window.create", kind: "values" } as const]) {
      const r = run(state, input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe("window_limit");
    }
    expect(state.windows).toHaveLength(64);
  });

  it("trims the title on window.create", () => {
    for (const kind of ["timeseries", "values"] as const) {
      const extra = kind === "timeseries" ? { from: "0", to: "1000" } : {};
      const blank = ok(EMPTY_WORKSPACE, { type: "window.create", kind, title: "  ", ...extra });
      expect(blank.workspace.windows[0]).not.toHaveProperty("title");
      const padded = ok(EMPTY_WORKSPACE, {
        type: "window.create",
        kind,
        title: "  Speeds ",
        ...extra,
      });
      expect(padded.workspace.windows[0]?.title).toBe("Speeds");
    }
  });
});

describe("measurement info (add-footer)", () => {
  const measurementOf = (state: Workspace) => (state as { measurement?: unknown }).measurement;
  const accepted = (state: Workspace, input: unknown) => {
    const parsed = Command.safeParse(input);
    if (!parsed.success) throw new Error(`rejected by the schema: ${JSON.stringify(input)}`);
    const result = applyCommand(state, parsed.data, unitCtx);
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    return result.workspace;
  };

  it("sets, replaces and clears measurement info", () => {
    expect(EMPTY_WORKSPACE).not.toHaveProperty("measurement");
    let s: Workspace = EMPTY_WORKSPACE;

    s = accepted(s, { type: "measurement.set", name: "  Testfahrt A9 " });
    expect(measurementOf(s)).toEqual({ name: "Testfahrt A9" });
    s = accepted(s, { type: "measurement.set", object: "smart451" });
    expect(measurementOf(s)).toEqual({ name: "Testfahrt A9", object: "smart451" });
    s = accepted(s, { type: "measurement.setMeta", key: "driver", value: "Jan" });
    s = accepted(s, { type: "measurement.setMeta", key: "weather", value: "rain" });
    s = accepted(s, { type: "measurement.setMeta", key: "driver", value: "Eva" });
    // Fifth command: replaced in place, order kept.
    expect(measurementOf(s)).toEqual({
      name: "Testfahrt A9",
      object: "smart451",
      meta: [
        { key: "driver", value: "Eva" },
        { key: "weather", value: "rain" },
      ],
    });
    s = accepted(s, { type: "measurement.setMeta", key: "weather", value: " " });
    expect(measurementOf(s)).toMatchObject({ meta: [{ key: "driver", value: "Eva" }] });
    s = accepted(s, { type: "measurement.set", name: "" });
    expect(measurementOf(s)).toEqual({
      object: "smart451",
      meta: [{ key: "driver", value: "Eva" }],
    });
    expect(measurementOf(s)).not.toHaveProperty("name");
    s = accepted(s, { type: "measurement.clear" });
    expect(s).not.toHaveProperty("measurement");
    expect(s).toEqual(EMPTY_WORKSPACE);
  });

  it("drops an empty meta list and an empty measurement", () => {
    let s = accepted(EMPTY_WORKSPACE, { type: "measurement.setMeta", key: "k", value: "v" });
    expect(measurementOf(s)).toEqual({ meta: [{ key: "k", value: "v" }] });
    s = accepted(s, { type: "measurement.setMeta", key: "k", value: "" });
    expect(s).not.toHaveProperty("measurement");
    s = accepted(EMPTY_WORKSPACE, { type: "measurement.set", object: "x" });
    s = accepted(s, { type: "measurement.set", object: "  " });
    expect(s).not.toHaveProperty("measurement");
  });

  it("rejects measurement info beyond its limits", () => {
    const rejected = (input: unknown) => expect(Command.safeParse(input).success).toBe(false);
    rejected({ type: "measurement.set" }); // no field at all
    rejected({ type: "measurement.set", name: "x".repeat(121) });
    rejected({ type: "measurement.set", object: "x".repeat(121) });
    rejected({ type: "measurement.setMeta", key: "1st", value: "v" });
    rejected({ type: "measurement.setMeta", key: "x".repeat(41), value: "v" });
    rejected({ type: "measurement.setMeta", key: "k", value: "x".repeat(201) });
    rejected({ type: "measurement.set", name: "line\nbreak" });
    rejected({ type: "measurement.setMeta", key: "k", value: "tab\there" });
    rejected({ type: "measurement.setMeta", key: "bad/key", value: "v" });

    // Exactly at the limits.
    let s = accepted(EMPTY_WORKSPACE, { type: "measurement.set", name: "x".repeat(120) });
    expect((measurementOf(s) as { name: string }).name).toHaveLength(120);
    s = accepted(s, { type: "measurement.setMeta", key: "a".repeat(40), value: "v".repeat(200) });
    s = accepted(s, { type: "measurement.setMeta", key: "with space_.-1", value: "v" });

    // Fill up to eight entries, then a ninth key hits measurement_limit.
    s = EMPTY_WORKSPACE;
    for (let i = 1; i <= 8; i++) {
      s = accepted(s, { type: "measurement.setMeta", key: `k${i}`, value: "v" });
    }
    expect((measurementOf(s) as { meta: unknown[] }).meta).toHaveLength(8);
    const ninth = applyCommand(
      s,
      Command.parse({ type: "measurement.setMeta", key: "k9", value: "v" }),
      unitCtx,
    );
    expect(ninth.ok).toBe(false);
    if (!ninth.ok) expect(ninth.code).toBe("measurement_limit");
    // Replacing and removing at eight entries still works.
    s = accepted(s, { type: "measurement.setMeta", key: "k3", value: "w" });
    s = accepted(s, { type: "measurement.setMeta", key: "k8", value: "" });
    expect((measurementOf(s) as { meta: unknown[] }).meta).toHaveLength(7);
  });
});

describe("events commands", () => {
  const eventCtx = {
    signalExists: (id: string) => id !== "testcar/Nope.X",
    hasStates: (id: string) => id === "testcar/Ign_A20h.MODE" || /^testcar\/State\d$/.test(id),
  };
  const attempt = (state: Workspace, input: CommandInput) =>
    applyCommand(state, Command.parse(input), eventCtx);
  const accept = (state: Workspace, input: CommandInput) => {
    const r = attempt(state, input);
    if (!r.ok) throw new Error(`${r.code}: ${r.message}`);
    return r.workspace;
  };

  it("sets the event filter in normal form", () => {
    const set = accept(EMPTY_WORKSPACE, { type: "events.setFilter", filter: "Faults  bms" });
    expect(set.eventFilter).toBe("faults bms");
    // The default removes the field.
    const reset = accept(set, { type: "events.setFilter", filter: "active changes" });
    expect(reset.eventFilter).toBeUndefined();
    expect("eventFilter" in reset).toBe(false);
    // An unparsable filter is rejected with the parser's message and the workspace stays.
    const bad = attempt(set, { type: "events.setFilter", filter: "ecu:" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) {
      expect(bad.code).toBe("invalid_filter");
      expect(bad.message).toContain("ecu");
    }
    // The empty filter is a filter (everything), not the default.
    expect(accept(EMPTY_WORKSPACE, { type: "events.setFilter", filter: "" }).eventFilter).toBe("");
    // At most 200 characters.
    expect(() => Command.parse({ type: "events.setFilter", filter: "a".repeat(201) })).toThrow();
  });

  it("adds and removes events-line signals", () => {
    const code = (r: ReturnType<typeof attempt>) => (r.ok ? "ok" : r.code);
    const mode = "testcar/Ign_A20h.MODE";
    let s = accept(EMPTY_WORKSPACE, { type: "events.addSignal", signalId: mode });
    expect(s.eventSignals).toEqual([mode]);
    expect(code(attempt(s, { type: "events.addSignal", signalId: mode }))).toBe("already_listed");
    expect(
      code(attempt(s, { type: "events.addSignal", signalId: "testcar/Fast_100h.SIG_A" })),
    ).toBe("not_state_signal");
    expect(code(attempt(s, { type: "events.addSignal", signalId: "testcar/Nope.X" }))).toBe(
      "unknown_signal",
    );
    expect(code(attempt(s, { type: "events.removeSignal", signalId: "testcar/Nope.X" }))).toBe(
      "not_listed",
    );
    s = accept(s, { type: "events.removeSignal", signalId: mode });
    expect(s.eventSignals).toBeUndefined();
    expect("eventSignals" in s).toBe(false);

    // Eight is the limit; the order is the order of adding.
    let full = EMPTY_WORKSPACE;
    for (let i = 1; i <= 8; i++) {
      full = accept(full, { type: "events.addSignal", signalId: `testcar/State${i}` });
    }
    expect(full.eventSignals).toHaveLength(8);
    expect(full.eventSignals?.[0]).toBe("testcar/State1");
    expect(code(attempt(full, { type: "events.addSignal", signalId: mode }))).toBe(
      "event_signal_limit",
    );
    expect(MAX_EVENT_SIGNALS).toBe(8);
  });
});

describe("view.open and view.markSaved (add-saved-views)", () => {
  const known = new Set([
    "testcar/Sna_800h.RPM",
    "testcar/Fast_100h.V1",
    "testcar/Fast_100h.KMH",
    "testcar/Fast_100h.DEG",
    "testcar/Fast_100h.DN",
  ]);
  const units: Record<string, string> = {
    "testcar/Sna_800h.RPM": "1/min",
    "testcar/Fast_100h.V1": "V",
    "testcar/Fast_100h.KMH": "km/h",
    "testcar/Fast_100h.DEG": "°C",
    "testcar/Fast_100h.DN": "rpm/10ms",
  };
  const viewCtx = {
    signalExists: (id: string) => known.has(id),
    hasStates: () => false,
    unitOf: (id: string) => units[id],
  };
  const timeseries = (over: Record<string, unknown> = {}) => ({
    kind: "timeseries",
    from: "2026-10-13T13:08:00Z",
    to: "2026-10-13T13:08:20Z",
    mode: "line",
    envelope: false,
    signals: [],
    ...over,
  });
  const doc = (windows: unknown[], over: Record<string, unknown> = {}) => ({
    kipscope: "view",
    version: 1,
    title: "T",
    data: ["testcar"],
    linkTime: true,
    cursors: { diff: false },
    digits: 3,
    windows,
    ...over,
  });
  const open = (state: Workspace, view: unknown, name?: string) =>
    applyCommand(
      state,
      Command.parse({ type: "view.open", view, ...(name === undefined ? {} : { name }) }),
      viewCtx,
    );

  it("opens a view with missing and skipped signals", () => {
    const view = doc([
      timeseries({
        signals: [
          "testcar/Sna_800h.RPM",
          "testcar/Gone_1h.X",
          "testcar/Sna_800h.RPM",
          "testcar/Fast_100h.V1",
          "testcar/Fast_100h.KMH",
          "testcar/Fast_100h.DEG",
          "testcar/Fast_100h.DN",
        ],
      }),
    ]);
    const result = open(EMPTY_WORKSPACE, view, "t");
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const w = result.workspace.windows[0];
    expect(w?.signals.map((s) => s.signalId)).toEqual([
      "testcar/Sna_800h.RPM",
      "testcar/Fast_100h.V1",
      "testcar/Fast_100h.KMH",
      "testcar/Fast_100h.DEG",
    ]);
    expect(result.report?.missing).toEqual(["testcar/Gone_1h.X"]);
    expect(result.report?.skipped).toEqual([
      { signalId: "testcar/Sna_800h.RPM", window: 0, reason: "already_in_window" },
      { signalId: "testcar/Fast_100h.DN", window: 0, reason: "too_many_units" },
    ]);
    expect(result.workspace.view).toEqual({ name: "t", title: "T", modified: false });
  });

  it("fails the whole open on a bad document and before the catalog loaded", () => {
    const bad = open(EMPTY_WORKSPACE, { kipscope: "view", version: 9 });
    expect(bad).toMatchObject({ ok: false, code: "unsupported_version" });
    const notView = open(EMPTY_WORKSPACE, { kipscope: "workspace", version: 1 });
    expect(notView).toMatchObject({ ok: false, code: "invalid_view" });
    const early = applyCommand(
      EMPTY_WORKSPACE,
      Command.parse({ type: "view.open", view: doc([]) }),
      { ...viewCtx, catalogReady: () => false },
    );
    expect(early).toMatchObject({ ok: false, code: "catalog_unavailable" });
  });

  it("continues IDs from the current nextId", () => {
    const base = { ...EMPTY_WORKSPACE, nextId: 12 };
    const result = open(
      base,
      doc([timeseries(), timeseries(), timeseries({ signals: ["testcar/Sna_800h.RPM"] })]),
    );
    if (!result.ok) throw new Error(result.message);
    expect(result.workspace.windows.map((w) => w.id)).toEqual(["w12", "w13", "w14"]);
    expect(result.workspace.windows[2]?.signals[0]?.id).toBe("a15");
    expect(result.workspace.nextId).toBe(16);
  });

  it("aligns ranges of a linked view", () => {
    const view = doc([
      timeseries({ from: "2026-10-13T13:08:00Z", to: "2026-10-13T13:08:20Z" }),
      timeseries({ from: "2026-10-13T13:09:00Z", to: "2026-10-13T13:09:05Z" }),
    ]);
    const result = open(EMPTY_WORKSPACE, view);
    if (!result.ok) throw new Error(result.message);
    const ranges = result.workspace.windows.map((w) => (w.kind === "timeseries" ? w.range : null));
    const first = { from: "1791896880000000000", to: "1791896900000000000" };
    expect(ranges).toEqual([first, first]);
    expect(result.report?.warnings).toContain(
      "time axes are linked: ranges aligned to the first window",
    );

    // Unlinked ranges stay as they are and raise no warning.
    const free = open(EMPTY_WORKSPACE, { ...view, linkTime: false });
    if (!free.ok) throw new Error(free.message);
    expect(
      free.workspace.windows.map((w) => (w.kind === "timeseries" ? w.range.from : "")),
    ).toEqual(["1791896880000000000", "1791896940000000000"]);
    expect(free.report?.warnings).toEqual([]);
  });

  it("marks the open view modified", () => {
    const opened = open(EMPTY_WORKSPACE, doc([timeseries()]), "t");
    if (!opened.ok) throw new Error(opened.message);
    expect(opened.workspace.view?.modified).toBe(false);

    const moved = applyCommand(
      opened.workspace,
      Command.parse({ type: "cursor.set", cursor: "a", t: "1791896881000000000" }),
      viewCtx,
    );
    if (!moved.ok) throw new Error(moved.message);
    expect(moved.workspace.view).toEqual({ name: "t", title: "T", modified: true });

    const saved = applyCommand(
      moved.workspace,
      Command.parse({ type: "view.markSaved", name: "t", title: "T2", note: "n" }),
      viewCtx,
    );
    if (!saved.ok) throw new Error(saved.message);
    expect(saved.workspace.view).toEqual({ name: "t", title: "T2", note: "n", modified: false });
    // markSaved changes nothing but `view`.
    expect({ ...saved.workspace, view: undefined }).toEqual({
      ...moved.workspace,
      view: undefined,
    });

    const rejected = applyCommand(
      saved.workspace,
      Command.parse({ type: "cursor.move", cursor: "b", by: "1" }),
      viewCtx,
    );
    expect(rejected).toMatchObject({ ok: false, code: "cursor_off" });
    expect(saved.workspace.view?.modified).toBe(false);
  });

  it("leaves a workspace without a view without one", () => {
    const moved = applyCommand(
      EMPTY_WORKSPACE,
      Command.parse({ type: "cursor.set", cursor: "a", t: "5" }),
      viewCtx,
    );
    if (!moved.ok) throw new Error(moved.message);
    expect(moved.workspace.view).toBeUndefined();
  });

  it("refuses a view name that is not file-safe", () => {
    const view = doc([timeseries()]);
    for (const name of ["../x", "Abc", "a.b", "-x", "", "a/b", "_previous", "x".repeat(64)]) {
      expect(() => Command.parse({ type: "view.open", view, name }), name).toThrow();
    }
    expect(() => Command.parse({ type: "view.open", view, name: "speeds-2" })).not.toThrow();
    expect(() => Command.parse({ type: "view.open", view })).not.toThrow();
  });

  it("refuses markSaved with a name that is not a view name", () => {
    expect(() =>
      Command.parse({ type: "view.markSaved", name: "_previous", title: "x" }),
    ).toThrow();
    expect(() => Command.parse({ type: "view.markSaved", name: "Abc", title: "x" })).toThrow();
  });
});

describe("scope commands (add-scope)", () => {
  const MIN = 60n * 1_000_000_000n;
  /** 2026-10-01T01:00:00Z and 02:00:00Z in ns, by hand (1790816400 s and 1790820000 s). */
  const T1 = 1790816400000000000n;
  const T2 = 1790820000000000000n;
  const ns = (t: bigint) => t.toString();
  const known = (id: string) => id.startsWith("testcar/") || id.startsWith("othercar/");
  const scopeCtx = { signalExists: known, hasStates: () => false };
  const scoped = { ...scopeCtx, scopeRequired: true };

  /** Runs one command and demands success. */
  function go(state: Workspace, input: CommandInput, context = scopeCtx) {
    const result = applyCommand(state, Command.parse(input), context);
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    return result;
  }

  /** A workspace with one window at [T1 + 10 min, T1 + 20 min), with or without scope [T1, T2). */
  function withWindow(scope: boolean): Workspace {
    const created = go(EMPTY_WORKSPACE, {
      type: "window.create",
      from: ns(T1 + 10n * MIN),
      to: ns(T1 + 20n * MIN),
    });
    return scope
      ? go(created.workspace, { type: "scope.set", dataRef: "testcar", from: ns(T1), to: ns(T2) })
          .workspace
      : created.workspace;
  }

  it("sets and clears the scope", () => {
    const set = go(EMPTY_WORKSPACE, {
      type: "scope.set",
      dataRef: "testcar",
      from: ns(T1),
      to: ns(T2),
    });
    expect(set.workspace.scope).toEqual({ dataRef: "testcar", from: ns(T1), to: ns(T2) });
    const cleared = go(set.workspace, { type: "scope.clear" });
    expect(cleared.workspace.scope).toBeUndefined();
    expect("scope" in cleared.workspace).toBe(false);

    // Bad input is refused as invalid_command, whether the schema or applyCommand sees it first.
    const bad = [
      { dataRef: "testcar", from: ns(T1), to: ns(T1) }, // empty
      { dataRef: "testcar", from: ns(T2), to: ns(T1) }, // reversed
      { dataRef: "testcar", from: ns(T1), to: ns(T1 + 99n) }, // 99 ns
      { dataRef: "a/b", from: ns(T1), to: ns(T2) }, // a data ref holds no /
    ];
    for (const fields of bad) {
      const raw = { type: "scope.set", ...fields };
      expect(Command.safeParse(raw).success).toBe(false);
      const result = applyCommand(set.workspace, raw as never, scopeCtx);
      expect(result).toMatchObject({ ok: false, code: "invalid_command" });
    }
    // 100 ns is the smallest span.
    expect(
      go(EMPTY_WORKSPACE, {
        type: "scope.set",
        dataRef: "testcar",
        from: ns(T1),
        to: ns(T1 + 100n),
      }).workspace.scope,
    ).toEqual({ dataRef: "testcar", from: ns(T1), to: ns(T1 + 100n) });
  });

  it("keeps windows and cursors inside the scope", () => {
    const state = withWindow(true);
    const range = (w: Workspace) => (w.windows[0] as TimeseriesWindow).range;

    // A range partly before the scope is shifted in with its span kept.
    const first = go(state, {
      type: "window.setRange",
      windowId: "w1",
      from: ns(T1 - 5n * MIN),
      to: ns(T1 + 5n * MIN),
    });
    expect(range(first.workspace)).toEqual({ from: ns(T1), to: ns(T1 + 10n * MIN) });
    expect(first.clamped).toBe(true);

    // A range wider than the scope becomes the scope.
    const second = go(first.workspace, {
      type: "window.setRange",
      windowId: "w1",
      from: ns(T1),
      to: ns(T2 + 60n * MIN),
    });
    expect(range(second.workspace)).toEqual({ from: ns(T1), to: ns(T2) });
    expect(second.clamped).toBe(true);

    // A range inside is applied as given, without `clamped`.
    const inside = go(second.workspace, {
      type: "window.setRange",
      windowId: "w1",
      from: ns(T1 + MIN),
      to: ns(T1 + 2n * MIN),
    });
    expect(range(inside.workspace)).toEqual({ from: ns(T1 + MIN), to: ns(T1 + 2n * MIN) });
    expect("clamped" in inside).toBe(false);

    // A cursor at the scope's open end is outside: [from, to).
    const refused = applyCommand(
      second.workspace,
      Command.parse({ type: "cursor.set", cursor: "a", t: ns(T2) }),
      scopeCtx,
    );
    expect(refused).toMatchObject({ ok: false, code: "out_of_scope" });
    const moved = applyCommand(
      go(second.workspace, { type: "cursor.set", cursor: "a", t: ns(T1 + MIN) }).workspace,
      Command.parse({ type: "cursor.move", cursor: "a", by: ns(T2 - T1) }),
      scopeCtx,
    );
    expect(moved).toMatchObject({ ok: false, code: "out_of_scope" });

    // A cursor set inside, then a narrower scope: cursor A is gone, the window range clamped.
    const withCursor = go(second.workspace, { type: "cursor.set", cursor: "a", t: ns(T1 + MIN) });
    const narrower = go(withCursor.workspace, {
      type: "scope.set",
      dataRef: "testcar",
      from: ns(T1 + 30n * MIN),
      to: ns(T2),
    });
    expect(narrower.workspace.cursors.a).toBeUndefined();
    expect(range(narrower.workspace)).toEqual({ from: ns(T1 + 30n * MIN), to: ns(T2) });
    expect(narrower.clamped).toBe(true);
  });

  it("keeps windows and cursors inside the scope: no scope, no change", () => {
    const state = withWindow(false);
    const range = (w: Workspace) => (w.windows[0] as TimeseriesWindow).range;
    const first = go(state, {
      type: "window.setRange",
      windowId: "w1",
      from: ns(T1 - 5n * MIN),
      to: ns(T1 + 5n * MIN),
    });
    expect(range(first.workspace)).toEqual({ from: ns(T1 - 5n * MIN), to: ns(T1 + 5n * MIN) });
    expect("clamped" in first).toBe(false);
    const second = go(first.workspace, {
      type: "window.setRange",
      windowId: "w1",
      from: ns(T1),
      to: ns(T2 + 60n * MIN),
    });
    expect(range(second.workspace)).toEqual({ from: ns(T1), to: ns(T2 + 60n * MIN) });
    expect("clamped" in second).toBe(false);
    const cursor = go(second.workspace, { type: "cursor.set", cursor: "a", t: ns(T2) });
    expect(cursor.workspace.cursors.a).toBe(ns(T2));
    expect("clamped" in cursor).toBe(false);
  });

  it("clamps a new window's range into the scope", () => {
    const created = go(withWindow(true), {
      type: "window.create",
      from: ns(T2 - 10n * MIN),
      to: ns(T2 + 20n * MIN),
    });
    expect((created.workspace.windows[1] as TimeseriesWindow).range).toEqual({
      from: ns(T2 - 30n * MIN),
      to: ns(T2),
    });
    expect(created.clamped).toBe(true);
  });

  it("refuses catalog commands without a scope in scoped mode", () => {
    const base = withWindow(false);
    const values = {
      kipscope: "view",
      version: 1,
      title: "T",
      data: ["testcar"],
      linkTime: true,
      cursors: { diff: false },
      digits: 3,
      windows: [{ kind: "values", mode: "line", signals: ["testcar/Fast_100h.SIG_A"] }],
    };
    const attempts: CommandInput[] = [
      { type: "scope.clear" },
      { type: "window.addSignal", windowId: "w1", signalId: "testcar/Fast_100h.SIG_A" },
      { type: "events.addSignal", signalId: "testcar/Ign_A20h.MODE" },
      { type: "view.open", view: values },
    ];
    for (const input of attempts) {
      const result = applyCommand(base, Command.parse(input), scoped);
      expect(result, input.type).toMatchObject({ ok: false, code: "scope_required" });
    }
    // Other commands are unaffected.
    const renamed = applyCommand(
      base,
      Command.parse({ type: "window.rename", windowId: "w1", title: "Renamed" }),
      scoped,
    );
    expect(renamed.ok).toBe(true);
    // With a scope, the same add is accepted, and scope.clear is refused in scoped mode.
    const inScope = withWindow(true);
    expect(
      applyCommand(
        inScope,
        Command.parse({ type: "window.addSignal", windowId: "w1", signalId: "testcar/A.X" }),
        scoped,
      ).ok,
    ).toBe(true);
    expect(applyCommand(inScope, Command.parse({ type: "scope.clear" }), scoped)).toMatchObject({
      ok: false,
      code: "scope_required",
    });
  });

  describe("view.open with a scope", () => {
    const viewDoc = (windows: unknown[], over: Record<string, unknown> = {}) => ({
      kipscope: "view",
      version: 1,
      title: "T",
      data: ["testcar"],
      linkTime: true,
      cursors: { diff: false },
      digits: 3,
      windows,
      ...over,
    });
    const series = (from: string, to: string, signals: string[] = []) => ({
      kind: "timeseries",
      from,
      to,
      mode: "line",
      envelope: false,
      signals,
    });
    const open = (state: Workspace, view: unknown, extra: Record<string, unknown> = {}) =>
      applyCommand(state, Command.parse({ type: "view.open", view, ...extra }), scopeCtx);

    it("opens a view into its scope", () => {
      // The window starts 30 min before the scope and cursor B lies 1 min after its end.
      const view = viewDoc([series("2026-10-01T00:30:00Z", "2026-10-01T01:10:00Z")], {
        scope: { dataRef: "testcar", from: "2026-10-01T01:00:00Z", to: "2026-10-01T02:00:00Z" },
        cursors: { b: "2026-10-01T02:01:00Z", diff: false },
      });
      const result = open(EMPTY_WORKSPACE, view);
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      expect(result.workspace.scope).toEqual({ dataRef: "testcar", from: ns(T1), to: ns(T2) });
      expect((result.workspace.windows[0] as TimeseriesWindow).range).toEqual({
        from: ns(T1),
        to: ns(T1 + 40n * MIN),
      });
      expect(result.workspace.cursors.b).toBeUndefined();
      expect(result.report?.warnings).toContain("ranges clamped to the scope");
      expect(result.report?.warnings).toContain("cursor B outside the scope dropped");
    });

    it("opens a view into its scope: the scope of the command wins over the document's", () => {
      const view = viewDoc([series("2026-10-01T01:10:00Z", "2026-10-01T01:20:00Z")], {
        scope: { dataRef: "othercar", from: "2026-10-01T00:00:00Z", to: "2026-10-01T03:00:00Z" },
      });
      const result = open(EMPTY_WORKSPACE, view, {
        scope: { dataRef: "testcar", from: ns(T1), to: ns(T2) },
      });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      expect(result.workspace.scope).toEqual({ dataRef: "testcar", from: ns(T1), to: ns(T2) });
    });

    it("opens a view into its scope: open replaces the scope", () => {
      const state = withWindow(true);
      expect(state.scope?.dataRef).toBe("testcar");
      const other = open(
        state,
        viewDoc([series("2026-10-01T01:10:00Z", "2026-10-01T01:20:00Z")], {
          scope: { dataRef: "othercar", from: "2026-10-01T01:00:00Z", to: "2026-10-01T02:00:00Z" },
        }),
      );
      if (!other.ok) throw new Error(`${other.code}: ${other.message}`);
      expect(other.workspace.scope).toEqual({ dataRef: "othercar", from: ns(T1), to: ns(T2) });

      // A view with only a values window and no cursor resolves no scope: the workspace has none.
      const bare = open(
        other.workspace,
        viewDoc([{ kind: "values", mode: "line", signals: ["testcar/Fast_100h.SIG_A"] }]),
      );
      if (!bare.ok) throw new Error(`${bare.code}: ${bare.message}`);
      expect(bare.workspace.scope).toBeUndefined();
      expect("scope" in bare.workspace).toBe(false);
    });

    it("skips window signals of another data ref on open", () => {
      const view = viewDoc(
        [
          series("2026-10-01T01:10:00Z", "2026-10-01T01:20:00Z", [
            "testcar/Fast_100h.SIG_A",
            "othercar/Fast_100h.SIG_A",
          ]),
        ],
        { events: { signals: ["othercar/Ign_A20h.MODE", "testcar/Ign_A20h.MODE"] } },
      );
      const result = open(EMPTY_WORKSPACE, view, {
        scope: { dataRef: "testcar", from: ns(T1), to: ns(T2) },
      });
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      expect(result.workspace.windows[0]?.signals.map((s) => s.signalId)).toEqual([
        "testcar/Fast_100h.SIG_A",
      ]);
      expect(result.report?.skipped).toEqual([
        { signalId: "othercar/Fast_100h.SIG_A", window: 0, reason: "out_of_scope" },
      ]);
      expect(result.workspace.eventSignals).toEqual(["testcar/Ign_A20h.MODE"]);
      // One warning for the events-line signal of another data ref.
      expect(
        result.report?.warnings.filter((w) => w.includes("othercar/Ign_A20h.MODE")),
      ).toHaveLength(1);
    });
  });
});

describe("case commands (add-case-open)", () => {
  const bothCars = (id: string) => id.startsWith("testcar/") || id.startsWith("othercar/");
  const base = { signalExists: bothCars, hasStates: () => false };
  type CaseCtx = NonNullable<Parameters<typeof applyCommand>[2]["case"]>;
  const withCase = (
    extra: Partial<CaseCtx>,
    signalExists: (id: string) => boolean = bothCars,
  ): Parameters<typeof applyCommand>[2] => ({
    signalExists,
    hasStates: () => false,
    case: { entry: (i: number) => C4.entries[i], ...extra },
  });
  /** testcar rows lie in [00:00, 10:00). */
  const EXTENT = { from: at(0, 0), to: at(10, 0) };

  function step(
    state: Workspace,
    input: CommandInput,
    context: Parameters<typeof applyCommand>[2],
  ) {
    return applyCommand(state, Command.parse(input), context);
  }
  function stepOk(
    state: Workspace,
    input: CommandInput,
    context: Parameters<typeof applyCommand>[2],
  ) {
    const result = step(state, input, context);
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    return result;
  }

  /** A workspace opened at entry 0 of C4 with w1 [01:02:00, 01:04:00) on two testcar signals. */
  function openAtZero(align: "start" | "anchor" = "start"): Workspace {
    let ws = EMPTY_WORKSPACE;
    for (const input of [
      { type: "window.create", from: at(1, 2), to: at(1, 4) },
      { type: "window.addSignal", windowId: "w1", signalId: "testcar/Fast_100h.SIG_A" },
      { type: "window.addSignal", windowId: "w1", signalId: "testcar/Irr_200h.JITTER" },
    ] as const) {
      ws = stepOk(ws, input, base).workspace;
    }
    const opened = openCase({
      catalog: C4,
      current: 0,
      pad: PAD,
      align: { mode: align },
      alignAt: at(1, 0),
      layout: ws,
      layoutAlignAt: at(1, 0),
      known: bothCars,
    }).workspace;
    return stepOk(opened, { type: "cursor.set", cursor: "a", t: at(1, 3) }, base).workspace;
  }
  const w1 = (ws: Workspace) => ws.windows[0] as TimeseriesWindow;

  it("parses the case commands", () => {
    expect(Command.safeParse({ type: "case.go", index: 2 }).success).toBe(true);
    expect(Command.safeParse({ type: "case.go", index: -1 }).success).toBe(false);
    expect(Command.safeParse({ type: "case.step", by: 1 }).success).toBe(true);
    expect(Command.safeParse({ type: "case.step", by: -1 }).success).toBe(true);
    expect(Command.safeParse({ type: "case.step", by: 2 }).success).toBe(false);
    expect(Command.safeParse({ type: "case.unlink" }).success).toBe(true);
    expect(Command.safeParse({ type: "case.align", align: { mode: "end" } }).success).toBe(true);
    expect(
      Command.safeParse({
        type: "case.align",
        align: { mode: "event", event: { kind: "dtc", source: "BMS", name: "P0CA700" } },
        at: "2026-10-01T05:00:00Z",
      }).success,
    ).toBe(true);
    expect(Command.safeParse({ type: "case.align", align: { mode: "middle" } }).success).toBe(
      false,
    );
  });

  it("refuses steps past the ends and while unlinked", () => {
    // Without a catalog every case command fails no_case.
    const plain = stepOk(EMPTY_WORKSPACE, { type: "window.create", from: "0", to: "1000" }, base);
    for (const input of [
      { type: "case.step", by: 1 },
      { type: "case.go", index: 0 },
      { type: "case.unlink" },
      { type: "case.align", align: { mode: "end" } },
    ] as const) {
      expect(step(plain.workspace, input, base), input.type).toMatchObject({
        ok: false,
        code: "no_case",
      });
    }
    // Ends of the catalog.
    const last = openCase({
      catalog: C4,
      current: 3,
      pad: PAD,
      align: { mode: "start" },
      alignAt: at(4, 58),
      known: bothCars,
    }).workspace;
    expect(step(last, { type: "case.step", by: 1 }, withCase({ alignAt: at(0, 0) }))).toMatchObject(
      {
        ok: false,
        code: "case_end",
      },
    );
    const first = openAtZero();
    expect(
      step(first, { type: "case.step", by: -1 }, withCase({ alignAt: at(0, 0) })),
    ).toMatchObject({
      ok: false,
      code: "case_end",
    });
    expect(
      step(first, { type: "case.go", index: 4 }, withCase({ alignAt: at(0, 0) })),
    ).toMatchObject({
      ok: false,
      code: "case_end",
    });
    // Unlinked: no steps.
    const unlinked = stepOk(first, { type: "case.unlink" }, withCase({ extent: EXTENT })).workspace;
    expect(unlinked.case?.linked).toBe(false);
    expect(
      step(unlinked, { type: "case.step", by: 1 }, withCase({ alignAt: at(4, 50) })),
    ).toMatchObject({ ok: false, code: "case_unlinked" });
    expect(step(unlinked, { type: "case.unlink" }, withCase({ extent: EXTENT }))).toMatchObject({
      ok: false,
      code: "case_unlinked",
    });
    expect(
      step(
        unlinked,
        { type: "case.align", align: { mode: "end" } },
        withCase({ alignAt: at(1, 10) }),
      ),
    ).toMatchObject({ ok: false, code: "case_unlinked" });
  });

  it("steps keeping offsets from the alignment point", () => {
    const start = stepOk(
      openAtZero(),
      { type: "case.go", index: 2 },
      withCase({ alignAt: at(4, 50) }),
    );
    expect(start.workspace.scope).toEqual({ dataRef: "testcar", from: at(4, 49), to: at(5, 11) });
    expect(w1(start.workspace).range).toEqual({ from: at(4, 52), to: at(4, 54) });
    expect(start.workspace.cursors.a).toBe(at(4, 53));
    expect(start.workspace.case).toMatchObject({
      current: 2,
      linked: true,
      alignAt: at(4, 50),
      entry: C4.entries[2],
    });
    expect(start.clamped).toBeUndefined();
    expect(start.missing).toBeUndefined();

    // Align anchor: entry 0 has none (falls back to its start), entry 2's anchor is 04:55:00.
    const anchored = stepOk(
      openAtZero("anchor"),
      { type: "case.go", index: 2 },
      withCase({ alignAt: at(4, 55) }),
    );
    expect(w1(anchored.workspace).range).toEqual({ from: at(4, 57), to: at(4, 59) });
    expect(anchored.workspace.cursors.a).toBe(at(4, 58));
    expect(anchored.workspace.case?.alignAt).toBe("1790830500000000000");
    expect(anchored.workspace.case?.align).toEqual({ mode: "anchor" });
    // Signals, colours, linked time and the rest stay.
    expect(w1(anchored.workspace).signals).toEqual(w1(openAtZero("anchor")).signals);
  });

  it("steps keeping offsets from the alignment point: stepping by one", () => {
    const next = stepOk(
      openAtZero(),
      { type: "case.step", by: 1 },
      withCase({ alignAt: at(0, 0) }),
    );
    expect(next.workspace.case?.current).toBe(1);
    expect(next.workspace.scope?.dataRef).toBe("othercar");
  });

  it("applies two steps in a row from the state the first left", () => {
    // w1 [01:02:00, 01:04:00) is +2 … +4 min from entry 0; entry 2's anchor is 04:55:00.
    const zero = openAtZero("anchor");
    // othercar lists only Fast_100h.SIG_A: the first step reports the jitter missing.
    const lacksJitter = (id: string) => bothCars(id) && id !== "othercar/Irr_200h.JITTER";
    const first = stepOk(
      zero,
      { type: "case.step", by: 1 },
      withCase({ alignAt: at(0, 0) }, lacksJitter),
    );
    expect(first.workspace.case?.current).toBe(1);
    expect(first.missing).toEqual(["othercar/Irr_200h.JITTER"]);

    // The second step goes on from entry 1: current is 2, and the scope, the alignment point,
    // the rebound signals and the missing list are those of entry 2.
    const two = stepOk(
      first.workspace,
      { type: "case.step", by: 1 },
      withCase({ alignAt: at(4, 55) }),
    );
    expect(two.workspace.case).toMatchObject({ current: 2, linked: true, alignAt: at(4, 55) });
    expect(two.workspace.case?.entry).toEqual(C4.entries[2]);
    expect(two.workspace.scope).toEqual({ dataRef: "testcar", from: at(4, 49), to: at(5, 11) });
    expect(two.missing).toBeUndefined();
    expect(w1(two.workspace).signals.map((s) => s.signalId)).toEqual([
      "testcar/Fast_100h.SIG_A",
      "testcar/Irr_200h.JITTER",
    ]);
    // Entry 1's 2-minute scope clamped the window; entry 2 keeps the offsets that range had from
    // entry 1's alignment point (00:00:00), now from 04:55:00.
    const left = w1(first.workspace).range;
    const now = w1(two.workspace).range;
    expect(BigInt(now.from) - BigInt(at(4, 55))).toBe(BigInt(left.from) - BigInt(at(0, 0)));
    expect(BigInt(now.to) - BigInt(at(4, 55))).toBe(BigInt(left.to) - BigInt(at(0, 0)));

    // A case.align or case.unlink applied after the step acts on entry 1.
    const aligned = stepOk(
      first.workspace,
      { type: "case.align", align: { mode: "end" } },
      withCase({}),
    );
    expect(aligned.workspace.case?.alignAt).toBe(at(0, 0, 1));
    const unlinked = stepOk(
      first.workspace,
      { type: "case.unlink" },
      withCase({ extent: { from: at(0, 0), to: at(0, 5) } }),
    );
    expect(unlinked.workspace.scope?.dataRef).toBe("othercar");
    expect(unlinked.workspace.case).toMatchObject({ current: 1, linked: false });
  });

  it("steps keeping offsets from the alignment point: clamped at a short session", () => {
    const result = stepOk(
      openAtZero(),
      { type: "case.go", index: 1 },
      withCase({ alignAt: at(0, 0) }),
    );
    // Scope [23:59:00 of 2026-09-30, 00:01:01).
    expect(result.workspace.scope).toEqual({
      dataRef: "othercar",
      from: String(1790812740n * 1_000_000_000n),
      to: String(1790812861n * 1_000_000_000n),
    });
    expect(w1(result.workspace).range).toEqual({
      from: String(1790812741n * 1_000_000_000n),
      to: String(1790812861n * 1_000_000_000n),
    });
    expect(result.clamped).toBe(true);
    // Cursor A (offset +3 min) lies outside the short scope and is dropped.
    expect(result.workspace.cursors.a).toBeUndefined();
  });

  it("reports an alignment that fell back to the start", () => {
    const result = stepOk(
      openAtZero(),
      { type: "case.go", index: 2 },
      withCase({ alignAt: at(4, 50), alignFallback: true }),
    );
    expect(result.alignFallback).toBe(true);
  });

  it("moves signals to another vehicle", () => {
    const zero = openAtZero();
    const before = w1(zero).signals;
    expect(zero.colors).toMatchObject({
      "testcar/Fast_100h.SIG_A": 0,
      "testcar/Irr_200h.JITTER": 1,
    });
    // othercar's list holds SIG_A only.
    const onlyA = (id: string) => id === "othercar/Fast_100h.SIG_A";
    const there = stepOk(
      zero,
      { type: "case.go", index: 1 },
      withCase({ alignAt: at(0, 0) }, onlyA),
    );
    expect(w1(there.workspace).signals).toEqual([
      { id: before[0]?.id, signalId: "othercar/Fast_100h.SIG_A" },
      { id: before[1]?.id, signalId: "othercar/Irr_200h.JITTER" },
    ]);
    expect(there.workspace.colors).toEqual({
      "othercar/Fast_100h.SIG_A": 0,
      "othercar/Irr_200h.JITTER": 1,
    });
    expect(there.missing).toEqual(["othercar/Irr_200h.JITTER"]);
    const back = stepOk(
      there.workspace,
      { type: "case.go", index: 0 },
      withCase({ alignAt: at(1, 0) }),
    );
    expect(w1(back.workspace).signals).toEqual(before);
    expect(back.workspace.colors).toEqual(zero.colors);
    expect(back.missing).toBeUndefined();
  });

  it("moves the events line to another vehicle", () => {
    const zero = openAtZero();
    const withEvents = stepOk(
      zero,
      { type: "events.addSignal", signalId: "testcar/Ign_A20h.MODE" },
      { ...base, hasStates: () => true },
    ).workspace;
    const there = stepOk(
      withEvents,
      { type: "case.go", index: 1 },
      withCase({ alignAt: at(0, 0) }),
    );
    expect(there.workspace.eventSignals).toEqual(["othercar/Ign_A20h.MODE"]);
  });

  it("unlinks to the span of the catalog's sessions", () => {
    // One session of the vehicle: the scope is that entry's caseScope (00:59:00 … 01:11:00 with
    // 60 s of pad) with object: true, and the application sends no query (objectSpan is pure).
    const single: CaseCatalog = { catalogId: "c1c1c1c1c1", entries: [C4.entries[0] as CaseEntry] };
    const openedSingle = openCase({
      catalog: single,
      current: 0,
      pad: PAD,
      align: { mode: "start" },
      alignAt: at(1, 0),
      known: bothCars,
    }).workspace;
    const spanOne = objectSpan(single, "testcar", openedSingle.scope as WorkspaceScope, PAD);
    expect(spanOne).toEqual({
      dataRef: "testcar",
      from: at(0, 59),
      to: at(1, 11),
      object: true,
    });
    const unlinkedOne = stepOk(
      openedSingle,
      { type: "case.unlink" },
      withCase({ extent: spanOne }),
    ).workspace;
    expect(unlinkedOne.scope).toEqual({
      dataRef: "testcar",
      from: at(0, 59),
      to: at(1, 11),
      object: true,
    });

    // C4: entries 0, 2 and 3 are on testcar, entry 1 on othercar. The earliest bound is entry 0's
    // 00:59:00, the latest entry 2's 05:11:00; othercar's 00:00:00 does not count.
    const zero = openAtZero();
    const span = objectSpan(C4, "testcar", zero.scope as WorkspaceScope, PAD);
    expect(span).toEqual({ dataRef: "testcar", from: at(0, 59), to: at(5, 11), object: true });
    const unlinked = stepOk(zero, { type: "case.unlink" }, withCase({ extent: span })).workspace;
    expect(unlinked.scope).toEqual({
      dataRef: "testcar",
      from: at(0, 59),
      to: at(5, 11),
      object: true,
    });
    expect(w1(unlinked).range).toEqual({ from: at(1, 2), to: at(1, 4) });
    expect(unlinked.case?.linked).toBe(false);
    expect(unlinked.case?.linkedRanges?.w1).toEqual({ from: "120000000000", to: "240000000000" });

    // The current scope is kept inside: a wider current scope widens the span; othercar's entry
    // gives its own vehicle's span.
    const wider: WorkspaceScope = { dataRef: "testcar", from: at(0, 0), to: at(10, 0) };
    expect(objectSpan(C4, "testcar", wider, PAD)).toEqual({ ...wider, object: true });
    expect(objectSpan(C4, "othercar", caseScope(C4.entries[1] as CaseEntry, PAD), PAD)).toEqual({
      dataRef: "othercar",
      from: at(0, -1),
      to: at(0, 1, 1),
      object: true,
    });
  });

  it("unlinks to the vehicle's extent and links back", () => {
    const zero = openAtZero();
    const unlinked = stepOk(zero, { type: "case.unlink" }, withCase({ extent: EXTENT })).workspace;
    expect(unlinked.scope).toEqual({
      dataRef: "testcar",
      from: at(0, 0),
      to: at(10, 0),
      object: true,
    });
    expect(w1(unlinked).range).toEqual({ from: at(1, 2), to: at(1, 4) });
    expect(unlinked.cursors.a).toBe(at(1, 3));
    expect(unlinked.case?.linked).toBe(false);
    expect(unlinked.case?.linkedRanges).toEqual({
      w1: { from: String(2n * CASE_MIN), to: String(4n * CASE_MIN) },
    });
    expect(unlinked.case?.linkedRanges?.w1).toEqual({ from: "120000000000", to: "240000000000" });

    // Zoom w1, create w2 while unlinked, then link to entry 2.
    const zoomed = stepOk(
      unlinked,
      { type: "window.setRange", windowId: "w1", from: at(6, 0), to: at(7, 0) },
      base,
    ).workspace;
    const created = stepOk(
      zoomed,
      { type: "window.create", from: at(2, 0), to: at(3, 0) },
      base,
    ).workspace;
    const linked = stepOk(
      created,
      { type: "case.go", index: 2 },
      withCase({ alignAt: at(4, 50) }),
    ).workspace;
    expect(linked.scope).toEqual({ dataRef: "testcar", from: at(4, 49), to: at(5, 11) });
    expect("object" in (linked.scope ?? {})).toBe(false);
    expect((linked.windows[0] as TimeseriesWindow).range).toEqual({
      from: at(4, 52),
      to: at(4, 54),
    });
    expect((linked.windows[1] as TimeseriesWindow).range).toEqual({
      from: at(4, 49),
      to: at(5, 11),
    });
    expect(linked.case?.linked).toBe(true);
    expect(linked.case?.current).toBe(2);
    expect("linkedRanges" in (linked.case ?? {})).toBe(false);
  });

  it("keeps the scope inside the vehicle's extent when the session lies outside it", () => {
    const zero = openAtZero();
    // An extent that ends before the session's scope: the scope keeps the session inside.
    const unlinked = stepOk(
      zero,
      { type: "case.unlink" },
      withCase({ extent: { from: at(1, 5), to: at(1, 6) } }),
    ).workspace;
    expect(unlinked.scope).toEqual({
      dataRef: "testcar",
      from: at(0, 59),
      to: at(1, 11),
      object: true,
    });
  });

  it("aligns without moving windows", () => {
    const zero = openAtZero();
    const ended = stepOk(
      zero,
      { type: "case.align", align: { mode: "end" } },
      withCase({ alignAt: at(1, 10) }),
    );
    expect(ended.workspace.case).toMatchObject({ align: { mode: "end" }, alignAt: at(1, 10) });
    expect(w1(ended.workspace).range).toEqual({ from: at(1, 2), to: at(1, 4) });
    expect(ended.workspace.cursors.a).toBe(at(1, 3));
    const event = {
      mode: "event",
      event: { kind: "dtc", source: "BMS", name: "P0CA700" },
    } as const;
    const chosen = stepOk(zero, { type: "case.align", align: event, at: at(1, 3) }, withCase({}));
    expect(chosen.workspace.case?.alignAt).toBe(at(1, 3));
    expect(chosen.workspace.case?.align).toEqual(event);
    // The chosen time must lie in the scope.
    expect(
      step(zero, { type: "case.align", align: event, at: at(5, 0) }, withCase({})),
    ).toMatchObject({ ok: false, code: "out_of_scope" });
  });

  it("refuses scope commands while a catalog is open", () => {
    const zero = openAtZero();
    expect(
      step(
        zero,
        { type: "scope.set", dataRef: "testcar", from: at(1, 0), to: at(2, 0) },
        withCase({}),
      ),
    ).toMatchObject({ ok: false, code: "case_open" });
    expect(step(zero, { type: "scope.clear" }, withCase({}))).toMatchObject({
      ok: false,
      code: "case_open",
    });
    // Unlinked it stays refused.
    const unlinked = stepOk(zero, { type: "case.unlink" }, withCase({ extent: EXTENT })).workspace;
    expect(step(unlinked, { type: "scope.clear" }, withCase({}))).toMatchObject({
      ok: false,
      code: "case_open",
    });
  });
});
