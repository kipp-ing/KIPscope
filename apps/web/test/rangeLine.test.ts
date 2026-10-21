import { readFileSync } from "node:fs";
import { fromIso } from "@kipscope/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DurationTag } from "../src/time/Duration.tsx";
import {
  formatDuration,
  fullTime,
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
  const sd = (from: string, to: string) => startDuration(fromIso(from), fromIso(to));

  it("gives start and duration", () => {
    const first = sd("2026-10-13T13:06:03Z", "2026-10-13T13:18:33Z");
    expect(first.date).toBe("26-10-13");
    expect(first.time).toBe("15:06");
    expect(first.duration).toBe("0:12 h");
    expect(first.text).toBe("26-10-13 15:06  0:12 h"); // two spaces before the duration
    expect(first.full).toBe("Tue 2026-10-13 15:06");
    expect(first.durationTip).toBe("Duration 12 min");
    expect(first.tip).toBe("Tue 2026-10-13 15:06 \u00b7 Duration 12 min");
    // D-095: `detail` is gone, its readers take `full`, `durationTip` or `tip`.
    expect("detail" in first).toBe(false);

    // No end time, no next-day mark: the start is local, the duration is to - from.
    const second = sd("2026-10-20T21:30:00Z", "2026-10-20T23:52:43Z");
    expect(second.text).toBe("26-10-20 23:30  2:22 h");
    expect(second.durationTip).toBe("Duration 2 h 22 min");
    // A whole local day is 24:00 h long, the tooltip says 24 h (zero minutes left out).
    const day = sd("2026-10-12T22:00:00Z", "2026-10-13T22:00:00Z");
    expect(day.text).toBe("26-10-13 00:00  24:00 h");
    expect(day.durationTip).toBe("Duration 24 h");
    // The DST day of 25 hours (CEST to CET) reads 25:00 h.
    const long = sd("2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z");
    expect(long.text).toBe("26-10-25 00:00  25:00 h");
    expect(long.durationTip).toBe("Duration 25 h");
    // The 23 hour day of the spring change (2026-03-29, CET to CEST) reads 23:00 h.
    const short = sd("2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z");
    expect(short.text).toBe("26-03-29 00:00  23:00 h");
    expect(short.durationTip).toBe("Duration 23 h");
    // Exactly one minute still reads H:MM h.
    const minute = sd("2026-10-13T13:08:00Z", "2026-10-13T13:09:00Z");
    expect(minute.text).toBe("26-10-13 15:08  0:01 h");
    expect(minute.durationTip).toBe("Duration 1 min");
  });

  it("cuts to the second and below a minute", () => {
    // Below a minute: the start to the second, whole seconds cut, the unit `s`.
    const s41 = sd("2026-10-13T13:06:03Z", "2026-10-13T13:06:44.600Z");
    expect(s41.text).toBe("26-10-13 15:06:03  41 s");
    expect(s41.time).toBe("15:06:03");
    expect(s41.duration).toBe("41 s");
    expect(s41.durationTip).toBe("Duration 41 s");
    // `full` carries the seconds exactly while the range is under a minute.
    expect(s41.full).toBe("Tue 2026-10-13 15:06:03");

    // Nanoseconds are cut, never rounded: 59.000000001 s reads 59 s, the start 11:12:00.
    const cut = sd("2026-10-13T09:12:00.999999999Z", "2026-10-13T09:13:00Z");
    expect(cut.text).toBe("26-10-13 11:12:00  59 s");
    expect(cut.durationTip).toBe("Duration 59 s");

    // Below a second: milliseconds, the start still to the second.
    const ms = sd("2026-10-13T13:08:00.093Z", "2026-10-13T13:08:00.995Z");
    expect(ms.text).toBe("26-10-13 15:08:00  902 ms");
    expect(ms.duration).toBe("902 ms");
    expect(ms.durationTip).toBe("Duration 902 ms");
    expect(ms.full).toBe("Tue 2026-10-13 15:08:00");
    expect(ms.tip).toBe("Tue 2026-10-13 15:08:00 \u00b7 Duration 902 ms");
  });

  it("switches to days from 48 hours and words the tooltip", () => {
    // 47 h 59 min 30 s: still hours.
    const below = sd("2026-10-13T00:00:00Z", "2026-10-14T23:59:30Z");
    expect(below.text).toBe("26-10-13 02:00  47:59 h");
    expect(below.durationTip).toBe("Duration 47 h 59 min");
    // Exactly 48 h: days, with the zero hours kept in the text and left out of the words.
    const exact = sd("2026-10-13T00:00:00Z", "2026-10-15T00:00:00Z");
    expect(exact.text).toBe("26-10-13 02:00  2 d 0 h");
    expect(exact.durationTip).toBe("Duration 2 d");
    // 2 d 0 h 12 min 30 s: the text cuts the minutes, the words keep them.
    const minutes = sd("2026-10-13T13:06:03Z", "2026-10-15T13:18:33Z");
    expect(minutes.text).toBe("26-10-13 15:06  2 d 0 h");
    expect(minutes.durationTip).toBe("Duration 2 d 12 min");
    // 9 d 11 h 18 min 19 s.
    const long = sd("2026-10-11T12:34:24Z", "2026-10-20T23:52:43Z");
    expect(long.text).toBe("26-10-11 14:34  9 d 11 h");
    expect(long.durationTip).toBe("Duration 9 d 11 h 18 min");
    expect(long.full).toBe("Sun 2026-10-11 14:34");
  });

  it("renders the duration with its icon and tooltip", () => {
    const html = renderToStaticMarkup(
      createElement(DurationTag, { text: "0:12 h", title: "Duration 12 min" }),
    );
    expect(html).toMatch(/<svg[^>]*class="duration-icon"/);
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html.match(/<svg/g)).toHaveLength(1);
    expect(html).toContain("0:12 h");
    expect(html).toContain('title="Duration 12 min"');
    // The title is the caller's: the old fixed hint is gone.
    expect(html).not.toContain("Duration (h:mm)");
    expect(html).toContain('class="duration-tag"');
  });
});

