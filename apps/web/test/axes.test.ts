import { describe, expect, it } from "vitest";
import { type AxisInput, layoutAxes } from "../src/chart/axes.ts";
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
      input("dvl", "1/min", "#5"),
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
    expect(l.sideOf.get("dvl")).toBe("R2");
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
});
