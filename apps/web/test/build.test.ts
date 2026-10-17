import {
  type BucketSeries,
  encodeTimes,
  type RawSeries,
  type SignalGaps,
  type SignalInfo,
} from "@kipscope/shared";
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
  stateLevel,
  stateLevels,
  toPoints,
  yRange,
} from "../src/chart/build.ts";
import { chartValueAt } from "../src/chart/readout.ts";
import { runRequest, splitRun, stitch } from "../src/chart/tiles.ts";
import { fakeAnswer, fakeRaw } from "./fakeSeries.ts";

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

describe("state levels of a diag enum (open=0, precharge=1, closed=2)", () => {
  const rows = [
    { low: 0, high: 0, text: "open" },
    { low: 1, high: 1, text: "precharge" },
    { low: 2, high: 2, text: "closed" },
  ];
  const info = { states: "text", diag: { states: rows } } as unknown as SignalInfo;

  it("stateLevels reads the rows of a text signal only", () => {
    expect(stateLevels(info)).toBe(rows);
    expect(stateLevels({ ...info, states: "labels" } as unknown as SignalInfo)).toBeUndefined();
    expect(stateLevels(undefined)).toBeUndefined();
  });

  it("stateLevel maps row text to its code, else keeps the stored value", () => {
    expect(stateLevel(rows, 0, "open")).toBe(0);
    expect(stateLevel(rows, 0, "precharge")).toBe(1);
    expect(stateLevel(rows, 0, "closed")).toBe(2);
    expect(stateLevel(rows, 7, "unknown")).toBe(7);
    expect(stateLevel(rows, 7, undefined)).toBe(7);
    expect(stateLevel(undefined, 0, "closed")).toBe(0);
  });

  it("toPoints draws points and edges at their level; SNA stays null", () => {
    const r = raw([origin + 10n, origin + 20n, origin + 30n], [0, null, 0], {
      text: ["precharge", "", "closed"],
      before: { t: (origin - 5n).toString(), v: 0, label: "open" },
      after: { t: (origin + 99n).toString(), v: 0, label: "closed" },
    });
    expect(toPoints(r, origin, rows).ys).toEqual([0, 1, null, 2, 2]);
    // Without states the stored 0 is drawn.
    expect(toPoints(r, origin).ys).toEqual([0, 0, null, 0, 0]);
  });

  it("a flat enum series is drawn at its level and has a y range", () => {
    const r = raw([origin + 10n, origin + 20n], [0, 0], { text: ["closed", "closed"] });
    const m = buildModel(
      [{ key: "a", label: "a", color: "#000", result: r, states: rows }],
      origin,
      { mode: "step", envelope: false },
    );
    expect(m.tables[0]?.[1]).toEqual([2, 2]);
    const scale = m.tableScales[0] as string;
    expect(() => yRange(m, scale, 0, 100)).not.toThrow();
    expect(yRange(m, scale, 0, 100)).toEqual([1, 3]);
  });
});

