import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type AxisInput, layoutAxes, spread } from "../src/chart/axes.ts";
import { buildModel } from "../src/chart/build.ts";

const input = (key: string, unit: string | undefined, color: string, label = key): AxisInput => ({
  key,
  label,
  ...(unit === undefined ? {} : { unit }),
  color,
});

describe("layoutAxes", () => {
  it("puts signals with the same unit on one axis", () => {
    const l = layoutAxes([input("eac", "V", "#111"), input("ptc", "V", "#222")]);
    expect(l.axes).toHaveLength(1);
    expect(l.axes[0]).toMatchObject({ side: "L", title: "V" });
    // Two signals share the axis: neutral colour.
    expect(l.axes[0]?.color).toBeUndefined();
    expect(l.scaleOf.get("eac")).toBe(l.scaleOf.get("ptc"));
    expect(l.scaleOf.get("eac")).toBe("u:V");
    expect(l.sideOf.get("eac")).toBe("L");
    expect(l.sideOf.get("ptc")).toBe("L");
    // Units are compared trimmed.
    const trimmed = layoutAxes([input("a", " V ", "#111"), input("b", "V", "#222")]);
    expect(trimmed.axes).toHaveLength(1);
  });

  it("stacks axes L, R, L2, R2 in signal order", () => {
    const l = layoutAxes([
      input("eac", "V", "#1"),
      input("ptc", "V", "#2"),
      input("vanz", "km/h", "#3"),
      input("tmot", "°C", "#4"),
      input("wspdFl", "1/min", "#5"),
    ]);
    expect(l.axes.map((a) => [a.title, a.side])).toEqual([
      ["V", "L"],
      ["km/h", "R"],
      ["°C", "L2"],
      ["1/min", "R2"],
    ]);
    expect(l.sideOf.get("ptc")).toBe("L");
    expect(l.sideOf.get("vanz")).toBe("R");
    expect(l.sideOf.get("tmot")).toBe("L2");
    expect(l.sideOf.get("wspdFl")).toBe("R2");
    expect(l.axes.map((a) => a.scale)).toEqual(["u:V", "u:km/h", "u:°C", "u:1/min"]);
  });

  it("colours an axis like its only signal", () => {
    const l = layoutAxes([
      input("eac", "V", "#1"),
      input("ptc", "V", "#2"),
      input("vanz", "km/h", "#3"),
    ]);
    expect(l.axes.find((a) => a.title === "km/h")?.color).toBe("#3");
    expect(l.axes.find((a) => a.title === "V")?.color).toBeUndefined();
    const single = layoutAxes([input("tsoll", "°C", "#9")]);
    expect(single.axes[0]?.color).toBe("#9");
  });

  it("gives unit-less signals their own axis titled by name", () => {
    const l = layoutAxes([
      input("a", undefined, "#1", "Counter A"),
      input("b", "", "#2", "Counter B"),
      input("c", "   ", "#3", "Counter C"),
    ]);
    expect(l.axes.map((a) => a.title)).toEqual(["Counter A", "Counter B", "Counter C"]);
    expect(l.axes.map((a) => a.side)).toEqual(["L", "R", "L2"]);
    expect(new Set(l.axes.map((a) => a.scale)).size).toBe(3);
    expect(l.scaleOf.get("a")).toBe("s:a");
    // Unit-less next to a unit signal never merge with it.
    const mixed = layoutAxes([input("v", "V", "#1"), input("n", undefined, "#2", "N")]);
    expect(mixed.axes).toHaveLength(2);
  });

  it("keeps sides stable before data loads", () => {
    // The layout takes every assigned signal, loaded or not, in window order, so a
    // unit-less signal listed first stays left and V stays right while data arrives.
    const all = [input("n", undefined, "#1", "Counter"), input("v", "V", "#2")];
    const before = layoutAxes(all);
    const after = layoutAxes(all.map((i) => ({ ...i })));
    expect(before.sideOf.get("n")).toBe("L");
    expect(before.sideOf.get("v")).toBe("R");
    expect(after.axes).toEqual(before.axes);
    // Reversing the list reverses the sides: order, not data, decides.
    const reversed = layoutAxes([...all].reverse());
    expect(reversed.sideOf.get("v")).toBe("L");
    expect(reversed.sideOf.get("n")).toBe("R");
  });

  it("draws no axis beyond four scales", () => {
    const l = layoutAxes(["A", "B", "C", "D", "E"].map((u, i) => input(`s${i}`, u, `#${i}`)));
    expect(l.axes).toHaveLength(4);
    expect(l.sideOf.get("s4")).toBeUndefined();
    expect(l.scaleOf.get("s4")).toBe("u:E");
  });
});

describe("axes of a window whose data has not loaded", () => {
  it("keeps the full layout in the model while no signal has a result", () => {
    // Window with a unit-less signal first, then V and km/h; nothing loaded yet.
    const inputs = [
      input("n", undefined, "#1", "Counter"),
      input("v", "V", "#2"),
      input("s", "km/h", "#3"),
    ];
    const empty = buildModel(inputs, 0n, { mode: "line", envelope: false } as never);
    expect(empty.series).toEqual([]);
    expect(empty.scales.size).toBe(0);
    // The layout (what the window draws) is complete and unchanged by loading.
    expect(empty.layout.axes.map((a) => [a.title, a.side])).toEqual([
      ["Counter", "L"],
      ["V", "R"],
      ["km/h", "L2"],
    ]);
    expect(empty.layout.axes).toEqual(layoutAxes(inputs).axes);
  });

  it("leaves missing signals out of the axes", () => {
    // SIG_A (V) beside a missing signal: one axis (V), none for the missing one.
    const l = layoutAxes([
      input("sigA", "V", "#111"),
      { key: "x", label: "X", unit: "mV", color: "#222", missing: true },
    ]);
    expect(l.axes).toHaveLength(1);
    expect(l.axes[0]).toMatchObject({ side: "L", title: "V", color: "#111" });
    expect(l.scaleOf.get("x")).toBeUndefined();
    expect(l.sideOf.get("x")).toBeUndefined();
    expect(l.scaleOf.get("sigA")).toBe("u:V");
    expect(l.sideOf.get("sigA")).toBe("L");

    // A unit-less missing signal gets no axis titled with its label either, and the sides of the
    // others do not shift.
    const bare = layoutAxes([
      { key: "x", label: "X", color: "#222", missing: true },
      input("sigA", "V", "#111"),
      input("vanz", "km/h", "#333"),
    ]);
    expect(bare.axes.map((a) => [a.title, a.side])).toEqual([
      ["V", "L"],
      ["km/h", "R"],
    ]);
    expect(bare.axes.some((a) => a.title === "X")).toBe(false);
  });
});

