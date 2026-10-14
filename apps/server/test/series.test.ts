import {
  type BucketSeries,
  decodeTimes,
  fromIso,
  NS_PER_MS,
  NS_PER_S,
  type RawSeries,
  type SeriesResult,
  toIso,
} from "@letsview/shared";
import { describe, expect, it } from "vitest";
import { bucketWidth, querySeries } from "../src/series.ts";
import { testSource } from "./testdb.ts";

const source = testSource();
const ref = (name: string, dataRef = "testcar") => ({ dataRef, name });
const iso = (s: string) => fromIso(s);
const BASE = iso("2026-10-01T00:00:00Z");
const TEN_HOURS = 10n * 3600n * NS_PER_S;

const query = (name: string, from: bigint, to: bigint, target: number) =>
  querySeries(source, ref(name), `testcar/${name}`, from, to, target);

function asRaw(r: SeriesResult): RawSeries {
  if (r.kind !== "raw") throw new Error(`expected raw, got ${r.kind}`);
  return r;
}
function asBuckets(r: SeriesResult): BucketSeries {
  if (r.kind !== "buckets") throw new Error(`expected buckets, got ${r.kind}`);
  return r;
}

describe("raw points with edge neighbors", () => {
  it("returns both neighbors for a millisecond window between two points", async () => {
    const from = iso("2026-10-01T00:00:30Z");
    const r = asRaw(await query("Sparse_300h.SLOW", from, from + NS_PER_MS, 2000));
    expect(r.v).toEqual([]);
    expect(r.before).toEqual({ t: BASE.toString(), v: 0 });
    expect(r.after).toEqual({ t: iso("2026-10-01T00:01:00Z").toString(), v: 1 });
  });

  it("returns no leading neighbor at the start of the recording", async () => {
    const r = asRaw(await query("Sparse_300h.SLOW", BASE - 60n * NS_PER_S, BASE, 2000));
    expect(r.v).toEqual([]);
    expect(r.before).toBeUndefined();
    expect(r.after).toEqual({ t: BASE.toString(), v: 0 });
  });

  it("returns unmodified points at their original, irregular timestamps", async () => {
    const from = iso("2026-10-01T01:00:00Z");
    const r = asRaw(await query("Irr_200h.JITTER", from, from + NS_PER_S, 2000));
    const times = decodeTimes(r.t);
    expect(times).toHaveLength(100);
    const steps = new Set(times.slice(1).map((t, i) => (t - (times[i] as bigint)) / NS_PER_MS));
    expect(steps.size).toBeGreaterThan(3);
    expect(times.every((t) => t >= from && t < from + NS_PER_S)).toBe(true);
    expect(r.before).toBeUndefined();
    expect(r.after && BigInt(r.after.t)).toBeGreaterThanOrEqual(from + NS_PER_S);
  });

  it("never returns rows with a null timestamp, also not as a neighbor", async () => {
    expect(await source.before(ref("Fast_100h.SIG_A"), BASE)).toBeUndefined();
    const r = asRaw(await query("Fast_100h.SIG_A", BASE - NS_PER_S, BASE + 10n * NS_PER_MS, 2000));
    expect(r.v).not.toContain(9999);
    expect(r.v).toHaveLength(2);
  });
});

describe("aggregated buckets", () => {
  it("returns at most target buckets for the 10-hour overview and keeps the spike", async () => {
    const r = asBuckets(await query("Fast_100h.SIG_A", BASE, BASE + TEN_HOURS, 2000));
    expect(r.count.length).toBeLessThanOrEqual(2000);
    expect(r.count.reduce((a, b) => a + b, 0)).toBe(7_200_000);
    expect(Math.max(...r.max)).toBe(1000);
    const starts = decodeTimes(r.t);
    const i = r.max.indexOf(1000);
    const spike = iso("2026-10-01T05:00:00.615Z");
    expect(starts[i]).toBeLessThanOrEqual(spike);
    expect((starts[i] as bigint) + BigInt(r.width)).toBeGreaterThan(spike);
  });

  it("excludes null-timestamp rows from count, mean, min and max", async () => {
    const r = asBuckets(await query("Fast_100h.SIG_A", BASE, BASE + TEN_HOURS, 10));
    expect(Math.max(...r.max)).toBe(1000);
    expect(r.count.reduce((a, b) => a + b, 0)).toBe(7_200_000);
  });

  it("aligns buckets to the absolute grid so they stay stable while panning", async () => {
    const width = bucketWidth(BASE, BASE + TEN_HOURS, 2000);
    const shifted = BASE + 7n * width + 12_345n;
    const a = asBuckets(await query("Fast_100h.SIG_B", BASE, BASE + TEN_HOURS, 2000));
    const b = asBuckets(await query("Fast_100h.SIG_B", shifted, shifted + TEN_HOURS, 2000));
    expect(a.width).toBe(b.width);
    for (const t of [...decodeTimes(a.t), ...decodeTimes(b.t)]) expect(t % width).toBe(0n);
    // A bucket fully inside both ranges has identical aggregates.
    const ta = decodeTimes(a.t);
    const tb = decodeTimes(b.t);
    const j = tb.indexOf(ta[100] as bigint);
    expect(j).toBeGreaterThan(-1);
    expect([b.mean[j], b.min[j], b.max[j], b.count[j]]).toEqual([
      a.mean[100],
      a.min[100],
      a.max[100],
      a.count[100],
    ]);
  });

  it("omits empty buckets instead of filling them", async () => {
    // 10,000 points within 100 s, queried over 10 h: nearly all grid buckets are empty.
    const r = asBuckets(await query("Irr_200h.JITTER", BASE, BASE + TEN_HOURS, 2000));
    expect(r.count.length).toBeLessThan(10);
    expect(r.count.every((c) => c > 0)).toBe(true);
    expect(r.count.reduce((a, b) => a + b, 0)).toBe(10_000);
  });
});

describe("raw vs. aggregate selection", () => {
  const from = BASE;
  const to = BASE + 100n * NS_PER_S;

  it("returns raw points when the count equals the target", async () => {
    const r = asRaw(await query("Nodbc_500h.RAW", from, to, 100));
    expect(r.v).toHaveLength(100);
  });

  it("returns buckets when the count exceeds the target by one", async () => {
    const r = asBuckets(await query("Nodbc_500h.RAW", from, to, 99));
    expect(r.count.length).toBeLessThanOrEqual(99);
    expect(r.count.reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("rejects empty ranges", async () => {
    await expect(query("Nodbc_500h.RAW", to, from, 100)).rejects.toThrow(RangeError);
  });

  it("formats the request range in the result", async () => {
    const r = await query("Nodbc_500h.RAW", from, to, 100);
    expect(toIso(BigInt(r.from))).toBe("2026-10-01T00:00:00Z");
    expect(r.signalId).toBe("testcar/Nodbc_500h.RAW");
  });
});
