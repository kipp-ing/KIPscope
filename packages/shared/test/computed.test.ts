import { describe, expect, it } from "vitest";
import {
  COMPUTED_MAX_ROWS,
  type ComputedDef,
  computedInfos,
  computedInputIds,
  computedParams,
  computedRef,
  computedRowValue,
  computedSignalGaps,
  computedSignalId,
  computedValueAt,
  computeRows,
  freeName,
  holdLimit,
  isComputedId,
  MAX_COMPUTED,
  MAX_COMPUTED_NAME,
  MAX_COMPUTED_UNIT,
} from "../src/computed.ts";
import type { Point } from "../src/cursor.ts";
import { type FormulaNode, parseFormula } from "../src/formula.ts";
import { GAP_PERIODS, type GapInfo, NO_GAPS } from "../src/gaps.ts";
import type { SignalInfo } from "../src/signals.ts";

function ast(text: string): FormulaNode {
  const parsed = parseFormula(text);
  if (!parsed.ok) throw new Error(`${text}: ${parsed.message}`);
  return parsed.ast;
}

const p = (t: number | bigint, v: number | null): Point => ({ t: BigInt(t), v });

describe("computed ids", () => {
  it("knows the pinned limits", () => {
    expect(MAX_COMPUTED).toBe(20);
    expect(MAX_COMPUTED_NAME).toBe(60);
    expect(MAX_COMPUTED_UNIT).toBe(20);
    expect(COMPUTED_MAX_ROWS).toBe(200_000);
  });

  it("builds and reads computed signal ids", () => {
    expect(computedSignalId("smart451", "c7")).toBe("smart451/=c7");
    expect(isComputedId("smart451/=c7")).toBe(true);
    expect(isComputedId("smart451/MS_312h.DNMOT")).toBe(false);
    expect(computedRef("smart451/=c7")).toEqual({ dataRef: "smart451", id: "c7" });
    expect(computedRef("smart451/MS_312h.DNMOT")).toBeUndefined();
    expect(computedRef("nonsense")).toBeUndefined();
    expect(computedInputIds({ a: "A.X", b: "B.Y" }, "car")).toEqual(["car/A.X", "car/B.Y"]);
    expect(computedInputIds({ a: "A.X" }, "car")).toEqual(["car/A.X"]);
    const def: ComputedDef = {
      id: "c7",
      name: "Diff",
      formula: "a - b",
      a: "A.X",
      b: "B.Y",
      unit: "A",
    };
    expect(computedParams(def)).toEqual({ formula: "a - b", a: "A.X", b: "B.Y" });
    expect(computedParams({ id: "c8", name: "Abs", formula: "abs(a)", a: "A.X" })).toEqual({
      formula: "abs(a)",
      a: "A.X",
    });
  });
});

