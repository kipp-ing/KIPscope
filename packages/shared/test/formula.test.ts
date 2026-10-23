import { describe, expect, it } from "vitest";
import {
  compileFormula,
  evalFormula,
  type FormulaNames,
  type FormulaNode,
  formulaInputs,
  formulaName,
  formulaText,
  inferUnit,
  MAX_FLAT_LENGTH,
  MAX_FLAT_NODES,
  MAX_FORMULA_LENGTH,
  MAX_FORMULA_NODES,
  MAX_FORMULA_SIGNALS,
  parseFormula,
  quoteName,
  resolveFormula,
  resolveName,
  shortSignalName,
  tokenizeFormula,
} from "../src/formula.ts";

/** The AST of a formula that must parse. */
function ast(text: string): FormulaNode {
  const parsed = parseFormula(text);
  if (!parsed.ok) throw new Error(`${text}: ${parsed.message}`);
  return parsed.ast;
}

/** The refusal of a formula that must not parse. */
function refusal(text: string) {
  const parsed = parseFormula(text);
  if (parsed.ok) throw new Error(`${text}: expected a refusal`);
  return parsed;
}

/** The names of a formula that must parse, in first appearance. */
const names = (text: string) => {
  const parsed = parseFormula(text);
  if (!parsed.ok) throw new Error(`${text}: ${parsed.message}`);
  return [...parsed.names];
};

const sig = (name: string, at: number): FormulaNode => ({ op: "sig", name, at });

