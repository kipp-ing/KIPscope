import { type BucketSeries, encodeTimes, type RawSeries } from "@kipscope/shared";
import uPlot from "uplot";
import { describe, expect, it } from "vitest";
import {
  buildModel,
  formatDuration,
  formatSnaShare,
  isolatedPoints,
  resolutionBadge,
  snaPeriods,
  snaShare,
  toPoints,
  yRange,
} from "../src/chart/build.ts";

const origin = 1_000_000_000_000n;

function raw(times: bigint[], v: (number | null)[], extra: Partial<RawSeries> = {}): RawSeries {
  return { kind: "raw", signalId: "c/s", from: "0", to: "1", t: encodeTimes(times), v, ...extra };
}

const buckets: BucketSeries = {
  kind: "buckets",
  signalId: "c/s",
  from: "0",
  to: "1",
  width: "1000",
  t: encodeTimes([origin, origin + 3000n]),
  count: [3, 5],
  sna: [0, 0],
  mean: [1, 2],
  min: [0, 1],
  max: [4, 9],
};

describe("toPoints", () => {
  it("adds edge neighbors so segments cross the window edges", () => {
    const r = raw([origin + 10n, origin + 20n], [1, 2], {
      before: { t: (origin - 5n).toString(), v: 0 },
      after: { t: (origin + 99n).toString(), v: 3 },
    });
    expect(toPoints(r, origin)).toEqual({ xs: [-5, 10, 20, 99], ys: [0, 1, 2, 3] });
  });

  it("draws through an empty window from the neighbors alone", () => {
    const r = raw([], [], {
      before: { t: (origin - 1000n).toString(), v: 1 },
      after: { t: (origin + 1000n).toString(), v: 2 },
    });
    expect(toPoints(r, origin)).toEqual({ xs: [-1000, 1000], ys: [1, 2] });
  });

  it("starts at the first point when there is no earlier one", () => {
    const r = raw([origin + 500n], [7], { after: { t: (origin + 600n).toString(), v: 8 } });
    const { xs } = toPoints(r, origin);
    expect(Math.min(...xs)).toBe(500);
  });

  it("keeps sub-microsecond offsets exact far from the epoch", () => {
    const o = 1_791_964_800_123_456_789n;
    const r = raw([o + 1n, o + 1_001n], [0, 1]);
    expect(toPoints(r, o).xs).toEqual([1, 1001]);
  });

  it("places bucket values at bucket centers with envelope edges", () => {
    expect(toPoints(buckets, origin)).toEqual({
      xs: [500, 3500],
      ys: [1, 2],
      min: [0, 1],
      max: [4, 9],
    });
  });
});

describe("buildModel", () => {
  const input = (key: string, result: RawSeries | BucketSeries, unit?: string) => ({
    key,
    label: key,
    color: "#000",
    result,
    ...(unit ? { unit } : {}),
  });

  it("uses the display mode for raw data and lines for aggregates", () => {
    const m = buildModel([input("a", raw([origin], [1])), input("b", buckets)], origin, {
      mode: "step",
      envelope: false,
    });
    expect(m.series.map((s) => s.path)).toEqual(["step", "line"]);
    expect(m.bands).toEqual([]);
  });

  it("adds envelope edges and a band only when enabled and aggregated", () => {
    const m = buildModel([input("a", raw([origin], [1])), input("b", buckets)], origin, {
      mode: "line",
      envelope: true,
    });
    expect(m.series.map((s) => s.label)).toEqual(["a", "b", "b max", "b min"]);
    expect(m.bands).toEqual([[3, 4]]);
    expect(m.tables[1]).toHaveLength(4);
  });

  it("groups y scales by unit", () => {
    const m = buildModel(
      [input("a", buckets, "rpm"), input("b", buckets, "rpm"), input("c", buckets)],
      origin,
      { mode: "line", envelope: false },
    );
    expect([...m.scales.entries()]).toEqual([
      ["u:rpm", "rpm"],
      ["s:c", "c"],
    ]);
  });

  it("skips signals without data", () => {
    const m = buildModel([{ key: "a", label: "a", color: "#000" }], origin, {
      mode: "line",
      envelope: false,
    });
    expect(m.series).toEqual([]);
  });
});

describe("labels", () => {
  it("summarizes resolution", () => {
    expect(formatDuration(4_803_200_000n)).toBe("4.8 s");
    expect(formatDuration(12n)).toBe("12 ns");
  });
});

