import { readFileSync } from "node:fs";
import { fromIso } from "@kipscope/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DurationTag } from "../src/time/Duration.tsx";
import {
  formatDuration,
  ownRangeText,
  rangeButtonEmpty,
  startDuration,
} from "../src/time/rangeLine.ts";

// Spec range-picker "Start and duration texts", "Duration tag", "Range button" and timeseries-window "Own range of an unlinked
// window". Tests run with TZ=Europe/Berlin: CEST (UTC+2) until 2026-10-25 03:00 local, then CET
// (UTC+1). Expected texts are written by hand from the instants.

const NS_PER_MS = 1_000_000n;
const S = 1_000_000_000n;

describe("startDuration", () => {
  it("gives start and duration", () => {
    const first = startDuration(fromIso("2026-10-13T13:06:03Z"), fromIso("2026-10-13T13:18:33Z"));
    expect(first.date).toBe("26-10-13");
    expect(first.time).toBe("15:06");
    expect(first.duration).toBe("0:12");
    expect(first.text).toBe("26-10-13 15:06  0:12"); // two spaces before the duration
    expect(first.detail).toBe("26-10-13 15:06:03 · 12 min 30 s");

    // No end time, no next-day mark: the start is local, the duration is to - from.
    const text = (from: string, to: string) => startDuration(fromIso(from), fromIso(to)).text;
    expect(text("2026-10-20T21:30:00Z", "2026-10-20T23:52:43Z")).toBe("26-10-20 23:30  2:22");
    // A whole local day is 24:00 long.
    expect(text("2026-10-12T22:00:00Z", "2026-10-13T22:00:00Z")).toBe("26-10-13 00:00  24:00");
    expect(text("2026-10-13T13:06:03Z", "2026-10-15T13:18:33Z")).toBe("26-10-13 15:06  48:12");
    // Hours are unbounded: 9 d 11 h 18 min 19 s = 227 h 18 min.
    expect(text("2026-10-11T12:34:24Z", "2026-10-20T23:52:43Z")).toBe("26-10-11 14:34  227:18");
    // The DST day of 25 hours (CEST to CET) reads 25:00.
    expect(text("2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z")).toBe("26-10-25 00:00  25:00");
    // The 23 hour day of the spring change (2026-03-29, CET to CEST) reads 23:00.
    expect(text("2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z")).toBe("26-03-29 00:00  23:00");
  });

  it("cuts to the second and below a minute", () => {
    // Exactly one minute still reads H:MM.
    expect(
      startDuration(fromIso("2026-10-13T13:08:00Z"), fromIso("2026-10-13T13:09:00Z")).text,
    ).toBe("26-10-13 15:08  0:01");

    // Below a minute: the start to the second and whole seconds, cut.
    const s41 = startDuration(fromIso("2026-10-13T13:06:03Z"), fromIso("2026-10-13T13:06:44.600Z"));
    expect(s41.text).toBe("26-10-13 15:06:03  41 s");
    expect(s41.time).toBe("15:06:03");
    expect(s41.duration).toBe("41 s");

    // Nanoseconds are cut, never rounded: 59.000000001 s reads 59 s, the start 11:12:00.
    const cut = startDuration(
      fromIso("2026-10-13T09:12:00.999999999Z"),
      fromIso("2026-10-13T09:13:00Z"),
    );
    expect(cut.text).toBe("26-10-13 11:12:00  59 s");

    // Below a second: milliseconds, the start still to the second.
    const ms = startDuration(
      fromIso("2026-10-13T13:08:00.093Z"),
      fromIso("2026-10-13T13:08:00.995Z"),
    );
    expect(ms.text).toBe("26-10-13 15:08:00  902 ms");
    expect(ms.duration).toBe("902 ms");
    expect(ms.detail).toBe("26-10-13 15:08:00 · 902 ms");
  });

  it("renders the duration with its icon and tooltip", () => {
    const html = renderToStaticMarkup(createElement(DurationTag, { text: "0:12" }));
    expect(html).toMatch(/<svg[^>]*class="duration-icon"/);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toContain("0:12");
    expect(html).toContain('title="Duration (h:mm)"');
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
    expect(ownRangeText(range, false)?.text).toBe("26-10-13 15:06  0:12");
    expect(ownRangeText(range, true)).toBeUndefined();
  });
});

describe("own-range tooltip (round 2)", () => {
  it("is ownRangeText(...).detail itself, without a 'Time range shown' prefix", () => {
    const range = { from: fromIso("2026-10-13T13:06:03Z"), to: fromIso("2026-10-13T13:18:33Z") };
    const own = ownRangeText(range, false);
    expect(own?.detail.startsWith("Time range shown")).toBe(false);
    // No header render helper exists; the title source is checked instead (a grep-style check).
    const tsx = readFileSync(new URL("../src/chart/TimeseriesWindow.tsx", import.meta.url), "utf8");
    const span = tsx.match(/<span className="range own-range"[^>]*>/)?.[0] ?? "";
    expect(span).toContain("title={ownRange.detail}");
    expect(tsx).not.toContain("Time range shown");
    expect(tsx).not.toMatch(/HINTS\.range\(/);
  });
});
