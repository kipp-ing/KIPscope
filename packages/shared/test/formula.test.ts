import { describe, expect, it } from "vitest";
import {
  bindFormula,
  evalFormula,
  type FormulaNode,
  formulaName,
  inferUnit,
  MAX_FORMULA_LENGTH,
  MAX_FORMULA_NODES,
  PRESETS,
  parseFormula,
  presetOf,
  shortSignalName,
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

const vars = (text: string) => {
  const parsed = parseFormula(text);
  if (!parsed.ok) throw new Error(parsed.message);
  return [...parsed.vars].sort();
};

describe("formula language", () => {
  // spec computed-signals "Accepted and refused formulas"
  it("parses the formula language", () => {
    expect(MAX_FORMULA_LENGTH).toBe(200);
    expect(MAX_FORMULA_NODES).toBe(64);
    expect(vars("a - b")).toEqual(["a", "b"]);
    expect(vars(" abs(a) ")).toEqual(["a"]);
    expect(vars("min(a, b) * 0.5")).toEqual(["a", "b"]);
    expect(vars("-a / (b + 1e3)")).toEqual(["a", "b"]);
    expect(vars("a − b")).toEqual(["a", "b"]); // U+2212
    expect(vars("max(a,2)")).toEqual(["a"]);
    // Structure: precedence and associativity by hand.
    expect(ast("a - b")).toEqual({
      op: "-",
      left: { op: "var", name: "a" },
      right: { op: "var", name: "b" },
    });
    expect(ast("a - b - 1")).toEqual({
      op: "-",
      left: { op: "-", left: { op: "var", name: "a" }, right: { op: "var", name: "b" } },
      right: { op: "num", value: 1 },
    });
    expect(ast("a + 2 * 3")).toEqual({
      op: "+",
      left: { op: "var", name: "a" },
      right: { op: "*", left: { op: "num", value: 2 }, right: { op: "num", value: 3 } },
    });
    expect(ast("-a")).toEqual({ op: "neg", arg: { op: "var", name: "a" } });
    expect(ast("abs(a)")).toEqual({ op: "abs", arg: { op: "var", name: "a" } });
    expect(ast("min(a, 2)")).toEqual({
      op: "min",
      left: { op: "var", name: "a" },
      right: { op: "num", value: 2 },
    });
    // The pasted auto-name operator reads like a minus.
    expect(ast("a − b")).toEqual(ast("a - b"));
    // Numbers: decimal, leading dot, exponent.
    expect(ast("a * .5")).toMatchObject({ right: { op: "num", value: 0.5 } });
    expect(ast("a * 1e3")).toMatchObject({ right: { op: "num", value: 1000 } });
    expect(ast("a * 2.5E-1")).toMatchObject({ right: { op: "num", value: 0.25 } });
  });

  it("reports errors with positions", () => {
    const cases: [string, string, number | undefined][] = [
      ["a - ", "Unexpected end at 5", 5],
      ["a - c", 'Unknown name "c": use a, b, numbers, + - * / ( ), abs, min, max', undefined],
      ["abs(a, b)", "abs takes one value: abs(x)", undefined],
      ["min(a)", "min takes two values: min(x, y)", undefined],
      ["max(a)", "max takes two values: max(x, y)", undefined],
      ["(a + b", 'Missing ")" at 7', 7],
      ["b * 2", "The formula must use a", undefined],
      ["a % b", 'Unexpected "%" at 3', 3],
      ["1e999 + a", "Number too large at 1", 1],
      ["", "Enter a formula", undefined],
      ["   ", "Enter a formula", undefined],
    ];
    for (const [text, message, at] of cases) {
      const r = refusal(text);
      expect(r.message, JSON.stringify(text)).toBe(message);
      if (at !== undefined) expect(r.at, JSON.stringify(text)).toBe(at);
    }
    // Limits: 200 characters, 64 parts.
    const long = `a${" ".repeat(MAX_FORMULA_LENGTH)}`;
    expect(long).toHaveLength(MAX_FORMULA_LENGTH + 1);
    expect(refusal(long).message).toBe("At most 200 characters");
    expect(parseFormula(`a${" ".repeat(MAX_FORMULA_LENGTH - 1)}`).ok).toBe(true);
    const many = Array.from({ length: 40 }, () => "a").join(" + "); // 40 vars + 39 sums = 79 nodes
    expect(refusal(many).message).toBe("Too complex: at most 64 parts");
    const fine = Array.from({ length: 10 }, () => "a").join(" + "); // 19 nodes
    expect(parseFormula(fine).ok).toBe(true);
  });

  it("binds inputs to the formula", () => {
    const sum = parseFormula("a + b");
    expect(bindFormula(sum, { a: "X.A", b: "Y.B" })).toMatchObject({
      ok: true,
      a: "X.A",
      b: "Y.B",
    });
    expect(bindFormula(sum, { a: "X.A" })).toEqual({ ok: false, message: "Pick a signal for b" });
    expect(bindFormula(sum, { b: "Y.B" })).toEqual({ ok: false, message: "Pick a signal for a" });
    // An input for b the formula does not use is dropped.
    const one = bindFormula(parseFormula("abs(a)"), { a: "X.A", b: "Y.B" });
    expect(one).toMatchObject({ ok: true, a: "X.A" });
    if (one.ok) expect(one.b).toBeUndefined();
    // A formula that did not parse stays a refusal.
    expect(bindFormula(parseFormula("a -"), { a: "X.A" }).ok).toBe(false);
  });
});

describe("formula evaluation", () => {
  // spec computed-signals "Evaluation"
  it("evaluates formulas in double precision", () => {
    expect(evalFormula(ast("abs(a - b)"), 3, 5)).toBe(2);
    expect(evalFormula(ast("min(a, b) * 2"), 3, 5)).toBe(6);
    expect(evalFormula(ast("max(a, -b)"), 3, 5)).toBe(3);
    expect(evalFormula(ast("-a * 2 - 1"), 3)).toBe(-7);
    expect(Number.isFinite(evalFormula(ast("a / b"), 1, 0))).toBe(false);
    expect(Number.isFinite(evalFormula(ast("a / b"), 0, 0))).toBe(false);
    // Precedence and associativity: 1 + 2 * 3 = 7; (10 - 3) - 1 = 6; (12 / 3) / 2 = 2.
    expect(evalFormula(ast("a + 2 * 3"), 1)).toBe(7);
    expect(evalFormula(ast("a - b - 1"), 10, 3)).toBe(6);
    expect(evalFormula(ast("a / b / 2"), 12, 3)).toBe(2);
    expect(evalFormula(ast("(a + b) * 2"), 1, 2)).toBe(6);
    expect(evalFormula(ast("a * -b"), 3, 2)).toBe(-6);
    expect(evalFormula(ast("--a"), 3)).toBe(3);
    // IEEE double, not decimal: 0.1 + 0.2.
    expect(evalFormula(ast("a + b"), 0.1, 0.2)).toBe(0.1 + 0.2);
    expect(evalFormula(ast("a + b"), 0.1, 0.2)).not.toBe(0.3);
    // b is ignored when the formula does not use it.
    expect(evalFormula(ast("abs(a)"), -4)).toBe(4);
    expect(evalFormula(ast("a * 1e3"), 2)).toBe(2000);
  });
});

describe("formula names", () => {
  // spec computed-signals "Auto name and unit"
  it("names formulas with short signal names", () => {
    const D = "DNMOT";
    const P = "PNHV_SupBat_Curr";
    expect(formulaName(ast("a - b"), D, P)).toBe("DNMOT − PNHV_SupBat_Curr"); // U+2212
    expect(formulaName(ast("a + b"), D, P)).toBe("DNMOT + PNHV_SupBat_Curr");
    expect(formulaName(ast("abs(a)"), D)).toBe("abs(DNMOT)");
    expect(formulaName(ast("min(a, b)"), D, P)).toBe("min(DNMOT, PNHV_SupBat_Curr)");
    expect(formulaName(ast("max(a, b)"), D, P)).toBe("max(DNMOT, PNHV_SupBat_Curr)");
    expect(formulaName(ast("a * 1"), D)).toBe("DNMOT × 1");
    expect(formulaName(ast("a * 2.5"), D)).toBe("DNMOT × 2.5");
    expect(formulaName(ast("a / b"), D, P)).toBe("DNMOT / PNHV_SupBat_Curr");
    // Parentheses only where needed.
    expect(formulaName(ast("(a + b) / 2"), D, P)).toBe("(DNMOT + PNHV_SupBat_Curr) / 2");
    expect(formulaName(ast("a - b - 1"), "A", "B")).toBe("A − B − 1");
    expect(formulaName(ast("a - (b - 1)"), "A", "B")).toBe("A − (B − 1)");
    expect(formulaName(ast("a / (b * 2)"), "A", "B")).toBe("A / (B × 2)");
    expect(formulaName(ast("(a * b) + 1"), "A", "B")).toBe("A × B + 1");
    expect(formulaName(ast("a * (b + 1)"), "A", "B")).toBe("A × (B + 1)");
    // Cut to 60 characters with an ellipsis.
    const long = formulaName(ast("a - b"), "x".repeat(40), "y".repeat(40));
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("…")).toBe(true);
    expect(long.startsWith("x".repeat(40))).toBe(true);
    // Not cut at exactly 60.
    const exact = formulaName(ast("a - b"), "x".repeat(28), "y".repeat(29)); // 28 + 3 + 29
    expect(exact).toBe(`${"x".repeat(28)} − ${"y".repeat(29)}`);
  });

  it("infers units only when unambiguous", () => {
    // a rpm, b A
    expect(inferUnit(ast("a - b"), "rpm", "A")).toBeUndefined();
    expect(inferUnit(ast("abs(a)"), "rpm")).toBe("rpm");
    expect(inferUnit(ast("min(a, b)"), "A", "A")).toBe("A");
    expect(inferUnit(ast("max(a, b)"), "A", "A")).toBe("A");
    expect(inferUnit(ast("a - b"), "A", "A")).toBe("A");
    expect(inferUnit(ast("a + b"), "A", "A")).toBe("A");
    expect(inferUnit(ast("a * 1"), "A")).toBeUndefined();
    expect(inferUnit(ast("(a + b) / 2"), "A", "A")).toBeUndefined();
    expect(inferUnit(ast("a / b"), "A", "A")).toBeUndefined();
    // Unary minus and abs keep the unit; a constant adopts the other side.
    expect(inferUnit(ast("-a"), "A")).toBe("A");
    expect(inferUnit(ast("a + 1"), "A")).toBe("A");
    expect(inferUnit(ast("max(a, 5)"), "A")).toBe("A");
    // No unit on a: none.
    expect(inferUnit(ast("abs(a)"), undefined)).toBeUndefined();
  });

  it("shortens signal names after the first dot", () => {
    expect(shortSignalName("MS_312h.DNMOT")).toBe("DNMOT");
    expect(shortSignalName("DNMOT")).toBe("DNMOT");
    expect(shortSignalName("A.B.C")).toBe("B.C");
    expect(shortSignalName("X.")).toBe("X.");
  });
});

