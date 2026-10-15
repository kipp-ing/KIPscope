import { describe, expect, it } from "vitest";
import { applyCommand } from "../src/apply.ts";
import {
  Command,
  type CommandInput,
  EMPTY_WORKSPACE,
  SIGNAL_COLORS,
  type TimeseriesWindow,
  type Workspace,
  windowTitle,
} from "../src/workspace.ts";

const ctx = { signalExists: (id: string) => id.startsWith("car/") };

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
    expect(win(r.workspace, "w1")?.signals).toEqual([]);
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

  it("keeps an emptied source window", () => {
    const { s, a } = setup();
    const r = ok(s, {
      type: "window.moveSignal",
      windowId: "w1",
      assignmentId: a,
      targetWindowId: "w2",
    });
    expect(r.workspace.windows.map((w) => w.id)).toEqual(["w1", "w2", "w3"]);
    expect(win(r.workspace, "w1")?.signals).toHaveLength(0);
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
    expect(moved.workspace.windows).toHaveLength(4);
    expect(win(moved.workspace, "w1")?.signals).toEqual([]);
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
    expect(win(moved.workspace, "w2")?.signals).toEqual([]);
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
