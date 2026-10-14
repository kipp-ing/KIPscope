import { describe, expect, it } from "vitest";
import { floorDiv, fromIso, parseTimestamp, toIso } from "../src/time.ts";

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