describe("computed rows", () => {
  // Inputs by hand: a at 0, 10, 20 ns with values 0, 10, 20; b at 5, 25 with values 1, 2.
  const a = { points: [p(0, 0), p(10, 10), p(20, 20)] };
  const b = { points: [p(5, 1), p(25, 2)] };

  // spec computed-signals "Hold limit" (shared part), "Values per row"
  it("computes rows on the union of times", () => {
    // T = 0: b has no point yet, so no row. T = 5: 0 - 1; 10: 10 - 1; 20: 20 - 1; 25: 20 - 2.
    expect(computeRows(ast("a - b"), a, b)).toEqual([p(5, -1), p(10, 9), p(20, 19), p(25, 18)]);
    // A seed (last point before the range) counts as the current point: T = 0 gets b = 4.
    expect(computeRows(ast("a - b"), a, { ...b, seed: p(-3, 4) })).toEqual([
      p(0, -4),
      p(5, -1),
      p(10, 9),
      p(20, 19),
      p(25, 18),
    ]);
    // A hold limit of 5 ns on b: its point at 5 is too old at 20 (age 15), fresh at 10 (age 5);
    // the seed at -3 is fresh at 0 (age 3).
    expect(computeRows(ast("a - b"), a, { points: b.points, seed: p(-3, 4), holdNs: 5n })).toEqual([
      p(0, -4),
      p(5, -1),
      p(10, 9),
      p(25, 18),
    ]);
    // A seed older than the hold limit gives no row.
    expect(computeRows(ast("a - b"), a, { points: [], seed: p(-100, 4), holdNs: 5n })).toEqual([]);
    // No hold limit on either: the plain hold.
    expect(computeRows(ast("a - b"), { points: [p(0, 1)] }, { points: [p(1_000_000, 2)] })).toEqual(
      [p(1_000_000, -1)],
    );
  });

  it("computes one row per distinct time", () => {
    // Shared times: one row, not two.
    expect(
      computeRows(ast("a + b"), { points: [p(0, 1), p(10, 2)] }, { points: [p(10, 5), p(20, 7)] }),
    ).toEqual([p(10, 7), p(20, 9)]);
    // Several points of one input at one time: the last one is current.
    expect(
      computeRows(ast("a + b"), { points: [p(10, 1), p(10, 2)] }, { points: [p(0, 0)] }),
    ).toEqual([p(10, 2)]);
  });

  it("computes one input per point", () => {
    expect(computeRows(ast("abs(a)"), { points: [p(0, -3), p(5, 4), p(9, null)] })).toEqual([
      p(0, 3),
      p(5, 4),
      p(9, null),
    ]);
    // The seed adds no row of its own.
    expect(computeRows(ast("a * 2"), { points: [p(5, 4)], seed: p(1, 100) })).toEqual([p(5, 8)]);
    expect(computeRows(ast("a * 2"), { points: [] })).toEqual([]);
  });

  it("gives SNA when an input is SNA or the result is not finite", () => {
    // a is SNA at 10 and held as SNA at 20; b is SNA at 25 only.
    const rows = computeRows(
      ast("a - b"),
      { points: [p(0, 5), p(10, null), p(30, 8)] },
      { points: [p(5, 1), p(20, 2), p(25, null)] },
    );
    expect(rows).toEqual([
      p(5, 4), // 5 - 1
      p(10, null), // a SNA
      p(20, null), // a still SNA (held)
      p(25, null), // both SNA
      p(30, null), // b still SNA (held)
    ]);
    // Division by zero is SNA, not a number (design Q-4).
    expect(
      computeRows(ast("a / b"), { points: [p(0, 6)] }, { points: [p(0, 0), p(10, 3)] }),
    ).toEqual([p(0, null), p(10, 2)]);
    expect(computeRows(ast("a / 0"), { points: [p(0, 6)] })).toEqual([p(0, null)]);
  });

  it("derives the hold limit from the period", () => {
    expect(GAP_PERIODS).toBe(3);
    expect(holdLimit(10_000_000n)).toBe(30_000_000n);
    expect(holdLimit(1n)).toBe(3n);
    expect(holdLimit(undefined)).toBeUndefined();
  });
});

describe("computed gaps", () => {
  const info = (periods: Record<string, string>, logger = [{ from: "1000", to: "5000000000" }]) =>
    ({
      dataRef: "car",
      logger,
      periods: Object.fromEntries(
        Object.entries(periods).map(([id, ns]) => [id, { ns, source: "dbc" as const }]),
      ),
    }) satisfies GapInfo;

  // spec computed-signals "Gap rule of a computed signal"
  it("takes the logger gaps and the smallest period", () => {
    const g = info({ "car/A.X": "10000000", "car/B.Y": "1000000000" });
    const both = computedSignalGaps(g, "car", { a: "A.X", b: "B.Y" });
    expect(both.period).toBe(10_000_000n);
    expect(both.logger).toEqual([{ from: 1000n, to: 5_000_000_000n }]);
    // Argument order does not matter.
    expect(computedSignalGaps(g, "car", { a: "B.Y", b: "A.X" }).period).toBe(10_000_000n);
    // One input only, and the other input's period does not count.
    expect(computedSignalGaps(g, "car", { a: "B.Y" }).period).toBe(1_000_000_000n);
    // A signal without a period: the logger gaps, no period.
    const none = computedSignalGaps(g, "car", { a: "A.W" });
    expect(none.period).toBeUndefined();
    expect(none.logger).toEqual([{ from: 1000n, to: 5_000_000_000n }]);
    // One of two inputs with a period: that period.
    expect(computedSignalGaps(g, "car", { a: "A.X", b: "C.Z" }).period).toBe(10_000_000n);
  });

  it("gives no gaps without gap info", () => {
    const g = computedSignalGaps(undefined, "car", { a: "A.X" });
    expect(g.period).toBeUndefined();
    expect(g.logger).toEqual([]);
    expect(g.logger).toEqual(NO_GAPS.logger);
  });
});

