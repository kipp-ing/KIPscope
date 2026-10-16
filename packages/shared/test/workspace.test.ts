import { describe, expect, it } from "vitest";
import {
  Command,
  RenderedMessage,
  SIGNAL_COLORS,
  type TimeseriesWindow,
  type ValuesWindow,
  windowTitle,
} from "../src/workspace.ts";

const untitled = (id: string): TimeseriesWindow => ({
  id,
  kind: "timeseries",
  range: { from: "0", to: "1" },
  display: { mode: "line", envelope: false },
  signals: [],
});

describe("Command schema", () => {
  it("accepts valid commands and normalizes times to decimal nanoseconds", () => {
    const cmd = Command.parse({
      type: "window.create",
      from: "2026-10-13T09:00:00Z",
      to: "1791889200000000000",
    });
    expect(cmd).toEqual({
      type: "window.create",
      from: "1791882000000000000",
      to: "1791889200000000000",
    });
    expect(Command.parse({ type: "window.setDisplay", windowId: "w1", mode: "step" })).toEqual({
      type: "window.setDisplay",
      windowId: "w1",
      mode: "step",
    });
  });

  it("rejects malformed commands", () => {
    const bad = [
      {},
      { type: "window.explode" },
      { type: "window.remove" },
      { type: "window.remove", windowId: "" },
      { type: "window.addSignal", windowId: "w1" },
      { type: "window.setRange", windowId: "w1", from: "yesterday", to: "0" },
      { type: "window.setDisplay", windowId: "w1", mode: "bars" },
      { type: "window.setDisplay", windowId: "w1", envelope: "yes" },
    ];
    for (const input of bad) expect(Command.safeParse(input).success).toBe(false);
  });

  it("rejects times outside 1900 … 2262", () => {
    const bounds = {
      min: "-2208988800000000000", // 1900-01-01T00:00:00Z
      max: "9223286400000000000", // 2262-04-11T00:00:00Z
    };
    const setRange = (from: string, to: string) =>
      Command.safeParse({ type: "window.setRange", windowId: "w1", from, to });
    // The live bug: both values beyond int64 nanoseconds.
    const live = setRange("-29473328485867940608", "62083631947910636800");
    expect(live.success).toBe(false);
    expect(live.error?.issues.map((i) => i.message).join(" ")).toContain("1900-01-01T00:00:00Z");
    expect(live.error?.issues.map((i) => i.message).join(" ")).toContain("2262-04-11T00:00:00Z");
    // One nanosecond outside on each side.
    expect(setRange("-2208988800000000001", "0").success).toBe(false);
    expect(setRange("0", "9223286400000000001").success).toBe(false);
    expect(setRange("1899-12-31T23:59:59Z", "0").success).toBe(false);
    // The bounds themselves are inclusive.
    expect(setRange(bounds.min, bounds.max).success).toBe(true);
    expect(setRange("1900-01-01T00:00:00Z", "2262-04-11T00:00:00Z").success).toBe(true);
    expect(
      Command.safeParse({ type: "window.create", from: "-29473328485867940608", to: "0" }).success,
    ).toBe(false);
  });

  it("titles untitled windows by ID", () => {
    expect(windowTitle(untitled("w6"))).toBe("Window 6");
    expect(windowTitle(untitled("w12"))).toBe("Window 12");
    expect(windowTitle({ ...untitled("w6"), title: "HV voltages" })).toBe("HV voltages");
    const values: ValuesWindow = { id: "w7", kind: "values", mode: "line", signals: [] };
    expect(windowTitle(values)).toBe("Values 7");
    expect(windowTitle({ ...values, title: "Drive" })).toBe("Drive");
  });

  it("validates render acknowledgements", () => {
    expect(
      RenderedMessage.safeParse({ type: "rendered", revision: 3, status: "complete" }).success,
    ).toBe(true);
    expect(
      RenderedMessage.safeParse({ type: "rendered", revision: -1, status: "complete" }).success,
    ).toBe(false);
    expect(
      RenderedMessage.safeParse({ type: "rendered", revision: 1, status: "done" }).success,
    ).toBe(false);
  });

  it("bounds render acknowledgements", () => {
    const message = (errors: { windowId: string; message: string }[]) =>
      RenderedMessage.safeParse({ type: "rendered", revision: 1, status: "error", errors }).success;
    const error = (text: string) => ({ windowId: "w1", message: text });
    expect(message(Array.from({ length: 51 }, () => error("x")))).toBe(false);
    expect(message([error("y".repeat(501))])).toBe(false);
    expect(message(Array.from({ length: 50 }, () => error("z".repeat(500))))).toBe(true);
  });
});

// Palette of D-055 (design T5): colours as pinned; contrast and distance are computed here.
const hexToRgb = (hex: string): [number, number, number] => [
  Number.parseInt(hex.slice(1, 3), 16),
  Number.parseInt(hex.slice(3, 5), 16),
  Number.parseInt(hex.slice(5, 7), 16),
];

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrastOnWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

/** sRGB (D65) to CIE Lab. */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

const deltaE76 = (a: string, b: string) => {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

describe("SIGNAL_COLORS", () => {
  it("uses Okabe-Ito first, ten distinguishable colours", () => {
    expect([...SIGNAL_COLORS]).toEqual([
      "#0072B2",
      "#E69F00",
      "#009E73",
      "#D55E00",
      "#CC79A7",
      "#56B4E9",
      "#332288",
      "#882255",
      "#999933",
      "#8C564B",
    ]);
    // The four colours after Okabe-Ito's six are readable on the white window background.
    for (const colour of SIGNAL_COLORS.slice(6)) {
      expect(contrastOnWhite(colour), colour).toBeGreaterThanOrEqual(3);
    }
    // Every pair differs clearly (CIE76); the closest pair is #0072B2 / #56B4E9.
    let closest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < SIGNAL_COLORS.length; i++) {
      for (let j = i + 1; j < SIGNAL_COLORS.length; j++) {
        const d = deltaE76(SIGNAL_COLORS[i] as string, SIGNAL_COLORS[j] as string);
        expect(d, `${SIGNAL_COLORS[i]} vs ${SIGNAL_COLORS[j]}`).toBeGreaterThanOrEqual(25);
        closest = Math.min(closest, d);
      }
    }
    expect(closest).toBeGreaterThanOrEqual(25);
  });
});
