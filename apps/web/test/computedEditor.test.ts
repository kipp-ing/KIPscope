import { buildSearchIndex, type ComputedDef, type SignalInfo } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { suggestions, tokenAt } from "../src/computed/completion.ts";
import {
  canonicalFormula,
  type EditorContext,
  type EditorState,
  editorError,
  formulaNames,
  fromDef,
  prefill,
  withAuto,
} from "../src/computed/editor.ts";
import { HINTS } from "../src/help/hints.ts";

const info = (name: string, extra: Partial<SignalInfo> = {}): SignalInfo => ({
  id: `smart451/${name}`,
  dataRef: "smart451",
  name,
  ...extra,
});
const DNMOT = info("MS_312h.DNMOT", { unit: "rpm" });
const SPEED = info("MS_312h.SPEED", { unit: "rpm" });
const CURR = info("CPC_508h.PNHV_SupBat_Curr", { unit: "A" });
const MODE = info("MS_1h.MODE", { states: "labels" });
const ENG_TEMP = info("Eng_1h.TEMP");
const BAT_TEMP = info("Bat_2h.TEMP");
const ALL = [DNMOT, SPEED, CURR, ENG_TEMP, BAT_TEMP, MODE];

const D = "DNMOT − PNHV_SupBat_Curr"; // U+2212
const ABS_D = `abs(${D})`;
const C1: ComputedDef = {
  id: "c1",
  name: D,
  formula: "MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr",
  unit: "A",
};
const C2: ComputedDef = { id: "c2", name: ABS_D, formula: `abs("${D}")`, unit: "A" };
const DEFS = [C1, C2];

const ctxOf = (defs: readonly ComputedDef[] = DEFS, selfId?: string): EditorContext => ({
  names: formulaNames(ALL, defs),
  defs,
  ...(selfId !== undefined && { selfId }),
});

/** The computed signal's info as `computedInfos` gives it. */
const computedInfo = (def: ComputedDef): SignalInfo =>
  info(`=${def.id}`, {
    displayName: def.name,
    ...(def.unit !== undefined && { unit: def.unit }),
    description: def.formula,
    computed: { formula: def.formula },
  });

const state = (formula: string, extra: Partial<EditorState> = {}): EditorState => ({
  formula,
  name: "Mine",
  unit: "",
  nameAuto: false,
  unitAuto: false,
  ...extra,
});

