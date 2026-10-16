import { formatLocal, fromIso, NS_PER_MS, NS_PER_S } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import {
  formatFull,
  formatRange,
  formatTime,
  fractionDigits,
  tickLabels,
  tickStep,
  tickStepForWidth,
  ticks,
} from "../src/time/axis.ts";

// Tests run with TZ=Europe/Berlin (see package.json); October 2026 is CEST, UTC+2.

describe("tick steps", () => {
  it("picks clock-friendly steps", () => {
    const from = fromIso("2026-10-13T09:00:00Z");
    expect(tickStep(from, from + 10n * 3600n * NS_PER_S, 10)).toBe(3600n * NS_PER_S);
    expect(tickStep(from, from + 2n * 3600n * NS_PER_S, 10)).toBe(15n * 60n * NS_PER_S);
    expect(tickStep(from, from + NS_PER_S, 10)).toBe(100n * NS_PER_MS);
    expect(tickStep(from, from + 100_000n, 10)).toBe(10_000n);
  });

  it("places ticks on multiples of the step", () => {
    const from = fromIso("2026-10-13T09:00:00.000003Z");
    const values = ticks(from, from + 100_000n, 10_000n);
    expect(values[0]).toBe(fromIso("2026-10-13T09:00:00.00001Z"));
    expect(values.every((t) => t % 10_000n === 0n)).toBe(true);
  });

  it("aligns hour steps to local time", () => {
    const from = fromIso("2026-10-13T09:20:00Z"); // 11:20 local
    const values = ticks(from, from + 12n * 3600n * NS_PER_S, 6n * 3600n * NS_PER_S);
    expect(values.map((t) => formatTime(t, 0, false))).toEqual(["12:00", "18:00"]);
  });
});

describe("labels", () => {
  it("distinguishes microseconds in a 100 µs window (spec scenario)", () => {
    const from = fromIso("2026-10-13T09:30:00Z");
    const step = tickStep(from, from + 100_000n, 10);
    const labels = tickLabels(ticks(from, from + 100_000n, step), step);
    expect(labels).toHaveLength(11);
    expect(new Set(labels.map((l) => l.split("\n")[0])).size).toBe(11);
    expect(labels[1]).toBe("11:30:00.00001");
    expect(labels[0]).toBe("11:30:00.00000\n2026-10-13");
  });

  it("shows nanoseconds when needed", () => {
    expect(fractionDigits(1n)).toBe(9);
    expect(fractionDigits(100n * NS_PER_MS)).toBe(1);
    expect(formatTime(fromIso("2026-10-14T08:00:00.123456789Z"), 9)).toBe("10:00:00.123456789");
  });

  it("adds the date on the first tick and at day changes", () => {
    const from = fromIso("2026-10-13T20:00:00Z"); // 22:00 local
    const step = 3600n * NS_PER_S;
    const labels = tickLabels(ticks(from, from + 4n * step, step), step);
    expect(labels).toEqual(["22:00\n2026-10-13", "23:00", "00:00\n2026-10-14", "01:00", "02:00"]);
  });

  it("formats full timestamps with trimmed precision", () => {
    expect(formatFull(fromIso("2026-10-13T09:12:00.253Z"))).toBe("2026-10-13 11:12:00.253");
    expect(formatFull(fromIso("2026-10-13T09:12:00Z"))).toBe("2026-10-13 11:12:00");
  });
});

describe("tickStepForWidth", () => {
  it("chooses fewer ticks when labels get longer", () => {
    const from = fromIso("2026-10-13T09:30:00Z");
    // 100 µs on 220 px: 14-character labels need ~100 px each, so two ticks (100 µs step).
    expect(tickStepForWidth(from, from + 100_000n, 220)).toBe(100_000n);
    expect(tickStepForWidth(from, from + 100_000n, 1200)).toBe(10_000n);
    expect(tickStepForWidth(from, from + 2n * 3600n * NS_PER_S, 500)).toBe(15n * 60n * NS_PER_S);
  });
});

// Header range of a window: committed ranges can carry nanoseconds (zoom history, extent), the
// header shows at most millisecond precision (round 1 finding "nanosecond header range").
describe("formatRange", () => {
  it("shows at most milliseconds and drops trailing zeros", () => {
    const from = fromIso("2026-10-13T09:12:00.253123456Z");
    const to = fromIso("2026-10-13T09:12:05Z");
    expect(formatRange(from, to)).toBe("2026-10-13 11:12:00.253 – 2026-10-13 11:12:05");
  });

  it("truncates instead of rounding up", () => {
    const t = fromIso("2026-10-13T09:12:00.999999999Z");
    expect(formatRange(t, t)).toBe("2026-10-13 11:12:00.999 – 2026-10-13 11:12:00.999");
  });
});

describe("shared local time", () => {
  it("formats local times like the shared formatLocal", () => {
    const times = [
      fromIso("2026-10-13T13:08:00Z"), // 0 fraction digits
      fromIso("2026-10-13T13:08:01.5Z"), // 3
      fromIso("2026-10-13T13:08:00.123456Z"), // 6
      fromIso("2026-10-13T13:08:00.123456789Z"), // 9
      fromIso("2026-10-25T00:30:00Z"), // fold, first 02:30 (+02:00)
      fromIso("2026-10-25T01:30:00Z"), // fold, second 02:30 (+01:00)
      fromIso("1900-01-01T00:00:00Z"),
      fromIso("2262-04-10T12:00:00.000000001Z"),
    ];
    for (const t of times) expect(formatFull(t), String(t)).toBe(formatLocal(t));
    expect(formatLocal(times[4] as bigint)).toBe("2026-10-25 02:30:00");
    expect(formatLocal(times[5] as bigint)).toBe("2026-10-25 02:30:00");
  });
});