describe("computed values", () => {
  const diff = ast("a - b");
  // a at 0, 10, 20 (values 0, 10, 20), b at 5, 25 (values 1, 2); t = 12 lies between.
  const aN = { at: p(10, 10), next: p(20, 20) };
  const bN = { at: p(5, 1), next: p(25, 2) };

  // spec computed-signals "Value and extent" (shared part)
  it("evaluates a computed value at a time", () => {
    // at: time max(10, 5) = 10, value 10 - 1 = 9. next: m = min(20, 25) = 20; a's next is at 20,
    // b contributes its at (5, 1): 20 - 1 = 19.
    const step = computedValueAt(12n, "step", diff, aN, bN, NO_GAPS);
    expect(step.value).toEqual({ kind: "held", value: 9 });
    expect(step.at).toEqual(p(10, 9));
    expect(step.next).toEqual(p(20, 19));
    // Line: 9 + (19 - 9) * 2 / 10 = 11.
    const line = computedValueAt(12n, "line", diff, aN, bN, NO_GAPS);
    expect(line.value).toEqual({ kind: "interpolated", value: 11 });
    // A time on a computed point is raw.
    expect(computedValueAt(10n, "line", diff, aN, bN, NO_GAPS).value).toEqual({
      kind: "raw",
      value: 9,
    });
    // b's hold limit of 5 ns: at t = 12 its point at 5 is 7 ns old.
    expect(computedValueAt(12n, "step", diff, aN, { ...bN, holdNs: 5n }, NO_GAPS).value).toEqual({
      kind: "none",
      reason: "period_gap",
    });
    // ...and fresh enough at t = 10 (age 5).
    expect(computedValueAt(10n, "step", diff, aN, { ...bN, holdNs: 5n }, NO_GAPS).value).toEqual({
      kind: "raw",
      value: 9,
    });
  });

  it("evaluates one input and the missing ends", () => {
    const abs = ast("abs(a)");
    const one = { at: p(0, -4), next: p(10, 6) };
    expect(computedValueAt(5n, "line", abs, one, undefined, NO_GAPS).value).toEqual({
      kind: "interpolated",
      value: 5,
    });
    expect(computedValueAt(5n, "step", abs, one, undefined, NO_GAPS).value).toEqual({
      kind: "held",
      value: 4,
    });
    // An input without a point at or before t: before_first when one lies ahead, else no_data.
    expect(computedValueAt(2n, "line", diff, { next: p(10, 1) }, bN, NO_GAPS).value).toEqual({
      kind: "none",
      reason: "before_first",
    });
    expect(computedValueAt(2n, "line", diff, aN, {}, NO_GAPS).value).toEqual({
      kind: "none",
      reason: "no_data",
    });
    // SNA in an input at t gives SNA.
    expect(
      computedValueAt(12n, "step", diff, { at: p(10, null), next: p(20, 20) }, bN, NO_GAPS).value,
    ).toEqual({ kind: "sna" });
    // Nothing after the last computed point.
    expect(
      computedValueAt(30n, "line", diff, { at: p(20, 20) }, { at: p(25, 2) }, NO_GAPS).value,
    ).toEqual({ kind: "none", reason: "after_last" });
  });

  it("splits a computed value at the gap rule", () => {
    const gaps = { period: 2n, logger: [] };
    // Computed points at 10 and 20, period 2: more than 3 periods apart, so the value holds
    // only up to 10 + 2.
    expect(computedValueAt(11n, "step", diff, aN, bN, gaps).value).toEqual({
      kind: "held",
      value: 9,
    });
    expect(computedValueAt(15n, "step", diff, aN, bN, gaps).value).toEqual({
      kind: "none",
      reason: "period_gap",
    });
  });
});

describe("computed infos", () => {
  const item = (dataRef: string, name: string, extra: Partial<SignalInfo> = {}): SignalInfo => ({
    id: `${dataRef}/${name}`,
    dataRef,
    name,
    ...extra,
  });
  const c1: ComputedDef = {
    id: "c1",
    name: "Difference",
    formula: "a - b",
    a: "A.X",
    b: "B.Y",
    unit: "A",
  };
  const c2: ComputedDef = { id: "c2", name: "Other", formula: "a + b", a: "A.X", b: "C.Z" };
  const items = [item("car1", "A.X"), item("car1", "B.Y"), item("car2", "A.X")];

  // spec computed-signals "Unavailable info"
  it("derives signal infos per data ref", () => {
    const infos = computedInfos([c1, c2], items);
    const byId = new Map(infos.map((i) => [i.id, i]));
    expect(infos).toHaveLength(2);
    const first = byId.get("car1/=c1");
    expect(first).toMatchObject({
      id: "car1/=c1",
      dataRef: "car1",
      name: "=c1",
      displayName: "Difference",
      unit: "A",
      description: "A.X − B.Y", // full input names, U+2212
      computed: { formula: "a - b", a: "A.X", b: "B.Y" },
    });
    expect(first?.computed?.unavailable).toBeUndefined();
    const second = byId.get("car1/=c2");
    expect(second).toMatchObject({
      displayName: "Other",
      computed: { formula: "a + b", a: "A.X", b: "C.Z", unavailable: "not in this list: C.Z" },
    });
    // No info for car2: it lacks B.Y, and c2's one unavailable info sits on the first data ref.
    expect(infos.some((i) => i.dataRef === "car2")).toBe(false);
  });

  it("gives one info per data ref that holds all inputs", () => {
    const both = computedInfos([c1], [...items, item("car2", "B.Y")]);
    expect(both.map((i) => i.id).sort()).toEqual(["car1/=c1", "car2/=c1"]);
    // Several missing inputs are listed, comma-separated.
    const gone = computedInfos([{ ...c1, a: "P.Q", b: "R.S" }], items);
    expect(gone).toHaveLength(1);
    expect(gone[0]?.computed?.unavailable).toBe("not in this list: P.Q, R.S");
    // A scoped list: the unavailable info sits on the scope's data ref.
    const scoped = computedInfos([c2], items, "car2");
    expect(scoped.map((i) => i.id)).toEqual(["car2/=c2"]);
    // An empty list gives no info at all; a definition-free call gives none.
    expect(computedInfos([c1], [])).toEqual([]);
    expect(computedInfos([], items)).toEqual([]);
  });

  it("takes the unit from the definition, not from the inputs", () => {
    const infos = computedInfos(
      [{ id: "c1", name: "Difference", formula: "a - b", a: "A.X", b: "B.Y" }],
      [item("car1", "A.X", { unit: "rpm" }), item("car1", "B.Y", { unit: "A" })],
    );
    expect(infos[0]?.unit).toBeUndefined();
  });
});