describe("computed editor state", () => {
  // spec computed-signals "Prefill from the selection"
  it("prefills from the selection", () => {
    // Click order: DNMOT first although CURR may be listed above it.
    const two = prefill([DNMOT, CURR]);
    expect(two.formula).toBe("MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr");
    expect(two.caret).toBe(41);
    const swapped = prefill([CURR, DNMOT]);
    expect(swapped.formula).toBe("CPC_508h.PNHV_SupBat_Curr - MS_312h.DNMOT");
    const one = prefill([DNMOT]);
    expect(one.formula).toBe("abs(MS_312h.DNMOT)");
    expect(one.caret).toBe(18);
    // A signal with states is left out; a computed signal is kept and quoted.
    const mixed = prefill([DNMOT, MODE, CURR, computedInfo(C1)]);
    expect(mixed.formula).toBe(`MS_312h.DNMOT + CPC_508h.PNHV_SupBat_Curr + "${D}"`);
    expect(mixed.caret).toBe(mixed.formula.length);
    // Nothing selected, or only a signal with states: an empty field, caret 0.
    const none = prefill([]);
    expect(none.formula).toBe("");
    expect(none.caret).toBe(0);
    expect(prefill([MODE]).formula).toBe("");
    // An unavailable computed signal is left out.
    const gone: SignalInfo = {
      ...computedInfo(C1),
      computed: { formula: C1.formula, unavailable: "not in this list: CPC_508h.PNHV_SupBat_Curr" },
    };
    expect(prefill([DNMOT, gone]).formula).toBe("abs(MS_312h.DNMOT)");
    // Nine numeric signals: the first eight, joined by " + ".
    const nine = Array.from({ length: 9 }, (_, i) => info(`ECU_${100 + i}h.SIG${i}`));
    expect(prefill(nine).formula).toBe(
      nine
        .slice(0, 8)
        .map((s) => s.name)
        .join(" + "),
    );
    // Both auto flags are on: name and unit follow once the editor asks (withAuto).
    expect(two.nameAuto && two.unitAuto).toBe(true);
    const filled = withAuto(two, ctxOf([]));
    expect(filled.name).toBe(D);
    expect(filled.unit).toBe("");
    const dnmotSpeed = withAuto(prefill([DNMOT, SPEED]), ctxOf([]));
    expect(dnmotSpeed.name).toBe("DNMOT − SPEED");
    expect(dnmotSpeed.unit).toBe("rpm");
    expect(withAuto(one, ctxOf([])).name).toBe("abs(DNMOT)");
    expect(withAuto(one, ctxOf([])).unit).toBe("rpm");
  });

  // spec computed-signals "Live error blocks Save"
  it("shows the first error and blocks Save", () => {
    const ctx = ctxOf();
    expect(editorError(state("DNMOT -"), ctx)).toBe("Unexpected end at 8");
    expect(editorError(state("DNMOX"), ctx)).toBe('Unknown signal "DNMOX" at 1');
    expect(editorError(state("MS_312h.DNMOT - DNMOX"), ctx)).toBe('Unknown signal "DNMOX" at 17');
    expect(editorError(state(""), ctx)).toBe("Enter a formula");
    expect(editorError(state("MODE + 1"), ctx)).toBe(
      "MS_1h.MODE has states at 1: use a numeric signal",
    );
    expect(editorError(state("TEMP + 1"), ctx)).toBe(
      'Ambiguous "TEMP" at 1: Bat_2h.TEMP, Eng_1h.TEMP',
    );
    // Editing c1 so that it uses c2, which uses c1: a cycle, naming the chain.
    expect(editorError(state(`"${ABS_D}" + 1`, { name: D }), ctxOf(DEFS, "c1"))).toBe(
      `Cycle: "${D}" → "${ABS_D}" → "${D}"`,
    );
    // A valid formula with the name of another definition, or of a listed signal.
    expect(editorError(state("MS_312h.DNMOT * 2", { name: ABS_D }), ctx)).toBe("Name already used");
    expect(editorError(state("MS_312h.DNMOT * 2", { name: ABS_D.toUpperCase() }), ctx)).toBe(
      "Name already used",
    );
    expect(editorError(state("MS_312h.DNMOT * 2", { name: "MS_312h.DNMOT" }), ctx)).toBe(
      "Name used by a signal: MS_312h.DNMOT",
    );
    // Editing a definition may keep its own name.
    expect(editorError(state("MS_312h.DNMOT * 2", { name: D }), ctxOf(DEFS, "c1"))).toBeUndefined();
    // A valid state: no error, and Save sends the canonical formula over full names.
    expect(editorError(state("dnmot*2"), ctx)).toBeUndefined();
    expect(canonicalFormula(state("dnmot*2"), ctx)).toBe("MS_312h.DNMOT * 2");
    expect(canonicalFormula(state(`abs("${D.toLowerCase()}")`), ctx)).toBe(`abs("${D}")`);
    // No canonical formula while it does not check.
    expect(canonicalFormula(state("DNMOX"), ctx)).toBeUndefined();
    // Name rules of C6.
    expect(editorError(state("dnmot*2", { name: "" }), ctx)).toBeDefined();
    expect(editorError(state("dnmot*2", { name: "x".repeat(61) }), ctx)).toBe(
      "At most 60 characters",
    );
    expect(editorError(state("dnmot*2", { name: "x".repeat(60) }), ctx)).toBeUndefined();
    // The formula comes first when several things are wrong.
    expect(editorError(state("DNMOT -", { name: ABS_D }), ctx)).toBe("Unexpected end at 8");
  });

  it("answers Name already used for a name that exists, even when the formula uses it", () => {
    const diff: ComputedDef = { id: "c3", name: "Diff", formula: "MS_312h.DNMOT - MS_312h.SPEED" };
    const ctx = ctxOf([diff]);
    // A new `Diff` over `abs(Diff)` would read as a cycle; the taken name is the first answer.
    expect(editorError(state("abs(Diff)", { name: "Diff" }), ctx)).toBe("Name already used");
    expect(editorError(state("abs(diff)", { name: "DIFF" }), ctx)).toBe("Name already used");
    // The same text under a free name is fine; the edited definition may keep its own name.
    expect(editorError(state("abs(Diff)", { name: "AbsDiff" }), ctx)).toBeUndefined();
    expect(
      editorError(state("MS_312h.DNMOT * 2", { name: "Diff" }), ctxOf([diff], "c3")),
    ).toBeUndefined();
  });

  it("refuses a formula with more than eight signals, nested ones included", () => {
    const nine = Array.from({ length: 9 }, (_, i) => info(`Many_700h.S${i}`));
    const ctx: EditorContext = { names: formulaNames([...ALL, ...nine], DEFS), defs: DEFS };
    expect(editorError(state(nine.map((s) => s.name).join(" + ")), ctx)).toBe(
      "At most 8 signals (with nested ones): 9",
    );
    // Editing c1 to seven new signals plus DNMOT pushes c2... and c2 stays at eight: fine.
    const seven = nine.slice(0, 7).map((s) => s.name);
    expect(
      editorError(state([...seven, "MS_312h.DNMOT"].join(" + "), { name: D }), {
        ...ctx,
        selfId: "c1",
      }),
    ).toBeUndefined();
    // An outer definition that would have nine sources after the edit is named in the refusal.
    const outer: ComputedDef = { id: "c3", name: "Plus", formula: `"${D}" + Many_700h.S8` };
    const ctx3: EditorContext = {
      names: formulaNames([...ALL, ...nine], [...DEFS, outer]),
      defs: [...DEFS, outer],
      selfId: "c1",
    };
    expect(editorError(state([...seven, "MS_312h.DNMOT"].join(" + "), { name: D }), ctx3)).toBe(
      'At most 8 signals in "Plus" (with nested ones): 9',
    );
  });

  // spec computed-signals "Auto name and unit" (editor part)
  it("follows the formula with name and unit until typed", () => {
    // Only c1 exists: a nested auto name must not collide with c2's own name.
    const ctx = ctxOf([C1]);
    const s = withAuto(prefill([DNMOT, SPEED]), ctx);
    expect(s.name).toBe("DNMOT − SPEED");
    expect(s.unit).toBe("rpm");
    // A new formula: both follow.
    const scaled = withAuto({ ...s, formula: "MS_312h.DNMOT * 1" }, ctx);
    expect(scaled.name).toBe("DNMOT × 1");
    expect(scaled.unit).toBe("");
    const min = withAuto({ ...s, formula: "min(MS_312h.DNMOT, MS_312h.SPEED)" }, ctx);
    expect(min.name).toBe("min(DNMOT, SPEED)");
    expect(min.unit).toBe("rpm");
    // Typed short names resolve for the name too.
    const typed = withAuto({ ...s, formula: "dnmot + speed + 1" }, ctx);
    expect(typed.name).toBe("DNMOT + SPEED + 1");
    expect(typed.unit).toBe("rpm");
    // A nested signal: its definition's name and stored unit.
    const nested = withAuto({ ...s, formula: `abs("${D}")` }, ctx);
    expect(nested.name).toBe(`abs(${D})`);
    expect(nested.unit).toBe("A");
    const times = withAuto({ ...s, formula: `"${D}" * 2` }, ctx);
    expect(times.name).toBe(`(${D}) × 2`);
    expect(times.unit).toBe("");
    // A typed name stays, the unit still follows; and the other way round.
    const typedName = withAuto(
      { ...s, name: "Mine", nameAuto: false, formula: "MS_312h.DNMOT * 1" },
      ctx,
    );
    expect(typedName.name).toBe("Mine");
    expect(typedName.unit).toBe("");
    const typedUnit = withAuto(
      { ...s, unit: "rev", unitAuto: false, formula: "MS_312h.DNMOT * 1" },
      ctx,
    );
    expect(typedUnit.unit).toBe("rev");
    expect(typedUnit.name).toBe("DNMOT × 1");
    // A taken auto name gets a number.
    const taken = [{ id: "c1", name: "DNMOT − SPEED", formula: "MS_312h.DNMOT - MS_312h.SPEED" }];
    expect(withAuto(s, ctxOf(taken)).name).toBe("DNMOT − SPEED 2");
    const taken2 = [
      ...taken,
      { id: "c2", name: "DNMOT − SPEED 2", formula: "MS_312h.DNMOT - MS_312h.SPEED" },
    ];
    expect(withAuto(s, ctxOf(taken2)).name).toBe("DNMOT − SPEED 3");
    // While the formula does not resolve, name and unit stay.
    const broken = withAuto({ ...s, formula: "MS_312h.DNMOT -" }, ctx);
    expect(broken.name).toBe(s.name);
    expect(broken.unit).toBe(s.unit);
    const unknown = withAuto({ ...s, formula: "DNMOX * 2" }, ctx);
    expect(unknown.name).toBe(s.name);
    // Three signals, all auto.
    const three = withAuto({ ...s, formula: "MS_312h.DNMOT + MS_312h.SPEED + MS_312h.DNMOT" }, ctx);
    expect(three.name).toBe("DNMOT + SPEED + DNMOT");
  });

  // Q-4: an inner edit changes no outer name or unit; the editor of an edited definition
  it("follows only where an edited definition still has the auto value", () => {
    const ctx = ctxOf(DEFS, "c1");
    const auto = fromDef(C1, ctx);
    expect(auto).toMatchObject({
      formula: C1.formula,
      name: D,
      unit: "A",
      nameAuto: true,
      unitAuto: false, // the auto unit of rpm − A is none, the stored one is A
    });
    const typed = fromDef({ ...C1, name: "My difference", unit: "rpm" }, ctx);
    expect(typed.name).toBe("My difference");
    expect(typed.nameAuto).toBe(false);
    expect(typed.unit).toBe("rpm");
    expect(typed.unitAuto).toBe(false);
    // The stored unit equals the auto unit (both inputs in A): the field follows.
    const amps = fromDef(
      { id: "c1", name: "Currents", formula: "CPC_508h.PNHV_SupBat_Curr + 1", unit: "A" },
      ctxOf([], undefined),
    );
    expect(amps.unitAuto).toBe(true);
    expect(amps.nameAuto).toBe(false);
    // The editor shows the stored formula as stored.
    expect(fromDef(C2, ctxOf(DEFS, "c2")).formula).toBe(`abs("${D}")`);
  });
});