describe("formula language", () => {
  // spec computed-signals "Accepted and refused formulas"
  it("parses the formula language", () => {
    expect(MAX_FORMULA_LENGTH).toBe(500);
    expect(MAX_FORMULA_NODES).toBe(64);
    expect(MAX_FORMULA_SIGNALS).toBe(8);
    expect(MAX_FLAT_LENGTH).toBe(2000);
    expect(MAX_FLAT_NODES).toBe(256);
    expect(names("MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr")).toEqual([
      "MS_312h.DNMOT",
      "CPC_508h.PNHV_SupBat_Curr",
    ]);
    expect(names(" abs(X.A) ")).toEqual(["X.A"]);
    expect(names('min(X.A, "DNMOT − PNHV") * 0.5')).toEqual(["X.A", "DNMOT − PNHV"]);
    expect(names("-X.A / (Y.B + 1e3)")).toEqual(["X.A", "Y.B"]);
    expect(names("X.A − Y.B")).toEqual(["X.A", "Y.B"]); // U+2212 outside quotes
    expect(names("max(X.A,2) + X.A")).toEqual(["X.A"]);
    expect(names('"say \\"hi\\"" + "abs"')).toEqual(['say "hi"', "abs"]);
    expect(names("max(X.A, Y.B, 3, Z.C)")).toEqual(["X.A", "Y.B", "Z.C"]);
    // Structure: precedence, associativity, the 1-based position of each name token.
    expect(ast("X.A - Y.B")).toEqual({ op: "-", left: sig("X.A", 1), right: sig("Y.B", 7) });
    expect(ast("X.A - Y.B - 1")).toEqual({
      op: "-",
      left: { op: "-", left: sig("X.A", 1), right: sig("Y.B", 7) },
      right: { op: "num", value: 1 },
    });
    expect(ast("X.A + 2 * 3")).toEqual({
      op: "+",
      left: sig("X.A", 1),
      right: { op: "*", left: { op: "num", value: 2 }, right: { op: "num", value: 3 } },
    });
    expect(ast("-X.A")).toEqual({ op: "neg", arg: sig("X.A", 2) });
    expect(ast("abs(X.A)")).toEqual({ op: "abs", arg: sig("X.A", 5) });
    expect(ast("min(X.A, 2)")).toEqual({
      op: "min",
      args: [sig("X.A", 5), { op: "num", value: 2 }],
    });
    expect(ast("max(X.A, Y.B, 3)")).toEqual({
      op: "max",
      args: [sig("X.A", 5), sig("Y.B", 10), { op: "num", value: 3 }],
    });
    // A quoted name sits at its opening quote.
    expect(ast('1 + "Bat Curr"')).toEqual({
      op: "+",
      left: { op: "num", value: 1 },
      right: sig("Bat Curr", 5),
    });
    // The pasted auto-name operator reads like a minus.
    expect(ast("X.A − Y.B")).toEqual({ op: "-", left: sig("X.A", 1), right: sig("Y.B", 7) });
    // Inside quotes every character is part of the name, U+2212 included.
    expect(names('"A − B"')).toEqual(["A − B"]);
    // Numbers: decimal, leading dot, exponent.
    expect(ast("X.A * .5")).toMatchObject({ right: { op: "num", value: 0.5 } });
    expect(ast("X.A * 1e3")).toMatchObject({ right: { op: "num", value: 1000 } });
    expect(ast("X.A * 2.5E-1")).toMatchObject({ right: { op: "num", value: 0.25 } });
    // `ABS` is a bare name, `abs` is not.
    expect(names("ABS + 1")).toEqual(["ABS"]);
  });

  it("reports errors with positions", () => {
    const cases: [string, string, number | undefined][] = [
      ["X.A - ", "Unexpected end at 7", 7],
      ["abs(X.A, Y.B)", "abs takes one value: abs(x)", undefined],
      ["min(X.A)", "min takes two or more values: min(x, y, …)", undefined],
      ["max(X.A)", "max takes two or more values: max(x, y, …)", undefined],
      ["(X.A + Y.B", 'Missing ")" at 11', 11],
      ["X.A % 2", 'Unexpected "%" at 5', 5],
      ["2X.A", 'Unexpected "X.A" at 2', 2],
      ["1e999 + X.A", "Number too large at 1", 1],
      ["2 * 3", "Use at least one signal", undefined],
      ['"DNMOT − P', 'Missing closing " at 1', 1],
      ['"" + X.A', "Empty name at 1", 1],
      ["abs + 1", 'Unexpected "+" at 5', 5],
      ["", "Enter a formula", undefined],
      ["   ", "Enter a formula", undefined],
    ];
    for (const [text, message, at] of cases) {
      const r = refusal(text);
      expect(r.message, JSON.stringify(text)).toBe(message);
      if (at !== undefined) expect(r.at, JSON.stringify(text)).toBe(at);
    }
    // Limits: 500 characters, 64 parts; the flat limits of the server are a parameter.
    const long = `X.A${" ".repeat(MAX_FORMULA_LENGTH - 2)}`;
    expect(long).toHaveLength(MAX_FORMULA_LENGTH + 1);
    expect(refusal(long).message).toBe("At most 500 characters");
    expect(parseFormula(long.slice(0, MAX_FORMULA_LENGTH)).ok).toBe(true);
    const many = Array.from({ length: 40 }, () => "X.A").join(" + "); // 40 names + 39 sums = 79 nodes
    expect(refusal(many).message).toBe("Too complex: at most 64 parts");
    const fine = Array.from({ length: 10 }, () => "X.A").join(" + "); // 19 nodes
    expect(parseFormula(fine).ok).toBe(true);
    // With the server's limits (2,000 characters, 256 nodes) the same text is fine.
    expect(parseFormula(many, { length: MAX_FLAT_LENGTH, nodes: MAX_FLAT_NODES }).ok).toBe(true);
    const wide = `X.A${" ".repeat(MAX_FLAT_LENGTH - 2)}`;
    expect(parseFormula(wide, { length: MAX_FLAT_LENGTH, nodes: MAX_FLAT_NODES }).ok).toBe(false);
    expect(
      parseFormula(wide.slice(0, MAX_FLAT_LENGTH), {
        length: MAX_FLAT_LENGTH,
        nodes: MAX_FLAT_NODES,
      }).ok,
    ).toBe(true);
  });

  it("tokenizes the text without gaps and never throws", () => {
    const texts = ['abs( X.A-  "Bat Curr" )*2 ', '"unclosed', "X.A % 2", "min(1, 2e)", "", "   "];
    for (const text of texts) {
      const tokens = tokenizeFormula(text);
      let at = 0;
      for (const t of tokens) {
        expect(t.start, JSON.stringify(text)).toBe(at);
        expect(t.end).toBeGreaterThan(t.start);
        at = t.end;
      }
      expect(at, JSON.stringify(text)).toBe(text.length);
    }
    const kinds = tokenizeFormula('abs(X.A, "B C")').map((t) => t.kind);
    expect(kinds).toEqual(["func", "open", "name", "comma", "space", "name", "close"]);
    expect(tokenizeFormula('"abc')[0]).toMatchObject({
      kind: "name",
      name: "abc",
      quoted: true,
      closed: false,
      start: 0,
      end: 4,
    });
    expect(tokenizeFormula('"a b"')[0]).toMatchObject({
      kind: "name",
      name: "a b",
      quoted: true,
      closed: true,
    });
  });
});

