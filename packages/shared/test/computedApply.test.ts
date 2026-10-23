import { describe, expect, it } from "vitest";
import { type ApplyContext, applyCommand } from "../src/apply.ts";
import { openCase } from "../src/caseApply.ts";
import type { ComputedDef } from "../src/computed.ts";
import {
  Command,
  type CommandInput,
  EMPTY_WORKSPACE,
  type TimeseriesWindow,
  type Workspace,
  WorkspaceSchema,
} from "../src/workspace.ts";
import { at, C4, PAD } from "./caseFixtures.ts";

/** Plain signals of the synthetic car and their units (MODE has states). */
const UNITS: Record<string, string | undefined> = {
  "testcar/Fast_100h.SIG_A": "V",
  "testcar/Sna_800h.SPEED": "km/h",
  "testcar/Temp_1h.T": "°C",
  "testcar/Rpm_1h.N": "rpm",
  "testcar/Pres_1h.P": "bar",
  "testcar/Ign_A20h.MODE": undefined,
  "othercar/Fast_100h.SIG_A": "V",
  "othercar/Sna_800h.SPEED": "km/h",
};
const STATES = new Set(["testcar/Ign_A20h.MODE"]);

function makeCtx(skip: readonly string[] = [], extra: Partial<ApplyContext> = {}): ApplyContext {
  return {
    signalExists: (id) => id in UNITS && !skip.includes(id),
    hasStates: (id) => STATES.has(id),
    unitOf: (id) => UNITS[id],
    ...extra,
  };
}

const ctx = makeCtx();

const SCOPED: Workspace = {
  ...EMPTY_WORKSPACE,
  scope: { dataRef: "testcar", from: "0", to: "3000000000000" },
};

function run(state: Workspace, input: CommandInput, context: ApplyContext = ctx) {
  return applyCommand(state, Command.parse(input), context);
}