describe("computed editor completion", () => {
  // spec computed-signals "State signals not suggested for use" (the data the markup is drawn from)
  it("refuses state signals in the suggestions", () => {
    const index = buildSearchIndex([DNMOT, MODE, CURR]);
    const token = tokenAt("MOD", 3);
    if (!token) throw new Error("no token");
    const rows = suggestions(token, index, new Set());
    const mode = rows.find((r) => r.kind === "signal" && r.info.name === "MS_1h.MODE");
    expect(mode).toMatchObject({ kind: "signal", disabled: HINTS.computedNumericOnly("MODE") });
    expect(HINTS.computedNumericOnly("MODE")).toBe("MODE has states: pick a numeric signal");
  });

  it("leaves the edited signal and its users out of the suggestions", () => {
    // The caller excludes the definition being edited and every user of it (they would close a cycle).
    const index = buildSearchIndex([DNMOT, CURR, computedInfo(C1), computedInfo(C2)]);
    const token = tokenAt("DNMOT", 5);
    if (!token) throw new Error("no token");
    const all = suggestions(token, index, new Set());
    const ids = all.flatMap((r) => (r.kind === "signal" ? [r.info.id] : []));
    expect(ids).toEqual(expect.arrayContaining(["smart451/=c1", "smart451/=c2"]));
    const without = suggestions(token, index, new Set(["smart451/=c1", "smart451/=c2"]));
    const left = without.flatMap((r) => (r.kind === "signal" ? [r.info.id] : []));
    expect(left).toContain("smart451/MS_312h.DNMOT");
    expect(left.some((id) => id.includes("=c"))).toBe(false);
  });
});
