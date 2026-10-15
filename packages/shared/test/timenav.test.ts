import { describe, expect, it } from "vitest";
import { TIME_MAX, TIME_MIN } from "../src/time.ts";
import {
  MIN_SPAN_NS,
  navAnchor,
  panBy,
  resolveTimeNav,
  spanAround,
  zoomAround,
} from "../src/timenav.ts";

/** UTC ISO text (ms precision) to ns, computed independently of the code under test. */
const ns = (iso: string): bigint => BigInt(Date.parse(iso)) * 1_000_000n;
const r = (from: string, to: string) => ({ from: ns(from), to: ns(to) });

// 2026-10-13 15:08:00 – 15:09:00 Europe/Berlin (CEST, UTC+2)
const VIEW = r("2026-10-13T13:08:00Z", "2026-10-13T13:09:00Z");
const A = ns("2026-10-13T13:08:00.093Z");
const B = ns("2026-10-13T13:08:00.995Z");

describe("timenav (improve-navigation, D-027)", () => {
  it("resolves every input form", () => {
    const ctx = { view: VIEW, cursors: { a: A, b: B } };
    expect(resolveTimeNav("15:07:15 +60s", ctx)).toEqual(
      r("2026-10-13T13:07:15Z", "2026-10-13T13:08:15Z"),
    );
    expect(resolveTimeNav("15:08 ±30s", ctx)).toEqual(
      r("2026-10-13T13:07:30Z", "2026-10-13T13:08:30Z"),
    );
    expect(resolveTimeNav("15:07 .. 15:09", ctx)).toEqual(
      r("2026-10-13T13:07:00Z", "2026-10-13T13:09:00Z"),
    );
    expect(resolveTimeNav("a..b", ctx)).toEqual({ from: A, to: B });
    expect(resolveTimeNav("2026-10-13", ctx)).toEqual(
      r("2026-10-12T22:00:00Z", "2026-10-13T22:00:00Z"),
    );
    // A lies in the view, so a bare duration centres on A.
    expect(resolveTimeNav("1h", ctx)).toEqual(
      r("2026-10-13T12:38:00.093Z", "2026-10-13T13:38:00.093Z"),
    );
    expect(resolveTimeNav("+10min", ctx)).toEqual(
      r("2026-10-13T13:18:00Z", "2026-10-13T13:19:00Z"),
    );
    // Periods named by the last digit.
    expect(resolveTimeNav("15:08", ctx)).toEqual(r("2026-10-13T13:08:00Z", "2026-10-13T13:09:00Z"));
    expect(resolveTimeNav("15:08:30", ctx)).toEqual(
      r("2026-10-13T13:08:30Z", "2026-10-13T13:08:31Z"),
    );
    expect(resolveTimeNav("15:08:30.5", ctx)).toEqual(
      r("2026-10-13T13:08:30.500Z", "2026-10-13T13:08:30.600Z"),
    );
    // `a` centres the current 60 s span on cursor A.
    expect(resolveTimeNav("a", ctx)).toEqual(
      r("2026-10-13T13:07:30.093Z", "2026-10-13T13:08:30.093Z"),
    );
    // `d` = 24 h; with A off the bare duration centres on the view centre (15:08:30 local,
    // 13:08:30Z), like `1h` centres on A. NOTE: the spec scenario "One day around the view" lists
    // 2026-10-12 15:08:30 – 2026-10-13 15:08:30, which ends at the centre instead of being
    // centred on it; it contradicts S2 spanAround and the `1h` case, so the centred range is pinned.
    expect(resolveTimeNav("1d", { view: VIEW, cursors: {} })).toEqual(
      r("2026-10-13T01:08:30Z", "2026-10-14T01:08:30Z"),
    );
    // An ISO instant with zone, and an ISO range.
    expect(resolveTimeNav("2026-10-13T13:08:00Z +1s", ctx)).toEqual(
      r("2026-10-13T13:08:00Z", "2026-10-13T13:08:01Z"),
    );
  });

  it("accepts the header's own range text", () => {
    const ctx = { view: VIEW, cursors: {} };
    expect(resolveTimeNav("2026-10-13 15:08:00 – 2026-10-13 15:08:03", ctx)).toEqual(
      r("2026-10-13T13:08:00Z", "2026-10-13T13:08:03Z"),
    );
    expect(resolveTimeNav("2026-10-11 14:34:24.824 – 2026-10-13 15:17:33.221", ctx)).toEqual(
      r("2026-10-11T12:34:24.824Z", "2026-10-13T13:17:33.221Z"),
    );
  });

  it("takes the latest occurrence of a time of day inside the view", () => {
    const extent = r("2026-10-11T12:34:24.824Z", "2026-10-13T13:17:33.221Z");
    expect(resolveTimeNav("15:08", { view: extent, cursors: {} })).toEqual(
      r("2026-10-13T13:08:00Z", "2026-10-13T13:09:00Z"),
    );
    // Not inside the view: the occurrence nearest the view's centre (10:30 local).
    const morning = r("2026-10-12T08:00:00Z", "2026-10-12T09:00:00Z");
    expect(resolveTimeNav("15:08", { view: morning, cursors: {} })).toEqual(
      r("2026-10-12T13:08:00Z", "2026-10-12T13:09:00Z"),
    );
    // The end of a range is the first occurrence after its start.
    const evening = r("2026-10-12T18:00:00Z", "2026-10-12T19:00:00Z");
    expect(resolveTimeNav("23:00 .. 01:00", { view: evening, cursors: {} })).toEqual(
      r("2026-10-12T21:00:00Z", "2026-10-12T23:00:00Z"),
    );
  });

  it("refuses invalid, reversed, ambiguous and cursor-off input", () => {
    const ctx = { view: VIEW, cursors: {} };
    expect(() => resolveTimeNav("25:00", ctx)).toThrow(RangeError);
    expect(() => resolveTimeNav("25:00", ctx)).toThrow(/invalid/i);
    expect(() => resolveTimeNav("not a time", ctx)).toThrow(RangeError);
    expect(() => resolveTimeNav("", ctx)).toThrow(RangeError);
    expect(() => resolveTimeNav("2026-10-13 15:09 .. 2026-10-13 15:08", ctx)).toThrow(/revers/i);
    expect(() => resolveTimeNav("2026-10-13 15:08 .. 2026-10-13 15:08", ctx)).toThrow(RangeError);
    // DST end 2026-10-25: 02:30 happens twice; the message names both offsets.
    expect(() => resolveTimeNav("2026-10-25 02:30", ctx)).toThrow(/\+02:00 or \+01:00/);
    expect(() => resolveTimeNav("a", ctx)).toThrow(/cursor A is off/);
    expect(() => resolveTimeNav("b", { view: VIEW, cursors: { a: A } })).toThrow(/cursor B is off/);
    // Span below 100 ns.
    expect(() => resolveTimeNav("15:08:00 +50ns", ctx)).toThrow(RangeError);
  });

  it("zooms around the anchor and pans by fractions of the span", () => {
    const v4 = r("2026-10-13T13:08:00Z", "2026-10-13T13:08:04Z");
    // Anchor: A if inside [from, to), else the centre.
    expect(navAnchor(v4, ns("2026-10-13T13:08:01Z"))).toBe(ns("2026-10-13T13:08:01Z"));
    expect(navAnchor(v4, undefined)).toBe(ns("2026-10-13T13:08:02Z"));
    expect(navAnchor(v4, v4.to)).toBe(ns("2026-10-13T13:08:02Z"));
    expect(navAnchor(v4, v4.from - 1n)).toBe(ns("2026-10-13T13:08:02Z"));

    // Zoom in around A: A stays a quarter into the plot.
    expect(zoomAround(v4, 0.5, ns("2026-10-13T13:08:01Z"))).toEqual(
      r("2026-10-13T13:08:00.500Z", "2026-10-13T13:08:02.500Z"),
    );

    // Keys on a 4 s view with A off: +, -, →, Shift+←.
    const centre = navAnchor(v4, undefined);
    const k1 = zoomAround(v4, 0.5, centre);
    expect(k1).toEqual(r("2026-10-13T13:08:01Z", "2026-10-13T13:08:03Z"));
    const k2 = zoomAround(k1, 2, navAnchor(k1, undefined));
    expect(k2).toEqual(r("2026-10-13T13:08:00Z", "2026-10-13T13:08:04Z"));
    const k3 = panBy(k2, 0.5);
    expect(k3).toEqual(r("2026-10-13T13:08:02Z", "2026-10-13T13:08:06Z"));
    const k4 = panBy(k3, -1);
    expect(k4).toEqual(r("2026-10-13T13:07:58Z", "2026-10-13T13:08:02Z"));

    // Spans around an anchor (presets).
    expect(spanAround(60_000_000_000n, ns("2026-10-13T13:08:30Z"))).toEqual(
      r("2026-10-13T13:08:00Z", "2026-10-13T13:09:00Z"),
    );
    expect(MIN_SPAN_NS).toBe(100n);

    // Clamped into the bounds.
    const late = { from: TIME_MAX - 1_000_000_000n, to: TIME_MAX };
    const panned = panBy(late, 5);
    expect(panned.to <= TIME_MAX && panned.from >= TIME_MIN && panned.from < panned.to).toBe(true);
    const early = spanAround(2n * 86_400_000_000_000n, TIME_MIN);
    expect(early.from >= TIME_MIN && early.to <= TIME_MAX && early.from < early.to).toBe(true);
  });
});
