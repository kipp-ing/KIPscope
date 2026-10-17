import { describe, expect, it } from "vitest";
import { evaluateAt, formatCursorNumber } from "../src/cursor.ts";

const p = (t: bigint, v: number | null) => ({ t, v });

describe("evaluateAt", () => {
  it("evaluates raw, interpolated and held values", () => {
    // A point exactly at t is raw, in both modes, with or without a next point.
    expect(evaluateAt(100n, "line", p(100n, 23), p(200n, 22))).toEqual({ kind: "raw", value: 23 });
    expect(evaluateAt(100n, "step", p(100n, 23), p(200n, 22))).toEqual({ kind: "raw", value: 23 });
    expect(evaluateAt(100n, "line", p(100n, 23), undefined)).toEqual({ kind: "raw", value: 23 });
    // Linear between valid neighbours: 10 + (20 - 10) * 50 / 100 = 15, 10 + 10 * 25 / 100 = 12.5.
    expect(evaluateAt(50n, "line", p(0n, 10), p(100n, 20))).toEqual({
      kind: "interpolated",
      value: 15,
    });
    expect(evaluateAt(25n, "line", p(0n, 10), p(100n, 20))).toEqual({
      kind: "interpolated",
      value: 12.5,
    });
    // Falling slope, real nanosecond times: SPEED_DISP 23 at .093 s, 22 at .194 s, t = .1435 s → 22.5.
    expect(
      evaluateAt(
        1791896880143500000n,
        "line",
        p(1791896880093000000n, 23),
        p(1791896880194000000n, 22),
      ),
    ).toEqual({ kind: "interpolated", value: 22.5 });
    // WSPD_FL 179.5 at .083 s, 180 at .103 s, t = .093 s → 179.75.
    expect(
      evaluateAt(
        1791896880093000000n,
        "line",
        p(1791896880083000000n, 179.5),
        p(1791896880103000000n, 180),
      ),
    ).toEqual({ kind: "interpolated", value: 179.75 });
    // Step mode holds the earlier valid value.
    expect(evaluateAt(50n, "step", p(0n, 10), p(100n, 20))).toEqual({ kind: "held", value: 10 });
    expect(
      evaluateAt(
        1791896880143500000n,
        "step",
        p(1791896880093000000n, 23),
        p(1791896880194000000n, 22),
      ),
    ).toEqual({
      kind: "held",
      value: 23,
    });
    // Negative values and a zero crossing: -10 + 20 * 0.25 = -5.
    expect(evaluateAt(25n, "line", p(0n, -10), p(100n, 10))).toEqual({
      kind: "interpolated",
      value: -5,
    });
  });

  it("returns SNA and no value without inventing one", () => {
    // Nothing at all, or nothing at or before t.
    expect(evaluateAt(50n, "line", undefined, undefined)).toEqual({
      kind: "none",
      reason: "no_data",
    });
    expect(evaluateAt(50n, "step", undefined, undefined)).toEqual({
      kind: "none",
      reason: "no_data",
    });
    expect(evaluateAt(50n, "line", undefined, p(100n, 5))).toEqual({
      kind: "none",
      reason: "before_first",
    });
    expect(evaluateAt(50n, "step", undefined, p(100n, null))).toEqual({
      kind: "none",
      reason: "before_first",
    });
    // A point exactly at t: SNA is SNA (with and without a next point), a number is raw.
    expect(evaluateAt(100n, "line", p(100n, null), p(200n, 5))).toEqual({ kind: "sna" });
    expect(evaluateAt(100n, "step", p(100n, null), undefined)).toEqual({ kind: "sna" });
    // After the last point.
    expect(evaluateAt(150n, "line", p(100n, 5), undefined)).toEqual({
      kind: "none",
      reason: "after_last",
    });
    expect(evaluateAt(150n, "step", p(100n, 5), undefined)).toEqual({
      kind: "none",
      reason: "after_last",
    });
    // The rule order of C4: "no next" comes before "at is SNA".
    expect(evaluateAt(150n, "line", p(100n, null), undefined)).toEqual({
      kind: "none",
      reason: "after_last",
    });
    // The earlier point is SNA: SNA in both modes, whatever follows.
    for (const next of [p(200n, 5), p(200n, null)]) {
      expect(evaluateAt(150n, "line", p(100n, null), next)).toEqual({ kind: "sna" });
      expect(evaluateAt(150n, "step", p(100n, null), next)).toEqual({ kind: "sna" });
    }
    // The next point is SNA: line has no segment into SNA, step holds the valid value.
    expect(evaluateAt(150n, "line", p(100n, 0), p(200n, null))).toEqual({
      kind: "none",
      reason: "next_sna",
    });
    expect(evaluateAt(150n, "step", p(100n, 0), p(200n, null))).toEqual({ kind: "held", value: 0 });
    // Isolated valid point between SNA points (SPEED n = 601): raw at the point, then next_sna / held.
    expect(evaluateAt(601n, "line", p(601n, 42), p(602n, null))).toEqual({
      kind: "raw",
      value: 42,
    });
    expect(evaluateAt(650n, "line", p(601n, 42), p(700n, null))).toEqual({
      kind: "none",
      reason: "next_sna",
    });
    expect(evaluateAt(650n, "step", p(601n, 42), p(700n, null))).toEqual({
      kind: "held",
      value: 42,
    });
  });
});