describe("free computed names", () => {
  const def = (name: string): ComputedDef => ({ id: "c1", name, formula: "a", a: "S.A" });

  it("keeps a free name and numbers a taken one", () => {
    expect(freeName("abs(SPEED)", [])).toBe("abs(SPEED)");
    expect(freeName("abs(SPEED)", [def("other")])).toBe("abs(SPEED)");
    expect(freeName("abs(SPEED)", [def("abs(SPEED)")])).toBe("abs(SPEED) 2");
    expect(freeName("abs(SPEED)", [def("abs(SPEED)"), def("abs(SPEED) 2")])).toBe("abs(SPEED) 3");
    // A gap in the numbering is filled from 2 upwards.
    expect(freeName("x", [def("x"), def("x 3")])).toBe("x 2");
  });

  it("compares trimmed and ignoring case", () => {
    expect(freeName("Abs", [def("  abs ")])).toBe("Abs 2");
    expect(freeName("  ABS  ", [def("abs")])).not.toBe("  ABS  ");
    expect(freeName("Abs", [def("ABS"), def("abs 2")])).toBe("Abs 3");
  });

  it("cuts a long name with an ellipsis and stays unique", () => {
    const base = "x".repeat(MAX_COMPUTED_NAME);
    expect(base).toHaveLength(60);
    const second = freeName(base, [def(base)]);
    expect(second.length).toBeLessThanOrEqual(MAX_COMPUTED_NAME);
    expect(second).not.toBe(base);
    expect(second.endsWith("\u2026 2")).toBe(true);
    const third = freeName(base, [def(base), def(second)]);
    expect(third.length).toBeLessThanOrEqual(MAX_COMPUTED_NAME);
    expect(new Set([base, second, third]).size).toBe(3);
    expect(third.endsWith("\u2026 3")).toBe(true);
    // Ten and more: the longer suffix still fits.
    const taken = [base];
    for (let i = 2; i <= 12; i++) taken.push(freeName(base, taken.map(def)));
    expect(new Set(taken).size).toBe(12);
    for (const n of taken) expect(n.length).toBeLessThanOrEqual(MAX_COMPUTED_NAME);
  });
});

describe("computed row value", () => {
  it("is null for SNA and non-finite, else the value", () => {
    const sub = ast("a - b");
    expect(computedRowValue(sub, p(1, 10), p(1, 4))).toBe(6);
    expect(computedRowValue(sub, p(1, null), p(1, 4))).toBeNull();
    expect(computedRowValue(sub, p(1, 10), p(1, null))).toBeNull();
    const one = ast("abs(a)");
    expect(computedRowValue(one, p(1, -2.5), undefined)).toBe(2.5);
    expect(computedRowValue(one, p(1, null), undefined)).toBeNull();
    const div = ast("a / b");
    expect(computedRowValue(div, p(1, 1), p(1, 0))).toBeNull();
    expect(computedRowValue(div, p(1, 0), p(1, 0))).toBeNull();
    expect(computedRowValue(div, p(1, -1), p(1, 0))).toBeNull();
    expect(computedRowValue(div, p(1, 9), p(1, 3))).toBe(3);
    // Zero is a value, not SNA.
    expect(computedRowValue(sub, p(1, 5), p(1, 5))).toBe(0);
  });
});
