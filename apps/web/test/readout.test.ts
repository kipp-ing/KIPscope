import { type BucketSeries, encodeTimes, type RawSeries } from "@letsview/shared";
import { describe, expect, it } from "vitest";
import { chartValueAt, readoutCell, readoutDelta } from "../src/chart/readout.ts";

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

  it("takes the bucket mean in aggregated views, tagged avg", () => {
    const b = buckets([0, 1000, 2000], [10, 7, 5], [0, 0, 0], [20, 25.5, 30]);
    expect(chartValueAt(b, at(500), "line")).toEqual({ kind: "aggregated", value: 20 });
    // [start, start + width): the start belongs to the bucket, the last ns to the previous one.
    expect(chartValueAt(b, at(1000), "line")).toEqual({ kind: "aggregated", value: 25.5 });
    expect(chartValueAt(b, at(1000) - 1n, "line")).toEqual({ kind: "aggregated", value: 20 });
    expect(chartValueAt(b, at(2999), "step")).toEqual({ kind: "aggregated", value: 30 });
    // The tag is `avg` in the cell.
    expect(readoutCell(chartValueAt(b, at(1500), "line"), "km/h", 3)).toEqual({
      text: "25.5 km/h",
      tag: "avg",
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
  it("formats cells with unit, digits and tag", () => {
    expect(readoutCell({ kind: "raw", value: 23 }, "km/h", 3)).toEqual({ text: "23.0 km/h" });
    expect(readoutCell({ kind: "interpolated", value: 362.40000000000003 }, "V", 3)).toEqual({
      text: "362 V",
      tag: "lin",
    });
    expect(readoutCell({ kind: "interpolated", value: 362.40000000000003 }, "V", 4)).toEqual({
      text: "362.4 V",
      tag: "lin",
    });
    expect(readoutCell({ kind: "held", value: 23 }, "km/h", 3)).toEqual({
      text: "23.0 km/h",
      tag: "hold",
    });
  });

  it("computes Δ only from numbers and tags it avg > lin > hold", () => {
    const raw = (value: number) => ({ kind: "raw" as const, value });
    const lin = (value: number) => ({ kind: "interpolated" as const, value });
    const hold = (value: number) => ({ kind: "held" as const, value });
    const avg = (value: number) => ({ kind: "aggregated" as const, value });

    expect(readoutDelta(raw(23), raw(18), "km/h", 3)).toEqual({ text: "-5.00 km/h" });
    expect(readoutDelta(lin(362.40000000000003), lin(362.9), "V", 3)).toEqual({
      text: "500 mV",
      tag: "lin",
    });
    expect(readoutDelta(raw(1), hold(3), "km/h", 3)).toEqual({ text: "2.00 km/h", tag: "hold" });
    expect(readoutDelta(hold(1), lin(3), "km/h", 3).tag).toBe("lin");
    expect(readoutDelta(lin(1), raw(3), "km/h", 3).tag).toBe("lin");
    // avg beats lin and hold, on either side.
    expect(readoutDelta(avg(10), raw(15), "km/h", 3)).toEqual({ text: "5.00 km/h", tag: "avg" });
    expect(readoutDelta(lin(10), avg(15), "km/h", 3).tag).toBe("avg");
    expect(readoutDelta(hold(10), avg(15), "km/h", 3).tag).toBe("avg");
    expect(readoutDelta(raw(10), raw(10), "km/h", 3)).toEqual({ text: "0 km/h" });

    // Any non-number: "—" without tag.
    const none = { kind: "none" as const, reason: "outside_range" as const };
    for (const [a, b] of [
      [{ kind: "sna" as const }, raw(1)],
      [raw(1), { kind: "sna" as const }],
      [none, raw(1)],
      [raw(1), none],
      [undefined, raw(1)],
      [raw(1), undefined],
    ] as const) {
      const cell = readoutDelta(a, b, "km/h", 3);
      expect(cell.text).toBe("—");
      expect(cell.tag).toBeUndefined();
    }
  });
});