describe("formula evaluation", () => {
  // spec computed-signals "Evaluation"
  it("evaluates formulas in double precision", () => {
    const run = (text: string, values: Record<string, number>) => {
      const a = ast(text);
      const byName = evalFormula(a, (n) => values[n] as number);
      const byOrder = compileFormula(a)(formulaInputs(a).map((n) => values[n] as number));
      expect(byOrder, text).toBe(byName);
      return byName;
    };
    expect(run("abs(X.A - Y.B)", { "X.A": 3, "Y.B": 5 })).toBe(2);
    expect(run("min(X.A, Y.B) * 2", { "X.A": 3, "Y.B": 5 })).toBe(6);
    expect(run("max(X.A, -Y.B)", { "X.A": 3, "Y.B": 5 })).toBe(3);
    expect(run("min(X.A, Y.B, Z.C)", { "X.A": 3, "Y.B": 5, "Z.C": -1 })).toBe(-1);
    expect(run("-X.A * 2 - 1", { "X.A": 3 })).toBe(-7);
    expect(Number.isFinite(run("X.A / Y.B", { "X.A": 1, "Y.B": 0 }))).toBe(false);
    expect(Number.isFinite(run("X.A / Y.B", { "X.A": 0, "Y.B": 0 }))).toBe(false);
    // Precedence and associativity: 1 + 2 * 3 = 7; (10 - 3) - 1 = 6; (12 / 3) / 2 = 2.
    expect(run("X.A + 2 * 3", { "X.A": 1 })).toBe(7);
    expect(run("X.A - Y.B - 1", { "X.A": 10, "Y.B": 3 })).toBe(6);
    expect(run("X.A / Y.B / 2", { "X.A": 12, "Y.B": 3 })).toBe(2);
    expect(run("(X.A + Y.B) * 2", { "X.A": 1, "Y.B": 2 })).toBe(6);
    expect(run("X.A * -Y.B", { "X.A": 3, "Y.B": 2 })).toBe(-6);
    expect(run("--X.A", { "X.A": 3 })).toBe(3);
    expect(run("max(X.A, Y.B, 3, Z.C)", { "X.A": 1, "Y.B": 7, "Z.C": 2 })).toBe(7);
    // IEEE double, not decimal: 0.1 + 0.2.
    expect(run("X.A + Y.B", { "X.A": 0.1, "Y.B": 0.2 })).toBe(0.1 + 0.2);
    expect(run("X.A + Y.B", { "X.A": 0.1, "Y.B": 0.2 })).not.toBe(0.3);
    // A repeated name is one input: values come in formulaInputs order.
    expect(formulaInputs(ast("Y.B + X.A * Y.B"))).toEqual(["Y.B", "X.A"]);
    expect(compileFormula(ast("Y.B + X.A * Y.B"))([2, 5])).toBe(12);
  });
});

describe("formula names", () => {
  // spec computed-signals "Canonical text and quoting"
  it("prints canonical text and quotes names", () => {
    const text = (t: string) => formulaText(ast(t));
    expect(text(' abs( X.A-  "Bat Curr" )*2 ')).toBe('abs(X.A - "Bat Curr") * 2');
    expect(text("(X.A - Y.B) - Z.C")).toBe("X.A - Y.B - Z.C");
    expect(text("X.A - (Y.B - Z.C)")).toBe("X.A - (Y.B - Z.C)");
    expect(text("-(X.A + Y.B)")).toBe("-(X.A + Y.B)");
    expect(text("X.A * (Y.B + Z.C)")).toBe("X.A * (Y.B + Z.C)");
    expect(text("(X.A * Y.B) + 1")).toBe("X.A * Y.B + 1");
    expect(text("X.A / (Y.B * 2)")).toBe("X.A / (Y.B * 2)");
    expect(text("X.A / (Y.B / 2)")).toBe("X.A / (Y.B / 2)");
    expect(text("min(X.A,Y.B,3)")).toBe("min(X.A, Y.B, 3)");
    expect(text('"say \\"hi\\"" + 1')).toBe('"say \\"hi\\"" + 1');
    expect(text("X.A − Y.B")).toBe("X.A - Y.B");
    // Canonical text is a fixed point.
    for (const t of ['abs(X.A - "Bat Curr") * 2', "X.A - (Y.B - Z.C)", "-(X.A + Y.B)"]) {
      expect(text(t)).toBe(t);
    }
    expect(quoteName("MS_312h.DNMOT")).toBe("MS_312h.DNMOT");
    expect(quoteName("DNMOT − PNHV_SupBat_Curr")).toBe('"DNMOT − PNHV_SupBat_Curr"');
    expect(quoteName("1st.X")).toBe('"1st.X"');
    expect(quoteName("abs")).toBe('"abs"');
    expect(quoteName("min")).toBe('"min"');
    expect(quoteName("ABS")).toBe("ABS");
    expect(quoteName('say "hi"')).toBe('"say \\"hi\\""');
    expect(quoteName("back\\slash")).toBe('"back\\\\slash"');
  });
});

