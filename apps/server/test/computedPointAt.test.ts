import { computedRowValue, parseFormula } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { computedPointAt } from "../src/computed.ts";
import type { RawPoint } from "../src/datasource.ts";

const ast = (text: string) => {
  const parsed = parseFormula(text);
  if (!parsed.ok) throw new Error(`${text}: ${parsed.message}`);
  return parsed.ast;
};
const pt = (t: number, v: number | null): RawPoint => ({ t: BigInt(t), v });
const T = 1_000n;

describe("computedPointAt", () => {
  // spec computed-signals "Value and extent": one per-row rule for the series and the value.
  it("agrees with the shared per-row rule for SNA, non-finite and normal inputs", () => {
    const cases: { formula: string; a: number | null; b?: number | null }[] = [
      { formula: "a - b", a: 10, b: 4 },
      { formula: "a - b", a: 10, b: -4.5 },
      { formula: "a - b", a: null, b: 4 },
      { formula: "a - b", a: 10, b: null },
      { formula: "a - b", a: null, b: null },
      { formula: "a / b", a: 1, b: 0 },
      { formula: "a / b", a: 0, b: 0 },
      { formula: "a / b", a: -1, b: 0 },
      { formula: "a / b", a: 9, b: 3 },
      { formula: "a * b", a: 1e200, b: 1e200 },
      { formula: "abs(a)", a: -2.5 },
      { formula: "abs(a)", a: null },
      { formula: "a - a", a: 7 },
      { formula: "min(a, b)", a: 0, b: 0 },
    ];
    for (const c of cases) {
      const tree = ast(c.formula);
      const hasB = c.b !== undefined;
      const inputs = hasB
        ? [{ point: pt(900, c.a) }, { point: pt(950, c.b ?? null) }]
        : [{ point: pt(900, c.a) }];
      const got = computedPointAt(tree, T, inputs);
      const want = computedRowValue(
        tree,
        { t: 900n, v: c.a },
        hasB ? { t: 950n, v: c.b ?? null } : undefined,
      );
      const label = `${c.formula} with ${c.a}, ${c.b}`;
      expect(got, label).toEqual({ t: T, v: want });
    }
    // Hand-computed anchors, so the helper cannot make both sides wrong together.
    expect(computedPointAt(ast("a - b"), T, [{ point: pt(1, 10) }, { point: pt(1, 4) }])?.v).toBe(
      6,
    );
    expect(
      computedPointAt(ast("a / b"), T, [{ point: pt(1, 1) }, { point: pt(1, 0) }])?.v,
    ).toBeNull();
    expect(
      computedPointAt(ast("a - b"), T, [{ point: pt(1, null) }, { point: pt(1, 4) }])?.v,
    ).toBeNull();
  });

  it("answers at the asked time, not at the input's", () => {
    expect(computedPointAt(ast("abs(a)"), 5_000n, [{ point: pt(100, -3) }])).toEqual({
      t: 5_000n,
      v: 3,
    });
  });

  it("returns undefined when an input has no point", () => {
    expect(
      computedPointAt(ast("a - b"), T, [{ point: pt(1, 1) }, { point: undefined }]),
    ).toBeUndefined();
    expect(
      computedPointAt(ast("a - b"), T, [{ point: undefined }, { point: pt(1, 1) }]),
    ).toBeUndefined();
    expect(computedPointAt(ast("abs(a)"), T, [{ point: undefined }])).toBeUndefined();
    // No point wins over SNA of the other input.
    expect(
      computedPointAt(ast("a - b"), T, [{ point: pt(1, null) }, { point: undefined }]),
    ).toBeUndefined();
  });

  it("returns undefined when an input is held beyond its hold limit", () => {
    const tree = ast("a - b");
    // Exactly at the limit still holds; one nanosecond more does not.
    const at = [{ point: pt(900, 1), holdNs: 100n }, { point: pt(1_000, 1) }];
    expect(computedPointAt(tree, T, at)?.v).toBe(0);
    const beyond = [{ point: pt(899, 1), holdNs: 100n }, { point: pt(1_000, 1) }];
    expect(computedPointAt(tree, T, beyond)).toBeUndefined();
    const beyondB = [{ point: pt(1_000, 1) }, { point: pt(0, 1), holdNs: 999n }];
    expect(computedPointAt(tree, T, beyondB)).toBeUndefined();
    // No limit (no known period): held for any time.
    expect(computedPointAt(tree, T, [{ point: pt(1, 5) }, { point: pt(1, 2) }])?.v).toBe(3);
    // A stale SNA input is still no point at all, not SNA.
    const stale = [{ point: pt(0, null), holdNs: 10n }, { point: pt(1_000, 1) }];
    expect(computedPointAt(tree, T, stale)).toBeUndefined();
  });
});
