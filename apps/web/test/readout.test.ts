import { type BucketSeries, encodeTimes, type RawSeries } from "@letsview/shared";
import { describe, expect, it } from "vitest";
import { snapCursorTime } from "../src/chart/cursors.ts";
import {
  chartValueAt,
  readoutCell,
  readoutDelta,
  readoutSource,
  sourceCell,
  sourceDelta,
} from "../src/chart/readout.ts";
import { LOADING } from "../src/values/format.ts";

// 2026-10-13T13:08:00Z in ns; everything below is an offset from it.
const T0 = 1_791_896_880_000_000_000n;
const ms = (n: number) => BigInt(Math.round(n * 1_000_000));
const at = (offsetMs: number) => T0 + ms(offsetMs);

/** V_ANZ-like raw window 13:08:00 – 13:08:03: 23 at .093 s, 22 at .194 s, 18 at .995 s. */
function rawSeries(extra: Partial<RawSeries> = {}, omit: ("before" | "after")[] = []): RawSeries {
  const series: RawSeries = {
    kind: "raw",
    signalId: "c/V_ANZ",
    from: T0.toString(),
    to: at(3000).toString(),
    t: encodeTimes([at(93), at(194), at(995)]),
    v: [23, 22, 18],
    before: { t: at(-93).toString(), v: 25 },
    after: { t: at(3005).toString(), v: 17 },
    ...extra,
  };
  for (const key of omit) delete series[key];
  return series;
}

/** Buckets of 1 s on the grid; t = bucket starts, empty buckets omitted. */
function buckets(
  starts: number[],
  count: number[],
  sna: number[],
  mean: (number | null)[],
): BucketSeries {
  return {
    kind: "buckets",
    signalId: "c/V_ANZ",
    from: T0.toString(),
    to: at(3000).toString(),
    width: "1000000000",
    t: encodeTimes(starts.map(at)),
    count,
    sna,
    mean,
    min: mean,
    max: mean,
  };
}

describe("chartValueAt", () => {
  it("evaluates raw results like evaluateAt, with edge neighbours", () => {
    const r = rawSeries();
    // A point exactly at t.
    expect(chartValueAt(r, at(93), "line")).toEqual({ kind: "raw", value: 23 });
    expect(chartValueAt(r, at(995), "step")).toEqual({ kind: "raw", value: 18 });
    // Between 23 at .093 and 22 at .194: halfway is 22.5 (line, markers), held 23 (step).
    const line = chartValueAt(r, at(143.5), "line");
    expect(line).toMatchObject({ kind: "interpolated" });
    expect((line as { value: number }).value).toBeCloseTo(22.5, 9);
    const markers = chartValueAt(r, at(143.5), "markers");
    expect(markers).toMatchObject({ kind: "interpolated" });
    expect((markers as { value: number }).value).toBeCloseTo(22.5, 9);
    expect(chartValueAt(r, at(143.5), "step")).toEqual({ kind: "held", value: 23 });
    // At the left edge the point before the range is the neighbour: 25 at -93 ms, 23 at +93 ms.
    const left = chartValueAt(r, T0, "line");
    expect(left).toMatchObject({ kind: "interpolated" });
    expect((left as { value: number }).value).toBeCloseTo(24, 9);
    // At the right edge the point after the range is: 18 at .995 s, 17 at 3.005 s, t = 2 s.
    const right = chartValueAt(r, at(2000), "line");
    expect((right as { value: number }).value).toBeCloseTo(17.5, 9);
    expect(chartValueAt(r, at(2000), "step")).toEqual({ kind: "held", value: 18 });
    // No point before: before_first; none after: after_last; no points at all: no_data.
    expect(chartValueAt(rawSeries({}, ["before"]), T0, "line")).toEqual({
      kind: "none",
      reason: "before_first",
    });
    expect(chartValueAt(rawSeries({}, ["after"]), at(2000), "line")).toEqual({
      kind: "none",
      reason: "after_last",
    });
    expect(
      chartValueAt(rawSeries({ t: encodeTimes([]), v: [] }, ["before", "after"]), at(1000), "line"),
    ).toEqual({ kind: "none", reason: "no_data" });
    // SNA point at or before t: SNA (D-010); an SNA neighbour in line mode: next_sna.
    expect(chartValueAt(rawSeries({ v: [23, null, 18] }), at(194), "line")).toEqual({
      kind: "sna",
    });
    expect(chartValueAt(rawSeries({ v: [23, null, 18] }), at(500), "line")).toEqual({
      kind: "sna",
    });
    expect(chartValueAt(rawSeries({ v: [23, 22, null] }), at(500), "line")).toEqual({
      kind: "none",
      reason: "next_sna",
    });
    // Nothing loaded yet.
    expect(chartValueAt(undefined, at(93), "line")).toBeUndefined();
  });

  it("takes the bucket mean in aggregated views, marked avg", () => {
    const b = buckets([0, 1000, 2000], [10, 7, 5], [0, 0, 0], [20, 25.5, 30]);
    expect(chartValueAt(b, at(500), "line")).toEqual({ kind: "aggregated", value: 20 });
    // [start, start + width): the start belongs to the bucket, the last ns to the previous one.
    expect(chartValueAt(b, at(1000), "line")).toEqual({ kind: "aggregated", value: 25.5 });
    expect(chartValueAt(b, at(1000) - 1n, "line")).toEqual({ kind: "aggregated", value: 20 });
    expect(chartValueAt(b, at(2999), "step")).toEqual({ kind: "aggregated", value: 30 });
    // The kind `avg` is the cell's tooltip.
    expect(readoutCell(chartValueAt(b, at(1500), "line"), "km/h", 3)).toEqual({
      text: "25.5",
      title: "bucket mean (avg)",
    });
  });

  it("reads SNA, empty buckets and cursors outside the range without a number", () => {
    // Middle bucket has SNA points only (mean null), the one at 2 s is missing.
    const b = buckets([0, 1000], [10, 0], [0, 4], [20, null]);
    expect(chartValueAt(b, at(1500), "line")).toEqual({ kind: "sna" });
    expect(chartValueAt(b, at(2500), "line")).toEqual({ kind: "none", reason: "empty_bucket" });
    // Outside [from, to): before the range, and at `to` itself.
    expect(chartValueAt(b, T0 - 1n, "line")).toEqual({ kind: "none", reason: "outside_range" });
    expect(chartValueAt(b, at(3000), "line")).toEqual({ kind: "none", reason: "outside_range" });
    expect(chartValueAt(rawSeries(), at(3000), "line")).toEqual({
      kind: "none",
      reason: "outside_range",
    });
    expect(chartValueAt(rawSeries(), at(-1), "line")).toEqual({
      kind: "none",
      reason: "outside_range",
    });

    // Cells: SNA reads SNA, no value reads — with the reason as tooltip.
    expect(readoutCell({ kind: "sna" }, "km/h", 3)).toMatchObject({ text: "SNA", sna: true });
    expect(readoutCell({ kind: "none", reason: "empty_bucket" }, "km/h", 3)).toMatchObject({
      text: "—",
      title: "no points in this bucket",
    });
    expect(readoutCell({ kind: "none", reason: "outside_range" }, "km/h", 3)).toMatchObject({
      text: "—",
      title: "outside this window's range",
    });
    expect(readoutCell({ kind: "none", reason: "after_last" }, "km/h", 3)).toMatchObject({
      text: "—",
      title: "after the last point",
    });
  });
});