describe("formula names resolve", () => {
  const list: FormulaNames = {
    signals: [
      { name: "MS_312h.DNMOT", unit: "rpm", states: false },
      { name: "CPC_508h.PNHV_SupBat_Curr", unit: "A", states: false },
      { name: "Eng_1h.TEMP", states: false },
      { name: "Bat_2h.TEMP", states: false },
      { name: "MS_1h.MODE", states: true },
    ],
    computed: [{ name: "DNMOT − PNHV_SupBat_Curr", unit: "A" }],
  };

  // spec computed-signals "Typed names resolve"
  it("resolves typed names", () => {
    expect(resolveFormula("DNMOT - pnhv_supbat_curr", list)).toMatchObject({
      ok: true,
      formula: "MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr",
    });
    expect(resolveFormula('abs("dnmot − pnhv_supbat_curr")', list)).toMatchObject({
      ok: true,
      formula: 'abs("DNMOT − PNHV_SupBat_Curr")',
    });
    expect(resolveFormula("TEMP + 1", list)).toMatchObject({
      ok: false,
      code: "ambiguous_signal",
      message: 'Ambiguous "TEMP" at 1: Bat_2h.TEMP, Eng_1h.TEMP',
      at: 1,
      candidates: ["Bat_2h.TEMP", "Eng_1h.TEMP"],
    });
    expect(resolveFormula("MS_312h.DNMOT - DNMOX", list)).toMatchObject({
      ok: false,
      code: "unknown_signal",
      message: 'Unknown signal "DNMOX" at 17',
    });
    expect(resolveFormula("MODE + 1", list)).toMatchObject({
      ok: false,
      code: "not_numeric_signal",
      message: "MS_1h.MODE has states at 1: use a numeric signal",
    });
    // Parse errors come through as invalid_formula.
    expect(resolveFormula("MS_312h.DNMOT %", list)).toMatchObject({
      ok: false,
      code: "invalid_formula",
    });
    // The exact full name wins; the canonical text is normalized.
    expect(resolveFormula("ms_312h.dnmot*2", list)).toMatchObject({
      ok: true,
      formula: "MS_312h.DNMOT * 2",
    });
    expect(resolveFormula("Eng_1h.TEMP+1", list)).toMatchObject({
      ok: true,
      formula: "Eng_1h.TEMP + 1",
    });
  });

  it("resolves single names in the order of the design", () => {
    expect(resolveName("dnmot − pnhv_supbat_curr", list)).toEqual({
      ok: true,
      kind: "computed",
      name: "DNMOT − PNHV_SupBat_Curr",
    });
    expect(resolveName("MS_312h.DNMOT", list)).toEqual({
      ok: true,
      kind: "signal",
      name: "MS_312h.DNMOT",
    });
    expect(resolveName("Eng_1h.TEMP", list)).toEqual({
      ok: true,
      kind: "signal",
      name: "Eng_1h.TEMP",
    });
    expect(resolveName("dnmot", list)).toEqual({ ok: true, kind: "signal", name: "MS_312h.DNMOT" });
    expect(resolveName("TEMP", list)).toEqual({
      ok: false,
      reason: "ambiguous",
      candidates: ["Bat_2h.TEMP", "Eng_1h.TEMP"],
    });
    expect(resolveName("nope", list)).toMatchObject({ ok: false, reason: "unknown" });
    expect(resolveName("MODE", list)).toMatchObject({ ok: false, reason: "states" });
  });

  it("lists at most five ambiguous candidates", () => {
    const many: FormulaNames = {
      signals: ["G", "F", "E", "D", "C", "B", "A"].map((p) => ({
        name: `${p}_1h.TEMP`,
        states: false,
      })),
      computed: [],
    };
    const r = resolveFormula("TEMP", many);
    expect(r).toMatchObject({
      ok: false,
      code: "ambiguous_signal",
      message: 'Ambiguous "TEMP" at 1: A_1h.TEMP, B_1h.TEMP, C_1h.TEMP, D_1h.TEMP, E_1h.TEMP, …',
    });
  });

  // spec computed-signals "Auto name and unit"
  it("names formulas with short signal names", () => {
    const name = (text: string) => formulaName(ast(text), shortSignalName);
    expect(name("MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr")).toBe("DNMOT − PNHV_SupBat_Curr"); // U+2212
    expect(name("abs(MS_312h.DNMOT)")).toBe("abs(DNMOT)");
    expect(name("min(X.A, Y.B)")).toBe("min(A, B)");
    expect(name("X.A * 1")).toBe("A × 1");
    expect(name("(X.A + Y.B) / 2")).toBe("(A + B) / 2");
    expect(name('abs("DNMOT − PNHV_SupBat_Curr")')).toBe("abs(DNMOT − PNHV_SupBat_Curr)");
    expect(name('"DNMOT − PNHV_SupBat_Curr" * 2')).toBe("(DNMOT − PNHV_SupBat_Curr) × 2");
    expect(name("X.A + Y.B + Z.C")).toBe("A + B + C");
    expect(name("max(X.A, Y.B, 0)")).toBe("max(A, B, 0)");
    expect(name("X.A * 2.5")).toBe("A × 2.5");
    expect(name("X.A / Y.B")).toBe("A / B");
    // Parentheses only where needed.
    expect(name("X.A - Y.B - 1")).toBe("A − B − 1");
    expect(name("X.A - (Y.B - 1)")).toBe("A − (B − 1)");
    expect(name("X.A / (Y.B * 2)")).toBe("A / (B × 2)");
    expect(name("(X.A * Y.B) + 1")).toBe("A × B + 1");
    expect(name("X.A * (Y.B + 1)")).toBe("A × (B + 1)");
    // A label with a space is wrapped as an operand of unary minus, not as a function argument.
    expect(name('-"DNMOT − PNHV_SupBat_Curr"')).toBe("-(DNMOT − PNHV_SupBat_Curr)");
    // Cut to 60 characters with an ellipsis.
    const long = name(`${"x".repeat(40)}.${"x".repeat(40)} - ${"y".repeat(40)}.${"y".repeat(40)}`);
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("…")).toBe(true);
    expect(long.startsWith("x".repeat(40))).toBe(true);
    // Not cut at exactly 60: 28 + 3 + 29.
    const exact = name(`Q.${"x".repeat(28)} - Q.${"y".repeat(29)}`);
    expect(exact).toBe(`${"x".repeat(28)} − ${"y".repeat(29)}`);
  });

  it("infers units only when unambiguous", () => {
    const units: Record<string, string> = {
      "MS_312h.DNMOT": "rpm",
      "CPC_508h.PNHV_SupBat_Curr": "A",
      "X.A": "A",
      "Y.B": "A",
      "Z.C": "A",
      "DNMOT − PNHV_SupBat_Curr": "A",
    };
    const unit = (text: string, of = (n: string) => units[n]) => inferUnit(ast(text), of);
    expect(unit("MS_312h.DNMOT - CPC_508h.PNHV_SupBat_Curr")).toBeUndefined();
    expect(unit("abs(MS_312h.DNMOT)")).toBe("rpm");
    expect(unit("min(X.A, Y.B)")).toBe("A");
    expect(unit("max(X.A, Y.B)")).toBe("A");
    expect(unit("X.A * 1")).toBeUndefined();
    expect(unit("(X.A + Y.B) / 2")).toBeUndefined();
    expect(unit("X.A / Y.B")).toBeUndefined();
    expect(unit('abs("DNMOT − PNHV_SupBat_Curr")')).toBe("A");
    expect(unit('"DNMOT − PNHV_SupBat_Curr" * 2')).toBeUndefined();
    const volts = () => "V";
    expect(unit("X.A + Y.B + Z.C", volts)).toBe("V");
    expect(unit("max(X.A, Y.B, 0)", volts)).toBe("V");
    // Unary minus and abs keep the unit; a constant adopts the other side.
    expect(unit("-X.A")).toBe("A");
    expect(unit("X.A + 1")).toBe("A");
    expect(unit("max(X.A, 5)")).toBe("A");
    // Mixed units among three operands: none.
    expect(unit("X.A + Y.B + MS_312h.DNMOT")).toBeUndefined();
    // No unit on the signal: none.
    expect(unit("abs(X.A)", () => undefined)).toBeUndefined();
  });

  it("shortens signal names after the first dot", () => {
    expect(shortSignalName("MS_312h.DNMOT")).toBe("DNMOT");
    expect(shortSignalName("DNMOT")).toBe("DNMOT");
    expect(shortSignalName("A.B.C")).toBe("B.C");
    expect(shortSignalName("X.")).toBe("X.");
  });
});
