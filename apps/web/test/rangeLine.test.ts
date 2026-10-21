import { fromIso } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import {
  formatDuration,
  ownRangeText,
  rangeButtonEmpty,
  rangeLine,
} from "../src/time/rangeLine.ts";

// Spec range-picker "Range line", "Range button" and timeseries-window "Own range of an unlinked
// window". Tests run with TZ=Europe/Berlin: CEST (UTC+2) until 2026-10-25 03:00 local, then CET
// (UTC+1). Expected texts are written by hand from the instants.

const NS_PER_MS = 1_000_000n;
const S = 1_000_000_000n;

describe("rangeLine", () => {
  it("formats a range on one day", () => {
    const line = rangeLine(fromIso("2026-10-13T13:06:03Z"), fromIso("2026-10-13T13:18:33Z"));
    expect(line.date).toBe("Tue 2026-10-13");
    expect(line.from).toBe("15:06:03");
    expect(line.to).toBe("15:18:33");
    expect(line.plusOne).toBe(false);
    expect(line.endDate).toBeUndefined();
    expect(line.text).toBe("Tue 2026-10-13 15:06:03 – 15:18:33");
    expect(line.duration).toBe("12 min 30 s");
    expect(line.short).toBe("12.5 min");
  });

  it("marks the next day, midnight and later days", () => {
    // Ends on the next local date: ⁺¹ after the end time.
    const next = rangeLine(fromIso("2026-10-20T21:30:00Z"), fromIso("2026-10-20T23:52:43Z"));
    expect(next.text).toBe("Tue 2026-10-20 23:30:00 – 01:52:43⁺¹");
    expect(next.plusOne).toBe(true);
    expect(next.to).toBe("01:52:43");
    expect(next.endDate).toBeUndefined();
    expect(next.duration).toBe("2 h 22 min");

    // A whole local day ends at the next midnight: 24:00:00, no ⁺¹.
    const whole = rangeLine(fromIso("2026-10-12T22:00:00Z"), fromIso("2026-10-13T22:00:00Z"));
    expect(whole.text).toBe("Tue 2026-10-13 00:00:00 – 24:00:00");
    expect(whole.plusOne).toBe(false);
    expect(whole.to).toBe("24:00:00");
    expect(whole.duration).toBe("1 d");

    // The end two dates later names its weekday and date.
    const later = rangeLine(fromIso("2026-10-13T13:06:03Z"), fromIso("2026-10-15T13:18:33Z"));
    expect(later.text).toBe("Tue 2026-10-13 15:06:03 – Thu 2026-10-15 15:18:33");
    expect(later.endDate).toBe("Thu 2026-10-15");
    expect(later.plusOne).toBe(false);
    expect(later.duration).toBe("2 d");

    // The DST day of 25 hours: local midnight to local midnight, from CEST to CET.
    const dst = rangeLine(fromIso("2026-10-24T22:00:00Z"), fromIso("2026-10-25T23:00:00Z"));
    expect(dst.text).toBe("Sun 2026-10-25 00:00:00 – 24:00:00");
    expect(dst.plusOne).toBe(false);
    expect(dst.duration).toBe("1 d 1 h");
  });

  it("shows milliseconds cut", () => {
    const ms = rangeLine(fromIso("2026-10-13T13:08:00.093Z"), fromIso("2026-10-13T13:08:00.995Z"));
    expect(ms.text).toBe("Tue 2026-10-13 15:08:00.093 – 15:08:00.995");
    expect(ms.from).toBe("15:08:00.093");
    expect(ms.to).toBe("15:08:00.995");
    expect(ms.duration).toBe("902 ms");

    // Nanoseconds are cut, never rounded: .999999999 shows .999; the end shows .000 because the
    // start has milliseconds.
    const cut = rangeLine(
      fromIso("2026-10-13T09:12:00.999999999Z"),
      fromIso("2026-10-13T09:13:00Z"),
    );
    expect(cut.text).toBe("Tue 2026-10-13 11:12:00.999 – 11:13:00.000");

    // Whole seconds on both ends show no milliseconds.
    const whole = rangeLine(fromIso("2026-10-13T13:08:00Z"), fromIso("2026-10-13T13:09:00Z"));
    expect(whole.text).toBe("Tue 2026-10-13 15:08:00 – 15:09:00");
  });
});

describe("formatDuration", () => {
  it("cuts parts and drops a zero lower part", () => {
    expect(formatDuration(902n * NS_PER_MS)).toBe("902 ms");
    expect(formatDuration(5n * S)).toBe("5 s");
    expect(formatDuration(1_500n * NS_PER_MS)).toBe("1.5 s");
    expect(formatDuration(1_234_999_999n)).toBe("1.234 s"); // cut, not rounded
    expect(formatDuration(90n * S)).toBe("1 min 30 s");
    expect(formatDuration(60n * S)).toBe("1 min");
    expect(formatDuration(3_600n * S)).toBe("1 h");
    expect(formatDuration((3_600n + 59n * 60n + 59n) * S)).toBe("1 h 59 min");
    expect(formatDuration((86_400n * 3n + 5n * 3_600n + 1_799n) * S)).toBe("3 d 5 h");
    expect(formatDuration(86_400n * S)).toBe("1 d");
  });
});

describe("range button states", () => {
  it("names the button state without a range", () => {
    expect(rangeButtonEmpty(true)).toBe("No time window");
    expect(rangeButtonEmpty(false)).toBe("…");
  });
});

describe("ownRangeText", () => {
  it("shows a window's own range only while unlinked", () => {
    const range = { from: fromIso("2026-10-13T13:06:03Z"), to: fromIso("2026-10-13T13:18:33Z") };
    expect(ownRangeText(range, false)).toBe("Tue 2026-10-13 15:06:03 – 15:18:33");
    expect(ownRangeText(range, true)).toBeUndefined();
  });
});