describe("resolutionBadge", () => {
  const wide: BucketSeries = { ...buckets, width: "120000000000" }; // 2 min

  it("gives a short badge and the full resolution as tooltip", () => {
    expect(resolutionBadge([])).toBeUndefined();
    expect(resolutionBadge([undefined])).toBeUndefined();
    expect(resolutionBadge([raw([], [])])).toEqual({ short: "raw", full: "raw" });
    expect(resolutionBadge([wide, wide])).toEqual({
      short: "agg · 2 min",
      full: "aggregated · 2 min per point",
    });
    expect(resolutionBadge([wide, raw([], [])])).toEqual({
      short: "part · 2 min",
      full: "partly aggregated · 2 min per point",
    });
    // The widest bucket decides, and unloaded signals are ignored.
    expect(resolutionBadge([buckets, wide, undefined])).toEqual({
      short: "agg · 2 min",
      full: "aggregated · 2 min per point",
    });
  });
});

describe("yRange", () => {
  const model = buildModel(
    [
      {
        key: "a",
        label: "a",
        color: "#000",
        unit: "km/h",
        result: raw([origin - 100n, origin + 100n], [10, 30]),
      },
    ],
    origin,
    { mode: "line", envelope: false },
  );

  it("uses the neighbors outside a view that contains no point", () => {
    expect(yRange(model, "u:km/h", -10, 10)).toEqual([9, 31]);
  });

  it("is undefined for a view far from all points and for unknown scales", () => {
    expect(yRange(model, "u:other", -10, 10)).toBeUndefined();
  });

  it("pads a flat line", () => {
    const flat = buildModel(
      [{ key: "b", label: "b", color: "#000", result: raw([origin - 1n, origin + 1n], [0, 0]) }],
      origin,
      { mode: "line", envelope: false },
    );
    expect(yRange(flat, "s:b", 0, 0.5)).toEqual([-1, 1]);
  });

  it("includes envelope edges", () => {
    const m = buildModel([{ key: "c", label: "c", color: "#000", result: buckets }], origin, {
      mode: "line",
      envelope: true,
    });
    expect(yRange(m, "s:c", 0, 4000)).toEqual([-0.45, 9.45]);
  });
});