describe("readout cells", () => {
  it("formats cells without unit, with SI prefix and digits, the kind as tooltip", () => {
    expect(readoutCell({ kind: "raw", value: 23 }, "km/h", 3)).toEqual({ text: "23.0" });
    expect(readoutCell({ kind: "interpolated", value: 362.40000000000003 }, "V", 3)).toEqual({
      text: "362",
      title: "linear between points (lin)",
    });
    expect(readoutCell({ kind: "interpolated", value: 362.40000000000003 }, "V", 4)).toEqual({
      text: "362.4",
      title: "linear between points (lin)",
    });
    expect(readoutCell({ kind: "held", value: 23 }, "km/h", 3)).toEqual({
      text: "23.0",
      title: "held from the last point (hold)",
    });
    // The prefix stays: the legend row's [1/min] names the unit.
    expect(readoutCell({ kind: "raw", value: 13970 }, "1/min", 3)).toEqual({ text: "14.0 k" });
  });

  it("computes Δ only from numbers and marks it avg > lin > hold", () => {
    const raw = (value: number) => ({ kind: "raw" as const, value });
    const lin = (value: number) => ({ kind: "interpolated" as const, value });
    const hold = (value: number) => ({ kind: "held" as const, value });
    const avg = (value: number) => ({ kind: "aggregated" as const, value });

    const LIN = "linear between points (lin)";
    const HOLD = "held from the last point (hold)";
    const AVG = "bucket mean (avg)";
    expect(readoutDelta(raw(23), raw(18), "km/h", 3)).toEqual({ text: "-5.00" });
    expect(readoutDelta(lin(362.40000000000003), lin(362.9), "V", 3)).toEqual({
      text: "500 m",
      title: LIN,
    });
    expect(readoutDelta(raw(1), hold(3), "km/h", 3)).toEqual({ text: "2.00", title: HOLD });
    expect(readoutDelta(hold(1), lin(3), "km/h", 3).title).toBe(LIN);
    expect(readoutDelta(lin(1), raw(3), "km/h", 3).title).toBe(LIN);
    // avg beats lin and hold, on either side.
    expect(readoutDelta(avg(10), raw(15), "km/h", 3)).toEqual({ text: "5.00", title: AVG });
    expect(readoutDelta(lin(10), avg(15), "km/h", 3).title).toBe(AVG);
    expect(readoutDelta(hold(10), avg(15), "km/h", 3).title).toBe(AVG);
    expect(readoutDelta(raw(10), raw(10), "km/h", 3)).toEqual({ text: "0" });

    // Any non-number: "—" without kind.
    const none = { kind: "none" as const, reason: "outside_range" as const };
    for (const [a, b] of [
      [{ kind: "sna" as const }, raw(1)],
      [raw(1), { kind: "sna" as const }],
      [none, raw(1)],
      [raw(1), none],
    ] as const) {
      const cell = readoutDelta(a, b, "km/h", 3);
      expect(cell.text).toBe("—");
      expect(cell.tag).toBeUndefined();
      expect(cell.title).toBeUndefined();
    }
  });

  it("shows the loading state in Δ while a value is not loaded, like the A and B cells", () => {
    const loading = { text: LOADING, loading: true, title: "loading" };
    expect(readoutDelta(undefined, { kind: "raw", value: 1 }, "km/h", 3)).toEqual(loading);
    expect(readoutDelta({ kind: "raw", value: 1 }, undefined, "km/h", 3)).toEqual(loading);
    expect(readoutDelta(undefined, undefined, "km/h", 3)).toEqual(loading);
    expect(readoutCell(undefined, "km/h", 3)).toEqual(loading);
  });
});