describe("formatCursorNumber", () => {
  it("formats cursor numbers with at most 9 significant digits", () => {
    expect(formatCursorNumber(362.40000000000003)).toBe("362.4");
    expect(formatCursorNumber(0.5000000000000568)).toBe("0.5");
    expect(formatCursorNumber(-5)).toBe("-5");
    expect(formatCursorNumber(23)).toBe("23");
    expect(formatCursorNumber(0)).toBe("0");
    expect(formatCursorNumber(179.75)).toBe("179.75");
    expect(formatCursorNumber(65535.25)).toBe("65535.25"); // 7 digits are real resolution
    expect(formatCursorNumber(1 / 3)).toBe("0.333333333");
    expect(formatCursorNumber(123456789.987)).toBe("123456790");
  });
});

describe("evaluateAt with named points", () => {
  const named = (point: { v: number | null }) => point.v === 0 || point.v === 3;

  it("holds line mode next to a named point", () => {
    // 0 is named: between 0 and 5 the earlier value is held, not interpolated to 2.5.
    expect(evaluateAt(50n, "line", p(0n, 0), p(100n, 5), named)).toEqual({
      kind: "held",
      value: 0,
    });
    // The next point named holds the earlier one as well.
    expect(evaluateAt(50n, "line", p(0n, 5), p(100n, 3), named)).toEqual({
      kind: "held",
      value: 5,
    });
    // Without a name on either side the value is interpolated as before.
    expect(evaluateAt(50n, "line", p(0n, 4), p(100n, 6), named)).toEqual({
      kind: "interpolated",
      value: 5,
    });
    // Without the option nothing changes.
    expect(evaluateAt(50n, "line", p(0n, 0), p(100n, 5))).toEqual({
      kind: "interpolated",
      value: 2.5,
    });
    // A point exactly at t is raw, named or not; step mode holds anyway.
    expect(evaluateAt(100n, "line", p(100n, 3), p(200n, 5), named)).toEqual({
      kind: "raw",
      value: 3,
    });
    expect(evaluateAt(50n, "step", p(0n, 0), p(100n, 5), named)).toEqual({
      kind: "held",
      value: 0,
    });
  });
});

describe("evaluateAt across gaps", () => {
  const MS = 1_000_000n;
  const cyc = { period: 20n * MS, logger: [] };
  const none = (reason: string) => ({ kind: "none", reason });

  it("returns no value across a gap", () => {
    // 4 at 0 ns and 7 at 100 ms, period 20 ms: more than 3 periods apart, hold end 20 ms.
    const a = p(0n, 4);
    const b = p(100n * MS, 7);
    expect(evaluateAt(10n * MS, "line", a, b, undefined, cyc)).toEqual(none("period_gap"));
    expect(evaluateAt(30n * MS, "line", a, b, undefined, cyc)).toEqual(none("period_gap"));
    expect(evaluateAt(10n * MS, "step", a, b, undefined, cyc)).toEqual({ kind: "held", value: 4 });
    expect(evaluateAt(30n * MS, "step", a, b, undefined, cyc)).toEqual(none("period_gap"));
    // The earlier point is SNA: SNA up to the hold end, then no data.
    const sna = p(0n, null);
    expect(evaluateAt(10n * MS, "line", sna, b, undefined, cyc)).toEqual({ kind: "sna" });
    expect(evaluateAt(10n * MS, "step", sna, b, undefined, cyc)).toEqual({ kind: "sna" });
    expect(evaluateAt(30n * MS, "line", sna, b, undefined, cyc)).toEqual(none("period_gap"));
    expect(evaluateAt(30n * MS, "step", sna, b, undefined, cyc)).toEqual(none("period_gap"));
    // 4 at 0 and 7 at 2.1 s, no period, a logger gap 50 ms - 2.05 s: held to the gap's start, then logger_gap.
    const far = p(2100n * MS, 7);
    const logger = { logger: [{ from: 50n * MS, to: 2050n * MS }] };
    expect(evaluateAt(30n * MS, "step", a, far, undefined, logger)).toEqual({
      kind: "held",
      value: 4,
    });
    expect(evaluateAt(60n * MS, "step", a, far, undefined, logger)).toEqual(none("logger_gap"));
    expect(evaluateAt(60n * MS, "line", a, far, undefined, logger)).toEqual(none("logger_gap"));
  });

  it("holds a named point up to the hold end, and leaves points at t and unsplit pairs alone", () => {
    const named = () => true;
    const a = p(0n, 4);
    const b = p(100n * MS, 7);
    expect(evaluateAt(10n * MS, "line", a, b, named, cyc)).toEqual({ kind: "held", value: 4 });
    expect(evaluateAt(30n * MS, "line", a, b, named, cyc)).toEqual(none("period_gap"));
    // A point at t is raw whatever the gaps; exactly 3 periods apart is no split.
    expect(evaluateAt(0n, "line", a, b, undefined, cyc)).toEqual({ kind: "raw", value: 4 });
    expect(evaluateAt(30n * MS, "line", a, p(60n * MS, 8), undefined, cyc)).toEqual({
      kind: "interpolated",
      value: 6,
    });
    // After the last point is still after_last, with or without gaps.
    expect(evaluateAt(30n * MS, "line", a, undefined, undefined, cyc)).toEqual(none("after_last"));
  });
});
