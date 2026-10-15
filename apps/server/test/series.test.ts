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
import { beforeAll, describe, expect, it } from "vitest";
import { Catalog } from "../src/catalog.ts";
import { loadDbcFiles } from "../src/dbc.ts";
import { bucketWidth, querySeries } from "../src/series.ts";
import { testDbcFiles, testSource } from "./testdb.ts";

const source = testSource();
// SNA ranges come from the catalog over the test DBCs, as in the server.
const catalog = new Catalog(source, () => loadDbcFiles(testDbcFiles));
beforeAll(() => catalog.refresh());
const ref = (name: string, dataRef = "testcar") => ({
  dataRef,
  name,
  sna: catalog.snaRanges(`${dataRef}/${name}`),
});
const iso = (s: string) => fromIso(s);
const BASE = iso("2026-10-01T00:00:00Z");
const TEN_HOURS = 10n * 3600n * NS_PER_S;

const query = (name: string, from: bigint, to: bigint, target: number) =>
  querySeries(source, ref(name), `testcar/${name}`, from, to, target);

const valid = (xs: (number | null)[]) => xs.filter((x): x is number => x !== null);

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
    expect(Math.max(...valid(r.max))).toBe(1000);
    const starts = decodeTimes(r.t);
    const i = r.max.indexOf(1000);
    const spike = iso("2026-10-01T05:00:00.615Z");
    expect(starts[i]).toBeLessThanOrEqual(spike);
    expect((starts[i] as bigint) + BigInt(r.width)).toBeGreaterThan(spike);
  });

  it("excludes null-timestamp rows from count, mean, min and max", async () => {
    const r = asBuckets(await query("Fast_100h.SIG_A", BASE, BASE + TEN_HOURS, 10));
    expect(Math.max(...valid(r.max))).toBe(1000);
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

describe("SNA handling (test series Sna_800h, from 2026-10-01T02:00:00Z)", () => {
  const S = iso("2026-10-01T02:00:00Z");
  const ms = (n: number) => BigInt(n) * NS_PER_MS;

  it("flags SNA raw points without value", async () => {
    // SPEED n = 298..301 at 100 ms: 98, 99 valid; 511 (SNA) at n = 300, 301.
    const r = asRaw(await query("Sna_800h.SPEED", S + ms(29_800), S + ms(30_200), 2000));
    expect(r.v).toEqual([98, 99, null, null]);
    expect(decodeTimes(r.t)).toEqual([0, 100, 200, 300].map((d) => S + ms(29_800 + d)));
    // Whole series: 203 SNA points and no 511 anywhere; one valid point (42) between two SNA points.
    const all = asRaw(await query("Sna_800h.SPEED", S, S + 100n * NS_PER_S, 2000));
    expect(all.v).toHaveLength(1000);
    expect(all.v.filter((v) => v === null)).toHaveLength(203);
    expect(all.v).not.toContain(511);
    expect(all.v.slice(599, 604)).toEqual([99, null, 42, null, 3]);
    // The last point (n = 999) is SNA and has no successor.
    expect(all.v.slice(998)).toEqual([98, null]);
  });

  it("flags signed SNA points", async () => {
    // TEMP n = 0..9: -128 (SNA) at n = 0 and 5, else n * 10 - 40.
    const r = asRaw(await query("Sna_800h.TEMP", S, S + 10n * NS_PER_S, 2000));
    expect(r.v).toEqual([null, -30, -20, -10, 0, null, 20, 30, 40, 50]);
  });

  it("returns SNA edge neighbors as SNA", async () => {
    // 1 ms between n = 400 (02:00:40.000) and n = 401 (02:00:40.100), both inside the SNA run.
    const from = S + ms(40_050);
    const r = asRaw(await query("Sna_800h.SPEED", from, from + NS_PER_MS, 2000));
    expect(r.v).toEqual([]);
    expect(r.before).toEqual({ t: (S + ms(40_000)).toString(), v: null });
    expect(r.after).toEqual({ t: (S + ms(40_100)).toString(), v: null });
  });

  it("matches SNA within half a raw step", async () => {
    // RPM (factor 0.5, SNA 8191.5): n = 50 stores 8191.0 (neighbouring raw code, valid),
    // n = 51 stores 8191.500000001 (SNA), n % 10 = 9 stores 8191.5 (SNA), else n * 10.
    const r = asRaw(await query("Sna_800h.RPM", S, S + 100n * NS_PER_S, 2000));
    expect(r.v).toHaveLength(100);
    expect(r.v[50]).toBe(8191);
    expect(r.v[51]).toBeNull();
    expect(r.v[9]).toBeNull();
    expect(r.v[99]).toBeNull();
    expect(r.v.filter((v) => v === null)).toHaveLength(11);
    expect(r.v[10]).toBe(100);
    expect(r.v[98]).toBe(980);
  });

  it("aggregates only valid points and counts SNA per bucket", async () => {
    const r = asBuckets(await query("Sna_800h.SPEED", S, S + 100n * NS_PER_S, 10));
    expect(r.count.length).toBeLessThanOrEqual(10);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(sum(r.count)).toBe(797);
    expect(sum(r.sna)).toBe(203);
    expect(r.count.every((c, i) => c + (r.sna[i] as number) >= 1)).toBe(true);
    // Sum of all valid values: 10 * (0 + ... + 99) = 49,500, minus the 511 run's values
    // 2 * 4,950, minus the SNA points 600, 602, 999 (0 + 2 + 99), plus 41 for the 42 at n = 601.
    const total = r.mean.reduce<number>((a, m, i) => a + (m ?? 0) * (r.count[i] as number), 0);
    expect(total).toBeCloseTo(39_540, 6);
    const maxima = r.max.filter((m): m is number => m !== null);
    expect(Math.max(...maxima)).toBe(99);
    // A bucket holding both kinds has valid statistics below 511.
    const mixed = r.count.findIndex((c, i) => c > 0 && (r.sna[i] as number) > 0);
    expect(mixed).toBeGreaterThanOrEqual(0);
    expect(r.max[mixed] as number).toBeLessThan(511);
    expect(r.min[mixed] as number).toBeLessThanOrEqual(r.mean[mixed] as number);
  });

  it("returns all-SNA buckets without mean, min and max", async () => {
    const r = asBuckets(await query("Sna_800h.SPEED", S, S + 100n * NS_PER_S, 10));
    // Width ~11.1 s: at least one bucket lies fully inside the 20 s run 02:00:30 to 02:00:49.9.
    const allSna = r.count.flatMap((c, i) => (c === 0 ? [i] : []));
    expect(allSna.length).toBeGreaterThanOrEqual(1);
    for (const i of allSna) {
      expect(r.sna[i]).toBeGreaterThan(0);
      expect([r.mean[i], r.min[i], r.max[i]]).toEqual([null, null, null]);
    }
    // Buckets with valid points always have all three statistics.
    r.count.forEach((c, i) => {
      if (c > 0)
        expect([r.mean[i], r.min[i], r.max[i]].every((x) => typeof x === "number")).toBe(true);
    });
  });

  it("returns 0 of a 0h counter as a valid value", async () => {
    expect(catalog.snaRanges("testcar/Sna_800h.COUNTER")).toEqual([]);
    const r = asRaw(await query("Sna_800h.COUNTER", S, S + 16n * NS_PER_S, 2000));
    expect(r.v).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
  });
});

describe("aligned requests share buckets", () => {
  it("returns identical buckets for aligned requests that share them", async () => {
    const to = 1790820080452370432n;
    const a = asBuckets(await query("Sna_800h.SPEED", 1790820011732893696n, to, 513));
    const b = asBuckets(await query("Sna_800h.SPEED", 1790820046092632064n, to, 257));
    expect(a.width).toBe("134217728");
    expect(b.width).toBe("134217728");
    const ta = decodeTimes(a.t);
    const tb = decodeTimes(b.t);
    const first = ta.findIndex((t) => t >= 1790820046092632064n);
    expect(first).toBeGreaterThan(0);
    expect(tb.length).toBeGreaterThan(0);
    const tail = <T>(xs: T[]) => xs.slice(first);
    expect(tb).toEqual(tail(ta));
    expect(b.count).toEqual(tail(a.count));
    expect(b.sna).toEqual(tail(a.sna));
    expect(b.mean).toEqual(tail(a.mean));
    expect(b.min).toEqual(tail(a.min));
    expect(b.max).toEqual(tail(a.max));
  });
});
