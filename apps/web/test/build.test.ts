import { type BucketSeries, encodeTimes, type RawSeries } from "@letsview/shared";
import { describe, expect, it } from "vitest";
import { buildModel, formatDuration, resolutionLabel, toPoints } from "../src/chart/build.ts";

const origin = 1_000_000_000_000n;

function raw(times: bigint[], v: number[], extra: Partial<RawSeries> = {}): RawSeries {
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
    expect(resolutionLabel([])).toBeUndefined();
    expect(resolutionLabel([raw([], [])])).toBe("raw");
    expect(resolutionLabel([buckets])).toBe("aggregated · 1 µs per point");
    expect(resolutionLabel([buckets, raw([], [])])).toBe("partly aggregated · 1 µs per point");
    expect(formatDuration(4_803_200_000n)).toBe("4.8 s");
    expect(formatDuration(12n)).toBe("12 ns");
  });
});
