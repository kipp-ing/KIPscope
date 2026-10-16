import { describe, expect, it } from "vitest";
import { placeSignals } from "../src/placement.ts";
import type { TimeseriesWindow, ValuesWindow } from "../src/workspace.ts";

/** Signal `uN` has unit `UN`; `nN` have no unit; `v1`, `v2` have unit V. */
const unitOf = (id: string): string | undefined => {
  if (id.startsWith("u")) return id.toUpperCase();
  if (id.startsWith("v")) return "V";
  if (id === "w1") return "U1";
  if (id === "w2") return "U2";
  if (id === "x") return "X";
  return undefined;
};

function ts(signals: string[]): TimeseriesWindow {
  return {
    id: "w1",
    kind: "timeseries",
    range: { from: "0", to: "10" },
    display: { mode: "line", envelope: false },
    signals: signals.map((signalId, i) => ({ id: `a${i}`, signalId })),
  };
}

function values(signals: string[]): ValuesWindow {
  return {
    id: "w2",
    kind: "values",
    mode: "line",
    signals: signals.map((signalId, i) => ({ id: `b${i}`, signalId })),
  };
}

const into = (plan: ReturnType<typeof placeSignals>) => plan.steps.map((s) => s.into);

describe("placeSignals", () => {
  it("fills the target up to four units and overflows into new windows", () => {
    const ids = ["u1", "u2", "u3", "u4", "u5", "u6"];
    const plan = placeSignals(ids, ts([]), unitOf);
    expect(into(plan)).toEqual(["target", "target", "target", "target", 0, 0]);
    expect(plan.steps.map((s) => s.signalId)).toEqual(ids);
    expect(plan.windows).toBe(1);
    expect(plan.skipped).toEqual([]);
  });

  it("counts the units the target already shows", () => {
    // Target shows units U1, U2, U3: only one more unit fits.
    const plan = placeSignals(["u4", "u5", "u6"], ts(["u1", "u2", "u3"]), unitOf);
    expect(into(plan)).toEqual(["target", 0, 0]);
    expect(plan.windows).toBe(1);
    // A full target takes only signals of its units.
    const full = placeSignals(["u5", "u1"], ts(["u1", "u2", "u3", "u4"]), unitOf);
    expect(full.skipped).toEqual(["u1"]);
    expect(into(full)).toEqual([0]);
  });

  it("puts each signal into the first window it fits", () => {
    // Target shows units U1, U2, U3. d=u4 fits (4th unit); e=u5 would be a 5th and goes to window 0;
    // w1 (unit U1) fits the target again; f=u6 fits window 0 (U5, U6); w2 (unit U2) fits the target.
    const plan = placeSignals(["u4", "u5", "w1", "u6", "w2"], ts(["u1", "u2", "u3"]), unitOf);
    expect(plan.steps.map((s) => [s.signalId, s.into])).toEqual([
      ["u4", "target"],
      ["u5", 0],
      ["w1", "target"],
      ["u6", 0],
      ["w2", "target"],
    ]);
    expect(plan.windows).toBe(1);
  });

  it("creates windows for a new-window target", () => {
    const ids = ["u1", "u2", "u3", "u4", "u5", "u6", "u7", "u8", "u9"];
    const plan = placeSignals(ids, undefined, unitOf);
    expect(into(plan)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 2]);
    expect(plan.windows).toBe(3);
    expect(placeSignals([], undefined, unitOf)).toEqual({ steps: [], windows: 0, skipped: [] });
  });

  it("takes any unit into a values window", () => {
    const plan = placeSignals(["x", "u1", "u2", "u3", "u4", "u5", "u6"], values(["x"]), unitOf);
    expect(plan.skipped).toEqual(["x"]);
    expect(plan.steps.map((s) => s.signalId)).toEqual(["u1", "u2", "u3", "u4", "u5", "u6"]);
    expect(into(plan)).toEqual(Array(6).fill("target"));
    expect(plan.windows).toBe(0);
  });

  it("counts a signal without unit as its own unit", () => {
    // Three unitless signals are three units; V is a fourth, and the second V shares it.
    const plan = placeSignals(["n1", "n2", "n3", "v1", "v2"], ts([]), unitOf);
    expect(into(plan)).toEqual(["target", "target", "target", "target", "target"]);
    expect(plan.windows).toBe(0);
    // Four unitless signals are four units; a fifth unit overflows.
    const over = placeSignals(["n1", "n2", "n3", "n4", "v1"], ts([]), unitOf);
    expect(into(over)).toEqual(["target", "target", "target", "target", 0]);
  });

  it("places a repeated signal once", () => {
    const plan = placeSignals(["u1", "u2", "u1", "u2", "u3"], ts([]), unitOf);
    expect(plan.steps.map((s) => s.signalId)).toEqual(["u1", "u2", "u3"]);
    expect(into(plan)).toEqual(["target", "target", "target"]);
  });
});
