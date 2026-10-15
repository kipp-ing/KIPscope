import { describe, expect, it } from "vitest";
import { formatAxisTicks, formatQuantity, formatQuantityBare, takesPrefix } from "../src/numfmt.ts";

describe("numfmt (improve-navigation, D-026)", () => {
  it("formats the pinned values with 3 digits", () => {
    const cases: [number, string | undefined, string][] = [
      [13970, "1/min", "14.0 k1/min"],
      [0.00123, "V", "1.23 mV"],
      [179.75, "1/min", "180 1/min"],
      [362.40000000000003, "V", "362 V"],
      [0.5, "V", "500 mV"],
      [-5, "km/h", "-5.00 km/h"],
      [0, "km/h", "0 km/h"],
      [-0, "km/h", "0 km/h"],
      [999.96, "V", "1.00 kV"],
      [13970, undefined, "14.0 k"],
      [-127, "rpm/10ms", "-127 rpm/10ms"],
    ];
    for (const [value, unit, text] of cases) {
      expect(formatQuantity(value, unit, 3), `${value} ${unit}`).toBe(text);
    }
  });

  it("formats the pinned values with 4 digits", () => {
    expect(formatQuantity(13970, "1/min", 4)).toBe("13.97 k1/min");
    expect(formatQuantity(179.75, "1/min", 4)).toBe("179.8 1/min");
    expect(formatQuantity(362.40000000000003, "V", 4)).toBe("362.4 V");
    // Rounded on the unscaled value first: 8191.5 → 8192, not 8.191 (design N7).
    expect(formatQuantity(8191.5, "1/min", 4)).toBe("8.192 k1/min");
    expect(formatQuantity(8191.5, "1/min", 3)).toBe("8.19 k1/min");
  });

  it("drops the unit but keeps the SI prefix in the bare form", () => {
    expect(formatQuantityBare(13970, "1/min", 3)).toBe("14.0 k");
    expect(formatQuantityBare(0.0005, "V", 3)).toBe("500 µ");
    expect(formatQuantityBare(358, "V", 3)).toBe("358");
    expect(formatQuantityBare(45, "km/h", 3)).toBe("45.0");
    expect(formatQuantityBare(10000000, "%", 3)).toBe("1.00e+7");
    expect(formatQuantityBare(0, "V", 3)).toBe("0");
    expect(formatQuantityBare(-6, undefined, 3)).toBe("-6.00");
  });

  it("does not prefix prefixed or prefix-free units", () => {
    const cases: [number, string, string][] = [
      [45, "km/h", "45.0 km/h"],
      [1234, "km/h", "1230 km/h"],
      [-40, "°C", "-40.0 °C"],
      [0.001, "°C", "0.00100 °C"],
      [12.5, "%", "12.5 %"],
      [10000000, "%", "1.00e+7 %"],
      [1500, "kW", "1500 kW"],
    ];
    for (const [value, unit, text] of cases) {
      expect(formatQuantity(value, unit, 3), `${value} ${unit}`).toBe(text);
    }
    for (const unit of [
      "km/h",
      "kW",
      "mA",
      "ms",
      "mbar",
      "MΩ",
      "%",
      "‰",
      "°",
      "°C",
      "°F",
      "dB",
      "h",
      "min",
      "d",
    ]) {
      expect(takesPrefix(unit), unit).toBe(false);
    }
    for (const unit of ["V", "1/min", "rpm/10ms", "Hz", undefined]) {
      expect(takesPrefix(unit), String(unit)).toBe(true);
    }
  });

  it("prefixes the bare compound units (Ah, VA, Wh) but not the prefixed ones", () => {
    const cases: [number, string, string][] = [
      [0.5, "Ah", "500 mAh"],
      [1234, "Ah", "1.23 kAh"],
      [1500, "VA", "1.50 kVA"],
      [1500, "Wh", "1.50 kWh"],
      [0.5, "mAh", "0.500 mAh"],
      [1500, "kVA", "1500 kVA"],
      [1500, "kWh", "1500 kWh"],
    ];
    for (const [value, unit, text] of cases) {
      expect(formatQuantity(value, unit, 3), `${value} ${unit}`).toBe(text);
    }
    for (const unit of ["Ah", "VA", "Wh"]) expect(takesPrefix(unit), unit).toBe(true);
    for (const unit of ["mAh", "kVA", "kWh", "Mvar"]) expect(takesPrefix(unit), unit).toBe(false);
  });

  it("formats axis ticks with one prefix per axis", () => {
    expect(formatAxisTicks([0, 500, 1000, 1500], "1/min", 3)).toEqual({
      title: "k1/min",
      labels: ["0.0", "0.5", "1.0", "1.5"],
    });
    expect(formatAxisTicks([362, 362.5, 363], "V", 3)).toEqual({
      title: "V",
      labels: ["362.0", "362.5", "363.0"],
    });
    expect(formatAxisTicks([0, 20, 40, 60], "km/h", 3)).toEqual({
      title: "km/h",
      labels: ["0", "20", "40", "60"],
    });
    expect(formatAxisTicks([0, 0.0005, 0.001], "V", 3)).toEqual({
      title: "mV",
      labels: ["0.0", "0.5", "1.0"],
    });
  });
});