describe("cursor at the range end", () => {
  it("a B cursor placed at the right edge snaps inside the range and reads a value", () => {
    const to = at(3000);
    const series = rawSeries();
    // Placed 100 ns before `to` on a 3 s view (1 ms grid): snapping alone would land on `to`.
    const raw = to - 100n;
    expect(snapCursorTime(raw, 3_000_000_000n)).toBe(to);
    const snapped = snapCursorTime(raw, 3_000_000_000n, { from: T0, to });
    expect(snapped).toBe(to - 1_000_000n);
    // The flag and the cell agree: a value (interpolated toward the point after), not "—".
    const v = chartValueAt(series, snapped, "line");
    expect(v?.kind).toBe("interpolated");
    expect(chartValueAt(series, to, "line")).toEqual({ kind: "none", reason: "outside_range" });
  });
});

describe("readout source (D-031)", () => {
  const exact = (status: "loading" | "complete" | "error", value?: number) => ({
    status,
    request: "r",
    ...(value === undefined
      ? {}
      : {
          result: {
            signalId: "c/V",
            t: "1",
            mode: "line" as const,
            value: { kind: "raw" as const, value },
          },
        }),
    ...(status === "error" ? { error: "boom" } : {}),
  });
  const avg = { kind: "aggregated" as const, value: 20 };
  const outside = { kind: "none" as const, reason: "outside_range" as const };

  it("shows the exact server value, inside or outside the zoom", () => {
    expect(readoutSource(exact("complete", 23), avg, false)).toEqual({
      value: { kind: "raw", value: 23 },
      loading: false,
    });
    expect(readoutSource(exact("complete", 23), outside, false).value).toEqual({
      kind: "raw",
      value: 23,
    });
    expect(sourceCell(readoutSource(exact("complete", 23), outside, false), "km/h", 3)).toEqual({
      text: "23.0",
    });
  });

  it("shows the drawn value, dimmed, while the exact one loads; outside the zoom the previous one", () => {
    expect(readoutSource(exact("loading"), avg, false)).toEqual({ value: avg, loading: true });
    expect(readoutSource(exact("loading", 18), outside, false)).toEqual({
      value: { kind: "raw", value: 18 },
      loading: true,
    });
    expect(sourceCell(readoutSource(exact("loading"), outside, false), "km/h", 3).text).toBe("…");
  });

  it("follows the drawn curve live while a line is dragged", () => {
    expect(readoutSource(exact("complete", 23), avg, true)).toEqual({ value: avg, loading: false });
  });

  it("shows a failed request as — with the message, and Δ as —", () => {
    const failed = readoutSource(exact("error"), avg, false);
    expect(sourceCell(failed, "V", 3)).toEqual({ text: "—", title: "failed: boom" });
    const ok = readoutSource(exact("complete", 1), avg, false);
    expect(sourceDelta(ok, failed, "V", 3)).toEqual({ text: "—" });
    expect(sourceDelta(ok, readoutSource(exact("complete", 3), avg, false), "V", 3)).toEqual({
      text: "2.00",
    });
    expect(sourceDelta(ok, readoutSource(exact("loading"), avg, false), "V", 3).loading).toBe(true);
  });
});