describe("SNA handling", () => {
  const at = (n: number) => origin + BigInt(n);
  const input = (key: string, result: RawSeries | BucketSeries, unit?: string) => ({
    key,
    label: key,
    color: key,
    result,
    ...(unit ? { unit } : {}),
  });
  const bucketsWith = (
    starts: number[],
    count: number[],
    sna: number[],
    stats: (number | null)[][] = [],
  ): BucketSeries => ({
    kind: "buckets",
    signalId: "c/s",
    from: "0",
    to: "1",
    width: "1000",
    t: encodeTimes(starts.map(at)),
    count,
    sna,
    mean: stats[0] ?? count.map((c) => (c ? 1 : null)),
    min: stats[1] ?? count.map((c) => (c ? 0 : null)),
    max: stats[2] ?? count.map((c) => (c ? 2 : null)),
  });

  it("keeps SNA as null and never spans it", () => {
    const r = raw([at(10), at(20), at(30)], [1, null, 3], {
      before: { t: at(0).toString(), v: null },
      after: { t: at(40).toString(), v: null },
    });
    expect(toPoints(r, origin)).toEqual({
      xs: [0, 10, 20, 30, 40],
      ys: [null, 1, null, 3, null],
    });
    const b = bucketsWith([0, 1000], [2, 0], [0, 3]);
    expect(toPoints(b, origin)).toEqual({
      xs: [500, 1500],
      ys: [1, null],
      min: [0, null],
      max: [2, null],
    });
  });

  it("holds the last valid value up to the SNA point in step mode", () => {
    // Valid 5 at 0, SNA at 100, valid 7 at 200: hold 5 until 100, SNA null moves to 101.
    const r = raw([at(0), at(100), at(200)], [5, null, 7]);
    const step = buildModel([input("a", r)], origin, { mode: "step", envelope: false });
    expect(step.tables[0]).toEqual([
      [0, 100, 101, 200],
      [5, 5, null, 7],
    ]);
    // Only the first SNA point after a valid one gets a hold point.
    const run = raw([at(0), at(100), at(200), at(300)], [5, null, null, 7]);
    const stepRun = buildModel([input("a", run)], origin, { mode: "step", envelope: false });
    expect(stepRun.tables[0]).toEqual([
      [0, 100, 101, 200, 300],
      [5, 5, null, null, 7],
    ]);
    // Line mode keeps the points as they are.
    const line = buildModel([input("a", r)], origin, { mode: "line", envelope: false });
    expect(line.tables[0]).toEqual([
      [0, 100, 200],
      [5, null, 7],
    ]);
  });

  it("breaks mean and envelope at all-SNA buckets", () => {
    const b = bucketsWith(
      [0, 1000, 2000],
      [3, 2, 0],
      [0, 1, 4],
      [
        [1, 2, null],
        [0, 1, null],
        [4, 9, null],
      ],
    );
    const m = buildModel([input("a", b)], origin, { mode: "line", envelope: true });
    expect(m.series.map((s) => s.label)).toEqual(["a", "a max", "a min"]);
    expect(m.tables[0]).toEqual([
      [500, 1500, 2500],
      [1, 2, null],
      [4, 9, null],
      [0, 1, null],
    ]);
  });

  it("joins several signals without spanning SNA", () => {
    // A is SNA from 100 to 300; B has points in between at 150, 250 and 350.
    const a = raw([at(0), at(100), at(200), at(300), at(400)], [1, null, null, 4, 5]);
    const b = raw([at(50), at(150), at(250), at(350)], [10, 20, 30, 40]);
    const m = buildModel([input("a", a), input("b", b)], origin, { mode: "line", envelope: false });
    const joined = uPlot.join(
      m.tables as uPlot.AlignedData[],
      m.tables.map((t) => t.map(() => 2)),
    );
    expect(joined[0]).toEqual([0, 50, 100, 150, 200, 250, 300, 350, 400]);
    // A: null (not undefined) wherever B's timestamps fall inside A's SNA period.
    expect(joined[1]).toEqual([1, null, null, null, null, null, 4, undefined, 5]);
    // B is untouched: its consecutive valid points still connect across A's timestamps.
    expect(joined[2]).toEqual([
      undefined,
      10,
      undefined,
      20,
      undefined,
      30,
      undefined,
      40,
      undefined,
    ]);
  });

  it("finds isolated valid points", () => {
    expect(isolatedPoints([null, 5, null])).toEqual([1]);
    expect(isolatedPoints([1, 2, 3])).toEqual([]);
    expect(isolatedPoints([1, null, 3])).toEqual([0, 2]);
    expect(isolatedPoints([1, 2, null])).toEqual([]);
    expect(isolatedPoints([5])).toEqual([]);
    expect(isolatedPoints([null, null])).toEqual([]);
    // undefined entries (join artifacts) are skipped when looking for neighbors.
    expect(isolatedPoints([null, undefined, 5, undefined, null])).toEqual([2]);
    expect(isolatedPoints([1, undefined, 2])).toEqual([]);
    expect(isolatedPoints([null, 5, undefined, 6, null])).toEqual([]);
    // Sna_800h.SPEED points 599..603: 99, SNA, 42, SNA, 3.
    expect(isolatedPoints([99, null, 42, null, 3])).toEqual([0, 2, 4]);
  });

  it("ignores SNA in the y range", () => {
    const m = buildModel(
      [
        input("a", raw([at(-100), at(0), at(100)], [10, null, 30]), "km/h"),
        input("b", raw([at(-100), at(100)], [null, null]), "bar"),
      ],
      origin,
      { mode: "line", envelope: false },
    );
    expect(yRange(m, "u:km/h", -200, 200)).toEqual([9, 31]);
    // Nothing but SNA: no range, instead of NaN or a range reaching down to 0.
    expect(yRange(m, "u:bar", -200, 200)).toBeUndefined();
    // Negative values: a null must not count as 0 (a flat line at -30 pads by 10 %).
    const neg = buildModel([input("c", raw([at(0), at(10)], [-30, null]))], origin, {
      mode: "line",
      envelope: false,
    });
    expect(yRange(neg, "s:c", -5, 20)).toEqual([-33, -27]);
  });

  it("draws nothing from an SNA neighbor", () => {
    const r = raw([], [], {
      before: { t: at(-1000).toString(), v: null },
      after: { t: at(1000).toString(), v: 2 },
    });
    expect(toPoints(r, origin)).toEqual({ xs: [-1000, 1000], ys: [null, 2] });
    const both = raw([], [], {
      before: { t: at(-1000).toString(), v: null },
      after: { t: at(1000).toString(), v: null },
    });
    const m = buildModel([input("a", both)], origin, { mode: "step", envelope: false });
    expect(m.tables[0]?.slice(1).every((col) => col.every((y) => y === null))).toBe(true);
    expect(yRange(m, "s:a", -10, 10)).toBeUndefined();
    // The SNA period is marked across the window.
    expect(snaPeriods(both, origin)).toEqual([[-1000, 1000]]);
  });

  it("derives SNA periods from raw points and neighbors", () => {
    // SNA at 100 and 200 touch and merge; the SNA at 400 ends at the next point (after: 500).
    const r = raw([at(0), at(100), at(200), at(300), at(400)], [1, null, null, 4, null], {
      after: { t: at(500).toString(), v: 2 },
    });
    expect(snaPeriods(r, origin)).toEqual([
      [100, 300],
      [400, 500],
    ]);
    // A last SNA point without successor still has a (zero-length) period.
    expect(snaPeriods(raw([at(0), at(100)], [1, null]), origin)).toEqual([[100, 100]]);
    // SNA neighbors: before at -50 ends at the first point, after at 300 has no successor.
    const edges = raw([at(0), at(200)], [1, 3], {
      before: { t: at(-50).toString(), v: null },
      after: { t: at(300).toString(), v: null },
    });
    expect(snaPeriods(edges, origin)).toEqual([
      [-50, 0],
      [300, 300],
    ]);
    expect(snaPeriods(raw([at(0), at(100)], [1, 2]), origin)).toEqual([]);
    // One lane per loaded signal, in input order, with the signal's color.
    const m = buildModel(
      [input("#a", r), { key: "x", label: "x", color: "#x" }, input("#b", raw([at(0)], [1]))],
      origin,
      { mode: "line", envelope: false },
    );
    expect(m.sna).toEqual([
      {
        color: "#a",
        periods: [
          [100, 300],
          [400, 500],
        ],
      },
      { color: "#b", periods: [] },
    ]);
  });

  it("derives SNA periods from buckets", () => {
    // Buckets with SNA: [1000, 2000), [2000, 3000) (touching, merged) and [5000, 6000).
    const b = bucketsWith([0, 1000, 2000, 5000], [5, 3, 0, 1], [0, 2, 1, 3]);
    expect(snaPeriods(b, origin)).toEqual([
      [1000, 3000],
      [5000, 6000],
    ]);
    expect(snaPeriods(buckets, origin)).toEqual([]);
  });

  it("computes the SNA share of raw and bucket results", () => {
    // Edge neighbors are not counted.
    const r = raw([at(0), at(1), at(2), at(3)], [1, null, 3, null], {
      before: { t: at(-1).toString(), v: null },
      after: { t: at(4).toString(), v: 5 },
    });
    expect(snaShare(r)).toBe(0.5);
    // Engine start window: V_ANZ 3 SNA of 20 points.
    const times = Array.from({ length: 20 }, (_, i) => at(i));
    const v = times.map((_, i) => (i === 8 || i === 9 || i === 10 ? null : 0));
    expect(snaShare(raw(times, v))).toBe(0.15);
    expect(snaShare(raw([at(0)], [1]))).toBe(0);
    expect(snaShare(raw([], []))).toBeUndefined();
    // Buckets: 5 SNA of 8 points.
    expect(snaShare(bucketsWith([0, 1000], [3, 0], [1, 4]))).toBe(0.625);
    expect(snaShare(buckets)).toBe(0);
    expect(snaShare(bucketsWith([], [], []))).toBeUndefined();
  });

  it("formats SNA shares without rounding to 0 or 100", () => {
    expect(formatSnaShare(undefined)).toBeUndefined();
    expect(formatSnaShare(0)).toBeUndefined();
    expect(formatSnaShare(0.00024)).toBe("SNA < 0.1 %");
    expect(formatSnaShare(0.0009999)).toBe("SNA < 0.1 %");
    expect(formatSnaShare(0.001)).toBe("SNA 0.1 %");
    expect(formatSnaShare(0.15)).toBe("SNA 15.0 %");
    expect(formatSnaShare(14 / 61)).toBe("SNA 23.0 %");
    expect(formatSnaShare(0.999)).toBe("SNA 99.9 %");
    expect(formatSnaShare(0.9995)).toBe("SNA > 99.9 %");
    expect(formatSnaShare(1)).toBe("SNA 100 %");
  });
});