describe("state signals drawn as steps (N3)", () => {
  const rows = [
    { low: 0, high: 0, text: "open" },
    { low: 1, high: 1, text: "precharge" },
    { low: 2, high: 2, text: "closed" },
  ];
  const diagInfo = { states: "text", diag: { states: rows } } as unknown as SignalInfo;
  const line = { mode: "line", envelope: false } as const;

  /** Level of a drawn point list at x: the y of the last point at or before x (step reading). */
  const levelAt = (xs: number[], ys: (number | null)[], x: number) => {
    let level: number | null | undefined;
    xs.forEach((px, i) => {
      if (px <= x) level = ys[i];
    });
    return level;
  };

  it("draws state signals as steps", () => {
    // Contactor polled 30 s apart: open at 0 s, closed at 30 s, both inside the view.
    const s30 = 30_000_000_000n;
    const r = raw([origin, origin + s30], [0, 0], { text: ["open", "closed"] });
    const m = buildModel(
      [{ key: "a", label: "contactor", color: "#000", result: r, states: rows, info: diagInfo }],
      origin,
      line,
    );
    const xs = m.tables[0]?.[0] as number[];
    const ys = m.tables[0]?.[1] as (number | null)[];
    // Every drawn point is at open (0) or closed (2); none at precharge (1) between them.
    expect(ys.every((y) => y === 0 || y === 2)).toBe(true);
    expect([...xs]).toEqual([...xs].sort((a, b) => a - b));
    // The open level holds until just before the closed point, then the level is closed.
    expect(levelAt(xs, ys, 29_999_999_999)).toBe(0);
    // A drawn point holds open up to the closed point (a bare two-point line would slope).
    const lastOpenX = Math.max(...xs.filter((_, i) => ys[i] === 0));
    expect(lastOpenX).toBeGreaterThanOrEqual(29_999_999_999);
    expect(lastOpenX).toBeLessThan(30_000_000_000);
    expect(levelAt(xs, ys, 15_000_000_000)).toBe(0);
    expect(levelAt(xs, ys, 30_000_000_000)).toBe(2);
  });

  it("holds the edge level across a range without points", () => {
    // IgnCurMode-like VAL_ signal: no point in the view [0, 1000], edge point before is 3 (KEYON),
    // the next point (OFF = 0) lies after the view.
    const info = {
      states: "labels",
      dbc: {
        values: [
          { raw: 0, value: 0, label: "OFF" },
          { raw: 3, value: 3, label: "KEYON" },
        ],
      },
    } as unknown as SignalInfo;
    const r = raw([], [], {
      before: { t: (origin - 500n).toString(), v: 3, label: "KEYON" },
      after: { t: (origin + 2000n).toString(), v: 0, label: "OFF" },
    });
    const m = buildModel(
      [{ key: "a", label: "IgnCurMode", color: "#000", result: r, info }],
      origin,
      line,
    );
    const xs = m.tables[0]?.[0] as number[];
    const ys = m.tables[0]?.[1] as (number | null)[];
    for (const x of [0, 1, 500, 999, 1000]) expect(levelAt(xs, ys, x)).toBe(3);
    // A drawn point at 3 reaches past the view end (a bare before/after pair would slope).
    expect(Math.max(...xs.filter((_, i) => ys[i] === 3))).toBeGreaterThanOrEqual(1000);
    // Nothing is drawn at a level between 3 and 0 inside the view.
    expect(ys.filter((y, i) => y !== null && (xs[i] as number) <= 1000).every((y) => y === 3)).toBe(
      true,
    );
  });

  it('holds only segments with a named end, as the readout (50 km/h, VAL_ 0 "Stop")', () => {
    const speedInfo = {
      states: "labels",
      unit: "km/h",
      dbc: { values: [{ raw: 0, value: 0, label: "Stop" }] },
    } as unknown as SignalInfo;
    const r = raw([origin, origin + 1000n, origin + 2000n], [40, 50, 0]);
    const m = buildModel(
      [{ key: "a", label: "speed", unit: "km/h", color: "#000", result: r, info: speedInfo }],
      origin,
      line,
    );
    // 40 → 50 (both unnamed) slopes: no hold point; 50 → 0 ("Stop") holds 50 until 1 ns before.
    expect(m.tables[0]?.[0]).toEqual([0, 1000, 1999, 2000]);
    expect(m.tables[0]?.[1]).toEqual([40, 50, 50, 0]);
  });

  it("holds bucket segments with a named end, min/max aligned with xs", () => {
    const speedInfo = {
      states: "labels",
      unit: "km/h",
      dbc: { values: [{ raw: 0, value: 0, label: "Stop" }] },
    } as unknown as SignalInfo;
    // Bucket 1 is all "Stop" (min = max = 0, named); bucket 4 is all SNA.
    const b: BucketSeries = {
      kind: "buckets",
      signalId: "c/s",
      from: "0",
      to: "1",
      width: "1000",
      t: encodeTimes([0n, 1000n, 2000n, 3000n, 4000n].map((d) => origin + d)),
      count: [3, 3, 3, 3, 0],
      sna: [0, 0, 0, 0, 3],
      mean: [45, 0, 40, 50, null],
      min: [40, 0, 30, 40, null],
      max: [50, 0, 50, 60, null],
    };
    const m = buildModel(
      [{ key: "a", label: "speed", unit: "km/h", color: "#000", result: b, info: speedInfo }],
      origin,
      { mode: "line", envelope: true },
    );
    const [xs, ys, max, min] = m.tables[0] as (number | null)[][];
    // 0 → 1 and 1 → 2 hold (an end is "Stop"); 2 → 3 slopes; nothing is held into the SNA bucket.
    expect(xs).toEqual([500, 1499, 1500, 2499, 2500, 3500, 4500]);
    expect(ys).toEqual([45, 45, 0, 0, 40, 50, null]);
    expect(max).toEqual([50, 50, 0, 0, 50, 60, null]);
    expect(min).toEqual([40, 40, 0, 0, 30, 40, null]);
  });

  it("widens a flat y range only for code-valued states", () => {
    // (c1) flat diag enum at precharge: widened to its states' span 0..2 (plus 5 % padding).
    const flatEnum = raw([origin + 10n, origin + 20n], [0, 0], {
      text: ["precharge", "precharge"],
    });
    const me = buildModel(
      [
        {
          key: "a",
          label: "contactor",
          color: "#000",
          result: flatEnum,
          states: rows,
          info: diagInfo,
        },
      ],
      origin,
      line,
    );
    const [lo, hi] = yRange(me, me.tableScales[0] as string, 0, 100) as [number, number];
    expect(lo).toBeCloseTo(-0.1, 9);
    expect(hi).toBeCloseTo(2.1, 9);

    // (c2) numeric signal at 50 km/h with VAL_ 0 "Stop": normal axis centred on 50, not widened to 0.
    const speedInfo = {
      states: "labels",
      unit: "km/h",
      dbc: { values: [{ raw: 0, value: 0, label: "Stop" }] },
    } as unknown as SignalInfo;
    const flatSpeed = raw([origin + 10n, origin + 20n], [50, 50]);
    const ms = buildModel(
      [
        {
          key: "b",
          label: "speed",
          unit: "km/h",
          color: "#000",
          result: flatSpeed,
          info: speedInfo,
        },
      ],
      origin,
      line,
    );
    const [slo, shi] = yRange(ms, ms.tableScales[0] as string, 0, 100) as [number, number];
    expect(slo).toBeCloseTo(45, 9);
    expect(shi).toBeCloseTo(55, 9);
  });
});