describe("y axis tick colour (D-095, DW21)", () => {
  // The uPlot axis config is built inline in the window component, so the source is pinned: every
  // axis colours its labels with AXIS_STROKE (slate-700, `#334155`) and every `ticks` block of an
  // axis does the same; series colours failed contrast on the ticks.
  const src = readFileSync(new URL("../src/chart/TimeseriesWindow.tsx", import.meta.url), "utf8");

  it("defines AXIS_STROKE as slate-700", () => {
    expect(src).toMatch(/const AXIS_STROKE = "#334155";/);
  });

  it("sets the stroke of the ticks of every axis that shows ticks to AXIS_STROKE", () => {
    const blocks = [...src.matchAll(/\bticks:\s*\{[^}]*\}/g)].map((m) => m[0]);
    // The y axes' block carries the tick size; the x axis's ticks (the `ticks(` function call is
    // not an object literal) may follow the same rule.
    const yTicks = blocks.filter((b) => b.includes("AXIS_TICK"));
    expect(yTicks.length, "the y axis ticks block").toBeGreaterThan(0);
    for (const b of yTicks) expect(b).toMatch(/stroke:\s*AXIS_STROKE/);
    // And the label stroke stays on the axis itself.
    expect(src.match(/^\s*stroke: AXIS_STROKE,$/gm)?.length ?? 0).toBeGreaterThanOrEqual(2);
  });
});

describe("y scale range of a constant series (D-095, uPlot RangeError)", () => {
  // The window's y range is `spread(yRange(...) ?? [dataMin, dataMax])` (TimeseriesWindow). uPlot
  // splits an axis by stepping `val += incr` from the range's min; a flat or tiny span (a constant
  // LWS_SPEED of -1433.6) makes the step vanish against the value's ULP, the loop never ends and
  // pushes until `RangeError: Invalid array length`.

  /** The splits loop of uPlot's numAxisSplits, with the increment uPlot would pick (~7 splits), capped. */
  const splitCount = (lo: number, hi: number) => {
    const incr = (hi - lo) / 7;
    let n = 0;
    for (let v = lo; v <= hi && n < 1000; v += incr) n++;
    return n;
  };

  const cases: [string, [number, number]][] = [
    ["constant negative (LWS_SPEED -1433.6)", [-1433.6, -1433.6]],
    ["constant zero", [0, 0]],
    ["constant large", [1e9, 1e9]],
    ["tiny span beside -1433.6", [-1433.6, -1433.6 + 1e-12]],
    ["tiny span beside 0", [0, 1e-12]],
    ["float noise span", [0.3, 0.1 + 0.2]],
  ];

  for (const [name, input] of cases) {
    it(`gives a finite, splittable range for ${name}`, () => {
      const [lo, hi] = spread(input);
      expect(Number.isFinite(lo) && Number.isFinite(hi)).toBe(true);
      expect(lo).toBeLessThan(hi);
      // The span is many ULPs of the value, so the splits loop advances and ends.
      expect(hi - lo).toBeGreaterThanOrEqual(1e-9 * Math.max(Math.abs(lo), Math.abs(hi)));
      expect(lo + (hi - lo) / 20).toBeGreaterThan(lo);
      const n = splitCount(lo, hi);
      expect(n).toBeGreaterThan(1);
      expect(n).toBeLessThan(1000);
      // The range still contains the data.
      expect(lo).toBeLessThanOrEqual(Math.min(...input));
      expect(hi).toBeGreaterThanOrEqual(Math.max(...input));
    });
  }

  it("falls back to [0, 1] for a non-finite range and keeps a healthy one", () => {
    expect(spread([Number.NaN, 5])).toEqual([0, 1]);
    expect(spread([0, Number.POSITIVE_INFINITY])).toEqual([0, 1]);
    expect(spread([-2, 10])).toEqual([-2, 10]);
  });
});

describe("axis title row (DW21, D-095)", () => {
  // The row is plain DOM + CSS in the window component; the source is pinned (the computed
  // colours and rects are the UI check "Axis colours on smart451").
  const css = readFileSync(new URL("../src/chart/window.css", import.meta.url), "utf8");
  const rule = (selector: string) =>
    css.match(
      new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`),
    )?.[1] ?? "";

  it("puts the titles on their own line, slate-700, 8 px above the plot", () => {
    const r = rule(".window .axis-titles");
    expect(r).toMatch(/margin-bottom:\s*8px/);
    expect(r).toMatch(/color:\s*#334155/);
  });

  it("draws the swatch 8 x 2 px with a 3 px gap", () => {
    const r = rule(".window .axis-titles .axis-swatch");
    expect(r).toMatch(/width:\s*8px/);
    expect(r).toMatch(/height:\s*2px/);
    expect(r).toMatch(/margin-right:\s*3px/);
  });
});
