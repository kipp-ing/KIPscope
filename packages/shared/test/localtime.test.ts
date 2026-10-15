import { describe, expect, it } from "vitest";
import { formatLocal, parseDuration, parseTime } from "../src/localtime.ts";
import { fromIso, TIME_MAX, TIME_MIN } from "../src/time.ts";

// Tests run with TZ=Europe/Berlin (see package.json); October 2026 is CEST (+02:00), winter CET (+01:00).

describe("local time", () => {
  it("parses ns, ISO with zone and local wall time", () => {
    const expected = 1791896880093000000n;
    for (const text of [
      "1791896880093000000",
      "2026-10-13T13:08:00.093Z",
      "2026-10-13T15:08:00.093+02:00",
      "2026-10-13 15:08:00.093",
      "2026-10-13T15:08:00.093",
    ]) {
      expect(parseTime(text), text).toBe(expected);
    }
    expect(parseTime("2026-10-13 15:08:00.123456789")).toBe(1791896880123456789n);
    // Optional seconds and fraction; 1 to 9 fraction digits are read as a decimal fraction.
    expect(parseTime("2026-10-13 15:08")).toBe(1791896880000000000n);
    expect(parseTime("2026-10-13 15:08:00")).toBe(1791896880000000000n);
    expect(parseTime("2026-10-13 15:08:00.5")).toBe(1791896880500000000n);
    expect(parseTime("2026-10-13 15:08:00.000000001")).toBe(1791896880000000001n);
    // Negative decimal ns and the bounds themselves are fine.
    expect(parseTime("-5")).toBe(-5n);
    expect(parseTime(TIME_MIN.toString())).toBe(TIME_MIN);
    expect(parseTime(TIME_MAX.toString())).toBe(TIME_MAX);
    // 1900-01-01 01:00 in Berlin (CET) is the lower bound.
    expect(parseTime("1900-01-01 01:00:00")).toBe(TIME_MIN);
  });

  it("refuses ambiguous and nonexistent local times", () => {
    // The hour 02:00-03:00 on 2026-10-25 occurs twice; the message names both offsets.
    expect(() => parseTime("2026-10-25 02:30")).toThrow(RangeError);
    expect(() => parseTime("2026-10-25 02:30")).toThrow(/\+02:00/);
    expect(() => parseTime("2026-10-25 02:30")).toThrow(/\+01:00/);
    // The hour 02:00-03:00 on 2026-03-29 is skipped.
    expect(() => parseTime("2026-03-29 02:30")).toThrow(RangeError);
    expect(() => parseTime("2026-03-29 02:30")).toThrow(/does not exist/);
    expect(() => parseTime("2026-03-29 02:00:00")).toThrow(/does not exist/);
    // An explicit offset resolves the fold, both ways.
    expect(parseTime("2026-10-25 02:30+01:00")).toBe(fromIso("2026-10-25T01:30:00Z"));
    expect(parseTime("2026-10-25T02:30:00+02:00")).toBe(fromIso("2026-10-25T00:30:00Z"));
    // Edges around the changes are fine.
    expect(parseTime("2026-10-25 01:59:59")).toBe(fromIso("2026-10-24T23:59:59Z"));
    expect(parseTime("2026-10-25 03:00:00")).toBe(fromIso("2026-10-25T02:00:00Z"));
    expect(parseTime("2026-03-29 03:00:00")).toBe(fromIso("2026-03-29T01:00:00Z"));
    // Bad syntax and invalid dates.
    for (const bad of [
      "",
      "yesterday",
      "2026-10-13",
      "2026-10-13 15",
      "2026-02-30 10:00:00",
      "2026-10-13 25:00:00",
      "2026-10-13 15:08:00.1234567890",
      "2026-10-13 15:08:00.",
      "2026-10-13T15:08:00 Z",
      "1.5",
    ]) {
      expect(() => parseTime(bad), bad).toThrow(RangeError);
    }
    // Outside 1900 ... 2262 (before and after, decimal, ISO and local).
    expect(() => parseTime((TIME_MIN - 1n).toString())).toThrow(RangeError);
    expect(() => parseTime((TIME_MAX + 1n).toString())).toThrow(RangeError);
    expect(() => parseTime("1899-12-31T23:59:59Z")).toThrow(RangeError);
    expect(() => parseTime("2262-04-11T00:00:01Z")).toThrow(RangeError);
    expect(() => parseTime("2300-01-01 00:00:00")).toThrow(RangeError);
    expect(() => parseTime("1900-01-01 00:00:00")).toThrow(RangeError); // = 1899-12-31T23:00Z
  });

  it("round-trips local times with offset to the nanosecond", () => {
    // Hand-computed texts.
    expect(formatLocal(1791896881500000000n, { offset: true })).toBe(
      "2026-10-13 15:08:01.500+02:00",
    );
    expect(formatLocal(1791896881500000000n)).toBe("2026-10-13 15:08:01.500");
    expect(formatLocal(1791896880000000000n, { offset: true })).toBe("2026-10-13 15:08:00+02:00");
    expect(formatLocal(1791896880123456789n)).toBe("2026-10-13 15:08:00.123456789");
    expect(formatLocal(1791896880123456000n)).toBe("2026-10-13 15:08:00.123456");
    expect(formatLocal(1791896880000000001n)).toBe("2026-10-13 15:08:00.000000001");
    expect(formatLocal(TIME_MIN)).toBe("1900-01-01 01:00:00");
    // Both instants of the fold read 02:30 and differ only by the offset.
    const first = fromIso("2026-10-25T00:30:00Z");
    const second = fromIso("2026-10-25T01:30:00Z");
    expect(formatLocal(first, { offset: true })).toBe("2026-10-25 02:30:00+02:00");
    expect(formatLocal(second, { offset: true })).toBe("2026-10-25 02:30:00+01:00");
    expect(formatLocal(first)).toBe(formatLocal(second));

    const times = [
      0n,
      -1n,
      1791896880000000000n,
      1791896880500000000n,
      1791896880123000000n,
      1791896880123456000n,
      1791896880123456789n,
      1791896880000000001n,
      first,
      second,
      fromIso("2026-03-29T00:59:59.999999999Z"),
      fromIso("2026-03-29T01:00:00Z"),
      TIME_MIN,
      TIME_MIN + 1n,
      fromIso("1900-01-01T12:00:00.000000007Z"),
      fromIso("2262-04-10T12:00:00.123456789Z"),
      TIME_MAX,
    ];
    for (const t of times) {
      const text = formatLocal(t, { offset: true });
      expect(text, String(t)).toMatch(
        /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{3}|\.\d{6}|\.\d{9})?[+-]\d\d:\d\d$/,
      );
      expect(parseTime(text), text).toBe(t);
      // Without offset the text is the same minus the offset; never "Z".
      expect(formatLocal(t)).toBe(text.replace(/[+-]\d\d:\d\d$/, ""));
      expect(text).not.toContain("Z");
    }
  });

  it("parses durations exactly and refuses ambiguous units", () => {
    const good: [string, bigint][] = [
      ["+500ms", 500_000_000n],
      ["-1.5s", -1_500_000_000n],
      ["1.5us", 1500n],
      ["2µs", 2000n],
      ["1min", 60_000_000_000n],
      ["-2h", -7_200_000_000_000n],
      ["7ns", 7n],
      // Sign is optional; fractions without leading digit; exactness past double precision.
      ["500ms", 500_000_000n],
      [".5s", 500_000_000n],
      ["0.000000001s", 1n],
      ["1.000000001s", 1_000_000_001n],
      ["9007199254740993ns", 9_007_199_254_740_993n],
      ["0ns", 0n],
    ];
    for (const [text, ns] of good) expect(parseDuration(text), text).toBe(ns);
    for (const bad of [
      "500", // no unit
      "2m", // minutes or milliseconds?
      "0.5ns", // finer than 1 ns
      "1.0000000001s",
      "",
      "ms",
      "1 s",
      "1d",
      "--1s",
      "1.s",
      "1e3ms",
    ]) {
      expect(() => parseDuration(bad), bad).toThrow(RangeError);
    }
  });
});
