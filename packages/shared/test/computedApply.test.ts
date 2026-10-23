import { describe, expect, it } from "vitest";
import { type ApplyContext, applyCommand } from "../src/apply.ts";
import { openCase } from "../src/caseApply.ts";
import { type ComputedDef, checkFormula } from "../src/computed.ts";
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
for (let i = 0; i <= 8; i++) UNITS[`testcar/Many_700h.S${String(i).padStart(4, "0")}`] = undefined;
const STATES = new Set(["testcar/Ign_A20h.MODE"]);
const many = (from: number, to: number) =>
  Array.from(
    { length: to - from + 1 },
    (_, i) => `Many_700h.S${String(from + i).padStart(4, "0")}`,
  );

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
  formula: "Fast_100h.SIG_A - Sna_800h.SPEED",
} as const;
const ABS_DIFF = { type: "computed.add", name: "AbsDiff", formula: "abs(Diff)" } as const;

const defOf = (ws: Workspace, id: string) => ws.computed?.find((d) => d.id === id);
const byName = (ws: Workspace, name: string) =>
  ws.computed?.find((d) => d.name === name) as ComputedDef;
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

    const added = ok(ws, { ...DIFF, formula: "Fast_100h.SIG_A-Sna_800h.SPEED" });
    expect(added.created).toMatch(/^c\d+$/);
    const id = added.created as string;
    // The stored formula is the canonical text.
    expect(added.workspace.computed).toEqual([
      { id, name: "Diff", formula: "Fast_100h.SIG_A - Sna_800h.SPEED" },
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
      formula: "abs(Fast_100h.SIG_A)",
    });
    const next = updated.created as string;
    expect(next).toMatch(/^c\d+$/);
    expect(next).not.toBe(id);
    expect(numberOf(next)).toBeGreaterThan(numberOf(id));
    ws = updated.workspace;
    // The definition took the new ID in place.
    expect(ws.computed).toEqual([{ id: next, name: "Abs", formula: "abs(Fast_100h.SIG_A)" }]);
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

  // spec computed-signals "Live reference in the workspace"
  it("keeps nested computed signals live", () => {
    let ws = ok(SCOPED, create).workspace;
    const diff = ok(ws, DIFF);
    ws = diff.workspace;
    const diffId = diff.created as string;
    const outer = ok(ws, ABS_DIFF);
    ws = outer.workspace;
    const outerId = outer.created as string;
    expect(defOf(ws, outerId)?.formula).toBe("abs(Diff)");
    // Both in one window.
    const a1 = ok(ws, { type: "window.addSignal", windowId: "w1", signalId: `testcar/=${diffId}` });
    ws = a1.workspace;
    const a2 = ok(ws, {
      type: "window.addSignal",
      windowId: "w1",
      signalId: `testcar/=${outerId}`,
    });
    ws = a2.workspace;
    const colours = [ws.colors[`testcar/=${diffId}`], ws.colors[`testcar/=${outerId}`]];
    expect(colours.every((c) => typeof c === "number")).toBe(true);

    // Rename Diff to Sum and change its formula: both get new IDs.
    const updated = ok(ws, {
      type: "computed.update",
      id: diffId,
      name: "Sum",
      formula: "Fast_100h.SIG_A + Sna_800h.SPEED",
    });
    ws = updated.workspace;
    const sum = byName(ws, "Sum");
    const abs = byName(ws, "AbsDiff");
    expect(updated.created).toBe(sum.id);
    expect(sum.id).not.toBe(diffId);
    expect(abs.id).not.toBe(outerId);
    expect(numberOf(sum.id)).toBeGreaterThan(numberOf(diffId));
    expect(numberOf(abs.id)).toBeGreaterThan(numberOf(outerId));
    expect(sum.formula).toBe("Fast_100h.SIG_A + Sna_800h.SPEED");
    // The user is rewritten to the new name and keeps its own name.
    expect(abs.formula).toBe("abs(Sum)");
    expect(abs.name).toBe("AbsDiff");
    // Both assignments keep their IDs and colour indexes and name the new IDs.
    const w1 = ws.windows[0] as TimeseriesWindow;
    expect(w1.signals).toEqual([
      { id: a1.created, signalId: `testcar/=${sum.id}` },
      { id: a2.created, signalId: `testcar/=${abs.id}` },
    ]);
    expect([ws.colors[`testcar/=${sum.id}`], ws.colors[`testcar/=${abs.id}`]]).toEqual(colours);
    expect(Object.keys(ws.colors).sort()).toEqual(
      [`testcar/=${sum.id}`, `testcar/=${abs.id}`].sort(),
    );

    // Removing the used one is refused, naming the user; the workspace is unchanged.
    const before = structuredClone(ws);
    const refused = run(ws, { type: "computed.remove", id: sum.id });
    expect(refused).toMatchObject({ ok: false, code: "computed_in_use" });
    if (!refused.ok) expect(refused.message).toContain('used by: "AbsDiff"');
    expect(ws).toEqual(before);

    // Outer first, then inner: the window ends empty.
    ws = ok(ws, { type: "computed.remove", id: abs.id }).workspace;
    ws = ok(ws, { type: "computed.remove", id: sum.id }).workspace;
    expect(ws.computed ?? []).toEqual([]);
    expect((ws.windows[0] as TimeseriesWindow).signals).toEqual([]);
    expect(ws.colors).toEqual({});
  });

  it("gives every transitive user a new ID, in creation order", () => {
    let ws = ok(SCOPED, DIFF).workspace;
    ws = ok(ws, ABS_DIFF).workspace;
    ws = ok(ws, { type: "computed.add", name: "Twice", formula: "AbsDiff * 2" }).workspace;
    const before = ws.computed?.map((d) => d.id) as string[];
    const updated = ok(ws, {
      type: "computed.update",
      id: before[0] as string,
      name: "Diff",
      formula: "Fast_100h.SIG_A * 2",
    });
    const after = updated.workspace.computed?.map((d) => d.id) as string[];
    expect(after).toHaveLength(3);
    for (let i = 0; i < 3; i++) expect(after[i]).not.toBe(before[i]);
    // The edited one first, then its users in creation order.
    expect(numberOf(after[0] as string)).toBeLessThan(numberOf(after[1] as string));
    expect(numberOf(after[1] as string)).toBeLessThan(numberOf(after[2] as string));
    expect(updated.created).toBe(after[0]);
    expect(updated.workspace.computed?.map((d) => d.name)).toEqual(["Diff", "AbsDiff", "Twice"]);
    expect(updated.workspace.computed?.map((d) => d.formula)).toEqual([
      "Fast_100h.SIG_A * 2",
      "abs(Diff)",
      "AbsDiff * 2",
    ]);
  });

  it("rewrites the formulas of direct users on a rename only", () => {
    let ws = ok(SCOPED, DIFF).workspace;
    ws = ok(ws, { ...ABS_DIFF, formula: "abs(Diff) + Diff * 2" }).workspace;
    const id = byName(ws, "Diff").id;
    const renamed = ok(ws, {
      type: "computed.update",
      id,
      name: "Delta V",
      formula: "Fast_100h.SIG_A - Sna_800h.SPEED",
    }).workspace;
    expect(byName(renamed, "AbsDiff").formula).toBe('abs("Delta V") + "Delta V" * 2');
  });

  // improve-formula-editor round 2: the editor (`checkFormula`) and `computed.update` apply one rename rule.
  describe("rename parity of the editor check and computed.update", () => {
    const LONG = `Very long computed signal name ${"x".repeat(28)}`; // 59 characters, needs quotes
    const WIDE = Array.from({ length: 32 }, () => "Diff").join(" + "); // 32 names, 221 characters

    /** Both paths on one rename of Diff; the chain Diff <- AbsDiff <- Twice, plus the extra user. */
    function both(newName: string, extra?: { name: string; formula: string }) {
      let ws = ok(SCOPED, DIFF).workspace;
      ws = ok(ws, { ...ABS_DIFF, formula: "abs(Diff) + Diff * 2" }).workspace;
      ws = ok(ws, { type: "computed.add", name: "Twice", formula: "AbsDiff * 2" }).workspace;
      if (extra) ws = ok(ws, { type: "computed.add", ...extra }).workspace;
      const defs = ws.computed as ComputedDef[];
      const id = byName(ws, "Diff").id;
      const formula = DIFF.formula;
      const checked = checkFormula(formula, defs, { id, name: newName }, () => "numeric");
      const applied = run(ws, { type: "computed.update", id, name: newName, formula });
      return { ws, defs, checked, applied };
    }

    it("gives the same users and the same texts for a nested rename", () => {
      const { defs, checked, applied } = both("Delta V");
      expect(checked.ok).toBe(true);
      expect(applied.ok).toBe(true);
      if (!checked.ok || !applied.ok) return;
      // The editor path: the direct and the transitive user get new IDs, in creation order.
      expect(checked.users).toEqual(defs.filter((d) => d.name !== "Diff").map((d) => d.id));
      // The command: exactly those got new IDs, and the direct user's text is rewritten.
      const after = applied.workspace.computed as ComputedDef[];
      expect(after.map((d) => d.name)).toEqual(["Delta V", "AbsDiff", "Twice"]);
      const changed = after.map((d, i) => d.id !== (defs[i] as ComputedDef).id);
      expect(changed).toEqual([true, true, true]);
      expect(defs.slice(1).map((d) => d.id)).toEqual(checked.users);
      expect(after.slice(1).map((d) => d.id)).not.toEqual(checked.users);
      expect(after.map((d) => d.formula)).toEqual([
        "Fast_100h.SIG_A - Sna_800h.SPEED",
        'abs("Delta V") + "Delta V" * 2',
        "AbsDiff * 2",
      ]);
    });

    it("quotes a renamed reference the same way, with a name only the quotes can hold", () => {
      const { checked, applied } = both(LONG);
      expect(checked.ok).toBe(true);
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(byName(applied.workspace, "AbsDiff").formula).toBe(`abs("${LONG}") + "${LONG}" * 2`);
    });

    it("refuses a rename that pushes a user past 500 characters on both paths", () => {
      const extra = { name: "Many", formula: WIDE };
      const { checked, applied } = both(LONG, extra);
      expect(checked).toMatchObject({ ok: false, code: "invalid_formula" });
      expect(applied).toMatchObject({ ok: false, code: "invalid_formula" });
      if (checked.ok || applied.ok) return;
      // One message, naming the user that would not fit.
      expect(applied.message).toBe(checked.message);
      expect(applied.message).toContain('"Many"');
    });
  });

  it("answers Name already used for a name that exists, even when the formula uses it", () => {
    const ws = ok(SCOPED, DIFF).workspace;
    // `Diff` named `Diff` over `abs(Diff)` would also be a cycle; the name is the first answer.
    const refused = run(ws, { type: "computed.add", name: "Diff", formula: "abs(Diff)" });
    expect(refused).toMatchObject({ ok: false, code: "duplicate_name" });
    if (!refused.ok) expect(refused.message).toBe("Name already used: Diff");
    const id = byName(ws, "Diff").id;
    const other = ok(ws, ABS_DIFF).workspace;
    const second = run(other, {
      type: "computed.update",
      id,
      name: "AbsDiff",
      formula: "abs(AbsDiff)",
    });
    expect(second).toMatchObject({ ok: false, code: "duplicate_name" });
  });

  it("keeps the shape of a definition", () => {
    // unit is kept; an empty unit clears it.
    const withUnit = ok(SCOPED, {
      ...DIFF,
      name: "Abs",
      formula: "abs(Fast_100h.SIG_A)",
      unit: "V",
    });
    const id = withUnit.created as string;
    expect(withUnit.workspace.computed).toEqual([
      { id, name: "Abs", formula: "abs(Fast_100h.SIG_A)", unit: "V" },
    ]);
    const cleared = ok(withUnit.workspace, {
      type: "computed.update",
      id,
      name: "Abs",
      formula: "abs(Fast_100h.SIG_A)",
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
        formula: "abs(Fast_100h.SIG_A)",
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
    expect(
      run(EMPTY_WORKSPACE, { ...DIFF, formula: "Nope_1h.X - Sna_800h.SPEED" }, named),
    ).toMatchObject({
      ok: false,
      code: "unknown_signal",
    });
    expect(
      run(EMPTY_WORKSPACE, { ...DIFF, formula: "Fast_100h.SIG_A - Ign_A20h.MODE" }, named),
    ).toMatchObject({
      ok: false,
      code: "not_numeric_signal",
    });
    // Neither a scope nor a catalog to ask: unchecked.
    const bare: ApplyContext = { signalExists: () => false, hasStates: () => false };
    expect(run(EMPTY_WORKSPACE, { ...DIFF, formula: "Nope_1h.X - Sna_800h.SPEED" }, bare).ok).toBe(
      true,
    );
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
        formula: "Fast_100h.SIG_A",
      })),
    };
    // Q-5: Big uses Diff and six more sources, eight in all; Diff growing by one pushes Big to 9.
    const wide = ok(SCOPED, { ...DIFF, formula: `${many(0, 1).join(" + ")}` });
    const wideId = wide.created as string;
    const big = ok(wide.workspace, {
      ...DIFF,
      name: "Big",
      formula: `Diff + ${many(2, 7).join(" + ")}`,
    }).workspace;
    const nested = ok(state, ABS_DIFF).workspace;

    const cases: [string, Workspace, CommandInput, string, string?][] = [
      [
        "unknown source",
        state,
        { ...DIFF, name: "New", formula: "Fast_100h.SIG_A - Nope_1h.X" },
        "unknown_signal",
        "not in this list: Nope_1h.X",
      ],
      [
        "short names",
        state,
        { ...DIFF, name: "New", formula: "SIG_A - SPEED" },
        "unknown_signal",
        "not in this list: SIG_A",
      ],
      [
        "formula syntax",
        state,
        { ...DIFF, name: "New", formula: "Fast_100h.SIG_A -" },
        "invalid_formula",
        "Unexpected end at 18",
      ],
      ["name ignoring case", state, { ...DIFF, name: "diff" }, "duplicate_name"],
      [
        "name of a signal",
        state,
        { ...DIFF, name: "Fast_100h.SIG_A" },
        "duplicate_name",
        "Name used by a signal: Fast_100h.SIG_A",
      ],
      ["21st definition", full, { ...DIFF, name: "One too many" }, "computed_limit"],
      [
        "state source",
        state,
        { ...DIFF, name: "New", formula: "Fast_100h.SIG_A - Ign_A20h.MODE" },
        "not_numeric_signal",
      ],
      [
        "nine sources",
        state,
        { ...DIFF, name: "New", formula: many(0, 8).join(" + ") },
        "invalid_formula",
        "At most 8 signals (with nested ones): 9",
      ],
      [
        "unknown id",
        state,
        { type: "computed.update", id: "c999", name: "X", formula: "Fast_100h.SIG_A" },
        "unknown_computed",
      ],
      ["remove unknown id", state, { type: "computed.remove", id: "c999" }, "unknown_computed"],
      [
        "update to another's name",
        ok(state, { ...DIFF, name: "Other" }).workspace,
        { type: "computed.update", id, name: "other", formula: DIFF.formula },
        "duplicate_name",
      ],
      [
        "cycle",
        nested,
        { type: "computed.update", id, name: "Diff", formula: "abs(AbsDiff)" },
        "invalid_formula",
        "Cycle:",
      ],
      [
        "update pushes a user past 8",
        big,
        {
          type: "computed.update",
          id: wideId,
          name: "Diff",
          formula: [...many(0, 1), ...many(8, 8)].join(" + "),
        },
        "invalid_formula",
        'At most 8 signals in "Big" (with nested ones): 9',
      ],
      [
        "remove a used one",
        nested,
        { type: "computed.remove", id },
        "computed_in_use",
        'used by: "AbsDiff"',
      ],
      [
        "fifth unit",
        crowded,
        {
          type: "computed.update",
          id: unitV.created as string,
          name: "On V",
          formula: DIFF.formula,
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
    // The old inputs a and b are not part of a command any more.
    expect(Command.safeParse({ ...DIFF, a: "Fast_100h.SIG_A", b: "Sna_800h.SPEED" }).success).toBe(
      false,
    );
    expect(Command.safeParse({ ...DIFF, a: "Fast_100h.SIG_A" }).success).toBe(false);
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
      formula: "Fast_100h.SIG_A - Sna_800h.SPEED",
      unit: "A",
    };
    const c2: ComputedDef = { id: "c2", name: "AbsDiff", formula: "abs(Diff)" };
    const state: Workspace = { ...SCOPED, computed: [c1, c2] };
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

    // A nested source missing on its data ref: the computed signal does not exist there.
    const noSpeed = makeCtx(["testcar/Sna_800h.SPEED"]);
    expect(
      run(
        withWindow,
        { type: "window.addSignal", windowId: "w1", signalId: "testcar/=c2" },
        noSpeed,
      ),
    ).toEqual({
      ok: false,
      code: "unknown_signal",
      message: "computed signal testcar/=c2: not in this list: Sna_800h.SPEED",
    });
    // The nested one with all sources counts once.
    const nestedAdded = ok(withWindow, {
      type: "window.addSignal",
      windowId: "w1",
      signalId: "testcar/=c2",
    });
    expect((nestedAdded.workspace.windows[0] as TimeseriesWindow).signals).toHaveLength(1);
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
      formula: "Fast_100h.SIG_A - Sna_800h.SPEED",
    };
    const c2: ComputedDef = { id: "c2", name: "AbsDiff", formula: "abs(Diff)" };
    // C4 entry 0 is on testcar, entry 1 on othercar.
    let layout: Workspace = { ...EMPTY_WORKSPACE, nextId: 2, computed: [c1, c2] };
    for (const input of [
      { type: "window.create", from: at(1, 2), to: at(1, 4) },
      { type: "window.addSignal", windowId: "w2", signalId: "testcar/=c2" },
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
      { signalId: "othercar/=c2" },
    ]);
    expect(there.missing ?? []).toEqual([]);
    expect(typeof there.workspace.colors["othercar/=c2"]).toBe("number");
    expect(there.workspace.computed).toEqual([c1, c2]);

    const lacking = ok(opened, { type: "case.step", by: 1 }, withCase(["othercar/Sna_800h.SPEED"]));
    expect((lacking.workspace.windows[0] as TimeseriesWindow).signals).toMatchObject([
      { signalId: "othercar/=c2" },
    ]);
    expect(lacking.missing).toEqual(["othercar/=c2"]);
  });

  it("parses the computed commands and the state file", () => {
    const good = { type: "computed.add", name: "Diff", formula: "A.X - B.Y" };
    expect(Command.safeParse(good).success).toBe(true);
    expect(Command.safeParse({ ...good, unit: "A" }).success).toBe(true);
    expect(Command.safeParse({ ...good, name: "" }).success).toBe(false);
    expect(Command.safeParse({ ...good, name: "x".repeat(61) }).success).toBe(false);
    expect(Command.safeParse({ ...good, name: "x".repeat(60) }).success).toBe(true);
    expect(Command.safeParse({ ...good, formula: "A.X".padEnd(500, " ") }).success).toBe(true);
    expect(Command.safeParse({ ...good, formula: "A.X".padEnd(501, " ") }).success).toBe(false);
    expect(Command.safeParse({ ...good, unit: "x".repeat(21) }).success).toBe(false);
    expect(Command.safeParse({ ...good, extra: 1 }).success).toBe(false);
    expect(Command.safeParse({ ...good, a: "A.X" }).success).toBe(false);
    expect(Command.safeParse({ ...good, b: "B.Y" }).success).toBe(false);
    expect(Command.safeParse({ ...good, type: "computed.update", id: "c1" }).success).toBe(true);
    expect(Command.safeParse({ ...good, type: "computed.update", unit: "" }).success).toBe(false);
    expect(
      Command.safeParse({ ...good, type: "computed.update", id: "c1", unit: "" }).success,
    ).toBe(true);
    expect(Command.safeParse({ type: "computed.remove", id: "c1" }).success).toBe(true);
    expect(Command.safeParse({ type: "computed.remove" }).success).toBe(false);

    const def = { id: "c1", name: "Diff", formula: "A.X - B.Y", unit: "A" };
    expect(WorkspaceSchema.safeParse({ ...EMPTY_WORKSPACE, computed: [def] }).success).toBe(true);
    expect(WorkspaceSchema.safeParse({ ...EMPTY_WORKSPACE, computed: [] }).success).toBe(true);
    // A malformed entry makes the file fail like any malformed entry (no migration, D-108).
    for (const bad of [
      { ...def, extra: 1 },
      { ...def, name: "" },
    ]) {
      expect(WorkspaceSchema.safeParse({ ...EMPTY_WORKSPACE, computed: [bad] }).success).toBe(
        false,
      );
    }
  });
});
