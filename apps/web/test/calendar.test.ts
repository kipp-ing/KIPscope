import { fromIso, NS_PER_S } from "@kipscope/shared";
import { describe, expect, it } from "vitest";
import { calendarTicks, labelWidth, tickStepForWidth } from "../src/time/axis.ts";

// Tests run with TZ=Europe/Berlin (see package.json); ticks are local month starts.

const HOUR = 3600n * NS_PER_S;

describe("calendarTicks", () => {
  it("labels the full 1900 … 2262 range with years 1950 … 2250 at 800 px", () => {
    const r = calendarTicks(fromIso("1900-01-01T00:00:00Z"), fromIso("2262-04-11T00:00:00Z"), 800);
    expect(r?.labels).toEqual(["1950", "2000", "2050", "2100", "2150", "2200", "2250"]);
    expect(r?.ticks).toHaveLength(7);
    // 2000-01-01 00:00 local (CET, UTC+1) = 1999-12-31T23:00Z
    expect(r?.ticks[1]).toBe(fromIso("1999-12-31T23:00:00Z"));
  });

  it("labels about three months with YYYY-MM at local month starts", () => {
    const r = calendarTicks(fromIso("2026-07-15T00:00:00Z"), fromIso("2026-10-15T00:00:00Z"), 800);
    expect(r?.labels).toEqual(["2026-08", "2026-09", "2026-10"]);
    // Local midnight in CEST (UTC+2).
    expect(r?.ticks).toEqual([
      fromIso("2026-07-31T22:00:00Z"),
      fromIso("2026-08-31T22:00:00Z"),
      fromIso("2026-09-30T22:00:00Z"),
    ]);
  });

  it("leaves short spans to the clock-based steps", () => {
    expect(
      calendarTicks(fromIso("2026-10-13T09:00:00Z"), fromIso("2026-10-14T09:00:00Z"), 800),
    ).toBeUndefined();
  });
});

describe("labelWidth and 2 h steps", () => {
  it("sizes an HH:MM label of a 2 h step at 48.5 px", () => {
    // 5 characters * 6.5 px + 16 px padding
    expect(labelWidth(2n * HOUR)).toBe(48.5);
  });

  it("picks 2 h for 24 h at 800 px without overlapping labels", () => {
    const from = fromIso("2026-10-13T00:00:00Z");
    const to = from + 24n * HOUR;
    expect(tickStepForWidth(from, to, 800)).toBe(2n * HOUR);
    // 13 ticks * 48.5 px = 630.5 px <= 800 px
    expect(13 * labelWidth(2n * HOUR)).toBeLessThanOrEqual(800);
    // 1 h would need 25 * 48.5 = 1212.5 px
    expect(25 * labelWidth(HOUR)).toBeGreaterThan(800);
  });

  it("falls back to 3 h at 600 px because 13 labels of 48.5 px do not fit", () => {
    const from = fromIso("2026-10-13T00:00:00Z");
    expect(tickStepForWidth(from, from + 24n * HOUR, 600)).toBe(3n * HOUR);
  });
});