function ok(state: Workspace, input: CommandInput, context: ApplyContext = ctx) {
  const result = run(state, input, context);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

const create = { type: "window.create", from: "0", to: "1000000000" } as const;
const DIFF = {
  type: "computed.add",
  name: "Diff",
  formula: "a - b",
  a: "Fast_100h.SIG_A",
  b: "Sna_800h.SPEED",
} as const;

const defOf = (ws: Workspace, id: string) => ws.computed?.find((d) => d.id === id);
const numberOf = (id: string) => Number(id.slice(1));

describe("computed commands", () => {
  // spec computed-signals "Add, update, remove"
  it("adds, updates and removes computed signals", () => {
    let ws = ok(SCOPED, create).workspace;
    // A plain signal first, so the computed one gets another colour than index 0.
    ws = ok(ws, {
      type: "window.addSignal",
      windowId: "w1",
      signalId: "testcar/Fast_100h.SIG_A",
    }).workspace;

    const added = ok(ws, DIFF);
    expect(added.created).toMatch(/^c\d+$/);
    const id = added.created as string;
    expect(added.workspace.computed).toEqual([
      {
        id,
        name: "Diff",
        formula: "a - b",
        a: "Fast_100h.SIG_A",
        b: "Sna_800h.SPEED",
      },
    ]);
    ws = added.workspace;

    const shown = ok(ws, { type: "window.addSignal", windowId: "w1", signalId: `testcar/=${id}` });
    const assignmentId = shown.created as string;
    ws = shown.workspace;
    const colour = ws.colors[`testcar/=${id}`];
    expect(typeof colour).toBe("number");
    expect(colour).not.toBe(ws.colors["testcar/Fast_100h.SIG_A"]);

    const updated = ok(ws, {
      type: "computed.update",
      id,
      name: "Abs",
      formula: "abs(a)",
      a: "Fast_100h.SIG_A",
    });
    const next = updated.created as string;
    expect(next).toMatch(/^c\d+$/);
    expect(next).not.toBe(id);
    expect(numberOf(next)).toBeGreaterThan(numberOf(id));
    ws = updated.workspace;
    // The definition took the new ID in place, without b.
    expect(ws.computed).toEqual([
      { id: next, name: "Abs", formula: "abs(a)", a: "Fast_100h.SIG_A" },
    ]);
    expect(defOf(ws, next) && "b" in (defOf(ws, next) as ComputedDef)).toBe(false);
    // The window keeps the assignment ID and the colour index, on the new signal ID.
    const w1 = ws.windows[0] as TimeseriesWindow;
    expect(w1.signals).toContainEqual({ id: assignmentId, signalId: `testcar/=${next}` });
    expect(w1.signals.some((s) => s.signalId === `testcar/=${id}`)).toBe(false);
    expect(ws.colors[`testcar/=${next}`]).toBe(colour);
    expect(`testcar/=${id}` in ws.colors).toBe(false);

    const removed = ok(ws, { type: "computed.remove", id: next });
    ws = removed.workspace;
    expect(ws.computed ?? []).toEqual([]);
    expect((ws.windows[0] as TimeseriesWindow).signals.map((s) => s.signalId)).toEqual([
      "testcar/Fast_100h.SIG_A",
    ]);
    expect(Object.keys(ws.colors)).toEqual(["testcar/Fast_100h.SIG_A"]);
  });

  it("keeps the shape of a definition", () => {
    // b is dropped when the formula does not use it; unit is kept; an empty unit clears it.
    const withUnit = ok(SCOPED, {
      ...DIFF,
      name: "Abs",
      formula: "abs(a)",
      unit: "V",
    });
    const id = withUnit.created as string;
    expect(withUnit.workspace.computed).toEqual([
      { id, name: "Abs", formula: "abs(a)", a: "Fast_100h.SIG_A", unit: "V" },
    ]);
    const cleared = ok(withUnit.workspace, {
      type: "computed.update",
      id,
      name: "Abs",
      formula: "abs(a)",
      a: "Fast_100h.SIG_A",
      unit: "",
    });
    const def = cleared.workspace.computed?.[0] as ComputedDef;
    expect(def.unit ?? "").toBe("");
    expect(def.name).toBe("Abs");
    // Keeping its own name on update is fine.
    expect(
      run(withUnit.workspace, {
        type: "computed.update",
        id,
        name: "Abs",
        formula: "abs(a)",
        a: "Fast_100h.SIG_A",
      }).ok,
    ).toBe(true);
    // Creation order is kept.
    const two = ok(withUnit.workspace, { ...DIFF, name: "Second" });
    expect(two.workspace.computed?.map((d) => d.name)).toEqual(["Abs", "Second"]);
  });

  it("checks inputs by name without a scope", () => {
    const named = makeCtx([], {
      inputInfo: (name) =>
        name === "Ign_A20h.MODE"
          ? { states: true }
          : name === "Fast_100h.SIG_A" || name === "Sna_800h.SPEED"
            ? { states: false }
            : undefined,
    });
    expect(run(EMPTY_WORKSPACE, DIFF, named).ok).toBe(true);
    expect(run(EMPTY_WORKSPACE, { ...DIFF, a: "Nope_1h.X" }, named)).toMatchObject({
      ok: false,
      code: "unknown_signal",
    });
    expect(run(EMPTY_WORKSPACE, { ...DIFF, b: "Ign_A20h.MODE" }, named)).toMatchObject({
      ok: false,
      code: "not_numeric_signal",
    });
    // Neither a scope nor a catalog to ask: unchecked.
    const bare: ApplyContext = { signalExists: () => false, hasStates: () => false };
    expect(run(EMPTY_WORKSPACE, { ...DIFF, a: "Nope_1h.X" }, bare).ok).toBe(true);
  });

  // spec computed-signals "Refusals"
  it("refuses bad computed definitions", () => {
    const base = ok(SCOPED, DIFF);
    const state = base.workspace;
    const id = base.created as string;
    const frozen = structuredClone(state);
    // Window with four units V, km/h, °C, rpm, and a computed signal of unit V on it.
    let crowded = ok(SCOPED, create).workspace;
    for (const signalId of [
      "testcar/Fast_100h.SIG_A",
      "testcar/Sna_800h.SPEED",
      "testcar/Temp_1h.T",
      "testcar/Rpm_1h.N",
    ])
      crowded = ok(crowded, { type: "window.addSignal", windowId: "w1", signalId }).workspace;
    const unitV = ok(crowded, { ...DIFF, name: "On V", unit: "V" });
    crowded = ok(unitV.workspace, {
      type: "window.addSignal",
      windowId: "w1",
      signalId: `testcar/=${unitV.created}`,
    }).workspace;
    const full: Workspace = {
      ...SCOPED,
      nextId: 100,
      computed: Array.from({ length: 20 }, (_, i) => ({
        id: `c${i + 1}`,
        name: `Signal ${i}`,
        formula: "a",
        a: "Fast_100h.SIG_A",
      })),
    };

    const cases: [string, Workspace, CommandInput, string, string?][] = [
      [
        "bad formula",
        state,
        { ...DIFF, name: "New", formula: "a - c" },
        "invalid_formula",
        'Unknown name "c": use a, b, numbers, + - * / ( ), abs, min, max',
      ],
      [
        "formula before name",
        state,
        { ...DIFF, formula: "a -" },
        "invalid_formula",
        "Unexpected end at 4",
      ],
      ["name ignoring case", state, { ...DIFF, name: "diff" }, "duplicate_name"],
      ["21st definition", full, { ...DIFF, name: "One too many" }, "computed_limit"],
      [
        "unknown input",
        state,
        { ...DIFF, name: "New", a: "Nope_1h.X" },
        "unknown_signal",
        "not in this list: Nope_1h.X",
      ],
      ["state input a", state, { ...DIFF, name: "New", a: "Ign_A20h.MODE" }, "not_numeric_signal"],
      ["state input b", state, { ...DIFF, name: "New", b: "Ign_A20h.MODE" }, "not_numeric_signal"],
      [
        "unknown id",
        state,
        { type: "computed.update", id: "c999", name: "X", formula: "a", a: "Fast_100h.SIG_A" },
        "unknown_computed",
      ],
      ["remove unknown id", state, { type: "computed.remove", id: "c999" }, "unknown_computed"],
      [
        "update to another's name",
        ok(state, { ...DIFF, name: "Other" }).workspace,
        { type: "computed.update", id, name: "other", formula: "a - b", a: DIFF.a, b: DIFF.b },
        "duplicate_name",
      ],
      [
        "fifth unit",
        crowded,
        {
          type: "computed.update",
          id: unitV.created as string,
          name: "On V",
          formula: "a - b",
          a: DIFF.a,
          b: DIFF.b,
          unit: "bar",
        },
        "too_many_units",
      ],
    ];
    for (const [label, ws, input, code, message] of cases) {
      const before = structuredClone(ws);
      const result = run(ws, input);
      expect(result, label).toMatchObject({ ok: false, code });
      if (message !== undefined && !result.ok) expect(result.message, label).toContain(message);
      expect(ws, `${label}: workspace unchanged`).toEqual(before);
    }
    expect(state).toEqual(frozen);
    // Without a scope in scoped mode every command that checks the catalog asks for one.
    expect(run(EMPTY_WORKSPACE, DIFF, makeCtx([], { scopeRequired: true }))).toMatchObject({
      ok: false,
      code: "scope_required",
    });
  });

  // spec computed-signals "Commands treat it as a signal"
  it("treats a computed signal like any signal", () => {
    const c1: ComputedDef = {
      id: "c1",
      name: "Diff",
      formula: "a - b",
      a: "Fast_100h.SIG_A",
      b: "Sna_800h.SPEED",
      unit: "A",
    };
    const state: Workspace = { ...SCOPED, computed: [c1] };
    const withWindow = ok(state, create).workspace;
    const added = ok(withWindow, {
      type: "window.addSignal",
      windowId: "w1",
      signalId: "testcar/=c1",
    });
    expect(typeof added.workspace.colors["testcar/=c1"]).toBe("number");
    expect((added.workspace.windows[0] as TimeseriesWindow).signals).toMatchObject([
      { signalId: "testcar/=c1" },
    ]);

    // An input missing on its data ref: the computed signal does not exist there.
    const noSpeed = makeCtx(["testcar/Sna_800h.SPEED"]);
    expect(
      run(
        withWindow,
        { type: "window.addSignal", windowId: "w1", signalId: "testcar/=c1" },
        noSpeed,
      ),
    ).toEqual({
      ok: false,
      code: "unknown_signal",
      message: "computed signal testcar/=c1: not in this list: Sna_800h.SPEED",
    });
    // A definition that does not exist.
    expect(
      run(withWindow, { type: "window.addSignal", windowId: "w1", signalId: "testcar/=c9" }),
    ).toMatchObject({ ok: false, code: "unknown_signal" });

    // Its unit counts: four other units and A make five.
    let crowded = withWindow;
    for (const signalId of [
      "testcar/Fast_100h.SIG_A",
      "testcar/Sna_800h.SPEED",
      "testcar/Temp_1h.T",
      "testcar/Rpm_1h.N",
    ])
      crowded = ok(crowded, { type: "window.addSignal", windowId: "w1", signalId }).workspace;
    expect(
      run(crowded, { type: "window.addSignal", windowId: "w1", signalId: "testcar/=c1" }),
    ).toMatchObject({ ok: false, code: "too_many_units" });

    // The events line takes state signals only.
    expect(run(state, { type: "events.addSignal", signalId: "testcar/=c1" })).toMatchObject({
      ok: false,
      code: "not_state_signal",
    });
  });

  // spec computed-signals "Step rebinds"
  it("rebinds computed signals on a step", () => {
    const c1: ComputedDef = {
      id: "c1",
      name: "Diff",
      formula: "a - b",
      a: "Fast_100h.SIG_A",
      b: "Sna_800h.SPEED",
    };
    // C4 entry 0 is on testcar, entry 1 on othercar.
    let layout: Workspace = { ...EMPTY_WORKSPACE, nextId: 2, computed: [c1] };
    for (const input of [
      { type: "window.create", from: at(1, 2), to: at(1, 4) },
      { type: "window.addSignal", windowId: "w2", signalId: "testcar/=c1" },
    ] as const)
      layout = ok(layout, input).workspace;
    expect(layout.windows[0]?.id).toBe("w2");
    const opened = openCase({
      catalog: C4,
      current: 0,
      pad: PAD,
      align: { mode: "start" },
      alignAt: at(1, 0),
      layout,
      layoutAlignAt: at(1, 0),
      known: ctx.signalExists,
    }).workspace;
    const withCase = (skip: string[]): ApplyContext => ({
      ...makeCtx(skip),
      case: { entry: (i) => C4.entries[i] },
    });

    const there = ok(opened, { type: "case.step", by: 1 }, withCase([]));
    expect((there.workspace.windows[0] as TimeseriesWindow).signals).toMatchObject([
      { signalId: "othercar/=c1" },
    ]);
    expect(there.missing ?? []).toEqual([]);
    expect(typeof there.workspace.colors["othercar/=c1"]).toBe("number");
    expect(there.workspace.computed).toEqual([c1]);

    const lacking = ok(opened, { type: "case.step", by: 1 }, withCase(["othercar/Sna_800h.SPEED"]));
    expect((lacking.workspace.windows[0] as TimeseriesWindow).signals).toMatchObject([
      { signalId: "othercar/=c1" },
    ]);
    expect(lacking.missing).toEqual(["othercar/=c1"]);
  });

  it("parses the computed commands and the state file", () => {
    const good = { type: "computed.add", name: "Diff", formula: "a - b", a: "A.X", b: "B.Y" };
    expect(Command.safeParse(good).success).toBe(true);
    expect(Command.safeParse({ ...good, unit: "A" }).success).toBe(true);
    expect(Command.safeParse({ ...good, a: undefined }).success).toBe(false);
    expect(Command.safeParse({ ...good, name: "" }).success).toBe(false);
    expect(Command.safeParse({ ...good, name: "x".repeat(61) }).success).toBe(false);
    expect(Command.safeParse({ ...good, name: "x".repeat(60) }).success).toBe(true);
    expect(Command.safeParse({ ...good, formula: "a".repeat(201) }).success).toBe(false);
    expect(Command.safeParse({ ...good, unit: "x".repeat(21) }).success).toBe(false);
    expect(Command.safeParse({ ...good, extra: 1 }).success).toBe(false);
    expect(Command.safeParse({ ...good, type: "computed.update", id: "c1" }).success).toBe(true);
    expect(Command.safeParse({ ...good, type: "computed.update", unit: "" }).success).toBe(false);
    expect(
      Command.safeParse({ ...good, type: "computed.update", id: "c1", unit: "" }).success,
    ).toBe(true);
    expect(Command.safeParse({ type: "computed.remove", id: "c1" }).success).toBe(true);
    expect(Command.safeParse({ type: "computed.remove" }).success).toBe(false);

    const def = { id: "c1", name: "Diff", formula: "a - b", a: "A.X", b: "B.Y", unit: "A" };
    expect(WorkspaceSchema.safeParse({ ...EMPTY_WORKSPACE, computed: [def] }).success).toBe(true);
    expect(WorkspaceSchema.safeParse({ ...EMPTY_WORKSPACE, computed: [] }).success).toBe(true);
    expect(
      WorkspaceSchema.safeParse({ ...EMPTY_WORKSPACE, computed: [{ ...def, extra: 1 }] }).success,
    ).toBe(false);
    expect(
      WorkspaceSchema.safeParse({ ...EMPTY_WORKSPACE, computed: [{ ...def, name: "" }] }).success,
    ).toBe(false);
  });
});