describe("gap breaks (add-gap-display)", () => {
  const MS = 1_000_000n;
  const S = 1_000_000_000n;
  const none = { mode: "line", envelope: false } as const;
  const step = { mode: "step", envelope: false } as const;
  const at = (n: bigint) => origin + n;
  const input = (result: RawSeries | BucketSeries, gaps?: SignalGaps, info?: SignalInfo) => ({
    key: "a",
    label: "a",
    color: "#000",
    result,
    ...(gaps ? { gaps } : {}),
    ...(info ? { info } : {}),
  });
  const table = (m: ReturnType<typeof buildModel>) => m.tables[0] as (number | null)[][];
  /** Drawn segments: consecutive points that are both numbers (a null ends a line or a hold). */
  const segments = (xs: readonly (number | null)[], ys: readonly (number | null)[]) => {
    const out: [number, number][] = [];
    for (let i = 0; i + 1 < xs.length; i++) {
      if (ys[i] !== null && ys[i + 1] !== null) out.push([xs[i] as number, xs[i + 1] as number]);
    }
    return out;
  };
  const meets = (segs: [number, number][], a: number, b: number) =>
    segs.some(([from, to]) => from < b && to > a);

  it("breaks lines and steps at gaps", () => {
    // Period 20 ms: points at 0, 20, 40 ms and 500, 520 ms. The 40 -> 500 ms stretch is split, hold end 60 ms.
    const cyc: SignalGaps = { period: 20n * MS, logger: [] };
    const r = raw(
      [0n, 20n, 40n, 500n, 520n].map((n) => at(n * MS)),
      [1, 2, 3, 4, 5],
    );
    const line = table(buildModel([input(r, cyc)], origin, none));
    expect(line).toEqual([
      [0, 20e6, 40e6, 60e6 + 1, 500e6, 520e6],
      [1, 2, 3, null, 4, 5],
    ]);
    const held = table(buildModel([input(r, cyc)], origin, step));
    expect(held).toEqual([
      [0, 20e6, 40e6, 60e6, 60e6 + 1, 500e6, 520e6],
      [1, 2, 3, 3, null, 4, 5],
    ]);
    expect(meets(segments(held[0] ?? [], held[1] ?? []), 60e6, 500e6)).toBe(false);

    // No period, a logger gap 1 s - 9 s between the points at 0 and 10 s: no segment; the step holds to 1 s.
    const far = raw([at(0n), at(10n * S)], [1, 2]);
    const abs: SignalGaps = {
      logger: [{ from: at(1n * S), to: at(9n * S) }],
    };
    expect(table(buildModel([input(far, abs)], origin, none))).toEqual([
      [0, 1e9 + 1, 10e9],
      [1, null, 2],
    ]);
    expect(table(buildModel([input(far, abs)], origin, step))).toEqual([
      [0, 1e9, 1e9 + 1, 10e9],
      [1, 1, null, 2],
    ]);

    // Without gap info (or NO_GAPS) nothing changes.
    expect(table(buildModel([input(far)], origin, none))).toEqual([
      [0, 10e9],
      [1, 2],
    ]);

    // Window inside a split. gapcar Evt_B11h.EVT: 2 at 00:04:00, 3 at 00:07:00; logger gap 00:04:59.980 - 00:06:00.000;
    // the view 00:05:10 - 00:05:50 holds no point.
    const G = 1_790_985_600n * S;
    const from = G + 310n * S;
    const to = G + 350n * S;
    const emptyView = raw([], [], {
      from: from.toString(),
      to: to.toString(),
      before: { t: (G + 240n * S).toString(), v: 2 },
      after: { t: (G + 420n * S).toString(), v: 3 },
    });
    const gaps: SignalGaps = { logger: [{ from: G + 299_980n * MS, to: G + 360n * S }] };
    for (const display of [none, step]) {
      const [xs = [], ys = []] = table(buildModel([input(emptyView, gaps)], from, display));
      const view: [number, number] = [0, Number(to - from)];
      expect(meets(segments(xs, ys), ...view), display.mode).toBe(false);
    }
    // Without the gap the line crosses the window.
    const [xs = [], ys = []] = table(buildModel([input(emptyView)], from, none));
    expect(meets(segments(xs, ys), 0, Number(to - from))).toBe(true);
  });

  it("breaks buckets only where a gap is certain", () => {
    const bucketResult = (width: bigint, starts: bigint[]): BucketSeries => ({
      kind: "buckets",
      signalId: "c/s",
      from: "0",
      to: "1",
      width: width.toString(),
      t: encodeTimes(starts.map((s) => at(s))),
      count: starts.map(() => 3),
      sna: starts.map(() => 0),
      mean: starts.map((_, i) => i + 1),
      min: starts.map((_, i) => i),
      max: starts.map((_, i) => i + 2),
    });
    // 5 ms buckets of a 30 s signal, 30 s apart: one line, mean and envelope.
    const slow = buildModel(
      [input(bucketResult(5n * MS, [0n, 30n * S]), { period: 30n * S, logger: [] })],
      origin,
      { mode: "line", envelope: true },
    );
    expect(slow.tables[0]).toEqual([
      [2.5e6, 30e9 + 2.5e6],
      [1, 2],
      [2, 3],
      [0, 1],
    ]);

    // 5 ms buckets of a 20 ms signal with an empty stretch of 100 ms: broken at the later bucket's start.
    const drop = buildModel(
      [input(bucketResult(5n * MS, [0n, 105n * MS]), { period: 20n * MS, logger: [] })],
      origin,
      { mode: "line", envelope: true },
    );
    expect(drop.tables[0]).toEqual([
      [2.5e6, 105e6, 107.5e6],
      [1, null, 2],
      [2, null, 3],
      [0, null, 1],
    ]);

    // 1 min buckets without a period, adjacent, a logger gap in the second half of the first one.
    const MIN = 60n * S;
    const gaps: SignalGaps = { logger: [{ from: at(45n * S), to: at(55n * S) }] };
    const logger = buildModel([input(bucketResult(MIN, [0n, MIN]), gaps)], origin, {
      mode: "line",
      envelope: true,
    });
    expect(logger.tables[0]).toEqual([
      [30e9, 60e9, 90e9],
      [1, null, 2],
      [2, null, 3],
      [0, null, 1],
    ]);
  });

  it("draws through a logger gap that holds samples", () => {
    // G9 repro: smart451, logger gap 18:51:11.171 - 18:52:43.235 UTC (stale: carserver holds rows there),
    // view 18:51:11.385 - 18:51:20.691.
    const gapFrom = 1_792_176_671_171_000_000n;
    const gapTo = 1_792_176_763_235_000_000n;
    const viewFrom = 1_792_176_671_385_000_000n;
    const viewTo = 1_792_176_680_691_000_000n;
    const logger = [{ from: gapFrom, to: gapTo }];
    const o = viewFrom;

    // LWS_ANGLE: 500 buckets of 20 ms on the 20 ms grid from 18:51:11.400, period 10 ms, means
    // alternating -1400 / 1400, all inside the gap. Was: 499 breaks, all 500 isolated.
    const width = 20n * MS;
    const starts = Array.from(
      { length: 500 },
      (_, i) => 1_792_176_671_400_000_000n + BigInt(i) * width,
    );
    const lws: BucketSeries = {
      kind: "buckets",
      signalId: "smart451/SAS_0C2h.LWS_ANGLE",
      from: viewFrom.toString(),
      to: viewTo.toString(),
      width: width.toString(),
      t: encodeTimes(starts),
      count: starts.map(() => 2),
      sna: starts.map(() => 0),
      mean: starts.map((_, i) => (i % 2 === 0 ? -1400 : 1400)),
      min: starts.map((_, i) => (i % 2 === 0 ? -1405 : 1395)),
      max: starts.map((_, i) => (i % 2 === 0 ? -1395 : 1405)),
    };
    const lwsModel = buildModel([input(lws, { period: 10n * MS, logger }, undefined)], o, {
      mode: "line",
      envelope: true,
    });
    const lwsTable = table(lwsModel);
    // x, mean, max, min: 500 columns, no inserted null in any of them, nothing isolated.
    expect(lwsTable.map((row) => row.length)).toEqual([500, 500, 500, 500]);
    for (const row of lwsTable.slice(1)) expect(row.includes(null)).toBe(false);
    expect(isolatedPoints(lwsTable[1] as (number | null)[])).toEqual([]);
    expect(lwsTable[1]?.slice(0, 3)).toEqual([-1400, 1400, -1400]);

    // PTC_HV_Volt: 95 raw points 100 ms apart from the view start (period 100 ms), edge neighbours
    // 100 ms before and after, all inside the gap. Was: 94 breaks.
    const times = Array.from({ length: 95 }, (_, i) => viewFrom + BigInt(i) * 100n * MS);
    const ptc = raw(
      times,
      times.map((_, i) => 350 + (i % 2)),
      {
        signalId: "smart451/CPC_448h.PTC_HV_Volt",
        from: viewFrom.toString(),
        to: viewTo.toString(),
        before: { t: (viewFrom - 100n * MS).toString(), v: 351 },
        after: { t: (viewFrom + 9_500n * MS).toString(), v: 351 },
      },
    );
    const ptcTable = table(buildModel([input(ptc, { period: 100n * MS, logger })], o, none));
    expect(ptcTable[1]?.includes(null)).toBe(false);
    expect(isolatedPoints(ptcTable[1] as (number | null)[])).toEqual([]);

    // Control: a logger gap that holds none of the signal's samples still breaks (a real gap).
    const real = [{ from: viewFrom + 100n * MS, to: viewFrom + 900n * MS }];
    const sparse = raw([viewFrom, viewFrom + 1_000n * MS], [1, 2]);
    expect(table(buildModel([input(sparse, { logger: real })], o, none))[1]).toContain(null);
  });

  it("ends an SNA mark at the hold end", () => {
    // Period 20 ms: SNA at 0 ms, the next point at 1 s: the mark covers 0 - 20 ms, not up to 1 s.
    const r = raw([at(0n), at(S)], [null, 5]);
    const cyc: SignalGaps = { period: 20n * MS, logger: [] };
    expect(snaPeriods(r, origin, cyc)).toEqual([[0, 20e6]]);
    expect(snaPeriods(r, origin)).toEqual([[0, 1e9]]);
    const m = buildModel([input(r, cyc)], origin, none);
    expect(m.sna).toEqual([{ color: "#000", periods: [[0, 20e6]] }]);
    // A logger gap ends it at the gap's start.
    const gap: SignalGaps = { logger: [{ from: at(300n * MS), to: at(900n * MS) }] };
    expect(snaPeriods(r, origin, gap)).toEqual([[0, 300e6]]);
  });

  it("draws a point between two splits as a marker", () => {
    // gapcar TBMS.current (10 s): 12.5 at 00:01:00, 00:01:40 and 00:02:20, 40 s apart.
    const r = raw([at(60n * S), at(100n * S), at(140n * S)], [12.5, 12.5, 12.5]);
    const m = buildModel([input(r, { period: 10n * S, logger: [] })], origin, none);
    const [xs = [], ys = []] = table(m);
    expect(xs).toEqual([60e9, 70e9 + 1, 100e9, 110e9 + 1, 140e9]);
    expect(ys).toEqual([12.5, null, 12.5, null, 12.5]);
    expect(isolatedPoints(ys)).toEqual([0, 2, 4]);
    // Three periods apart (30 s) is no split: the points stay joined.
    const joined = raw([at(60n * S), at(90n * S)], [12.5, 12.5]);
    expect(
      table(buildModel([input(joined, { period: 10n * S, logger: [] })], origin, none))[1],
    ).toEqual([12.5, 12.5]);
  });

  it("ends state signal holds at gaps", () => {
    // Named states (0 OFF, 3 KEYON), period 100 ms: points at 0, 100, 200 ms and 10 s; logger gap 250 ms - 9.9 s.
    const info = {
      states: "labels",
      dbc: {
        values: [
          { raw: 0, value: 0, label: "OFF" },
          { raw: 3, value: 3, label: "KEYON" },
        ],
      },
    } as unknown as SignalInfo;
    const gaps: SignalGaps = {
      period: 100n * MS,
      logger: [{ from: at(250n * MS), to: at(9900n * MS) }],
    };
    const r = raw([at(0n), at(100n * MS), at(200n * MS), at(10n * S)], [0, 0, 0, 3]);
    const [xs = [], ys = []] = table(buildModel([input(r, gaps, info)], origin, none));
    const segs = segments(xs, ys);
    // The 200 ms value is held to 250 ms (not to 300 ms, nor to 10 s) and nothing is drawn until 10 s.
    expect(Math.max(...segs.map(([, to]) => to).filter((to) => to < 10e9))).toBe(250e6);
    expect(meets(segs, 250e6, 10e9)).toBe(false);
    // Without the gaps the hold runs to 10 s.
    const [pxs = [], pys = []] = table(buildModel([input(r, undefined, info)], origin, none));
    expect(meets(segments(pxs, pys), 250e6, 10e9 - 2)).toBe(true);

    // A view 1 s - 9 s without a point, edge neighbours at 200 ms and 10 s: blank, no synthetic edge hold.
    const empty = raw([], [], {
      from: at(S).toString(),
      to: at(9n * S).toString(),
      before: { t: at(200n * MS).toString(), v: 0 },
      after: { t: at(10n * S).toString(), v: 3 },
    });
    const [exs = [], eys = []] = table(buildModel([input(empty, gaps, info)], origin, none));
    expect(meets(segments(exs, eys), 1e9, 9e9)).toBe(false);
    const [fxs = [], fys = []] = table(buildModel([input(empty, undefined, info)], origin, none));
    expect(meets(segments(fxs, fys), 1e9, 9e9)).toBe(true);
  });

  it("breaks a gap across a tile edge like one request", () => {
    // Level 24 tiles span 2^32 ns (4.29 s). Tile 0 ends with the point at T - 20 ms, tile 1 starts
    // with T + 380 ms: a dropout of 400 ms (> 3 x 20 ms) right across the edge.
    const T = 2n ** 32n;
    const points = [-100, -80, -60, -40, -20, 380, 400, 420].map((d, i) => ({
      t: T + BigInt(d) * MS,
      v: i + 1,
    }));
    const from = T - 50n * MS;
    const to = T + 410n * MS;
    const tiles = splitRun(fakeAnswer(points, runRequest("c/s", 24, 0n, 1n)), 24, 0n, 1n);
    const stitched = stitch(tiles, from, to);
    const direct = fakeRaw(points, "c/s", from, to);
    expect(stitched).toEqual(direct);

    const cyc: SignalGaps = { period: 20n * MS, logger: [] };
    const drawn = (result: RawSeries) =>
      buildModel([input(result, cyc)], from, none).tables[0] as (number | null)[][];
    // Hand-computed columns, offsets from the view start T - 50 ms; the break sits 1 ns after the hold end T.
    const expected = [
      [-10e6, 10e6, 30e6, 50e6 + 1, 430e6, 450e6, 470e6],
      [3, 4, 5, null, 6, 7, 8],
    ];
    expect(drawn(stitched as RawSeries)).toEqual(expected);
    expect(drawn(direct)).toEqual(expected);

    // Inside the dropout both give no value; at a point both give it.
    const inside = T + 100n * MS;
    expect(chartValueAt(stitched, inside, "line", undefined, cyc)).toEqual({
      kind: "none",
      reason: "period_gap",
    });
    expect(chartValueAt(direct, inside, "line", undefined, cyc)).toEqual({
      kind: "none",
      reason: "period_gap",
    });
  });
});