describe("fullTime", () => {
  it("writes the full local time with its weekday", () => {
    const t = fromIso("2026-10-13T13:06:03.700Z");
    expect(fullTime(t, true)).toBe("Tue 2026-10-13 15:06:03"); // seconds cut, not rounded
    expect(fullTime(t, false)).toBe("Tue 2026-10-13 15:06");
    // Local date and weekday: 23:52:43Z on the 20th is 01:52:43 on Wednesday the 21st (CEST).
    expect(fullTime(fromIso("2026-10-20T23:52:43Z"), true)).toBe("Wed 2026-10-21 01:52:43");
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
  const range = { from: fromIso("2026-10-13T13:06:03Z"), to: fromIso("2026-10-13T13:18:33Z") };

  it("shows a window's own range only while unlinked", () => {
    const own = ownRangeText(range, false);
    expect(own?.text).toBe("26-10-13 15:06  0:12 h");
    expect(own?.tip).toBe("Tue 2026-10-13 15:06 \u00b7 Duration 12 min");
    expect(ownRangeText(range, true)).toBeUndefined();
  });

  it("puts the tip into the header's own-range tooltip", () => {
    // No DOM render helper exists for the header; its source is checked (as bar.test.ts does).
    const tsx = readFileSync(new URL("../src/chart/TimeseriesWindow.tsx", import.meta.url), "utf8");
    const span = tsx.match(/<span className="range own-range"[^>]*>/)?.[0] ?? "";
    expect(span).toContain("title={ownRange.tip}");
    expect(tsx).not.toContain("Time range shown");
    expect(tsx).not.toMatch(/ownRange\.detail/);
  });
});
