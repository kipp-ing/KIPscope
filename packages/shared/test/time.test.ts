import { describe, expect, it } from "vitest";
import {
  DENSITY_WIDTHS,
  densityWidth,
  floorDiv,
  fromIso,
  MAX_DENSITY_BARS,
  parseTimestamp,
  toIso,
} from "../src/time.ts";

describe("Timestamp", () => {
  it("round-trips the spec's nanosecond value exactly", () => {
    const iso = "2026-10-14T08:00:00.123456789Z";
    const t = fromIso(iso);
    expect(t).toBe(1791964800123456789n);
    expect(toIso(t)).toBe(iso);
    expect(parseTimestamp(t.toString())).toBe(t);
  });

  it("keeps millisecond and microsecond precision as written", () => {
    expect(toIso(fromIso("2026-10-13T09:12:00.253Z"))).toBe("2026-10-13T09:12:00.253Z");
    expect(toIso(fromIso("2026-10-13T09:12:00.000001Z"))).toBe("2026-10-13T09:12:00.000001Z");
    expect(toIso(fromIso("2026-10-13T09:12:00Z"))).toBe("2026-10-13T09:12:00Z");
  });

  it("pads short fractions as decimal fractions", () => {
    expect(fromIso("1970-01-01T00:00:00.5Z")).toBe(500_000_000n);
  });

  it("applies UTC offsets", () => {
    expect(fromIso("2026-10-14T10:00:00.000000001+02:00")).toBe(
      fromIso("2026-10-14T08:00:00.000000001Z"),
    );
    expect(fromIso("2026-10-14T06:30:00-01:30")).toBe(fromIso("2026-10-14T08:00:00Z"));
  });

  it("handles timestamps before 1970", () => {
    const t = fromIso("1969-12-31T23:59:59.999999999Z");
    expect(t).toBe(-1n);
    expect(toIso(t)).toBe("1969-12-31T23:59:59.999999999Z");
    expect(floorDiv(-1n, 1_000_000_000n)).toBe(-1n);
  });

  it("rejects malformed input", () => {
    expect(() => fromIso("2026-02-30T00:00:00Z")).toThrow(RangeError);
    expect(() => fromIso("2026-10-14T08:00:00.1234567890Z")).toThrow(RangeError);
    expect(() => fromIso("2026-10-14 08:00:00Z")).toThrow(RangeError);
    expect(() => parseTimestamp("1.5")).toThrow(RangeError);
    expect(() => parseTimestamp("")).toThrow(RangeError);
  });
});

describe("densityWidth", () => {
  const MS = 1_000_000n;
  const S = 1_000_000_000n;
  const DAY = 86_400n * S;

  it("picks the smallest round density width for at most 120 buckets", () => {
    expect(MAX_DENSITY_BARS).toBe(120);
    // A single instant: 1 ms.
    expect(densityWidth(0n, 0n)).toBe(MS);
    // Ten hours: 5 min would need 121 buckets (0 .. 36,000 s inclusive), so 10 min.
    expect(densityWidth(0n, 36_000n * S)).toBe(600n * S);
    // One millisecond less fits 120 buckets of 5 min.
    expect(densityWidth(0n, 35_999_999_000_000n)).toBe(300n * S);
    // Across 1970 (floor toward minus infinity: -1.5 s lies in bucket -1) up to 2026: 180 d.
    expect(densityWidth(fromIso("1969-12-31T23:59:58.5Z"), fromIso("2026-10-01T00:00:00Z"))).toBe(
      180n * DAY,
    );
    expect(densityWidth(-1_500_000_000n, fromIso("2026-10-01T00:00:00Z"))).toBe(180n * DAY);
    // The whole allowed range: 5 x 365 d.
    expect(densityWidth(fromIso("1900-01-01T00:00:00Z"), fromIso("2262-04-11T00:00:00Z"))).toBe(
      5n * 365n * DAY,
    );
  });

  it("offers ascending widths from 1 ms to 100 x 365 d", () => {
    expect(DENSITY_WIDTHS[0]).toBe(MS);
    expect(DENSITY_WIDTHS.at(-1)).toBe(100n * 365n * DAY);
    for (let i = 1; i < DENSITY_WIDTHS.length; i++) {
      expect(DENSITY_WIDTHS[i] as bigint).toBeGreaterThan(DENSITY_WIDTHS[i - 1] as bigint);
    }
  });
});