describe("formula presets", () => {
  it("lists the presets of the editor", () => {
    expect(PRESETS.map((p) => p.id)).toEqual([
      "difference",
      "sum",
      "absolute",
      "minimum",
      "maximum",
      "scale",
      "custom",
    ]);
    const byId = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
    expect(byId.difference).toMatchObject({ label: "Difference", formula: "a - b", inputs: 2 });
    expect(byId.sum).toMatchObject({ label: "Sum", formula: "a + b", inputs: 2 });
    expect(byId.absolute).toMatchObject({ label: "Absolute", formula: "abs(a)", inputs: 1 });
    expect(byId.minimum).toMatchObject({ label: "Minimum", formula: "min(a, b)", inputs: 2 });
    expect(byId.maximum).toMatchObject({ label: "Maximum", formula: "max(a, b)", inputs: 2 });
    expect(byId.scale).toMatchObject({ label: "Scale", formula: "a * 1", inputs: 1 });
    expect(byId.custom?.label).toBe("Custom");
    expect(byId.custom?.formula).toBeUndefined();
    // Every preset formula parses.
    for (const p of PRESETS) if (p.formula) expect(parseFormula(p.formula).ok, p.id).toBe(true);
  });

  it("finds the preset of a formula ignoring spaces", () => {
    expect(presetOf("a - b")).toBe("difference");
    expect(presetOf("a-b")).toBe("difference");
    expect(presetOf("  a   +   b ")).toBe("sum");
    expect(presetOf("abs( a )")).toBe("absolute");
    expect(presetOf("min( a,b )")).toBe("minimum");
    expect(presetOf("max(a,b)")).toBe("maximum");
    expect(presetOf("a*1")).toBe("scale");
    expect(presetOf("min(a, b) + 1")).toBe("custom");
    expect(presetOf("b - a")).toBe("custom");
    expect(presetOf("")).toBe("custom");
  });
});
